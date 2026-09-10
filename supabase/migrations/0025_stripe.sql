-- 0025_stripe.sql — S25: prelazak na Stripe, beta → komp, proba, pozivnice,
-- naplativ pristup kešu (D10), delimičan povraćaj skeniranja.
--
-- Odluke: 00-MASTER-PLAN-SESIJE.md §0 (D1, D2, D4, D10, D11, A1–A5).
-- Spec: docs/naplata-stripe.md §3. Migracija je idempotentna — `pnpm check:sql`
-- je pušta dvaput, pa `rename column` ide kroz `do $$ … if exists $$`, a
-- funkcije kojima se menja potpis ili povratni tip se prvo eksplicitno drop-uju.

-- ═══════════════════════════════════════════════════════════
-- 1. PROFILES: kolone
-- ═══════════════════════════════════════════════════════════
-- Drugi prolaz `pnpm check:sql`: 0022 ponovo doda PRAZNE stare kolone kupca i
-- roka bete (`add column if not exists`), a nove kolone već postoje.
-- Tada se stara kolona BRIŠE, ne preimenuje — inače bi rename pao na duplikatu.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'profiles' and column_name = 'paddle_customer_id') then
    if exists (select 1 from information_schema.columns
               where table_name = 'profiles' and column_name = 'stripe_customer_id') then
      alter table profiles drop column paddle_customer_id;
    else
      alter table profiles rename column paddle_customer_id to stripe_customer_id;
    end if;
  end if;
  if exists (select 1 from information_schema.columns
             where table_name = 'profiles' and column_name = 'beta_expires_at') then
    if exists (select 1 from information_schema.columns
               where table_name = 'profiles' and column_name = 'komp_expires_at') then
      alter table profiles drop column beta_expires_at;
    else
      alter table profiles rename column beta_expires_at to komp_expires_at;
    end if;
  end if;
end $$;

alter table profiles add column if not exists stripe_customer_id text;
alter table profiles add column if not exists komp_expires_at    timestamptz;

drop index if exists profiles_paddle_customer_idx;
create index if not exists profiles_stripe_customer_idx
  on profiles (stripe_customer_id) where stripe_customer_id is not null;

-- Stripe customer je jedan po nalogu i jedan nalog po customeru. Bez ovoga bi
-- dva profila mogla da dele kupca i webhook bi kredite upisao prvom koga nađe.
create unique index if not exists profiles_stripe_customer_uniq
  on profiles (stripe_customer_id) where stripe_customer_id is not null;

-- beta → komp. Triger ispod još ne postoji sa novim imenom, a stari se briše
-- pre update-a da ne bi blokirao prelaz.
drop trigger if exists profiles_beta_guard on profiles;
drop function if exists profiles_beta_samo_iz_konzole();

update profiles set plan = 'komp' where plan = 'beta';

alter table profiles drop constraint if exists profiles_plan_valid;
alter table profiles add  constraint profiles_plan_valid check (
  plan in ('komp', 'dopuna', 'starter', 'pro', 'advanced')
);

create or replace function profiles_komp_samo_iz_konzole()
returns trigger language plpgsql as $$
begin
  if new.plan is distinct from 'komp' then return new; end if;
  if tg_op = 'UPDATE' and old.plan = 'komp' then return new; end if;
  if coalesce(current_setting('sajtoskop.komp', true), '') = 'konzola' then return new; end if;
  raise exception 'plan `komp` se dodeljuje isključivo kroz admin_open_komp ili redeem_invite'
    using errcode = 'check_violation';
end $$;

drop trigger if exists profiles_komp_guard on profiles;
create trigger profiles_komp_guard
  before insert or update of plan on profiles
  for each row execute function profiles_komp_samo_iz_konzole();

-- ═══════════════════════════════════════════════════════════
-- 2. SUBSCRIPTIONS: Stripe oblik
-- ═══════════════════════════════════════════════════════════
-- Tabela je prazna u produkciji (nijedna živa pretplata kod starog provajdera), pa se ne
-- migriraju redovi — samo šema. `drop` + `create` je zato dozvoljen i
-- jednostavniji od šest `rename`-ova.
drop table if exists subscriptions;

create table if not exists subscriptions (
  stripe_subscription_id text primary key,
  user_id                text not null references profiles(id) on delete cascade,
  stripe_customer_id     text,
  status                 text not null,
  plan                   text,
  ciklus                 text,
  lookup_key             text,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  country_code           text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Stripe-ovi statusi. `incomplete*` znači da prva naplata nije prošla; nalog
  -- nema pristup, ali red se čuva da webhook posle uspeha ima šta da osveži.
  constraint subscriptions_status_valid check (
    status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid',
               'incomplete', 'incomplete_expired', 'paused')
  ),
  constraint subscriptions_plan_valid check (
    plan is null or plan in ('starter', 'pro', 'advanced')
  ),
  constraint subscriptions_ciklus_valid check (ciklus is null or ciklus in ('month', 'year')),
  constraint subscriptions_country_code_valid check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  )
);

create index if not exists subscriptions_user_idx
  on subscriptions (user_id, current_period_end desc);

alter table subscriptions enable row level security;
alter table subscriptions force  row level security;

-- billing_events ostaje kakav jeste: `event_id` je sada `evt_…`.

-- ═══════════════════════════════════════════════════════════
-- 3. RAZLOZI U KNJIZI
-- ═══════════════════════════════════════════════════════════
-- trial_grant  10 kredita na ulasku u probu (ref = trial:<user>)
-- komp_grant   krediti komp naloga (ref iz admina / pozivnice)
-- expire       kasa koja ističe se prazni kad pretplata prestane (ref = expire:<sub>)
-- beta_grant   ostaje samo zbog postojećih redova; niko ga više ne piše
alter table credit_ledger drop constraint if exists credit_ledger_reason_valid;
alter table credit_ledger add  constraint credit_ledger_reason_valid check (
  reason in (
    'unlock', 'scan', 'monthly_grant', 'admin', 'refund', 'feedback',
    'subscription_grant', 'credit_pack', 'onboarding', 'beta_grant',
    'trial_grant', 'komp_grant', 'expire'
  )
);

drop index if exists credit_ledger_grant_idem_idx;
create unique index credit_ledger_grant_idem_idx
  on credit_ledger (user_id, reason, ref_id)
  where ref_id is not null and reason in (
    'monthly_grant', 'admin', 'feedback', 'subscription_grant', 'credit_pack',
    'onboarding', 'beta_grant', 'trial_grant', 'komp_grant', 'expire'
  );

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

  if p_reason = 'credit_pack' then
    update profiles set credits_topup = credits_topup + p_amount where id = p_user;
  else
    update profiles set credits_balance = credits_balance + p_amount where id = p_user;
  end if;
  return query select true, 'granted';
end $$;

-- ═══════════════════════════════════════════════════════════
-- 4. PRIMENA PRETPLATE (Stripe)
-- ═══════════════════════════════════════════════════════════
-- Zove je isključivo webhook. Nema kredita u njoj — dodela je odvojena
-- (`apply_invoice_paid`), jer Stripe šalje stanje pretplate i naplatu kao dva
-- različita događaja i oni stižu bilo kojim redom (§6.4).
drop function if exists apply_subscription(text, text, text, text, text, text, timestamptz, integer, text, text, timestamptz);

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
  p_country         text default null
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
    lookup_key, current_period_end, trial_end, cancel_at_period_end, canceled_at,
    country_code, updated_at
  ) values (
    p_subscription_id, p_user, p_customer_id, p_status, p_plan, p_ciklus,
    p_lookup_key, p_period_end, p_trial_end, coalesce(p_cancel_at_end, false),
    p_canceled_at, p_country, p_event_created
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
    cancel_at_period_end = excluded.cancel_at_period_end,
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

-- ── mesečna dodela iz naplate ────────────────────────────────
-- `invoice.paid` → balans se POSTAVLJA na mesečni broj plana (bez rollovera),
-- ključ idempotencije je `in_…`. Koristi `grant_monthly_credits` iz 0004 —
-- ista SET semantika koju je do sada imao worker.
create or replace function apply_invoice_paid(
  p_user        text,
  p_invoice_id  text,
  p_target      integer
)
returns table (ok boolean, reason text, delta integer)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_invoice_id is null or p_invoice_id = '' then
    return query select false, 'missing_ref_id', 0; return;
  end if;
  return query select g.ok, g.reason, g.delta
    from grant_monthly_credits(p_user, p_target, p_invoice_id) g;
end $$;

-- ── proba: 10 kredita jednom po pretplati ────────────────────
create or replace function apply_trial_start(
  p_user text, p_subscription_id text, p_credits integer
)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Jednom po NALOGU, ne po pretplati: nova pretplata istog čoveka posle
  -- otkazane probe ne sme da donese još 10. Ref je zato `trial:<user>`.
  return query select g.ok, g.reason
    from grant_credits(p_user, p_credits, 'trial_grant', 'trial:' || p_user) g;
end $$;

-- ── kraj pretplate: kasa koja ističe se prazni ───────────────
-- Zove se na `customer.subscription.deleted`. Bez ovoga bi otkazani korisnik
-- u `dopuna` stanju (ima paket) trošio i preostale pretplatne kredite koje
-- više ne plaća, a worker koji ih je do sada brisao prvog u mesecu više ne
-- gleda `dopuna` (§10).
create or replace function expire_subscription_credits(
  p_user text, p_subscription_id text
)
returns table (ok boolean, reason text, delta integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_balance integer;
  v_ref     text := 'expire:' || p_subscription_id;
begin
  select credits_balance into v_balance from profiles where id = p_user for update;
  if v_balance is null then return query select false, 'no_user', 0; return; end if;
  if exists (select 1 from credit_ledger cl
             where cl.user_id = p_user and cl.reason = 'expire' and cl.ref_id = v_ref) then
    return query select true, 'already_applied', 0; return;
  end if;
  if v_balance <= 0 then return query select true, 'nothing', 0; return; end if;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, -v_balance, 'expire', v_ref);
  update profiles set credits_balance = 0 where id = p_user;
  return query select true, 'expired', -v_balance;
end $$;

-- `apply_credit_pack` — nepromenjeno telo iz 0022, samo kolona kupca.
create or replace function apply_credit_pack(
  p_user text, p_credits integer, p_txn_id text, p_customer_id text default null
)
returns table (ok boolean, reason text, granted integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ok boolean; v_reason text;
begin
  if p_credits is null or p_credits <= 0 then
    return query select false, 'invalid_amount'::text, 0; return; end if;
  if p_txn_id is null or p_txn_id = '' then
    return query select false, 'missing_ref_id'::text, 0; return; end if;
  perform 1 from profiles where id = p_user for update;
  if not found then return query select false, 'no_user'::text, 0; return; end if;
  if p_customer_id is not null then
    update profiles set stripe_customer_id = p_customer_id where id = p_user;
  end if;
  select g.ok, g.reason into v_ok, v_reason
    from grant_credits(p_user, p_credits, 'credit_pack', p_txn_id) g;
  if not coalesce(v_ok, false) then
    return query select false, coalesce(v_reason, 'nepoznat razlog')::text, 0; return; end if;
  if v_reason = 'already_granted' then
    return query select true, 'already_granted'::text, 0; return; end if;
  return query select true, 'granted'::text, p_credits;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 5. KOMP (bivša beta) — admin + pozivnice
-- ═══════════════════════════════════════════════════════════
drop function if exists admin_open_beta(text, integer, timestamptz, text);

create or replace function admin_open_komp(
  p_user text, p_credits integer, p_expires timestamptz, p_ref_id text
)
returns table (ok boolean, reason text, granted integer, balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ok boolean; v_reason text; v_balance integer;
begin
  if p_ref_id is null or p_ref_id = '' then
    return query select false, 'missing_ref_id'::text, 0, null::integer; return; end if;
  if p_credits is null or p_credits < 0 or p_credits > 2000 then
    return query select false, 'invalid_amount'::text, 0, null::integer; return; end if;
  perform 1 from profiles where id = p_user for update;
  if not found then return query select false, 'no_user'::text, 0, null::integer; return; end if;

  perform set_config('sajtoskop.komp', 'konzola', true);
  update profiles set plan = 'komp', komp_expires_at = p_expires where id = p_user;

  if p_credits > 0 then
    select g.ok, g.reason into v_ok, v_reason
      from grant_credits(p_user, p_credits, 'komp_grant', p_ref_id) g;
    if not coalesce(v_ok, false) then
      raise exception 'grant_credits(komp_grant) je odbio dodelu: %', coalesce(v_reason, '?');
    end if;
  else
    v_reason := 'no_credits';
  end if;

  select p.credits_balance into v_balance from profiles p where p.id = p_user;
  return query select true,
    case when v_reason = 'already_granted' then 'already_granted' else 'opened' end,
    case when v_reason = 'granted' then p_credits else 0 end,
    v_balance;
end $$;

-- ── pozivnice ────────────────────────────────────────────────
-- Dva tipa (D4). `komp` otvara pun pristup bez Stripe-a; `prvi_mesec`
-- označava profil tako da checkout ubaci 100% kupon na prvi period.
create table if not exists access_invites (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  kind          text not null,
  -- komp: rok i krediti; prvi_mesec: ignoriše se
  komp_days     integer,
  komp_credits  integer,
  -- opciono vezano za mejl; NULL = bilo ko sa kodom
  email         text,
  note          text,
  max_uses      integer not null default 1,
  used_count    integer not null default 0,
  created_by    text references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  constraint access_invites_kind_valid check (kind in ('komp', 'prvi_mesec')),
  constraint access_invites_uses check (used_count >= 0 and used_count <= max_uses)
);

create table if not exists access_invite_redemptions (
  invite_id   uuid not null references access_invites(id) on delete cascade,
  user_id     text not null references profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

-- Profil pamti pozivnicu „prvi mesec" dok je checkout ne potroši.
alter table profiles add column if not exists invite_id uuid references access_invites(id) on delete set null;

alter table access_invites enable row level security;
alter table access_invites force  row level security;
alter table access_invite_redemptions enable row level security;
alter table access_invite_redemptions force  row level security;

/**
 * Korisnik unosi kod. Sve u jednoj transakciji.
 *   komp        → plan komp, rok, krediti (kroz admin_open_komp, isti triger)
 *   prvi_mesec  → profiles.invite_id; kupon primenjuje checkout (§9)
 * Jedan nalog sme da iskoristi jednu pozivnicu bilo kog tipa jednom.
 */
create or replace function redeem_invite(p_user text, p_code text)
returns table (ok boolean, reason text, kind text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv access_invites%rowtype;
  v_plan text;
  v_ok boolean; v_reason text;
begin
  select * into v_inv from access_invites
   where code = upper(trim(p_code)) for update;
  if not found then return query select false, 'not_found', null::text; return; end if;
  if v_inv.revoked_at is not null then return query select false, 'revoked', v_inv.kind; return; end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    return query select false, 'expired', v_inv.kind; return; end if;
  if v_inv.used_count >= v_inv.max_uses then return query select false, 'used_up', v_inv.kind; return; end if;
  if v_inv.email is not null and not exists (
    select 1 from profiles p where p.id = p_user and lower(p.email) = lower(v_inv.email)
  ) then return query select false, 'wrong_email', v_inv.kind; return; end if;
  if exists (select 1 from access_invite_redemptions r where r.user_id = p_user) then
    return query select false, 'already_redeemed', v_inv.kind; return; end if;

  select plan into v_plan from profiles where id = p_user for update;
  if v_plan is null then return query select false, 'no_user', v_inv.kind; return; end if;
  -- Ko već plaća, ne dobija ni komp ni gratis mesec.
  if exists (select 1 from subscriptions s where s.user_id = p_user
             and s.status in ('trialing','active','past_due')) then
    return query select false, 'has_subscription', v_inv.kind; return; end if;

  if v_inv.kind = 'komp' then
    select a.ok, a.reason into v_ok, v_reason
      from admin_open_komp(
        p_user, coalesce(v_inv.komp_credits, 0),
        case when v_inv.komp_days is null then null
             else now() + make_interval(days => v_inv.komp_days) end,
        'invite:' || v_inv.id::text) a;
    if not coalesce(v_ok, false) then
      raise exception 'admin_open_komp iz pozivnice: %', coalesce(v_reason, '?');
    end if;
  else
    update profiles set invite_id = v_inv.id where id = p_user;
  end if;

  insert into access_invite_redemptions (invite_id, user_id) values (v_inv.id, p_user);
  update access_invites set used_count = used_count + 1 where id = v_inv.id;
  return query select true, 'redeemed', v_inv.kind;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 6. PRISTUP KEŠU SE PLAĆA (D10) + delimičan povraćaj
-- ═══════════════════════════════════════════════════════════
-- Šta je „pristup": pravo da korisnik gleda listu (grad, niša) do N stranica,
-- 30 dana. Nastaje na dva načina, oba za isti broj kredita:
--   a) kombinacija je sveža u kešu i ima dovoljno stranica → bez posla, bez
--      Places poziva, krediti se skidaju, pristup odmah
--   b) nije → posao `scan` kao do sada, pristup nastaje odmah, važi kad posao
--      završi
-- Pristup ističe najkasnije kad i Google podatak (pravilo 1).
create table if not exists search_access (
  user_id      text not null references profiles(id) on delete cascade,
  country_code text not null,
  city_slug    text not null,
  niche_slug   text not null,
  pages        integer not null,
  paid_at      timestamptz not null default now(),
  expires_at   timestamptz not null,
  job_id       bigint,
  primary key (user_id, country_code, city_slug, niche_slug),
  constraint search_access_pages check (pages between 1 and 3)
);
create index if not exists search_access_expiry_idx on search_access (expires_at);
alter table search_access enable row level security;
alter table search_access force  row level security;
-- Isti izraz kao politika „own unlocks" iz 0001 — Clerk `sub` iz JWT-a.
drop policy if exists "own search_access" on search_access;
create policy "own search_access" on search_access
  for select to authenticated using (user_id = auth.jwt() ->> 'sub');

/**
 * Zamena za spend_credit_and_scan iz 0023. Isti potpis + `p_ttl_days`.
 *
 * Ishodi (`reason`):
 *   already_paid   pristup postoji, dovoljno dubok i nije istekao → 0 kredita
 *   cached         keš svež + dovoljno stranica → naplaćeno, bez posla
 *   charged        naplaćeno, posao upisan
 *   insufficient_credits / no_user
 *
 * Cena iz keša: broj stranica koje STVARNO postoje, ne koje su tražene —
 * `Duboko` nad kešom sa 25 firmi košta 2, ne 3 (§14.4).
 */
drop function if exists spend_credit_and_scan(text, text, text, text, integer);
create or replace function spend_credit_and_scan(
  p_user text, p_country text, p_city text, p_niche text,
  p_max_results integer default 30, p_ttl_days integer default 30
)
returns table (
  ok boolean, reason text, job_id bigint, joined boolean,
  charged boolean, credits_left integer, cost integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_balance integer; v_topup integer; v_iz_balansa integer;
  v_pages integer := least(3, greatest(1, ceil(coalesce(p_max_results, 30) / 20.0)::int));
  v_cena integer; v_max integer; v_key text;
  v_live bigint; v_id bigint; v_joined boolean;
  v_access search_access%rowtype;
  v_cache record;
  v_cache_pages integer; v_expires timestamptz;
begin
  select p.credits_balance, p.credits_topup into v_balance, v_topup
    from profiles p where p.id = p_user for update;
  if v_balance is null then
    return query select false, 'no_user', null::bigint, false, false, 0, 0; return; end if;

  -- 0. Već plaćen pristup dovoljne dubine?
  select * into v_access from search_access
   where user_id = p_user and country_code = p_country
     and city_slug = p_city and niche_slug = p_niche;
  if found and v_access.expires_at > now() and v_access.pages >= v_pages then
    if v_access.job_id is not null then
      insert into job_subscribers (job_id, user_id) values (v_access.job_id, p_user)
      on conflict do nothing;
    end if;
    return query select true, 'already_paid', v_access.job_id, true, false,
                        v_balance + v_topup, 0; return;
  end if;

  -- 1. Keš svež i dovoljno dubok? → naplati, bez posla.
  select sc.last_scanned_at, sc.pages, sc.last_results_count, sc.partial into v_cache
    from search_cache sc
   where sc.country_code = p_country and sc.city_slug = p_city and sc.niche_slug = p_niche;
  if found and v_cache.last_scanned_at > now() - make_interval(days => p_ttl_days)
     and not coalesce(v_cache.partial, false)
     and v_cache.pages >= v_pages then
    v_cache_pages := least(v_pages, greatest(1, ceil(coalesce(v_cache.last_results_count,0) / 20.0)::int));
    v_cena := v_cache_pages;
    if v_balance + v_topup < v_cena then
      return query select false, 'insufficient_credits', null::bigint, false, false,
                          v_balance + v_topup, v_cena; return; end if;
    v_expires := v_cache.last_scanned_at + make_interval(days => p_ttl_days);
    insert into credit_ledger (user_id, delta, reason, ref_id)
      values (p_user, -v_cena, 'scan',
              'kes:' || p_country || ':' || p_city || ':' || p_niche || ':' ||
              to_char(now(), 'YYYYMMDDHH24MISSMS'));
    v_iz_balansa := least(v_cena, greatest(v_balance, 0));
    update profiles set credits_balance = credits_balance - v_iz_balansa,
                        credits_topup = credits_topup - (v_cena - v_iz_balansa)
     where id = p_user;
    insert into search_access (user_id, country_code, city_slug, niche_slug, pages, expires_at, job_id)
      values (p_user, p_country, p_city, p_niche, v_pages, v_expires, null)
    on conflict (user_id, country_code, city_slug, niche_slug) do update
      set pages = excluded.pages, paid_at = now(), expires_at = excluded.expires_at, job_id = null;
    return query select true, 'cached', null::bigint, false, true,
                        v_balance + v_topup - v_cena, v_cena; return;
  end if;

  -- 2. Živ posao iste dubine koji je ovaj korisnik već platio (dupli klik).
  v_cena := v_pages; v_max := v_pages * 20;
  v_key := p_country || ':' || p_city || ':' || p_niche || ':p' || v_pages;
  select q.id into v_live from job_queue q
   where q.type = 'scan' and q.dedupe_key = v_key and q.status in ('pending','running')
   order by q.id limit 1 for update;
  if v_live is not null and exists (
    select 1 from credit_ledger cl where cl.user_id = p_user
      and cl.reason = 'scan' and cl.ref_id = 'scan:' || v_live) then
    insert into job_subscribers (job_id, user_id) values (v_live, p_user) on conflict do nothing;
    return query select true, 'already_paid', v_live, true, false, v_balance + v_topup, 0; return;
  end if;

  if v_balance + v_topup < v_cena then
    return query select false, 'insufficient_credits', null::bigint, false, false,
                        v_balance + v_topup, v_cena; return; end if;

  -- 3. Naplati i upiši posao (kao 0023).
  select e.job_id, e.joined into v_id, v_joined
    from enqueue_job('scan', jsonb_build_object(
      'citySlug', p_city, 'nicheSlug', p_niche, 'userId', p_user,
      'countryCode', p_country, 'maxResults', v_max), v_key, p_user) e;
  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, -v_cena, 'scan', 'scan:' || v_id);
  v_iz_balansa := least(v_cena, greatest(v_balance, 0));
  update profiles set credits_balance = credits_balance - v_iz_balansa,
                      credits_topup = credits_topup - (v_cena - v_iz_balansa)
   where id = p_user;
  insert into search_access (user_id, country_code, city_slug, niche_slug, pages, expires_at, job_id)
    values (p_user, p_country, p_city, p_niche, v_pages, now() + make_interval(days => p_ttl_days), v_id)
  on conflict (user_id, country_code, city_slug, niche_slug) do update
    set pages = excluded.pages, paid_at = now(), expires_at = excluded.expires_at, job_id = excluded.job_id;
  return query select true, 'charged', v_id, coalesce(v_joined, false), true,
                      v_balance + v_topup - v_cena, v_cena;
end $$;

/** Ima li korisnik plaćen pristup dovoljne dubine. Zove ga GET/pretraga bez `pay`. */
create or replace function has_search_access(
  p_user text, p_country text, p_city text, p_niche text, p_pages integer
)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from search_access a
     where a.user_id = p_user and a.country_code = p_country
       and a.city_slug = p_city and a.niche_slug = p_niche
       and a.expires_at > now() and a.pages >= p_pages
  );
$$;

/**
 * Povraćaj razlike. `p_pages_used` = koliko je Places poziva worker STVARNO
 * napravio (`apiCalls`). 0 = vrati sve (pad, prazan rezultat, neupisan registar).
 * Vraća se `plaćeno - iskorišćeno` po platiocu, idempotentno po ref-u.
 */
drop function if exists refund_scan(bigint);
create or replace function refund_scan(p_job_id bigint, p_pages_used integer default 0)
returns table (refunded integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref text := 'scan:' || p_job_id; v_user text; v_placeno integer; v_iznos integer; v_count integer := 0;
begin
  for v_user, v_placeno in
    select cl.user_id, (-sum(cl.delta))::int from credit_ledger cl
     where cl.reason = 'scan' and cl.ref_id = v_ref
       and not exists (select 1 from credit_ledger r
                        where r.user_id = cl.user_id and r.reason = 'refund' and r.ref_id = v_ref)
     group by cl.user_id
  loop
    v_iznos := v_placeno - greatest(0, coalesce(p_pages_used, 0));
    if coalesce(v_iznos, 0) <= 0 then continue; end if;
    perform 1 from profiles p where p.id = v_user for update;
    insert into credit_ledger (user_id, delta, reason, ref_id) values (v_user, v_iznos, 'refund', v_ref);
    update profiles set credits_balance = credits_balance + v_iznos where id = v_user;
    -- Pristup se smanjuje na ono što je stvarno stiglo.
    update search_access set pages = least(pages, greatest(1, p_pages_used))
     where job_id = p_job_id and user_id = v_user and p_pages_used > 0;
    v_count := v_count + 1;
  end loop;
  return query select v_count;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 7. ADMIN LISTA — kolone
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
  created_at timestamptz, last_seen_at timestamptz,
  unlocks_count bigint, searches_count bigint, feedback_count bigint, ukupno bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  with baza as (
    select p.id, p.email, p.plan, p.role, p.credits_balance, p.credits_topup,
           p.komp_expires_at, p.plan_expires_at,
           sub.status as sub_status, sub.current_period_end as sub_period_end,
           sub.canceled_at as sub_canceled_at, sub.trial_end as sub_trial_end,
           p.created_at, p.last_seen_at,
           (select count(*) from unlocks u where u.user_id = p.id) as unlocks_count,
           (select count(*) from searches s where s.user_id = p.id) as searches_count,
           (select count(*) from feedback f where f.user_id = p.id) as feedback_count
    from profiles p
    left join lateral (
      select s.status, s.current_period_end, s.canceled_at, s.trial_end
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
         f.sub_canceled_at, f.sub_trial_end, f.created_at, f.last_seen_at,
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
-- 8. ZAŠTITA OD PONOVLJENE PROBE
-- ═══════════════════════════════════════════════════════════
-- `payment_method.card.fingerprint` sa checkout sesije. Ista kartica → druga
-- proba se odmah pretvara u naplatu (`trial_end: 'now'`, §7.5).
create table if not exists trial_fingerprints (
  fingerprint text primary key,
  user_id     text not null references profiles(id) on delete cascade,
  first_seen  timestamptz not null default now()
);
alter table trial_fingerprints enable row level security;
alter table trial_fingerprints force  row level security;

-- ═══════════════════════════════════════════════════════════
-- 9. PRAVA
-- ═══════════════════════════════════════════════════════════
revoke all on function grant_credits(text, integer, text, text) from public, anon, authenticated;
revoke all on function apply_subscription(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,text) from public, anon, authenticated;
revoke all on function apply_invoice_paid(text, text, integer) from public, anon, authenticated;
revoke all on function apply_trial_start(text, text, integer) from public, anon, authenticated;
revoke all on function expire_subscription_credits(text, text) from public, anon, authenticated;
revoke all on function apply_credit_pack(text, integer, text, text) from public, anon, authenticated;
revoke all on function admin_open_komp(text, integer, timestamptz, text) from public, anon, authenticated;
revoke all on function redeem_invite(text, text) from public, anon, authenticated;
revoke all on function spend_credit_and_scan(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function has_search_access(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function refund_scan(bigint, integer) from public, anon, authenticated;
revoke all on function admin_users_page(text,text,text,text,text,integer,integer,text[],text[]) from public, anon, authenticated;

grant execute on function grant_credits(text, integer, text, text) to service_role;
grant execute on function apply_subscription(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,text) to service_role;
grant execute on function apply_invoice_paid(text, text, integer) to service_role;
grant execute on function apply_trial_start(text, text, integer) to service_role;
grant execute on function expire_subscription_credits(text, text) to service_role;
grant execute on function apply_credit_pack(text, integer, text, text) to service_role;
grant execute on function admin_open_komp(text, integer, timestamptz, text) to service_role;
grant execute on function redeem_invite(text, text) to service_role;
grant execute on function spend_credit_and_scan(text, text, text, text, integer, integer) to service_role;
grant execute on function has_search_access(text, text, text, text, integer) to service_role;
grant execute on function refund_scan(bigint, integer) to service_role;
grant execute on function admin_users_page(text,text,text,text,text,integer,integer,text[],text[]) to service_role;
