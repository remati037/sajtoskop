-- 0022_naplata.sql — S16: druga kasa kredita, tabele naplate, dnevni AI cap
--
-- Izvor: docs/LANSIRANJE.md §1.3 (planovi i dve kase), §1.4 (paketi kredita),
-- §1.5 (životni ciklus naloga). Sesija S16.
--
-- Ovo je NOVČANA PUTANJA. Tri pravila koja su vodila svaku odluku ispod:
--   1. Nijedno „pročitaj pa upiši" nad balansom. Sve pod istim `for update`.
--   2. Nijedan nov razlog u knjizi bez izmene I `check` ograničenja I TELA
--      `grant_credits` — zamku imenuje 0011, i tiho vraća `invalid_reason`.
--   3. Migracija se sme pustiti dvaput (`pnpm check:sql` je i pušta dvaput).
--
-- Šta ova migracija NE radi, iako je blizu: ne dira `grant_monthly_credits`
-- (v. §1 ispod), ne menja cenu skeniranja (to je S17) i ne uvodi nijednu
-- kapiju pristupa (to je S19). Kolone `beta_expires_at` / `plan_expires_at`
-- se ovde samo stvaraju; niko ih još ne čita.

-- ═══════════════════════════════════════════════════════════
-- 1. DRUGA KASA KREDITA
-- ═══════════════════════════════════════════════════════════
-- LANSIRANJE §1.4: `grant_monthly_credits` POSTAVLJA balans na ciljnu vrednost
-- (tako je izvedeno pravilo „bez rollovera"). Krediti kupljeni u paketu bi zato
-- bili OBRISANI prvom mesečnom dodelom.
--
-- Rešenje je druga kolona, ne izmena mesečne dodele:
--
--   credits_balance   pretplata i beta   resetuje se mesečno, bez rollovera
--   credits_topup     paketi             nikad ne ističe
--
-- `grant_monthly_credits` ostaje NEPROMENJENA i i dalje piše samo u
-- `credits_balance`. To je cela poenta razdvajanja — funkcija koja bi morala da
-- zna za dve kase bi morala i da odluči koju resetuje, a ta odluka je upravo
-- ono što razdvajanje uklanja.

alter table profiles add column if not exists credits_topup integer not null default 0;

alter table profiles drop constraint if exists profiles_topup_nonneg;
alter table profiles add  constraint profiles_topup_nonneg check (credits_topup >= 0);

-- ── zašto se donji prag balansa pomera sa 0 na -1000 ────────
-- [ODSTUPANJE od 0001 §1 — svesno, i jedino u ovoj migraciji]
--
-- `profiles_credits_nonneg check (credits_balance >= 0)` je bio drugi sloj
-- odbrane ispod `spend_credit_and_unlock` (P0-1). Ostaje to i dalje, samo sa
-- pomerenim pragom, i evo zašto mora:
--
-- Kupac uzme paket od 50 kredita, potroši svih 50, pa traži povraćaj. Paddle
-- vrati novac. Nama ostaje da skinemo 50 kredita kojih više nema. Danas
-- `admin_adjust_credits` na to vrati 'balans bi bio negativan' i odbije — dakle
-- kupac dobije i novac i posao (LANSIRANJE §2, red Z3).
--
-- Razmatrano i odbačeno:
--   - obrisati `check` u celosti → P0-1 pada na SVAKOJ putanji, ne samo na ovoj
--   - pustiti minus u `credits_topup` → ta kasa je jedina koja ne ističe, pa bi
--     dug u njoj bio trajan i nevidljiv; ostaje na tvrdoj nuli
--   - zasebna kolona `credits_debt` → traži da je `grant_monthly_credits` čita
--     i izmiruje, a ta funkcija po odluci iz §1.4 ostaje nepromenjena
--
-- Prag je -1000, dvostruko od najvećeg dozvoljenog pojedinačnog podešavanja
-- (`abs(p_delta) > 500` u `admin_adjust_credits`). Nijedna legitimna putanja ne
-- može ispod toga, pa `check` i dalje hvata odbegli skript — samo više ne hvata
-- povraćaj koji je stvarna, ispravna radnja.
--
-- Negativan balans NE nastaje potrošnjom: sve tri funkcije potrošnje odbijaju
-- pre skidanja ako u obe kase zajedno nema dovoljno. Jedini put do minusa je
-- `admin_adjust_credits(p_kind => 'povracaj')`.
alter table profiles drop constraint if exists profiles_credits_nonneg;
alter table profiles add  constraint profiles_credits_nonneg check (credits_balance >= -1000);

-- ── dnevni brojač AI varijanti poruke ───────────────────────
-- LANSIRANJE §1.3, izmena 1: razlika između planova više nije „AI poruke po
-- kanalu" (kod ionako daje sve kanale svima) nego dnevni broj „Napiši
-- drugačije" varijanti — jedini AI poziv koji korisnik ponavlja iz radoznalosti.
--
-- Isti oblik i isti LA dan kao `cache_miss_day` i `export_day` iz 0004.
-- Postoji i `AI_OUTREACH_DAILY_CAP` u plans.ts, ali to je GLOBALNI dnevni cap
-- nad mojim računom kod Anthropica; ovo je cap po korisniku, nad ponudom.
-- Dva različita pitanja, dva brojača.
alter table profiles add column if not exists ai_rewrite_day   date;
alter table profiles add column if not exists ai_rewrite_count integer not null default 0;

alter table profiles drop constraint if exists profiles_ai_rewrite_nonneg;
alter table profiles add  constraint profiles_ai_rewrite_nonneg check (ai_rewrite_count >= 0);

-- ═══════════════════════════════════════════════════════════
-- 2. NAPLATA — KOLONE NA PROFILU
-- ═══════════════════════════════════════════════════════════
-- LANSIRANJE §1.5: datumi se ne skladište dvaput. Čuvaju se samo dva ULAZA, a
-- sva stanja pristupa (`beta`, `aktivan`, `otkazan`, `dopuna`, `grace`,
-- `zakljucan`) se iz njih izvode u jednoj funkciji u S19:
--
--   pun pristup do = max(beta_expires_at, plan_expires_at)
--   čitanje do     = pun pristup do + GRACE_DAYS (30)

alter table profiles add column if not exists paddle_customer_id text;
alter table profiles add column if not exists plan_expires_at    timestamptz;

-- NULL = NEOGRANIČENA beta, ne „beta je istekla". Podrazumevana dužina je 30
-- dana od otvaranja naloga (odluka P6), ali je postavlja admin — nikad
-- registracija. Ovde nema `default now() + interval` baš zato: vrednost koja
-- nastane sama bila bi beta plan koji nastaje sam, a §1.1 to izričito zabranjuje.
alter table profiles add column if not exists beta_expires_at    timestamptz;

-- Webhook iz S18 nalazi korisnika po Paddle customer ID-ju kad `custom_data`
-- ne stigne (stari događaj, ručno napravljena transakcija u panelu).
create index if not exists profiles_paddle_customer_idx
  on profiles (paddle_customer_id)
  where paddle_customer_id is not null;

-- ═══════════════════════════════════════════════════════════
-- 3. NAPLATA — TABELE
-- ═══════════════════════════════════════════════════════════

-- ── idempotencija webhooka ──────────────────────────────────
-- Pravilo 1 iz naplata-paddle.md §5.3: svaki webhook se PRVO upiše ovde, po ID-u
-- događaja. Duplikat se preskače. Bez ovoga se krediti dodeljuju dvaput, a
-- Paddle ponavlja isporuku na svaki non-2xx i na mrežni timeout — dakle i onda
-- kad je posao već prošao.
--
-- Ovo je gruba brana, nad SVIM događajima. Fina brana je `ref_id` u knjizi
-- (Paddle transaction ID), koja drži i kad se isti novac javi kroz dva
-- različita događaja.
create table if not exists billing_events (
  event_id    text primary key,
  event_type  text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);

create index if not exists billing_events_received_idx
  on billing_events (received_at desc);

-- ── ogledalo pretplate ──────────────────────────────────────
-- Izvor istine o naplati je Paddle; ovo je kopija koja postoji da kapija
-- pristupa (S19) i ekran stanja (S21) ne moraju da zovu mrežu na svakom
-- učitavanju.
--
-- `paddle_subscription_id` je PRIRODAN ključ i zato PK: ID koji dodeljuje
-- Paddle je jedinstven po definiciji, pa bi surogat `bigserial` uz `unique` nad
-- njim bio isti uslov napisan dvaput.
--
-- `on delete cascade`: pretplata je korisnikov podatak i briše se sa nalogom
-- (pravilo 15). Knjigovodstveni original ostaje kod Paddle-a, koji je merchant
-- of record — ovde nema ničega što bi brisanje izgubilo.
create table if not exists subscriptions (
  paddle_subscription_id text primary key,
  user_id                text not null references profiles(id) on delete cascade,
  paddle_customer_id     text,
  status                 text not null,
  price_id               text,
  plan                   text,
  current_period_end     timestamptz,
  canceled_at            timestamptz,
  country_code           text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Paddle-ova lista statusa pretplate. Nepoznat status iz webhooka mora da
  -- pukne glasno, a ne da tiho uđe u tabelu i onda zbuni kapiju pristupa.
  constraint subscriptions_status_valid check (
    status in ('active', 'trialing', 'past_due', 'paused', 'canceled')
  ),
  -- Samo plaćeni planovi. `beta` postavlja admin i nikad nema pretplatu, a
  -- `dopuna` je izvedeno stanje (nema pretplate, ima kupljenih kredita) — ni
  -- jedno ni drugo ne sme da nastane iz webhooka (§1.1, §1.3).
  constraint subscriptions_plan_valid check (
    plan is null or plan in ('starter', 'pro', 'advanced')
  ),
  -- Pravilo 11: `country_code` u svakoj relevantnoj tabeli od prvog dana.
  constraint subscriptions_country_code_valid check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  )
);

create index if not exists subscriptions_user_idx
  on subscriptions (user_id, current_period_end desc);

-- Pravilo 10: RLS na svakoj tabeli, i to `force` da ne bi vlasnik šeme
-- zaobišao sopstvenu politiku. BEZ IJEDNE POLITIKE — obe tabele se čitaju
-- isključivo kroz serverske rute, `service_role` klijentom. Naplata nije
-- podatak koji sme da procuri kroz anon ključ.
alter table billing_events enable row level security;
alter table billing_events force  row level security;
alter table subscriptions  enable row level security;
alter table subscriptions  force  row level security;

-- ═══════════════════════════════════════════════════════════
-- 4. RAZLOZI U KNJIZI
-- ═══════════════════════════════════════════════════════════
-- Tri nova razloga:
--   subscription_grant  mesečna dodela iz plaćene pretplate (puni credits_balance)
--   credit_pack         kupljen paket kredita           (puni credits_topup)
--   onboarding          besplatan prvi unlock iz F8 §2  (puni credits_balance)
--
-- `onboarding` se dodaje SADA iako ga koristi tek S24: nov razlog znači izmenu
-- `check` ograničenja, tela `grant_credits` i parcijalnog indeksa — dakle celu
-- ovu sekciju ponovo, u zasebnoj migraciji, nad novčanom putanjom. Jeftinije je
-- jednom. `ref_id` je `user_id`, dakle najviše jednom po nalogu.

alter table credit_ledger drop constraint if exists credit_ledger_reason_valid;
alter table credit_ledger add  constraint credit_ledger_reason_valid check (
  reason in (
    'unlock', 'scan', 'monthly_grant', 'admin', 'refund', 'feedback',
    'subscription_grant', 'credit_pack', 'onboarding'
  )
);

-- Sva tri nova razloga su DODELE i sva tri nose `ref_id` koji je jedinstven po
-- događaju (Paddle transaction ID, odnosno `user_id`). Ulaze zato u isti
-- parcijalni unique indeks — poslednja brana ispod `grant_credits`, koja drži i
-- kad neko pozove RPC mimo aplikacije.
drop index if exists credit_ledger_grant_idem_idx;
create unique index credit_ledger_grant_idem_idx
  on credit_ledger (user_id, reason, ref_id)
  where ref_id is not null and reason in (
    'monthly_grant', 'admin', 'feedback',
    'subscription_grant', 'credit_pack', 'onboarding'
  );

-- ═══════════════════════════════════════════════════════════
-- 5. grant_credits — RAZLOG BIRA KASU
-- ═══════════════════════════════════════════════════════════
-- Zamka koju 0011 izričito imenuje (pravilo 3): prošireno `check` ograničenje
-- nad `credit_ledger` NIJE dovoljno. `grant_credits` interno validira razlog, pa
-- bi bez izmene tela svaki poziv sa novim razlogom tiho vratio `invalid_reason`
-- i nijedan kredit ne bi bio dodeljen.
--
-- ── zašto mapa u telu, a ne parametar `p_topup boolean` ─────
-- Parametar bi značio da ODLUKU o tome koji krediti ističu donosi pozivalac, a
-- pozivalac je webhook: jedno mesto gde greška znači ili kredite koji nikad ne
-- ističu iako je pretplata prestala, ili kupljene kredite obrisane prvom
-- mesečnom dodelom. Razlog već nosi taj podatak — `credit_pack` JESTE „paket",
-- a paket po odluci iz §1.4 ne ističe. Izvođenje u jednom mestu čini
-- razilaženje nemogućim, umesto da ga čini malo verovatnim.
--
-- Telo je inače nepromenjeno u odnosu na 0011: lista razloga i izbor kolone.
create or replace function grant_credits(
  p_user   text,
  p_amount integer,
  p_reason text,
  p_ref_id text default null
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_amount <= 0 then
    return query select false, 'invalid_amount'; return;
  end if;

  if p_reason not in (
    'monthly_grant', 'admin', 'refund', 'feedback',
    'subscription_grant', 'credit_pack', 'onboarding'
  ) then
    return query select false, 'invalid_reason'; return;
  end if;

  perform 1 from profiles where id = p_user for update;
  if not found then
    return query select false, 'no_user'; return;
  end if;

  -- Alias je obavezan: `reason` je i izlazni parametar ove funkcije i kolona u
  -- credit_ledger, pa nekvalifikovano ime baca "column reference is ambiguous".
  if p_ref_id is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = p_reason and cl.ref_id = p_ref_id
  ) then
    return query select true, 'already_granted'; return;
  end if;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, p_amount, p_reason, p_ref_id);

  -- Mapa razloga → kasa. Jedini razlog koji puni `credits_topup` je kupljen
  -- paket; sve ostalo (pretplata, beta, admin, utisak, povraćaj, onboarding)
  -- je kredit koji ističe i ide u `credits_balance`.
  if p_reason = 'credit_pack' then
    update profiles set credits_topup = credits_topup + p_amount where id = p_user;
  else
    update profiles set credits_balance = credits_balance + p_amount where id = p_user;
  end if;

  return query select true, 'granted';
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. POTROŠNJA IZ DVE KASE
-- ═══════════════════════════════════════════════════════════
-- Pravilo iz §1.4: provera je nad ZBIROM, skidanje ide PRVO sa `credits_balance`
-- (ističe), pa sa `credits_topup` (ne ističe). To je jedini redosled koji je u
-- korist korisnika — obrnut bi trošio ono što ne propada i puštao da propadne
-- ono što bi mogao da iskoristi.
--
-- Obe funkcije čitaju obe kase u istom `select ... for update` i pišu ih u istom
-- `update`. Nema drugog čitanja i nema druge transakcije — dakle nema mesta na
-- kome bi se „pročitaj pa upiši" uvuklo.
--
-- `greatest(v_balance, 0)` nije kozmetika: posle povraćaja (§1) `credits_balance`
-- ume da bude negativan. Bez ograđivanja bi skidanje „prvo sa balansa" gurnulo
-- balans još dublje u minus dok se `credits_topup` ne dodiruje — dug bi rastao
-- umesto da se troše krediti koji stvarno postoje. Zbir je u oba slučaja
-- ispravan, ali podela na kase ne bi bila.

-- ── otključavanje ───────────────────────────────────────────
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
begin
  -- FOR UPDATE zaključava red do kraja transakcije. Ovo je jedini razlog
  -- zbog kog 20 paralelnih poziva sa 1 kreditom daje tačno jedan 'unlocked'.
  select p.credits_balance, p.credits_topup into v_balance, v_topup
  from profiles p where p.id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user'; return;
  end if;

  -- Već otključano → besplatno, ne naplaćuj dvaput (pravilo 4).
  if exists (select 1 from unlocks where user_id = p_user and place_id = p_place) then
    return query select true, 'already_unlocked'; return;
  end if;

  if v_balance + v_topup < 1 then
    return query select false, 'insufficient_credits'; return;
  end if;

  -- [ODSTUPANJE] Provera da lead uopšte postoji. Bez nje FK baca izuzetak koji
  -- na API sloju izgleda kao 500 umesto kao uredna poruka.
  if not exists (select 1 from businesses where place_id = p_place) then
    return query select false, 'no_place'; return;
  end if;

  v_iz_balansa := least(1, greatest(v_balance, 0));

  insert into unlocks (user_id, place_id) values (p_user, p_place);
  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, -1, 'unlock', p_place);

  update profiles
  set credits_balance = credits_balance - v_iz_balansa,
      credits_topup   = credits_topup - (1 - v_iz_balansa)
  where id = p_user;

  return query select true, 'unlocked';
end;
$$;

-- ── skeniranje ──────────────────────────────────────────────
-- Telo je nepromenjeno u odnosu na 0009 osim čitanja i skidanja iz dve kase i
-- `credits_left` koji je od sada ZBIR. Cena je i dalje fiksno 1 kredit —
-- izvođenje cene iz broja stranica je S17, i menja se zajedno sa svim UI
-- stringovima koji danas tvrde „1 kredit" (LANSIRANJE §1.2).
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
  v_balance    integer;
  v_topup      integer;
  v_iz_balansa integer;
  v_key        text := p_country || ':' || p_city || ':' || p_niche;
  v_live       bigint;
  v_id         bigint;
  v_joined     boolean;
begin
  select p.credits_balance, p.credits_topup into v_balance, v_topup
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

    return query select true, 'already_paid', v_live, true, false, v_balance + v_topup;
    return;
  end if;

  if v_balance + v_topup < 1 then
    return query select false, 'insufficient_credits', null::bigint, false, false,
                        v_balance + v_topup;
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

  v_iz_balansa := least(1, greatest(v_balance, 0));

  update profiles
  set credits_balance = credits_balance - v_iz_balansa,
      credits_topup   = credits_topup - (1 - v_iz_balansa)
  where id = p_user;

  -- U `search_cache` se ovde NE dira ništa. Registar sme da dobije red tek kad
  -- skeniranje stvarno završi (`record_scan`) — v. obrazloženje u 0009.
  return query select true, 'charged', v_id, coalesce(v_joined, false), true,
                      v_balance + v_topup - 1;
end;
$$;

-- ── povraćaj za skeniranje ──────────────────────────────────
-- `refund_scan` vraća kredit u `credits_balance` bez obzira iz koje je kase
-- skinut, i to je namerno: kredit iz paketa vraćen u kasu koja ističe bio bi
-- šteta po korisnika, a ovako je najgori ishod da kredit iz pretplate završi u
-- kasi koja ističe — tamo gde je i bio. Ostaje nepromenjena iz 0009.

-- ═══════════════════════════════════════════════════════════
-- 7. RUČNA KOREKCIJA I POVRAĆAJ
-- ═══════════════════════════════════════════════════════════
/**
 * Ručna izmena balansa iz admin konzole. Jedini put do NEGATIVNOG iznosa
 * (pravilo 3), i od S16 jedini put do negativnog BALANSA.
 *
 * `p_kind` je nov i ima podrazumevanu vrednost, pa svaki postojeći pozivalac
 * radi nepromenjeno:
 *
 *   'korekcija'  (podrazumevano) — ponašanje iz 0012 doslovno. Rezultat ispod
 *                nule se odbija sa 'balans bi bio negativan'. Admin koji greškom
 *                oduzme previše i dalje dobija odbijenicu, ne minus.
 *
 *   'povracaj'   — sme u minus. Postoji za jedan slučaj: Paddle je vratio novac
 *                za paket čiji su krediti već potrošeni. Odbiti tu radnju znači
 *                da je kupac dobio i novac i posao, a to nije zaštita balansa
 *                nego rupa u naplati (LANSIRANJE §2, red Z3).
 *
 * Razlog u knjizi ostaje `'admin'` i za povraćaj. Time `credit_ledger_grant_idem_idx`
 * i dalje pokriva ovu putanju — dupla isporuka istog `refund` webhooka nosi isti
 * `ref_id` i ne skida kredite dvaput. Razlika između korekcije i povraćaja se
 * čuva tamo gde joj je mesto: u `admin_audit.payload` (pravilo 14).
 *
 * Poznata posledica, zapisana da se ne otkriva kasnije: `grant_monthly_credits`
 * POSTAVLJA balans, pa prva sledeća mesečna dodela briše negativan balans.
 * Dug traje najviše do kraja meseca. To je cena odluke iz §1.4 da ta funkcija
 * ostane nepromenjena; ako se pokaže kao stvaran problem, rešenje je zasebna
 * kolona duga, ne izmena ove funkcije.
 */
drop function if exists admin_adjust_credits(text, text, integer, text, text);

create or replace function admin_adjust_credits(
  p_actor  text,
  p_user   text,
  p_delta  integer,
  p_note   text,
  p_ref_id text,
  p_kind   text default 'korekcija'
)
returns table (ok boolean, reason text, balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
  v_topup   integer;
begin
  if p_delta = 0 then
    return query select false, 'invalid_amount'::text, null::integer; return;
  end if;

  if abs(p_delta) > 500 then
    return query select false, 'iznos van granica'::text, null::integer; return;
  end if;

  if p_kind not in ('korekcija', 'povracaj') then
    return query select false, 'nepoznata vrsta'::text, null::integer; return;
  end if;

  -- `for update` drži red dok se ne upiše i knjiga i balans: dva admina koja u
  -- istoj sekundi oduzimaju kredite ne smeju oba da pročitaju isti balans.
  select p.credits_balance, p.credits_topup into v_balance, v_topup
  from profiles p where p.id = p_user for update;
  if not found then
    return query select false, 'no_user'::text, null::integer; return;
  end if;

  -- Obična korekcija se meri nad ZBIROM obe kase: admin koji vidi „50 kredita"
  -- na ekranu ne zna niti treba da zna kako su podeljeni, pa bi odbijenica zbog
  -- prazne jedne kase bila neobjašnjiva. Povraćaj tu proveru preskače.
  if p_kind = 'korekcija' and v_balance + v_topup + p_delta < 0 then
    return query select false, 'balans bi bio negativan'::text, v_balance; return;
  end if;

  -- Idempotencija po `ref_id` iz forme. Alias je obavezan: `reason` je i izlazni
  -- parametar ove funkcije i kolona u `credit_ledger`.
  if p_ref_id is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'admin' and cl.ref_id = p_ref_id
  ) then
    return query select true, 'already_applied'::text, v_balance; return;
  end if;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, p_delta, 'admin', p_ref_id);

  -- Admin uvek dira kasu koja ISTIČE. Dodela kroz konzolu je zamena za mesečnu
  -- dodelu, ne prodaja paketa; a oduzimanje mora da pogodi kasu koja sme u
  -- minus, jer je `credits_topup` na tvrdoj nuli (§1).
  update profiles set credits_balance = credits_balance + p_delta where id = p_user
    returning credits_balance into v_balance;

  -- Pravilo 14: mutacija i njen trag su jedna transakcija. Da audit piše ruta,
  -- pad između upisa i loga bi ostavio kredite bez ijednog zapisa o tome ko ih je
  -- dao — a to je jedino pitanje na koje ovaj dnevnik postoji da odgovori.
  insert into admin_audit (actor_id, action, target_user, target_ref, payload)
    values (p_actor, 'credits.adjust', p_user, p_ref_id,
            jsonb_build_object('delta', p_delta, 'note', p_note, 'kind', p_kind));

  return query select true, 'ok'::text, v_balance;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 8. PRIMENA PLAĆANJA
-- ═══════════════════════════════════════════════════════════
-- Obe funkcije zove isključivo webhook iz S18, posle provere potpisa i posle
-- upisa u `billing_events`. Obe su idempotentne po Paddle transaction ID-ju, pa
-- su bezbedne i kad gruba brana zakaže.

/**
 * Upiši stanje pretplate i, ako je uz nju stigla naplaćena transakcija,
 * dodeli mesečne kredite — u jednoj transakciji.
 *
 * `p_txn_id` je Paddle transaction ID i ujedno `ref_id` dodele. Događaj bez
 * naplate (`subscription.updated` na promenu adrese, na primer) prosleđuje NULL
 * i tada se stanje osveži bez ijednog kredita — ishod `saved`.
 *
 * `profiles.plan` se postavlja i za `canceled`: po §1.5 otkazana pretplata radi
 * do kraja plaćenog perioda, a granicu drži `plan_expires_at`, ne plan.
 */
create or replace function apply_subscription(
  p_user            text,
  p_subscription_id text,
  p_customer_id     text,
  p_status          text,
  p_price_id        text,
  p_plan            text,
  p_period_end      timestamptz,
  p_credits         integer default 0,
  p_txn_id          text default null,
  p_country         text default null,
  p_canceled_at     timestamptz default null
)
returns table (ok boolean, reason text, granted integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok     boolean;
  v_reason text;
begin
  if p_subscription_id is null or p_subscription_id = '' then
    return query select false, 'missing_subscription_id'::text, 0; return;
  end if;

  if p_status not in ('active', 'trialing', 'past_due', 'paused', 'canceled') then
    return query select false, 'invalid_status'::text, 0; return;
  end if;

  if p_plan is not null and p_plan not in ('starter', 'pro', 'advanced') then
    return query select false, 'invalid_plan'::text, 0; return;
  end if;

  perform 1 from profiles where id = p_user for update;
  if not found then
    return query select false, 'no_user'::text, 0; return;
  end if;

  insert into subscriptions (
    paddle_subscription_id, user_id, paddle_customer_id, status, price_id,
    plan, current_period_end, canceled_at, country_code
  )
  values (
    p_subscription_id, p_user, p_customer_id, p_status, p_price_id,
    p_plan, p_period_end, p_canceled_at, p_country
  )
  on conflict (paddle_subscription_id) do update set
    user_id            = excluded.user_id,
    paddle_customer_id = coalesce(excluded.paddle_customer_id, subscriptions.paddle_customer_id),
    status             = excluded.status,
    price_id           = coalesce(excluded.price_id, subscriptions.price_id),
    plan               = coalesce(excluded.plan, subscriptions.plan),
    current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end),
    canceled_at        = excluded.canceled_at,
    country_code       = coalesce(excluded.country_code, subscriptions.country_code),
    updated_at         = now();

  update profiles
  set plan               = coalesce(p_plan, plan),
      plan_expires_at    = coalesce(p_period_end, plan_expires_at),
      paddle_customer_id = coalesce(p_customer_id, paddle_customer_id)
  where id = p_user;

  if p_credits is null or p_credits <= 0 or p_txn_id is null or p_txn_id = '' then
    return query select true, 'saved'::text, 0; return;
  end if;

  select g.ok, g.reason into v_ok, v_reason
    from grant_credits(p_user, p_credits, 'subscription_grant', p_txn_id) g;

  if not coalesce(v_ok, false) then
    return query select false, coalesce(v_reason, 'nepoznat razlog')::text, 0; return;
  end if;

  if v_reason = 'already_granted' then
    return query select true, 'already_granted'::text, 0; return;
  end if;

  return query select true, 'granted'::text, p_credits;
end;
$$;

/**
 * Dodaj kupljene kredite u kasu koja NE ISTIČE.
 *
 * Kasu bira `grant_credits` po razlogu `'credit_pack'` (§5) — ova funkcija je
 * ne imenuje. Time je nemoguće da se paket jednom upiše u jednu, a drugi put u
 * drugu kasu.
 *
 * `p_txn_id` je Paddle transaction ID i ujedno `ref_id`: dupla isporuka istog
 * webhooka ne može da dodeli kredite dvaput ni kad `billing_events` zakaže.
 */
create or replace function apply_credit_pack(
  p_user        text,
  p_credits     integer,
  p_txn_id      text,
  p_customer_id text default null
)
returns table (ok boolean, reason text, granted integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok     boolean;
  v_reason text;
begin
  if p_credits is null or p_credits <= 0 then
    return query select false, 'invalid_amount'::text, 0; return;
  end if;

  if p_txn_id is null or p_txn_id = '' then
    -- Bez ključa idempotencije ovo je oružje: svaka ponovljena isporuka
    -- webhooka dodelila bi pun paket još jednom.
    return query select false, 'missing_ref_id'::text, 0; return;
  end if;

  perform 1 from profiles where id = p_user for update;
  if not found then
    return query select false, 'no_user'::text, 0; return;
  end if;

  if p_customer_id is not null then
    update profiles set paddle_customer_id = p_customer_id where id = p_user;
  end if;

  select g.ok, g.reason into v_ok, v_reason
    from grant_credits(p_user, p_credits, 'credit_pack', p_txn_id) g;

  if not coalesce(v_ok, false) then
    return query select false, coalesce(v_reason, 'nepoznat razlog')::text, 0; return;
  end if;

  if v_reason = 'already_granted' then
    return query select true, 'already_granted'::text, 0; return;
  end if;

  return query select true, 'granted'::text, p_credits;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 9. DNEVNI CAP NA AI VARIJANTE
-- ═══════════════════════════════════════════════════════════
-- Isti par kao `claim_cache_miss` / `release_cache_miss` iz 0003, nad
-- `ai_rewrite_day` / `ai_rewrite_count`. Rezervacija i reset dana su u istoj
-- transakciji pod `for update` — dva paralelna zahteva u ponoć inače oba vide
-- stari dan i oba resetuju brojač.
--
-- Ovo se u S16 nigde ne poziva; ruta koja ga koristi je S21. Stoji ovde da
-- `aiRewritePerDay` iz plans.ts ne bi bio broj bez ijednog brojača iza sebe.

create or replace function claim_ai_rewrite(p_user text, p_limit integer)
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
  select p.ai_rewrite_count, p.ai_rewrite_day into v_count, v_prev
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
  set ai_rewrite_day = v_day, ai_rewrite_count = v_count + 1
  where id = p_user;

  return query select true, 'claimed', v_count + 1, p_limit - v_count - 1,
                      budget_next_day_reset(v_day);
end;
$$;

/**
 * Vrati rezervaciju kad AI poziv posle nje padne. Bez ovoga korisnik gubi
 * dnevnu varijantu zbog greške koja nije njegova — isti razlog zbog kog
 * `release_cache_miss` postoji uz `claim_cache_miss`.
 */
create or replace function release_ai_rewrite(p_user text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update profiles
  set ai_rewrite_count = greatest(0, ai_rewrite_count - 1)
  where id = p_user and ai_rewrite_day = budget_day();
$$;

-- ═══════════════════════════════════════════════════════════
-- 10. PRAVA NAD FUNKCIJAMA
-- ═══════════════════════════════════════════════════════════
-- Isti razlog kao u 0001 §4: `security definer` je podrazumevano izvršiva za
-- `public`, pa bi bilo ko sa anon ključem mogao da pozove
-- apply_credit_pack('ja', 150, 'txn_bilo_sta') preko PostgREST-a i sam sebi
-- dodeli paket koji nije platio.
--
-- `grant_credits` i `spend_credit_*` se ovde ponavljaju jer je `create or
-- replace` nad njima zadržao prava, ali `admin_adjust_credits` je zbog novog
-- parametra DROP-ovana i napravljena iznova — a nova funkcija nasleđuje
-- podrazumevano `execute` za `public`.

revoke all on function grant_credits(text, integer, text, text)
  from public, anon, authenticated;
revoke all on function spend_credit_and_unlock(text, text)
  from public, anon, authenticated;
revoke all on function spend_credit_and_scan(text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function admin_adjust_credits(text, text, integer, text, text, text)
  from public, anon, authenticated;
revoke all on function apply_subscription(text, text, text, text, text, text, timestamptz, integer, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function apply_credit_pack(text, integer, text, text)
  from public, anon, authenticated;
revoke all on function claim_ai_rewrite(text, integer)
  from public, anon, authenticated;
revoke all on function release_ai_rewrite(text)
  from public, anon, authenticated;

grant execute on function grant_credits(text, integer, text, text) to service_role;
grant execute on function spend_credit_and_unlock(text, text) to service_role;
grant execute on function spend_credit_and_scan(text, text, text, text, integer) to service_role;
grant execute on function admin_adjust_credits(text, text, integer, text, text, text) to service_role;
grant execute on function apply_subscription(text, text, text, text, text, text, timestamptz, integer, text, text, timestamptz) to service_role;
grant execute on function apply_credit_pack(text, integer, text, text) to service_role;
grant execute on function claim_ai_rewrite(text, integer) to service_role;
grant execute on function release_ai_rewrite(text) to service_role;
