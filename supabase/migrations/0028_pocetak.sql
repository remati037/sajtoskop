-- supabase/migrations/0028_pocetak.sql
-- S30 — odgovori čarobnjaka `/pocetak` (docs/tok-i-onboarding.md §4.2, §4.3).
--
-- ── zašto posebna migracija, a ne izmena 0026 ──────────────
-- §4.3 u JEDNOJ migraciji donosi i stanje vođenog prolaza i odgovore čarobnjaka.
-- 0026 je pisana pre nego što je dokument stigao u repozitorijum i donela je
-- samo prvo (v. `docs/SESIJE.md`, S28), a već je primenjena na bazu — pa se ne
-- menja. Ovde su TAČNO tri kolone koje joj fale, oblik i ograničenje doslovno iz
-- §4.3. Ništa drugo.
--
-- ── šta kolone nose ─────────────────────────────────────────
--   onboarding_city    — grad sa ekrana 1 (slug iz `taxonomy.ts`)
--   onboarding_niche   — niša sa ekrana 2 (slug iz `taxonomy.ts`)
--   onboarding_channel — kanal sa ekrana 3: podrazumevan tab poruke na kartici
--
-- U bazi, ne u `localStorage`-u (O4): čovek koji prekine čarobnjak i vrati se sa
-- drugog uređaja zatiče svoje izbore preselektovane, a „Ponovi prve korake"
-- (§4.8) ih ima odakle da pročita.
--
-- Grad i niša NEMAJU `check`: spisak slugova živi u TypeScript-u i menja se bez
-- migracije. Upisuje ih samo `POST /api/onboarding/korak`, koji ih proverava
-- Zod šemom nad istim spiskom. Kanal JESTE zatvoren skup i to je stvar šeme:
-- tri kanala sa tekstom poruke, bez `poziv` (C9 — poziv nema šablon).
--
-- Idempotentna: `add column if not exists`, ograničenje `drop` + `add`.

alter table profiles add column if not exists onboarding_city    text;
alter table profiles add column if not exists onboarding_niche   text;
alter table profiles add column if not exists onboarding_channel text;

alter table profiles drop constraint if exists profiles_onboarding_channel_valid;
alter table profiles add constraint profiles_onboarding_channel_valid
  check (onboarding_channel is null or onboarding_channel in ('viber','mejl','instagram'));
