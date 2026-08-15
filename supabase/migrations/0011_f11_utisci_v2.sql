-- 0011_f11_utisci_v2.sql — F11: utisci v2, motor pravila
--
-- Izvor: docs/F11-utisci-v2.md, sekcija 4.
--
-- Ova migracija NE dira nijedan postojeći podatak. Sve je `add column`,
-- `create table if not exists` i proširenje `check` ograničenja — nijedan
-- `update`, nijedan `delete`. Postojeći utisci iz F10 imaju `rating`, pa prolaze
-- i kroz novo ograničenje `feedback_ima_sadrzaj`.
--
-- Ograničenja se svuda prvo obaraju sa `if exists`, pa dodaju: `pnpm check:sql`
-- pušta svaku migraciju dvaput i traži da drugi prolaz prođe.

-- ═══════════════════════════════════════════════════════════
-- 1. FEEDBACK: OD OCENE KA ODGOVORU
-- ═══════════════════════════════════════════════════════════
-- Kampanjski odgovor („1.990–3.900 RSD") nema ocenu, pa `rating` prestaje da
-- bude obavezan. Ali zapis bez ijednog sadržaja ne sme da postoji — to je ono
-- što `feedback_ima_sadrzaj` čuva umesto `not null`-a.

alter table feedback alter column rating drop not null;

alter table feedback
  add column if not exists prompt_key      text,
  add column if not exists answers         jsonb    not null default '{}'::jsonb,
  add column if not exists status          text     not null default 'novo',
  add column if not exists severity        smallint,
  add column if not exists tags            text[]   not null default '{}',
  add column if not exists admin_note      text,
  add column if not exists resolved_at     timestamptz,
  add column if not exists notified_at     timestamptz,   -- korisnik obavešten
  add column if not exists seen_at         timestamptz,   -- korisnik video ishod
  add column if not exists screenshot_path text,
  add column if not exists reward_credits  smallint not null default 0;

alter table feedback drop constraint if exists feedback_ima_sadrzaj;
alter table feedback add  constraint feedback_ima_sadrzaj
  check (rating is not null or answers <> '{}'::jsonb or message is not null);

alter table feedback drop constraint if exists feedback_status_valid;
alter table feedback add  constraint feedback_status_valid
  check (status in ('novo','priznato','u_radu','reseno','odbijeno','duplikat'));

alter table feedback drop constraint if exists feedback_severity_valid;
alter table feedback add  constraint feedback_severity_valid
  check (severity is null or severity between 1 and 3);

-- Izvor dobija tri nove vrednosti; stara dva ostaju netaknuta.
alter table feedback drop constraint if exists feedback_source_valid;
alter table feedback add  constraint feedback_source_valid
  check (source in ('dugme','podsetnik','pitanje','kampanja','incident'));

-- Nagrada je uvek pozitivna i uvek u granicama iz F11 §6.7 (+1 ili +10).
-- Oduzimanje kroz ovu kolonu nije predviđeno ni na jednom putu.
alter table feedback drop constraint if exists feedback_reward_valid;
alter table feedback add  constraint feedback_reward_valid
  check (reward_credits between 0 and 10);

-- Admin lista: „šta je novo i nerešeno", pa „šta je od ovog pitanja".
create index if not exists feedback_status_idx on feedback (status, created_at desc);
create index if not exists feedback_prompt_idx on feedback (prompt_key, created_at desc);

-- ═══════════════════════════════════════════════════════════
-- 2. STANJE PITANJA PO KORISNIKU
-- ═══════════════════════════════════════════════════════════
-- PK je `(user_id, prompt_key)`: isto pitanje postoji najviše jednom po nalogu.
-- To je i cela odbrana od „prikaži pa opet prikaži" iz dva taba — drugi upis
-- pada na PK i ruta vraća 409 (F11 §9).
--
-- `dismissed_count` je brojač, ne zastavica: `posao-pao` sme da se ponovi
-- (1× / 24 h), pa isti red ume da bude odbačen više puta.

create table if not exists feedback_prompts (
  user_id         text not null references profiles(id) on delete cascade,
  prompt_key      text not null,
  status          text not null default 'prikazano',
  shown_at        timestamptz not null default now(),
  answered_at     timestamptz,
  dismissed_count smallint not null default 0,
  feedback_id     bigint references feedback(id) on delete set null,

  primary key (user_id, prompt_key),
  constraint feedback_prompts_status_valid
    check (status in ('prikazano','odgovoreno','odbaceno'))
);

alter table feedback_prompts enable row level security;
alter table feedback_prompts force  row level security;
-- Bez ijedne politike → `using (false)` (pravilo 10). Čita se i piše isključivo
-- kroz `service_role` iz API rute i iz `(app)/layout.tsx`.

-- ═══════════════════════════════════════════════════════════
-- 3. STANJE MOTORA NA PROFILU
-- ═══════════════════════════════════════════════════════════
-- Ovde a ne u zasebnoj tabeli zato što `(app)/layout.tsx` profil ionako čita —
-- globalni cooldown je time besplatan na svakom učitavanju (F11 §3.3).
--
-- `feedback_unseen_count` puni tek F11.4 (tačka na dugmetu). Kolona ide sada da
-- se ista tabela ne bi menjala dvaput.

alter table profiles
  add column if not exists feedback_cooldown_until timestamptz,
  add column if not exists feedback_muted_until    timestamptz,
  add column if not exists feedback_dismiss_streak smallint not null default 0,
  add column if not exists feedback_unseen_count   smallint not null default 0;

alter table profiles drop constraint if exists profiles_feedback_counters_nonneg;
alter table profiles add  constraint profiles_feedback_counters_nonneg
  check (feedback_dismiss_streak >= 0 and feedback_unseen_count >= 0);

-- ═══════════════════════════════════════════════════════════
-- 4. BETA DNEVNIK
-- ═══════════════════════════════════════════════════════════
-- Tabela ulazi sada, sadržaj i ekran dolaze u F11.4.

create table if not exists changelog (
  id            bigserial primary key,
  title         text not null,
  body          text,
  kind          text not null default 'promena',
  from_feedback bigint[] not null default '{}',
  shipped_at    timestamptz not null default now(),
  published     boolean not null default true,

  constraint changelog_kind_valid check (kind in ('novo','promena','popravka'))
);

alter table changelog enable row level security;
alter table changelog force  row level security;

-- [ODSTUPANJE od pravila 10, svesno — F11 §4]
-- `changelog` nije korisnički podatak nego sadržaj proizvoda, isto što i tekst
-- na stranici. Zato jedina politika u ovoj migraciji: prijavljen korisnik čita
-- objavljene stavke. Neobjavljene ne vidi niko osim `service_role`-a.
drop policy if exists changelog_read_published on changelog;
create policy changelog_read_published on changelog
  for select to authenticated using (published);

-- ═══════════════════════════════════════════════════════════
-- 5. KREDITI ZA UTISAK
-- ═══════════════════════════════════════════════════════════

-- [ODSTUPANJE od F11 §4 — obavezno, inače puca F9]
-- PRD ovde piše `check (reason in ('unlock','monthly_grant','admin','refund','feedback'))`,
-- dakle bez `'scan'`. Ali `'scan'` je dodat u 0009 (F9) i njime se naplaćuje
-- svako skeniranje; doslovan prepis PRD-a bi oborio `spend_credit_and_scan` na
-- prvom pozivu. Lista je zato stara lista + `'feedback'`.
alter table credit_ledger drop constraint if exists credit_ledger_reason_valid;
alter table credit_ledger add  constraint credit_ledger_reason_valid check (
  reason in ('unlock', 'scan', 'monthly_grant', 'admin', 'refund', 'feedback')
);

-- Idempotencija: `feedback` ulazi u isti parcijalni unique indeks kao dodele.
-- `ref_id` je `'fb:<id>'` — dvostruka dodela za isti utisak je nemoguća i kad
-- neko pozove RPC mimo aplikacije.
drop index if exists credit_ledger_grant_idem_idx;
create unique index credit_ledger_grant_idem_idx
  on credit_ledger (user_id, reason, ref_id)
  where ref_id is not null and reason in ('monthly_grant', 'admin', 'feedback');

-- ── grant_credits: nov razlog mora i u TELO funkcije ─────────
-- Zamka koju PRD izričito imenuje: `grant_credits` interno validira razlog.
-- Prošireno `check` ograničenje nad `credit_ledger` nije dovoljno — bez izmene
-- tela svaki poziv tiho vrati `invalid_reason` i nijedan kredit se ne dodeli.
--
-- Telo je nepromenjeno u odnosu na 0001, osim liste razloga u drugom `if`-u.
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

  if p_reason not in ('monthly_grant', 'admin', 'refund', 'feedback') then
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
  update profiles set credits_balance = credits_balance + p_amount where id = p_user;

  return query select true, 'granted';
end;
$$;

/**
 * Jedini put do kredita iz utiska (pravilo 3).
 *
 * Tanak omotač oko `grant_credits`, sa tri provere koje `grant_credits` ne zna:
 * mesečni plafon iz utisaka, gornja granica jedne dodele i veza sa zapisom.
 *
 * Podela odgovornosti (F11 §4): mesečni plafon i idempotencija su OVDE, jer
 * moraju da izdrže i poziv koji zaobiđe aplikaciju. Dnevna kapija (+1 najviše
 * jednom dnevno) i najmanja dužina poruke su u `apps/web/src/lib/feedback.ts`,
 * jer su pravilo proizvoda a ne integritet podataka. Ako se ikad raziđu, izvor
 * istine je ovo.
 *
 * [ODSTUPANJE od F11 §4, sitno] PRD zove `grant_credits` kroz `perform`, dakle
 * baca ishod. Tada ponovljen poziv za isti utisak vraća `ok = true` iako drugi
 * kredit nije dodeljen — a admin ekran iz F11.3 na osnovu toga piše „dodeljeno"
 * dvaput. Ishod se zato hvata i `already_granted` izlazi kao `vec dodeljeno`.
 * Broj dodeljenih kredita je u oba slučaja isti; menja se samo šta se javlja.
 */
create or replace function grant_feedback_credits(
  p_user     text,
  p_amount   integer,
  p_feedback bigint
)
returns table (ok boolean, reason text, delta integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mesec  integer;
  v_ok     boolean;
  v_reason text;
begin
  if p_amount <= 0 or p_amount > 10 then
    return query select false, 'iznos van granica'::text, 0; return;
  end if;

  select coalesce(sum(cl.delta), 0) into v_mesec
    from credit_ledger cl
   where cl.user_id = p_user
     and cl.reason  = 'feedback'
     and cl.created_at >= date_trunc('month', now());

  if v_mesec + p_amount > 20 then
    return query select false, 'mesecni plafon za utiske'::text, 0; return;
  end if;

  select g.ok, g.reason into v_ok, v_reason
    from grant_credits(p_user, p_amount, 'feedback', 'fb:' || p_feedback::text) g;

  if not coalesce(v_ok, false) then
    return query select false, coalesce(v_reason, 'nepoznat razlog')::text, 0; return;
  end if;

  if v_reason = 'already_granted' then
    return query select false, 'vec dodeljeno'::text, 0; return;
  end if;

  update feedback set reward_credits = p_amount where id = p_feedback;
  return query select true, 'ok'::text, p_amount;
exception
  when unique_violation then                       -- već dodeljeno za ovaj utisak
    return query select false, 'vec dodeljeno'::text, 0;
end;
$$;

-- Isti razlog kao u 0001 §4: `security definer` je podrazumevano izvršiva za
-- `public`, pa bi bilo ko sa anon ključem mogao da pozove
-- grant_feedback_credits('user_tudji', 10, 1) preko PostgREST-a.
revoke all on function grant_feedback_credits(text, integer, bigint)
  from public, anon, authenticated;
grant execute on function grant_feedback_credits(text, integer, bigint) to service_role;
