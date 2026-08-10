-- 0006_ai_solidan.sql — F6: zastavica „sajt je uredan"
--
-- Izvor: docs/F6-psi-ai.md §2, i `AiOutcome.solidan` u apps/worker/src/lib/ai-audit.ts.
--
-- ── zašto ovo nije izvedeno iz broja stavki ───────────────
-- Naizgled se `solidan` može zaključiti iz `ai_issues`: nula ili malo stavki,
-- nijedna visoke ozbiljnosti — dakle uredan sajt. Ali to je izvođenje pravila
-- koje je već primenjeno u modelu i u Zod šemi, treći put i na trećem mestu.
-- Prvi put kad se prag u šemi promeni, izvedeni zaključak počne da laže i to
-- niko ne primeti, jer se čita u drugoj fazi (F7) i u drugom kodu.
--
-- Model već daje eksplicitan odgovor na to pitanje. Čuva se odgovor.
--
-- ── zašto je nullable ─────────────────────────────────────
-- `null` ima svoje značenje i nije isto što i `false`: znači „AI nije uspeo ili
-- nije ni pozvan" (audit_level < 3). Generator poruka u F7 mora da razlikuje
-- „sajt je proveren i uredan je" (ne piši mu) od „sajt nije proveren"
-- (nemaš osnov da mu bilo šta napišeš).

alter table website_audits add column if not exists ai_solidan boolean;

-- Zastavica bez analize je besmislena: ako je `ai_solidan` postavljen, mora da
-- postoji i `ai_issues`. Obrnuto ne važi — `ai_issues` može da bude prazan niz
-- uz `ai_solidan = true`, i to je tačno slučaj urednog sajta.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'website_audits_ai_solidan_needs_issues'
  ) then
    alter table website_audits add constraint website_audits_ai_solidan_needs_issues
      check (ai_solidan is null or ai_issues is not null);
  end if;
end;
$$;

-- Za F7: „daj mi otključane leadove kojima vredi pisati". Parcijalan indeks jer
-- se čita samo ta grana — `solidan = true` je grana kojoj se poruka ne piše.
create index if not exists website_audits_ai_pisi_idx
  on website_audits (place_id)
  where ai_solidan is false;
