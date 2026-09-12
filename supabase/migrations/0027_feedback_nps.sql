-- 0027_feedback_nps.sql — S29: NPS, „Fali" i kontekst uz prijavu greške
--
-- Izvor: zahtev sesije S29, tačke 1, 4, 8 i 9.
--
-- Nijedna nova tabela, nijedan nov bucket, nijedan nov cron. Tri stvari:
--
--   1. `admin_nps()`  — skor iz odgovora na `nps-7`, bez ijednog novog reda
--   2. `admin_fali()` — šta ljudi pišu na prazna stanja, grupisano po tekstu
--   3. `zabelezi_utisak` dobija `p_ctx_extra` — kontekst prijave greške ide u
--      `ctx`, a jedino što stiže iz pregledača su IDENTIFIKATORI (`placeId`,
--      `jobId`, `korak`). Status i greška posla se čitaju iz `job_queue`, plan
--      i krediti iz profila — nikad iz tela (pravilo 8).
--
-- `admin_overview` se dopunjuje jer joj je `cena_odgovori` ostao bez pitanja:
-- `cena` je obrisana iz kataloga u istoj sesiji, pa bi ključ zauvek vraćao
-- prazan spisak. Na njegovo mesto ide NPS, pozvan iz `admin_nps()`.
--
-- Idempotentno: sve je `create or replace`, `drop ... if exists` pre promene
-- potpisa. `pnpm check:sql` je pušta dvaput.

-- ═══════════════════════════════════════════════════════════
-- 1. NPS
-- ═══════════════════════════════════════════════════════════

/**
 * NPS iz odgovora na `nps-7`.
 *
 * Standardna podela: 9–10 promoter, 7–8 pasivan, 0–6 detraktor; skor je
 * `% promotera − % detraktora`, dakle ceo broj od −100 do 100. Pasivni ulaze u
 * imenilac i ni u jedan brojilac — to nije previd nego definicija.
 *
 * `score` je NULL kad nema nijednog odgovora, a ne 0. Nula je stvarna ocena
 * (koliko promotera toliko detraktora) i ekran koji je pokaže na praznoj bazi
 * laže. `n = 0` je ono po čemu se to razlikuje.
 *
 * Zašto `jsonb_typeof = 'number'`: `answers -> 'ocena'` je upisan kao broj (Zod
 * `coerce` na granici), ali zapis iz starije verzije kataloga ili ručno
 * popravljen red umeju da nose string. Takav red se PRESKAČE umesto da obori
 * ceo izveštaj — isto pravilo koje je `medijanaCene()` imala za nepoznat opseg.
 */
create or replace function admin_nps()
returns table (
  score              integer,
  n                  integer,
  promoteri          integer,
  pasivni            integer,
  detraktori         integer,
  poslednjih_30_dana integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with ocene as (
    select (f.answers ->> 'ocena')::numeric as ocena, f.created_at
      from feedback f
     where f.prompt_key = 'nps-7'
       and jsonb_typeof(f.answers -> 'ocena') = 'number'
       and (f.answers ->> 'ocena')::numeric between 0 and 10
  ),
  zbir as (
    select count(*)::integer                                        as n,
           count(*) filter (where ocena >= 9)::integer               as promoteri,
           count(*) filter (where ocena between 7 and 8)::integer    as pasivni,
           count(*) filter (where ocena <= 6)::integer               as detraktori,
           count(*) filter (
             where created_at >= now() - interval '30 days')::integer as posl30
      from ocene
  )
  select case
           when z.n = 0 then null::integer
           else round(100.0 * (z.promoteri - z.detraktori) / z.n)::integer
         end,
         z.n, z.promoteri, z.pasivni, z.detraktori, z.posl30
    from zbir z;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. „Šta ti ovde fali"
-- ═══════════════════════════════════════════════════════════

/**
 * Šta ljudi pišu na prazna stanja, grupisano po tekstu.
 *
 * Grupisanje ide po `lower(trim(...))` jer je ovo lista za čitanje, ne za
 * pravnu evidenciju: „Filter po recenzijama", „filter po recenzijama " i
 * „filter po recenzijama" su jedan zahtev, i moraju da stoje u jednom redu sa
 * brojem 3 — inače se najtraženija stvar razbije na tri reda i ne primeti se.
 *
 * `message` je izlazno ime kolone i namerno je isto kao ono u `feedback`:
 * tekst `fali` odgovora stiže kao PRVI korak, dakle u `answers->>'tekst'`, a
 * `feedback.message` ga nosi samo kad je čovek posle dopisao rečenicu. Ovde se
 * uzima prvo što postoji — ekran zanima šta je čovek napisao, ne kojim putem.
 *
 * `p_route` sužava na jedan ekran (`/pretraga`, `/lista`, `/pipeline`). NULL i
 * prazan string znače „sve" — filter koji ne filtrira ne sme da bude greška.
 *
 * Prikazan tekst je ono što je korisnik otkucao: ekran ga renderuje kao TEKST,
 * nikad kao HTML.
 */
create or replace function admin_fali(p_route text default null)
returns table (
  message      text,
  count        integer,
  route        text,
  poslednji_put timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with redovi as (
    select coalesce(
             nullif(btrim(f.answers ->> 'tekst'), ''),
             nullif(btrim(f.message), '')
           )                       as tekst,
           f.route,
           f.created_at
      from feedback f
     where f.prompt_key = 'fali'
  ),
  filtrirano as (
    select r.* from redovi r
     where r.tekst is not null
       and (p_route is null or p_route = '' or r.route = p_route)
  )
  select (array_agg(t.tekst order by t.created_at desc))[1]  as message,
         count(*)::integer                                    as count,
         (array_agg(t.route order by t.created_at desc))[1]   as route,
         max(t.created_at)                                    as poslednji_put
    from filtrirano t
   group by lower(btrim(t.tekst))
   order by count(*) desc, max(t.created_at) desc;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. Kontekst uz prijavu greške
-- ═══════════════════════════════════════════════════════════
--
-- Potpis se menja (dodat `p_ctx_extra`), pa stara verzija mora da ode: bez
-- `drop` bi u bazi ostale DVE funkcije i `supabase-js` bi birao po broju
-- argumenata — tiho, i pogrešno onog dana kad ruta prestane da šalje poslednji.

drop function if exists zabelezi_utisak(
  text, integer, text, text, text, text, text, text, jsonb, text, integer,
  jsonb, text, integer, integer
);

/**
 * Nastanak utiska sa dnevnim plafonom u ISTOJ transakciji (0018), prošireno
 * kontekstom prijave greške (S29 §5.3 D).
 *
 * ── šta sme da stigne iz pregledača ─────────────────────────
 * `p_ctx_extra` nosi ISKLJUČIVO identifikatore i mesto klika: `placeId`,
 * `jobId`, `korak`. Sve što opisuje NALOG ili ISHOD posla se čita ovde:
 *
 *   - `plan`, `credits`, `unlocks` — iz zaključanog profila, kao i do sada
 *   - `stanje` — plan + rok iz profila, izvedeno ovde
 *   - `job_status`, `job_error` — iz `job_queue`, po `jobId`
 *
 * Zato ruta i ne prima ništa od toga: telo koje tvrdi `stanje: 'aktivan'` i
 * `greska: 'ok'` ne menja nijedan upisan bajt (pravilo 8).
 *
 * Nepoznati ključevi iz `p_ctx_extra` se ODBACUJU. Bez toga je `ctx` jsonb
 * kanta u koju klijent upisuje šta hoće — isti razlog iz kog `answers` prolazi
 * kroz Zod šemu iz kataloga (pravilo 16).
 */
create or replace function zabelezi_utisak(
  p_user          text,
  p_rating        integer,
  p_source        text,
  p_route         text,
  p_route_label   text,
  p_ua            text,
  p_viewport      text,
  p_prompt_key    text,
  p_answers       jsonb,
  p_kind          text,
  p_severity      integer,
  p_errors        jsonb,
  p_screenshot    text,
  p_dnevni_plafon integer,
  p_mejl_limit    integer,
  p_ctx_extra     jsonb default null
)
returns table (ishod text, posalji_mejl boolean, red jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profil  profiles%rowtype;
  v_unlocks integer;
  v_dosad   integer;
  v_ctx     jsonb;
  v_id      bigint;
  v_row     feedback%rowtype;
  v_place   text;
  v_job     bigint;
  v_korak   text;
  v_posao   job_queue%rowtype;
  v_njegov  boolean;
begin
  select * into v_profil from profiles where id = p_user for update;

  if not found then
    return query select 'no_user', false, null::jsonb;
    return;
  end if;

  select count(*) into v_unlocks from unlocks where user_id = p_user;

  select count(*) into v_dosad
  from feedback
  where user_id = p_user and created_at >= now() - interval '24 hours';

  if v_dosad >= p_dnevni_plafon then
    return query select 'plafon', false, null::jsonb;
    return;
  end if;

  v_ctx := jsonb_build_object(
    'plan', v_profil.plan,
    'credits', v_profil.credits_balance,
    'unlocks', v_unlocks,
    'ua', left(coalesce(p_ua, ''), 400),
    'viewport', coalesce(p_viewport, '')
  );

  -- Dnevnik grešaka ide samo uz bug (F11 odluka 10) — ista odluka koju je
  -- donosio TS, sada na jednom mestu sa upisom.
  if p_kind = 'bug' and p_errors is not null and jsonb_array_length(p_errors) > 0 then
    v_ctx := v_ctx || jsonb_build_object('errors', p_errors);
  end if;

  -- ── S29: kontekst prijave greške ──────────────────────────
  if p_ctx_extra is not null and jsonb_typeof(p_ctx_extra) = 'object' then
    v_place := nullif(btrim(left(coalesce(p_ctx_extra ->> 'placeId', ''), 128)), '');
    v_korak := nullif(btrim(left(coalesce(p_ctx_extra ->> 'korak', ''), 64)), '');

    -- Nečitljiv `jobId` je isto što i nikakav: prijava greške ne sme da padne
    -- zato što je u telu stigla reč umesto broja.
    begin
      v_job := nullif(btrim(coalesce(p_ctx_extra ->> 'jobId', '')), '')::bigint;
    exception when others then
      v_job := null;
    end;

    if v_place is not null then
      v_ctx := v_ctx || jsonb_build_object('placeId', v_place);
    end if;
    if v_korak is not null then
      v_ctx := v_ctx || jsonb_build_object('korak', v_korak);
    end if;

    -- Stanje naloga: plan i rok iz profila, nikad iz tela.
    v_ctx := v_ctx || jsonb_build_object(
      'stanje', jsonb_build_object(
        'plan',            v_profil.plan,
        'plan_expires_at', v_profil.plan_expires_at,
        'komp_expires_at', v_profil.komp_expires_at,
        'credits_topup',   v_profil.credits_topup
      )
    );

    -- Ishod posla iz `job_queue`, i to samo ako je čovek TAJ posao platio.
    --
    -- `job_queue` nema `user_id` i to nije previd: `scan` posao je zajednički,
    -- ključ mu je `dedupe_key` (grad + niša + dubina), a vlasništvo se dokazuje
    -- redom u knjizi (`ref_id = 'scan:<id>'`) — isto pravilo po kom
    -- `zivPlacenPosao()` odlučuje čiji je posao živ. Bez ove provere bi tuđ
    -- `jobId` u telu otkrio i status i poruku greške.
    if v_job is not null then
      select exists (
        select 1 from credit_ledger cl
         where cl.user_id = p_user and cl.ref_id = 'scan:' || v_job::text
      ) into v_njegov;

      if v_njegov then
        select * into v_posao from job_queue where id = v_job;
      end if;

      if v_njegov and found then
        v_ctx := v_ctx || jsonb_build_object(
          'jobId',  v_job,
          'greska', jsonb_build_object(
            'status',   v_posao.status,
            'tip',      v_posao.type,
            'attempts', v_posao.attempts,
            'poruka',   left(coalesce(v_posao.last_error, ''), 500)
          )
        );
      else
        -- Posao postoji u prijavi, ali ga nema u redu ili ga čovek nije platio.
        -- Broj se pamti; ono što bi ga opisalo se ne izmišlja.
        v_ctx := v_ctx || jsonb_build_object('jobId', v_job);
      end if;
    end if;
  end if;

  insert into feedback (
    user_id, rating, source, route, route_label, ctx,
    prompt_key, answers, kind, severity, screenshot_path
  ) values (
    p_user, p_rating, p_source, p_route, p_route_label, v_ctx,
    p_prompt_key, coalesce(p_answers, '{}'::jsonb), p_kind, p_severity, p_screenshot
  )
  returning id into v_id;

  select * into v_row from feedback where id = v_id;

  return query select 'upisan', v_dosad < p_mejl_limit, row_to_json(v_row)::jsonb;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. `admin_overview` — NPS umesto medijane cene
-- ═══════════════════════════════════════════════════════════
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
  v_budzet     jsonb;
  v_poslovi    jsonb;
  v_korisnici  jsonb;
  v_krediti    jsonb;
  v_utisci     jsonb;
  v_pitanja    jsonb;
  v_po_pitanju jsonb;
  v_obrada     jsonb;
  v_nps        jsonb;
  v_baza       jsonb;
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

  -- ── NOVO U 0015: odgovorenost PO PITANJU ──────────────────
  -- Zbirna odgovorenost kaže da li mehanika radi; ova kaže KOJE pitanje ne
  -- radi. To je razlika između „40 % odgovara" i „na `cenu` odgovara svako
  -- treći, a na `prva-lista` niko" — a druga rečenica je jedina po kojoj se
  -- nešto menja.
  --
  -- Ključ pitanja ostaje sirov (`prva-lista`); naslov dolazi iz kataloga, jer
  -- kopija naslova u bazi bi se razišla sa `feedback-katalog.ts` prvog dana.
  -- Pitanja iz starijih verzija kataloga i dalje izlaze — ono što je prikazano
  -- se dogodilo, bez obzira na to da li pitanje danas postoji.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'kljuc',      g.prompt_key,
               'prikazano',  g.prikazano,
               'odgovoreno', g.odgovoreno,
               'odbaceno',   g.odbaceno
             ) order by g.prikazano desc, g.prompt_key
           ),
           '[]'::jsonb
         )
    into v_po_pitanju
    from (
      select fp.prompt_key,
             count(*)::integer                                          as prikazano,
             count(*) filter (where fp.status = 'odgovoreno')::integer  as odgovoreno,
             count(*) filter (where fp.status = 'odbaceno')::integer    as odbaceno
        from feedback_prompts fp
       group by fp.prompt_key
    ) g;

  -- ── NOVO U 0015: prosek do odgovora ───────────────────────
  -- Koliko u proseku prođe od prijave do trenutka kad je dobila ishod
  -- (`resolved_at`, koji upisuje `/admin/utisci` pri prelasku u rešeno,
  -- odbijeno ili duplikat).
  --
  -- Ovo je brojka o MENI, ne o korisniku, i zato stoji uz „otvorene bugove":
  -- ekran za obradu prijava mora da pokaže koliko obrada zaista traje. Odgovor
  -- korisnika na pitanje meri `po_pitanju` iznad.
  --
  -- `nereseno_najstarije_sec` je uz njega jer prosek sam po sebi ume da laže:
  -- pet prijava rešenih za sat vremena i jedna koja stoji tri nedelje daju
  -- odličan prosek.
  select jsonb_build_object(
           'reseno',     count(*) filter (where resolved_at is not null),
           'prosek_sec', coalesce(
                           avg(extract(epoch from resolved_at - created_at))
                             filter (where resolved_at is not null),
                           0)::integer,
           'nereseno',   count(*) filter (where resolved_at is null),
           'nereseno_najstarije_sec', coalesce(
                           extract(epoch from now() - min(created_at)
                             filter (where resolved_at is null)),
                           0)::integer
         )
    into v_obrada
    from feedback;

  -- ── S29: NPS na mesto medijane cene ───────────────────────
  -- Pitanje o ceni je obrisano iz kataloga (naplata postoji, pa opseg u RSD
  -- više nije procena nego pogrešna brojka), a sa njim i spisak sirovih
  -- odgovora koji je ovde stajao. Na to mesto dolazi NPS — ISTI račun koji
  -- radi `admin_nps()`, pozvan odatle, ne prepisan ovde. Dve implementacije
  -- istog skora su dva izvora istine, i prvi koji se raziđe je onaj u koji se
  -- ređe gleda (isti razlog iz kog je 0015 dopunila ovu funkciju umesto da
  -- napravi drugu).
  select jsonb_build_object(
           'score',              n.score,
           'n',                  n.n,
           'promoteri',          n.promoteri,
           'pasivni',            n.pasivni,
           'detraktori',         n.detraktori,
           'poslednjih_30_dana', n.poslednjih_30_dana
         )
    into v_nps
    from admin_nps() n;

  v_utisci := v_utisci || jsonb_build_object(
    'pitanja',    v_pitanja,
    'po_pitanju', v_po_pitanju,
    'obrada',     v_obrada,
    'nps',        v_nps
  );

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
-- ═══════════════════════════════════════════════════════════
-- 5. PRAVA
-- ═══════════════════════════════════════════════════════════
-- RLS na `feedback` ostaje `using (false)` (pravilo 10) — ove funkcije su
-- `security definer` i čitaju se isključivo kroz `service_role` rute.

revoke all on function admin_nps() from public, anon, authenticated;
revoke all on function admin_fali(text) from public, anon, authenticated;
revoke all on function admin_overview(integer, integer) from public, anon, authenticated;
revoke all on function zabelezi_utisak(
  text, integer, text, text, text, text, text, text, jsonb, text, integer,
  jsonb, text, integer, integer, jsonb
) from public, anon, authenticated;

grant execute on function admin_nps() to service_role;
grant execute on function admin_fali(text) to service_role;
grant execute on function admin_overview(integer, integer) to service_role;
grant execute on function zabelezi_utisak(
  text, integer, text, text, text, text, text, text, jsonb, text, integer,
  jsonb, text, integer, integer, jsonb
) to service_role;
