-- 0020_f3_performanse.sql — Faza 3 iz docs/PLAN-IZMENA.md: performanse
--
-- Četiri grupe izmena, nijedna ne dira postojeće podatke:
--
--   3.2  `job_queue.found/analyzed` + `get_job_for_user` RPC — polling posla je
--        JEDAN upit umesto četiri (P3)
--   3.3  `search_cache.total/no_site` brojači + trigger na website_audits —
--        nema više pune agregacije po zahtevu (P6); pogled se briše
--   3.4  `search_listing` RPC — filter/sort/limit u SQL-u (P2)
--   3.5  tri indeksa (B7, B8, B9)

-- ═══════════════════════════════════════════════════════════
-- 3.2 Napredak posla na redu
-- ═══════════════════════════════════════════════════════════

alter table job_queue add column if not exists found    integer;
alter table job_queue add column if not exists analyzed integer;

/**
 * Status posla za JEDAN upit — pretplata i red u istoj transakciji.
 *
 * Stari put: `isSubscribed` (RLS upit) + čitanje `job_queue` + dva upita
 * `scanProgress` nad `businesses`/`website_audits` = ~4 upita po pollingu
 * (P3). Sada worker upisuje `found`/`analyzed` na red, a ovaj RPC vraća sve
 * u jednom. `p_user` dolazi sa verifikovane sesije (pravilo 8), isto kao što
 * je `isSubscribed` dobijao korisnika kroz RLS.
 */
create or replace function get_job_for_user(p_job_id bigint, p_user text)
returns table (
  id           bigint,
  type         text,
  status       text,
  attempts     integer,
  max_attempts integer,
  created_at   timestamptz,
  finished_at  timestamptz,
  last_error   text,
  found        integer,
  analyzed     integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select q.id, q.type, q.status, q.attempts, q.max_attempts,
         q.created_at, q.finished_at, q.last_error, q.found, q.analyzed
  from job_queue q
  where q.id = p_job_id
    and exists (
      select 1 from job_subscribers s
      where s.job_id = q.id and s.user_id = p_user
    )
$$;

/** Enrich_basic upisao audit → diže `analyzed` roditeljskog scan posla. */
create or replace function inkrementiraj_analizu(p_job_id bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update job_queue set analyzed = coalesce(analyzed, 0) + 1 where id = p_job_id
$$;

-- ═══════════════════════════════════════════════════════════
-- 3.3 search_cache brojači umesto pogleda
-- ═══════════════════════════════════════════════════════════

alter table search_cache add column if not exists total   integer not null default 0;
alter table search_cache add column if not exists no_site integer not null default 0;

/**
 * Održava `search_cache.no_site` pri svakom upisu/izmeni `site_status`.
 *
 * Pogled `search_cache_stats` je agregirao CELE tabele na svaki poziv (P6).
 * Brojači žive na redu kombinacije: `total` puni `record_scan` (jedini pisac
 * biznisa za kombinaciju), a `no_site` ovaj trigger — svaki put kad audit
 * promeni status, broj se preračuna za kombinaciju tog biznisa.
 */
create or replace function maintain_search_cache_no_site() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_country text;
  v_city    text;
  v_niche   text;
begin
  select b.country_code, b.city_slug, b.niche_slug
    into v_country, v_city, v_niche
  from businesses b
  where b.place_id = new.place_id;

  -- Biznis bez niše ili bez reda ne pripada nijednoj kombinaciji; nema šta da
  -- se osveži. (Biznis koji je obrisan usred upisa audita ne može da postoji —
  -- FK je na businesses.)
  if v_niche is null then
    return new;
  end if;

  update search_cache sc
  set total = (
        select count(*)::int
        from businesses b
        where b.country_code = v_country
          and b.city_slug = v_city
          and b.niche_slug = v_niche
      ),
      no_site = (
        select count(*)::int
        from businesses b
        left join website_audits wa on wa.place_id = b.place_id
        where b.country_code = v_country
          and b.city_slug = v_city
          and b.niche_slug = v_niche
          and wa.site_status = 'nema_sajt'
      )
  where sc.country_code = v_country
    and sc.city_slug = v_city
    and sc.niche_slug = v_niche;

  return new;
end;
$$;

drop trigger if exists trg_maintain_search_cache_no_site on website_audits;
create trigger trg_maintain_search_cache_no_site
  after insert or update of site_status on website_audits
  for each row execute function maintain_search_cache_no_site();

/**
 * `record_scan` sada uz registar upisuje i brojače za kombinaciju.
 *
 * `total` je broj redova u `businesses` za kombinaciju (isto što je brojao
 * pogled); `no_site` preuzima trigger iznad, a ovde se upisuje i početno
 * stanje za kombinacije koje nikad nisu imale audit-upis.
 */
create or replace function record_scan(
  p_country text,
  p_city    text,
  p_niche   text,
  p_count   integer,
  p_job_id  bigint default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stamp  timestamptz := now();
  v_total  integer;
  v_no_site integer;
begin
  if coalesce(p_count, 0) <= 0 then
    select max(b.google_refreshed_at) into v_stamp
    from businesses b
    where b.country_code = p_country
      and b.city_slug = p_city
      and b.niche_slug = p_niche;

    -- Nema nijednog reda → kombinacija je stvarno prazna i to se pamti od sada.
    v_stamp := coalesce(v_stamp, now());
  end if;

  select count(*) into v_total
  from businesses b
  where b.country_code = p_country
    and b.city_slug = p_city
    and b.niche_slug = p_niche;

  select count(*) into v_no_site
  from businesses b
  left join website_audits wa on wa.place_id = b.place_id
  where b.country_code = p_country
    and b.city_slug = p_city
    and b.niche_slug = p_niche
    and wa.site_status = 'nema_sajt';

  insert into search_cache (country_code, city_slug, niche_slug, last_scanned_at,
                            last_results_count, scan_count, last_job_id,
                            total, no_site)
  values (p_country, p_city, p_niche, v_stamp, greatest(coalesce(p_count, 0), 0), 1,
          p_job_id, v_total, v_no_site)
  on conflict (country_code, city_slug, niche_slug) do update
    set last_scanned_at = greatest(search_cache.last_scanned_at, excluded.last_scanned_at),
        -- Rezultat POSLEDNJEG skeniranja, ne broj redova u bazi.
        last_results_count = excluded.last_results_count,
        scan_count = search_cache.scan_count + 1,
        last_job_id = coalesce(excluded.last_job_id, search_cache.last_job_id),
        total = excluded.total,
        no_site = excluded.no_site;
end;
$$;

-- `search_cache_state` i `search_cache_overview` čitaju brojače sa reda umesto
-- pogleda; ista šema odgovora, nijedna izmena u web sloju.
create or replace function search_cache_state(
  p_country  text,
  p_city     text,
  p_niche    text,
  p_ttl_days integer default 30
)
returns table (
  scanned_at timestamptz,
  fresh      boolean,
  total      integer,
  no_site    integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select sc.last_scanned_at,
         coalesce(sc.last_scanned_at > now() - make_interval(days => p_ttl_days), false),
         coalesce(sc.total, 0),
         coalesce(sc.no_site, 0)
  from (select 1) one
  left join search_cache sc
    on sc.country_code = p_country and sc.city_slug = p_city and sc.niche_slug = p_niche;
$$;

create or replace function search_cache_overview(
  p_user     text,
  p_country  text default 'RS',
  p_ttl_days integer default 30
)
returns table (
  city_slug  text,
  niche_slug text,
  total      integer,
  no_site    integer,
  scanned_at timestamptz,
  fresh      boolean,
  mine       boolean
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select sc.city_slug,
         sc.niche_slug,
         coalesce(sc.total, 0),
         coalesce(sc.no_site, 0),
         sc.last_scanned_at,
         sc.last_scanned_at > now() - make_interval(days => p_ttl_days),
         exists (
           select 1 from searches s
           where s.user_id = p_user
             and s.country_code = sc.country_code
             and s.city_slug = sc.city_slug
             and s.niche_slug = sc.niche_slug
         )
  from search_cache sc
  where sc.country_code = p_country
  order by (sc.last_scanned_at > now() - make_interval(days => p_ttl_days)) desc,
           coalesce(sc.total, 0) desc,
           sc.last_scanned_at desc;
$$;

-- Pogled više niko ne čita; brisanje sprečava da se puna agregacija vrati
-- kroz neki budući upit koji ga slučajno pozove.
drop view if exists search_cache_stats;

-- ═══════════════════════════════════════════════════════════
-- 3.4 Pretraga u SQL-u
-- ═══════════════════════════════════════════════════════════

/**
 * Stranica pretrage — filter, sort i limit u JEDNOM upitu (P2).
 *
 * Stari put je povlačio do 1200 biznisa + audite u dva upita, filterisao i
 * sortirao u JS-u, i ponavljao to na svakom pollingu. Ovaj RPC vraća samo
 * traženu stranicu (limit/offset) zajedno sa agregatima cele filtrirane
 * kombinacije (window funkcije, računaju se PRE limita).
 *
 * Sort je isti kao u TS-u: po statusu (nema_sajt < mrtav < samo_drustvene <
 * ok < bez audita), pa po `ugly_score` opadajuće (null posle), pa po imenu,
 * pa po place_id kao konačnom razvezivaču (stabilne stranice).
 */
create or replace function search_listing(
  p_country      text,
  p_city         text,
  p_niche        text,
  p_only_no_site boolean,
  p_only_social  boolean,
  p_only_dead    boolean,
  p_min_score    integer,
  p_page         integer,
  p_page_size    integer
)
returns table (
  place_id            text,
  name                text,
  address             text,
  phone               text,
  phone_type          text,
  website_url         text,
  rating              numeric,
  user_ratings_total  integer,
  google_refreshed_at timestamptz,
  site_status         text,
  ugly_score          integer,
  ugly_band           text,
  platform            text,
  signals             jsonb,
  emails              text[],
  screenshot_desktop  text,
  screenshot_mobile   text,
  psi_mobile_score    integer,
  psi_lcp_ms          integer,
  ai_issues           jsonb,
  ai_verdict          text,
  ai_solidan          boolean,
  total               integer,
  no_site             integer,
  social              integer,
  dead                integer,
  ugly                integer,
  ok                  integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select b.place_id,
         b.name,
         b.address,
         b.phone,
         b.phone_type,
         b.website_url,
         b.rating,
         b.user_ratings_total,
         b.google_refreshed_at,
         wa.site_status,
         wa.ugly_score,
         wa.ugly_band,
         wa.platform,
         wa.signals,
         wa.emails,
         wa.screenshot_desktop,
         wa.screenshot_mobile,
         wa.psi_mobile_score,
         wa.psi_lcp_ms,
         wa.ai_issues,
         wa.ai_verdict,
         wa.ai_solidan,
         count(*) over ()::int,
         count(*) filter (where wa.site_status = 'nema_sajt') over ()::int,
         count(*) filter (where wa.site_status = 'samo_drustvene') over ()::int,
         count(*) filter (where wa.site_status = 'mrtav') over ()::int,
         count(*) filter (where wa.site_status = 'ok' and wa.ugly_band in ('ruzan', 'katastrofa')) over ()::int,
         count(*) filter (where wa.site_status = 'ok' and wa.ugly_band not in ('ruzan', 'katastrofa')) over ()::int
  from businesses b
  left join website_audits wa on wa.place_id = b.place_id
  where b.country_code = p_country
    and b.city_slug = p_city
    and b.niche_slug = p_niche
    and (not p_only_no_site or wa.site_status = 'nema_sajt')
    and (not p_only_social or wa.site_status = 'samo_drustvene')
    and (not p_only_dead or wa.site_status = 'mrtav')
    and (p_min_score is null or (wa.ugly_score is not null and wa.ugly_score >= p_min_score))
  order by case wa.site_status
             when 'nema_sajt' then 0
             when 'mrtav' then 1
             when 'samo_drustvene' then 2
             when 'ok' then 3
             else 4
           end,
           wa.ugly_score desc nulls last,
           b.name,
           b.place_id
  limit p_page_size offset ((p_page - 1) * p_page_size)
$$;

-- ═══════════════════════════════════════════════════════════
-- 3.5 Indeksi (B7, B8, B9)
-- ═══════════════════════════════════════════════════════════

-- /krediti čita knjigu po korisniku, najnovije prvo — stari (user_id) je
-- prefiks novog, pa se zamenjuje.
drop index if exists credit_ledger_user_idx;
create index if not exists credit_ledger_user_created_idx
  on credit_ledger (user_id, created_at desc);

-- Tempo admina (120/h) broji redove aktera u poslednjih sat vremena.
create index if not exists admin_audit_actor_idx
  on admin_audit (actor_id, created_at desc);

-- Uvoz traži kandidate po city_slug bez country_code (vodeća kolona
-- businesses_city_niche_idx je country_code, pa ga taj indeks ne pokriva).
create index if not exists businesses_city_slug_idx
  on businesses (city_slug);

-- ═══════════════════════════════════════════════════════════
-- PRAVA
-- ═══════════════════════════════════════════════════════════

revoke all on function get_job_for_user(bigint, text) from public, anon, authenticated;
revoke all on function inkrementiraj_analizu(bigint) from public, anon, authenticated;
revoke all on function search_listing(text, text, text, boolean, boolean, boolean, integer, integer, integer) from public, anon, authenticated;

grant execute on function get_job_for_user(bigint, text) to service_role;
grant execute on function inkrementiraj_analizu(bigint) to service_role;
grant execute on function search_listing(text, text, text, boolean, boolean, boolean, integer, integer, integer) to service_role;
