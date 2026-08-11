-- 0008_f7_ai_poruka.sql — F7: „Napiši drugačije", AI varijanta poruke
--
-- Izvor: docs/F7-poruke.md §2 — šabloni su podrazumevani, Claude poziv je
-- opciono dugme. Zato je ovo zasebna migracija od 0007: kanban i šablonske
-- poruke rade i bez ijednog reda odavde.
--
-- ── zašto posao u redu, a ne poziv iz Vercela ─────────────
-- 00-kontekst §3, dijagram arhitekture: Places, PageSpeed i Anthropic se zovu
-- ISKLJUČIVO iz workera. Jedan poziv ka Anthropicu iz Next rute bi tehnički
-- radio, ali bi razbio to pravilo i otvorio drugo mesto na kome se troše pare —
-- sa svojim retryjem, svojim tajmautom i svojim brojačem koji niko ne gleda.
--
-- Cena je što korisnik čeka par sekundi i klijent polluje `/api/job/:id`, isto
-- kao kod scana. Dnevni cap ide kroz `consume_side_call` iz 0005, pod ključem
-- `ai:outreach` — odvojeno od `ai:audit`, da se preterivanje sa dugmetom
-- „Napiši drugačije" ne pojede budžet za analizu otključanih leadova.

alter table job_queue drop constraint if exists job_queue_type_valid;
alter table job_queue add constraint job_queue_type_valid check (
  type in (
    'scan', 'enrich_basic', 'enrich_full', 'refresh_google',
    'monthly_grant', 'rewrite_message'
  )
);

-- Rezultat posla se ne vraća kroz `job_queue` nego sleće u `outreach_messages`
-- sa `source = 'ai'` — tabela iz 0007 koja za to već postoji. Klijent posle
-- „done" pročita poslednji AI red za taj lead.
--
-- Indeks pokriva baš to čitanje: najnovija AI poruka za jedan par korisnik/lead.
create index if not exists outreach_messages_ai_idx
  on outreach_messages (user_id, place_id, created_at desc)
  where source = 'ai';
