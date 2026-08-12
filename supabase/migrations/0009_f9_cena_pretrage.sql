-- 0009_f9_cena_pretrage.sql — F9: keš je besplatan, skeniranje košta kredit
--
-- Izvor: docs/F9-cena-pretrage.md, sekcije 1 i 2.
-- Odstupanja od pravila iz CLAUDE.md su namerna i objašnjena na licu mesta.
--
-- Ova migracija ne dira nijedan postojeći red sa leadovima. Jedino što piše u
-- zatečene podatke je backfill registra keša — i to iz `businesses`, tako da sve
-- što je danas u bazi ostane besplatno.

-- ═══════════════════════════════════════════════════════════
-- 1. REGISTAR KEŠA
-- ═══════════════════════════════════════════════════════════
-- Do sada je „da li je ovo u kešu" bilo izvedeno iz `businesses`: ima redova →
-- keširano je. To ne može da nosi naplatu iz dva razloga:
--
--   1. Kombinacija koju je Google skenirao i vratio nulu izgleda isto kao
--      neskenirana, pa bi se naplaćivala svakom radoznalom korisniku redom.
--   2. Svežina se čitala kao `max(google_refreshed_at)` nad redovima koje je
--      možda upisao neki drugi scan (isti place_id ume da dođe iz dve niše).
--
-- Zato registar postaje eksplicitan i jedini je izvor istine za TTL od 30 dana
-- KAD SE ODLUČUJE O NAPLATI. `businesses.google_refreshed_at` ostaje ono što
-- jeste — svežina pojedinačnog reda za pravilo 1.

create table if not exists search_cache (
  country_code       text not null default 'RS',
  city_slug          text not null,
  niche_slug         text not null,
  last_scanned_at    timestamptz not null default now(),
  last_results_count integer not null default 0,
  -- Koliko je puta ova kombinacija skenirana otkad registar postoji. Čist podatak
  -- za mene: pokazuje šta se traži, dakle šta vredi držati toplim.
  scan_count         integer not null default 0,
  last_job_id        bigint,
  created_at         timestamptz not null default now(),

  primary key (country_code, city_slug, niche_slug),

  constraint search_cache_country_valid check (country_code ~ '^[A-Z]{2}$'),
  constraint search_cache_count_nonneg check (last_results_count >= 0 and scan_count >= 0)
);

-- Lista „besplatnih pretraga" se čita sortirana po svežini, sa odsecanjem na 30 dana.
create index if not exists search_cache_scanned_idx
  on search_cache (country_code, last_scanned_at desc);

alter table search_cache enable row level security;
alter table search_cache force row level security;

-- Isti režim kao `businesses` (pravilo 10): čitanje isključivo kroz API rutu,
-- nikad direktno iz pregledača. Nema politike — `using (false)` po odsustvu.

-- ═══════════════════════════════════════════════════════════
-- 2. BACKFILL
-- ═══════════════════════════════════════════════════════════
-- Sve što je zatečeno u bazi mora da ostane besplatno. Bez ovoga bi prvog dana
-- posle deploya svaka postojeća kombinacija tražila kredit — uključujući one
-- koje su korisnici već „platili" starim dnevnim limitom.

insert into search_cache (country_code, city_slug, niche_slug, last_scanned_at, last_results_count)
select b.country_code, b.city_slug, b.niche_slug,
       max(b.google_refreshed_at), count(*)::int
from businesses b
where b.niche_slug is not null
group by b.country_code, b.city_slug, b.niche_slug
on conflict (country_code, city_slug, niche_slug) do nothing;

-- ═══════════════════════════════════════════════════════════
-- 3. BROJAČI ZA LISTU
-- ═══════════════════════════════════════════════════════════
-- `total` i `no_site` se namerno NE denormalizuju u `search_cache`: audit stiže
-- minutima posle scana (`enrich_basic` je poseban posao), pa bi broj upisan u
-- trenutku scana bio pogrešan tačno onoliko koliko je lista zanimljiva.
--
-- `security_invoker = on` nije ukras. Bez njega pogled radi sa pravima vlasnika
-- i tiho zaobilazi `using (false)` na `businesses` — jedan `select` iz pregledača
-- i ceo pravilo 10 pada.

create or replace view search_cache_stats
with (security_invoker = on) as
  select b.country_code,
         b.city_slug,
         b.niche_slug,
         count(*)::int as total,
         count(*) filter (where wa.site_status = 'nema_sajt')::int as no_site
  from businesses b
  left join website_audits wa on wa.place_id = b.place_id
  where b.niche_slug is not null
  group by b.country_code, b.city_slug, b.niche_slug;

-- Pogled je alat ovih RPC-jeva, ne javna površina. `security_invoker` ga i
-- ovako čini praznim za `anon`, ali eksplicitno je jasnije od izvedenog.
revoke all on search_cache_stats from public, anon, authenticated;
grant select on search_cache_stats to service_role;

-- ═══════════════════════════════════════════════════════════
-- 4. NOV RAZLOG U KNJIZI
-- ═══════════════════════════════════════════════════════════

alter table credit_ledger drop constraint if exists credit_ledger_reason_valid;
alter table credit_ledger add constraint credit_ledger_reason_valid check (
  reason in ('unlock', 'scan', 'monthly_grant', 'admin', 'refund')
);

-- Povraćaj za skeniranje MORA da bude idempotentan: `refund_scan` ume da se
-- pozove dvaput (worker restartovan između povraćaja i `complete_job`).
-- Postojeći `credit_ledger_grant_idem_idx` pokriva samo dodele, i to namerno —
-- `refund` za isti `place_id` sme da se ponovi. Zato ovde parcijalni indeks samo
-- nad povraćajima skeniranja.
create unique index if not exists credit_ledger_scan_refund_idx
  on credit_ledger (user_id, reason, ref_id)
  where reason = 'refund' and ref_id like 'scan:%';

-- ═══════════════════════════════════════════════════════════
-- 5. NAPLATA SKENIRANJA
-- ═══════════════════════════════════════════════════════════

/**
 * Skini 1 kredit i upiši `scan` posao — u jednoj transakciji.
 *
 * [ODSTUPANJE od pravila 3 iz CLAUDE.md]
 * Pravilo kaže: krediti se menjaju samo kroz `spend_credit_and_unlock` ili
 * `grant_credits`. Ovo je treća funkcija, iz istog razloga kao
 * `grant_monthly_credits` u 0004: skidanje kredita i upis posla moraju da budu
 * jedna transakcija. „Skini pa upiši" ostavlja korisnika bez kredita i bez
 * skeniranja ako proces padne između, a „upiši pa skini" pušta Places poziv
 * onome ko nema čime da plati.
 *
 * Duh pravila je ispoštovan: balans se menja isključivo unutar auditovane
 * `security definer` funkcije, pod `for update`, uz obaveznu stavku u knjizi.
 *
 * Ishodi (`reason`):
 *   charged              — skinut kredit, posao upisan (ili se prikačio na živ)
 *   already_paid         — isti korisnik već plaća živ posao za istu kombinaciju
 *   insufficient_credits — nema kredita; posao NIJE upisan
 *   no_user              — profil još ne postoji (Clerk webhook nije stigao)
 *
 * `ref_id` je namerno `scan:<job_id>`, a ne `RS:grad:nisa`. Time knjiga postaje
 * spisak platilaca po poslu, pa `refund_scan` ne mora nigde drugde da traži ko
 * je šta platio. Iz istog uslova ispadaju i dve odluke iz F9 §0:
 *   - dva RAZLIČITA korisnika na istom poslu plaćaju svaki svoje (nema stavke)
 *   - ISTI korisnik dvaput na istom poslu plaća jednom (stavka već postoji)
 */
create or replace function spend_credit_and_scan(
  p_user        text,
  p_country     text,
  p_city        text,
  p_niche       text,
  p_max_results integer default 30
)
returns table (
  ok boolean, reason text, job_id bigint, joined boolean,
  charged boolean, credits_left integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
  v_key     text := p_country || ':' || p_city || ':' || p_niche;
  v_live    bigint;
  v_id      bigint;
  v_joined  boolean;
begin
  select p.credits_balance into v_balance
  from profiles p where p.id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user', null::bigint, false, false, 0; return;
  end if;

  -- Živ posao za istu kombinaciju. `enqueue_job` bi ga i sam našao, ali cena mora
  -- da se odluči PRE upisa — inače bi provera „da li sam već platio" tražila
  -- job_id koji dobijamo tek posle upisa.
  select q.id into v_live
  from job_queue q
  where q.type = 'scan'
    and q.dedupe_key = v_key
    and q.status in ('pending', 'running')
  order by q.id
  limit 1
  for update;

  if v_live is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'scan' and cl.ref_id = 'scan:' || v_live
  ) then
    -- Dupli klik, osvežena kartica, dva taba. Pretplata se svejedno osvežava —
    -- korisnik mora da može da polluje posao i posle refresh-a.
    insert into job_subscribers (job_id, user_id) values (v_live, p_user)
    on conflict do nothing;

    return query select true, 'already_paid', v_live, true, false, v_balance; return;
  end if;

  if v_balance < 1 then
    return query select false, 'insufficient_credits', null::bigint, false, false, v_balance;
    return;
  end if;

  select e.job_id, e.joined into v_id, v_joined
  from enqueue_job(
    'scan',
    jsonb_build_object(
      'citySlug', p_city,
      'nicheSlug', p_niche,
      'userId', p_user,
      'countryCode', p_country,
      'maxResults', p_max_results
    ),
    v_key,
    p_user
  ) e;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, -1, 'scan', 'scan:' || v_id);

  update profiles set credits_balance = credits_balance - 1 where id = p_user;

  -- U `search_cache` se ovde NE dira ništa. Registar sme da dobije red tek kad
  -- skeniranje stvarno završi (`record_scan`) — red upisan na naplati bi imao
  -- `last_scanned_at` iz budućnosti ili iz 1926, a oba bi lagala: prvo bi tu
  -- kombinaciju proglasilo besplatnom pre nego što ijedan podatak postoji, drugo
  -- bi je prikazalo kao „starija od 30 dana" umesto kao „nikad skenirana".
  return query select true, 'charged', v_id, coalesce(v_joined, false), true, v_balance - 1;
end;
$$;

/**
 * Vrati kredit svima koji su platili posao koji nije dao ništa.
 *
 * Zove ga worker na dva mesta (F9 §2): kad `scan` ne nađe nijednu firmu, i kad
 * posao tipa `scan` konačno padne. Odložen posao (`defer_job` zbog budžeta) NIJE
 * pad — skeniranje će se izvršiti kad kvota stigne i kredit ostaje potrošen.
 *
 * Idempotentno: parcijalni indeks `credit_ledger_scan_refund_idx` je poslednja
 * brana, a `not exists` provera je ona koja ne baca izuzetak.
 */
create or replace function refund_scan(p_job_id bigint)
returns table (refunded integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ref   text := 'scan:' || p_job_id;
  v_user  text;
  v_count integer := 0;
begin
  for v_user in
    select cl.user_id from credit_ledger cl
    where cl.reason = 'scan' and cl.ref_id = v_ref
      and not exists (
        select 1 from credit_ledger r
        where r.user_id = cl.user_id and r.reason = 'refund' and r.ref_id = v_ref
      )
  loop
    -- Zaključavanje reda pre upisa: povraćaj i unlock istog korisnika u istoj
    -- sekundi inače oba čitaju isti balans.
    perform 1 from profiles p where p.id = v_user for update;

    insert into credit_ledger (user_id, delta, reason, ref_id)
      values (v_user, 1, 'refund', v_ref);

    update profiles set credits_balance = credits_balance + 1 where id = v_user;
    v_count := v_count + 1;
  end loop;

  return query select v_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. UPIS REGISTRA IZ WORKERA
-- ═══════════════════════════════════════════════════════════

/**
 * „Ova kombinacija je upravo skenirana i evo koliko je vratila."
 *
 * Poziva se i kad je rezultat prazan — to je cela poenta odluke 6 iz F9 §0:
 * prazan rezultat se pamti 30 dana da sledeći korisnik ne bi platio isti nulti
 * odgovor. Zato ovo NE sme da bude `where count > 0`.
 *
 * [PAŽNJA — ovde je bila rupa u pravilu 1]
 * Prazan odgovor ne znači uvek „prazna kombinacija". Google ume da ne vrati
 * ništa i za grad i nišu koji u `businesses` imaju 40 redova od pre dva meseca
 * (promenjen rang, pao upit, drugačija formulacija). Kad bi se i tada upisalo
 * `last_scanned_at = now()`, tih 40 zastarelih redova bi na 30 dana bilo
 * proglašeno svežim i serviralo se kao ispravni podaci — a ništa nije osveženo.
 *
 * Zato: prazan odgovor pomera rok SAMO ako za tu kombinaciju u bazi nema
 * nijednog reda. Ako ih ima, rok ostaje vezan za stvarnu svežinu tih redova.
 * `greatest(...)` uz to garantuje da se datum nikad ne pomera unazad.
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
  v_stamp timestamptz := now();
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

  insert into search_cache (country_code, city_slug, niche_slug, last_scanned_at,
                            last_results_count, scan_count, last_job_id)
  values (p_country, p_city, p_niche, v_stamp, greatest(coalesce(p_count, 0), 0), 1, p_job_id)
  on conflict (country_code, city_slug, niche_slug) do update
    set last_scanned_at = greatest(search_cache.last_scanned_at, excluded.last_scanned_at),
        -- Rezultat POSLEDNJEG skeniranja, ne broj redova u bazi. Listu hrani
        -- pogled `search_cache_stats`, koji broji stvarno stanje.
        last_results_count = excluded.last_results_count,
        scan_count = search_cache.scan_count + 1,
        last_job_id = coalesce(excluded.last_job_id, search_cache.last_job_id);
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. ČITANJE REGISTRA
-- ═══════════════════════════════════════════════════════════

/**
 * Stanje jedne kombinacije. Jedini izvor po kome ruta odlučuje da li se naplaćuje.
 *
 * Vraća red UVEK — i kad kombinacija nije nikad skenirana (`scanned_at is null`).
 * Bez toga bi ruta morala da razlikuje „nema reda" od „nema odgovora", a to je
 * tačno ona razlika koja se u TypeScriptu zaboravi.
 */
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
         coalesce(st.total, 0),
         coalesce(st.no_site, 0)
  from (select 1) one
  left join search_cache sc
    on sc.country_code = p_country and sc.city_slug = p_city and sc.niche_slug = p_niche
  left join search_cache_stats st
    on st.country_code = p_country and st.city_slug = p_city and st.niche_slug = p_niche;
$$;

/**
 * Ceo registar za stranu Pretraga (F9 §3), sa oznakom da li je red još besplatan.
 *
 * Vraća i ISTEKLE kombinacije, iako ih lista „Besplatne pretrage" ne prikazuje.
 * Razlog je traka cene iznad liste: bez isteklih redova klijent ne ume da
 * razlikuje „nikad skenirano — 1 kredit" od „starije od 30 dana — 1 kredit", a
 * to su dve različite rečenice korisniku (F9, odluka 8). Filtriranje je u UI-ju,
 * jednom mestu, umesto dva upita koja se vremenom raziđu.
 *
 * `mine` je „ovaj korisnik je ovu kombinaciju već tražio" iz `searches`.
 */
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
         coalesce(st.total, 0),
         coalesce(st.no_site, 0),
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
  left join search_cache_stats st
    on st.country_code = sc.country_code
   and st.city_slug = sc.city_slug
   and st.niche_slug = sc.niche_slug
  where sc.country_code = p_country
  order by (sc.last_scanned_at > now() - make_interval(days => p_ttl_days)) desc,
           coalesce(st.total, 0) desc,
           sc.last_scanned_at desc;
$$;

-- ═══════════════════════════════════════════════════════════
-- 8. PRAVA NAD FUNKCIJAMA
-- ═══════════════════════════════════════════════════════════
-- Isti razlog kao u 0001 §4: `security definer` je podrazumevano izvršiva za
-- `public`, pa bi bilo ko sa anon ključem mogao da pozove
-- spend_credit_and_scan('user_tudji', ...) preko PostgREST-a i potroši tuđ kredit.

revoke all on function spend_credit_and_scan(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function refund_scan(bigint)                                     from public, anon, authenticated;
revoke all on function record_scan(text, text, text, integer, bigint)          from public, anon, authenticated;
revoke all on function search_cache_state(text, text, text, integer)           from public, anon, authenticated;
revoke all on function search_cache_overview(text, text, integer)              from public, anon, authenticated;

grant execute on function spend_credit_and_scan(text, text, text, text, integer) to service_role;
grant execute on function refund_scan(bigint)                                    to service_role;
grant execute on function record_scan(text, text, text, integer, bigint)         to service_role;
grant execute on function search_cache_state(text, text, text, integer)          to service_role;
grant execute on function search_cache_overview(text, text, integer)             to service_role;
