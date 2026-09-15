-- supabase/migrations/0033_povracaj_po_refundu.sql
-- `apply_refund` dobija vidljivost: kad povraćaj paketa prelije dug iz dopune u
-- balans, o tome ostaje red u reviziji. Ponašanje je nepromenjeno.
--
-- ── zašto ───────────────────────────────────────────────────
-- Dopuna je na tvrdoj nuli (`profiles_topup_nonneg`, 0022). Ako je deo paketa
-- potrošen, refund skine koliko ima iz dopune, a ostatak ide u `credits_balance`
-- kao dug. Do sada je jedini trag bio `credit_ledger.details` jednog reda
-- `povracaj`, pa se negativan balans kod kupca pojavljivao bez očiglednog
-- izvora. Sada isti podatak stoji i u `admin_audit` (`refund_preliv`), tamo gde
-- se i traži „ko je i zašto dirao ovaj nalog".
--
-- Red se piše SAMO kad preliva stvarno ima (`p_kasa = 'topup'` i
-- `v_iz_balansa > 0`). Refund pretplate ionako ide iz balansa i nije preliv, pa
-- bi red po svakom takvom refundu bio šum, ne trag.
--
-- `actor_id` je `null` — isti obrazac kao Clerk webhook i kao povraćaj do 0030:
-- `admin_audit.actor_id` je strani ključ ka `profiles`, a „stripe-webhook" nije
-- nalog. `null` aktor se u reviziji čita kao „nije iz konzole", što je tačno.
-- `admin_audit.action` nema `check` listu, pa nova vrednost ne traži izmenu šeme.
--
-- ── ref_id je od 0033 ID REFUNDA ────────────────────────────
-- Ključ idempotencije je `povracaj:<re_…>`, ne `povracaj:<ch_…>`. Stripe retry
-- iste isporuke nosi isti `re_…` i pada na unique indeks; dva različita
-- delimična refunda iste naplate su dva različita `re_…` i oba prolaze, svaki sa
-- svojim iznosom. Sama funkcija ref ne tumači — bira ga `billing.ts` — pa ovde
-- nema izmene osim komentara.
--
-- Idempotentna: `create or replace` sa nepromenjenim potpisom i povratnim
-- oblikom (0032 §2).

-- ═══════════════════════════════════════════════════════════
-- 1. apply_refund — telo iz 0032 + revizija preliva
-- ═══════════════════════════════════════════════════════════
-- Ishodi su isti:
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

  -- [0033] Preliv paketa u balans — jedini put kojim refund paketa pravi dug u
  -- kasi koja ističe. Bez ovog reda se negativan balans vidi, ali se ne zna odakle.
  if p_kasa = 'topup' and v_iz_balansa > 0 then
    insert into admin_audit (actor_id, action, target_user, target_ref, payload)
      values (null, 'refund_preliv', p_user, p_ref_id,
              jsonb_build_object(
                'trazeno', p_amount,
                'iz_dopune', v_iz_dopune,
                'iz_balansa', v_iz_balansa,
                'skinuto', v_ukupno,
                'balans_posle', v_balance,
                'dopuna_posle', v_topup
              ));
  end if;

  return query select true,
                      (case when v_ukupno = p_amount then 'applied' else 'odseceno' end)::text,
                      -v_ukupno, v_balance, v_topup;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. PRAVA
-- ═══════════════════════════════════════════════════════════
revoke all on function apply_refund(text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function apply_refund(text, text, integer, text, jsonb) to service_role;
