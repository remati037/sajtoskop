# F6 — PageSpeed i Claude analiza

**Cilj:** otključan lead ima 3–5 konkretnih problema opisanih na srpskom, formulisanih tako da
se rečenica može doslovno prekopirati u poruku vlasniku.

**Procena:** 3–4 dana · **Preduslov:** F5 gotov

Ovo je najskuplja faza po pozivu i jedina koja troši Anthropic kredite. Postavi
**spend limit u Anthropic konzoli pre nego što napišeš prvi poziv.**

---

## 1. PageSpeed Insights

- [ ] Poziv isključivo na unlock, kao korak 2 posla `enrich_full`
- [ ] Strategija: **`mobile`**. Desktop skor je nezanimljiv — argument prema vlasniku je da mu sajt ne radi na telefonu.
- [ ] Čuvaj samo `psi_mobile_score` (0–100) i eventualno LCP. Ne čuvaj ceo Lighthouse izveštaj — to je megabajti po sajtu.
- [ ] Timeout 30s, jedan pokušaj, bez retryja. PSI je spor i često pukne; to nije razlog da posao propadne.
- [ ] Neuspeh → `psi_mobile_score = null`, posao se nastavlja

PSI ima zasebnu kvotu od Places-a i nije u istom budžetu. Ali brojač mu ipak dodaj u `api_budget`
sa zasebnim ključem, da ne otkrivaš problem tek kad počne da vraća 429.

---

## 2. Claude vision analiza

Ulaz: desktop screenshot + mobilni screenshot + strukturirani signali iz `ugly-score`.
Izlaz: strogo JSON, bez ikakvog uvoda.

```
Sistem: Ti si iskusan srpski web developer koji ocenjuje sajtove malih firmi
za potrebe hladnog kontakta. Odgovaraš isključivo JSON-om, bez uvoda i bez
markdown ograda.

Korisnik: [desktop screenshot] [mobilni screenshot]

Tehnički signali: {signals}
Platforma: {platform}
Ugly Score: {score}

Vrati JSON:
{
  "issues": [
    { "title": "kratak naslov", "detail": "jedna rečenica na srpskom",
      "severity": "visoka" | "srednja" | "niska" }
  ],
  "verdict": "jedna rečenica koju vlasnik firme razume, bez žargona"
}

Pravila:
- 3 do 5 stavki u issues, poređanih po ozbiljnosti
- Piši na srpskom, latinicom, sa dijakritikom
- Bez tehničkog žargona u "verdict" — vlasnik pekare to čita
- Ne izmišljaj probleme kojih nema na slici; ako je sajt solidan, reci to
- Ne pominji ime firme
```

Pravila implementacije:

- **Prompt živi isključivo na serveru.** Nikad u klijentskom bundle-u, nikad u odgovoru API-ja.
- Parsiraj JSON kroz Zod šemu. Na neuspeh: jedan retry sa porukom „vrati samo validan JSON", pa odustani i ostavi `ai_issues = null`.
- Model: Claude Sonnet. Ne Opus — cena po pozivu je ovde ceo argument.
- `max_tokens` konzervativno, oko 1000
- Slike šalji **smanjene** (npr. širina 1024) — cena vision poziva raste sa rezolucijom, a za detekciju „ovo izgleda kao 2011" 1024px je više nego dovoljno
- `audit_level = 3` posle uspešnog upisa

---

## 3. Kontrola troška

- [ ] Spend limit u Anthropic konzoli, postavljen pre prvog poziva
- [ ] Brojač AI poziva po danu u `api_budget`, sa zasebnim ključem
- [ ] Hard cap: iznad njega `enrich_full` preskače AI korak i ostavlja `audit_level = 2`
- [ ] Nikad AI poziv van unlocka. Nikad „da probamo na 100 sajtova da vidimo kako izgleda" — probaj na tri.

Realan trošak po unlocku sa dve slike i kratkim izlazom je nekoliko centi. Na 20 beta korisnika
sa po 30 kredita mesečno to je gornja granica od 600 poziva mesečno, i tu granicu održava
kreditni sistem — zato krediti postoje i u besplatnoj beti.

---

## 4. UI

- [ ] Detalj leada: dva screenshota jedan pored drugog, ispod njih lista problema sa bedževima ozbiljnosti
- [ ] `verdict` istaknut, sa dugmetom **„Kopiraj rečenicu"** — to je funkcija zbog koje se korisnik vraća
- [ ] PSI skor kao prsten ili traka, sa bojom po opsegu
- [ ] Ako je `ai_issues = null`, prikaži signale iz `ugly-score` kao rezervu, ne prazno mesto

---

## 5. Gotovo kad

- Otključan lead ima 3–5 stavki na srpskom sa dijakritikom
- `verdict` je rečenica koju možeš doslovno poslati vlasniku bez prepravke — proveri na pet stvarnih leadova
- Neuspeh PSI-ja ili AI-ja ne ruši posao; lead i dalje ima skor i screenshot
- Prompt se ne pojavljuje ni u jednom fajlu koji ide u browser: `grep -r "Ti si iskusan srpski" apps/web/.next/static/` → prazno
- Anthropic konzola pokazuje trošak u očekivanom redu veličine

---

## 6. Ne radi u ovoj fazi

- Bez AI generisanja outreach poruka — to je F7 i drugi prompt
- Bez AI-ja u bulk scanu
- Bez čuvanja punog Lighthouse izveštaja
- Bez fine-tuninga i bez eksperimenata sa više modela

---

## 7. Prompt za sesiju

```
Radimo docs/F6-psi-ai.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Prvo PSI, pa AI. Za AI korak: pre nego što ga uvežeš u worker, napravi mi
malu skriptu koja pusti prompt na 3 postojeća screenshota iz baze i ispiše
rezultat, da vidim kvalitet izlaza i procenim cenu po pozivu. Tek onda
integracija.

Podseti me da postavim spend limit u Anthropic konzoli ako ti ne kažem da
sam to uradio.
```
