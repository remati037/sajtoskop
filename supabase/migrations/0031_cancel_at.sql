-- supabase/migrations/0031_cancel_at.sql
-- Otkaz pretplate se čita iz `subscription.cancel_at`, ne iz
-- `cancel_at_period_end`.
--
-- ── zašto ───────────────────────────────────────────────────
-- Na pinovanoj verziji `2026-08-26.dahlia` Customer Portal otkaz na kraju
-- perioda predstavlja kao `cancel_at = current_period_end`, a
-- `cancel_at_period_end` ostavlja `false`. Potvrđeno na živom objektu u
-- sandboxu (`sub_1UFw0zLPkOiFcSNRrTPOUmb7`, događaj `evt_1UG3hv…`):
--   cancel_at 1792073219 (= current_period_end), cancel_at_period_end false,
--   canceled_at 1789506962 (trenutak klika), status active.
-- Mapper je čitao samo staro polje, pa je `subscriptions.cancel_at_period_end`
-- ostajao `false` i `/krediti` nije pokazivao `otkazan`.
--
-- ── šta se menja ────────────────────────────────────────────
--   · `subscriptions.cancel_at` — sirova Stripe vrednost, izvor istine.
--     `cancel_at_period_end` ostaje, ali je od sada IZVEDEN u `billing.ts`
--     (`otkazKrajemPerioda`): `cancel_at_period_end === true` (stariji objekti)
--     ili `cancel_at <= current_period_end`. Baza ga samo upisuje — računica je
--     jedna, u TS-u, gde je i test.
--   · `apply_subscription` dobija `p_cancel_at` (default `null`, poslednji) i
--     upisuje ga BEZ `coalesce`: reaktivacija (portal → Renew) šalje
--     `cancel_at: null` i to mora da obriše staru vrednost.
--   · `admin_users_page` vraća `sub_cancel_at`: kolona „stanje" u konzoli mora
--     da računa isto što i kapija, a kapija od sada čita `cancel_at`.
--
-- `canceled_at` se i dalje upisuje, ali NIŠTA iz njega ne zaključuje stanje:
-- Stripe ga postavlja već pri ZAKAZIVANJU otkaza, dok je status još `active`.
-- Jedini izvor za „pretplata ne radi" je `status`.
--
-- ── redosled deploya ────────────────────────────────────────
-- Migracija ide pre koda. Stari kod zove `apply_subscription` imenovanim
-- argumentima bez `p_cancel_at` i pogađa novu funkciju preko defaulta; stari
-- 13-argumentni potpis se briše da PostgREST ne bi imao dva kandidata.
--
-- Idempotentna: `add column if not exists`, obe funkcije `drop if exists` +
-- `create or replace` (obrazac iz 0025 §7 — `create or replace` ne sme da menja
-- potpis ni listu izlaznih kolona).

-- ═══════════════════════════════════════════════════════════
-- 1. KOLONA
-- ═══════════════════════════════════════════════════════════
alter table subscriptions add column if not exists cancel_at timestamptz;

comment on column subscriptions.cancel_at is
  'Stripe subscription.cancel_at — izvor istine za zakazan otkaz. cancel_at_period_end je izveden iz njega (billing.ts).';

-- ═══════════════════════════════════════════════════════════
-- 2. apply_subscription — telo iz 0025 + `p_cancel_at`
-- ═══════════════════════════════════════════════════════════
drop function if exists apply_subscription(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,text);

create or replace function apply_subscription(
  p_user            text,
  p_subscription_id text,
  p_customer_id     text,
  p_status          text,
  p_plan            text,
  p_ciklus          text,
  p_lookup_key      text,
  p_period_end      timestamptz,
  p_trial_end       timestamptz,
  p_cancel_at_end   boolean,
  p_canceled_at     timestamptz,
  p_event_created   timestamptz,
  p_country         text default null,
  p_cancel_at       timestamptz default null
)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev_updated timestamptz;
begin
  if p_subscription_id is null or p_subscription_id = '' then
    return query select false, 'missing_subscription_id'; return;
  end if;
  if p_status not in ('trialing','active','past_due','canceled','unpaid',
                      'incomplete','incomplete_expired','paused') then
    return query select false, 'invalid_status'; return;
  end if;
  if p_plan is not null and p_plan not in ('starter','pro','advanced') then
    return query select false, 'invalid_plan'; return;
  end if;

  perform 1 from profiles where id = p_user for update;
  if not found then return query select false, 'no_user'; return; end if;

  -- Redosled događaja (§6.4): stariji `subscription.updated` koji stigne
  -- posle novijeg ne sme da vrati stanje unazad. `updated_at` čuva
  -- `event.created` poslednjeg PRIMENJENOG događaja.
  select s.updated_at into v_prev_updated
  from subscriptions s where s.stripe_subscription_id = p_subscription_id;
  if v_prev_updated is not null and p_event_created < v_prev_updated then
    return query select true, 'stale_ignored'; return;
  end if;

  insert into subscriptions (
    stripe_subscription_id, user_id, stripe_customer_id, status, plan, ciklus,
    lookup_key, current_period_end, trial_end, cancel_at_period_end, cancel_at,
    canceled_at, country_code, updated_at
  ) values (
    p_subscription_id, p_user, p_customer_id, p_status, p_plan, p_ciklus,
    p_lookup_key, p_period_end, p_trial_end, coalesce(p_cancel_at_end, false),
    p_cancel_at, p_canceled_at, p_country, p_event_created
  )
  on conflict (stripe_subscription_id) do update set
    user_id              = excluded.user_id,
    stripe_customer_id   = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
    status               = excluded.status,
    plan                 = coalesce(excluded.plan, subscriptions.plan),
    ciklus               = coalesce(excluded.ciklus, subscriptions.ciklus),
    lookup_key           = coalesce(excluded.lookup_key, subscriptions.lookup_key),
    current_period_end   = coalesce(excluded.current_period_end, subscriptions.current_period_end),
    trial_end            = excluded.trial_end,
    -- Bez `coalesce`: reaktivacija šalje `cancel_at: null` i briše oba.
    cancel_at_period_end = excluded.cancel_at_period_end,
    cancel_at            = excluded.cancel_at,
    canceled_at          = excluded.canceled_at,
    country_code         = coalesce(excluded.country_code, subscriptions.country_code),
    updated_at           = excluded.updated_at;

  -- `plan_expires_at` = kraj plaćenog (ili probnog) perioda. Za `canceled`
  -- ostaje poslednji poznat kraj perioda — §1.5, otkazano radi do kraja.
  update profiles
     set plan               = case when p_status in ('trialing','active','past_due')
                                   then coalesce(p_plan, plan) else plan end,
         plan_expires_at    = coalesce(p_period_end, plan_expires_at),
         stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
   where id = p_user;

  return query select true, 'saved';
end $$;

-- ═══════════════════════════════════════════════════════════
-- 3. admin_users_page — telo iz 0026 + `sub_cancel_at`
-- ═══════════════════════════════════════════════════════════
drop function if exists admin_users_page(text, text, text, text, text, integer, integer, text[], text[]);
create or replace function admin_users_page(
  p_q text default null, p_filter text default null, p_plan text default null,
  p_sort text default 'created_at', p_dir text default 'desc',
  p_limit integer default 25, p_offset integer default 0,
  p_bootstrap text[] default '{}'::text[], p_ids text[] default null
)
returns table (
  id text, email text, plan text, role text, credits_balance integer, credits_topup integer,
  komp_expires_at timestamptz, plan_expires_at timestamptz,
  sub_status text, sub_period_end timestamptz, sub_canceled_at timestamptz, sub_trial_end timestamptz,
  sub_cancel_at_period_end boolean, sub_cancel_at timestamptz,
  created_at timestamptz, last_seen_at timestamptz,
  onboarding_done_at timestamptz, onboarding_skipped_at timestamptz,
  unlocks_count bigint, searches_count bigint, feedback_count bigint, ukupno bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  with baza as (
    select p.id, p.email, p.plan, p.role, p.credits_balance, p.credits_topup,
           p.komp_expires_at, p.plan_expires_at,
           sub.status as sub_status, sub.current_period_end as sub_period_end,
           sub.canceled_at as sub_canceled_at, sub.trial_end as sub_trial_end,
           sub.cancel_at_period_end as sub_cancel_at_period_end, sub.cancel_at as sub_cancel_at,
           p.created_at, p.last_seen_at,
           p.onboarding_done_at, p.onboarding_skipped_at,
           (select count(*) from unlocks u where u.user_id = p.id) as unlocks_count,
           (select count(*) from searches s where s.user_id = p.id) as searches_count,
           (select count(*) from feedback f where f.user_id = p.id) as feedback_count
    from profiles p
    left join lateral (
      select s.status, s.current_period_end, s.canceled_at, s.trial_end,
             s.cancel_at_period_end, s.cancel_at
      from subscriptions s where s.user_id = p.id
      order by s.current_period_end desc nulls last limit 1
    ) sub on true
  ),
  filtrirano as (
    select b.* from baza b
    where (p_q is null or p_q = '' or b.email ilike '%' || p_q || '%')
      and (p_plan is null or p_plan = '' or b.plan = p_plan)
      and (p_ids is null or b.id = any(p_ids))
      and (p_filter is null or p_filter = '' or p_filter = 'svi'
        or (p_filter = 'aktivni7' and b.last_seen_at >= now() - interval '7 days')
        or (p_filter = 'admini' and (b.role = 'admin' or b.id = any(coalesce(p_bootstrap, '{}'::text[]))))
        or (p_filter = 'bez_aktivnosti' and b.searches_count = 0 and b.unlocks_count = 0)
        or (p_filter = 'proba' and b.sub_status = 'trialing'))
  )
  select f.id, f.email, f.plan, f.role, f.credits_balance, f.credits_topup,
         f.komp_expires_at, f.plan_expires_at, f.sub_status, f.sub_period_end,
         f.sub_canceled_at, f.sub_trial_end, f.sub_cancel_at_period_end, f.sub_cancel_at,
         f.created_at, f.last_seen_at,
         f.onboarding_done_at, f.onboarding_skipped_at,
         f.unlocks_count, f.searches_count, f.feedback_count, count(*) over () as ukupno
  from filtrirano f
  order by
    case when p_dir = 'asc'  and p_sort = 'credits'    then f.credits_balance end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'credits'    then f.credits_balance end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'unlocks'    then f.unlocks_count   end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'unlocks'    then f.unlocks_count   end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'last_seen'  then f.last_seen_at    end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'last_seen'  then f.last_seen_at    end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'created_at' then f.created_at      end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'created_at' then f.created_at      end desc nulls last,
    f.created_at desc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. PRAVA
-- ═══════════════════════════════════════════════════════════
revoke all on function apply_subscription(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,text,timestamptz) from public, anon, authenticated;
revoke all on function admin_users_page(text,text,text,text,text,integer,integer,text[],text[]) from public, anon, authenticated;

grant execute on function apply_subscription(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,text,timestamptz) to service_role;
grant execute on function admin_users_page(text,text,text,text,text,integer,integer,text[],text[]) to service_role;
