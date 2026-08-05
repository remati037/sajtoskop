# Sajtoskop — plan gradnje MVP-a

**Start:** 5. avgust 2026.
**Model:** bez fiksnog roka, pun PRD scope, besplatna beta na lansiranju.
**Ono što ovaj plan mora da spreči:** da tri meseca gradiš i ne isporučiš ništa.

---

## 0. Tri korekcije tvojih odgovora

Ne odbijam nijedan izbor. Ali sva tri zajedno — bez roka, maksimalan scope, bez naplate — je jedina kombinacija koja pouzdano ne stigne do korisnika. Zato menjam **oblik**, ne sadržaj.

### „Bez roka" → nema roka, ali svaka faza završava upotrebljivim proizvodom

Rok ne poštuješ ako ga sam sebi postaviš, i to je u redu. Ali onda mora nešto drugo da te drži: **redosled u kome je proizvod gotov u sredini, a ne na kraju.**

Posle faze 3 imaš app koji radi bez screenshota i bez AI-ja. Ako te faza 5 usisa na tri nedelje, i dalje imaš proizvod koji možeš da pustiš. To je jedina zaštita koju imaš kad nema datuma.

### „Pun PRD scope" → pun scope, ali poređan po odnosu dokaza i truda

Screenshot je vizuelno najimpresivniji deo i infrastrukturno najskuplji. AI analiza je najskuplja po pozivu. Obe dolaze **posle** nego što pretraga, lista i unlock rade. Ništa se ne izbacuje, samo se ne gradi prvo.

### „Besplatna beta" → besplatno korisniku, ali ne i tebi

Ovo je jedina korekcija koja je stvarno važna.

Sa punim scope-om, jedan unlock te košta: PageSpeed poziv + dva Playwright screenshota + Claude vision poziv. Cache-miss pretraga te košta Places poziv. Realno **$0.02–0.05 po otključanom leadu**, plus Places iznad 1.000 poziva mesečno.

Dvadeset beta korisnika koji otključaju po 100 leadova = nekoliko hiljada poziva bez ijednog dinara prihoda. To je tačno rupa iz `bezbednost-i-zastita.md`, P0-2, samo bez prihodne strane koja je amortizuje.

**Rešenje: krediti postoje od prvog dana, samo se dele besplatno.**

- `credit_ledger`, `unlocks`, `spend_credit_and_unlock` — sve isto kao da naplaćuješ
- Beta plan: 30 kredita mesečno, bez rollovera
- Cache-miss limit: 10 dnevno po korisniku
- Globalni dnevni cap u kodu, ispod Google free tiera

Kad upališ naplatu, menjaš **odakle krediti dolaze**, ne kako se troše. To je jedan fajl.

I: reci beta korisnicima da je besplatno **do kraja bete**, ne zauvek. Inače prvi dan naplate gubiš sve.

---

## 1. Šta već imaš i gde ide

Ovo je startni kapital. Ne piše se ponovo.

| Imaš | Ide u |
|---|---|
| `ugly-score.ts` | `packages/shared/` — deli se web ↔ worker, jedan izvor istine |
| `shared/translit.ts` (`cirToLat`, `foldForSearch`, `slugify`) | `packages/shared/` |
| `taxonomy.ts` (48 niša, 50 gradova, `queryStatus`) | `packages/shared/` |
| `csv.ts` (BOM + CRLF + RFC 4180) | `packages/shared/` — treba ti za export |
| `places.ts` (paginacija, dedup, city filter, 429 handling) | `apps/worker/` — **nikad na Vercel** |
| `fetch-site.ts` (timeout, TLS fallback, WAF retry) | `apps/worker/` |
| `harvest-emails.ts` | `apps/worker/` — postaje enrichment korak |
| `api-budget.ts` (LA timezone, mesečni cap) | `apps/worker/`, samo prelazi sa JSON fajla na Postgres |
| 6+ validnih scanova sa stvarnim podacima | seed za `businesses` + svi brojevi za landing |
| 139 kontakata agencija u Sheetu | lista beta korisnika |
| Šabac 58%, Kragujevac 57%, Čačak 48% bez sajta | hero landing stranice |
| Šabloni poruka koji su prošli test u praksi | F7, generator poruka |
| CLAUDE.md + `.claude/skills/` | prelazi u monorepo root |

**CLI ne gasiš.** Ostaje kao `apps/cli`. On ti je i dalje jedini način da napraviš ručnu listu za keš i da puniš Remati pipeline dok app nije gotov.

**Napomena o seed podacima:** Google polja imaju TTL 30 dana. Scanovi od 3–4.8. ističu početkom septembra. Kad ih ubaciš u `businesses`, odmah zakaži refresh job — inače ti prvi korisnik vidi podatke koje po ToS-u ne smeš da serviraš.

---

## 2. Arhitektura

```
apps/web        Next.js App Router · Vercel · Clerk · shadcn
apps/worker     Hetzner CX22 · Docker · BullMQ + Redis · Playwright
apps/cli        postojeći CLI, ostaje živ
packages/shared ugly-score · taxonomy · translit · csv · tipovi
```

Nepregovarljivo, iz CLAUDE.md: Playwright i lančani HTTP fetch nikad u Vercel funkciji. Web zove worker preko reda, ne direktno.

---

## 3. Faze

Procene su u danima rada od 4–6h. Uzmi ih kao redosled, ne kao obećanje.

### F0 — Monorepo i preseljenje (2–3 dana)

- [ ] pnpm workspace, tri `apps/` + `packages/shared`
- [ ] Preseli module po tabeli iz sekcije 1
- [ ] `packages/shared` mora da se builduje i za Node i za browser (ugly-score se koristi na obe strane)
- [ ] CLAUDE.md ažuriraj za monorepo strukturu i putanje

**Gotovo kad:** `pnpm --filter cli scan --grad=sabac --nisa=pvc-stolarija --mock` daje identičan izlaz kao pre selidbe.

### F1 — Baza i auth (3–4 dana)

- [ ] Supabase projekat, šema iz PRD-a
- [ ] `country_code` u svakoj relevantnoj tabeli — od danas, ne kasnije
- [ ] RLS na **svakoj** tabeli; `businesses` i `website_audits` sa `using (false)`
- [ ] `spend_credit_and_unlock` sa `FOR UPDATE` — piši je sada iako je beta besplatna
- [ ] Clerk, srpska lokalizacija
- [ ] CI grep za `service_role` u `.next/static`
- [ ] Seed skripta: postojeći JSON/CSV scanovi → `businesses` + `website_audits`

**Gotovo kad:** ulogovan korisnik vidi prazan dashboard, a `businesses` ima tvojih ~200 postojećih zapisa.

### F2 — Pretraga i lista (4–5 dana)

- [ ] `/pretraga` — grad i niša iz taksonomije, Zod allowlist, nikad slobodan tekst
- [ ] Cache-first: pogodak iz baze je instant i neograničen
- [ ] Rezultat: tabela sa Ugly Score bendovima (Solidan / Osrednji / Ružan / Katastrofa)
- [ ] Filteri: nema sajt · samo društvene · mrtav domen · skor 55+
- [ ] **Server-side stripping polja od prve verzije.** Telefon, mejl i URL ne postoje u JSON-u za neotključane. CSS blur je dekoracija.

**Gotovo kad:** iz browsera dobiješ isti rezultat koji CLI daje u terminalu, za nišu koja je već u kešu.

### F3 — Worker i red (4–5 dana)

- [ ] Hetzner CX22, Docker, Redis, BullMQ
- [ ] Job tipovi: `scan` (Places) i `enrich` (fetch + score)
- [ ] `api-budget` prelazi u Postgres, LA timezone logika ostaje netaknuta
- [ ] Per-korisnik dnevni cache-miss limit (beta: 10)
- [ ] Globalni dnevni cap, hard stop u kodu
- [ ] Google ključ: IP restriction na Hetzner IP + API restriction + quota

**Gotovo kad:** pretražiš nišu koje nema u bazi, dobiješ „u obradi", i lista se sama popuni za manje od dva minuta.

> **Ovde imaš proizvod.** Sve posle ovoga je dodatak. Ako se nešto raspadne u kasnijim fazama, ovo je verzija koju puštaš.

### F4 — Unlock i krediti (3 dana)

- [ ] Unlock endpoint, `user_id` isključivo iz Clerk sesije, nikad iz body-ja
- [ ] Mesečni grant kredita po planu (beta: 30)
- [ ] Istorija: `credit_ledger` prikaz korisniku
- [ ] CSV export samo otključanih, dnevni cap
- [ ] `BillingProvider` interfejs sa jednom implementacijom: `FreeBetaProvider`

**Gotovo kad:** otključaš lead, kredit se skine, i 20 paralelnih zahteva sa 1 kreditom prođe tačno jednom.

### F5 — Screenshot (3–4 dana)

- [ ] Playwright u kontejneru: non-root, `read_only`, `cap_drop: ALL`, mem 1g, pids 200
- [ ] `resolveSafeUrl` — privatni opsezi, DNS pinning, ručne redirekcije, max 3 skoka
- [ ] Privatan Supabase Storage bucket, signed URL 15 minuta
- [ ] Desktop + mobilni, webp
- [ ] Restart browsera svakih 50 sajtova, max 3 paralelna konteksta

**Gotovo kad:** unlock vrati dva screenshota, a `curl` na `169.254.169.254` kroz tvoj URL input vrati grešku.

### F6 — PSI i AI analiza (3–4 dana)

- [ ] PageSpeed Insights na unlock, lazy
- [ ] Claude vision: 3–5 konkretnih problema na srpskom + `ai_verdict`
- [ ] Spend limit u Anthropic konzoli, postavi ga pre prvog poziva
- [ ] Promptovi ostaju na serveru — nikad u klijentskom bundle-u

**Gotovo kad:** otključan lead ima rečenicu koju možeš doslovno da prekopiraš u poruku vlasniku.

### F7 — Poruke i kanban (3–4 dana)

- [ ] Generator poruka: mejl / Viber / Instagram DM — kreni od šablona koji su ti već radili
- [ ] Tip telefona iz prefiksa (`phoneType`) određuje koji kanal se predlaže
- [ ] Kanban: Nekontaktiran → Kontaktiran → Odgovorio → **Potpisan** → Nezainteresovan

**„Potpisan" nije nice-to-have.** To je jedini podatak u celom proizvodu koji konkurent ne može da kupi ni kopira, i jedina prednost koja raste s vremenom. Ako nešto iz F7 preskačeš, preskoči generator poruka, ne kanban.

### F8 — Landing i otvaranje bete (2–3 dana)

Sekcija 5.

---

## 4. Paralelna traka — ne prekida se ni jedan dan

Ovo je deo koji odlučuje ishod, a ne kod.

**Svake nedelje, jedan blok od 3h:**

- [ ] 20 poruka agencijama i frilenserima iz `pipeline-agencije` (imaš 139, koristio si ~0)
- [ ] Ponuda dok app nije gotov: **besplatna ručna lista** za njihov grad i nišu, iz CLI-a
- [ ] Na kraju svake isporuke: *„Gradim ovo kao alat. Hoćeš da te ubacim u besplatnu betu kad bude gotova?"*
- [ ] Ime i mejl u tab `beta-lista`

**Cilj do F8: 25–30 ljudi na beta listi.** Ako app bude gotov a lista prazna, imaš softver bez korisnika — a to je jedini scenario u kome su tri meseca stvarno bačena.

**I dalje radiš scanove za sebe.** Remati pipeline je jedini prihod u ovom periodu i jedini razlog zbog kog ceo mesec ima pozitivan bilans i ako SaaS ne prođe.

---

## 5. Landing

Ne prodaje pretplatu. Prodaje ulazak u betu.

**Hero — koristi svoj stvarni broj, ne izmišljen:**

> ## U Šapcu 58% PVC stolarija nema sajt koji radi.
> ## Imam im imena, telefone i tačan problem.
>
> Sajtoskop skenira Google Maps po gradu i niši, oceni svaki sajt od 0 do 100, i da ti kontakt, screenshot i listu konkretnih problema — spremno za outreach.
>
> [Uđi u besplatnu betu]

**Ispod:**
- Tri brojke iz tvojih scanova (Šabac 58, Kragujevac 57, Čačak 48) — to su podaci koje niko drugi nema
- Srpske specifičnosti: filter „nema sajt", mrtav domen, tip telefona za Viber vs poziv, poruke na srpskom
- Screenshot app-a, ne terminala — u ovoj fazi imaš pravi UI
- Iskreno o statusu: *„Beta je besplatna dok traje. Posle nje uvodim planove, a ti koji ste bili u beti dobijate cenu koja se ne ponavlja."*

**Ne stavljaj:** cenovnik, roadmap, tehnički stack, lifetime ponudu.

---

## 6. Trošak

| Stavka | Mesečno |
|---|---|
| Hetzner CX22 | ~€4,5 |
| Supabase | free → €25 kad pređeš limite |
| Vercel | Hobby free (proveri uslove za komercijalnu upotrebu pre naplate) |
| Places API | 1.000 poziva free, posle ~$32/1.000 |
| PageSpeed | free |
| Anthropic | postavi hard limit $20 |
| Domeni | već plaćeno |

**Realno €10–40 mesečno u beti**, pod uslovom da su limiti iz sekcije 0 uključeni. Bez njih je gornja granica neograničena.

---

## 7. Tačke provere umesto roka

Pošto nema datuma, ovo su ti signali.

| Kada | Provera | Ako padne |
|---|---|---|
| Posle F3 | Nedelju dana koristi app umesto CLI-a za svoj Remati outreach | Ako se vraćaš na CLI, UI ne valja. Popravi pre F5. |
| Posle F4 | Pusti 3 čoveka sa beta liste | Ako u nedelju dana ne otključaju ništa, problem nije u screenshotima. Ne gradi F5 dok ne shvatiš zašto. |
| Posle F8 | 25 beta korisnika, 30 dana | Metrika: koliko se **vratilo drugi put**. Ne koliko se registrovalo. |
| Bilo kad | Faza traje 2× duže od procene | Nije razlog za paniku. Jeste razlog da preskočiš sledeću opcionu fazu. |

**Odluka o naplati** donosi se posle 30 dana bete, po jednom pitanju postavljenom svakom korisniku: *„Koliko bi mesečno platio za ovo?"* Ako medijana padne ispod 1.500 RSD, alat je interni alat i to je legitiman ishod.

---

## 8. Šta ne radiš

- Ne pišeš Stripe ni Lemon Squeezy integraciju — interfejs da, implementaciju ne
- Ne radiš region — ali `country_code` u šemi od F1
- Ne radiš Radar, notifikacije, PDF izveštaj
- Ne pišeš testove za sve — samo za `ugly-score` i `spend_credit_and_unlock`
- Ne redizajniraš CLI
- Ne registruješ stranu firmu, ne prijavljuješ žig, ne zoveš advokata
- Ne prekidaš outreach ni jedne nedelje

Poslednja stavka je jedina koja je zaista nepregovarljiva.
