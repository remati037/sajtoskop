-- 0007_f7_pipeline.sql — F7: kanban status, generisane poruke, događaj „potpisan"
--
-- Izvor: docs/F7-poruke.md §1 i §3.
-- Odstupanja od PRD-a su namerna i objašnjena na licu mesta oznakom [ODSTUPANJE].

-- ═══════════════════════════════════════════════════════════
-- 1. STATUS LEADA (KANBAN)
-- ═══════════════════════════════════════════════════════════
--
-- [ODSTUPANJE — strani ključ ide na `unlocks`, ne na `profiles` + `businesses`]
--
-- PRD §1 vezuje obe tabele zasebno za `profiles(id)` i `businesses(place_id)`.
-- Ali §3 traži i pravilo „samo otključani leadovi ulaze u pipeline", koje bi tada
-- živelo isključivo u TypeScriptu — dakle u onoliko mesta koliko ima upisa, i
-- tačno do prve rute koja ga zaboravi.
--
-- `unlocks` ima PK `(user_id, place_id)` (pravilo 4), pa složeni strani ključ na
-- taj par pretvara to pravilo u invarijantu baze: red u `lead_status` za lead
-- koji korisnik nije otključao ne može ni da nastane. Veze ka `profiles` i
-- `businesses` time nisu izgubljene — `unlocks` ih već drži, tranzitivno.

create table if not exists lead_status (
  user_id      text not null,
  place_id     text not null,
  status       text not null default 'nekontaktiran',
  note         text,
  channel      text,
  contacted_at timestamptz,
  updated_at   timestamptz not null default now(),

  primary key (user_id, place_id),

  constraint lead_status_unlocked_fk
    foreign key (user_id, place_id) references unlocks(user_id, place_id) on delete cascade,

  constraint lead_status_status_valid check (
    status in ('nekontaktiran', 'kontaktiran', 'odgovorio', 'potpisan', 'nezainteresovan')
  ),
  -- `poziv` je kanal kontakta, ali nema generisanu poruku — fiksni broj se zove.
  -- Zato je lista kanala ovde šira od liste kanala u generatoru.
  constraint lead_status_channel_valid check (
    channel is null or channel in ('mejl', 'viber', 'instagram', 'poziv')
  ),
  -- Lead koji je iole pomeren mora da ima datum kontakta, i obrnuto. Kartica u
  -- kanbanu prikazuje taj datum; bez ovoga kolona „Kontaktiran" ume da sadrži
  -- karticu bez ijednog datuma i to se primeti tek u UI-u.
  constraint lead_status_contacted_consistent check (
    (status = 'nekontaktiran') = (contacted_at is null)
  )
);

-- Kanban čita „svih pet kolona za jednog korisnika" jednim upitom.
create index if not exists lead_status_user_idx
  on lead_status (user_id, status);

create or replace function touch_lead_status() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lead_status_touch on lead_status;
create trigger lead_status_touch before update on lead_status
  for each row execute function touch_lead_status();

-- ═══════════════════════════════════════════════════════════
-- 2. GENERISANE PORUKE
-- ═══════════════════════════════════════════════════════════
--
-- Istorija, ne keš. Šablonska poruka se pravi iz čiste funkcije i jeftinija je
-- za ponovno generisanje nego za čitanje iz baze; ovde se upisuje ono što je
-- korisnik zaista poslao, da bi se za šest meseci moglo pitati koja formulacija
-- je vodila do `potpisan`.

create table if not exists outreach_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  place_id   text not null,
  channel    text not null,
  body       text not null,
  /** `sablon` ili `ai` — F7 §2 dozvoljava obe, i razlika je merljiva. */
  source     text not null default 'sablon',
  created_at timestamptz not null default now(),

  constraint outreach_messages_unlocked_fk
    foreign key (user_id, place_id) references unlocks(user_id, place_id) on delete cascade,

  constraint outreach_messages_channel_valid check (
    channel in ('mejl', 'viber', 'instagram')
  ),
  constraint outreach_messages_source_valid check (source in ('sablon', 'ai')),
  constraint outreach_messages_body_nonempty check (length(btrim(body)) > 0)
);

create index if not exists outreach_messages_lead_idx
  on outreach_messages (user_id, place_id, created_at desc);

-- ═══════════════════════════════════════════════════════════
-- 3. DOGAĐAJ „POTPISAN"
-- ═══════════════════════════════════════════════════════════
--
-- F7 §3: kad lead pređe u `potpisan`, upiši događaj sa svim atributima. Ne
-- koristi se ni za šta — samo se skuplja.
--
-- Atributi se ovde PREPISUJU, ne referenciraju. To je namerna denormalizacija:
-- `businesses` ima TTL 30 dana (pravilo 1) i `site_status` se menja pri svakom
-- ponovnom auditu. Za šest meseci pitanje glasi „kakav je lead bio u trenutku
-- kad je potpisan", a join bi na to odgovorio stanjem od danas.
--
-- `country_code` stoji ovde iako se može izvesti joinom — pravilo 11, i zato što
-- je ovo jedina tabela u šemi namenjena čitanju bez joina.

create table if not exists signed_events (
  id           bigserial primary key,
  user_id      text not null references profiles(id) on delete cascade,
  place_id     text not null references businesses(place_id) on delete cascade,
  country_code text not null default 'RS',
  city_slug    text,
  niche_slug   text,
  site_status  text,
  ugly_band    text,
  ugly_score   integer,
  platform     text,
  channel      text,
  created_at   timestamptz not null default now()
);

-- Jedan događaj po leadu i korisniku. Bez ovoga bi `potpisan → nezainteresovan
-- → potpisan` upisao dva potpisa istog posla i naduvao jedini podatak u
-- proizvodu koji mora da bude tačan.
create unique index if not exists signed_events_once_idx
  on signed_events (user_id, place_id);

create index if not exists signed_events_attrs_idx
  on signed_events (niche_slug, city_slug, created_at desc);

-- ═══════════════════════════════════════════════════════════
-- 4. RLS
-- ═══════════════════════════════════════════════════════════
-- Pravilo 10: RLS na svakoj tabeli. Politike su `for select` kao u 0001 —
-- upis ide isključivo kroz API rute sa `service_role` klijentom, posle provere
-- Clerk sesije na serveru (pravilo 8). Klijent nikad ne piše direktno u bazu.

alter table lead_status       enable row level security;
alter table outreach_messages enable row level security;
alter table signed_events     enable row level security;

drop policy if exists "own rows" on lead_status;
create policy "own rows" on lead_status
  for select to authenticated using (user_id = auth.jwt() ->> 'sub');

drop policy if exists "own rows" on outreach_messages;
create policy "own rows" on outreach_messages
  for select to authenticated using (user_id = auth.jwt() ->> 'sub');

-- [ODSTUPANJE] `signed_events` nema politiku čitanja ni za vlasnika reda.
-- Ovo je analitički trag za mene, ne podatak koji korisnik u beti gleda; kad mu
-- zatreba, dobiće ga kroz rutu. Prazan skup politika uz uključen RLS znači „niko
-- osim service_role", što je ista stroga podrazumevana vrednost kao `using (false)`.
drop policy if exists "no direct read" on signed_events;
create policy "no direct read" on signed_events for select using (false);

-- ═══════════════════════════════════════════════════════════
-- 5. FUNKCIJE
-- ═══════════════════════════════════════════════════════════

/**
 * Rang statusa — koliko je lead odmakao u levku.
 *
 * Postoji samo zbog `mark_contacted`: automatika sme da gura lead napred, nikad
 * unazad. `nezainteresovan` je kraj puta, a ne stepenik, pa nosi najviši rang —
 * ni njega automatika ne sme da pregazi.
 */
create or replace function lead_status_rank(p_status text) returns integer
language sql immutable as $$
  select case p_status
    when 'nekontaktiran'   then 0
    when 'kontaktiran'     then 1
    when 'odgovorio'       then 2
    when 'potpisan'        then 3
    when 'nezainteresovan' then 4
    else 0
  end;
$$;

/**
 * Ručna promena statusa — prevlačenje kartice u kanbanu.
 *
 * Korisnikova odluka je konačna i sme da ide u oba smera: prevlačenje unazad je
 * ispravka greške, ne događaj. Zato ovde nema provere ranga (v. `mark_contacted`).
 *
 * Prelazak u `potpisan` u istoj transakciji upisuje događaj sa atributima leada.
 * Namerno nije zaseban TypeScript korak: dva upisa iz rute nisu atomična, a
 * „upiši događaj" je tačno ona linija koja se izgubi u prvoj sledećoj izmeni.
 */
create or replace function set_lead_status(
  p_user    text,
  p_place   text,
  p_status  text,
  p_channel text default null
) returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_exists boolean;
begin
  if lead_status_rank(p_status) = 0 and p_status <> 'nekontaktiran' then
    return query select false, 'invalid_status'; return;
  end if;

  select true into v_exists from unlocks u
    where u.user_id = p_user and u.place_id = p_place;

  if v_exists is null then
    return query select false, 'not_unlocked'; return;
  end if;

  insert into lead_status (user_id, place_id, status, channel, contacted_at)
  values (
    p_user, p_place, p_status, p_channel,
    case when p_status = 'nekontaktiran' then null else now() end
  )
  on conflict (user_id, place_id) do update set
    status  = excluded.status,
    channel = coalesce(p_channel, lead_status.channel),
    -- Prvi pomak iz `nekontaktiran` postavlja datum; kasnije promene ga ne diraju,
    -- jer je to datum PRVOG kontakta. Povratak u `nekontaktiran` ga briše — inače
    -- pada `lead_status_contacted_consistent`, a i kartica bez kontakta ne sme da
    -- nosi datum kontakta.
    contacted_at = case
      when excluded.status = 'nekontaktiran' then null
      else coalesce(lead_status.contacted_at, now())
    end;

  if p_status = 'potpisan' then
    insert into signed_events (
      user_id, place_id, country_code, city_slug, niche_slug,
      site_status, ugly_band, ugly_score, platform, channel
    )
    select
      p_user, b.place_id, b.country_code, b.city_slug, b.niche_slug,
      a.site_status, a.ugly_band, a.ugly_score, a.platform,
      coalesce(p_channel, (select ls.channel from lead_status ls
                            where ls.user_id = p_user and ls.place_id = p_place))
    from businesses b
    left join website_audits a on a.place_id = b.place_id
    where b.place_id = p_place
    on conflict (user_id, place_id) do nothing;
  end if;

  return query select true, 'updated';
end;
$$;

/**
 * Klik na „Kopiraj" — F7 §2: poruka je kopirana, lead je kontaktiran.
 *
 * [ODSTUPANJE od PRD-a §2, bitno]
 * PRD kaže „klik na Kopiraj automatski prebacuje lead u `kontaktiran`". Doslovno
 * primenjeno, ponovno kopiranje poruke leadu koji je već odgovorio ili potpisao
 * vratilo bi ga u `kontaktiran` i tiho pokvarilo kanban — a kopiranje poruke
 * leadu u toku razgovora je normalna radnja, ne greška.
 *
 * Zato automatika gura status samo napred, sa `nekontaktiran` na `kontaktiran`.
 * `channel` se upisuje uvek: kanal poslednjeg kontakta je tačan podatak i kad
 * status ostaje isti.
 */
create or replace function mark_contacted(
  p_user    text,
  p_place   text,
  p_channel text
) returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_exists boolean;
begin
  if p_channel not in ('mejl', 'viber', 'instagram', 'poziv') then
    return query select false, 'invalid_channel'; return;
  end if;

  select true into v_exists from unlocks u
    where u.user_id = p_user and u.place_id = p_place;

  if v_exists is null then
    return query select false, 'not_unlocked'; return;
  end if;

  insert into lead_status (user_id, place_id, status, channel, contacted_at)
  values (p_user, p_place, 'kontaktiran', p_channel, now())
  on conflict (user_id, place_id) do update set
    status = case
      when lead_status_rank(lead_status.status) < lead_status_rank('kontaktiran')
        then 'kontaktiran'
      else lead_status.status
    end,
    channel      = p_channel,
    contacted_at = coalesce(lead_status.contacted_at, now());

  return query select true, 'contacted';
end;
$$;

/**
 * Beleška po leadu (F7 §3).
 *
 * Zasebna funkcija, a ne parametar `set_lead_status`: prevlačenje kartice ne
 * nosi tekst beleške, pa bi ga zajednički potpis pri svakom prevlačenju
 * prepisao praznim. Prazan string briše belešku, `null` je isto što i brisanje.
 */
create or replace function set_lead_note(
  p_user  text,
  p_place text,
  p_note  text
) returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_exists boolean;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select true into v_exists from unlocks u
    where u.user_id = p_user and u.place_id = p_place;

  if v_exists is null then
    return query select false, 'not_unlocked'; return;
  end if;

  insert into lead_status (user_id, place_id, note)
  values (p_user, p_place, v_note)
  on conflict (user_id, place_id) do update set note = v_note;

  return query select true, 'saved';
end;
$$;

-- Isti režim kao kreditne funkcije iz 0001: `security definer` funkcija koju
-- `authenticated` sme da pozove je ista rupa kao upis bez RLS-a. Poziva ih
-- isključivo server, posle provere Clerk sesije.
revoke all on function set_lead_status(text, text, text, text) from public, anon, authenticated;
revoke all on function mark_contacted(text, text, text)        from public, anon, authenticated;
revoke all on function set_lead_note(text, text, text)         from public, anon, authenticated;

grant execute on function set_lead_status(text, text, text, text) to service_role;
grant execute on function mark_contacted(text, text, text)        to service_role;
grant execute on function set_lead_note(text, text, text)         to service_role;
