-- supabase/migrations/0034_scan_refund.sql
-- Skeniranje koje korisniku nije dalo listu vraća kredit SAMO, u istoj
-- transakciji u kojoj se posao obeleži palim. Korisnik ne prijavljuje ništa.
--
-- ── šta je bilo pogrešno ────────────────────────────────────
-- Kad `record_scan` padne posle naplate, posao je i dalje završavao kao `done`:
-- nema ni pada ni greške, kombinacija nije u kešu, ekran se isprazni. Web je to
-- krpio porukom koja od korisnika traži da prijavi broj posla i da NE ponavlja
-- pretragu. To je zadatak korisniku zbog naše greške, i briše se zajedno sa
-- granom koja je ponavljanje sprečavala (`scanBezRegistra` → 503).
--
-- ── šta radi `refund_scan` od 0034 ──────────────────────────
--   · razlog u knjizi je `scan_refund` (bio `refund`), ref `scan_refund:<job>`
--     — deterministički, pa Stripe-ov ekvivalent ovde (retry workera, metla nad
--     zaglavljenim poslovima) pada na unique indeks;
--   · `details` nosi `job_id`, kombinaciju, plaćeno i vraćeno — `job_id` od
--     sada živi u knjizi i reviziji, nikad u tekstu koji korisnik vidi;
--   · `search_access` za tu kombinaciju se BRIŠE kad je povraćaj pun (nema
--     liste, ne sme da ostane „pristup"), a kod delimičnog se spušta na broj
--     stranica koje su stvarno stigle — kao i do sada;
--   · svaki povraćaj upisuje red u `admin_audit` (`scan_refund`, `actor_id`
--     null), sa poslom, kombinacijom i iznosom.
--
-- Stari redovi (`reason = 'refund'`, ref `scan:<job>`) i dalje važe kao dokaz da
-- je posao već refundiran: posao refundiran pre ove migracije ne sme da dobije
-- drugi povraćaj. Zato provera gleda OBA oblika.
--
-- ── `fail_scan_and_refund` ──────────────────────────────────
-- Jedna transakcija: `job_queue` → `failed` (+ `last_error`) i povraćaj. Do sada
-- su to bila dva nezavisna poziva iz workera, pa je pad između njih ostavljao
-- posao bez kredita ili kredit bez palog posla. Poziva je `runScan` kad registar
-- keša ne prođe; `fail_job` ostaje za sve ostalo (ima svoj retry račun).
--
-- Idempotentna: `create or replace`, `drop index if exists`, ograničenje se
-- prepisuje u celosti.

-- ═══════════════════════════════════════════════════════════
-- 1. RAZLOG `scan_refund`
-- ═══════════════════════════════════════════════════════════
alter table credit_ledger drop constraint if exists credit_ledger_reason_valid;
alter table credit_ledger add  constraint credit_ledger_reason_valid check (
  reason in (
    'unlock', 'scan', 'monthly_grant', 'admin', 'refund', 'feedback',
    'subscription_grant', 'credit_pack', 'onboarding', 'beta_grant',
    'trial_grant', 'komp_grant', 'expire', 'povracaj', 'scan_refund'
  )
);

-- Poslednja brana ispod `refund_scan`, i kad RPC pozove neko mimo workera.
-- `credit_ledger_scan_refund_idx` (0009) pokriva stari oblik i ostaje netaknut.
drop index if exists credit_ledger_scan_refund2_idx;
create unique index credit_ledger_scan_refund2_idx
  on credit_ledger (user_id, reason, ref_id)
  where reason = 'scan_refund';

-- ═══════════════════════════════════════════════════════════
-- 2. refund_scan — novi razlog, revizija, brisanje pristupa
-- ═══════════════════════════════════════════════════════════
-- Vraća broj PLATILACA kojima je nešto vraćeno (nepromenjeno).
create or replace function refund_scan(p_job_id bigint, p_pages_used integer default 0)
returns table (refunded integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_stari   text := 'scan:' || p_job_id;
  v_ref     text := 'scan_refund:' || p_job_id;
  v_user    text;
  v_placeno integer;
  v_iznos   integer;
  v_count   integer := 0;
  v_pages   integer := greatest(0, coalesce(p_pages_used, 0));
  v_job     record;
begin
  -- Kombinacija se čita sa posla: ide u `details` i u reviziju, da se povraćaj
  -- može pročitati bez ukrštanja sa `job_queue`.
  select (q.payload ->> 'countryCode') as country,
         (q.payload ->> 'citySlug')    as city,
         (q.payload ->> 'nicheSlug')   as niche
    into v_job
    from job_queue q where q.id = p_job_id;

  for v_user, v_placeno in
    select cl.user_id, (-sum(cl.delta))::int from credit_ledger cl
     where cl.reason = 'scan' and cl.ref_id = v_stari
       -- Oba oblika: `scan_refund:<job>` (0034) i stari `refund` + `scan:<job>`.
       and not exists (select 1 from credit_ledger r
                        where r.user_id = cl.user_id
                          and ((r.reason = 'scan_refund' and r.ref_id = v_ref)
                            or (r.reason = 'refund' and r.ref_id = v_stari)))
     group by cl.user_id
  loop
    v_iznos := v_placeno - v_pages;
    if coalesce(v_iznos, 0) <= 0 then continue; end if;

    perform 1 from profiles p where p.id = v_user for update;

    insert into credit_ledger (user_id, delta, reason, ref_id, details)
      values (v_user, v_iznos, 'scan_refund', v_ref,
              jsonb_build_object(
                'job_id', p_job_id,
                'country_code', v_job.country,
                'city_slug', v_job.city,
                'niche_slug', v_job.niche,
                'placeno', v_placeno,
                'vraceno', v_iznos,
                'stranica_stiglo', v_pages
              ));

    update profiles set credits_balance = credits_balance + v_iznos where id = v_user;

    if v_pages > 0 then
      -- Delimičan povraćaj: lista postoji, samo je plića. Pristup se spušta.
      update search_access set pages = least(pages, greatest(1, v_pages))
       where job_id = p_job_id and user_id = v_user;
    else
      -- Pun povraćaj: liste nema. Pristup bez liste je gori od nikakvog —
      -- korisnik bi gledao prazan ekran koji tvrdi da je plaćen.
      delete from search_access where job_id = p_job_id and user_id = v_user;
    end if;

    -- Pravilo 14 po duhu: izmena tuđih kredita mimo konzole ostavlja trag.
    -- `actor_id` je null — „nije iz konzole", isti obrazac kao Stripe webhook.
    insert into admin_audit (actor_id, action, target_user, target_ref, payload)
      values (null, 'scan_refund', v_user, v_ref,
              jsonb_build_object(
                'job_id', p_job_id,
                'kombinacija', concat_ws(':', v_job.country, v_job.city, v_job.niche),
                'placeno', v_placeno,
                'vraceno', v_iznos,
                'stranica_stiglo', v_pages
              ));

    v_count := v_count + 1;
  end loop;

  return query select v_count;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 3. fail_scan_and_refund — pad i povraćaj u JEDNOJ transakciji
-- ═══════════════════════════════════════════════════════════
-- `p_error` ide u `job_queue.last_error`; web iz njega ne čita tekst za
-- korisnika (stanje E/B ima svoj tekst), nego samo iz statusa.
--
-- Status se diže na `failed` bez obzira na broj pokušaja: ovo nije prolazan
-- neuspeh koji vredi ponoviti — Places pozivi su već potrošeni, a ponavljanje
-- bi ih platilo opet. Zato ne ide kroz `fail_job`.
create or replace function fail_scan_and_refund(p_job_id bigint, p_error text)
returns table (refunded integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  update job_queue
     set status = 'failed', finished_at = now(), locked_at = null,
         last_error = left(coalesce(p_error, 'skeniranje bez rezultata'), 2000)
   where id = p_job_id and status in ('running', 'pending');

  select r.refunded into v_count from refund_scan(p_job_id, 0) r;

  return query select coalesce(v_count, 0);
end $$;

-- ═══════════════════════════════════════════════════════════
-- 4. PRAVA
-- ═══════════════════════════════════════════════════════════
revoke all on function refund_scan(bigint, integer) from public, anon, authenticated;
revoke all on function fail_scan_and_refund(bigint, text) from public, anon, authenticated;
grant execute on function refund_scan(bigint, integer) to service_role;
grant execute on function fail_scan_and_refund(bigint, text) to service_role;
