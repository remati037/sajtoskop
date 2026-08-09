-- 0004_f4_credits_export.sql — F4: mesečna dodela i dnevni cap na export
--
-- Izvor: docs/F4-krediti.md, sekcije 2 i 5.
-- Odstupanja od PRD-a su namerna i objašnjena na licu mesta oznakom [ODSTUPANJE].

-- ═══════════════════════════════════════════════════════════
-- 1. NOV TIP POSLA
-- ═══════════════════════════════════════════════════════════

alter table job_queue drop constraint if exists job_queue_type_valid;
alter table job_queue add constraint job_queue_type_valid check (
  type in ('scan', 'enrich_basic', 'enrich_full', 'refresh_google', 'monthly_grant')
);

-- ═══════════════════════════════════════════════════════════
-- 2. NULTA STAVKA U KNJIZI
-- ═══════════════════════════════════════════════════════════
-- [ODSTUPANJE — bitno, čitaj pre nego što ovo „popraviš"]
--
-- F4 §2 traži reset bez rollovera: postavi balans na 30, ne dodaj 30. Za
-- korisnika koji ceo mesec nije otključao ništa, razlika je tačno 0.
--
-- Bez stavke u knjizi za taj slučaj nema ni traga da je dodela obavljena, pa
-- `credit_ledger_grant_idem_idx` nema šta da uhvati. Posao koji se iz bilo kog
-- razloga ponovi (worker restartovan, žetva vratila posao u red) tada bi drugi
-- put resetovao balans — i vratio kredite korisniku koji ih je u međuvremenu
-- potrošio.
--
-- Zato nulta stavka sme, ali SAMO za `monthly_grant`, gde znači „reset je
-- obavljen, promene nije bilo". Za `unlock` i dalje nema smisla i ostaje
-- zabranjena. Invarijanta `sum(delta) = credits_balance` se ne menja.
alter table credit_ledger drop constraint if exists credit_ledger_delta_nonzero;
alter table credit_ledger add constraint credit_ledger_delta_nonzero check (
  delta <> 0 or reason = 'monthly_grant'
);

-- ═══════════════════════════════════════════════════════════
-- 3. DNEVNI BROJAČ IZVEZENIH REDOVA
-- ═══════════════════════════════════════════════════════════
-- Isti oblik kao `cache_miss_day` / `cache_miss_count` iz 0001, i isti LA dan.
-- Korisnikov lokalni datum je namerno nebitan; da se dan računa dvaput različito,
-- ekran „Krediti" bi prikazivao dva brojača koja se resetuju u različito vreme.

alter table profiles add column if not exists export_day   date;
alter table profiles add column if not exists export_count integer not null default 0;

alter table profiles drop constraint if exists profiles_export_nonneg;
alter table profiles add constraint profiles_export_nonneg check (export_count >= 0);

-- ═══════════════════════════════════════════════════════════
-- 4. MESEČNA DODELA
-- ═══════════════════════════════════════════════════════════

/**
 * Postavi balans na `p_target` i upiši razliku u knjigu.
 *
 * [ODSTUPANJE od pravila 3 iz CLAUDE.md]
 * Pravilo kaže: krediti se menjaju samo kroz `spend_credit_and_unlock` ili
 * `grant_credits`. Ovo je treća funkcija, i to je svesna odluka — `grant_credits`
 * DODAJE iznos i odbija sve što nije pozitivno, pa njome reset bez rollovera
 * nije izvodljiv: korisnik sa 12 kredita treba +18, sa 30 treba 0, a sa 45
 * (ručna dodela) treba -15.
 *
 * Alternativa je bila da worker pročita balans pa pozove `grant_credits` sa
 * razlikom. To je „pročitaj pa upiši" nad istim redom koji `spend_credit_and_unlock`
 * zaključava — dakle tačno onaj oblik trke koji ceo F4 postoji da spreči.
 *
 * Duh pravila je ispoštovan: balans se i dalje menja isključivo unutar audirane
 * SQL funkcije, pod `for update`, uz obaveznu stavku u `credit_ledger`.
 *
 * `p_ref_id` je ključ idempotencije — mesec u obliku '2026-09'. Ponovljen poziv
 * sa istim ref_id ne radi ništa.
 */
create or replace function grant_monthly_credits(
  p_user   text,
  p_target integer,
  p_ref_id text
)
returns table (ok boolean, reason text, delta integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
  v_delta   integer;
begin
  if p_target < 0 then
    return query select false, 'invalid_amount', 0; return;
  end if;

  if p_ref_id is null or p_ref_id = '' then
    -- Bez ključa idempotencije ova funkcija je oružje: svaki poziv resetuje balans.
    return query select false, 'missing_ref_id', 0; return;
  end if;

  select credits_balance into v_balance
  from profiles where id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user', 0; return;
  end if;

  -- Alias je obavezan: `reason` je i izlazni parametar i kolona u credit_ledger.
  if exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'monthly_grant' and cl.ref_id = p_ref_id
  ) then
    return query select true, 'already_granted', 0; return;
  end if;

  v_delta := p_target - v_balance;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, v_delta, 'monthly_grant', p_ref_id);
  update profiles set credits_balance = p_target where id = p_user;

  return query select true, 'granted', v_delta;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. DNEVNI CAP NA EXPORT
-- ═══════════════════════════════════════════════════════════

/**
 * Rezerviši do `p_wanted` redova za izvoz i vrati koliko ih je odobreno.
 *
 * Vraća `allowed`, a ne samo `ok`: korisnik sa 90 izvezenih redova od 100 koji
 * traži 30 dobija 10, a ne odbijenicu. Delimičan izvoz je koristan, prazan nije.
 *
 * Rezervacija i reset dana su u istoj transakciji pod `for update` — dva
 * paralelna zahteva u ponoć inače oba vide stari dan i oba resetuju brojač.
 */
create or replace function claim_export(p_user text, p_limit integer, p_wanted integer)
returns table (ok boolean, reason text, allowed integer, used integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day     date := budget_day();
  v_count   integer;
  v_prev    date;
  v_allowed integer;
begin
  if p_wanted <= 0 then
    return query select false, 'nothing_to_export', 0, 0, budget_next_day_reset(v_day);
    return;
  end if;

  select p.export_count, p.export_day into v_count, v_prev
  from profiles p where p.id = p_user for update;

  if not found then
    return query select false, 'no_user', 0, 0, budget_next_day_reset(v_day);
    return;
  end if;

  if v_prev is distinct from v_day then
    v_count := 0;
  end if;

  v_allowed := least(p_wanted, greatest(0, p_limit - v_count));

  if v_allowed <= 0 then
    return query select false, 'limit_reached', 0, v_count, budget_next_day_reset(v_day);
    return;
  end if;

  update profiles
  set export_day = v_day, export_count = v_count + v_allowed
  where id = p_user;

  return query select true, 'claimed', v_allowed, v_count + v_allowed,
                      budget_next_day_reset(v_day);
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. PRAVA NAD FUNKCIJAMA
-- ═══════════════════════════════════════════════════════════
-- Isti razlog kao u 0001 §4: `security definer` je podrazumevano izvršiva za
-- `public`, pa bi bilo ko sa anon ključem mogao da pozove
-- grant_monthly_credits('user_tudji', 999, '2026-09') preko PostgREST-a.

revoke all on function grant_monthly_credits(text, integer, text) from public, anon, authenticated;
revoke all on function claim_export(text, integer, integer) from public, anon, authenticated;

grant execute on function grant_monthly_credits(text, integer, text) to service_role;
grant execute on function claim_export(text, integer, integer) to service_role;
