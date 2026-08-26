# Revizija — stanje projekta i spisak izmena

> Datum revizije: avgust 2026. Pregledano je celo stablo — `apps/web`, `apps/worker`,
> `apps/cli`, `packages/shared`, `supabase/migrations` (0001–0015), `scripts`,
> deploy (Docker, docker-compose, Vercel, CI) i dokumentacija. Zaključci su izvedeni
> čitanjem koda; vizuelna provera ekrana i funkcionalni testovi na pravim podacima
> ostaju na autoru (ista lista kao u `docs/SESIJE.md`).
>
> Ovaj fajl je **spisak nalaza**. Redosled izvođenja i prioriteti su u
> `docs/PLAN-IZMENA.md`, a kasniji razvoj proizvoda u `docs/ROADMAP.md`.

---

## 1. Ukupna ocena

Projekat je u zavidnom stanju za fazu u kojoj je. Bezbednosna disciplina je
iznad proseka sličnih solo projekata: krediti se menjaju isključivo kroz RPC
funkcije sa `for update`, zaključana polja **ne postoje** u JSON odgovoru
(diskriminisana unija, ne `null`), SSRF kapija je allowlist umesto blockliste,
Playwright je izolovan na nivou kontejnera, a budžet za Google pozive se broji
u bazi pre svakog HTTP zahteva. Arhitektura (Postgres red umesto Redis-a) je
dosledno sprovedena. Pravila 8, 9, 10, 13, 14 i 16 iz CLAUDE.md su stvarno
sprovedena u kodu, ne samo napisana.

Glavni nalazi revizije **nisu** bezbednosne rupe nego:

1. **Operativna higijena koja još nije stigla** — IP rate limit, bezbednosni
   headeri, backup, pravni tekstovi, monitoring (P0/P1 lista iz
   `docs/bezbednost-i-zastita.md` ima otvorenih stavki).
2. **Nekoliko stvarnih bugova u worker/feedback sloju** — najvažniji:
   `BudgetError` bez `retryAfter` na pre-flight odbijanju budžeta, zbog čega
   scan umesto odlaganja na reset kvote izgubi sva tri pokušaja (K1 u 5.1);
   `complete_job` bez statusne zaštite, zbog čega mrežna greška može da ponovi
   gotov posao i refunduje uspešan scan (V1 u 5.2).
3. **Rast podataka bez politike zadržavanja** — `searches`, `job_queue` i
   `credit_ledger` rastu bez ijednog čišćenja.
4. **Sitne UX neravnine** — bez kojih proizvod radi, ali koje bi beta korisnik
   primetio prvog dana (najvažnije: kanban bez rezerve za touch/tastaturu i
   stanje pretrage van URL-a).
5. **Performansne tačke** koje su danas bezazlene, a postaće problem čim baza
   poraste (pretraga od 1200 redova po zahtevu, 3 upita po pollingu posla,
   puna agregacija na svaki `/api/search`).

---

## 2. Šta je već dobro — ne dirati

Da se ne troši vreme na ono što već radi kako treba:

- **Kreditna mašinerija** (`spend_credit_and_unlock`, `spend_credit_and_scan`,
  `grant_credits`, `grant_feedback_credits`, `admin_adjust_credits`) — sve u
  jednoj SQL transakciji sa `for update`, idempotentno, sa tragom u
  `credit_ledger`. Pravilo 3 se poštuje svuda.
- **SSRF zaštita** (`apps/worker/src/lib/safe-url.ts`) — allowlist unicast,
  sve adrese iz DNS-a, ručno praćenje redirekcija sa proverom svakog hopa.
  Bolje od većine produkcijskih sistema.
- **Playwright izolacija** (`screenshot.ts` + `docker-compose.yml`) — non-root
  (1001), read-only fs, `cap_drop: ALL`, tmpfs, `init: true`, restart browsera
  na 50 sajtova, `pids_limit`. Odstupanja od PRD-a imaju obrazloženje.
- **Budžet** (`api-budget.ts`, migracija 0002) — `consume()` pre svakog HTTP
  poziva, `markExhausted()` na 429, `assertAvailable()` pre-flight, LA dan u
  bazi, `consume_side_call` odbija `places:%` ključeve. Nije nađen nijedan put
  koji troši Google kvotu bez brojača.
- **RLS + `toPublicLead`** — zaključana polja fizički ne postoje u odgovoru;
  `businesses`/`website_audits`/`search_cache`/`feedback` su `using (false)` +
  `force`.
- **Red poslova** (0003) — `for update skip locked`, backoff 2^n, žetva
  zaglavljenih, `defer_job` za budžet (kad retryAfter postoji), povraćaj
  kredita za pao scan.
- **Robots.txt i throttle** (`robots.ts`) — identifikujući UA, 1 zahtev/s po
  domenu, `Crawl-delay` poštovan, parser dovoljan za stvarni svet.
- **UX mikro-detalji** — deklinacija (`plural`), `.num` na većini brojeva,
  `foldForSearch` za dijakritiku, `lang="sr-Latn-RS"`, focus trap, fokus prsten,
  `prefers-reduced-motion`, obe teme kroz tokene.
- **CI** — typecheck, testovi, `check:sql`, build, `check:secrets`, gitleaks;
  build sa lažnim tajnama i svesno objašnjen.
- **Translit, CSV, feedback-katalog/motor, sklonidba** — usklađeni, testirani,
  bez duplikacije logike (Ugly Score je jedini izvor istine — provereno grep-om).

---

## 3. Bezbednost

### 3.1 P0 lista iz `docs/bezbednost-i-zastita.md`

| Stavka | Status | Napomena |
|---|---|---|
| `spend_credit_and_unlock` sa `FOR UPDATE` | ✅ urađeno | |
| `user_id` iz sesije na svim rutama | ✅ urađeno | Provereno na svakoj ruti |
| Dnevni limit cache-miss pretraga | ✅ urađeno | |
| Globalni cap API poziva + Google quota | ✅ urađeno | |
| Server-side striping zaključanih polja | ✅ urađeno | Unija bez ključeva, ne `null` |
| Privatan Storage bucket + potpisani URL-ovi | ✅ urađeno | 15 min, grupno |
| RLS na svim tabelama | ✅ urađeno | |
| CI grep za `service_role` | ✅ urađeno | `scripts/check-secrets.sh` |
| Playwright izolacija | ✅ urađeno | |
| `resolveSafeUrl` sa blokiranim opsezima | ✅ urađeno | |
| Google ključ: IP + API restrikcija + quota | ⚠️ neproverljivo iz koda | Konzola Google Cloud-a |
| Zod allowlist za grad i nišu | ✅ urađeno | |
| **Uslovi korišćenja i politika privatnosti** | ❌ **nije urađeno** | Nema stranica ni linkova |

### 3.2 P1 lista

| Stavka | Status | Napomena |
|---|---|---|
| Rate limit po IP-u | ❌ nije urađeno | S1 u 3.3 |
| Webhook idempotencija | ⚠️ drugačije rešeno | Nema `webhook_events`, ali je `create_profile_with_grant` idempotentan preko `ref_id = signup:<user>`; rizik je samo za buduće handlere (S2 u 3.3) |
| Bezbednosni headeri | ❌ nije urađeno | S3 u 3.3 |
| `pg_dump` cron backup | ❌ nepoznato | Nema skripte u repou |
| Dependabot / Renovate + `npm audit` u CI | ❌ nije urađeno | CI nema audit korak |
| Kanarinci u bazi | ❌ nije urađeno | F8 |
| Detekcija deljenja naloga | ❌ nije urađeno | posle bete |
| ZZPL: procedura brisanja na zahtev | ⚠️ delimično | Kaskada postoji, javne procedure nema |

### 3.3 Nalazi iz koda

| # | Težina | Mesto | Nalaz | Popravka |
|---|---|---|---|---|
| S1 | Važno | sve `POST` rute (`/api/unlock`, `/api/search`, `/api/feedback`, `/api/feedback/slika`, …) | **Nema rate limita po IP-u** — jedina brana su per-korisnički limiti kredita. Skript sa 50 naloga može da gađa rute bez ijedne IP kočnice (P1 stavka iz dokumenta, potpuno odsutna). | IP ključevan brojač (Upstash ili tabela `request_log` po `ipZahteva()` + ruti) na novčanim rutama; dovoljan je fiksni prozor u Supabase-u na ovoj skali. |
| S2 | Srednje | `apps/web/src/app/api/webhooks/clerk/route.ts` | Idempotencija webhook-a počiva na `ref_id = signup:<user>`. Tačno za današnja dva handlera; **svaki budući neidempotentan handler je duplikacija pri Svix retry-ju**. | Dodati `webhook_events(provider, event_id)` PK tabelu sada, dok je handlera malo (insert pre obrade, na konflikt preskoči). |
| S3 | Srednje | `apps/web/next.config.ts` | **Nema bezbednosnih headera** — CSP, HSTS, `X-Frame-Options`, `Referrer-Policy` („20 minuta rada" iz P1 liste). | `async headers()` u `next.config.ts`. |
| S4 | Nisko | `apps/web/src/lib/env.ts:15` | `CLERK_SECRET_KEY` validiran samo `min(1)`; `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk traži pri radu) nije u šemi — tipfeler padne kasnije sa nerazumljivom Clerk greškom. | Validirati format `sk_`/dužinu i dodati publishable ključ u šemu (javan je, bezbedan je u `serverEnv`). |
| S5 | Nisko | `apps/web/src/lib/admin-radnje.ts` (tempo) | Tempo limiti (120/h) su count-then-execute, ne rezervacije: dva paralelna admin zahteva mogu oba da prođu proveru. | Atomski upis reda u dnevnik sa uslovom (unique guard) umesto brojanja, ili kratka brava. |
| S6 | Nisko | `apps/web/src/lib/slika.ts:304-318` | Dnevna kvota slika broji `list` sa `limit: 100` — preko 100 fajlova u 24 h potcenjuje broj. | Paginirano brojanje ili brojač iz tabele. |

**Prošlo provere (potvrđeno):** pravilo 8 — identitet svuda iz sesije, `unlockBodySchema`
namerno ne-strict ignorira lažan `userId`; pravilo 9 — `toPublicLead` jedina kapija,
zaključan lead nema ključeve u JSON-u, CSV izvoz ide kroz `getMojaLista()` (samo
otključani); pravilo 13 — svaka admin strana i ruta proverava sa praznim `404`;
pravilo 14 — svaka admin mutacija ima trag i na pad, `payload` se čisti; pravilo 16 —
`proveriOdgovor()` jedina kapija za `answers`, nepoznat ključ → 400, `do:` rok
poštovan i u ruti (410); `mojaPutanja()` blokira path traversal na jedinom polju
koje putuje kroz pregledač.

---

## 4. Novac i krediti

| # | Težina | Mesto | Nalaz | Popravka |
|---|---|---|---|---|
| N1 | Srednje | `supabase/migrations/0009` — `spend_credit_and_scan` + `enqueue_job` (0003) | **Trka na prvom scanu iste kombinacije:** dva korisnika istovremeno prođu prazan `select … for update`, oba zovu `enqueue_job`, drugi `insert` udara u `job_queue_dedupe_live_idx` → `unique_violation` → 500 umesto `joined`. Samoizlečivo (retry radi), ali ružan ishod na normalnoj radnji. | U `enqueue_job` uhvatiti `unique_violation` i ponoviti `select … for update` (ili `on conflict` + re-select). |
| N2 | Srednje | `apps/web/src/app/api/feedback/route.ts` + `feedback-schema.ts` | **`kind` i `source` se za utiske van pitanja primaju iz tela** (`tip = prijava?.kind ?? kind`, `source` iz šeme koja dozvoljava `"incident"`). `ideOdmah()` = `kind==='bug' || rating===1 || source==='incident'` → prijavljen korisnik može `{rating:3, kind:"bug", source:"incident"}` da izazove **instant mejl** (do dnevnog limita) i da zagadi metriku „otvoreni bugovi". | Za utiske bez `prompt_key` forsirati `source ∈ {dugme, podsetnik}` i `kind ∈ {ideja, pohvala, drugo}` na serveru; `incident`/`bug` samo iz kataloga. |
| N3 | Srednje | `apps/web/src/lib/feedback.ts:150-163` | **Dnevni plafon utisaka (50/24h) nije atomičan** — dva paralelna POST-a mogu oba da vide `dosad < 50` i oba upišu. | Plafon unutar istog RPC-a koji upisuje, sa `for update` nad profilom. |
| N4 | Srednje | `apps/web/src/lib/feedback.ts:239-270` | **`dopuniUtisak` radi read → merge → write bez transakcije** — dva paralelna PATCH-a na istom zapisu mogu da izgube jedan skup odgovora. | Jedan RPC: `select … for update` nad feedback redom, merge, validacija, update. |
| N5 | Srednje | `apps/worker/src/lib/db-writes.ts:50-78` | **`upsertBusinesses` pregazi `city_slug`/`niche_slug`.** `place_id` je PK, pa biznis u dve niše ima jedan red koji poslednji scan prepiše — biznis **nestaje iz prve niše**. (Poznato i pomenuto u 0009, ali nigde rešeno.) | Odluka: ili `(place_id, country_code, city_slug, niche_slug)` kao konfliktni ključ (biznis u više niša), ili svesno prihvatiti „poslednja niša pobeđuje" i dokumentovati. |
| N6 | Nisko | `apps/web/src/app/api/search/route.ts:216` | `job: { id: charge.jobId ?? 0 }` — ako RPC ikad vrati `ok` sa `null` job_id, klijent polluje posao 0 zauvek. | `ok && !jobId` tretirati kao internu grešku (500), ne fabrikovati ID 0. |

**Prošlo provere:** dupli klik na unlock → `already_unlocked`, na scan → `already_paid`,
dodele → `ref_id`; povraćaj scana idempotentan (`refund_scan`, parcijalni unique indeks);
nijedan direktan `UPDATE profiles.credits_balance` ne postoji.

---

## 5. Ispravnost (bugovi)

### 5.1 Worker — kritično

| # | Mesto | Nalaz | Popravka |
|---|---|---|---|
| K1 | `apps/worker/src/lib/api-budget.ts:262-289` + `places.ts:148-157` + `index.ts:85` | **`BudgetError` bez `retryAfter` na pre-flight odbijanju i na 429.** Grana `defer_job` u `index.ts` traži `err.retryAfter`, a `assertAvailable()` i 429 handler ga ne postavljaju. Posledica: kad je budžet iscrpljen, scan umesto odlaganja na reset kvote (sutra / prvi u mesecu) **izgubi sva tri pokušaja za ~14 min** (backoff 2+4+8), padne i kredit se refunduje — suprotno F3 §3 („budžet nije greška nego čekanje"). | Postaviti `retryAfter` (reset dana/meseca) u oba `BudgetError` mesta. |

### 5.2 Worker — važno

| # | Mesto | Nalaz | Popravka |
|---|---|---|---|
| V1 | `apps/worker/src/index.ts:76-78` + `queue.ts` + `0003: complete_job/fail_job` | **`complete_job` nema statusnu zaštitu** (`update … where id = p_id` bez `status='running'`), a `completeJob` je u istom `try`-ju kao handler. Mrežna greška posle uspešnog rada → `failJob` → posao se ponavlja (novi Places/Playwright pozivi) ili padne i **refunduje uspešan scan**. | `complete_job` sa `where status='running'` i idempotentan; `completeJob` izvući iz `try`-ja (ili hvatati samo greške koje nisu „posao gotov"). |
| V2 | svi Supabase RPC pozivi u workeru | **Nema timeouta na ijedan RPC poziv** — mrtav Supabase može zauvek da blokira slot; reaper tada duplira posao (dupla kvota/novac). | Timeout na Supabase klijent (`fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(...) })`) ili per-poziv. |
| V3 | `apps/cli/src/index.ts` (`--duboko`) | **CLI deep scan bez tvrdog capa na broj upita** — worker ima `SCAN_MAX_QUERIES=5`, CLI nema granicu → jedan `--duboko` može da pojede ceo dnevni budžet. | Isti cap kao worker (ili bar `assertAvailable` pre svakog upita — proveriti da li CLI zove `consume`). |
| V4 | `apps/cli/src/harvest-emails.ts` | **Krši pravilo 12 i P0-6:** harvest ide na proizvoljne sajtove bez robots.txt, bez identifikujućeg UA (proveriti), bez throttle-a i **bez SSRF provere** — CSV sa `http://169.254.169.254/` bi se povukao sa mašine. | Proveriti da li skripta koristi `mayCrawl`/`safe-url`; ako ne — uvesti ih (isti moduli iz workera). |
| V5 | `apps/worker/src/jobs/rewrite-message.ts:216-219` | **Anthropic klijent bez `maxRetries`** × 3 pokušaja posla = do 9 plaćenih poziva po jednom `consume_side_call`. | `maxRetries: 0` (retry već radi red poslova) ili brojati svaki poziv. |
| V6 | `apps/worker/src/lib/ai-audit.ts` | **`enrich_full` ne prosleđuje `business.name` u `analyzeScreenshots`** — provera „ne izgovaraj ime firme" je mrtav kod u produkciji. | Proslediti `name` u poziv. |
| V7 | `apps/worker/src/index.ts` | **Nema `unhandledRejection`/`uncaughtException` handlera** — neuhvaćena greška u jednom slotu može da ubije proces (Docker ga restartuje, ali usred posla). | Handler koji loguje i nastavlja (ili uredno gasi). |

### 5.3 Worker — srednje i nisko

- **Seed pregazi sveže `audit_level=1` audite** (`apps/cli/src/seed.ts`) — proveriti da li seed piše samo tamo gde audit ne postoji.
- **Siročad na delimičnom screenshot uploadu** — ako prvi upload prođe a drugi padne, fajl ostaje; čišćenje ne postoji (ali ni `enrich_full` ne briše stari snimak na padu — proveriti redosled `removeScreenshots`).
- **`stop_grace_period` 10 s < trajanje posla** (compose podrazumevano) — SIGTERM stiže, worker uredno ne uzima nov posao, ali tekući `enrich_full` (2–3 min) se SIGKILL-uje; vredi podići na ~180 s.
- **DNS pinning nije implementiran** — `safe-url.ts` vraća `.ip` ali ga `followSafely`/Playwright ne koriste (fetch ide na hostname, pa je teorijski moguć DNS rebinding između provere i konekcije). Rizik nizak (URL-ovi iz Googlea), ali dokumentovati ili iskoristiti `ip` sa `Host` headerom.
- **Hopovi `followSafely` i `robots.txt` fetch idu van throttle-a** — pravilo 12 (1 zahtev/s po domenu) važi za glavni fetch, ali redirect hop i robots.txt ga ne poštuju (robots.ts ima svoj `MIN_DELAY_MS`? — proveriti da li se `throttle` zove i tamo).
- **WAF fallback koristi `UA_PLAIN` bez Sajtoskop tokena** (`fetch-site.ts:192`) — svesno odstupanje od „identifikujućeg UA" (pravilo 12), dokumentovano u kodu; vredi ostaviti ali znati.
- **Mejl u logu (PII)** — proveriti da li `feedback-mail.ts`/`admin-mail.ts` loguju adrese pri grešci; ZZPL traži da se pun kontakt ne loguje. Isto važi za `enrich-basic.ts:102` gde mejl ulazi u `note` posla (PII u stdout).
- **Monthly grant ne pokriva korisnike registrovane usred meseca** — dobijaju kredite tek prvog sledećeg meseca. Namerno ili propust? (F4 §2 verovatno namerno — ali vredi potvrditi.)
- **`query_text` iz prvog upita u deep režimu** — deep cepa grad na opštine, a `query_text` čuva samo prvi upit; kozmetika.
- **Healthcheck `node -e "process.exit(0)"`** ne proverava ništa osim da proces živi — sasvim dovoljno za sada, ali ne otkriva zaglavljeni worker (zato je reaper bitan).
- **Polling 2 s na Supabase free tier** — proveriti `WORKER_IDLE_MS`/Supabase rate; 2 s na besplatnom planu može da udari u limits pri većem broju poslova.
- **`--upit`/`--lang` u CLI bez granica** — sitno.

### 5.4 Web — ispravnost

| # | Težina | Mesto | Nalaz | Popravka |
|---|---|---|---|---|
| W1 | Srednje | `apps/web/src/lib/uvoz.ts:221-288` + `api/uvoz/route.ts:24` | **CSV uvoz radi sekvencijalne RPC-ove po redu** (`unlockLead`, `set_lead_status`, …) — do 4000+ rundi za 2000 redova, u prozoru od 60 s (Hobby). Veliki uvoz **uvek istekne na pola**, ostavljajući delimičan, neprijavljen rezultat. | Batch u jedan `security definer` RPC (petlja u SQL-u) ili paralelizacija u grupama od 20–50 sa kumulativnom proverom budžeta; parcijalan izveštaj na timeout. |
| W2 | Srednje | `apps/web/src/app/api/uvoz/route.ts` | **Nema idempotencije ni resume-a** — retry posle delimičnog timeouta ponovo otključava preostale redove (svaki unlock je nova potrošnja) → dupli uvoz. | Uvoz kao `job_queue` posao sa per-korisničkim `dedupeKey`, ili ceo uvoz u jednoj transakciji (sve ili ništa). |
| W3 | Srednje | `apps/web/src/lib/search.ts:130-134`, `moja-lista.ts:65-82`, `krediti.ts:66-70`, `admin-korisnici.ts:258-266` | **`.in()` sa 1200/2000/200 vrednosti** — PostgREST serijalizuje u jedan URL od 30–50 KB koji gateway može da odbije/okrpi, tiho gubeći rezultate. | Deliti `.in()` na grupe od ~100–200 i spajati (kao što `slika.ts:251-268` već radi). |
| W4 | Nisko | `apps/web/src/app/api/poruke/ai/route.ts:117-148` | GET proverava pretplatu na posao, ali **ne i da posao pripada traženom `placeId`/kanalu** — korisnik sa dva rewrite posla može da dobije poruku drugog (`.gte(created_at)` pokupi kasniji red). | Porediti `job.payload.placeId === placeId` (i kanal) pre čitanja poruka. |
| W5 | Nisko | `apps/web/src/app/api/poruke/route.ts:143-157` | **Dupli klik na „Kopiraj" upisuje duple redove u `outreach_messages`** (`mark_contacted` je idempotentan, arhivski insert nije). | Dedup insert (unique ključ `(user_id, place_id, channel, body)`) ili in-flight guard. |
| W6 | Nisko | `apps/web/vercel.json:7,11` | Cron `0 19 * * *` je 21:00 po Beogradu **samo leti**; zimi je 20:00 (isto za nedeljni izveštaj). Komentari u rutama tvrde 21:00/09:00. | Pomeriti na `0 20 * * *`/`0 8 * * 1` ili popraviti komentare. |
| W7 | Nisko | `apps/web/src/app/api/search/route.ts:197-225` | Ako `searchCachedLeads` baci **posle** uspešne naplate, korisnik dobija 500 iako je platio (samoizlečivo kroz `zivPlacenPosao`, ali UX je pogrešan). | Posle naplate uvek vratiti `status: "queued"` sa job id, čak i ako keš-read padne. |

### 5.5 Web — interakcija (iz klijentskog pregleda)

| # | Težina | Mesto | Nalaz | Popravka |
|---|---|---|---|---|
| I1 | Važno | `apps/web/src/components/pipeline-tabla.tsx:53-96` | **`redovi` se inicijalizuje iz `kartice` propa jednom i nikad ne sinhronizuje.** Posle `PipelineUvoz` → `router.refresh()` komponenta ostaje montirana i **uvezeni prospekti se ne pojavljuju do punog reloada**. | `useEffect(() => setRedovi(kartice), [kartice])` (ili remount preko `key`). |
| I2 | Srednje | `apps/web/src/components/pretraga-ekran.tsx:152, 554-557` | **Promena grada/niše ne resetuje `poslednji`** — menjanje filtera ili strane pokreće pretragu po STAROJ kombinaciji dok forma prikazuje novu: forma i rezultati su vidljivo razdesinhronizovani (i traka cene). | Očistiti `poslednji`/`data` pri promeni comboboxa (ili izvoditi izvršenu pretragu iz stanja forme). |
| I3 | Srednje | `apps/web/src/components/pretraga-ekran.tsx` (ceo ekran) | **Stanje pretrage nije u URL-u** — Back vraća praznu formu, rezultati se gube, pretraga se ne može podeliti ni zabeležiti. | Ogledaliti grad/nišu/filtere/stranu u `useSearchParams` (i vratiti na mount). |
| I4 | Nisko | `apps/web/src/components/pipeline-tabla.tsx:219-230` | `onDragEnd` čisti `vucem` ali ne i `nadKolonom` — **oznaka kolone može da ostane zaglavljena** posle prevlačenja van table. | `setNadKolonom(null)` i u `zavrsiVucu`. |
| I5 | Nisko | `apps/web/src/components/moja-lista-ekran.tsx:108-116` | Posle uspešnog izvoza linija „izvezeno danas: X od Y" prikazuje **stari serverski broj** do refresha. | Podići broj lokalno iz `X-Sajtoskop-Rows` headera. |
| I6 | Nisko | `apps/web/src/components/pipeline-uvoz.tsx:94-99` | **File input se ne resetuje** — uvoz istog fajla dvaput ne pali `change` događaj. | `e.target.value = ""` posle čitanja. |
| I7 | Nisko | `apps/web/src/components/pretraga-ekran.tsx:362-368` | Kad polling naleti na 404/400, čekanje se završava bez objašnjenja i **bez `posao-pao` okidača** — korisnik ne zna zašto je „stalo". | Kratka poruka + feedback događaj i na ovom izlazu. |
| I8 | Nisko | `apps/web/src/components/pretraga-ekran.tsx:688` | Uspešan alert koristi `<a href="/lista">` — **pun reload umesto klijentske navigacije**. | `<Link href="/lista">`. |

---

## 6. Performanse

| # | Težina | Mesto | Nalaz | Popravka |
|---|---|---|---|---|
| P1 | Važno | `apps/web/src/lib/moja-lista.ts:90-92` + `lib/export.ts:76` | **Svaki render `/lista` I svaki CSV izvoz potpisuje SVE screenshotove** (do 2000 leadova × 2 putanje) u jednom `createSignedUrls` — a CSV screenshotove uopšte ne koristi. | `signedScreenshots: false` opcija u `getMojaLista()` za izvoz; za `/lista` razmotriti lenjo potpisivanje. |
| P2 | Srednje | `apps/web/src/lib/search.ts:85-145` | **Svaka pretraga povlači do 1200 biznisa + audite**, filtrira/sortira u JS, i ponavlja to na svakom pollingu (svake 3 s). `FETCH_CAP` odsecanje samo loguje. | Filter+sort u SQL-u (pogled/funkcija sa pravim LIMIT/OFFSET) ili keš izračunate stranice ~30 s. |
| P3 | Srednje | `apps/web/src/app/api/job/[id]/route.ts` → `lib/jobs.ts:286-370` | **Polling posla = 3 upita po krugu** (pretplata + posao + ponovno brojanje napretka); klijent polluje 3 s × 3 min → ~180 upita po scanu. | Worker da upisuje `found/analyzed` na red posla → `getJobForUser` je jedan upit; smanjiti učestalost (backoff do 10 s). |
| P4 | Srednje | `apps/web/src/app/(app)/layout.tsx:65-68` + sve stranice | **Ceo okvir (sidebar) čeka `citajStanjeMotora` + `citajUslove`**, a svaka stranica čeka DB pre ijednog bajta; **nema `Suspense` nigde** — spor DB = prazan ekran. | `Suspense` + skeletoni oko podataka strana; bar izbaciti feedback-engine čitanja iz blokirajućeg puta layout-a. |
| P5 | Srednje | `apps/web/src/components/pretraga-ekran.tsx:356-357`, `poruke-panel.tsx:323-324` | Polling nema backoff ni pauzu na skriveni tab (60 zahteva za scan, 37 za AI varijantu). | Preskočiti polling dok je `document.hidden`; backoff posle N krugova. |
| P6 | Srednje | `supabase/migrations/0009` — `search_cache_stats` | **Pogled agregira celu `businesses`+`website_audits` na svaki poziv**; ruta ga zove na svaki `/api/search` i na listu keša. Na 50k+ biznisa postaje pun scan po zahtevu. | Brojače (`total`, `no_site`) preneti u `search_cache` (dopunjavati u `record_scan` i pri upisu audita) ili materijalizovati pogled. |
| P7 | Nisko | `apps/web/src/lib/poruke.ts:60-80` | Tri sekvencijalna `await`-a (jeOtkljucan → business → audit); poslednja dva su nezavisna. | `Promise.all`. |
| P8 | Nisko | `apps/web/src/app/api/search/route.ts:75-221` | Serialni lanac na plaćenom putu (`stanjeKesa → zivPlacenPosao → profile → budzet+claim`). | `Promise.all` gde su nezavisni. |

---

## 7. UX i intuitivnost

### 7.1 Funkcionalne rupe

1. **Kanban je nepokretan bez miša** (`pipeline-tabla.tsx:303-389`) — native HTML5 DnD nema rezervu za touch ni tastaturu; na telefonu se status ne može promeniti (osim kopiranjem poruke). **Rezerva: „Premesti u…" dropdown sa 5 kolona u meniju kartice.** (Dokumentovano „kanban se gleda za stolom" — ali beta korisnik na telefonu je stvarni slučaj.)
2. **Poruka o neuspehu otključavanja stoji na vrhu strane** (`pretraga-ekran.tsx:682-690`) — pogled korisnika je na redu koji je kliknuo; posle pada može da je ne primeti. → prikaz uz tabelu ili `scrollIntoView`.
3. **Polling timeout ne osvežava registar keša** (`pretraga-ekran.tsx:420-426`) — traka cene i dalje piše „Nije u kešu — skeniranje košta 1 kredit" za kombinaciju koja je sada keširana; obećanje „rezultat će biti ovde kad se vratiš" važi tek posle ručnog reloada. → `osveziKes()` + finalni besplatni `trazi` na timeout putu. **Dodatno: nema dugmeta „Proveri ponovo"** — korisnik mora ponovo da klikne „Pretraži"; predlog je da `predugo` stanje dobije dugme koje ponovo poziva `pratiPosao` sa istim `jobId`.
4. **„Snimak se pravi" je ćorsokak** (`snimak.tsx:146-154`) — prikazuje se i kad je `enrich_full` trajno pao; korisnik može da osvežava zauvek. → razlikovati „još se pravi" od „nije dostupan" iz stanja leada.
5. **Beleška u kanbanu nema otkazivanje** (`pipeline-tabla.tsx:355-377`) — slučajan blur (klik pored) upisuje polovičan tekst; nema `Esc`. → Esc otkazuje, ili dugmad Sačuvaj/Odustani.
6. **`poruke-panel` pregazi korisnikov izbor kanala** (`poruke-panel.tsx:54-81`) — `setKanal(o.predlog)` se izvršava i posle korisnikovog klika dok se učitava. → primeniti `predlog` samo ako korisnik još nije interagovao.

### 7.2 Onboarding i sadržaj

- **Onboarding „Prvi koraci"** na dashboard (1. izaberi grad i nišu → 2. otključaj prvi prospekt → 3. napiši prvu poruku), prikazan dok korisnik nema nijedan unlock (F8 §2, jeftina preliminarna verzija).
- **Nema favicon-a, OG slike, `robots.txt` ni `sitemap.xml`** — `apps/web/public/` je prazan. `app/icon.png` + `opengraph-image` u Next 15 rešavaju favicon i OG bez `public/`.
- **Traka napretka ne pokazuje proteklo vreme** — broj koji raste je signal da posao živi (v. 7.1.3).

### 7.3 A11y (iz klijentskog pregleda)

1. **`Alert` hardkoduje `role="status"`** (`ui/alert.tsx:46`) — i `variant="danger"` se najavljuje „uljudno"; nema `aria-live` na rezultatima. → `role={danger ? "alert" : "status"}`.
2. **Combobox nema `aria-activedescendant`** (`combobox.tsx:98-118`) — čitač ekrana ne čuje koja je opcija označena; otvaranje takođe sakriva izabranu vrednost. → `id` na opcijama + `aria-activedescendant`; prikazati `selected.label` kad je query prazan.
3. **`kes-lista` sklopljeni red nema `aria-expanded`** (`kes-lista.tsx:87-102`).
4. **Prekidač teme je `radiogroup` bez roving tabindex-a** (`prekidac-teme.tsx:29-71`) — samo Tab, nema strelica.
5. **Kartica je `draggable` bez keyboard ekvivalenta** — isto kao 7.1.1.

---

## 8. Dizajn sistem

| # | Težina | Mesto | Nalaz | Popravka |
|---|---|---|---|---|
| D1 | Srednje | `krediti/page.tsx:121`, `moja-lista-ekran.tsx:327`, `pipeline-tabla.tsx:323` | **Datumi bez `.num`** (pravilo: „`.num` na … datum"). | `<span className="num">` oko `formatDatum(...)`. |
| D2 | Srednje | `lead-tabela.tsx:167-171`, `moja-lista-ekran.tsx:311-317`, `snimak.tsx:163-173` | **URL-ovi bez `.num`** (pravilo: „`.num` na … URL"). | Dodati `num` na link-klasu (uz `truncate`). |
| D3 | Srednje | `pretraga-ekran.tsx:1021`, `lead-tabela.tsx:116`, `moja-lista-ekran.tsx:162` | **`shadow-accent` van primarnog dugmeta** (pravilo: „jedno primarno dugme po ekranu"): aktivni filter čip, hover na Otključaj, toggle „Bez funkcionalnog sajta". | Skinuti `shadow-accent`; stanja kroz `border-accent`/`bg-accent-wash`. |
| D4 | Srednje | `poruke-panel.tsx:422-441` | **Do 3 primarna „Kopiraj" u jednom dijalogu** (šablon, follow-up, AI varijanta) — pravilo „jedno primarno dugme". | Primarno samo na glavnom bloku; outline za ostale. |
| D5 | Srednje | `globals.css:96-98, 215-219` | **Nedokumentovano odstupanje: preimenovani radijus tokeni** — `--r-sm/--r/--r-lg` umesto `--radius-*` iz §3.1, preslikano u `@theme inline`. Tablica odstupanja u CLAUDE.md navodi samo `--elev-*`. | Dopiši odstupanje u CLAUDE.md (i postojanje `--radius-md`). |
| D6 | Nisko | `snimak.tsx:308`, `poruke-panel.tsx:430` | **`text-accent` na Check ikonicama** — ~1.9:1 u svetloj temi, ispod 3:1, i krši „zelena kao tekst samo kroz `--accent-text`". | `text-accent-text`. |
| D7 | Nisko | `dashboard/page.tsx:66` | `StatKartica` forsira `.num` na vrednost „beta" (reč, ne broj). | Opciona `num` zastavica u `StatKartica`. |
| D8 | Nisko | `kes-lista.tsx:203-204` | Unutrašnja `<ul>` sa svojim `rounded-xl border` unutar `Card` — kartica u kartici („bez ugnježđenih kartica"). | `divide-y` bez okvira unutar kartice. |
| D9 | Nisko | `globals.css:326-333` | `.eyebrow` (0.7rem) u `--fg-faint` — 3.36:1 u svetloj temi, ispod AA za normalan tekst. | `--fg-muted` ili dokumentovati kao poznato odstupanje. |
| D10 | Nisko | `clerk-okvir.tsx:26-52` | Duplirani hex po temi u Clerk appearance objektu (i dark `colorBorder` koji namerno odstupa). | Komentar-veza ka tokenima + smoke check da se vrednosti ne raziđu. |

**Prošlo provere:** svaki Tailwind utiliti koji komponente koriste ima `--color-*` u `@theme`;
nema stranih hex vrednosti u JSX (izuzeci: `clerk-okvir.tsx` i `layout.tsx` themeColor,
oba dokumentovana); `--accent` kao tekst samo na akcent-podlozi; kontrast
`--warn-text`/`--danger`/`--accent-text` drži AA; fokus prsten i `prefers-reduced-motion`
prisutni; font-weight ≤ 600 svuda.

---

## 9. Baza

| # | Težina | Mesto | Nalaz | Popravka |
|---|---|---|---|---|
| B1 | Važno | `apps/web/src/lib/search.ts:40,85-93` | **Pravilo 1 (TTL 30 dana) se ne primenjuje po redu pri serviranju.** Upit vuče `google_refreshed_at` ali ga nikad ne koristi — kapija je samo `search_cache.last_scanned_at` na nivou kombinacije. Biznis koji poslednji scan nije vratio (ispao iz rezultata) ostaje u listi sa `google_refreshed_at` starim 60+ dana dok je kombinacija „sveža". Isto važi za otključane leadove (`moja-lista`, `poruke` — telefon/mejl se nikad ne proveravaju na svežinu). | Filtriraj `google_refreshed_at >= now() - 30d` u `searchCachedLeads` (kolona je već selektovana) ili isključi redove koje poslednji scan nije dirnuo; dokumentovati isti prag za unlock put. **Prvo odlučiti šta je namera** (v. 9.4). |
| B2 | Važno | `0001:72`, `0007:118` | **`website_audits` i `signed_events` su `on delete cascade` od `businesses`** — brisanje jednog Google reda (budući cleanup, ručna greška) uništava intelektualnu svojinu (audite) i sva otključavanja svih korisnika (kaskada preko `unlocks`). Šema aktivno podstiče tu grešku. | `on delete restrict` (ili `set null`) na obe, uz komentar da se `businesses` redovi nikad ne brišu. |
| B3 | Srednje | `0009:176-227` | Trka u `spend_credit_and_scan` — v. N1 u §4. | |
| B4 | Srednje | `0009:79-89` | `search_cache_stats` puna agregacija po zahtevu — v. P6 u §6. | |
| B5 | Srednje | `apps/worker/src/jobs/scan.ts:142-148` | **Parcijalan scan proglašava kombinaciju svežom na 30 dana** — `recordScan` se zove i kad je `partial` (budžet stao), pa nekompletan rezultat postaje besplatan keš za sve, nerazlučiv od potpunog. | `partial` zastavica u `search_cache` (i kraći rok) ili bar vidljiva oznaka; minimum: log. |
| B6 | Srednje | `job_queue`, `credit_ledger`, `searches` | **Rast bez politike zadržavanja** — `done`/`failed` poslovi se nikad ne brišu, `searches` dobija red na svaku pretragu iz keša, knjiga raste (knjiga se čuva — to je tačno; ali poslovi i istorija pretraga ne moraju). | Nedeljni cron: `delete from job_queue where finished_at < now() - interval '30 days'`; `searches` starije od 90 dana (ili agregacija). |
| B7 | Nisko | `apps/web/src/lib/admin.ts:344-377` | **Nema indeksa `admin_audit(actor_id, created_at desc)`** — svaka admin mutacija broji redove aktera (tempo 120/h) sekvencijalnim scanom dnevnika. | `create index admin_audit_actor_idx on admin_audit (actor_id, created_at desc);` |
| B8 | Nisko | `apps/web/src/lib/krediti.ts` | `credit_ledger_user_idx` je `(user_id)` bez `created_at desc` — `/krediti` sortira u memoriji. Pri 30 redova nevidljivo; pri hiljadama hoće. | `create index credit_ledger_user_created_idx on credit_ledger (user_id, created_at desc);` |
| B9 | Nisko | `apps/web/src/lib/uvoz.ts:299-305` | `.in("city_slug", …)` bez `country_code` ne koristi `businesses_city_niche_idx` (vodeća kolona) → seq scan. | `create index on businesses (city_slug);` |
| B10 | Nisko | `0001:50`, `0001` (http_status), `0007:119` | Drobne rupe u CHECK-ovima: `businesses.rating numeric(2,1)` dozvoljava >5; `website_audits.http_status` bez opsega; `signed_events.country_code` nema `^[A-Z]{2}$`. | Dodati CHECK ograničenja. |
| B11 | Nisko | `packages/shared/src/db.ts:174-186` | **Tipovski drift:** `JobQueueRow` nema `dedupe_key` (kolona od 0003); nema `JobSubscriberRow` tipa. | Dopuniti tipove. |
| B12 | Nisko | `scripts/validate-migrations.ts:80-83` | RLS provera ne obuhvata `lead_status`, `outreach_messages`, `signed_events` (uvedene u 0007). | Dodati u listu. |
| B13 | Nisko | `apps/web/src/lib/feedback.ts:293-304` | `feedback.updated_at` se ne postavlja pri drugom upisu (`ctx.errors`), a tabela nema trigger (za razliku od `lead_status`). | Trigger ili eksplicitan `updated_at`. |

### Napomena uz B1 — šta je namera

F9 svesno prelazi na **keš na nivou kombinacije** („kombinacija je sveža → besplatna svima").
Per-red TTL (`google_refreshed_at`) i dalje postoji za refresh poslove. B1 nije „bug u
F9" nego **nerešena granica između dva pravila**: kombinacija može biti sveža a neki
njeni redovi stari. Odluka je autorova, ali je vredi doneti eksplicitno i zapisati:
(a) servirati i stare redove (današnje ponašanje, uz mogućnost da se telefon/mejl
promenio), ili (b) filtrirati na `google_refreshed_at >= 30d` (redovi ispadaju iz
sveže kombinacije), ili (c) isključiti redove koje poslednji scan nije dirnuo.
Najbezbednije po pravilo 1 je (b); najtačnije po stvarnost je (c).

---

## 10. Shared paketi i konfiguracija

| # | Težina | Mesto | Nalaz | Popravka |
|---|---|---|---|---|
| SH1 | Srednje | `packages/shared/src/index.ts` + klijentski importi | **Garantija „težine nikad u klijentski bundle" počiva samo na tree-shaking-u.** Klijenti uvoze iz barrella koji re-eksportuje `scoreSite`/`bandForScore`; paket ima `sideEffects: false`, pa bundler verovatno odseče — ali **nema CI provere koja to dokazuje**. Jedna buduća promena tiho procuri heuristike. | CI korak: `grep -r "no_viewport\|scoreSite" apps/web/.next/static && exit 1` (uz `check:secrets`) ili klijent-sigurni eksporti u podputanji. |
| SH2 | Nisko | `apps/web/package.json` (ceo repo) | **Nema ESLint-a nigde** — `next build` (Next 15) bez config-a ne lintuje; propušten import, mrtva promenljiva ili `any` se ne hvataju. | `eslint` + `eslint-config-next` (flat) u CI. |
| SH3 | Nisko | `scripts/lib/route-harness.ts` | Putanja u komentarima je `scripts/route-harness.ts`, fajl je u `scripts/lib/`. | Kozmetika — popraviti komentar. |

**Prošlo provere:** `db.ts` tipovi ažurirani kroz 0015 (uključujući
`AdminOverview.po_pitanju`/`obrada`); lockfile bez duplikata (single `zod@4.4.3`,
`next@15.5.22`, `react@19.2.8`); `engines node >= 24`; `allowBuilds` samo
esbuild/sharp; ugly-score jedini izvor istine (grep po `apps/` — svuda iz
`@sajtoskop/shared`); translit i CSV korektni (testovi).

---

## 11. Operativna higijena

1. **Backup** — nema `pg_dump` skripte u repou; do PITR-a na plaćenom planu, cron na
   Hetzneru (7 dana, offsite) je otvorena P1 stavka.
2. **Monitoring servera** — nema alarma za disk/memoriju na CX22; jeftina verzija:
   `df` provera u `reaperLoop` (log na >85%) + uptime provera.
3. **`npm audit --prod` u CI** — jedna linija hvata CVE-jeve pre deploya.
4. **Dependabot/Renovate** — posebno bitno za `playwright`/`chromium` (renderuje se
   nepoznat sadržaj).
5. **Error monitoring** — P2 (Sentry); `lib/dnevnik-gresaka.ts` je klijentski i
   služi utiscima; server monitoring ne postoji. Worker loguje samo `console.log`.
6. **Staging** — Vercel Preview po PR-u (CI već postoji, jedno polje u konzoli).
7. **Strukturisani logovi u workeru** — JSON linije sa `job_id`/`type`/`duration`
   kad se uvede monitoring.
8. **`apps/web/.clerk/.tmp/keyless.json`** — nije u gitu (provereno), ali dodati u
   `.gitignore` za svaki slučaj.

---

## 12. Pravni i sadržaj (F8)

- **Uslovi korišćenja** i **Politika privatnosti** (ZZPL) — ne postoje ni na jednom
  URL-u; P0 stavka „pre launcha" iz bezbednosnog dokumenta.
- **Copyright notice** — nema ga u futeru (nema ni futera u app delu).
- ~~**Landing** (`sajtoskop.com`) — F8, još nije rađen~~ — **napravljen 27.8., van ovog repozitorijuma.** Aplikacija je preseljena na `app.sajtoskop.com`; koren app-a i dalje jeste prijava (`LANSIRANJE.md` §1.7).
- **Kanarinci** — nisu u bazi.
- **Metrika aktivacije** — F8 §5 traži 5 SQL upita; tabela postoji, upita nema ni
  kao skripte.

Sve je dokumentovano u `docs/F8-landing.md` i `docs/ROADMAP.md`.

---

## 13. Top 15 najuticajnijih popravki

1. **`retryAfter` u `BudgetError`** (pre-flight i 429) — scan se odlaže umesto da
   izgubi pokušaje i refunduje (K1).
2. **Statusna zaštita + izdvajanje `completeJob` iz try-ja** — bez ponavljanja
   gotovog posla i refundovanja uspešnog scana (V1).
3. **Timeouti na RPC pozive u workeru** — bez zauvek blokiranog slota i duplog
   posla (V2).
4. **Bezbednosni headeri** (CSP, HSTS, X-Frame-Options, Referrer-Policy) — 20
   minuta, zatvara P1 stavku (S3).
5. **IP rate limit** na novčane rute (`unlock`, `search`, `feedback*`) (S1).
6. **`kind`/`source` za utiske van pitanja izvoditi na serveru** — bez lažnog
   instant mejla i zagađene metrike (N2).
7. **CSV uvoz: batch RPC + idempotencija** — jedini endpoint koji garantovano
   istekne na 2000 redova i duplira na retry (W1+W2).
8. **`.in()` u grupama** (search 1200, moja-lista 2000, krediti 200) (W3).
9. **Ne potpisivati screenshotove za CSV izvoz** (P1).
10. **Odluka o per-redu TTL-u i njena primera** (B1) + prekid kaskade
    `website_audits` od `businesses` (B2).
11. **Indeksi**: `credit_ledger (user_id, created_at desc)`, `admin_audit
    (actor_id, created_at desc)` (B7+B8).
12. **Politika zadržavanja**: cron čišćenje `job_queue`/`searches` (B6).
13. **Sinhronizacija `PipelineTabla` sa propom** (I1) — uvezeni prospekti se ne
    pojavljuju do reloada.
14. **Stanje pretrage u URL-u** (I3) — deljivi linkovi, ispravan Back.
15. **Pravni tekstovi + robots/favicon/OG** — pre prvog korisnika (F8).
