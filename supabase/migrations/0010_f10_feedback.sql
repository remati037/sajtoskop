-- 0010_f10_feedback.sql — F10: utisci iz bete
--
-- Izvor: docs/F10-feedback.md, sekcija 1.
--
-- Ova migracija ne dira nijedan postojeći podatak. Dodaje jednu tabelu i jednu
-- kolonu u `profiles`, i nijedna od njih ne učestvuje u kreditima — pravilo 3
-- iz CLAUDE.md ovde nije u igri.

-- ═══════════════════════════════════════════════════════════
-- 1. UTISCI
-- ═══════════════════════════════════════════════════════════
-- `rating` je `not null` jer je klik na ocenu jedini obavezan korak: bez njega
-- zapis ne bi ni nastao (F10, odluka 2). `kind` i `message` su `null` sve dok
-- korisnik ne dopuni — a većina neće, i to je prihvaćeno.

create table if not exists feedback (
  id            bigserial primary key,
  user_id       text not null references profiles(id) on delete cascade,
  country_code  text not null default 'RS',        -- pravilo 11

  rating        smallint not null,                 -- 1 loše · 2 ok · 3 odlično
  kind          text,                              -- bug | ideja | pohvala | drugo
  message       text,

  source        text not null default 'dugme',     -- dugme | podsetnik
  route         text,                              -- '/pretraga'
  route_label   text,                              -- 'Pretraga'

  -- Dijagnostika koja se čita očima u mejlu, ne filtrira SQL-om. Kao kolone bi
  -- svako novo polje značilo migraciju, a sadržaj se u beti menja brže od šeme.
  -- Oblik: { plan, credits, unlocks, ua, viewport }.
  ctx           jsonb not null default '{}'::jsonb,

  -- Mejl je obaveštenje, ne uslov (odluka 3). Njegov pad se pamti ovde, a ne u
  -- logu koji niko ne čita.
  emailed_at    timestamptz,
  email_error   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint feedback_rating_valid  check (rating between 1 and 3),
  constraint feedback_kind_valid    check (kind is null or kind in ('bug','ideja','pohvala','drugo')),
  constraint feedback_source_valid  check (source in ('dugme','podsetnik')),
  -- Ista granica stoji i u Zod šemi. Ovo je brana za klijenta koji zaobiđe formu.
  constraint feedback_message_len   check (message is null or char_length(message) <= 2000),
  constraint feedback_country_valid check (country_code ~ '^[A-Z]{2}$')
);

-- Dnevni limit i tvrd plafon se čitaju kao „koliko je ovaj korisnik poslao u
-- poslednja 24h", dakle po korisniku i po vremenu.
create index if not exists feedback_user_idx on feedback (user_id, created_at desc);

-- Pregled iz Supabase konzole: šta je stiglo danas, bez obzira ko je poslao.
create index if not exists feedback_recent_idx on feedback (created_at desc);

alter table feedback enable row level security;
alter table feedback force row level security;

-- Bez ijedne politike → `using (false)`, kao `businesses` (pravilo 10). Čita se
-- i piše isključivo kroz `service_role` iz API rute. Korisnik nema razloga da
-- čita ni svoje utiske: odgovor stiže mejlom, ne u aplikaciji.

-- ═══════════════════════════════════════════════════════════
-- 2. PODSETNIK POSLE TRI DANA
-- ═══════════════════════════════════════════════════════════
-- Jedna kolona, jedan upis, bez nove tabele. U bazi a ne u `localStorage`-u —
-- inače isti čovek na drugom računaru dobija isti prozor iznova (odluka 7).
--
-- Upisuje se kad se podsetnik PRIKAŽE, ne kad se odgovori: korisnik koji ga je
-- zatvorio ne sme da ga vidi ponovo.

alter table profiles add column if not exists feedback_prompted_at timestamptz;
