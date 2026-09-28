-- supabase/migrations/0035_admin_krediti_topup.sql
-- Ručna dodela kredita (konzola i nagrada za utisak) ide u `credits_topup`.
--
-- ── bug ─────────────────────────────────────────────────────
-- `admin_adjust_credits` (0030) i `grant_credits` za razlog `feedback` (0026)
-- dodavali su u `credits_balance`. To je kasa koja ističe:
--   · nalog `plan = 'dopuna'` vidi kredite u brojaču, ali `stanjePristupa`
--     (`packages/shared/src/pristup.ts`, grana 3) otvara pristup samo po
--     `credits_topup` — traka „nemaš kredita", otključavanje vodi na /cenovnik;
--   · pretplatniku ih briše sledeći `invoice.paid`, jer `grant_monthly_credits`
--     POSTAVLJA balans na iznos plana (0004, 0030).
-- Poklonjen kredit nije deo mesečne dodele, pa pripada kasi koja ne ističe —
-- istoj u koju idu paket i krediti dobrodošlice (0026 §2).
--
-- ── pravilo za `p_kind = 'korekcija'` ───────────────────────
--   · `+n` → uvek `credits_topup`, za svaki plan.
--   · `−n` → istim redosledom kao trošenje (`spend_credit_and_unlock`, 0029):
--     prvo pozitivan deo `credits_balance`, ostatak iz `credits_topup`. Nijedna
--     kolona ne ide ispod nule; ako obe zajedno nemaju dovoljno, odbija se
--     ('balans bi bio negativan'). Dug iz vraćenog novca (balans < 0) se ne
--     produbljuje i ne pokriva — ostaje kakav jeste.
--   · `balance` u povratnom redu je od sada ZBIR obe kase: to je broj koji
--     korisnik vidi u brojaču, a konzola ga piše u poruku posle izmene.
--   · revizija dobija `kasa`: 'topup' | 'balance' | 'oba'. Treća vrednost postoji
--     jer oduzimanje može da pređe granicu kasa; tada `iz_balansa` i `iz_dopune`
--     kažu koliko iz koje.
--
-- ── `p_kind = 'povracaj'` se NE menja ───────────────────────
-- Od 0032 vraćen novac ide kroz `apply_refund`; ova grana ostaje za konzolu i
-- zadržava telo iz 0030 (samo balans, pod −1000, `balance` = `credits_balance`).
-- Jedina razlika: revizija dobija `kasa = 'balance'`.
--
-- ── `balance_after` ─────────────────────────────────────────
-- Ostaje `null` za razlog `admin`. Kolona znači „stanje kase koja ističe posle
-- MESEČNE dodele" (0030) i piše je samo `grant_monthly_credits`; `apply_refund`
-- ga ne čita (0032). Upis ovde bi izmislio drugo značenje iste kolone.
--
-- ── nagrada za utisak ───────────────────────────────────────
-- `grant_feedback_credits` (0011) ne ide kroz `admin_adjust_credits` nego kroz
-- `grant_credits(…, 'feedback', 'fb:<id>')` — i +10 za bug iz konzole i +1 za
-- utisak. Isti bug, pa ista kasa: razlog `feedback` ide u `credits_topup`. Uz
-- njega i `admin`, da razlog `admin` u knjizi uvek znači istu kasu bez obzira
-- na to koja ga je funkcija upisala (danas `grant_credits('admin')` niko ne
-- zove, ali potpis ga prima).
--
-- Postojeća stanja se NE prebacuju retroaktivno; upit za pogođene naloge je u
-- dnevniku isporuka (0035).
--
-- Idempotentna: obe funkcije `create or replace` sa nepromenjenim potpisom i
-- povratnim oblikom.

-- ═══════════════════════════════════════════════════════════
-- 1. grant_credits — `feedback` i `admin` u kasu koja ne ističe
-- ═══════════════════════════════════════════════════════════
-- Telo iz 0026 §2, izmenjena je samo lista razloga u grani koja bira kasu.
create or replace function grant_credits(
  p_user text, p_amount integer, p_reason text, p_ref_id text default null
)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_amount <= 0 then return query select false, 'invalid_amount'; return; end if;
  if p_reason not in (
    'monthly_grant', 'admin', 'refund', 'feedback', 'subscription_grant',
    'credit_pack', 'onboarding', 'trial_grant', 'komp_grant'
  ) then return query select false, 'invalid_reason'; return; end if;

  perform 1 from profiles where id = p_user for update;
  if not found then return query select false, 'no_user'; return; end if;

  if p_ref_id is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = p_reason and cl.ref_id = p_ref_id
  ) then return query select true, 'already_granted'; return; end if;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, p_amount, p_reason, p_ref_id);

  -- [0026] `onboarding` uz `credit_pack`: kasa koja ne ističe je jedina koja
  -- otvara pristup nalogu bez plana (§1.5, O1).
  -- [0035] + `feedback` i `admin`: poklon ne sme da nestane na `invoice.paid`.
  if p_reason in ('credit_pack', 'onboarding', 'feedback', 'admin') then
    update profiles set credits_topup = credits_topup + p_amount where id = p_user;
  else
    update profiles set credits_balance = credits_balance + p_amount where id = p_user;
  end if;
  return query select true, 'granted';
end $$;

-- ═══════════════════════════════════════════════════════════
-- 2. admin_adjust_credits — korekcija po kasama
-- ═══════════════════════════════════════════════════════════
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
  v_balance    integer;
  v_topup      integer;
  v_delta      integer := p_delta;
  v_iz_balansa integer := 0;
  v_iz_dopune  integer := 0;
  v_kasa       text;
  -- Isti broj kao `profiles_credits_nonneg` (0022 §1).
  v_pod        constant integer := -1000;
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

  -- [0035] Dug u balansu se ne računa kao kredit koji se može oduzeti.
  if p_kind = 'korekcija' and greatest(v_balance, 0) + v_topup + p_delta < 0 then
    return query select false, 'balans bi bio negativan'::text, v_balance + v_topup; return;
  end if;

  if p_ref_id is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'admin' and cl.ref_id = p_ref_id
  ) then
    return query select true, 'already_applied'::text,
                        case when p_kind = 'korekcija' then v_balance + v_topup else v_balance end;
    return;
  end if;

  -- ── korekcija ──────────────────────────────────────────────
  if p_kind = 'korekcija' then
    if p_delta > 0 then
      v_iz_dopune := p_delta;
      v_kasa := 'topup';
    else
      v_iz_balansa := least(-p_delta, greatest(v_balance, 0));
      v_iz_dopune  := -p_delta - v_iz_balansa;
      v_kasa := case when v_iz_dopune = 0 then 'balance'
                     when v_iz_balansa = 0 then 'topup'
                     else 'oba' end;
      v_iz_balansa := -v_iz_balansa;
      v_iz_dopune  := -v_iz_dopune;
    end if;

    insert into credit_ledger (user_id, delta, reason, ref_id)
      values (p_user, p_delta, 'admin', p_ref_id);

    update profiles
       set credits_balance = credits_balance + v_iz_balansa,
           credits_topup   = credits_topup + v_iz_dopune
     where id = p_user
    returning credits_balance, credits_topup into v_balance, v_topup;

    insert into admin_audit (actor_id, action, target_user, target_ref, payload)
      values (p_actor, 'credits.adjust', p_user, p_ref_id,
              case when v_kasa = 'oba'
                then jsonb_build_object('delta', p_delta, 'note', p_note, 'kind', p_kind,
                                        'kasa', v_kasa, 'iz_balansa', v_iz_balansa,
                                        'iz_dopune', v_iz_dopune)
                else jsonb_build_object('delta', p_delta, 'note', p_note, 'kind', p_kind,
                                        'kasa', v_kasa)
              end);

    return query select true, 'ok'::text, v_balance + v_topup;
    return;
  end if;

  -- ── povraćaj: telo iz 0030, samo balans ──────────────────
  -- [0030] Povraćaj ne probija pod.
  if v_balance + p_delta < v_pod then
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
                                   'kind', p_kind, 'pod', v_pod, 'kasa', 'balance'));
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
              then jsonb_build_object('delta', v_delta, 'note', p_note, 'kind', p_kind,
                                      'kasa', 'balance')
              else jsonb_build_object('delta', v_delta, 'trazeno', p_delta, 'note', p_note,
                                      'kind', p_kind, 'pod', v_pod, 'kasa', 'balance')
            end);

  return query select true,
                      (case when v_delta = p_delta then 'ok' else 'odseceno' end)::text,
                      v_balance;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. PRAVA
-- ═══════════════════════════════════════════════════════════
revoke all on function grant_credits(text, integer, text, text) from public, anon, authenticated;
revoke all on function admin_adjust_credits(text, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function grant_credits(text, integer, text, text) to service_role;
grant execute on function admin_adjust_credits(text, text, integer, text, text, text) to service_role;
