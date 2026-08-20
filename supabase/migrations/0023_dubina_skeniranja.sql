-- 0023_dubina_skeniranja.sql — S17: cena skeniranja je 1 kredit po stranici
--
-- Izvor: docs/LANSIRANJE.md §1.2. Do ove migracije je skeniranje koštalo FIKSNO
-- 1 kredit bez obzira na to koliko rezultata traži, iako `spend_credit_and_scan`
-- već prima `p_max_results`. Text Search naplaćuje SVAKU stranicu kao poseban
-- poziv, pa je skeniranje za 60 rezultata koštalo mene 3× više nego za 20 — uz
-- istu cenu za korisnika.
--
-- Od sada: **1 kredit = 1 stranica = 1 Places poziv.**
--
--   Brzo         do 20 prospekata   1 stranica   1 kredit
--   Standardno   do 40 prospekata   2 stranice   2 kredita   ← podrazumevano
--   Duboko       do 60 prospekata   3 stranice   3 kredita
--
-- Formula je ista i u `packages/shared/src/plans.ts` (`stranicaZaRezultate`).
-- Dva izvora, ali NE dva pravila: TS je izvor prikaza, ovaj SQL je izvor
-- naplate, a `pnpm check:sql` proverava da se poklapaju za sve tri dubine.
--
-- ── šta se OVDE ne dira, i zašto ──────────────────────────
-- Nijedna funkcija ne menja POVRATNI TIP. `spend_credit_and_scan`,
-- `search_cache_state` i `search_cache_overview` prave 0009, 0020 i 0022 kroz
-- `create or replace`; kad bi ovde dobile drugačiji `returns table`, drugi
-- prolaz `pnpm check:sql` bi pukao na „cannot change return type of existing
-- function". Zato dubina keširanog reda ide u web sloj čitanjem KOLONE, istim
-- obrascem kojim je 0021 uveo `partial`. `record_scan` sme da menja argumente
-- jer se pre kreiranja eksplicitno drop-uje — isti obrazac kao u 0021.

-- ═══════════════════════════════════════════════════════════
-- 1. REGISTAR KEŠA PAMTI DUBINU
-- ═══════════════════════════════════════════════════════════
-- Bez ove kolone zahtev za „Duboko" nad kombinacijom keširanom kao „Brzo"
-- izgleda kao pogodak u kešu — korisnik dobije 20 redova umesto 60, i to
-- besplatno, pa nikad ne može ni da plati ono što stvarno traži. Obrnuto je
-- gore: da je pogodak samo po datumu, „Duboko" nad plitkim kešom bi naplatilo
-- 3 kredita i vratilo 20 redova.
--
-- Ime je `pages`, a ne `depth`: kolona nosi BROJ STRANICA, a to je istovremeno
-- i broj Places poziva i cena u kreditima. „Depth" bi bio naziv ponude
-- (`brzo`/`standardno`/`duboko`) — a ponuda se sme preimenovati i preurediti
-- bez ijedne migracije dokle god je broj stranica ono što stoji u bazi.

alter table search_cache add column if not exists pages integer not null default 1;

alter table search_cache drop constraint if exists search_cache_pages_valid;
alter table search_cache add constraint search_cache_pages_valid
  check (pages between 1 and 3);

-- ── backfill ──────────────────────────────────────────────
-- Zatečeni redovi dobijaju dubinu koja odgovara njihovom `last_results_count`,
-- NE podrazumevanu vrednost. Red sa 55 rezultata je bio duboki scan i ne sme
-- posle migracije da traži da se plati ponovo za ono što u bazi već stoji.
--
-- `only ... where pages = 1` je zaštita od ponovnog pokretanja: drugi prolaz ne
-- sme da pregazi dubinu koju je u međuvremenu upisao `record_scan`. Redovi koji
-- su stvarno plitki ostaju plitki — kod njih je i izračunata vrednost 1.
update search_cache
   set pages = least(3, greatest(1, ceil(last_results_count / 20.0)::int))
 where pages = 1
   and last_results_count > 20;

-- ═══════════════════════════════════════════════════════════
-- 2. NAPLATA PO STRANICI
-- ═══════════════════════════════════════════════════════════
/**
 * Skini onoliko kredita koliko scan ima stranica, i upiši posao — u jednoj
 * transakciji. Nastavak 0009 §5 i 0022 §6; menja se SAMO telo.
 *
 * Tri izmene u odnosu na 0022, sve tri nad novcem:
 *
 *   1. CENA se izvodi iz broja stranica (`v_cena`), ne piše kao `-1`.
 *   2. PROVERA BALANSA je nad zbirom obe kase I nad izvedenom cenom.
 *      `v_balance + v_topup < v_cena`, ne `< 1` — inače bi korisnik sa 1
 *      kreditom pokrenuo „Duboko" i završio na -2.
 *   3. KLJUČ DEDUPLIKACIJE nosi broj stranica: `RS:grad:nisa:p2`.
 *      Bez toga dva korisnika sa različitim dubinama u istoj sekundi dele
 *      jedan posao — plitki „pobedi" (njegov je upisan prvi), a duboki plati
 *      3 kredita za 20 rezultata. Sa dubinom u ključu to su DVA posla i svaki
 *      plaća svoje; provera „da li sam već platio" ostaje tačna jer je i ona
 *      vezana za posao, dakle i za dubinu.
 *
 * `maxResults` u payloadu se NORMALIZUJE na `v_pages * 20`. Worker iz njega
 * računa stranice, pa bi svaka vrednost između (`30` iz starog podrazumevanog
 * argumenta) značila da je plaćeno 2 stranice a skenirano… takođe 2, ali samo
 * slučajno. Ovako su plaćeno i skenirano isti broj po konstrukciji, i
 * skeniranje DUBLJE od plaćenog ne može da nastane.
 *
 * Podrazumevanih `p_max_results = 30` → 2 stranice → 2 kredita, što je
 * „Standardno" i podrazumevani izbor na ekranu. Stari pozivalac bez tog
 * argumenta time dobija podrazumevanu ponudu, ne najjeftiniju i ne najskuplju.
 */
create or replace function spend_credit_and_scan(
  p_user        text,
  p_country     text,
  p_city        text,
  p_niche       text,
  p_max_results integer default 30
)
returns table (
  ok boolean, reason text, job_id bigint, joined boolean,
  charged boolean, credits_left integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance    integer;
  v_topup      integer;
  v_iz_balansa integer;
  -- Ista formula kao `stranicaZaRezultate` u packages/shared/src/plans.ts.
  v_pages      integer := least(3, greatest(1, ceil(coalesce(p_max_results, 30) / 20.0)::int));
  v_cena       integer;
  v_max        integer;
  v_key        text;
  v_live       bigint;
  v_id         bigint;
  v_joined     boolean;
begin
  v_cena := v_pages;                       -- 1 kredit = 1 stranica = 1 poziv
  v_max  := v_pages * 20;                  -- plaćeno i skenirano, isti broj
  v_key  := p_country || ':' || p_city || ':' || p_niche || ':p' || v_pages;

  select p.credits_balance, p.credits_topup into v_balance, v_topup
  from profiles p where p.id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user', null::bigint, false, false, 0; return;
  end if;

  -- Živ posao za istu kombinaciju I ISTU DUBINU. `enqueue_job` bi ga i sam
  -- našao, ali cena mora da se odluči PRE upisa — inače bi provera „da li sam
  -- već platio" tražila job_id koji dobijamo tek posle upisa.
  select q.id into v_live
  from job_queue q
  where q.type = 'scan'
    and q.dedupe_key = v_key
    and q.status in ('pending', 'running')
  order by q.id
  limit 1
  for update;

  if v_live is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'scan' and cl.ref_id = 'scan:' || v_live
  ) then
    -- Dupli klik, osvežena kartica, dva taba — na ISTOJ dubini. Druga dubina je
    -- drugi posao i naplaćuje se, i to je ispravno: to su dva različita
    -- skeniranja i dva različita računa kod Googlea.
    insert into job_subscribers (job_id, user_id) values (v_live, p_user)
    on conflict do nothing;

    return query select true, 'already_paid', v_live, true, false, v_balance + v_topup;
    return;
  end if;

  if v_balance + v_topup < v_cena then
    return query select false, 'insufficient_credits', null::bigint, false, false,
                        v_balance + v_topup;
    return;
  end if;

  select e.job_id, e.joined into v_id, v_joined
  from enqueue_job(
    'scan',
    jsonb_build_object(
      'citySlug', p_city,
      'nicheSlug', p_niche,
      'userId', p_user,
      'countryCode', p_country,
      'maxResults', v_max
    ),
    v_key,
    p_user
  ) e;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, -v_cena, 'scan', 'scan:' || v_id);

  -- Skidanje ide PRVO iz kase koja ističe (0022 §6). `greatest(v_balance, 0)`
  -- nije kozmetika: posle povraćaja paketa balans ume da bude negativan, pa bi
  -- bez ograđivanja skidanje guralo dug dublje umesto da troši ono što postoji.
  v_iz_balansa := least(v_cena, greatest(v_balance, 0));

  update profiles
  set credits_balance = credits_balance - v_iz_balansa,
      credits_topup   = credits_topup - (v_cena - v_iz_balansa)
  where id = p_user;

  -- U `search_cache` se ovde NE dira ništa — v. obrazloženje u 0009 §5.
  return query select true, 'charged', v_id, coalesce(v_joined, false), true,
                      v_balance + v_topup - v_cena;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. POVRAĆAJ VRAĆA TAČAN IZNOS
-- ═══════════════════════════════════════════════════════════
/**
 * Vrati SVIMA koji su platili ovaj posao tačno ono što su platili.
 *
 * Do S17 je vraćalo fiksno `+1` po platiocu, što je bilo tačno dok je i cena
 * bila fiksna. Sada posao naplaćen 3 kredita mora da vrati 3 — a iznos se čita
 * iz `credit_ledger` stavke za taj posao, ne iz `job_queue.payload`:
 *
 *   - knjiga je ono što se STVARNO desilo balansu; payload je ono što je
 *     naručeno, i može da se raziđe (ručna izmena payloada, izmena formule
 *     između naplate i pada posla)
 *   - povraćaj koji čita payload bi posle svake buduće izmene cene vraćao NOVU
 *     cenu za STARU naplatu, i to tiho
 *
 * `sum` po korisniku, a ne prvi red: dupli klik je pokriven `already_paid`
 * granom i druge stavke ne pravi, ali povraćaj ne sme da zavisi od toga.
 *
 * Idempotentno kao i pre: parcijalni indeks `credit_ledger_scan_refund_idx`
 * (0009 §4) je poslednja brana, `not exists` je ona koja ne baca izuzetak.
 * Povraćaj uvek ide u `credits_balance`, bez obzira iz koje je kase skinut —
 * obrazloženje u 0022 §6.
 */
create or replace function refund_scan(p_job_id bigint)
returns table (refunded integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ref    text := 'scan:' || p_job_id;
  v_user   text;
  v_iznos  integer;
  v_count  integer := 0;
begin
  for v_user, v_iznos in
    select cl.user_id, (-sum(cl.delta))::int
    from credit_ledger cl
    where cl.reason = 'scan' and cl.ref_id = v_ref
      and not exists (
        select 1 from credit_ledger r
        where r.user_id = cl.user_id and r.reason = 'refund' and r.ref_id = v_ref
      )
    group by cl.user_id
  loop
    -- Nula ili minus u knjizi nije povraćaj nego greška u knjiženju; preskače
    -- se umesto da se korisniku oduzme kredit „povraćajem".
    if coalesce(v_iznos, 0) <= 0 then
      continue;
    end if;

    -- Zaključavanje reda pre upisa: povraćaj i unlock istog korisnika u istoj
    -- sekundi inače oba čitaju isti balans.
    perform 1 from profiles p where p.id = v_user for update;

    insert into credit_ledger (user_id, delta, reason, ref_id)
      values (v_user, v_iznos, 'refund', v_ref);

    update profiles set credits_balance = credits_balance + v_iznos where id = v_user;
    v_count := v_count + 1;
  end loop;

  -- Vraća BROJ PLATILACA kojima je vraćeno, ne zbir kredita. Tako je bilo i u
  -- 0009 i tako ga worker ispisuje u log („vraćeno 2 kredita" je bilo tačno
  -- samo dok je cena bila 1 — tekst je ispravljen u apps/worker).
  return query select v_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. `record_scan` UPISUJE DUBINU
-- ═══════════════════════════════════════════════════════════
-- Sedmi argument, pa se šestoargumentna verzija iz 0021 drop-uje. `create or
-- replace` bi napravio preopterećenu verziju i svaki poziv bi postao dvosmislen.
--
-- `pages` se upisuje kao dubina POSLEDNJEG scana, isto kao `last_results_count`
-- — ne `greatest` sa zatečenim. Kombinacija skenirana duboko pa ponovo plitko
-- ima 20 svežih redova i 40 starih; tvrditi da je i dalje duboka značilo bi
-- servirati tih 40 kao sveže (pravilo 1).

drop function if exists record_scan(text, text, text, integer, bigint, boolean);

create or replace function record_scan(
  p_country text,
  p_city    text,
  p_niche   text,
  p_count   integer,
  p_job_id  bigint default null,
  p_partial boolean default false,
  p_pages   integer default 1
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stamp   timestamptz := now();
  v_total   integer;
  v_no_site integer;
  v_pages   integer := least(3, greatest(1, coalesce(p_pages, 1)));
begin
  if coalesce(p_count, 0) <= 0 then
    select max(b.google_refreshed_at) into v_stamp
    from businesses b
    where b.country_code = p_country
      and b.city_slug = p_city
      and b.niche_slug = p_niche;

    -- Nema nijednog reda → kombinacija je stvarno prazna i to se pamti od sada.
    v_stamp := coalesce(v_stamp, now());
  end if;

  select count(*) into v_total
  from businesses b
  where b.country_code = p_country
    and b.city_slug = p_city
    and b.niche_slug = p_niche;

  select count(*) into v_no_site
  from businesses b
  left join website_audits wa on wa.place_id = b.place_id
  where b.country_code = p_country
    and b.city_slug = p_city
    and b.niche_slug = p_niche
    and wa.site_status = 'nema_sajt';

  insert into search_cache (country_code, city_slug, niche_slug, last_scanned_at,
                            last_results_count, scan_count, last_job_id,
                            total, no_site, partial, pages)
  values (p_country, p_city, p_niche, v_stamp, greatest(coalesce(p_count, 0), 0), 1,
          p_job_id, v_total, v_no_site, p_partial, v_pages)
  on conflict (country_code, city_slug, niche_slug) do update
    set last_scanned_at = greatest(search_cache.last_scanned_at, excluded.last_scanned_at),
        last_results_count = excluded.last_results_count,
        scan_count = search_cache.scan_count + 1,
        last_job_id = coalesce(excluded.last_job_id, search_cache.last_job_id),
        total = excluded.total,
        no_site = excluded.no_site,
        -- [Faza 6, 6.4] Parcijalan scan ostaje parcijalan do sledećeg PUNOG
        -- scana; `last_scanned_at` se ne pomera unazad, pa se ovaj uslov piše
        -- kao eksplicitna zamena, ne `or`.
        partial = excluded.partial,
        pages = excluded.pages;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. PRAVA NAD IZMENJENIM FUNKCIJAMA
-- ═══════════════════════════════════════════════════════════
-- `record_scan` je dobio nov potpis, pa su prava sa starog otišla sa njim.
-- Ostale dve su zadržale potpis i prava, ali se navode eksplicitno: jeftinije
-- je ponoviti `revoke` nego pretpostaviti.

revoke all on function spend_credit_and_scan(text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function refund_scan(bigint) from public, anon, authenticated;
revoke all on function record_scan(text, text, text, integer, bigint, boolean, integer)
  from public, anon, authenticated;

grant execute on function spend_credit_and_scan(text, text, text, text, integer) to service_role;
grant execute on function refund_scan(bigint) to service_role;
grant execute on function record_scan(text, text, text, integer, bigint, boolean, integer)
  to service_role;
