-- supabase/migrations/0030_povracaj_po_dodeli.sql
-- Povraćaj pretplatne fakture skida CELU mesečnu dodelu te fakture, ne deltu;
-- i povraćaj više ne probija donji prag balansa.
--
-- ── zašto ne delta ──────────────────────────────────────────
-- `grant_monthly_credits` POSTAVLJA balans (0004), pa je delta u knjizi
-- `target − balans_pre`. Kod downgrade-a je negativna (600 → 150 daje −450), a
-- povraćaj „onoga što je red dodelio" tada ne skida ništa: korisnik zadržava
-- 150 kredita za mesec za koji mu je novac vraćen. Kod probe (10 → 450, delta
-- 440) povraćaj bi vratio 10 probnih kredita koje je dodela već pregazila.
--
-- Jedno pravilo za rast, pad i probu: vraćen novac znači da krediti tog meseca
-- ne postoje. Iznos meseca je `target` — a njega knjiga do sada nije pamtila.
-- Nije ga smela ni izračunati iz `plans.ts` u trenutku povraćaja: katalog se
-- menja, faktura ne.
--
-- ── `balance_after` ─────────────────────────────────────────
-- Stanje kase koja ističe POSLE te stavke. Upisuje ga samo `grant_monthly_credits`
-- (tu je to baš `target`); ostali razlozi ga ostavljaju prazno. Stari redovi
-- ostaju `null` i povraćaj za njih radi po starom pravilu, `max(delta, 0)`
-- (`billing.ts`, `zaPovracaj`).
--
-- ── pod na povraćaju ────────────────────────────────────────
-- `profiles_credits_nonneg` (0022) drži `credits_balance >= -1000`. Advanced daje
-- 1.200; povraćaj potrošenog meseca je udarao u ograničenje, RPC je pucao, ruta
-- vraćala 500, a Stripe ponavljao tri dana — bez ijednog skinutog kredita posle
-- drugog komada. Sada se komad koji bi probio pod odseca na pod, a ono što nije
-- skinuto ostaje zapisano u `admin_audit.payload` (`trazeno` / `delta`).
-- Obična korekcija se ne menja: ona ionako ne sme ispod nule.
--
-- Idempotentna: `add column if not exists`, obe funkcije `create or replace` sa
-- nepromenjenim potpisom i povratnim oblikom.

-- ═══════════════════════════════════════════════════════════
-- 1. KNJIGA PAMTI STANJE POSLE MESEČNE DODELE
-- ═══════════════════════════════════════════════════════════
alter table credit_ledger add column if not exists balance_after integer;

-- ═══════════════════════════════════════════════════════════
-- 2. grant_monthly_credits — telo iz 0004 + `balance_after`
-- ═══════════════════════════════════════════════════════════
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
    return query select false, 'missing_ref_id', 0; return;
  end if;

  -- Balans se čita pod istim zaključavanjem pod kojim se upisuje.
  select credits_balance into v_balance
  from profiles where id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user', 0; return;
  end if;

  if exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'monthly_grant' and cl.ref_id = p_ref_id
  ) then
    return query select true, 'already_granted', 0; return;
  end if;

  v_delta := p_target - v_balance;

  insert into credit_ledger (user_id, delta, reason, ref_id, balance_after)
    values (p_user, v_delta, 'monthly_grant', p_ref_id, p_target);
  update profiles set credits_balance = p_target where id = p_user;

  return query select true, 'granted', v_delta;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. admin_adjust_credits — telo iz 0022 + pod na povraćaju
-- ═══════════════════════════════════════════════════════════
-- Novi ishodi, samo za `p_kind = 'povracaj'`:
--   'odseceno'  skinuto manje od traženog, balans je tačno na podu
--   'na_podu'   balans je već na podu; knjiga bez reda (nula ne sme u
--               `credit_ledger`), revizija sa `delta = 0`
create or replace function admin_adjust_credits(
  p_actor  text,
  p_user   text,
  p_delta  integer,
  p_note   text,
  p_ref_id text,
  p_kind   text default 'korekcija'
)
returns table (ok boolean, reason text, balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
  v_topup   integer;
  v_delta   integer := p_delta;
  -- Isti broj kao `profiles_credits_nonneg` (0022 §1).
  v_pod     constant integer := -1000;
begin
  if p_delta = 0 then
    return query select false, 'invalid_amount'::text, null::integer; return;
  end if;

  if abs(p_delta) > 500 then
    return query select false, 'iznos van granica'::text, null::integer; return;
  end if;

  if p_kind not in ('korekcija', 'povracaj') then
    return query select false, 'nepoznata vrsta'::text, null::integer; return;
  end if;

  select p.credits_balance, p.credits_topup into v_balance, v_topup
  from profiles p where p.id = p_user for update;
  if not found then
    return query select false, 'no_user'::text, null::integer; return;
  end if;

  if p_kind = 'korekcija' and v_balance + v_topup + p_delta < 0 then
    return query select false, 'balans bi bio negativan'::text, v_balance; return;
  end if;

  if p_ref_id is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'admin' and cl.ref_id = p_ref_id
  ) then
    return query select true, 'already_applied'::text, v_balance; return;
  end if;

  -- [0030] Povraćaj ne probija pod.
  if p_kind = 'povracaj' and v_balance + p_delta < v_pod then
    v_delta := least(0, v_pod - v_balance);

    if v_delta = 0 then
      -- Red u knjizi ne postoji, pa je revizija jedini trag i jedina brana od
      -- ponovljene isporuke istog komada.
      if p_ref_id is not null and exists (
        select 1 from admin_audit a
        where a.target_user = p_user and a.target_ref = p_ref_id and a.action = 'credits.adjust'
      ) then
        return query select true, 'already_applied'::text, v_balance; return;
      end if;

      insert into admin_audit (actor_id, action, target_user, target_ref, payload)
        values (p_actor, 'credits.adjust', p_user, p_ref_id,
                jsonb_build_object('delta', 0, 'trazeno', p_delta, 'note', p_note,
                                   'kind', p_kind, 'pod', v_pod));
      return query select true, 'na_podu'::text, v_balance; return;
    end if;
  end if;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, v_delta, 'admin', p_ref_id);

  update profiles set credits_balance = credits_balance + v_delta where id = p_user
    returning credits_balance into v_balance;

  insert into admin_audit (actor_id, action, target_user, target_ref, payload)
    values (p_actor, 'credits.adjust', p_user, p_ref_id,
            case when v_delta = p_delta
              then jsonb_build_object('delta', v_delta, 'note', p_note, 'kind', p_kind)
              else jsonb_build_object('delta', v_delta, 'trazeno', p_delta, 'note', p_note,
                                      'kind', p_kind, 'pod', v_pod)
            end);

  return query select true,
                      (case when v_delta = p_delta then 'ok' else 'odseceno' end)::text,
                      v_balance;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. PRAVA
-- ═══════════════════════════════════════════════════════════
revoke all on function grant_monthly_credits(text, integer, text) from public, anon, authenticated;
revoke all on function admin_adjust_credits(text, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function grant_monthly_credits(text, integer, text) to service_role;
grant execute on function admin_adjust_credits(text, text, integer, text, text, text) to service_role;
