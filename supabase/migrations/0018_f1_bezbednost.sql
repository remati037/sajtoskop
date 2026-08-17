-- 0018_f1_bezbednost.sql — Faza 1 iz docs/PLAN-IZMENA.md: zatvaranje P1 liste
--
-- Četiri stvari, sve bez diranja postojećih podataka:
--
--   1.2  `request_limits` + `claim_request` — IP rate limit (fiksni prozor od
--        jednog minuta, 100 zahteva po IP+ruti; preko toga 429)
--   1.3  `webhook_events` — idempotencija isporuke Clerk webhook-a (insert pre
--        obrade, na konflikt preskoči)
--   1.6  `zabelezi_utisak` — dnevni plafon utisaka u ISTOJ transakciji sa
--        upisom (`for update` nad profilom je brava, N3)
--   1.6  `dopuni_utisak` — CAS upis sa `for update` nad redom (N4)
--
-- Sve funkcije su `security definer` i vidljive samo service_role-u, isto kao
-- ostale RPC funkcije u projektu.

-- ═══════════════════════════════════════════════════════════
-- 1.2 IP rate limit
-- ═══════════════════════════════════════════════════════════

create table if not exists request_limits (
  ip     text not null,
  route  text not null,
  minute timestamptz not null,
  count  integer not null default 0,
  primary key (ip, route, minute)
);

alter table request_limits enable row level security;

revoke all on table request_limits from anon, authenticated;

/**
 * Rezerviši JEDAN zahtev u tekućem minutu za (IP, ruta).
 *
 * Fiksni prozor, ne klizajući: 100 zahteva u istom minutu je granica, a preko
 * toga ruta vraća 429. Na ovoj skali je dovoljno — legitimni rad nikad ne
 * stigne do 100/min sa jedne adrese, a skript sa 50 naloga udara u isti zid
 * koliko god naloga imao.
 *
 * Čišćenje starih redova radi prvi zahtev svakog novog minuta; tabela ostaje
 * veličine „aktivni klijenti × rute × 2 minuta".
 */
create or replace function claim_request(p_ip text, p_route text, p_limit integer)
returns table (ok boolean, remaining integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_min   timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  insert into request_limits (ip, route, minute, count)
  values (p_ip, p_route, v_min, 1)
  on conflict (ip, route, minute)
  do update set count = request_limits.count + 1
  returning count into v_count;

  -- Prvi zahtev u minutu počisti redove starije od 2 minuta. Ključ je
  -- (ip, route, minute), pa je brisanje vođeno indeksom i jeftino.
  if v_count = 1 then
    delete from request_limits where minute < v_min - interval '2 minutes';
  end if;

  return query select v_count <= p_limit, greatest(0, p_limit - v_count);
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 1.3 Webhook idempotencija
-- ═══════════════════════════════════════════════════════════

/**
 * Događaji koje je webhook već obradio.
 *
 * Danas su oba Clerk handlera idempotentna preko `ref_id`, pa ova tabela ne
 * menja ništa u ponašanju — ali svaki BUDUĆI handler koji to ne bude dobija
 * zaštitu od Svix retry-ja bez ijedne izmene. Insert pre obrade, na konflikt
 * preskoči; ako obrada padne, ruta BRIŠE red da bi retry mogao ponovo.
 */
create table if not exists webhook_events (
  provider     text not null,
  event_id     text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);

alter table webhook_events enable row level security;

revoke all on table webhook_events from anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 1.6 Utisci: plafon i dopuna u RPC-u (N3, N4)
-- ═══════════════════════════════════════════════════════════

/**
 * Nastanak utiska sa dnevnim plafonom u ISTOJ transakciji.
 *
 * Stara verzija je brojala utiske pa upisivala — dva paralelna POST-a su mogla
 * oba da vide `dosad < 50` i oba da upišu (N3). `for update` nad profilom
 * serijalizuje pozive na bravi, pa plafon ne može da se probije.
 *
 * `ctx` se gradi ovde, iz profila koji je već zaključan — isti oblik koji je
 * pravio TS (plan, credits, unlocks, ua, viewport, pa errors uz bug).
 *
 * Vraća ceo red kao jsonb da ruta ne mora da ga čita drugim upitom.
 */
create or replace function zabelezi_utisak(
  p_user          text,
  p_rating        integer,
  p_source        text,
  p_route         text,
  p_route_label   text,
  p_ua            text,
  p_viewport      text,
  p_prompt_key    text,
  p_answers       jsonb,
  p_kind          text,
  p_severity      integer,
  p_errors        jsonb,
  p_screenshot    text,
  p_dnevni_plafon integer,
  p_mejl_limit    integer
)
returns table (ishod text, posalji_mejl boolean, red jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profil  profiles%rowtype;
  v_unlocks integer;
  v_dosad   integer;
  v_ctx     jsonb;
  v_id      bigint;
  v_row     feedback%rowtype;
begin
  select * into v_profil from profiles where id = p_user for update;

  if not found then
    return query select 'no_user', false, null::jsonb;
    return;
  end if;

  select count(*) into v_unlocks from unlocks where user_id = p_user;

  select count(*) into v_dosad
  from feedback
  where user_id = p_user and created_at >= now() - interval '24 hours';

  if v_dosad >= p_dnevni_plafon then
    return query select 'plafon', false, null::jsonb;
    return;
  end if;

  v_ctx := jsonb_build_object(
    'plan', v_profil.plan,
    'credits', v_profil.credits_balance,
    'unlocks', v_unlocks,
    'ua', left(coalesce(p_ua, ''), 400),
    'viewport', coalesce(p_viewport, '')
  );

  -- Dnevnik grešaka ide samo uz bug (F11 odluka 10) — ista odluka koju je
  -- donosio TS, sada na jednom mestu sa upisom.
  if p_kind = 'bug' and p_errors is not null and jsonb_array_length(p_errors) > 0 then
    v_ctx := v_ctx || jsonb_build_object('errors', p_errors);
  end if;

  insert into feedback (
    user_id, rating, source, route, route_label, ctx,
    prompt_key, answers, kind, severity, screenshot_path
  ) values (
    p_user, p_rating, p_source, p_route, p_route_label, v_ctx,
    p_prompt_key, coalesce(p_answers, '{}'::jsonb), p_kind, p_severity, p_screenshot
  )
  returning id into v_id;

  select * into v_row from feedback where id = v_id;

  return query select 'upisan', v_dosad < p_mejl_limit, row_to_json(v_row)::jsonb;
end;
$$;

/**
 * Dopuna utiska — CAS upis sa `for update` nad redom.
 *
 * Spajanje drugog koraka odgovora i validaciju (Zod iz kataloga, pravilo 16)
 * radi TS, jer u SQL-u nema kataloga. Da dva paralelna PATCH-a ne izgube jedan
 * skup odgovora (N4), ovaj RPC je jedina tačka upisa:
 *
 *   1. zaključa red (`for update`), pa se paralelni upisi serijalizuju OVDE;
 *   2. poredi `answers` sa onim što je TS video (`p_expected`) — ako je neko
 *      drugi u međuvremenu upisao, vraća 'stale' i TS ponavlja sa svežim
 *      stanjem (najviše 3 puta);
 *   3. upisuje spojeni i očišćeni odgovor koji je TS već proverio.
 *
 * Dnevnik grešaka ide uz zapis tek kad je zapis bug — isti uslov kao u TS-u,
 * sada u istoj transakciji sa upisom.
 */
create or replace function dopuni_utisak(
  p_id         bigint,
  p_user       text,
  p_expected   jsonb,
  p_answers    jsonb,
  p_kind       text,
  p_message    text,
  p_screenshot text,
  p_errors     jsonb
)
returns table (ok boolean, reason text, red jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row feedback%rowtype;
begin
  select * into v_row
  from feedback
  where id = p_id and user_id = p_user
  for update;

  if not found then
    return query select false, 'nema', null::jsonb;
    return;
  end if;

  if v_row.created_at < now() - interval '1 hour' then
    return query select false, 'kasno', null::jsonb;
    return;
  end if;

  -- CAS poredi samo kad se answers STVARNO spajaju (p_answers nije null);
  -- dopuna bez odgovora (samo tekst/tip) ne sme da padne na tuđem answers-u.
  if p_answers is not null and v_row.answers is distinct from p_expected then
    return query select false, 'stale', null::jsonb;
    return;
  end if;

  update feedback
  set answers         = coalesce(p_answers, v_row.answers),
      kind            = coalesce(p_kind, v_row.kind),
      message         = coalesce(p_message, v_row.message),
      screenshot_path = coalesce(p_screenshot, v_row.screenshot_path),
      updated_at      = now()
  where id = p_id
  returning * into v_row;

  if p_errors is not null and jsonb_array_length(p_errors) > 0
     and v_row.kind = 'bug'
     and not (v_row.ctx ? 'errors') then
    update feedback
    set ctx = v_row.ctx || jsonb_build_object('errors', p_errors)
    where id = p_id;
    v_row.ctx := v_row.ctx || jsonb_build_object('errors', p_errors);
  end if;

  return query select true, 'ok', row_to_json(v_row)::jsonb;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- PRAVA
-- ═══════════════════════════════════════════════════════════

revoke all on function claim_request(text, text, integer) from public, anon, authenticated;
revoke all on function zabelezi_utisak(text, integer, text, text, text, text, text, text, jsonb, text, integer, jsonb, text, integer, integer) from public, anon, authenticated;
revoke all on function dopuni_utisak(bigint, text, jsonb, jsonb, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function claim_request(text, text, integer) to service_role;
grant execute on function zabelezi_utisak(text, integer, text, text, text, text, text, text, jsonb, text, integer, jsonb, text, integer, integer) to service_role;
grant execute on function dopuni_utisak(bigint, text, jsonb, jsonb, text, text, text, jsonb) to service_role;
