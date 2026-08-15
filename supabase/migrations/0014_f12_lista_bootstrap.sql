-- 0014_f12_lista_bootstrap.sql — F12: filter „Admini" vidi i admine iz env-a
--
-- Problem koji rešava, tačno onako kako se pojavio u upotrebi:
-- prvi admin postoji ISKLJUČIVO u `ADMIN_BOOTSTRAP_IDS` (odluka 1 i 2 iz F12 —
-- njegov Clerk ID ne ide u migraciju). `profiles.role` mu je i dalje `'user'`,
-- jer ga niko nije postavio i ne može sam sebi (§1, „ne sebi"). Filter „Admini"
-- je zato vraćao praznu listu na instalaciji koja ima tačno jednog admina.
--
-- Rešenje je jedan parametar, a ne izmena podataka. Env se NE upisuje u bazu:
-- to bi značilo da uklanjanje ID-ja iz env-a više ne skida prava, i da rezerva
-- koja postoji za slučaj pokvarene baze počne da menja tu istu bazu.
--
-- `admin_users_page` se DROP-uje pa pravi ponovo: `create or replace` sa novim
-- parametrom bi napravio drugu funkciju istog imena, a PostgREST bi između dve
-- preopterećene verzije birao nasumično.

drop function if exists admin_users_page(text, text, text, text, text, integer, integer);

create or replace function admin_users_page(
  p_q         text    default null,   -- mejl, ILIKE
  p_filter    text    default null,   -- 'svi' | 'aktivni7' | 'admini' | 'bez_aktivnosti'
  p_plan      text    default null,
  p_sort      text    default 'created_at',
  p_dir       text    default 'desc',
  p_limit     integer default 25,
  p_offset    integer default 0,
  -- Clerk ID-jevi iz `ADMIN_BOOTSTRAP_IDS`. Prazno je uredno stanje: tada su
  -- admini samo oni iz `profiles.role`.
  p_bootstrap text[]  default '{}'::text[]
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

revoke all on function admin_users_page(text, text, text, text, text, integer, integer, text[])
  from public, anon, authenticated;
grant execute on function admin_users_page(text, text, text, text, text, integer, integer, text[])
  to service_role;
