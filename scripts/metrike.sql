-- scripts/metrike.sql
-- Metrike aktivacije (checklista 2.5), jedan poziv, jedan rezultat.
--
-- Pokretanje: Supabase → SQL editor, ili lokalno
--   docker exec -i supabase_db_sajtoskop psql -U postgres < scripts/metrike.sql
--
-- Brojeve računa `admin_aktivacija(p_dana)` iz migracije 0036. Tamo su i
-- definicije svakog broja. Isti poziv hrani karticu „Aktivacija" na `/admin`
-- (sa 7 dana), pa SQL editor i ekran ne mogu da daju različite brojke.
-- Ovde je samo raspakovano u redove; broj dana za registracije je ispod (30).
--
-- Admin nalozi se ne broje. Vraćen novac se ne oduzima od kupljenih paketa.

with a as (select admin_aktivacija(30) as j)
select 1 as red, 'nalozi (bez admina)' as metrika, (j->>'nalozi')::int as broj, null::text as napomena from a
union all
select 2, 'bar jedna lista', (j->>'sa_listom')::int, 'korak pretraga ili search_access' from a
union all
select 3, 'bar jedno otključavanje', (j->>'sa_otkljucavanjem')::int, null from a
union all
select 4, 'sva četiri onboarding koraka', (j->>'ceo_onboarding')::int,
       'pretraga, otkljucavanje, poruka, pipeline' from a
union all
select 5, 'vratili se drugog dana', (j->>'vratili_se')::int,
       'od ' || (j->>'mogli_da_se_vrate') || ' registrovanih pre danas; last_seen_at na kasniji dan' from a
union all
select 10 + row_number() over (order by p.key), 'aktivne pretplate: ' || p.key,
       (p.value->>'aktivna')::int,
       'proba ' || (p.value->>'proba') || ', kasni ' || (p.value->>'kasni')
from a, jsonb_each(a.j->'pretplate') as p
union all
select 20 + row_number() over (order by (k->>'krediti')::int), 'paket ' || (k->>'krediti') || ' kredita',
       (k->>'kupljeno')::int, (k->>'naloga') || ' naloga'
from a, jsonb_array_elements(a.j->'paketi') as k
union all
select 100 + row_number() over (order by r->>'dan' desc), 'registracije ' || (r->>'dan'),
       (r->>'broj')::int, null
from a, jsonb_array_elements(a.j->'registracije') as r
order by red;
