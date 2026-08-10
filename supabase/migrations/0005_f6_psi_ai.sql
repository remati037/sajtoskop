-- 0005_f6_psi_ai.sql — F6: PageSpeed skor i Claude vision analiza
--
-- Izvor: docs/F6-psi-ai.md, sekcije 1, 2 i 3.
--
-- Dve stvari:
--   1. `psi_lcp_ms` — jedina Lighthouse metrika koju čuvamo pored skora (§1).
--      Ceo izveštaj su megabajti po sajtu i namerno se baca.
--   2. `consume_side_call()` — brojač za API-je koji NISU Google Places.
--
-- ── zašto PSI i Claude ne smeju kroz `consume_api_call` ───────────────────
-- `consume_api_call` inkrementira `api_budget.calls`, a to je brojač nad kojim
-- stoji Googleov mesečni cap od 1.000 poziva (CLAUDE.md, sekcija Budžet).
-- Kad bi PSI išao kroz njega, jedan otključan lead bi trošio kvotu za Places
-- pretragu koju taj poziv uopšte ne dodiruje — i mesečni budžet bi pao na pola
-- pre nego što iko odradi trideseti scan.
--
-- PSI ima svoju kvotu (25.000/dan uz ključ), Anthropic ima svoj račun. Zato ovi
-- pozivi ulaze SAMO u `by_kind` mapu, sa zasebnim dnevnim capom po ključu, a
-- `calls` ostaje netaknut. PRD §1: „brojač mu ipak dodaj, da ne otkrivaš problem
-- tek kad počne da vraća 429".

-- ═══════════════════════════════════════════════════════════
-- 1. ŠEMA
-- ═══════════════════════════════════════════════════════════

-- Largest Contentful Paint u milisekundama. Skor je ocena, LCP je rečenica koju
-- vlasnik razume: „sajt ti se otvara 8 sekundi na telefonu".
alter table website_audits add column if not exists psi_lcp_ms integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'website_audits_psi_lcp_nonneg'
  ) then
    alter table website_audits add constraint website_audits_psi_lcp_nonneg
      check (psi_lcp_ms is null or psi_lcp_ms >= 0);
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. BROJAČ ZA NE-GOOGLE POZIVE
-- ═══════════════════════════════════════════════════════════

/**
 * Rezerviše JEDAN poziv ka API-ju koji nije Places. Zove se neposredno pre
 * HTTP zahteva, isto kao `consume_api_call`.
 *
 * Razlika je namerna i jedina bitna: ovde se `api_budget.calls` NE dira.
 * Menja se samo `by_kind[p_kind]`, i cap se proverava nad tim brojem.
 * Googleov mesečni prag ostaje rezervisan za Places.
 *
 * `exhausted_at` se takođe ignoriše: to je katanac koji postavlja Googleov 429
 * i nema nikakve veze sa tim da li Anthropic prima pozive.
 *
 * Vraća `ok = false` umesto izuzetka — pozivalac odlučuje da li preskače korak
 * (PRD §3: iznad capa `enrich_full` ostavlja `audit_level = 2`) ili odlaže posao.
 */
create or replace function consume_side_call(
  p_kind      text,
  p_daily_cap integer
)
returns table (
  ok          boolean,
  reason      text,     -- consumed | daily_cap
  pt_day      date,
  kind_calls  integer,
  retry_after timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day   date := budget_day();
  v_month text;
  v_calls integer;
begin
  if p_kind is null or btrim(p_kind) = '' then
    raise exception 'consume_side_call: prazan ključ';
  end if;

  -- Tvrda ograda oko troškovnog modela: sve što je Places mora kroz
  -- `consume_api_call`, jer samo on diže `calls` nad kojim stoji mesečni cap.
  -- Bez ove provere bi jedan tipfeler u imenu ključa tiho izbacio Places poziv
  -- iz budžeta koji ga jedini čuva.
  if p_kind like 'places:%' then
    raise exception 'consume_side_call: % je Places poziv i ide kroz consume_api_call', p_kind;
  end if;

  if p_daily_cap is null or p_daily_cap < 0 then
    raise exception 'consume_side_call: nevalidan cap %', p_daily_cap;
  end if;

  v_month := budget_month(v_day);

  insert into api_budget (day, month) values (v_day, v_month)
  on conflict (day) do nothing;

  -- Zaključava tačno jedan red (današnji), za razliku od `consume_api_call`
  -- koji zaključava ceo mesec — ovde nema mesečnog zbira koji bi trebalo štititi.
  select coalesce((api_budget.by_kind ->> p_kind)::integer, 0)
  into v_calls
  from api_budget
  where api_budget.day = v_day
  for update;

  if v_calls >= p_daily_cap then
    return query select false, 'daily_cap', v_day, v_calls, budget_next_day_reset(v_day);
    return;
  end if;

  update api_budget
  set by_kind = api_budget.by_kind || jsonb_build_object(p_kind, v_calls + 1)
  where api_budget.day = v_day;

  return query select true, 'consumed', v_day, v_calls + 1, null::timestamptz;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. PRAVA
-- ═══════════════════════════════════════════════════════════
-- Isto obrazloženje kao u 0002 §5: `security definer` je po difoltu izvršiv za
-- `public`, a ova funkcija čuva moj Anthropic račun. Bilo ko sa anon ključem bi
-- je preko PostgREST-a mogao pozvati u petlji i pojesti dnevni cap za sve.

revoke all on function consume_side_call(text, integer) from public, anon, authenticated;
grant execute on function consume_side_call(text, integer) to service_role;
