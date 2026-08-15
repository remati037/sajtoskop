-- 0013_f12_pozivnice_pregled.sql — F12.3: uloga u jednoj transakciji i pregled sistema
--
-- Izvor: docs/F12-admin.md §1 („Zaštite od zaključavanja") i §3.4.
--
-- Dve funkcije, nijedna nova tabela i nijedna izmena postojećih podataka:
--
--   1. `admin_set_role` — promena uloge sa brojanjem admina u ISTOJ transakciji.
--      F12.2 je to rešio brojanjem pre upisa pa ponovo posle njega, jer
--      transakcije preko dva PostgREST zahteva nema (v. „S4 — šta se razišlo",
--      tačka 1). Ta zaštita radi, ali u bezbednom smeru: najgori ishod je da se
--      izmena poništi posle upisa. Sad se do upisa ni ne dolazi.
--
--   2. `admin_overview` — šest kartica sa `/admin` iz JEDNOG poziva. Bez nje bi
--      pregled bio petnaestak `head: true` zahteva kroz PostgREST, i to za
--      brojke koje se ionako gledaju zajedno.
--
-- Pozivnice, otvaranje naloga i poruka korisniku ovde nemaju ništa: spisak
-- pozivnica je u Clerku, a brojač poslatih poruka je sam `admin_audit`
-- (isti razlog kao za tempo od 120/h — drugi izvor istine za isti podatak je
-- prvi koji se raziđe).

-- ═══════════════════════════════════════════════════════════
-- 1. PROMENA ULOGE
-- ═══════════════════════════════════════════════════════════
-- „Poslednji admin ostaje" je provera koja je tačna samo ako u međuvremenu niko
-- drugi ne piše. `for update` nad jednim redom to ne rešava: brojanje je agregat
-- nad celom tabelom, a red koji se menja nije isti red koji se broji.
--
-- Zato jedna savetodavna brava nad celom radnjom. Svaka promena uloge prolazi
-- kroz nju, pa se dve ne mogu preplitati — a pošto je `xact`, pušta se sama na
-- kraju transakcije, i to i kad funkcija pukne.
--
-- ── šta ova funkcija NAMERNO ne radi ─────────────────────────
-- Ne upisuje `admin_audit`. `admin_adjust_credits` (0012) to radi, i to je
-- jedini izuzetak u projektu — dobro obrazložen tamo (upis balansa i njegov trag
-- moraju da budu ista transakcija), ali izuzetak koji se ne umnožava. Ovde red u
-- dnevniku piše ruta, kroz `saAuditom()`, kao i za svih ostalih šest radnji. Da
-- ga piše i funkcija, imenski prostor `action` bi imao dva pisca.
create or replace function admin_set_role(
  p_actor text,
  p_user  text,
  p_role  text
)
returns table (ok boolean, reason text, admins integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Proizvoljan, ali fiksan ključ brave. Menja se samo ako neka druga radnja
  -- ikad bude morala da se serijalizuje sa ovom.
  c_lock  constant bigint := 12013;
  v_stara text;
  v_admina integer;
begin
  if p_role not in ('user', 'admin') then
    return query select false, 'invalid_role'::text, null::integer; return;
  end if;

  -- „Ne sebi" stoji i u ruti, i to je mesto gde korisnik dobija rečenicu. Ovde
  -- je zato što je ovo poslednja kapija: zabrana koja živi samo u sloju iznad je
  -- zabrana koju drugi pozivalac ne nasleđuje.
  if p_actor = p_user then
    return query select false, 'self'::text, null::integer; return;
  end if;

  perform pg_advisory_xact_lock(c_lock);

  select p.role into v_stara from profiles p where p.id = p_user for update;
  if not found then
    return query select false, 'no_user'::text, null::integer; return;
  end if;

  select count(*)::integer into v_admina from profiles p where p.role = 'admin';

  -- Ništa za promenu. Uredan ishod, ne greška: dva otvorena taba sa istim
  -- korisnikom su najobičnija stvar.
  if v_stara = p_role then
    return query select true, 'unchanged'::text, v_admina; return;
  end if;

  if p_role = 'user' and v_admina <= 1 then
    return query select false, 'last_admin'::text, v_admina; return;
  end if;

  update profiles set role = p_role where id = p_user;

  select count(*)::integer into v_admina from profiles p where p.role = 'admin';
  return query select true, 'ok'::text, v_admina;
end;
$$;

revoke all on function admin_set_role(text, text, text) from public, anon, authenticated;
grant execute on function admin_set_role(text, text, text) to service_role;

-- ═══════════════════════════════════════════════════════════
-- 2. PREGLED SISTEMA
-- ═══════════════════════════════════════════════════════════
-- Šest kartica sa `/admin` (F12 §3.4), sve iz baze i bez ijednog spoljnog
-- poziva. Vraća `jsonb`, a ne `table (…)` sa trideset kolona: kartice su
-- ugnježđene po prirodi, a oblik odgovora se u beti menja brže od potpisa
-- funkcije.
--
-- Kapovi ulaze kao parametri, jer žive u `packages/shared/src/plans.ts`
-- (`GLOBAL_DAILY_API_CAP`, `GLOBAL_MONTHLY_API_CAP`) — jedan izvor istine, i to
-- onaj koji vidi i worker.
--
-- Nije `stable`: čita `api_budget_status`, koja je `volatile`. Ništa ne menja.
--
-- ── medijana cene se OVDE ne računa ──────────────────────────
-- Vraćaju se sirovi odgovori. Sredine opsega stoje u `feedback-katalog.ts`
-- zajedno sa samim opsezima, pa je `medijanaCene()` jedini izvor istine (F11).
-- Druga implementacija u SQL-u bi se razišla prvog dana kad se opseg promeni.
create or replace function admin_overview(
  p_daily_cap   integer default 75,
  p_monthly_cap integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_budzet    jsonb;
  v_poslovi   jsonb;
  v_korisnici jsonb;
  v_krediti   jsonb;
  v_utisci    jsonb;
  v_pitanja   jsonb;
  v_cena      jsonb;
  v_baza      jsonb;
begin
  -- ── 1. Places budžet ──────────────────────────────────────
  -- Jedina brojka na ovom ekranu koja me košta pravi novac.
  select jsonb_build_object(
           'dan',           s.pt_day,
           'mesec',         s.pt_month,
           'dan_poziva',    s.day_calls,
           'dan_cap',       s.daily_cap,
           'mesec_poziva',  s.month_calls,
           'mesec_cap',     s.monthly_cap,
           'iscrpljen',     s.exhausted,
           'dana_do_kraja', s.days_left,
           'po_vrsti',      s.kinds
         )
    into v_budzet
    from api_budget_status(p_daily_cap, p_monthly_cap) s;

  -- ── 2. Red poslova ────────────────────────────────────────
  -- Worker koji je stao vidi se ovde, ne u Hetzneru.
  --
  -- „Najstariji na čekanju" gleda `run_after`, a ne `created_at`: posao koji je
  -- namerno odložen (`defer_job`) nije zaglavljen posao, i ne sme da pali crveno
  -- stanje. Odloženi u budućnost se filterom izbacuju.
  select jsonb_build_object(
           'na_cekanju', count(*) filter (where status = 'pending'),
           'u_radu',     count(*) filter (where status = 'running'),
           'palo_24h',   count(*) filter (
                           where status = 'failed'
                             and coalesce(finished_at, created_at) >= now() - interval '24 hours'),
           'odlozeno',   count(*) filter (where status = 'pending' and run_after > now()),
           'najstariji_sec', coalesce(
             extract(epoch from now() - min(run_after) filter (
               where status = 'pending' and run_after <= now())), 0)::integer
         )
    into v_poslovi
    from job_queue;

  -- ── 3. Korisnici ──────────────────────────────────────────
  -- Stopa povratka iz `00-kontekst` §2. `last_seen_at` postoji od 0012, pa je
  -- „aktivni 30d" prvih mesec dana po prirodi manji od stvarnog.
  select jsonb_build_object(
           'ukupno',      count(*),
           'novi_7d',     count(*) filter (where created_at   >= now() - interval '7 days'),
           'aktivni_7d',  count(*) filter (where last_seen_at >= now() - interval '7 days'),
           'aktivni_30d', count(*) filter (where last_seen_at >= now() - interval '30 days'),
           'nikad',       count(*) filter (where last_seen_at is null),
           'admina',      count(*) filter (where role = 'admin')
         )
    into v_korisnici
    from profiles;

  -- ── 4. Krediti u 30 dana, po razlogu ──────────────────────
  -- Pitanje na koje ova kartica odgovara je jedno: drži li beta plan uopšte.
  with l as (
    select cl.delta, cl.reason
    from credit_ledger cl
    where cl.created_at >= now() - interval '30 days'
  )
  select jsonb_build_object(
           'dodeljeno',  (select coalesce(sum(delta), 0)  from l where delta > 0),
           'potroseno',  (select coalesce(-sum(delta), 0) from l where delta < 0),
           'po_razlogu', (select coalesce(jsonb_object_agg(g.reason, g.zbir), '{}'::jsonb)
                          from (select reason, sum(delta)::integer as zbir
                                from l group by reason) g)
         )
    into v_krediti;

  -- ── 5. Utisci ─────────────────────────────────────────────
  select jsonb_build_object(
           'ukupno',          count(*),
           'novih_7d',        count(*) filter (where created_at >= now() - interval '7 days'),
           'otvoreni_bugovi', count(*) filter (
                                where kind = 'bug' and status in ('novo', 'priznato', 'u_radu')),
           'nedirnuto',       count(*) filter (where status = 'novo')
         )
    into v_utisci
    from feedback;

  -- Odgovorenost: koliko prikazanih pitanja je dobilo odgovor. Broji se nad
  -- `feedback_prompts`, jer tabela `feedback` ne zna za pitanja koja su
  -- prikazana a odbačena.
  select jsonb_build_object(
           'prikazano',  count(*),
           'odgovoreno', count(*) filter (where status = 'odgovoreno'),
           'odbaceno',   count(*) filter (where status = 'odbaceno')
         )
    into v_pitanja
    from feedback_prompts;

  select coalesce(jsonb_agg(f.answers ->> 'odgovor'), '[]'::jsonb)
    into v_cena
    from feedback f
   where f.prompt_key = 'cena' and f.answers ? 'odgovor';

  v_utisci := v_utisci || jsonb_build_object('pitanja', v_pitanja, 'cena_odgovori', v_cena);

  -- ── 6. Baza ───────────────────────────────────────────────
  -- Vrednost imovine proizvoda. `stari_google` je pravilo 1 kao brojka: koliko
  -- redova više ne sme da se servira bez osvežavanja.
  select jsonb_build_object(
           'biznisa',      (select count(*) from businesses),
           'audita',       (select count(*) from website_audits),
           'otkljucano',   (select count(*) from unlocks),
           'pretraga',     (select count(*) from searches),
           'iz_kesa',      (select count(*) from searches where source = 'cache'),
           'stari_google', (select count(*) from businesses
                            where google_refreshed_at < now() - interval '30 days')
         )
    into v_baza;

  return jsonb_build_object(
    'budzet',    v_budzet,
    'poslovi',   v_poslovi,
    'korisnici', v_korisnici,
    'krediti',   v_krediti,
    'utisci',    v_utisci,
    'baza',      v_baza,
    'trenutak',  now()
  );
end;
$$;

revoke all on function admin_overview(integer, integer) from public, anon, authenticated;
grant execute on function admin_overview(integer, integer) to service_role;
