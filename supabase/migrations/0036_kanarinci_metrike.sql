-- supabase/migrations/0036_kanarinci_metrike.sql
-- Checklista 2.5: kanarinci u bazi i metrike aktivacije.
--
-- ── kanarinci ───────────────────────────────────────────────
-- Kanarinac je izmišljen biznis (telefon i domen su moji) koji u `businesses`
-- i `website_audits` izgleda TAČNO kao pravi (docs/bezbednost.md, Sloj 2). Ako
-- se pojavi u tuđem proizvodu ili CSV-u, `unlocks` kaže koji nalog ga je izvukao.
--
-- Oznaka je namerno u ZASEBNOJ tabeli, a ne kolona `businesses.is_canary`:
--   · `search_listing`, `LEAD_BUSINESS_COLUMNS` i CSV izvoz čitaju pobrojane
--     kolone iz `businesses`. Tabela bez nove kolone ne može da procuri kroz
--     `select *`, dopisanu kolonu ili novi RPC. Kolona bi mogla, i to tiho.
--   · Nijedna ruta ne čita `canaries`. Proverava to `apps/web/test/kanarinci.ts`:
--     test pada ako se ime tabele pojavi u `apps/web/src` ili `packages/shared/src`.
--   · Pišu i čitaju isključivo `scripts/kanarinci.ts` i SQL editor, kroz
--     `service_role`.
--
-- `on delete restrict`: oznaka je dokaz. Brisanje biznisa ne sme tiho da
-- izbriše i spisak kanarinaca; prvo se svesno briše red ovde.
--
-- Bez `country_code` (pravilo 11): red je samo oznaka nad `place_id`, a država
-- je već u `businesses`. Kopija bi mogla da se razdvoji od originala.

create table if not exists canaries (
  place_id   text primary key references businesses(place_id) on delete restrict,
  label      text not null,
  created_at timestamptz not null default now(),
  constraint canaries_label_unique unique (label),
  constraint canaries_label_shape check (label ~ '^[a-z0-9-]{1,40}$')
);

alter table canaries enable row level security;
alter table canaries force  row level security;
revoke all on table canaries from anon, authenticated;
drop policy if exists "no direct read" on canaries;
create policy "no direct read" on canaries for select using (false);

-- ═══════════════════════════════════════════════════════════
-- admin_aktivacija — sedam brojeva iz checkliste 2.5, jedan poziv
-- ═══════════════════════════════════════════════════════════
-- Čita je kartica „Aktivacija" na `/admin` i `scripts/metrike.sql`.
-- Upit postoji samo ovde, pa ekran i SQL editor ne mogu da daju različite brojke.
--
-- Definicije (dan je beogradski, ne LA dan budžeta: ovo je dan korisnika):
--   · nalog              — `profiles` bez `role = 'admin'` (admin ne plaća, 0029)
--   · registracije       — po danu `created_at`, poslednjih `p_dana` dana,
--                          uključujući i dane sa nulom
--   · sa_listom          — korak `pretraga` iz onboardinga ILI bar jedan red u
--                          `search_access`. Red nestaje samo kod punog povraćaja
--                          (0034), pa oboren posao ne računa kao lista
--   · sa_otkljucavanjem  — bar jedan red u `unlocks`
--   · ceo_onboarding     — sva četiri ključa iz `KORACI` (packages/shared/src/onboarding.ts)
--   · vratili_se         — `last_seen_at` pada na kasniji dan od registracije.
--                          `last_seen_at` pamti samo poslednji dolazak, pa je ovo
--                          „vratio se bar jednom posle prvog dana", a ne tačno
--                          „sutradan". `mogli_da_se_vrate` je imenilac: nalozi
--                          registrovani pre današnjeg dana
--   · pretplate          — po planu: `active`, `trialing`, `past_due`
--   · paketi             — redovi knjige `credit_pack` (jedan po `pi_…`), po
--                          veličini paketa. Vraćen novac se NE oduzima; on je
--                          poseban red `povracaj` (0032/0033)

create or replace function admin_aktivacija(p_dana integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with danas as (
    select (now() at time zone 'Europe/Belgrade')::date as d
  ),
  nalozi as (
    select p.id,
           (p.created_at   at time zone 'Europe/Belgrade')::date as dan,
           (p.last_seen_at at time zone 'Europe/Belgrade')::date as poslednji_dan,
           p.onboarding_steps
    from profiles p
    where p.role <> 'admin'
  ),
  po_danu as (
    select g.dan::date as dan,
           (select count(*) from nalozi n where n.dan = g.dan::date)::int as broj
    from danas,
         generate_series(danas.d - (greatest(p_dana, 1) - 1), danas.d, interval '1 day') as g(dan)
  ),
  planovi as (
    select v.plan from (values ('starter'), ('pro'), ('advanced')) as v(plan)
  ),
  pretplate as (
    select pl.plan,
           count(distinct s.user_id) filter (where s.status = 'active')::int   as aktivna,
           count(distinct s.user_id) filter (where s.status = 'trialing')::int as proba,
           count(distinct s.user_id) filter (where s.status = 'past_due')::int as kasni
    from planovi pl
    left join subscriptions s
           on s.plan = pl.plan
          and s.status in ('active', 'trialing', 'past_due')
          and exists (select 1 from nalozi n where n.id = s.user_id)
    group by pl.plan
  ),
  paketi as (
    select cl.delta as krediti,
           count(*)::int                  as kupljeno,
           count(distinct cl.user_id)::int as naloga
    from credit_ledger cl
    join nalozi n on n.id = cl.user_id
    where cl.reason = 'credit_pack'
    group by cl.delta
  )
  select jsonb_build_object(
    'dana', greatest(p_dana, 1),
    'registracije', (
      select jsonb_agg(jsonb_build_object('dan', d.dan, 'broj', d.broj) order by d.dan desc)
      from po_danu d
    ),
    'nalozi', (select count(*)::int from nalozi),
    'sa_listom', (
      select count(*)::int from nalozi n
      where n.onboarding_steps ? 'pretraga'
         or exists (select 1 from search_access sa where sa.user_id = n.id)
    ),
    'sa_otkljucavanjem', (
      select count(*)::int from nalozi n
      where exists (select 1 from unlocks u where u.user_id = n.id)
    ),
    'ceo_onboarding', (
      select count(*)::int from nalozi n
      where n.onboarding_steps ?& array['pretraga', 'otkljucavanje', 'poruka', 'pipeline']
    ),
    'vratili_se', (
      select count(*)::int from nalozi n where n.poslednji_dan > n.dan
    ),
    'mogli_da_se_vrate', (
      select count(*)::int from nalozi n, danas where n.dan < danas.d
    ),
    'pretplate', (
      select jsonb_object_agg(
               p.plan,
               jsonb_build_object('aktivna', p.aktivna, 'proba', p.proba, 'kasni', p.kasni))
      from pretplate p
    ),
    'paketi', coalesce((
      select jsonb_agg(
               jsonb_build_object('krediti', k.krediti, 'kupljeno', k.kupljeno, 'naloga', k.naloga)
               order by k.krediti)
      from paketi k
    ), '[]'::jsonb)
  );
$$;

revoke all on function admin_aktivacija(integer) from public, anon, authenticated;
grant execute on function admin_aktivacija(integer) to service_role;
