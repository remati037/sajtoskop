-- 0029_admin_neograniceno.sql — admin ne troši kredite.
--
-- Nalog sa `profiles.role = 'admin'` skenira, otvara keš i otključava bez
-- kredita. Pravilo 3 ostaje netaknuto: kredit se i dalje dira SAMO kroz ove dve
-- funkcije — admin grana u njima prosto ne upisuje ni knjigu ni balans.
--
-- ── zašto u bazi, a ne u ruti ───────────────────────────────
-- Ruta bi morala da preskoči RPC, a RPC je jedino mesto koje pod `for update`
-- upisuje `unlocks`, `search_access` i posao. Dva puta do istog reda su dva
-- mesta da se raziđu.
--
-- ── zašto uloga, a ne `ADMIN_BOOTSTRAP_IDS` ─────────────────
-- Baza env ne vidi. `stanjePristupa()` na webu čita istu kolonu (`admin` u
-- `ProfilZaPristup`), pa UI i naplata uvek kažu isto. Nalog koji je admin samo
-- po env-u troši kredite kao i do sada.
--
-- ── šta NIJE promenjeno ─────────────────────────────────────
--   · dnevni osigurač (`claim_cache_miss`) i globalni Places budžet — Google
--     poziv admina je isti novac kao i svačiji. Zato admin grana vraća
--     `charged = true` sa `cost = 0`: ruta za `charged = false` vraća dnevnu
--     rezervaciju, pa bi admin tim putem zaobišao osigurač.
--   · knjiga: admin nema redova `unlock`/`scan`. `credit_ledger_delta_nonzero`
--     ne pušta nulu, a red koji ništa ne menja nije stavka izvoda. Posledica:
--     `refund_scan` adminu nema šta da vrati, i to je tačno. „Već plaćen živ
--     posao" se za admina zato prepoznaje po `search_access.job_id`, ne po knjizi.
--   · potpisi i povratni oblici obe funkcije.

-- ═══════════════════════════════════════════════════════════
-- 1. OTKLJUČAVANJE (telo iz 0022 + admin grana)
-- ═══════════════════════════════════════════════════════════
create or replace function spend_credit_and_unlock(p_user text, p_place text)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance    integer;
  v_topup      integer;
  v_iz_balansa integer;
  v_admin      boolean;
begin
  -- FOR UPDATE zaključava red do kraja transakcije — 20 paralelnih poziva sa
  -- 1 kreditom i dalje daju tačno jedan 'unlocked'.
  select p.credits_balance, p.credits_topup, p.role = 'admin'
    into v_balance, v_topup, v_admin
  from profiles p where p.id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user'; return;
  end if;

  -- Već otključano → besplatno, ne naplaćuj dvaput (pravilo 4).
  if exists (select 1 from unlocks where user_id = p_user and place_id = p_place) then
    return query select true, 'already_unlocked'; return;
  end if;

  if not v_admin and v_balance + v_topup < 1 then
    return query select false, 'insufficient_credits'; return;
  end if;

  if not exists (select 1 from businesses where place_id = p_place) then
    return query select false, 'no_place'; return;
  end if;

  insert into unlocks (user_id, place_id) values (p_user, p_place);

  -- Admin: red u `unlocks` je sve. Ni knjiga ni balans.
  if v_admin then
    return query select true, 'unlocked'; return;
  end if;

  v_iz_balansa := least(1, greatest(v_balance, 0));

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, -1, 'unlock', p_place);

  update profiles
  set credits_balance = credits_balance - v_iz_balansa,
      credits_topup   = credits_topup - (1 - v_iz_balansa)
  where id = p_user;

  return query select true, 'unlocked';
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. SKENIRANJE I PRISTUP KEŠU (telo iz 0025 + admin grana)
-- ═══════════════════════════════════════════════════════════
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
  v_balance integer; v_topup integer; v_iz_balansa integer; v_admin boolean;
  v_pages integer := least(3, greatest(1, ceil(coalesce(p_max_results, 30) / 20.0)::int));
  v_cena integer; v_max integer; v_key text;
  v_live bigint; v_id bigint; v_joined boolean;
  v_access search_access%rowtype;
  v_cache record;
  v_cache_pages integer; v_expires timestamptz;
begin
  select p.credits_balance, p.credits_topup, p.role = 'admin'
    into v_balance, v_topup, v_admin
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

  -- 1. Keš svež i dovoljno dubok? → naplati (admin: ne), bez posla.
  select sc.last_scanned_at, sc.pages, sc.last_results_count, sc.partial into v_cache
    from search_cache sc
   where sc.country_code = p_country and sc.city_slug = p_city and sc.niche_slug = p_niche;
  if found and v_cache.last_scanned_at > now() - make_interval(days => p_ttl_days)
     and not coalesce(v_cache.partial, false)
     and v_cache.pages >= v_pages then
    v_cache_pages := least(v_pages, greatest(1, ceil(coalesce(v_cache.last_results_count,0) / 20.0)::int));
    v_cena := case when v_admin then 0 else v_cache_pages end;
    if v_balance + v_topup < v_cena then
      return query select false, 'insufficient_credits', null::bigint, false, false,
                          v_balance + v_topup, v_cena; return; end if;
    v_expires := v_cache.last_scanned_at + make_interval(days => p_ttl_days);
    if v_cena > 0 then
      insert into credit_ledger (user_id, delta, reason, ref_id)
        values (p_user, -v_cena, 'scan',
                'kes:' || p_country || ':' || p_city || ':' || p_niche || ':' ||
                to_char(now(), 'YYYYMMDDHH24MISSMS'));
      v_iz_balansa := least(v_cena, greatest(v_balance, 0));
      update profiles set credits_balance = credits_balance - v_iz_balansa,
                          credits_topup = credits_topup - (v_cena - v_iz_balansa)
       where id = p_user;
    end if;
    insert into search_access (user_id, country_code, city_slug, niche_slug, pages, expires_at, job_id)
      values (p_user, p_country, p_city, p_niche, v_pages, v_expires, null)
    on conflict (user_id, country_code, city_slug, niche_slug) do update
      set pages = excluded.pages, paid_at = now(), expires_at = excluded.expires_at, job_id = null;
    return query select true, 'cached', null::bigint, false, true,
                        v_balance + v_topup - v_cena, v_cena; return;
  end if;

  -- 2. Živ posao iste dubine koji je ovaj korisnik već platio (dupli klik).
  --    Admin nema red u knjizi, pa je njegov dokaz pristup vezan za taj posao.
  v_cena := case when v_admin then 0 else v_pages end;
  v_max := v_pages * 20;
  v_key := p_country || ':' || p_city || ':' || p_niche || ':p' || v_pages;
  select q.id into v_live from job_queue q
   where q.type = 'scan' and q.dedupe_key = v_key and q.status in ('pending','running')
   order by q.id limit 1 for update;
  if v_live is not null and (
    exists (select 1 from credit_ledger cl where cl.user_id = p_user
              and cl.reason = 'scan' and cl.ref_id = 'scan:' || v_live)
    or (v_admin and exists (select 1 from search_access a
                             where a.user_id = p_user and a.job_id = v_live))
  ) then
    insert into job_subscribers (job_id, user_id) values (v_live, p_user) on conflict do nothing;
    return query select true, 'already_paid', v_live, true, false, v_balance + v_topup, 0; return;
  end if;

  if v_balance + v_topup < v_cena then
    return query select false, 'insufficient_credits', null::bigint, false, false,
                        v_balance + v_topup, v_cena; return; end if;

  -- 3. Naplati (admin: ne) i upiši posao.
  select e.job_id, e.joined into v_id, v_joined
    from enqueue_job('scan', jsonb_build_object(
      'citySlug', p_city, 'nicheSlug', p_niche, 'userId', p_user,
      'countryCode', p_country, 'maxResults', v_max), v_key, p_user) e;
  if v_cena > 0 then
    insert into credit_ledger (user_id, delta, reason, ref_id)
      values (p_user, -v_cena, 'scan', 'scan:' || v_id);
    v_iz_balansa := least(v_cena, greatest(v_balance, 0));
    update profiles set credits_balance = credits_balance - v_iz_balansa,
                        credits_topup = credits_topup - (v_cena - v_iz_balansa)
     where id = p_user;
  end if;
  insert into search_access (user_id, country_code, city_slug, niche_slug, pages, expires_at, job_id)
    values (p_user, p_country, p_city, p_niche, v_pages, now() + make_interval(days => p_ttl_days), v_id)
  on conflict (user_id, country_code, city_slug, niche_slug) do update
    set pages = excluded.pages, paid_at = now(), expires_at = excluded.expires_at, job_id = excluded.job_id;
  return query select true, 'charged', v_id, coalesce(v_joined, false), true,
                      v_balance + v_topup - v_cena, v_cena;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 3. PRAVA
-- ═══════════════════════════════════════════════════════════
-- `create or replace` čuva prava, ali se ponavljaju — isti razlog kao u 0022 §10.
revoke all on function spend_credit_and_unlock(text, text) from public, anon, authenticated;
revoke all on function spend_credit_and_scan(text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function spend_credit_and_unlock(text, text) to service_role;
grant execute on function spend_credit_and_scan(text, text, text, text, integer, integer) to service_role;
