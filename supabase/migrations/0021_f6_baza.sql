-- 0021_f6_baza.sql — Faza 6 iz docs/PLAN-IZMENA.md: baza, zadržavanje, higijena
--
-- Četiri grupe izmena:
--
--   6.1  per-red TTL u `search_listing` (pravilo 1): red stariji od 30 dana ne
--        izlazi iz pretrage, ma koliko kombinacija bila sveža (B1, opcija b)
--   6.2  prekid kaskade `website_audits`/`signed_events` od `businesses` —
--        brisanje jednog Google reda ne sme da uništi audite ni potpise (B2)
--   6.4  `search_cache.partial` — parcijalan scan se pamti kao takav (B5)
--   6.5  CHECK-ovi: `rating <= 5`, `http_status` 100–599,
--        `signed_events.country_code ^[A-Z]{2}$` (B10)
--
-- `record_scan` i `search_listing` menjaju ARGUMENTE (novi parametar sa
-- podrazumevanom vrednošću), pa se drop-uju pa prave ponovo — create or replace
-- bi napravio preopterećenu verziju. `search_cache_state`/`search_cache_overview`
-- NE menjaju oblik: `partial` se u web sloju čita direktno iz `search_cache`
-- (admin klijent), da se povratni tip funkcija iz 0009 ne dira.

-- ═══════════════════════════════════════════════════════════
-- 6.2 Prekid kaskade od `businesses`
-- ═══════════════════════════════════════════════════════════
-- `businesses` su Googleovi podaci sa TTL-om, ali se redovi NIKAD ne brišu —
-- stari red prosto ispadne iz pretrage (6.1). Ako se ikad obrišu, to mora biti
-- svesna odluka, ne kaskada: audit i potpis su intelektualna svojina (B2).

alter table website_audits drop constraint if exists website_audits_place_id_fkey;
alter table website_audits add constraint website_audits_place_id_fkey
  foreign key (place_id) references businesses(place_id) on delete restrict;

alter table signed_events drop constraint if exists signed_events_place_id_fkey;
alter table signed_events add constraint signed_events_place_id_fkey
  foreign key (place_id) references businesses(place_id) on delete restrict;

-- ═══════════════════════════════════════════════════════════
-- 6.4 `partial` u registru keša
-- ═══════════════════════════════════════════════════════════

alter table search_cache add column if not exists partial boolean not null default false;

drop function if exists record_scan(text, text, text, integer, bigint);

create or replace function record_scan(
  p_country text,
  p_city    text,
  p_niche   text,
  p_count   integer,
  p_job_id  bigint default null,
  p_partial boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stamp   timestamptz := now();
  v_total   integer;
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
                            total, no_site, partial)
  values (p_country, p_city, p_niche, v_stamp, greatest(coalesce(p_count, 0), 0), 1,
          p_job_id, v_total, v_no_site, p_partial)
  on conflict (country_code, city_slug, niche_slug) do update
    set last_scanned_at = greatest(search_cache.last_scanned_at, excluded.last_scanned_at),
        last_results_count = excluded.last_results_count,
        scan_count = search_cache.scan_count + 1,
        last_job_id = coalesce(excluded.last_job_id, search_cache.last_job_id),
        total = excluded.total,
        no_site = excluded.no_site,
        -- [Faza 6, 6.4] Parcijalan scan ostaje parcijalan do sledećeg PUNOG
        -- scana; `last_scanned_at` se ne pomera unazad, pa se ovaj uslov piše
        -- kao eksplicitna zamena, ne `or`.
        partial = excluded.partial;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6.1 Per-red TTL u pretrazi
-- ═══════════════════════════════════════════════════════════
-- Pravilo 1, opcija (b) iz REVIZIJA B1: kombinacija može da bude sveža, a neki
-- njeni redovi stari (biznis koji je poslednji scan ispustio iz rezultata).
-- Red stariji od `p_ttl_days` ne izlazi iz pretrage — telefon i mejl se ne
-- serviraju kao sveži kad su možda promenjeni. Odluka zapisana u SESIJE (S14).

drop function if exists search_listing(text, text, text, boolean, boolean, boolean, integer, integer, integer);

create or replace function search_listing(
  p_country      text,
  p_city         text,
  p_niche        text,
  p_only_no_site boolean,
  p_only_social  boolean,
  p_only_dead    boolean,
  p_min_score    integer,
  p_page         integer,
  p_page_size    integer,
  p_ttl_days     integer default 30
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
    -- [Faza 6, 6.1] Per-red TTL (pravilo 1): stari Google podatak ne izlazi iz
    -- pretrage ni u svežoj kombinaciji.
    and b.google_refreshed_at >= now() - make_interval(days => p_ttl_days)
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
-- 6.5 CHECK ograničenja (B10)
-- ═══════════════════════════════════════════════════════════

alter table businesses drop constraint if exists businesses_rating_max;
alter table businesses add constraint businesses_rating_max
  check (rating is null or rating <= 5);

alter table website_audits drop constraint if exists website_audits_http_status_range;
alter table website_audits add constraint website_audits_http_status_range
  check (http_status is null or http_status between 100 and 599);

alter table signed_events drop constraint if exists signed_events_country_code_valid;
alter table signed_events add constraint signed_events_country_code_valid
  check (country_code ~ '^[A-Z]{2}$');

-- ═══════════════════════════════════════════════════════════
-- PRAVA (drop+create gubi privilegije, vraćaju se ovde)
-- ═══════════════════════════════════════════════════════════

revoke all on function record_scan(text, text, text, integer, bigint, boolean) from public, anon, authenticated;
revoke all on function search_cache_state(text, text, text, integer) from public, anon, authenticated;
revoke all on function search_cache_overview(text, text, integer) from public, anon, authenticated;
revoke all on function search_listing(text, text, text, boolean, boolean, boolean, integer, integer, integer, integer) from public, anon, authenticated;

grant execute on function record_scan(text, text, text, integer, bigint, boolean) to service_role;
grant execute on function search_cache_state(text, text, text, integer) to service_role;
grant execute on function search_cache_overview(text, text, integer) to service_role;
grant execute on function search_listing(text, text, text, boolean, boolean, boolean, integer, integer, integer, integer) to service_role;
