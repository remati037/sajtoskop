-- 0024_beta_nalozi.sql — S20: beta nalog je ručna radnja, i to jedina
--
-- Izvor: docs/LANSIRANJE.md §1.1 (odluka D1) i §1.4/§1.5 (rok i stanja).
--
-- ── šta je ovde stvarno u pitanju ────────────────────────────
-- §1.1 kaže: „Beta plan nikad ne nastaje sam — ni registracijom, ni kuponom, ni
-- webhookom. Samo iz admin konzole." Do ove migracije je to bila rečenica u
-- dokumentu, a kod je radio suprotno: `profiles.plan` je imao `default 'beta'`
-- (0001), a `beta_expires_at` je `NULL`, što po §1.5 znači NEOGRANIČENO. Svaka
-- registracija je time otvarala doživotan besplatan nalog. S19 je tu rupu
-- imenovao i ostavio je S20 (v. docs/SESIJE.md, „Preneto dalje").
--
-- Zatvara se na tri sloja, jer jedan nije dovoljan:
--   1. `default` na koloni više nije `beta` — registracija ga ne dobija ni
--      slučajno;
--   2. TRIGER odbija svaki prelazak plana u `beta` koji ne dolazi iz konzolne
--      funkcije. Ovo je jedini sloj koji drži i kad neko zaobiđe aplikaciju
--      (ručni `update` u SQL editoru, tuđa skripta sa `service_role` ključem);
--   3. `admin_open_beta` je jedini put kroz triger, i on u ISTOJ transakciji
--      postavlja plan, rok i kredite. Pola otvorenog beta naloga — plan bez
--      kredita, ili krediti bez roka — gore je nego nijedan.
--
-- ── šta ova migracija NE radi ────────────────────────────────
-- Ne dira POSTOJEĆE beta naloge. Njima `plan = 'beta'` i `beta_expires_at IS
-- NULL` ostaje, dakle i dalje imaju neograničen pristup. To je namerno: to su
-- moji testni nalozi i ljudi koji su već unutra, a migracija koja ćutke zaključa
-- žive korisnike je gora od rupe koju zatvara. Rok im se postavlja iz konzole,
-- jednim klikom — zbog toga S20 i postoji, i zato lista korisnika od sada ima
-- kolonu sa stanjem pristupa.

-- ═══════════════════════════════════════════════════════════
-- 1. NOV RAZLOG U KNJIZI: beta_grant
-- ═══════════════════════════════════════════════════════════
-- Krediti koje beta nalog dobija pri otvaranju. Zaseban razlog, a ne `admin`,
-- iz istog razloga iz kog su `user.ban` i `user.unban` dve radnje: izvod mora da
-- kaže ODAKLE su krediti. `admin` je ručna korekcija sa beleškom, `beta_grant`
-- je paket koji ide uz otvaranje naloga — i sutra će se pitati koliko je
-- kredita otišlo na betu, a ne koliko ih je ukupno dodeljeno rukom.
--
-- ‼️ Zamka koju 0011 imenuje i koju 0022 ponavlja (pravilo 3): prošireno `check`
--    ograničenje NIJE dovoljno. `grant_credits` interno validira razlog, pa bi
--    bez izmene TELA svaki poziv tiho vratio `invalid_reason` i nijedan kredit
--    ne bi bio dodeljen. Zato ispod ide i ograničenje, i indeks, i telo.

alter table credit_ledger drop constraint if exists credit_ledger_reason_valid;
alter table credit_ledger add  constraint credit_ledger_reason_valid check (
  reason in (
    'unlock', 'scan', 'monthly_grant', 'admin', 'refund', 'feedback',
    'subscription_grant', 'credit_pack', 'onboarding', 'beta_grant'
  )
);

-- `beta_grant` je DODELA sa `ref_id`-jem jedinstvenim po radnji (`adm:<uuid>` iz
-- forme), pa ulazi u isti parcijalni unique indeks — poslednja brana ispod
-- `grant_credits`, koja drži i kad neko pozove RPC mimo aplikacije.
drop index if exists credit_ledger_grant_idem_idx;
create unique index credit_ledger_grant_idem_idx
  on credit_ledger (user_id, reason, ref_id)
  where ref_id is not null and reason in (
    'monthly_grant', 'admin', 'feedback',
    'subscription_grant', 'credit_pack', 'onboarding', 'beta_grant'
  );

-- Telo je nepromenjeno u odnosu na 0022 osim jednog stringa u listi razloga.
-- Mapa razloga → kasa ostaje ista: `credit_pack` je i dalje JEDINI razlog koji
-- puni `credits_topup`. Beta krediti ISTIČU — beta je pretplata koju ne
-- naplaćujem, ne kupljen paket.
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
    'subscription_grant', 'credit_pack', 'onboarding', 'beta_grant'
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

  if p_reason = 'credit_pack' then
    update profiles set credits_topup = credits_topup + p_amount where id = p_user;
  else
    update profiles set credits_balance = credits_balance + p_amount where id = p_user;
  end if;

  return query select true, 'granted';
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. PLAN VIŠE NE NASTAJE SAM KAO `beta`
-- ═══════════════════════════════════════════════════════════
-- Nov nalog dobija `dopuna`, a ne šesti plan „nema plana". Razlog: `dopuna` je
-- već u `PLANS` (LANSIRANJE §1.3) i po definiciji znači „korisnik bez
-- pretplate". Sa nula kredita u obe kase `stanjePristupa()` ga čita kao
-- `zakljucan` i vodi na cenovnik; čim kupi paket, `credits_topup > 0` ga vraća u
-- `dopuna` — bez ijedne izmene plana. Šesta vrednost bi bila šesta grana u
-- svakoj mapi koja plan prevodi u limite, i to zbog stanja koje traje do prve
-- kupovine.

update profiles set plan = 'dopuna'
 where plan not in ('beta', 'dopuna', 'starter', 'pro', 'advanced');

alter table profiles alter column plan set default 'dopuna';

alter table profiles drop constraint if exists profiles_plan_valid;
alter table profiles add  constraint profiles_plan_valid check (
  plan in ('beta', 'dopuna', 'starter', 'pro', 'advanced')
);

-- ── triger: `beta` samo kroz konzolnu funkciju ───────────────
-- Zastavica je transakcijska (`set_config(..., is_local => true)`), pa je vidi
-- isključivo ona transakcija u kojoj je `admin_open_beta` postavio. Ne postoji
-- način da „ostane upaljena" za sledeći zahtev, i ne postoji način da je
-- aplikacija postavi mimo te funkcije — `set_config` nad `sajtoskop.*` bi morao
-- da se napiše doslovno, a jedino mesto gde je napisan je ovde ispod.
--
-- Prelazak `beta` → `beta` (produženje roka nad nalogom koji već jeste u beti)
-- prolazi bez zastavice: plan se time ne DODELJUJE, a `beta_expires_at` triger
-- ne dira uopšte. Gašenje bete rokom u prošlosti zato ne traži ovaj put.
create or replace function profiles_beta_samo_iz_konzole()
returns trigger
language plpgsql
as $$
begin
  if new.plan is distinct from 'beta' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.plan = 'beta' then
    return new;
  end if;

  if coalesce(current_setting('sajtoskop.beta', true), '') = 'konzola' then
    return new;
  end if;

  raise exception
    'plan `beta` se dodeljuje isključivo kroz admin_open_beta (LANSIRANJE §1.1, odluka D1)'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists profiles_beta_guard on profiles;
create trigger profiles_beta_guard
  before insert or update of plan on profiles
  for each row execute function profiles_beta_samo_iz_konzole();

-- ── registracija: profil bez plana i bez kredita ─────────────
-- Telo je isto kao u 0001 osim jedne stvari: „da li je profil upravo nastao" se
-- više ne izvodi iz toga da li u knjizi postoji `monthly_grant`. Od S20
-- registracija dodeljuje NULA kredita (§1.1: nema besplatnog plana za javnost),
-- pa bi taj izvod za svaki nalog zauvek vraćao `created` — a webhook iz toga
-- zaključuje da li je isporuka ponovljena.
--
-- `xmax = 0` na `returning` iz `on conflict` je standardan način da se razlikuje
-- ubačen red od ažuriranog: kod ubačenog reda nema transakcije koja ga je
-- „obrisala radi izmene", pa je `xmax` nula.
--
-- Dodela i dalje ide kroz `grant_credits` (pravilo 3) i i dalje je idempotentna
-- po `p_ref_id`-ju, pa `p_credits > 0` ostaje podržan — koristi ga `pnpm
-- check:sql` i ostaje kao put ako se ikad vrati kredit dobrodošlice (to je
-- razlog `onboarding` iz 0022, koji čeka S24).
create or replace function create_profile_with_grant(
  p_user    text,
  p_email   text,
  p_credits integer,
  p_ref_id  text
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created boolean := false;
begin
  insert into profiles (id, email) values (p_user, p_email)
  on conflict (id) do update set email = coalesce(excluded.email, profiles.email)
  returning (xmax = 0) into v_created;

  if p_credits > 0 then
    perform grant_credits(p_user, p_credits, 'monthly_grant', p_ref_id);
  end if;

  return query select true, case when v_created then 'created' else 'existing' end;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. admin_open_beta — plan, rok i krediti u JEDNOM potezu
-- ═══════════════════════════════════════════════════════════
-- Do S20 je otvaranje beta naloga bilo dva odvojena poziva iz konzole (plan, pa
-- krediti) i nijedan za rok. Dva poziva znače dva ishoda: prvi prođe, drugi
-- padne, i nalog ostane sa planom bez kredita — ili sa neograničenim rokom, jer
-- ga niko nije postavio.
--
-- `p_expires` je `NULL` = NEOGRANIČENA beta (§1.5). To NIJE „nije prosleđeno":
-- funkcija rok uvek POSTAVLJA, pa dvosmislenosti nema — ko hoće da ne dira rok,
-- ne zove ovu funkciju nego menja samo kolonu.
--
-- Rok u PROŠLOSTI je dozvoljen i namerno nije provera: tako se beta gasi rukom
-- (§1.5). Potvrdu za taj slučaj traži UI, jer je to jedino mesto gde se zna da
-- li je datum omaška ili odluka.
--
-- `p_ref_id` je ključ idempotencije dodele (`adm:<uuid>` iz forme, isto kao kod
-- ručne korekcije): dvostruki klik na „Otvori beta nalog" ne daje dva paketa
-- kredita. Plan i rok se pri ponovljenom pozivu svejedno upisuju — oni su
-- postavljanje na vrednost, ne sabiranje, pa je ponavljanje bezopasno.
create or replace function admin_open_beta(
  p_user    text,
  p_credits integer,
  p_expires timestamptz,
  p_ref_id  text
)
returns table (ok boolean, reason text, granted integer, balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok      boolean;
  v_reason  text;
  v_balance integer;
begin
  if p_ref_id is null or p_ref_id = '' then
    return query select false, 'missing_ref_id'::text, 0, null::integer; return;
  end if;

  if p_credits is null or p_credits < 0 or p_credits > 500 then
    return query select false, 'invalid_amount'::text, 0, null::integer; return;
  end if;

  -- Isti `for update` pod kojim radi i `grant_credits` ispod. Zaključavanje je
  -- reentrantno u istoj transakciji, pa dvostruko uzimanje brave nije problem —
  -- a bez njega bi dva admina u istoj sekundi mogla da upišu dva različita roka
  -- između čitanja i upisa.
  perform 1 from profiles where id = p_user for update;
  if not found then
    return query select false, 'no_user'::text, 0, null::integer; return;
  end if;

  -- Jedina zastavica u celom projektu, i jedino mesto na kome se postavlja.
  -- `true` je `is_local` — važi do kraja OVE transakcije i nigde dalje.
  perform set_config('sajtoskop.beta', 'konzola', true);

  update profiles
     set plan            = 'beta',
         beta_expires_at = p_expires
   where id = p_user;

  if p_credits > 0 then
    select g.ok, g.reason into v_ok, v_reason
      from grant_credits(p_user, p_credits, 'beta_grant', p_ref_id) g;

    if not coalesce(v_ok, false) then
      -- Dodela je pala posle upisa plana. Cela transakcija ide nazad — pola
      -- otvorenog beta naloga je gore nego nijedan.
      raise exception 'grant_credits(beta_grant) je odbio dodelu: %', coalesce(v_reason, 'bez razloga');
    end if;
  else
    v_reason := 'no_credits';
  end if;

  select p.credits_balance into v_balance from profiles p where p.id = p_user;

  -- `already_granted` je dvostruki klik: plan i rok su (ponovo) upisani, kredita
  -- nema drugi put. Pozivalac to prevodi u rečenicu, ne u grešku.
  return query select
    true,
    case when v_reason = 'already_granted' then 'already_granted' else 'opened' end,
    case when v_reason = 'granted' then p_credits else 0 end,
    v_balance;
end;
$$;

revoke all on function admin_open_beta(text, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function admin_open_beta(text, integer, timestamptz, text)
  to service_role;

-- ═══════════════════════════════════════════════════════════
-- 4. LISTA KORISNIKA ZNA ZA PRISTUP
-- ═══════════════════════════════════════════════════════════
-- Kolona „stanje" na `/admin/korisnici` mora da pokaže isto ono što kapija
-- zaključuje — dakle `stanjePristupa()` iz `packages/shared`, ni slovo druge
-- računice (§1.5). Zato ova funkcija NE računa stanje: ona vraća ULAZE, a stanje
-- izvodi ista TS funkcija koju zovu i layout i rute.
--
-- Šest novih kolona: obe kase, oba roka i najsvežija pretplata. Pretplata ide
-- kroz `lateral` sa `limit 1` po istom indeksu koji 0022 pravi — više redova
-- postoji kad je korisnik menjao plan, a merodavan je onaj koji traje najduže.
--
-- ── zašto `p_ids`, a ne filter po stanju u SQL-u ─────────────
-- Filter po stanju bi u SQL-u značio drugu implementaciju šest stanja: `max` od
-- dva roka, grace prozor, `dopuna` koja pretiče grace, `NULL` koji je
-- neograničen samo uz plan `beta`. Ta kopija bi se razišla sa TS-om prvog dana
-- kad se pravilo promeni — i razišla bi se tiho, jer bi obe strane radile.
--
-- Zato konzola stanje računa u TS-u, suzi spisak na ID-jeve koji odgovaraju, i
-- pošalje ih ovamo. Paginacija time ostaje u bazi i ostaje TAČNA: klijent koji
-- filtrira 25 dobijenih redova ne zna koliko ih ima iza.
--
-- `null` znači „bez ograničenja" i to je uobičajen slučaj; prazan niz znači
-- „nijedan pogodak" i mora da vrati nula redova, ne sve.

drop function if exists admin_users_page(text, text, text, text, text, integer, integer);
drop function if exists admin_users_page(text, text, text, text, text, integer, integer, text[]);
-- [S25] 0025 menja POVRATNI TIP ove funkcije (dodaje `komp_expires_at` i
-- `sub_trial_end`), pa drugi prolaz `pnpm check:sql` ovde puca na „cannot
-- change return type" ako se ne drop-uje i sopstveni potpis. Bezopasno u
-- produkciji: 0025 je odmah iza i pravi je iznova.
drop function if exists admin_users_page(text, text, text, text, text, integer, integer, text[], text[]);

create or replace function admin_users_page(
  p_q         text    default null,   -- mejl, ILIKE
  p_filter    text    default null,   -- 'svi' | 'aktivni7' | 'admini' | 'bez_aktivnosti'
  p_plan      text    default null,
  p_sort      text    default 'created_at',
  p_dir       text    default 'desc',
  p_limit     integer default 25,
  p_offset    integer default 0,
  p_bootstrap text[]  default '{}'::text[],
  -- Spisak ID-jeva na koji se lista sužava. `null` = bez sužavanja.
  p_ids       text[]  default null
)
returns table (
  id              text,
  email           text,
  plan            text,
  role            text,
  credits_balance integer,
  credits_topup   integer,
  beta_expires_at timestamptz,
  plan_expires_at timestamptz,
  sub_status      text,
  sub_period_end  timestamptz,
  sub_canceled_at timestamptz,
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
      p.credits_topup,
      p.beta_expires_at,
      p.plan_expires_at,
      sub.status             as sub_status,
      sub.current_period_end as sub_period_end,
      sub.canceled_at        as sub_canceled_at,
      p.created_at,
      p.last_seen_at,
      (select count(*) from unlocks  u where u.user_id = p.id) as unlocks_count,
      (select count(*) from searches s where s.user_id = p.id) as searches_count,
      (select count(*) from feedback f where f.user_id = p.id) as feedback_count
    from profiles p
    left join lateral (
      select s.status, s.current_period_end, s.canceled_at
      from subscriptions s
      where s.user_id = p.id
      order by s.current_period_end desc nulls last
      limit 1
    ) sub on true
  ),
  filtrirano as (
    select b.*
    from baza b
    where (p_q is null or p_q = '' or b.email ilike '%' || p_q || '%')
      and (p_plan is null or p_plan = '' or b.plan = p_plan)
      -- Prazan niz je legitiman ishod filtera po stanju: „nijedan nalog nije u
      -- tom stanju". Zato se poredi sa `null`, ne sa dužinom.
      and (p_ids is null or b.id = any(p_ids))
      and (
        p_filter is null or p_filter = '' or p_filter = 'svi'
        or (p_filter = 'aktivni7' and b.last_seen_at >= now() - interval '7 days')
        -- Uloga iz baze ILI rezerva iz env-a. Bez druge polovine ovog uslova
        -- filter ne vidi prvog admina, dakle najčešće ni jednog jedinog.
        or (p_filter = 'admini' and (
              b.role = 'admin'
              or b.id = any(coalesce(p_bootstrap, '{}'::text[]))
           ))
        -- „Bez ijedne aktivnosti" su kandidati za `zasto-ne-vracas` mejl (§3.1):
        -- registrovan, a nikad ništa nije ni potražio ni otključao.
        or (p_filter = 'bez_aktivnosti' and b.searches_count = 0 and b.unlocks_count = 0)
      )
  )
  select
    f.id, f.email, f.plan, f.role, f.credits_balance, f.credits_topup,
    f.beta_expires_at, f.plan_expires_at,
    f.sub_status, f.sub_period_end, f.sub_canceled_at,
    f.created_at, f.last_seen_at,
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

revoke all on function admin_users_page(text, text, text, text, text, integer, integer, text[], text[])
  from public, anon, authenticated;
grant execute on function admin_users_page(text, text, text, text, text, integer, integer, text[], text[])
  to service_role;
