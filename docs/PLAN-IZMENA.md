# Plan izmena — redosled i prioriteti

> Ovaj plan prati `docs/REVIZIJA.md` (spisak nalaza). Faze su poređane po
> odnosu uticaj/trošak i po zavisnostima — svaka faza ostavlja sistem u
> ispravnom stanju, pa se može prekinuti posle bilo koje.
>
> Reference tipa „K1", „S3" su ID-jevi nalaza iz `docs/REVIZIJA.md`.
> Migracije se pišu kao numerisani fajlovi u `supabase/migrations/` (od 0016).

---

## Faza 0 — Worker: novac i pouzdanost (0,5–1 dan)

**Zašto prva:** ovo su jedini nalazi koji mogu da koštaju stvarno (dupli
Places/Playwright pozivi, refund uspešnog scana, izgubljeni pokušaji) ili da
zaustave sistem (zauvek blokiran slot).

| # | Šta | Gde | Provera |
|---|---|---|---|
| 0.1 | `retryAfter` u oba `BudgetError` mesta (pre-flight i 429) — scan se odlaže do reset kvote umesto da padne | `api-budget.ts:262-289`, `places.ts:148-157` | scan kad je dnevni budžet 0 → posao `pending` sa `run_after` sutra, ne `failed` |
| 0.2 | `complete_job`/`fail_job` sa `where status='running'` + `completeJob` izvan try-ja | `0003` (migracija 0016), `index.ts:76-78` | simuliran pad mreže posle uspeha → posao ostaje `done`, nema refund |
| 0.3 | Timeout na sve Supabase pozive workera | `apps/worker/src/lib/supabase.ts` | RPC koji visi 30 s+ → greška, posao ide na retry |
| 0.4 | `maxRetries: 0` na Anthropic klijentu (retry već radi red poslova) | `rewrite-message.ts:216` | dva uzastopna pada → tačno 2 plaćena poziva, ne 6 |
| 0.5 | `unhandledRejection`/`uncaughtException` handler | `index.ts` | proces ne umire usred posla |
| 0.6 | `upsertBusinesses`: odluka o više niša po biznisu (konfliktni ključ ili dokumentovano prihvatanje) | `db-writes.ts:50-78` + migracija | biznis u dve niše ostaje u obe (ili je odluka zapisana u SESIJE) |

**Gotovo kad:** `pnpm typecheck`, `pnpm check:sql`, `pnpm test` prolaze; sve
provere iz tabele ručno proverene na mock podacima (nijedan nov Places poziv).

---

## Faza 1 — Bezbednost: zatvaranje P1 liste (0,5–1 dan)

| # | Šta | Gde | Provera |
|---|---|---|---|
| 1.1 | Bezbednosni headeri: CSP, HSTS, `X-Frame-Options`, `Referrer-Policy` | `next.config.ts` (`headers()`) | `curl -I` pokazuje headere; CSP ne lomi app (test u obe teme) |
| 1.2 | IP rate limit na novčane rute (`/api/unlock`, `/api/search`, `/api/feedback*`) | nova tabela ili Upstash | 100 zahteva iz jedne IP za minut → 429; legitimni rad netaknut |
| 1.3 | `webhook_events(provider, event_id)` — insert pre obrade | migracija 0016 + `webhooks/clerk/route.ts` | dupla isporuka istog event-a → drugi put preskočena |
| 1.4 | Env: `CLERK_SECRET_KEY` format + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` u šemi | `lib/env.ts:11-16` | pogrešan ključ pada odmah sa jasnom porukom |
| 1.5 | `kind`/`source` za utiske van pitanja izvoditi na serveru (bez lažnog `incident`/`bug`) | `api/feedback/route.ts`, `feedback-schema.ts` | POST sa `{rating:3, kind:"bug", source:"incident"}` bez prompt_key → 400 ili neutralan zapis |
| 1.6 | Dnevni plafon utisaka i `dopuniUtisak` u RPC sa `for update` | `lib/feedback.ts`, migracija | dva paralelna POST-a → najviše jedan preko plafona |

**Gotovo kad:** P1 lista iz `docs/bezbednost-i-zastita.md` nema otvorenih
stavki osim backup-a (Faza 6) i kanarinaca/deljenja naloga (ROADMAP).

---

## Faza 2 — Ispravnost: uvoz, pretraga, web bugovi (1–2 dana)

| # | Šta | Gde | Provera |
|---|---|---|---|
| 2.1 | CSV uvoz: batch RPC (petlja u SQL-u) ili paralelizovane grupe + `dedupeKey`/transakcija | `lib/uvoz.ts`, `api/uvoz/route.ts`, migracija | 2000 redova u < 60 s; retry ne duplira |
| 2.2 | `.in()` u grupama od ~100–200 | `search.ts`, `moja-lista.ts`, `krediti.ts`, `admin-korisnici.ts` | pretraga velikog grada vraća sve stranice bez tihog gubitka |
| 2.3 | `spend_credit_and_scan`/`enqueue_job`: `unique_violation` → re-select (`joined`) | migracija 0016 | dva paralelna prva scana → oba dobiju `joined`, nijedan 500 |
| 2.4 | `poruke/ai`: provera `payload.placeId === placeId` pre čitanja | `api/poruke/ai/route.ts:117-148` | korisnik ne može da dobije poruku drugog posla |
| 2.5 | Dedup insert `outreach_messages` | `api/poruke/route.ts` | dupli klik → jedan red |
| 2.6 | `job: { id: charge.jobId ?? 0 }` → internu grešku ako nema jobId | `api/search/route.ts:216` | nema pollovanja posla 0 |
| 2.7 | Posle naplate uvek `status: "queued"` i sa pao keš-read | `api/search/route.ts:197-225` | plaćen scan nikad ne vrati 500 |
| 2.8 | Seed: ne pregaziti sveže audite | `apps/cli/src/seed.ts` | ponovljen seed ne menja `audit_level > 1` |

**Gotovo kad:** svi W1–W7 i N1–N6 nalazi iz REVIZIJA zatvoreni ili svesno
odloženi uz zapis u `docs/SESIJE.md`.

---

## Faza 3 — Performanse (1–2 dana)

| # | Šta | Gde | Provera |
|---|---|---|---|
| 3.1 | `signedScreenshots: false` za CSV izvoz; lenjo potpisivanje za `/lista` | `lib/moja-lista.ts`, `lib/export.ts` | izvoz 2000 redova bez ijednog Storage poziva |
| 3.2 | Worker upisuje `found/analyzed` na red posla → polling je jedan upit | migracija 0016 + `jobs/scan.ts` + `lib/jobs.ts` | `/api/job/:id` = 1 upit; polling s backoffom (3 s → 10 s) |
| 3.3 | `search_cache` brojači umesto pogleda (ili materijalizacija) | migracija 0016 + `record_scan` + upis audita | `/api/search` bez pune agregacije |
| 3.4 | Pretraga: filter/sort u SQL-u (pogled `search_listing` sa denormalizovanim `site_status`/`ugly_score`) ili keš stranice 30 s | migracija + `lib/search.ts` | veliki grad se strona brže; `FETCH_CAP` može da padne na 600 |
| 3.5 | Indeksi: `credit_ledger (user_id, created_at desc)`, `admin_audit (actor_id, created_at desc)`, `businesses (city_slug)` | migracija 0016 | `EXPLAIN` na `/krediti`, tempo admina i uvoz |
| 3.6 | `Suspense` + skeletoni na stranama; feedback-engine čitanja van blokirajućeg puta layout-a | `(app)/layout.tsx`, stranice | prvi bajt stiže bez čekanja na feedback upite |

**Gotovo kad:** polling jednog scana troši < 60 upita (danas ~180); izvoz i
pretraga ne potpisuju nepotrebno; `EXPLAIN` na glavnim upitima bez seq scan-a.

---

## Faza 4 — UX (2–3 dana)

| # | Šta | Gde | Provera |
|---|---|---|---|
| 4.1 | „Premesti u…" u kanban kartici (touch/tastatura rezerva) | `pipeline-tabla.tsx` | status se menja bez miša |
| 4.2 | Sinhronizacija `redovi` sa `kartice` propom | `pipeline-tabla.tsx:53` | uvezeni prospekti se pojave odmah |
| 4.3 | Stanje pretrage u URL-u (`?grad=&nisa=&bezSajta=1&strana=`) + Back | `pretraga-ekran.tsx` | link se deli i vraća isti rezultat |
| 4.4 | Reset `poslednji`/`data` pri promeni comboboxa | `pretraga-ekran.tsx:152` | forma i rezultati se ne razdesinhronizuju |
| 4.5 | Polling timeout → `osveziKes()` + dugme „Proveri ponovo" | `pretraga-ekran.tsx:420` | traka cene odražava stvarnost; povratak na rezultat bez nove pretrage |
| 4.6 | Poruka o otključavanju uz tabelu (ili `scrollIntoView`) | `pretraga-ekran.tsx:682` | neuspeh se vidi tamo gde se desio |
| 4.7 | Onboarding „Prvi koraci" na dashboard (dok nema unlocka) | `dashboard/page.tsx` | nov korisnik zna prva tri koraka |
| 4.8 | A11y: `role="alert"` na danger, `aria-activedescendant` u comboboxu, `aria-expanded` na kes-listi, roving tabindex na temi | `ui/alert.tsx`, `combobox.tsx`, `kes-lista.tsx`, `prekidac-teme.tsx` | čitač ekrana najavljuje greške i izbor |
| 4.9 | Beleška u kanbanu: `Esc` otkazuje | `pipeline-tabla.tsx:355` | slučajan blur ne upisuje |
| 4.10 | „Snimak se pravi" ≠ „nije dostupan" | `snimak.tsx:146` | nema ćorsokaka |
| 4.11 | Polling pauza na skriveni tab | `pretraga-ekran.tsx`, `poruke-panel.tsx` | skriven tab ne troši zahteve |

**Gotovo kad:** sve stavke iz §7 REVIZIJA zatvorene; obe teme i telefon
(≤ 390 px) vizuelno provereni.

---

## Faza 5 — Dizajn sistem (0,5–1 dan)

| # | Šta | Gde |
|---|---|---|
| 5.1 | `shadow-accent` samo na primarnom dugmetu | `pretraga-ekran.tsx:1021`, `lead-tabela.tsx:116`, `moja-lista-ekran.tsx:162` |
| 5.2 | Jedno primarno „Kopiraj" po dijalogu | `poruke-panel.tsx:422-441` |
| 5.3 | `.num` na datumima i URL-ovima | `krediti`, `moja-lista-ekran`, `pipeline-tabla`, `lead-tabela`, `snimak` |
| 5.4 | `text-accent-text` umesto `text-accent` na ikonicama | `snimak.tsx:308`, `poruke-panel.tsx:430` |
| 5.5 | `StatKartica` opciona `num` | `ui/stat.tsx`, `dashboard` |
| 5.6 | Kes-lista bez ugnježđenog okvira | `kes-lista.tsx:203` |
| 5.7 | Dokumentovati radijus odstupanje u CLAUDE.md | `CLAUDE.md` + `globals.css` |

**Gotovo kad:** dizajn sistem bez odstupanja (osim dokumentovanih); grep
provera nema hex u JSX-u.

---

## Faza 6 — Baza, zadržavanje, operativna higijena (1 dan)

| # | Šta | Gde |
|---|---|---|
| 6.1 | Odluka o per-redu TTL-u (B1) + primera (filter ili oznaka) | `lib/search.ts`, `moja-lista.ts`, `poruke.ts` + SESIJE zapis |
| 6.2 | Prekid kaskade `website_audits`/`signed_events` od `businesses` (`restrict`) | migracija 0016 |
| 6.3 | Nedeljni cron čišćenja: `job_queue` > 30 dana, `searches` > 90 dana, `api_budget` > 3 meseca | novi `/api/cron/cistka` (ili u worker) + `vercel.json` |
| 6.4 | `partial` zastavica u `search_cache` | migracija 0016 + `scan.ts` + UI oznaka |
| 6.5 | CHECK-ovi: rating ≤ 5, http_status 100–599, `signed_events.country_code` | migracija 0016 |
| 6.6 | Tipovi: `JobQueueRow.dedupe_key`, `JobSubscriberRow` | `packages/shared/src/db.ts` |
| 6.7 | `validate-migrations.ts`: RLS lista + `lead_status`/`outreach_messages`/`signed_events` | `scripts/validate-migrations.ts` |
| 6.8 | `pg_dump` backup skripta (cron na Hetzneru, 7 dana, offsite) | `scripts/` + komentar u `docker-compose.yml` |
| 6.9 | `npm audit --prod` u CI + Dependabot | `.github/workflows/ci.yml` + `.github/dependabot.yml` |

**Gotovo kad:** `pnpm check:sql` prolazi sa novim migracijama; backup skripta
isprobana; CI ima audit korak.

---

## Faza 7 — Testovi i kvalitet (1 dan)

| # | Šta |
|---|---|
| 7.1 | Test za trke: `spend_credit_and_scan` (dupli prvi scan), `admin_adjust_credits` (idempotencija), `enqueue_job` (unique_violation) — kroz `scripts/validate-migrations.ts` ili PGlite testove |
| 7.2 | Test za `ideOdmah` granu (bug/ocena 1/incident) posle izmene 1.5 |
| 7.3 | ESLint + `eslint-config-next` (flat) u CI |
| 7.4 | CI garancija da ugly-score ne uđe u bundle (grep nad `.next/static`) |
| 7.5 | `apps/web/.clerk/` u `.gitignore` |

**Gotovo kad:** `pnpm test` pokriva novčane trke; `pnpm lint` prolazi; CI
dokazuje da težine nisu u bundle-u.

---

## Pregled po fazama

| Faza | Sadržaj | Procena | Rizik ako se preskoči |
|---|---|---|---|
| 0 | Worker: novac i pouzdanost | 0,5–1 dan | dupli pozivi, refund uspešnog scana, zaglavljeni slot |
| 1 | Bezbednost: P1 lista | 0,5–1 dan | spam vektor, CSP otvoren, webhook duplikacija |
| 2 | Ispravnost: uvoz, pretraga, web | 1–2 dana | uvoz uvek istekne, tiho izgubljeni rezultati |
| 3 | Performanse | 1–2 dana | sporost na rastu baze |
| 4 | UX | 2–3 dana | beta korisnik staje na touch kanbanu, Back bez rezultata |
| 5 | Dizajn sistem | 0,5–1 dan | vizuelna nedoslednost |
| 6 | Baza, zadržavanje, higijena | 1 dan | rast bez granice, gubitak IP pri brisanju, nema backup-a |
| 7 | Testovi i kvalitet | 1 dan | regresije u novcu bez mreže |

**Ukupno: 7–12 dana rada**, faze nezavisne — može se raditi jedna po sesija po
obrascu iz `docs/SESIJE.md`.
