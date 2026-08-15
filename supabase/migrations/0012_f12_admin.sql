-- 0012_f12_admin.sql — F12: admin konzola, temelj
--
-- Izvor: docs/F12-admin.md, sekcija 2.
--
-- Ova migracija NE dira nijedan postojeći podatak: sve je `add column`,
-- `create table if not exists` i nova funkcija. Postojeći profili dobijaju
-- `role = 'user'` kroz `default`, pa niko ne postaje admin slučajno — prvi admin
-- se postavlja isključivo kroz `ADMIN_BOOTSTRAP_IDS` (odluka 2: Clerk ID ne ide
-- u migraciju, jer migracija živi u gitu i u svakom klonu).
--
-- Ograničenja se prvo obaraju sa `if exists`, pa dodaju: `pnpm check:sql` pušta
-- svaku migraciju dvaput i traži da drugi prolaz prođe.

-- ═══════════════════════════════════════════════════════════
-- 1. ULOGA I POSLEDNJA AKTIVNOST
-- ═══════════════════════════════════════════════════════════
-- `role` je izvor istine za to ko je admin; env je samo rezerva (F12 §1).
-- `last_seen_at` je kolona koju je F11.2 čekao: dužina pauze se do sada izvodila
-- iz poslednje pretrage, jer ovoga nije bilo (v. „S2 — šta se razišlo", tačka 3).

alter table profiles
  add column if not exists role         text not null default 'user',
  add column if not exists last_seen_at timestamptz;

alter table profiles drop constraint if exists profiles_role_valid;
alter table profiles add  constraint profiles_role_valid
  check (role in ('user', 'admin'));

-- Parcijalan indeks: pitanje koje se stvarno postavlja je „ko su admini", a njih
-- je u beti dvoje. Pun indeks nad kolonom sa dve vrednosti ne bi radio ništa.
create index if not exists profiles_role_idx on profiles (role) where role = 'admin';

-- „Aktivni 7 dana" na listi korisnika i sortiranje po poslednjem dolasku.
create index if not exists profiles_last_seen_idx on profiles (last_seen_at desc nulls last);

-- ═══════════════════════════════════════════════════════════
-- 2. DNEVNIK ADMIN RADNJI
-- ═══════════════════════════════════════════════════════════
-- Piše se i na uspeh i na neuspeh (odluka 5). `payload` nikad ne sadrži lozinku,
-- token ni ključ (pravilo 14).
--
-- [ODSTUPANJE od F12 §2, namerno] PRD piše `actor_id text not null references
-- profiles(id) on delete set null`. To dvoje se isključuje: u trenutku kad se
-- akterov profil obriše, `on delete set null` pokušava upis `null` u `not null`
-- kolonu i brisanje puca. A brisanje admina je tačno onaj slučaj u kom dnevnik
-- njegovih radnji mora da preživi. Zato je kolona nullable: red ostaje, akter
-- postaje `null`, i to se u reviziji čita kao „obrisan nalog".
create table if not exists admin_audit (
  id          bigserial primary key,
  actor_id    text references profiles(id) on delete set null,
  action      text not null,               -- 'credits.adjust', 'user.delete', …
  target_user text,                        -- nad kim; bez FK, da nadživi brisanje
  target_ref  text,                        -- drugi objekat (utisak, stavka dnevnika)
  payload     jsonb   not null default '{}'::jsonb,
  ok          boolean not null default true,
  error       text,
  ip          text,
  created_at  timestamptz not null default now()
);

-- Revizija se čita hronološki unazad, i filtrira po korisniku (F12 §3.5).
create index if not exists admin_audit_time_idx   on admin_audit (created_at desc);
create index if not exists admin_audit_target_idx on admin_audit (target_user, created_at desc);

-- Pravilo 10: RLS na svakoj tabeli. Bez ijedne politike — dnevnik radnji nad
-- tuđim nalozima ne sme da bude čitljiv ni jednim korisničkim tokenom, ni
-- adminovim. Čita se isključivo kroz rutu, `service_role` klijentom.
alter table admin_audit enable  row level security;
alter table admin_audit force   row level security;

-- ═══════════════════════════════════════════════════════════
-- 3. RUČNA KOREKCIJA KREDITA
-- ═══════════════════════════════════════════════════════════
-- ČETVRTA funkcija koja sme da dodirne balans (pravilo 3, dopisano uz F12).
-- Postoji jer `grant_credits` po definiciji odbija negativan iznos, i to ostaje
-- tako: dodela i korekcija nisu ista radnja i ne smeju da dele ulaznu tačku.
--
-- `p_ref_id` generiše server pri OTVARANJU forme, ne pri slanju (F12 §2). Zato
-- dvostruki klik na „Dodaj 30 kredita" ne dodeli 60 — drugi poziv nosi isti
-- `ref_id` i izlazi kao `already_applied`.
--
-- Balans ne može ispod nule. `profiles_credits_nonneg` bi svejedno pukao, ali
-- ovde to izlazi kao uredan ishod, a ne kao izuzetak koji ruta mora da hvata.
create or replace function admin_adjust_credits(
  p_actor  text,
  p_user   text,
  p_delta  integer,
  p_note   text,
  p_ref_id text
)
returns table (ok boolean, reason text, balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
begin
  if p_delta = 0 then
    return query select false, 'invalid_amount'::text, null::integer; return;
  end if;

  if abs(p_delta) > 500 then
    return query select false, 'iznos van granica'::text, null::integer; return;
  end if;

  -- `for update` drži red dok se ne upiše i knjiga i balans: dva admina koja u
  -- istoj sekundi oduzimaju kredite ne smeju oba da pročitaju isti balans.
  select p.credits_balance into v_balance from profiles p where p.id = p_user for update;
  if not found then
    return query select false, 'no_user'::text, null::integer; return;
  end if;

  if v_balance + p_delta < 0 then
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

  update profiles set credits_balance = credits_balance + p_delta where id = p_user
    returning credits_balance into v_balance;

  -- Pravilo 14: mutacija i njen trag su jedna transakcija. Da audit piše ruta,
  -- pad između upisa i loga bi ostavio kredite bez ijednog zapisa o tome ko ih je
  -- dao — a to je jedino pitanje na koje ovaj dnevnik postoji da odgovori.
  insert into admin_audit (actor_id, action, target_user, target_ref, payload)
    values (p_actor, 'credits.adjust', p_user, p_ref_id,
            jsonb_build_object('delta', p_delta, 'note', p_note));

  return query select true, 'ok'::text, v_balance;
end;
$$;

-- Isti razlog kao u 0001 §4: `security definer` je podrazumevano izvršiva za
-- `public`, pa bi bilo ko sa anon ključem mogao da pozove
-- admin_adjust_credits('ja', 'ja', 500, …) preko PostgREST-a.
revoke all on function admin_adjust_credits(text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function admin_adjust_credits(text, text, integer, text, text) to service_role;

-- ═══════════════════════════════════════════════════════════
-- 4. LISTA KORISNIKA — JEDAN UPIT
-- ═══════════════════════════════════════════════════════════
-- [ODSTUPANJE od F12 §2, svesno] Ove funkcije nema u PRD-u. Dodata je zato što
-- §3.1 traži tri stvari koje se kroz PostgREST ne mogu dobiti zajedno:
-- brojeve po korisniku iz JEDNOG agregatnog upita, filter „bez ijedne
-- aktivnosti" nad tim brojevima, i sortiranje po broju otključanih. PostgREST
-- ume ugnježđen `count`, ali po njemu ne ume ni da filtrira ni da sortira — pa
-- bi alternativa bila N+1 petlja po redu, koju §3.1 izričito zabranjuje.
--
-- Funkcija je `stable` i samo čita. Ne dira nijednu tabelu i ne može da promeni
-- ništa, ali svejedno ide kroz `service_role`: čita tuđe mejlove i balanse.
--
-- Brojevi se računaju za SVE korisnike pa se tek onda filtrira i seče na
-- stranicu. Na obimu bete (desetine profila) to je jedan prolaz kroz tri mala
-- indeksa; sortiranje po broju otključanih drugačije i ne može, jer se sortira
-- po vrednosti koja se tek izračunava.
create or replace function admin_users_page(
  p_q      text    default null,   -- mejl, ILIKE
  p_filter text    default null,   -- 'svi' | 'aktivni7' | 'admini' | 'bez_aktivnosti'
  p_plan   text    default null,
  p_sort   text    default 'created_at',
  p_dir    text    default 'desc',
  p_limit  integer default 25,
  p_offset integer default 0
)
returns table (
  id              text,
  email           text,
  plan            text,
  role            text,
  credits_balance integer,
  created_at      timestamptz,
  last_seen_at    timestamptz,
  unlocks_count   bigint,
  searches_count  bigint,
  feedback_count  bigint,
  ukupno          bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with baza as (
    select
      p.id,
      p.email,
      p.plan,
      p.role,
      p.credits_balance,
      p.created_at,
      p.last_seen_at,
      (select count(*) from unlocks  u where u.user_id = p.id) as unlocks_count,
      (select count(*) from searches s where s.user_id = p.id) as searches_count,
      (select count(*) from feedback f where f.user_id = p.id) as feedback_count
    from profiles p
  ),
  filtrirano as (
    select b.*
    from baza b
    where (p_q is null or p_q = '' or b.email ilike '%' || p_q || '%')
      and (p_plan is null or p_plan = '' or b.plan = p_plan)
      and (
        p_filter is null or p_filter = '' or p_filter = 'svi'
        or (p_filter = 'aktivni7' and b.last_seen_at >= now() - interval '7 days')
        or (p_filter = 'admini'   and b.role = 'admin')
        -- „Bez ijedne aktivnosti" su kandidati za `zasto-ne-vracas` mejl (§3.1):
        -- registrovan, a nikad ništa nije ni potražio ni otključao.
        or (p_filter = 'bez_aktivnosti' and b.searches_count = 0 and b.unlocks_count = 0)
      )
  )
  select
    f.id, f.email, f.plan, f.role, f.credits_balance, f.created_at, f.last_seen_at,
    f.unlocks_count, f.searches_count, f.feedback_count,
    -- Ukupan broj pogodaka pre sečenja na stranicu — bez ovoga bi paginacija
    -- tražila drugi upit nad istim filterima.
    count(*) over () as ukupno
  from filtrirano f
  -- Sortiranje bez dinamičkog SQL-a: ključ i smer ulaze kao podatak, a ne kao
  -- deo naredbe, pa injekcija nema kuda da uđe. `nulls last` je bitan za
  -- `last_seen_at` — ko nikad nije došao ne sme da bude na vrhu liste „poslednji
  -- put".
  order by
    case when p_dir = 'asc'  and p_sort = 'credits'   then f.credits_balance end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'credits'   then f.credits_balance end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'unlocks'   then f.unlocks_count   end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'unlocks'   then f.unlocks_count   end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'last_seen' then f.last_seen_at    end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'last_seen' then f.last_seen_at    end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'created_at' then f.created_at     end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'created_at' then f.created_at     end desc nulls last,
    -- Stabilan rep: bez njega dva profila sa istim brojem otključanih ume da
    -- zamene mesta između dve stranice i jedan ispadne iz oba prikaza.
    f.created_at desc, f.id asc
  limit  greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function admin_users_page(text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function admin_users_page(text, text, text, text, text, integer, integer)
  to service_role;
