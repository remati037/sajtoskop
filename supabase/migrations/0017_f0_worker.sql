-- 0017_f0_worker.sql — Faza 0 iz docs/PLAN-IZMENA.md: novac i pouzdanost
--
-- Statusna zaštita završetka posla (nalaz V1). Bez nje mrežna greška posle
-- uspešnog rada može da ponovi gotov posao (novi Places/Playwright pozivi) ili
-- da ga označi palim i refunduje uspešan scan. Sve tri funkcije menjaju stanje
-- samo nad poslovima koji su još `running`:
--
--   - complete_job: gotov posao ostaje `done`; drugo pozivanje je no-op
--   - fail_job:     posao koji nije `running` (gotov ili već pali) se ne dira
--                   i ne vraća se u red; `final = true` tada znači
--                   „nema šta da se menja", ne „označi palim"
--   - defer_job:    isto — odložiti se sme samo posao koji još radi
--
-- Granice se ne menjaju, pa `create or replace` čuva postojeće privilegije iz
-- 0003 (revoke anon/authenticated, grant service_role) i migracija ostaje
-- idempotentna za drugi prolaz u `pnpm check:sql`.

create or replace function complete_job(p_id bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update job_queue
  set status = 'done', finished_at = now(), last_error = null, locked_at = null
  where id = p_id and status = 'running';
$$;

create or replace function fail_job(p_id bigint, p_error text)
returns table (final boolean, next_run timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
  v_max      integer;
  v_status   text;
  v_next     timestamptz;
begin
  select q.attempts, q.max_attempts, q.status into v_attempts, v_max, v_status
  from job_queue q where q.id = p_id for update;

  if not found then
    return query select true, null::timestamptz;
    return;
  end if;

  -- [Faza 0, 0.2] Posao koji nije `running` se ne dira: već je gotov ili je
  -- već pao. Bez ovoga bi dupli poziv (mrežna greška posle `complete_job`)
  -- vratio gotov posao u red ili ga označio palim.
  if v_status is distinct from 'running' then
    return query select true, null::timestamptz;
    return;
  end if;

  if v_attempts >= v_max then
    update job_queue
    set status = 'failed', finished_at = now(), locked_at = null,
        last_error = left(p_error, 2000)
    where id = p_id;
    return query select true, null::timestamptz;
    return;
  end if;

  v_next := now() + (interval '1 minute' * power(2, v_attempts));

  update job_queue
  set status = 'pending', locked_at = null, run_after = v_next,
      last_error = left(p_error, 2000)
  where id = p_id;

  return query select false, v_next;
end;
$$;

create or replace function defer_job(
  p_id        bigint,
  p_run_after timestamptz,
  p_note      text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update job_queue
  set status     = 'pending',
      locked_at  = null,
      run_after  = greatest(p_run_after, now() + interval '10 seconds'),
      attempts   = greatest(0, attempts - 1),
      last_error = left(p_note, 2000)
  where id = p_id and status = 'running';
$$;
