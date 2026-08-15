-- 0016_f11_petlja.sql — F11.4: zatvaranje petlje
--
-- Izvor: docs/F11-utisci-v2.md, sekcije 6.4, 6.5, 7 i 9.
--
-- Ne dira nijedan postojeći podatak: dve `add column`, jedno ograničenje i jedan
-- indeks. `pnpm check:sql` pušta svaku migraciju dvaput, pa se ograničenje prvo
-- obara sa `if exists`.

-- ═══════════════════════════════════════════════════════════
-- 1. OBRAZLOŽENJE ZA KORISNIKA
-- ═══════════════════════════════════════════════════════════
-- „Obrazloženje" iz §6.4 i §7 je rečenica koja ide KORISNIKU — u „Moje prijave"
-- i u mejl „rešeno je ono što si prijavio". To NIJE `admin_note`: ta kolona je
-- radna beleška admina i sme da sadrži interne stvari („isti koren kao #42",
-- linkove, podsetnike) koje korisnik ne sme da vidi. Pomešati to dvoje bi ili
-- procurelo interne stvari spolja, ili nateralo admina da piše belešku kao da je
-- javna. Zato je ovo svoja kolona: „šta kažem sebi" i „šta kažem korisniku" se
-- ne mogu razići ako su dva polja.

alter table feedback add column if not exists user_note text;

-- ═══════════════════════════════════════════════════════════
-- 2. BROJAČ POKUŠAJA MEJLA „REŠENO"
-- ═══════════════════════════════════════════════════════════
-- F11 §9, poslednji red: pad Resend-a → `notified_at` ostaje `null` i sledeći
-- prolaz pokušava ponovo, najviše 3 puta. Bez brojača bi zapis kome mejl nikad
-- ne može da stigne (mrtva adresa, stalno pao Resend) bio pokušavan zauvek.
-- Posle 3 pokušaja kanal obaveštavanja ostaje tačka na dugmetu, koja ne zavisi
-- od mejla.

alter table feedback add column if not exists notify_attempts smallint not null default 0;

alter table feedback drop constraint if exists feedback_notify_attempts_valid;
alter table feedback add  constraint feedback_notify_attempts_valid
  check (notify_attempts between 0 and 10);

-- Tačno presek koji cron „rešeno" čita: rešeno, neobavešteno, s pokušajima.
-- Parcijalan jer je ceo upit jedan `where status = 'reseno'` — bez indeksa bi
-- svaki dnevni prolaz šetao kroz celu tabelu utisaka.
create index if not exists feedback_notify_idx
  on feedback (status, notified_at)
  where status = 'reseno' and notified_at is null and notify_attempts < 3;
