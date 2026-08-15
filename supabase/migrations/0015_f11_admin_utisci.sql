-- 0015_f11_admin_utisci.sql — F11.3: brojke za `/admin/utisci`
--
-- Izvor: docs/F11-utisci-v2.md §6.6 („Iznad liste jedan red brojki: odgovorenost
-- po pitanju, medijana cene, broj otvorenih bugova, prosek do odgovora. Isti red
-- se pojavljuje i kao kartica na `/admin` pregledu.").
--
-- Nijedna nova tabela, nijedna nova kolona, nijedan dodirnut podatak. Menja se
-- TAČNO JEDNA stvar: `admin_overview` (0013) dobija dva ključa u kartici
-- „utisci".
--
-- ── zašto se dopunjuje postojeća funkcija, a ne pravi druga ──
-- „Brojke moraju da se poklope sa karticom Utisci na /admin pregledu." Dve
-- funkcije koje broje isto su dva izvora istine, i prvi koji se raziđe je onaj u
-- koji se ređe gleda. Zato `/admin/utisci` zove ISTI `admin_overview` kao i
-- pregled — a ovde se dopisuje samo ono što pregledu do sada nije trebalo.
--
-- ── šta se OVDE i dalje ne računa ────────────────────────────
-- Medijana cene. `cena_odgovori` ostaje spisak sirovih odgovora, jer sredine
-- opsega žive u `packages/shared/src/feedback-katalog.ts`, zajedno sa samim
-- opsezima (`medijanaCene()` je jedini izvor istine, F11 §5 i „S5", tačka 14).
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
  v_budzet     jsonb;
  v_poslovi    jsonb;
  v_korisnici  jsonb;
  v_krediti    jsonb;
  v_utisci     jsonb;
  v_pitanja    jsonb;
  v_po_pitanju jsonb;
  v_obrada     jsonb;
  v_cena       jsonb;
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

  select coalesce(jsonb_agg(f.answers ->> 'odgovor'), '[]'::jsonb)
    into v_cena
    from feedback f
   where f.prompt_key = 'cena' and f.answers ? 'odgovor';

  v_utisci := v_utisci || jsonb_build_object(
    'pitanja',       v_pitanja,
    'po_pitanju',    v_po_pitanju,
    'obrada',        v_obrada,
    'cena_odgovori', v_cena
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

revoke all on function admin_overview(integer, integer) from public, anon, authenticated;
grant execute on function admin_overview(integer, integer) to service_role;

-- ── indeks za listu utisaka ─────────────────────────────────
-- `/admin/utisci` sortira po `created_at desc` bez ijednog filtera čim se otvori.
-- `feedback_status_idx (status, created_at desc)` iz 0011 tu ne pomaže, jer
-- vodeća kolona nije u upitu. Tabela je danas mala i to se ne vidi — ali indeks
-- koji se doda kad se vidi je indeks koji se dodaje nad tabelom koja se već
-- čita sporo.
create index if not exists feedback_created_idx on feedback (created_at desc);
