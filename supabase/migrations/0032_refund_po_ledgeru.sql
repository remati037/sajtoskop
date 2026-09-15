-- supabase/migrations/0032_refund_po_ledgeru.sql
-- Povraćaj novca skida TAČNO ono što je vraćena transakcija upisala u knjigu —
-- jednim redom, razlogom `povracaj`, bez gornje granice iznosa.
--
-- ── šta je bilo pogrešno ────────────────────────────────────
-- Sandbox, `ch_3UG3e1…`: nalog na Pro sa 450 kredita (+200 dopune), upgrade na
-- Advanced usred perioda, proraciona faktura €59.41 → `monthly_grant +750`,
-- balans 1200. Pun refund te naplate je dao:
--   admin −500  povracaj:ch_3UG3e1…
--   admin −500  povracaj:ch_3UG3e1…#2
--   admin −200  povracaj:ch_3UG3e1…#3
-- dakle −1200 i balans 2, a vraćena transakcija je dodala 750. Tri greške:
--   1. iznos je bio `balance_after` (0030) — ceo mesec, a ne ono što je red dodao;
--      kod proracije iznos u parama i broj kredita nisu u srazmeri, pa „mesec"
--      nije ono što je plaćeno;
--   2. `admin_adjust_credits` ima `abs(p_delta) <= 500`, pa se povraćaj delio na
--      komade sa `#N` sufiksom — unique indeks više nije mogao da prepozna ceo
--      povraćaj kao jednu radnju;
--   3. razlog `admin`, iako povraćaj nije ručna izmena iz konzole.
--
-- ── pravilo od 0032 ─────────────────────────────────────────
-- Iznos računa `billing.ts` (`dodeljenoZaTransakciju`) iz sume `delta` redova
-- knjige pod `in_…` / `pi_…` te naplate — nikad iz `plans.ts`, nikad iz
-- `balance_after`. Nema redova → nema povraćaja. Delimičan refund: srazmerno,
-- zaokruženo nadole. Ova funkcija samo SPROVODI iznos koji dobije:
--   · jedan red, `reason = 'povracaj'`, `ref_id` tačno kako je poslat
--     (`povracaj:<ch_…>` ili `spor:<dp_…>`), bez sufiksa;
--   · ponovljen isti ref → `already_applied` sa već skinutim iznosom, bez reda;
--   · bez granice od 500 — povraćaj nije admin korekcija.
--
-- ── kase ────────────────────────────────────────────────────
-- `p_kasa = 'balance'` (pretplata): samo `credits_balance`; dopuna se ne dira.
-- `p_kasa = 'topup'` (paket): iz `credits_topup`. Dopuna je na tvrdoj nuli
-- (`profiles_topup_nonneg`, 0022), pa ako je deo paketa potrošen, ostatak ide u
-- `credits_balance` kao dug — isto obrazloženje kao 0022 (Z3): inače kupac
-- zadržava i novac i posao.
--
-- ── pod ─────────────────────────────────────────────────────
-- `profiles_credits_nonneg` drži `credits_balance >= -1000`. Deo koji bi probio
-- pod se odseca (`odseceno`), traženo i skinuto ostaju u `credit_ledger.details`.
-- Ako se ne može skinuti ništa (`na_podu`), red ne nastaje: `delta <> 0` (0001).
--
-- `admin_adjust_credits` ostaje nepromenjen — i dalje služi konzoli.
-- `credit_ledger.balance_after` ostaje: `grant_monthly_credits` ga i dalje piše,
-- ali povraćaj ga više ne čita.
--
-- Idempotentna: `add column if not exists`, `drop constraint/index if exists`,
-- `create or replace` za novu funkciju.

-- ═══════════════════════════════════════════════════════════
-- 1. RAZLOG `povracaj` + DETALJI REDA
-- ═══════════════════════════════════════════════════════════
alter table credit_ledger add column if not exists details jsonb;

comment on column credit_ledger.details is
  'Kontekst stavke koji ne staje u ref_id. Za povracaj: naplata, srazmera refunda, traženo i skinuto po kasi.';

alter table credit_ledger drop constraint if exists credit_ledger_reason_valid;
alter table credit_ledger add  constraint credit_ledger_reason_valid check (
  reason in (
    'unlock', 'scan', 'monthly_grant', 'admin', 'refund', 'feedback',
    'subscription_grant', 'credit_pack', 'onboarding', 'beta_grant',
    'trial_grant', 'komp_grant', 'expire', 'povracaj'
  )
);

-- `povracaj` ulazi u isti parcijalni unique indeks: Stripe retry istog refunda
-- pada na (user_id, 'povracaj', 'povracaj:<ch_…>') i kad RPC pozove neko mimo
-- aplikacije.
drop index if exists credit_ledger_grant_idem_idx;
create unique index credit_ledger_grant_idem_idx
  on credit_ledger (user_id, reason, ref_id)
  where ref_id is not null and reason in (
    'monthly_grant', 'admin', 'feedback', 'subscription_grant', 'credit_pack',
    'onboarding', 'beta_grant', 'trial_grant', 'komp_grant', 'expire', 'povracaj'
  );

-- ═══════════════════════════════════════════════════════════
-- 2. apply_refund
-- ═══════════════════════════════════════════════════════════
-- Ishodi:
--   'applied'          skinut ceo traženi iznos
--   'odseceno'         skinuto manje, `credits_balance` je tačno na podu
--   'na_podu'          ništa nije moglo da se skine; bez reda u knjizi
--   'already_applied'  red sa ovim ref-om postoji; `delta` je ono što je tada skinuto
create or replace function apply_refund(
  p_user    text,
  p_ref_id  text,
  p_amount  integer,
  p_kasa    text,
  p_details jsonb default null
)
returns table (ok boolean, reason text, delta integer, balance integer, topup integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance    integer;
  v_topup      integer;
  v_postojeci  integer;
  v_iz_dopune  integer := 0;
  v_iz_balansa integer;
  v_ukupno     integer;
  -- Isti broj kao `profiles_credits_nonneg` (0022 §1).
  v_pod        constant integer := -1000;
begin
  if p_amount is null or p_amount <= 0 then
    return query select false, 'invalid_amount'::text, 0, null::integer, null::integer; return;
  end if;
  if p_ref_id is null or p_ref_id = '' then
    return query select false, 'missing_ref_id'::text, 0, null::integer, null::integer; return;
  end if;
  if p_kasa is null or p_kasa not in ('balance', 'topup') then
    return query select false, 'invalid_kasa'::text, 0, null::integer, null::integer; return;
  end if;

  select p.credits_balance, p.credits_topup into v_balance, v_topup
  from profiles p where p.id = p_user for update;
  if not found then
    return query select false, 'no_user'::text, 0, null::integer, null::integer; return;
  end if;

  select cl.delta into v_postojeci
  from credit_ledger cl
  where cl.user_id = p_user and cl.reason = 'povracaj' and cl.ref_id = p_ref_id;
  if found then
    return query select true, 'already_applied'::text, v_postojeci, v_balance, v_topup; return;
  end if;

  if p_kasa = 'topup' then
    v_iz_dopune := least(p_amount, greatest(v_topup, 0));
  end if;

  v_iz_balansa := least(p_amount - v_iz_dopune, greatest(v_balance - v_pod, 0));
  v_ukupno     := v_iz_dopune + v_iz_balansa;

  if v_ukupno = 0 then
    return query select true, 'na_podu'::text, 0, v_balance, v_topup; return;
  end if;

  insert into credit_ledger (user_id, delta, reason, ref_id, details)
    values (p_user, -v_ukupno, 'povracaj', p_ref_id,
            coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
              'trazeno', p_amount,
              'kasa', p_kasa,
              'iz_dopune', v_iz_dopune,
              'iz_balansa', v_iz_balansa
            ) || case when v_ukupno < p_amount
                   then jsonb_build_object('pod', v_pod)
                   else '{}'::jsonb end);

  update profiles
     set credits_topup   = credits_topup - v_iz_dopune,
         credits_balance = credits_balance - v_iz_balansa
   where id = p_user
  returning credits_balance, credits_topup into v_balance, v_topup;

  return query select true,
                      (case when v_ukupno = p_amount then 'applied' else 'odseceno' end)::text,
                      -v_ukupno, v_balance, v_topup;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. PRAVA
-- ═══════════════════════════════════════════════════════════
revoke all on function apply_refund(text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function apply_refund(text, text, integer, text, jsonb) to service_role;
