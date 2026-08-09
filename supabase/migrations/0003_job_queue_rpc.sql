-- 0003_job_queue_rpc.sql — F3: red poslova i dnevni cache-miss limit
--
-- Izvor: docs/F3-worker.md, sekcije 1, 4 i 5.
--
-- Ceo protokol reda je ovde, ne u TypeScriptu. Razlog: `for update skip locked`,
-- backoff i vraćanje zaglavljenih poslova su operacije nad stanjem koje deli
-- više procesa. U TS-u bi svaka od njih bila „pročitaj pa upiši", a između to
-- dvoje stane drugi radnik.
--
-- ═══════════════════════════════════════════════════════════
-- 1. ŠEMA
-- ═══════════════════════════════════════════════════════════

-- Ključ za sprečavanje duplog posla. Za `scan` je to 'RS:sabac:pvc-stolarija'.
-- [ODSTUPANJE od PRD-a, budžetsko] Bez ovoga dva korisnika koja u istom minutu
-- traže isti grad i nišu prave dva scana, dakle do 6 Places poziva umesto 3.
-- Cena greške je stvaran novac, pa dedup nije optimizacija nego zaštita.
alter table job_queue add column if not exists dedupe_key text;

-- Jedinstven samo dok posao ŽIVI. Kad završi, isti ključ sme ponovo — inače se
-- ista kombinacija ne bi mogla skenirati drugi put ni za mesec dana.
create unique index if not exists job_queue_dedupe_live_idx
  on job_queue (type, dedupe_key)
  where dedupe_key is not null and status in ('pending', 'running');

-- Ko čeka rezultat posla.
--
-- [ODSTUPANJE od PRD-a §5] PRD kaže da se `user_id` iz sesije poredi sa onim u
-- payloadu. To se lomi o dedup iznad: kad drugi korisnik dobije ID postojećeg
-- posla, u payloadu stoji tuđi `userId` i njegovo pollovanje bi vratilo 403.
-- Zato vlasništvo ide u zasebnu tabelu — jedan posao, više pretplatnika.
create table if not exists job_subscribers (
  job_id     bigint not null references job_queue(id) on delete cascade,
  user_id    text   not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

create index if not exists job_subscribers_user_idx
  on job_subscribers (user_id, created_at desc);

alter table job_subscribers enable row level security;

drop policy if exists "own subscriptions" on job_subscribers;
create policy "own subscriptions" on job_subscribers
  for select to authenticated using (user_id = auth.jwt() ->> 'sub');

-- ═══════════════════════════════════════════════════════════
-- 2. UPIS POSLA
-- ═══════════════════════════════════════════════════════════

/**
 * Ubaci posao ili se prikači na već postojeći isti.
 *
 * `joined = true` znači da posao već postoji i da se pozivalac samo pretplatio.
 * Web na osnovu toga korisniku kaže „već se obrađuje", a ne „pokrenuto".
 */
create or replace function enqueue_job(
  p_type       text,
  p_payload    jsonb,
  p_dedupe_key text default null,
  p_user       text default null,
  p_run_after  timestamptz default now()
)
returns table (job_id bigint, joined boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     bigint;
  v_joined boolean := false;
begin
  if p_dedupe_key is not null then
    -- `for update` da dva paralelna upisa ne prođu oba kroz „nema ga".
    select q.id into v_id
    from job_queue q
    where q.type = p_type
      and q.dedupe_key = p_dedupe_key
      and q.status in ('pending', 'running')
    order by q.id
    limit 1
    for update;

    v_joined := v_id is not null;
  end if;

  if v_id is null then
    insert into job_queue (type, payload, dedupe_key, run_after)
    values (p_type, p_payload, p_dedupe_key, p_run_after)
    returning job_queue.id into v_id;
  end if;

  if p_user is not null then
    insert into job_subscribers (job_id, user_id) values (v_id, p_user)
    on conflict do nothing;
  end if;

  return query select v_id, v_joined;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. PREUZIMANJE I ZAVRŠETAK
-- ═══════════════════════════════════════════════════════════

/**
 * Preuzmi jedan posao. Atomično, bez blokiranja drugih radnika.
 *
 * `skip locked` je razlog zbog kog WORKER_CONCURRENCY=3 radi bez ijednog reda
 * koordinacije u aplikaciji: tri konekcije uzmu tri različita posla ili nijedan.
 */
create or replace function claim_job()
returns setof job_queue
language sql
security definer
set search_path = public, pg_temp
as $$
  update job_queue
  set status = 'running', locked_at = now(), attempts = attempts + 1
  where id = (
    select q.id from job_queue q
    where q.status = 'pending' and q.run_after <= now()
    order by q.id
    for update skip locked
    limit 1
  )
  returning *;
$$;

/** Posao je prošao. */
create or replace function complete_job(p_id bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update job_queue
  set status = 'done', finished_at = now(), last_error = null, locked_at = null
  where id = p_id;
$$;

/**
 * Posao je pukao. Backoff je 2^attempts minuta, pa 2, 4, 8 za max_attempts = 3.
 * Posle poslednjeg pokušaja ide u `failed` i `last_error` ostaje kao trag.
 */
create or replace function fail_job(p_id bigint, p_error text)
returns table (final boolean, next_run timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
  v_max      integer;
  v_next     timestamptz;
begin
  select q.attempts, q.max_attempts into v_attempts, v_max
  from job_queue q where q.id = p_id for update;

  if not found then
    return query select true, null::timestamptz;
    return;
  end if;

  if v_attempts >= v_max then
    update job_queue
    set status = 'failed', finished_at = now(), locked_at = null,
        last_error = left(p_error, 2000)
    where id = p_id;
    return query select true, null::timestamptz;
    return;
  end if;

  v_next := now() + (interval '1 minute' * power(2, v_attempts));

  update job_queue
  set status = 'pending', locked_at = null, run_after = v_next,
      last_error = left(p_error, 2000)
  where id = p_id;

  return query select false, v_next;
end;
$$;

/**
 * Odloži posao bez trošenja pokušaja.
 *
 * Postoji zbog budžeta: kad `consume_api_call` odbije poziv, posao nije pukao
 * nego čeka reset kvote. `claim_job` je već uvećao `attempts`, pa se ovde vraća
 * unazad — inače bi tri dana čekanja na mesečni reset pojela sva tri pokušaja i
 * posao bi umro pre nego što kvota uopšte stigne.
 */
create or replace function defer_job(
  p_id        bigint,
  p_run_after timestamptz,
  p_note      text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update job_queue
  set status     = 'pending',
      locked_at  = null,
      run_after  = greatest(p_run_after, now() + interval '10 seconds'),
      attempts   = greatest(0, attempts - 1),
      last_error = left(p_note, 2000)
  where id = p_id;
$$;

/**
 * Vrati zaglavljene poslove u red. Worker ovo zove na svakih 5 minuta.
 *
 * Zaglavljen = `running` duže od 15 minuta. To znači da je proces koji ga drži
 * ubijen (deploy, OOM, restart mašine) — Postgres o tome ne zna ništa jer je
 * `locked_at` običan podatak, ne brava.
 */
create or replace function reap_stuck_jobs(p_minutes integer default 15)
returns table (requeued integer, failed integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requeued integer;
  v_failed   integer;
  v_cutoff   timestamptz := now() - (interval '1 minute' * p_minutes);
begin
  -- Onaj koji je iscrpeo pokušaje ne vraćaj u krug — vrteo bi se zauvek.
  with dead as (
    update job_queue
    set status = 'failed', finished_at = now(), locked_at = null,
        last_error = format('zaglavljen duže od %s min, bez preostalih pokušaja', p_minutes)
    where status = 'running' and locked_at < v_cutoff and attempts >= max_attempts
    returning 1
  )
  select count(*)::integer into v_failed from dead;

  with revived as (
    update job_queue
    set status = 'pending', locked_at = null, run_after = now(),
        last_error = format('zaglavljen duže od %s min, vraćen u red', p_minutes)
    where status = 'running' and locked_at < v_cutoff
    returning 1
  )
  select count(*)::integer into v_requeued from revived;

  return query select v_requeued, v_failed;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. DNEVNI CACHE-MISS LIMIT PO KORISNIKU
-- ═══════════════════════════════════════════════════════════

/**
 * Rezerviši jednu cache-miss pretragu. Poziva se IZ WEBA, pre upisa posla
 * (F3 §4) — worker o ovome ne zna ništa.
 *
 * Dan je LA dan, isti onaj po kome se resetuje Google kvota. Lokalni datum
 * korisnika je namerno nebitan: limit štiti moju kvotu, ne njegov kalendar.
 *
 * Reset i inkrement su u istoj transakciji sa `for update` nad profilom — bez
 * toga bi dva paralelna zahteva u ponoć oba videla stari dan i oba resetovala.
 */
create or replace function claim_cache_miss(p_user text, p_limit integer)
returns table (ok boolean, reason text, used integer, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day   date := budget_day();
  v_count integer;
  v_prev  date;
begin
  select p.cache_miss_count, p.cache_miss_day into v_count, v_prev
  from profiles p where p.id = p_user for update;

  if not found then
    return query select false, 'no_user', 0, 0, budget_next_day_reset(v_day);
    return;
  end if;

  if v_prev is distinct from v_day then
    v_count := 0;
  end if;

  if v_count >= p_limit then
    return query select false, 'limit_reached', v_count, 0, budget_next_day_reset(v_day);
    return;
  end if;

  update profiles
  set cache_miss_day = v_day, cache_miss_count = v_count + 1
  where id = p_user;

  return query select true, 'claimed', v_count + 1, p_limit - v_count - 1,
                      budget_next_day_reset(v_day);
end;
$$;

/**
 * Vrati rezervaciju ako upis posla posle nje pukne. Bez ovoga bi korisnik
 * izgubio pretragu zbog greške koja nije njegova.
 */
create or replace function release_cache_miss(p_user text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update profiles
  set cache_miss_count = greatest(0, cache_miss_count - 1)
  where id = p_user and cache_miss_day = budget_day();
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. PRAVA
-- ═══════════════════════════════════════════════════════════
-- `claim_job` i `enqueue_job` menjaju red poslova koji troši Google kvotu.
-- Isto obrazloženje kao u 0001 §4 i 0002 §5: samo service_role.

revoke all on function enqueue_job(text, jsonb, text, text, timestamptz) from public, anon, authenticated;
revoke all on function claim_job()                        from public, anon, authenticated;
revoke all on function complete_job(bigint)               from public, anon, authenticated;
revoke all on function fail_job(bigint, text)             from public, anon, authenticated;
revoke all on function defer_job(bigint, timestamptz, text) from public, anon, authenticated;
revoke all on function reap_stuck_jobs(integer)           from public, anon, authenticated;
revoke all on function claim_cache_miss(text, integer)    from public, anon, authenticated;
revoke all on function release_cache_miss(text)           from public, anon, authenticated;

grant execute on function enqueue_job(text, jsonb, text, text, timestamptz) to service_role;
grant execute on function claim_job()                        to service_role;
grant execute on function complete_job(bigint)               to service_role;
grant execute on function fail_job(bigint, text)             to service_role;
grant execute on function defer_job(bigint, timestamptz, text) to service_role;
grant execute on function reap_stuck_jobs(integer)           to service_role;
grant execute on function claim_cache_miss(text, integer)    to service_role;
grant execute on function release_cache_miss(text)           to service_role;
