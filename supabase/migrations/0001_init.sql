-- 0001_init.sql — F1: šema, RLS i kreditne funkcije
--
-- Izvor: docs/F1-baza-auth.md, sekcije 2-4.
-- Odstupanja od PRD-a su namerna i objašnjena na licu mesta oznakom [ODSTUPANJE].
--
-- Auth: Clerk je third-party provider u Supabase-u, pa `auth.jwt() ->> 'sub'`
-- vraća Clerk user id (text, npr. "user_2abc..."). Zato su svi `user_id` text,
-- a ne uuid.
--
-- Pisanje u SVE tabele ide isključivo kroz `service_role`. Nema nijedne
-- insert/update/delete politike za korisnike — ni jedne.

-- ═══════════════════════════════════════════════════════════
-- 1. TABELE
-- ═══════════════════════════════════════════════════════════

-- ── korisnici ──────────────────────────────────────────────
create table if not exists profiles (
  id                text primary key,              -- Clerk user id
  email             text,
  plan              text not null default 'beta',
  credits_balance   integer not null default 0,
  cache_miss_day    date,
  cache_miss_count  integer not null default 0,
  created_at        timestamptz not null default now(),

  -- [ODSTUPANJE] Drugi sloj odbrane ispod spend_credit_and_unlock.
  -- Ako neko ikad zaobiđe funkciju i uradi direktan UPDATE, transakcija pukne
  -- umesto da se pojavi negativan balans (P0-1 iz docs/bezbednost-i-zastita.md).
  constraint profiles_credits_nonneg check (credits_balance >= 0),
  constraint profiles_cache_miss_nonneg check (cache_miss_count >= 0)
);

-- ── Google podaci, TTL 30 dana ─────────────────────────────
-- `google_refreshed_at` je jedini razlog zbog kog ova tabela postoji odvojeno
-- od website_audits. Pravilo 1 iz CLAUDE.md: ništa starije od 30 dana se ne servira.
create table if not exists businesses (
  place_id            text primary key,
  country_code        text not null default 'RS',
  city_slug           text not null,
  niche_slug          text,
  query_text          text,
  name                text not null,
  address             text,
  phone               text,
  phone_type          text,
  website_url         text,
  rating              numeric(2,1),
  user_ratings_total  integer,
  google_refreshed_at timestamptz not null default now(),
  first_seen_at       timestamptz not null default now(),

  -- [ODSTUPANJE] CHECK umesto slobodnog teksta. Seed i worker pišu iz tri
  -- različita procesa; tipfeler u vrednosti bi tiho iskrivio ceo UI filter.
  constraint businesses_phone_type_valid check (
    phone_type is null or phone_type in ('mobilni', 'fiksni', 'besplatni', 'nepoznat')
  ),
  constraint businesses_country_code_valid check (country_code ~ '^[A-Z]{2}$')
);

create index if not exists businesses_city_niche_idx
  on businesses (country_code, city_slug, niche_slug);

-- Za refresh job u F3: "daj mi sve što je starije od 30 dana".
create index if not exists businesses_google_refreshed_idx
  on businesses (google_refreshed_at);

-- ── moja intelektualna svojina, bez TTL-a ──────────────────
create table if not exists website_audits (
  id                 uuid primary key default gen_random_uuid(),
  place_id           text not null references businesses(place_id) on delete cascade,
  audit_level        smallint not null default 1,  -- 1 = HTML, 2 = +PSI, 3 = +AI
  site_status        text not null,
  http_status        integer,
  final_url          text,
  ugly_score         integer,
  ugly_band          text,
  platform           text,
  signals            jsonb not null default '[]'::jsonb,
  emails             text[],
  screenshot_desktop text,
  screenshot_mobile  text,
  psi_mobile_score   integer,
  ai_issues          jsonb,
  ai_verdict         text,
  enriched_at        timestamptz not null default now(),

  constraint website_audits_level_valid check (audit_level between 1 and 3),
  constraint website_audits_status_valid check (
    site_status in ('ok', 'nema_sajt', 'samo_drustvene', 'mrtav')
  ),
  constraint website_audits_band_valid check (
    ugly_band is null or ugly_band in ('solidan', 'osrednji', 'ruzan', 'katastrofa')
  ),
  constraint website_audits_score_range check (
    ugly_score is null or ugly_score between 0 and 100
  ),
  constraint website_audits_psi_range check (
    psi_mobile_score is null or psi_mobile_score between 0 and 100
  ),
  -- Sloj 0 (nema_sajt / samo_drustvene / mrtav) nema numerički skor — po definiciji
  -- Ugly Score-a. Ova provera sprečava da seed ili worker naprave besmislen red.
  constraint website_audits_score_only_when_ok check (
    site_status = 'ok' or ugly_score is null
  )
);

-- Imenovan namerno: `on conflict on constraint website_audits_place_id_key`
-- u upsertu iz seeda i workera.
create unique index if not exists website_audits_place_id_key
  on website_audits (place_id);

create index if not exists website_audits_score_idx
  on website_audits (ugly_score desc nulls last);

create index if not exists website_audits_status_idx
  on website_audits (site_status);

-- ── otključavanja i krediti ────────────────────────────────
-- PK (user_id, place_id): korisnik nikad ne plaća isti lead dvaput (pravilo 4).
create table if not exists unlocks (
  user_id    text not null references profiles(id) on delete cascade,
  place_id   text not null references businesses(place_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table if not exists credit_ledger (
  id         bigserial primary key,
  user_id    text not null references profiles(id) on delete cascade,
  delta      integer not null,
  reason     text not null,
  ref_id     text,
  created_at timestamptz not null default now(),

  constraint credit_ledger_reason_valid check (
    reason in ('unlock', 'monthly_grant', 'admin', 'refund')
  ),
  constraint credit_ledger_delta_nonzero check (delta <> 0)
);

create index if not exists credit_ledger_user_idx
  on credit_ledger (user_id, created_at desc);

-- [ODSTUPANJE — bitno] Clerk webhook `user.created` se PONAVLJA (Svix retry na
-- svaki non-2xx, i na mrežni timeout kad je posao već prošao). Bez ovoga bi
-- ponovljena isporuka dodelila 30 kredita drugi put.
-- Namerno pokriva samo dodele; `unlock` je već pokriven PK-om nad unlocks,
-- a `refund` sme da se ponovi za isti place_id.
create unique index if not exists credit_ledger_grant_idem_idx
  on credit_ledger (user_id, reason, ref_id)
  where ref_id is not null and reason in ('monthly_grant', 'admin');

-- ── pretrage ───────────────────────────────────────────────
create table if not exists searches (
  id            bigserial primary key,
  user_id       text references profiles(id) on delete set null,
  country_code  text not null default 'RS',
  city_slug     text not null,
  niche_slug    text,
  query_text    text,
  source        text not null,
  results_count integer,
  api_calls     integer not null default 0,
  created_at    timestamptz not null default now(),

  constraint searches_source_valid check (source in ('cache', 'api')),
  constraint searches_api_calls_nonneg check (api_calls >= 0)
);

-- Dnevni cache-miss brojač po korisniku (P0-2) čita baš po ovom indeksu.
create index if not exists searches_user_created_idx
  on searches (user_id, created_at desc);

-- ── red poslova ────────────────────────────────────────────
create table if not exists job_queue (
  id           bigserial primary key,
  type         text not null,
  payload      jsonb not null,
  status       text not null default 'pending',
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,

  constraint job_queue_type_valid check (
    type in ('scan', 'enrich_basic', 'enrich_full', 'refresh_google')
  ),
  constraint job_queue_status_valid check (
    status in ('pending', 'running', 'done', 'failed')
  )
);

create index if not exists job_queue_pending_idx
  on job_queue (status, run_after) where status = 'pending';

-- ── budžet API poziva ──────────────────────────────────────
-- Dan i mesec se računaju po America/Los_Angeles jer Google tamo resetuje kvotu.
create table if not exists api_budget (
  day          date primary key,
  month        text not null,      -- YYYY-MM, isto po LA
  calls        integer not null default 0,
  exhausted_at timestamptz,

  constraint api_budget_month_format check (month ~ '^\d{4}-\d{2}$'),
  constraint api_budget_calls_nonneg check (calls >= 0)
);

-- Mesečni cap (GLOBAL_MONTHLY_API_CAP) je sum() po ovom indeksu.
create index if not exists api_budget_month_idx on api_budget (month);

-- ═══════════════════════════════════════════════════════════
-- 2. RLS
-- ═══════════════════════════════════════════════════════════
-- Pravilo 10 iz CLAUDE.md: RLS na svakoj tabeli, bez izuzetka.
-- `service_role` zaobilazi RLS po definiciji — zato worker, seed i API rute rade.

alter table profiles       enable row level security;
alter table unlocks        enable row level security;
alter table credit_ledger  enable row level security;
alter table searches       enable row level security;
alter table businesses     enable row level security;
alter table website_audits enable row level security;
alter table job_queue      enable row level security;
alter table api_budget     enable row level security;

-- [ODSTUPANJE] `force row level security` — bez ovoga vlasnik tabele (postgres)
-- ignoriše politike. Ne menja ništa za service_role, ali sprečava da se neko
-- kasnije zakači vlasničkom rolom i tiho zaobiđe `using (false)`.
alter table businesses     force row level security;
alter table website_audits force row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for select to authenticated using (id = auth.jwt() ->> 'sub');

drop policy if exists "own unlocks" on unlocks;
create policy "own unlocks" on unlocks
  for select to authenticated using (user_id = auth.jwt() ->> 'sub');

drop policy if exists "own ledger" on credit_ledger;
create policy "own ledger" on credit_ledger
  for select to authenticated using (user_id = auth.jwt() ->> 'sub');

drop policy if exists "own searches" on searches;
create policy "own searches" on searches
  for select to authenticated using (user_id = auth.jwt() ->> 'sub');

-- Deljeni podaci: nikakav direktan pristup, sve kroz API rute.
-- Tamo se primenjuje P0-3 (zaključana polja NEDOSTAJU u odgovoru).
drop policy if exists "no direct read" on businesses;
create policy "no direct read" on businesses     for select using (false);

drop policy if exists "no direct read" on website_audits;
create policy "no direct read" on website_audits for select using (false);

drop policy if exists "no direct read" on job_queue;
create policy "no direct read" on job_queue      for select using (false);

drop policy if exists "no direct read" on api_budget;
create policy "no direct read" on api_budget     for select using (false);

-- ═══════════════════════════════════════════════════════════
-- 3. KREDITNE FUNKCIJE
-- ═══════════════════════════════════════════════════════════
-- Pravilo 3 iz CLAUDE.md: krediti se menjaju SAMO ovde.
-- Nikad direktan `update profiles.credits_balance` u aplikaciji.

-- ── potroši kredit i otključaj ─────────────────────────────
create or replace function spend_credit_and_unlock(p_user text, p_place text)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
begin
  -- FOR UPDATE zaključava red do kraja transakcije. Ovo je jedini razlog
  -- zbog kog 20 paralelnih poziva sa 1 kreditom daje tačno jedan 'unlocked'.
  select credits_balance into v_balance
  from profiles where id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user'; return;
  end if;

  -- Već otključano → besplatno, ne naplaćuj dvaput (pravilo 4).
  if exists (select 1 from unlocks where user_id = p_user and place_id = p_place) then
    return query select true, 'already_unlocked'; return;
  end if;

  if v_balance < 1 then
    return query select false, 'insufficient_credits'; return;
  end if;

  -- [ODSTUPANJE] Provera da lead uopšte postoji. Bez nje FK baca izuzetak koji
  -- na API sloju izgleda kao 500 umesto kao uredna poruka.
  if not exists (select 1 from businesses where place_id = p_place) then
    return query select false, 'no_place'; return;
  end if;

  insert into unlocks (user_id, place_id) values (p_user, p_place);
  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, -1, 'unlock', p_place);
  update profiles set credits_balance = credits_balance - 1 where id = p_user;

  return query select true, 'unlocked';
end;
$$;

-- ── dodeli kredite ─────────────────────────────────────────
-- `p_ref_id` je ključ idempotencije. Za mesečnu dodelu prosledi npr.
-- 'signup:<clerk_event_id>' ili '2026-08' — ponovljen poziv sa istim ref_id
-- ne dodaje kredite drugi put.
create or replace function grant_credits(
  p_user   text,
  p_amount integer,
  p_reason text,
  p_ref_id text default null
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_amount <= 0 then
    return query select false, 'invalid_amount'; return;
  end if;

  if p_reason not in ('monthly_grant', 'admin', 'refund') then
    return query select false, 'invalid_reason'; return;
  end if;

  perform 1 from profiles where id = p_user for update;
  if not found then
    return query select false, 'no_user'; return;
  end if;

  -- Alias je obavezan: `reason` je i izlazni parametar ove funkcije i kolona u
  -- credit_ledger, pa nekvalifikovano ime baca "column reference is ambiguous".
  if p_ref_id is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = p_reason and cl.ref_id = p_ref_id
  ) then
    return query select true, 'already_granted'; return;
  end if;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, p_amount, p_reason, p_ref_id);
  update profiles set credits_balance = credits_balance + p_amount where id = p_user;

  return query select true, 'granted';
end;
$$;

-- ── kreiraj profil i dodeli početne kredite ────────────────
-- Jedan atomičan poziv za Clerk webhook `user.created`. Krediti idu kroz
-- grant_credits, ne direktnim UPDATE-om (pravilo 3).
create or replace function create_profile_with_grant(
  p_user    text,
  p_email   text,
  p_credits integer,
  p_ref_id  text
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created boolean := false;
begin
  insert into profiles (id, email) values (p_user, p_email)
  on conflict (id) do update set email = coalesce(excluded.email, profiles.email);

  select not exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'monthly_grant'
  ) into v_created;

  if p_credits > 0 then
    perform grant_credits(p_user, p_credits, 'monthly_grant', p_ref_id);
  end if;

  return query select true, case when v_created then 'created' else 'existing' end;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. PRAVA NAD FUNKCIJAMA
-- ═══════════════════════════════════════════════════════════
-- [ODSTUPANJE — bezbednosno, nije opciono]
-- `security definer` funkcija je podrazumevano izvršiva za `public`. Da je
-- ostavim tako, bilo ko sa anon ključem bi mogao da pozove
-- spend_credit_and_unlock('user_tudji_id', ...) preko PostgREST-a i troši tuđe
-- kredite — RLS tu ne pomaže jer definer radi kao vlasnik.
-- Zato: samo service_role. Poziv uvek ide iz serverske rute, gde `p_user`
-- dolazi iz verifikovane Clerk sesije (pravilo 8).

revoke all on function spend_credit_and_unlock(text, text) from public, anon, authenticated;
revoke all on function grant_credits(text, integer, text, text) from public, anon, authenticated;
revoke all on function create_profile_with_grant(text, text, integer, text) from public, anon, authenticated;

grant execute on function spend_credit_and_unlock(text, text) to service_role;
grant execute on function grant_credits(text, integer, text, text) to service_role;
grant execute on function create_profile_with_grant(text, text, integer, text) to service_role;

-- ═══════════════════════════════════════════════════════════
-- 5. STORAGE
-- ═══════════════════════════════════════════════════════════
-- Bucket se pravi sada iako se puni tek u F5. PRIVATAN — javni bucket sa
-- predvidivim imenima (`{place_id}.webp`) znači da vizualni deo baze može
-- enumerisati bilo ko (P0-3).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('screenshots', 'screenshots', false)
    on conflict (id) do nothing;
  end if;
end $$;
