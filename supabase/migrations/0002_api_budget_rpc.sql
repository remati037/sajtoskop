-- 0002_api_budget_rpc.sql — F3: brojač Google poziva iz fajla u bazu
--
-- Izvor: docs/F3-worker.md, sekcije 3 i 7.
--
-- Zašto: CLI i worker su brojali u odvojenim `.cache/api-budget.json` fajlovima
-- na odvojenim mašinama. U trenutku kad je worker otišao na Hetzner, mesečni cap
-- od 900 poziva je faktički prestao da postoji — dva brojača, svaki ubeđen da je
-- jedini. Jedan red u bazi po LA danu je jedini način da cap bude stvaran.
--
-- ── LA DAN SE RAČUNA OVDE, NE U KLIJENTU ──────────────────────────────────
-- Google resetuje kvotu u ponoć po America/Los_Angeles (09:00 u Beogradu).
-- Da dan stiže kao parametar, pogrešan sat ili TZ na kontejneru bi upisao u
-- pogrešan dan i cap bi tiho propuštao — to je bug koji je već jednom pojeo
-- kvotu. `budgetDay()` u TypeScriptu ostaje netaknut, ali služi samo za poruke
-- korisniku; `pnpm check:sql` tvrdi da se dve implementacije slažu do u dan.
--
-- Kapovi (75/900) stižu kao parametri iz packages/shared/src/plans.ts.
-- Podrazumevane vrednosti ovde su samo mreža za pad ako neko pozove funkciju
-- ručno iz SQL konzole.

-- ═══════════════════════════════════════════════════════════
-- 1. ŠEMA
-- ═══════════════════════════════════════════════════════════

-- Raspodela po SKU-u. U F3 postoji samo `places:searchText`, ali u F6 stižu
-- PageSpeed i Claude, a svaki je svoj SKU sa svojim besplatnim pragom. Kolona
-- se dodaje sada da se kasnije ne migrira tabela koja se piše na svaki poziv.
alter table api_budget add column if not exists by_kind jsonb not null default '{}'::jsonb;

-- ═══════════════════════════════════════════════════════════
-- 2. VREME PO GOOGLEOVOJ ZONI
-- ═══════════════════════════════════════════════════════════
-- Sve četiri su `stable`, ne `immutable`: tzdata se menja između verzija
-- Postgresa, a nijedna od njih ne stoji u indeksu pa nam immutable ne treba.

/** Dan po kome Google resetuje kvotu. Jedini autoritet u celom sistemu. */
create or replace function budget_day(p_at timestamptz default now())
returns date
language sql
stable
set search_path = public, pg_temp
as $$ select (p_at at time zone 'America/Los_Angeles')::date $$;

/** Mesec po kome Google resetuje besplatni prag. Format YYYY-MM. */
create or replace function budget_month(p_day date)
returns text
language sql
stable
set search_path = public, pg_temp
as $$ select to_char(p_day, 'YYYY-MM') $$;

/** Ponoć posle `p_day` po LA — trenutak kad se dnevni brojač resetuje. */
create or replace function budget_next_day_reset(p_day date)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$ select (p_day + 1)::timestamp at time zone 'America/Los_Angeles' $$;

/** Prvi sledećeg meseca po LA — trenutak kad Google vraća besplatni prag. */
create or replace function budget_next_month_reset(p_day date)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select (date_trunc('month', p_day::timestamp) + interval '1 month')
         at time zone 'America/Los_Angeles'
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. POTROŠNJA
-- ═══════════════════════════════════════════════════════════

-- Rezerviše TAČNO JEDAN HTTP poziv. Zove se neposredno pre svakog fetcha,
-- uključujući svaku stranicu paginacije (CLAUDE.md, sekcija Budžet).
--
-- Vraća `ok = false` umesto da baca izuzetak: pozivalac na osnovu `reason` i
-- `retry_after` odlučuje da li posao ide u `pending` za sutra ili za prvi u
-- mesecu. Izuzetak bi tu razliku pojeo.
--
-- NAPOMENA o imenima izlaznih polja: `pt_day` i `pt_month`, ne `day` i `month`.
-- Izlazna polja plpgsql funkcije su promenljive u opsegu tela, pa bi `day`
-- zasenio kolonu `api_budget.day` — `on conflict (day)` bi pukao sa „column
-- reference is ambiguous". Prefiks usput govori i da je dan po Pacifiku.
create or replace function consume_api_call(
  p_kind        text    default 'places:searchText',
  p_daily_cap   integer default 75,
  p_monthly_cap integer default 900
)
returns table (
  ok          boolean,
  reason      text,     -- consumed | daily_cap | monthly_cap | exhausted
  pt_day      date,
  pt_month    text,
  day_calls   integer,
  month_calls integer,
  retry_after timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day         date := budget_day();
  v_month       text;
  v_day_calls   integer;
  v_month_calls integer;
  v_exhausted   timestamptz;
begin
  v_month := budget_month(v_day);

  insert into api_budget (day, month) values (v_day, v_month)
  on conflict (day) do nothing;

  -- Zaključaj sve dane ovog meseca, uvek istim redosledom. Bez `order by` dva
  -- paralelna radnika mogu da se zaključaju unakrsno; bez `for update` bi
  -- `sum()` ispod video stanje pre tuđeg inkrementa i mesečni cap bi se probio
  -- za onoliko koliko ima paralelnih radnika. Meseca je najviše 31 red, pa je
  -- ovo jeftino zaključavanje koje serijalizuje samo Google pozive.
  perform 1 from api_budget
  where api_budget.month = v_month
  order by api_budget.day
  for update;

  select coalesce(sum(api_budget.calls), 0) into v_month_calls
  from api_budget where api_budget.month = v_month;

  select api_budget.calls, api_budget.exhausted_at
  into v_day_calls, v_exhausted
  from api_budget where api_budget.day = v_day;

  -- 429 od Googlea zaključava ceo PT dan. Dalji pozivi sigurno padaju.
  if v_exhausted is not null then
    return query select false, 'exhausted', v_day, v_month,
                        v_day_calls, v_month_calls, budget_next_day_reset(v_day);
    return;
  end if;

  -- Mesečni je TVRDA granica — ispod Googleovog besplatnog praga. Proverava se
  -- pre dnevnog jer nosi bitno drugačiji `retry_after`: prvi u mesecu, ne sutra.
  if v_month_calls >= p_monthly_cap then
    return query select false, 'monthly_cap', v_day, v_month,
                        v_day_calls, v_month_calls, budget_next_month_reset(v_day);
    return;
  end if;

  -- Dnevni je MEKA granica — zaštita od odbeglog skripta, ne budžet.
  if v_day_calls >= p_daily_cap then
    return query select false, 'daily_cap', v_day, v_month,
                        v_day_calls, v_month_calls, budget_next_day_reset(v_day);
    return;
  end if;

  update api_budget
  set calls   = api_budget.calls + 1,
      by_kind = api_budget.by_kind || jsonb_build_object(
                  p_kind, coalesce((api_budget.by_kind ->> p_kind)::integer, 0) + 1)
  where api_budget.day = v_day
  returning api_budget.calls into v_day_calls;

  return query select true, 'consumed', v_day, v_month,
                      v_day_calls, v_month_calls + 1, null::timestamptz;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. STANJE, 429 I RUČNA SINHRONIZACIJA
-- ═══════════════════════════════════════════════════════════

/** Sve što treba za pre-flight proveru i za jedan red ispisa u CLI-u. */
create or replace function api_budget_status(
  p_daily_cap   integer default 75,
  p_monthly_cap integer default 900
)
returns table (
  pt_day          date,
  pt_month        text,
  day_calls       integer,
  month_calls     integer,
  exhausted       boolean,
  kinds           jsonb,
  daily_cap       integer,
  monthly_cap     integer,
  day_remaining   integer,
  month_remaining integer,
  days_left       integer   -- do kraja LA meseca, uključujući današnji
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day         date := budget_day();
  v_month       text;
  v_day_calls   integer := 0;
  v_month_calls integer := 0;
  v_exhausted   boolean := false;
  v_by_kind     jsonb := '{}'::jsonb;
  v_days_left   integer;
  v_month_rem   integer;
begin
  v_month := budget_month(v_day);

  select coalesce(sum(api_budget.calls), 0) into v_month_calls
  from api_budget where api_budget.month = v_month;

  select api_budget.calls, api_budget.exhausted_at is not null, api_budget.by_kind
  into v_day_calls, v_exhausted, v_by_kind
  from api_budget where api_budget.day = v_day;

  v_day_calls := coalesce(v_day_calls, 0);
  v_exhausted := coalesce(v_exhausted, false);
  v_by_kind   := coalesce(v_by_kind, '{}'::jsonb);

  -- Računanje po datumima, ne po +24h: LA dan traje 23h ili 25h dvaput godišnje.
  v_days_left := (date_trunc('month', v_day::timestamp) + interval '1 month')::date - v_day;
  v_month_rem := greatest(0, p_monthly_cap - v_month_calls);

  return query select
    v_day, v_month, v_day_calls, v_month_calls, v_exhausted, v_by_kind,
    p_daily_cap, p_monthly_cap,
    case when v_exhausted then 0
         else least(greatest(0, p_daily_cap - v_day_calls), v_month_rem) end,
    v_month_rem,
    v_days_left;
end;
$$;

/** Na 429 od Googlea. Zaključava tekući PT dan; prvi `exhausted_at` ostaje. */
create or replace function mark_api_exhausted()
returns table (
  pt_day       date,
  pt_month     text,
  day_calls    integer,
  month_calls  integer,
  exhausted_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day   date := budget_day();
  v_month text;
begin
  v_month := budget_month(v_day);

  insert into api_budget (day, month, exhausted_at) values (v_day, v_month, now())
  on conflict (day) do update
    set exhausted_at = coalesce(api_budget.exhausted_at, now());

  return query
    select b.day, b.month, b.calls,
           (select coalesce(sum(m.calls), 0)::integer from api_budget m where m.month = v_month),
           b.exhausted_at
    from api_budget b where b.day = v_day;
end;
$$;

/**
 * Ručna sinhronizacija sa Google Cloud konzolom, i otključavanje posle lažnog
 * 429. `p_calls = null` znači „ne diraj brojač, samo skini katanac".
 */
create or replace function set_api_day_calls(
  p_calls           integer default null,
  p_day             date    default null,
  p_clear_exhausted boolean default false
)
returns table (
  pt_day       date,
  pt_month     text,
  day_calls    integer,
  month_calls  integer,
  exhausted_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day   date := coalesce(p_day, budget_day());
  v_month text;
begin
  v_month := budget_month(v_day);

  insert into api_budget (day, month, calls) values (v_day, v_month, coalesce(p_calls, 0))
  on conflict (day) do update
    set calls        = coalesce(p_calls, api_budget.calls),
        exhausted_at = case when p_clear_exhausted then null else api_budget.exhausted_at end;

  return query
    select b.day, b.month, b.calls,
           (select coalesce(sum(m.calls), 0)::integer from api_budget m where m.month = v_month),
           b.exhausted_at
    from api_budget b where b.day = v_day;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. PRAVA
-- ═══════════════════════════════════════════════════════════
-- Isto obrazloženje kao u 0001, sekcija 4: `security definer` je po difoltu
-- izvršiv za `public`, a `consume_api_call` menja globalni brojač koji čuva moj
-- novčanik. Bilo ko sa anon ključem bi mogao da ga pozove u petlji preko
-- PostgREST-a i pojede dnevni cap za sve korisnike. Samo service_role.

revoke all on function budget_day(timestamptz)                 from public, anon, authenticated;
revoke all on function budget_month(date)                      from public, anon, authenticated;
revoke all on function budget_next_day_reset(date)             from public, anon, authenticated;
revoke all on function budget_next_month_reset(date)           from public, anon, authenticated;
revoke all on function consume_api_call(text, integer, integer) from public, anon, authenticated;
revoke all on function api_budget_status(integer, integer)     from public, anon, authenticated;
revoke all on function mark_api_exhausted()                    from public, anon, authenticated;
revoke all on function set_api_day_calls(integer, date, boolean) from public, anon, authenticated;

grant execute on function budget_day(timestamptz)                 to service_role;
grant execute on function budget_month(date)                      to service_role;
grant execute on function budget_next_day_reset(date)             to service_role;
grant execute on function budget_next_month_reset(date)           to service_role;
grant execute on function consume_api_call(text, integer, integer) to service_role;
grant execute on function api_budget_status(integer, integer)     to service_role;
grant execute on function mark_api_exhausted()                    to service_role;
grant execute on function set_api_day_calls(integer, date, boolean) to service_role;
