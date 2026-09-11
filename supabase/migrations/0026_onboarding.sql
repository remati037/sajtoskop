-- supabase/migrations/0026_onboarding.sql
-- S28 — onboarding: krediti dobrodošlice u kasu koja OTVARA pristup, i stanje
-- vođenog prvog prolaza na profilu.
--
-- ‼️ OBIM. `docs/tok-i-onboarding.md` §4.3 nije postojao u repozitorijumu kad je
--    ova migracija pisana (v. `docs/SESIJE.md`, S28). Ovde je zato samo ono što
--    je nedvosmisleno iz S28 zahteva:
--      · kredite dobrodošlice (§4, O1) — 2 kredita u `credits_topup`
--      · stanje vođenog prolaza (`onboarding_steps`, `onboarding_done_at`,
--        `onboarding_skipped_at`, `onboarding_hints_seen`)
--      · `onboarding_mark_step`
--      · `admin_users_page` + dve kolone
--    Kolone za ODGOVORE čarobnjaka (grad, niša, kanal — LANSIRANJE §1.8, deo 1)
--    NISU ovde: njihova imena i oblik stoje u §4.3, a čarobnjak se ionako ne
--    isporučuje u istoj sesiji. Dopisuju se kad dokument stigne.
--
-- ── zašto krediti dobrodošlice idu u `credits_topup` ────────
-- `stanjePristupa()` pušta unutra nalog sa pretplatom, kompom ili
-- `credits_topup > 0` (LANSIRANJE §1.5). Kredit dodeljen u `credits_balance`
-- NE otvara pristup — nalog ostaje `zakljucan` i sa njim, pa bi onboarding
-- počinjao na katancu. Razlog `onboarding` zato od ove migracije puni kasu koja
-- ne ističe, isto kao `credit_pack` (obrazloženje u LANSIRANJE §1.8, O1).
--
-- Dva kredita, ne jedan: prvi otvara prospekt, drugi postoji da čovek posle
-- prve poruke ima još jedan potez bez kartice (S28 zahtev, §4 — nadjačava
-- „jedan kredit" iz LANSIRANJE §1.8).
--
-- Idempotentna: svaki `alter` je `if not exists`, svaka funkcija `create or
-- replace`, `admin_users_page` ide `drop` + `create` (obrazac iz 0025 §7 —
-- `create or replace` ne sme da menja listu izlaznih kolona).

-- ═══════════════════════════════════════════════════════════
-- 1. STANJE ONBOARDINGA NA PROFILU
-- ═══════════════════════════════════════════════════════════
-- U bazi, ne u `localStorage`-u (LANSIRANJE §1.8, deo 4): čovek koji nastavi sa
-- drugog uređaja nastavlja tamo gde je stao.
--
-- `onboarding_steps` je objekat `{"<korak>": "<timestamp>"}`, ne četiri kolone:
-- korak se UPISUJE jednom i posle se samo čita, a lista koraka je stvar
-- proizvoda (§4.5), ne šeme. Četiri kolone bi značile migraciju po koraku.
alter table profiles add column if not exists onboarding_steps jsonb not null default '{}'::jsonb;
alter table profiles add column if not exists onboarding_done_at timestamptz;
alter table profiles add column if not exists onboarding_skipped_at timestamptz;

-- Viđene vođene tačke (§4.5). `text[]`, a ne jsonb: ovo je skup ključeva nad
-- kojim se radi samo „ima li" i „dodaj", a za to je niz i kraći i proverljiv.
alter table profiles add column if not exists onboarding_hints_seen text[] not null default '{}'::text[];

alter table profiles drop constraint if exists profiles_onboarding_steps_object;
alter table profiles add  constraint profiles_onboarding_steps_object
  check (jsonb_typeof(onboarding_steps) = 'object');

-- ═══════════════════════════════════════════════════════════
-- 2. grant_credits — `onboarding` puni kasu koja NE ISTIČE
-- ═══════════════════════════════════════════════════════════
-- Telo je nepromenjeno iz 0025 §3 osim grane koja bira kasu. Razlozi i
-- validacija ostaju isti (pravilo 3: nova vrata za kredite se ne prave).
create or replace function grant_credits(
  p_user text, p_amount integer, p_reason text, p_ref_id text default null
)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_amount <= 0 then return query select false, 'invalid_amount'; return; end if;
  if p_reason not in (
    'monthly_grant', 'admin', 'refund', 'feedback', 'subscription_grant',
    'credit_pack', 'onboarding', 'trial_grant', 'komp_grant'
  ) then return query select false, 'invalid_reason'; return; end if;

  perform 1 from profiles where id = p_user for update;
  if not found then return query select false, 'no_user'; return; end if;

  if p_ref_id is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = p_reason and cl.ref_id = p_ref_id
  ) then return query select true, 'already_granted'; return; end if;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, p_amount, p_reason, p_ref_id);

  -- [0026] `onboarding` uz `credit_pack`: kasa koja ne ističe je jedina koja
  -- otvara pristup nalogu bez plana (§1.5, O1).
  if p_reason in ('credit_pack', 'onboarding') then
    update profiles set credits_topup = credits_topup + p_amount where id = p_user;
  else
    update profiles set credits_balance = credits_balance + p_amount where id = p_user;
  end if;
  return query select true, 'granted';
end $$;

-- ═══════════════════════════════════════════════════════════
-- 3. create_profile_with_grant — razlog `onboarding`
-- ═══════════════════════════════════════════════════════════
-- Do 0026 je dodela na registraciji išla kao `monthly_grant`, jer je iznos bio
-- nula i razlog nikad nije stizao do knjige. Od S28 nov nalog dobija kredite
-- dobrodošlice, pa razlog mora da bude onaj koji i znači to
-- (`ONBOARDING_CREDITS` u `packages/shared/src/plans.ts`).
--
-- Idempotencija je nepromenjena: `credit_ledger_grant_idem_idx` (0025) pokriva
-- i `onboarding`, pa webhook `user.created` i rezervni put iz layout-a ne mogu
-- da dodele dvaput, ni sa istim `p_ref_id` (`signup:<user>`).
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
    perform grant_credits(p_user, p_credits, 'onboarding', p_ref_id);
  end if;

  return query select true, case when v_created then 'created' else 'existing' end;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. onboarding_mark_step — jedan korak, jednom
-- ═══════════════════════════════════════════════════════════
-- Koraci su četiri i zovu se kao radnje koje ih rade (§4.5, S28 zahtev §7):
--   pretraga · otkljucavanje · poruka · pipeline
--
-- Nepoznat korak BACA, ne vraća `false`: korak upisuju rute koje tu radnju i
-- rade, dakle sa zakucanim ključem u kodu. Tipfeler tamo je greška u kodu, a
-- tiho `false` bi značio traku koja se nikad ne završi i nijedan trag zašto.
--
-- Idempotentno: prvi upis pamti trenutak, svaki sledeći ga ne dira (`already`).
-- Kad sva četiri koraka postoje, `onboarding_done_at` se postavlja jednom.
-- `onboarding_skipped_at` se ovde NE dira — čovek koji je traku odbacio pa ipak
-- prošao sve korake je i odbacio i završio, i to su dva različita podatka.
create or replace function onboarding_mark_step(p_user text, p_step text)
returns table (ok boolean, reason text, steps jsonb, done_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_steps jsonb;
  v_done  timestamptz;
begin
  if p_step is null or p_step not in ('pretraga', 'otkljucavanje', 'poruka', 'pipeline') then
    raise exception 'nepoznat korak onboardinga: %', coalesce(p_step, '<null>')
      using errcode = 'check_violation';
  end if;

  select p.onboarding_steps, p.onboarding_done_at into v_steps, v_done
  from profiles p where p.id = p_user for update;

  if not found then
    return query select false, 'no_user'::text, null::jsonb, null::timestamptz; return;
  end if;

  if v_steps ? p_step then
    return query select true, 'already'::text, v_steps, v_done; return;
  end if;

  v_steps := v_steps || jsonb_build_object(p_step, to_jsonb(now()));

  if v_done is null
     and v_steps ? 'pretraga' and v_steps ? 'otkljucavanje'
     and v_steps ? 'poruka'   and v_steps ? 'pipeline' then
    v_done := now();
  end if;

  update profiles
     set onboarding_steps   = v_steps,
         onboarding_done_at = v_done
   where id = p_user;

  return query select true, 'marked'::text, v_steps, v_done;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. admin_users_page — + dve kolone onboardinga
-- ═══════════════════════════════════════════════════════════
-- `drop` + `create`, obrazac iz 0025 §7: `create or replace` ne sme da menja
-- listu izlaznih kolona. Telo je nepromenjeno osim dva reda u `baza` i dva u
-- završnom `select`-u.
--
-- Zašto u konzoli: „koliko ljudi koji otvore nalog dođe do prve poruke" je mera
-- uspeha onboardinga (LANSIRANJE §1.8), a ona se čita po nalogu ili nikako.
drop function if exists admin_users_page(text, text, text, text, text, integer, integer, text[], text[]);
create or replace function admin_users_page(
  p_q text default null, p_filter text default null, p_plan text default null,
  p_sort text default 'created_at', p_dir text default 'desc',
  p_limit integer default 25, p_offset integer default 0,
  p_bootstrap text[] default '{}'::text[], p_ids text[] default null
)
returns table (
  id text, email text, plan text, role text, credits_balance integer, credits_topup integer,
  komp_expires_at timestamptz, plan_expires_at timestamptz,
  sub_status text, sub_period_end timestamptz, sub_canceled_at timestamptz, sub_trial_end timestamptz,
  created_at timestamptz, last_seen_at timestamptz,
  onboarding_done_at timestamptz, onboarding_skipped_at timestamptz,
  unlocks_count bigint, searches_count bigint, feedback_count bigint, ukupno bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  with baza as (
    select p.id, p.email, p.plan, p.role, p.credits_balance, p.credits_topup,
           p.komp_expires_at, p.plan_expires_at,
           sub.status as sub_status, sub.current_period_end as sub_period_end,
           sub.canceled_at as sub_canceled_at, sub.trial_end as sub_trial_end,
           p.created_at, p.last_seen_at,
           p.onboarding_done_at, p.onboarding_skipped_at,
           (select count(*) from unlocks u where u.user_id = p.id) as unlocks_count,
           (select count(*) from searches s where s.user_id = p.id) as searches_count,
           (select count(*) from feedback f where f.user_id = p.id) as feedback_count
    from profiles p
    left join lateral (
      select s.status, s.current_period_end, s.canceled_at, s.trial_end
      from subscriptions s where s.user_id = p.id
      order by s.current_period_end desc nulls last limit 1
    ) sub on true
  ),
  filtrirano as (
    select b.* from baza b
    where (p_q is null or p_q = '' or b.email ilike '%' || p_q || '%')
      and (p_plan is null or p_plan = '' or b.plan = p_plan)
      and (p_ids is null or b.id = any(p_ids))
      and (p_filter is null or p_filter = '' or p_filter = 'svi'
        or (p_filter = 'aktivni7' and b.last_seen_at >= now() - interval '7 days')
        or (p_filter = 'admini' and (b.role = 'admin' or b.id = any(coalesce(p_bootstrap, '{}'::text[]))))
        or (p_filter = 'bez_aktivnosti' and b.searches_count = 0 and b.unlocks_count = 0)
        or (p_filter = 'proba' and b.sub_status = 'trialing'))
  )
  select f.id, f.email, f.plan, f.role, f.credits_balance, f.credits_topup,
         f.komp_expires_at, f.plan_expires_at, f.sub_status, f.sub_period_end,
         f.sub_canceled_at, f.sub_trial_end, f.created_at, f.last_seen_at,
         f.onboarding_done_at, f.onboarding_skipped_at,
         f.unlocks_count, f.searches_count, f.feedback_count, count(*) over () as ukupno
  from filtrirano f
  order by
    case when p_dir = 'asc'  and p_sort = 'credits'    then f.credits_balance end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'credits'    then f.credits_balance end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'unlocks'    then f.unlocks_count   end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'unlocks'    then f.unlocks_count   end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'last_seen'  then f.last_seen_at    end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'last_seen'  then f.last_seen_at    end desc nulls last,
    case when p_dir = 'asc'  and p_sort = 'created_at' then f.created_at      end asc  nulls last,
    case when p_dir <> 'asc' and p_sort = 'created_at' then f.created_at      end desc nulls last,
    f.created_at desc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. PRAVA
-- ═══════════════════════════════════════════════════════════
revoke all on function grant_credits(text, integer, text, text) from public, anon, authenticated;
revoke all on function create_profile_with_grant(text, text, integer, text) from public, anon, authenticated;
revoke all on function onboarding_mark_step(text, text) from public, anon, authenticated;
revoke all on function admin_users_page(text,text,text,text,text,integer,integer,text[],text[]) from public, anon, authenticated;

grant execute on function grant_credits(text, integer, text, text) to service_role;
grant execute on function create_profile_with_grant(text, text, integer, text) to service_role;
grant execute on function onboarding_mark_step(text, text) to service_role;
grant execute on function admin_users_page(text,text,text,text,text,integer,integer,text[],text[]) to service_role;
