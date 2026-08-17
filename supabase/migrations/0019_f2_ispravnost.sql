-- 0019_f2_ispravnost.sql — Faza 2 iz docs/PLAN-IZMENA.md: ispravnost
--
-- Dve stvari, bez diranja postojećih podataka:
--
--   2.3  `enqueue_job`: uhvati `unique_violation` i preuzmi tuđi red — dva
--        paralelna prva scana iste kombinacije više ne vraćaju 500 (N1)
--   2.5  `outreach_messages`: jedinstveni ključ (user_id, place_id, channel,
--        body) — dupli klik na „Kopiraj" ne upisuje dva reda (W5)

-- ═══════════════════════════════════════════════════════════
-- 2.3 enqueue_job: trka na prvom upisu
-- ═══════════════════════════════════════════════════════════

create or replace function enqueue_job(
  p_type       text,
  p_payload    jsonb,
  p_dedupe_key text default null,
  p_user       text default null,
  p_run_after  timestamptz default now()
)
returns table (job_id bigint, joined boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     bigint;
  v_joined boolean := false;
begin
  if p_dedupe_key is not null then
    -- `for update` da dva paralelna upisa ne prođu oba kroz „nema ga".
    select q.id into v_id
    from job_queue q
    where q.type = p_type
      and q.dedupe_key = p_dedupe_key
      and q.status in ('pending', 'running')
    order by q.id
    limit 1
    for update;

    v_joined := v_id is not null;
  end if;

  if v_id is null then
    begin
      insert into job_queue (type, payload, dedupe_key, run_after)
      values (p_type, p_payload, p_dedupe_key, p_run_after)
      returning job_queue.id into v_id;
    exception when unique_violation then
      -- [Faza 2, 2.3] Dva procesa su prošla kroz prazan `for update` (nije bilo
      -- reda koji bi se zaključao) i oba su pokušala insert (N1). Drugi je stigao
      -- prvi — preuzmi NJEGOV red umesto da baciš 500.
      v_joined := true;
      select q.id into v_id
      from job_queue q
      where q.type = p_type
        and q.dedupe_key = p_dedupe_key
        and q.status in ('pending', 'running')
      order by q.id
      limit 1;
    end;
  end if;

  if p_user is not null then
    insert into job_subscribers (job_id, user_id) values (v_id, p_user)
    on conflict do nothing;
  end if;

  return query select v_id, v_joined;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2.5 outreach_messages: bez duplih redova
-- ═══════════════════════════════════════════════════════════

/**
 * Dupli klik na „Kopiraj" (ili retry posla u workeru) upisuje isti red drugi
 * put. Isti (korisnik, prospekt, kanal, TEKST) je ista isporuka — arhiva ne
 * sme da broji dva puta ono što se desilo jednom.
 *
 * Cena: namerno ponovljeno kopiranje ISTOG teksta za isti lead ne pravi nov
 * red. U praksi je to retko (tekst šablona se menja), a jedinstvenost je
 * vrednija od te retke istorije (W5).
 */
create unique index if not exists outreach_messages_dedupe_idx
  on outreach_messages (user_id, place_id, channel, body);

-- ═══════════════════════════════════════════════════════════
-- PRAVA
-- ═══════════════════════════════════════════════════════════
-- `create or replace` čuva postojeće privilegije enqueue_job-a iz 0003;
-- nijedna nova funkcija nije dodata.
