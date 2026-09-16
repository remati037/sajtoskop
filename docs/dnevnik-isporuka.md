# Dnevnik isporuka

Šta je isporučeno, kojom migracijom, i koje odluke iz tih sesija i danas određuju kako se kod
ponaša. Pun tekst starih unosa (promptovi, izlazi provera, ručni koraci) je u git istoriji
fajla `docs/SESIJE.md` pre 16. septembra 2026.

**Pravilo:** poslednji korak svake sesije je nov unos na **dnu** ovog fajla, u istom obliku kao
postojeći, i red u tabeli „Stanje". Ručni koraci koje sesija ostavi ne pišu se ovde nego kao
stavka u `docs/lansiranje-checklista.md` (ili u „Posle lansiranja" tamo).

---

## Stanje

| # | Isporuka | Migracija | Datum | Stanje |
|---|---|---|---|---|
| F0–F10 | monorepo, baza i auth, pretraga, worker, krediti, snimci, PageSpeed i AI, poruke i kanban, cena skeniranja, utisci | `0001`–`0010` | 5.–12. 8. | ☑ |
| S1–S7 | utisci v2 (F11) i admin konzola (F12) | `0011`–`0016` | 15. 8. | ☑ |
| S8–S15 | revizija: novac, bezbednost, ispravnost, performanse, UX, dizajn, baza, testovi | `0017`–`0021` | 17. 8. | ☑ |
| S16 | novčanik, planovi, paketi | `0022` | 21. 8. | ☑ |
| S17 | dubina skeniranja, cena po stranici | `0023` | 20. 8. | ☑ |
| S18–S21 | Paddle naplata, životni ciklus, beta nalozi, cenovnik *(naplata zamenjena u S25)* | `0024` | 21.–26. 8. | ☑ |
| S22 | pravni tekstovi i futer | — | 26. 8. | ☑ |
| S23 | kopija landinga | — | — | ⊘ otpalo |
| S24 | `app.` poddomen i veze ka landingu | — | 2. 9. | ☑ |
| S25 | Stripe backend, plaćen pristup kešu | `0025` | 10. 9. | ☑ |
| S26 | Stripe cenovnik, portal, proba UI | — | 11. 9. | ☑ |
| S27 | pozivnice: komp i prvi mesec gratis | — | 11. 9. | ☑ |
| S28 | krediti dobrodošlice, grace od registracije, otkaz pretplate pri brisanju | `0026` | 12. 9. | ☑ |
| S29 | utisci: NPS, „Fali", citat, prijava greške | `0027` | 12.–13. 9. | ☑ |
| S30 | onboarding i kartica prospekta | `0028` | 13. 9. | ☑ |
| — | popravke posle S30: `0025` nad beta nalogom, Clerk `svix-id`, admin bez kredita, povraćaji, `cancel_at`, povraćaj skeniranja | `0029`–`0034` | 14.–16. 9. | ☑ |

Ručni prolazi kroz sve ovo: `docs/plan-testiranja.md`.

---

## Kraj svake sesije — ista lista

```
pnpm typecheck
pnpm test
pnpm check:sql
pnpm --filter @sajtoskop/web lint
pnpm build
pnpm check:secrets
```

- Obe teme (tamna i svetla) i telefon ≤ 390 px, ako je dirana strana
- Nijedan hex ni oklch u JSX-u; `.num` na svakom broju, ID-u, URL-u i telefonu
- Nijedan `any` u novom kodu
- Migracija je numerisan fajl u `supabase/migrations/`, idempotentna (`check:sql` je pušta dvaput)
- Novčana putanja dirana → podseti na `pnpm check:f4` nad bazom
- Nov unos na dnu ovog fajla; ručni koraci u `docs/lansiranje-checklista.md`
- Ako se promenila činjenica iz `docs/proizvod-i-arhitektura.md` — ispravi je u istom commitu
- Commit poruka na engleskom

---

## F0–F10 — prve faze

Isporučene pre ovog dnevnika; PRD-ovi su obrisani 16. 9. 2026 (u git istoriji `docs/F*-*.md`).

| Faza | Šta | Migracija | Commit |
|---|---|---|---|
| F0 | pnpm monorepo, CLI preseljen u `apps/cli`, `packages/shared` | — | 5. 8. |
| F1 | Supabase šema, RLS, Clerk kao third-party auth, seed arhive skeniranja | `0001` | 7. 8. |
| F2 | pretraga iz keša, serijalizacija bez zaključanih polja (`public-lead.ts`), prikaz rezultata | — | 7. 8. |
| F3 | red poslova u Postgresu, worker na Hetzneru, `api_budget`, Places uživo | `0002`, `0003` | 9. 8. |
| F4 | otključavanje, krediti, CSV izvoz, mesečna dodela | `0004` | 10. 8. |
| F5 | SSRF kapija, Playwright snimci, učvršćen kontejner, potpisani URL-ovi | — | 10. 8. |
| F6 | PageSpeed i Claude vision analiza | `0005`, `0006` | 10. 8. |
| F7 | generator poruka po kanalu i kanban | `0007`, `0008` | 11. 8. |
| F8 | landing, pravno, beta — raspao se: landing van repoa, pravno u S22, onboarding u S28/S30 | — | — |
| F9 | cena skeniranja i registar keša (`search_cache`) | `0009` | 12. 8. |
| F10 | utisci v1 | `0010` | 12. 8. |

---

## Sesije

### S1 — F11.1: motor utisaka
**Isporučeno:** 15. avgust 2026 · migracija `0011` · izvor: F11 PRD

- `feedback` proširen (nullable `rating`, 11 kolona), nove tabele `feedback_prompts` i `changelog`, brojači utisaka na `profiles`.
- Razlog `feedback` u knjizi i u telu `grant_credits`; omotač `grant_feedback_credits`.
- `feedback-katalog.ts` (Zod šema po pitanju, `proveriOdgovor()`) i čisti motor `feedback-motor.ts` (`odluci()`, `sledecePitanje()`, `smeDaSePita()`).
- Rute `POST /api/feedback/pitanje/[kljuc]/prikazano` i `.../odbaceno`; `POST /api/feedback` prima `prompt_key` + `answers` validirane katalogom.
- `UtisciProvider` u `okvir-aplikacije.tsx` i mikro-traka `utisak-mikro.tsx` na `/pretraga`.

**Odstupanja koja i danas važe:**
- `grant_feedback_credits` hvata ishod `grant_credits`: ponovljen poziv vraća „već dodeljeno", ne lažno `ok`.
- Nema posebnog rate limita za `/pitanje/*`: PK `(user_id, prompt_key)` pušta jedan prikaz (drugi `409`), odbacivanje je idempotentno.
- Katalog ima polja `tekstPrvi`, `ponovi` i `prijava`; server iz `prijava` izvodi `kind` i `severity`, nikad iz tela.
- Mikro-traka rezerviše visinu tek u trenutku odluke, ne trajno.

### S2 — F11.2: kampanje, panel, slika
**Isporučeno:** 15. avgust 2026 · bez migracije · izvor: F11 PRD

- Katalog proširen na osam pitanja; obavezno polje `do:` i `uslov` po pitanju, `CENA_OPSEZI` i `medijanaCene()`.
- `utisak-dugme.tsx` postaje panel (360 px, focus trap, `Ctrl/⌘+Shift+U`, paste/drop slike); podsetnik dana 3 ostaje modal.
- `lib/dnevnik-gresaka.ts`: poslednjih 5 klijentskih grešaka u memoriji taba, bez query stringa i steka.
- `POST /api/feedback/slika`: ≤ 2 MB, png/jpeg/webp po magičnim bajtovima, privatan bucket `feedback`, 10 otprema na 24 h.
- Nagrada za poruku kroz `grant_feedback_credits`; montaža pitanja na `/pretraga`, u panelu poruka i kanbanu.

**Odstupanja koja i danas važe:**
- `poruka-kvalitet` se javlja na prvu kopiranu poruku (bilo koji izvor); poreklo i kanal idu u `answers`.
- Drugi korak odgovora ide kroz `PATCH /api/feedback/[id]`, spaja se sa upisanim i ponovo validira katalogom.
- Kvote nagrade broje samo stavke sa `delta = 1` (ručnih +10 za bug ne jede kvotu), dan i mesec po UTC-u.
- `screenshot_path` se proverava po vlasniku (`<user_id>/…`); limit `/slika` se broji nad bucketom, ne nad `feedback`.

### S3 — F12.1: admin temelj
**Isporučeno:** 15. avgust 2026 · migracija `0012` · izvor: F12 PRD

- `profiles.role` i `last_seen_at`, tabela `admin_audit` (RLS bez politike), RPC `admin_adjust_credits` i `admin_users_page`.
- `lib/admin.ts`: `jeAdmin()`, `requireAdminPage()` → `notFound()`, `requireAdminRoute()` → `404` sa praznim telom; `ADMIN_BOOTSTRAP_IDS` u env šemi.
- Grupa `(admin)` sa bočnom trakom; `/admin/korisnici` (filteri, sort, paginacija kroz URL), detalj korisnika, `/admin/revizija`.
- `last_seen_at` se upisuje iz `(app)/layout.tsx` kroz `after()`, najviše jednom na sat.

**Odstupanja koja i danas važe:**
- `admin_audit.actor_id` je nullable (`on delete set null`); `null` se čita kao „obrisan nalog" ili sistemska radnja.
- Admin ekrani su serverske komponente i čitaju direktno kroz `lib/admin-*.ts`, bez `GET /api/admin/*` ruta.
- `(admin)/layout.tsx` takođe zove `requireAdminPage()` da 404 ne bi bio nacrtan unutar admin okvira; zaštita i dalje ostaje na svakoj strani.
- `admin_adjust_credits` sam piše `admin_audit` (ruta piše samo pad); ostali omotači to ne rade.

### S4 — F12.2: admin radnje
**Isporučeno:** 15. avgust 2026 · bez migracije · izvor: F12 PRD

- Rute pod `/api/admin/korisnici/[id]`: `krediti`, `plan`, `uloga`, `limit`, `blokada`, `DELETE`; sve `private, no-store`.
- `admin-radnje.ts`: `pripremiRadnju()` (admin → profil aktera → tempo 120/h), `saAuditom()` upisuje trag i na uspeh i na pad.
- Clerk webhook grana `user.deleted` → `obrisiProfil()` (idempotentno), uz red `user.delete.cascade` sa `actor_id = null`.
- Opasna zona na detalju korisnika sa potvrdom tipkanim mejlom; `check:sql` blok koji čuva kaskadu brisanja.

**Odstupanja koja i danas važe:**
- Brojač tempa je sam `admin_audit` (pali pokušaji se broje); pad čitanja dnevnika obara mutaciju sa `503`.
- Akter mora da ima red u `profiles` (FK), inače `409`; neispravno telo takođe ostavlja red u dnevniku.
- `searches.user_id` je `on delete set null` i preživljava kaskadu; ban/unban su dve radnje (`user.ban`, `user.unban`).
- Nalog kog u Clerku više nema briše se direktno uz potvrdu naspram `profiles.email` — jedini izuzetak od pravila 15.

### S5 — F12.3: pozivnice i pregled sistema
**Isporučeno:** 15. avgust 2026 · migracije `0013`, `0014` · izvor: F12 PRD

- RPC `admin_set_role` (brojanje admina pod `pg_advisory_xact_lock`) i `admin_overview` (sve kartice pregleda jednim pozivom).
- `lib/mail.ts` je jedini izlaz ka Resend-u (tajmaut, čišćenje ključa, zaštita od header injection-a).
- `/admin` pregled, `/admin/pozivnice` (slanje, opoziv, otvaranje naloga sa generisanom lozinkom), pojedinačna poruka 20/24 h.
- `GET /api/admin/izvoz?sta=korisnici` kroz `admin_users_page`, stranice od 100, plafon 5000 uz `X-Sajtoskop-Truncated`.
- `0014`: `admin_users_page` prima `p_bootstrap`, bedž `NEMA U CLERKU`, link „Admin konzola" u bočnoj traci samo za admina.

**Odstupanja koja i danas važe:**
- `admin_set_role` ne piše `admin_audit`; red piše ruta kroz `saAuditom()`.
- Pozivnica ide našim mejlom (`notify: false`); pad Resend-a je uspeh sa linkom za ručno slanje.
- Lozinka i link putuju kroz `Ishod.podaci`, kanal koji nikad ne dodiruje dnevnik; `target_user` je prazan za pozivnicu i izvoz.
- `ADMIN_BOOTSTRAP_IDS` se nikad ne upisuje u bazu; funkcija sa novim parametrom se `drop`-uje, ne `create or replace`.

### S6 — F11.3: utisci u konzoli
**Isporučeno:** 15. avgust 2026 · migracija `0015` · izvor: F11 PRD §6.6–§9

- `admin_overview` dopunjen sa `utisci.po_pitanju` i `utisci.obrada`; indeks `feedback_created_idx`.
- `/admin/utisci` (filteri, lista, panel desno) i `/admin/utisci/[id]` kao redirekcija na `?utisak=<id>`.
- Rute `PATCH /api/admin/utisci/[id]`, `POST …/nagrada`, `POST …/dnevnik`; `resolved_at` se izvodi iz statusa.
- `lib/cron.ts` (`jeCron()` kroz `timingSafeEqual`, `404` bez tajne) i cron rute `utisci-digest`, `utisci-izvestaj`, `utisci-slike`.
- `ideOdmah()`: instant mejl samo za bug, ocenu 1 i incident; ostalo ide u digest.

**Odstupanja koja i danas važe:**
- Vercel Hobby: zakazani su samo digest i nedeljni izveštaj; `utisci-slike` se pokreće ručno. Cron rute primaju i `GET` i `POST`.
- Nagrada za bug prolazi u statusima `priznato`, `u_radu` i `reseno`; nagrada i veza sa dnevnikom su zasebne radnje.
- Digest gleda 48 h unazad i „poslato" je `emailed_at`, pa pao instant mejl ulazi u sledeći digest.
- Cron rute pišu `admin_audit` sa `actor_id = null`, ali prazan dan ne ostavlja red (osim nedeljnog izveštaja).

### S7 — F11.4: zatvaranje petlje utisaka
**Isporučeno:** 15. avgust 2026 · migracija `0016` · izvor: F11 PRD §6.4–§10

- `feedback.user_note` (javno obrazloženje, odvojeno od `admin_note`) i `feedback.notify_attempts` sa parcijalnim indeksom.
- „Moje prijave" na `/utisci`: statusi kao bedževi, otvaranje upisuje `seen_at` i nulira `feedback_unseen_count` kroz `after()`.
- Tačka sa brojačem na plutajućem dugmetu; brojač se diže pri prelasku u `reseno`.
- Mejl „rešeno je ono što si prijavio" iz digest rute: jedan po korisniku, do 3 pokušaja po prijavi.
- Beta dnevnik: sekcija na `/dashboard`, CRUD na `/admin/dnevnik`, radnje `changelog.create/update/delete`; provera teze u nedeljnom izveštaju.

**Odstupanja koja i danas važe:**
- `/utisci` čita direktno kroz `adminSupabase()` sa `user_id` iz sesije; RLS na `feedback` ostaje `using (false)`.
- Tačka i mejl prate samo `reseno`; odbijeno se korisniku prikazuje kao „Pročitano".
- Mejl „rešeno" nema svoju cron rutu (Hobby limit) — digest ruta prvo šalje korisnicima, pa meni.

### S8 — Faza 0: worker, novac i pouzdanost
**Isporučeno:** 17. avgust 2026 · migracija `0017` · izvor: plan izmena, Faza 0

- `nextDayReset()` / `nextMonthReset()` (tačna LA ponoć); `BudgetError` uvek nosi `retryAfter`, pa iscrpljen budžet ide u `defer_job`, ne u pad.
- `complete_job`, `fail_job` i `defer_job` menjaju samo poslove u `running`; `completeJob` je izvan `try` bloka.
- Svi Supabase pozivi workera imaju `AbortSignal.timeout(30_000)`; Anthropic klijent `maxRetries: 0` u `rewrite-message.ts`.
- `unhandledRejection` / `uncaughtException` handleri loguju i nastavljaju.

**Odstupanja koja i danas važe:**
- Biznis u više niša: „poslednji scan pobeđuje", vidljiv je samo u poslednje skeniranoj niši (komentar u `upsertBusinesses`).
- `check:sql` poredi TS reset funkcije sa `budget_next_day_reset` / `budget_next_month_reset` — menjaju se zajedno.

### S9 — Faza 1: bezbednost, P1 lista
**Isporučeno:** 17. avgust 2026 · migracija `0018` · izvor: plan izmena, Faza 1

- Bezbednosni headeri u `next.config.ts`: CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `nosniff`, `Permissions-Policy`.
- IP rate limit: `request_limits` + `claim_request` (100/min po IP+ruta), `proveriIpTempo()` na rutama koje troše ili pišu.
- `webhook_events(provider, event_id)`: marker pre obrade, brisanje markera na padu da retry prođe.
- Env šema proverava prefikse Clerk ključeva; `POST /api/feedback` bez `prompt_key` odbija `kind`/`source` rezervisane za pitanja.
- RPC `zabelezi_utisak` (dnevni plafon i `ctx` pod `for update`) i `dopuni_utisak` (CAS upis, TS ponavlja do 3 puta).

**Odstupanja koja i danas važe:**
- Pad IP brojača ne ruši rutu (log i nastavak), za razliku od admin tempa.
- Validacija odgovora ostaje u TS-u (Zod iz kataloga); RPC je samo tačka upisa sa CAS proverom.
- CSP izvlači Clerk domen iz `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` i dodaje ga u `script-src`, `connect-src` i `img-src`.

### S10 — Faza 2: ispravnost, uvoz, pretraga, web
**Isporučeno:** 17. avgust 2026 · migracija `0019` · izvor: plan izmena, Faza 2

- CSV uvoz u paralelnim grupama od 30 kroz `otkljucajZaUvoz` (isti `spend_credit_and_unlock`, bez UI čitanja).
- `lib/upiti.ts` `inGrupe` (po 200) za sve velike `.in()` upite.
- `enqueue_job` hvata `unique_violation` i vraća tuđ posao (`joined=true`); `spend_credit_and_scan` bez `job_id` je 500, nikad posao 0.
- Jedinstven indeks `outreach_messages_dedupe_idx`; ruta i worker upisuju kroz `upsert` sa `ignoreDuplicates`.
- `GET /api/poruke/ai` uparuje `placeId` i kanal sa payloadom posla; plaćen scan ne vraća 500 ako keš-čitanje padne.

**Odstupanja koja i danas važe:**
- Uvoz nije jedna transakcija; retry je bezbedan jer su otključavanja idempotentna po PK, a statusi upsert.
- Dedup poruka nema vremenski prozor: isti tekst za isti lead i kanal je jedan red zauvek.
- Seed ne prepisuje audit sa novijim `enriched_at`, ni bilo koji audit sa `audit_level > 1`.

### S11 — Faza 3: performanse
**Isporučeno:** 17. avgust 2026 · migracija `0020` · izvor: plan izmena, Faza 3

- CSV izvoz bez potpisivanja snimaka (`potpisi: false`); `/lista` potpisuje jednim `createSignedUrls`.
- `job_queue.found/analyzed` + RPC `get_job_for_user` (pretplata i red jednim upitom); polling sa backoff-om 3 s → 10 s.
- `search_cache.total/no_site` održavaju `record_scan` i trigger na `website_audits`; pogled `search_cache_stats` obrisan.
- RPC `search_listing`: filter, sort, `LIMIT/OFFSET` i agregati u SQL-u.
- Indeksi na `credit_ledger`, `admin_audit`, `businesses(city_slug)`; stanje motora utisaka se čita klijentski sa `GET /api/utisci/stanje`.

**Odstupanja koja i danas važe:**
- Konačni razvezivač sorta u `search_listing` je `place_id`, ne `localeCompare`.
- Dok stanje motora utisaka ne stigne sa rute, motor ne donosi nijednu odluku.

### S12 — Faza 4: UX
**Isporučeno:** 17. avgust 2026 · bez migracije · izvor: plan izmena, Faza 4

- Kanban: „Premesti u…" select (touch i tastatura), sinhronizacija `redovi` ← `kartice`, `Esc` otkazuje belešku.
- Stanje pretrage u URL-u (`?grad=&nisa=&bezSajta=&strana=`) kroz `push`; promena comboboxa briše rezultate.
- Istek pollinga osvežava keš i nudi „Proveri ponovo"; greška otključavanja stoji iznad tabele.
- „Prvi koraci" na dashboard-u dok nema otključanog prospekta; a11y (`role="alert"`, `aria-activedescendant`, roving tabindex teme).
- Polling pauzira na skrivenom tabu; „snimak nije dostupan" se zaključuje iz prisustva PSI/AI podataka.

**Odstupanja koja i danas važe:**
- „Proveri ponovo" ponovo zove pretragu bez plaćanja, ne prati sačuvan `jobId`.
- Upis stanja pretrage u URL je `push`, pa svaka promena filtera pravi unos u istoriji.

### S13 — Faza 5: dizajn sistem
**Isporučeno:** 17. avgust 2026 · bez migracije · izvor: plan izmena, Faza 5

- `shadow-accent` samo u `ui/button.tsx`; jedno primarno „Kopiraj" po dijalogu (`PorukaBlok` prop `primarno`).
- `.num` na datumima, URL-ovima i mejlovima; zelene ikonice kroz `text-accent-text`.
- `StatKartica` sa opcionim `num`; kes-lista bez ugnježđenog okvira.
- Mapiranje `--r-*` → `--radius-*` dokumentovano u `CLAUDE.md`.

### S14 — Faza 6: baza, zadržavanje, higijena
**Isporučeno:** 17. avgust 2026 · migracija `0021` · izvor: plan izmena, Faza 6

- `search_listing` prima `p_ttl_days` i ne vraća redove sa `google_refreshed_at` starijim od 30 dana.
- `website_audits.place_id` i `signed_events.place_id` → `on delete restrict`; nove CHECK granice (`rating`, `http_status`, `country_code`).
- `cistkaZastarelo()` u reaper petlji workera jednom nedeljno: `job_queue` > 30 d, `searches` > 90 d, `api_budget` > 3 meseca.
- `search_cache.partial` + `record_scan(p_partial)` i oznaka „delimično"; `scripts/backup.sh`, Dependabot i `pnpm audit` u CI.

**Odstupanja koja i danas važe:**
- Otključani prospekti su izuzeti od TTL filtera; svežina im se obnavlja kroz `refresh_google` posao.
- Čišćenje živi u workeru, ne u Vercel cronu; `credit_ledger` se nikad ne briše.
- `partial` (a kasnije i `pages`) se čita direktno iz `search_cache`, jer RPC-ji keša ne smeju da menjaju povratni tip.

### S15 — Faza 7: testovi i kvalitet
**Isporučeno:** 17. avgust 2026 · bez migracije · izvor: plan izmena, Faza 7

- `check:sql` blok „trke nad novcem" (dupli scan, isti ključ posla, isti `ref_id`); prava paralelnost ide kroz `pnpm check:f4`.
- `apps/web/test/ide-odmah.ts` učitava pravu funkciju kroz resolve hook.
- ESLint 9 flat config u `apps/web` (0/0), lint u CI; CI grep da `scoreSite`/`no_viewport` nisu u klijentskom bundle-u.
- `apps/web/.clerk/` u `.gitignore`.

**Odstupanja koja i danas važe:**
- Zakucano `eslint@^9` + `eslint-config-next@^15`; `react/no-unescaped-entities` je isključen zbog srpskih navodnika.
- `verify-deps-before-run=false` u korenom `.npmrc` (pnpm 11 inače pokreće install u headless okruženju).

### S16 — Novčanik, planovi i paketi kredita
**Isporučeno:** 21. avgust 2026 · migracija `0022` · izvor: plan lansiranja §1.3–§1.5, S16

- Polar uklonjen u celosti.
- Dve kase kredita: `credits_balance` (ističe) i `credits_topup` (paketi, ne ističu); nove tabele naplate i razlozi u knjizi.
- `plans.ts` prepisan kao jedini izvor planova, paketa i budžetskih kapova; pogodnosti u UI se računaju iz `PLANS`.
- Dnevni osigurač na AI varijante: `claim_ai_rewrite` i `release_ai_rewrite`.

**Odstupanja koja i danas važe:**
- Pod balansa je `-1000` (`profiles_credits_nonneg` pomeren, ne obrisan); `credits_topup` ostaje na tvrdoj nuli.
- Kasu bira razlog u telu `grant_credits`, ne parametar.
- `admin_adjust_credits` ima `p_kind` (`korekcija` / `povracaj`); razlog u knjizi ostaje `admin`, razlika se čuva u `admin_audit.payload`.
- Hiljade u pogodnostima se formatiraju ručno, ne kroz `Intl`, da server i pregledač daju isti string.

### S17 — Dubina skeniranja i cena po stranici
**Isporučeno:** 20. avgust 2026 · migracija `0023` · izvor: plan lansiranja §1.2, S17

- 1 kredit = 1 stranica = 1 Places poziv; dubine Brzo / Standardno (podrazumevano) / Duboko = 1 / 2 / 3 stranice.
- `plans.ts`: `stranicaZaRezultate()`, `cenaSkeniranja()`, tip `Dubina`, `DUBINE`, `DUBINA_OPIS`; `PLACES_PAGE_SIZE` i `PLACES_MAX_PAGES` preseljeni iz workera.
- `spend_credit_and_scan` računa cenu nad zbirom obe kase, dubina ulazi u ključ deduplikacije (`RS:grad:nisa:p2`).
- `search_cache.pages` (1–3), `record_scan(p_pages)`; `refund_scan` vraća iznos iz `credit_ledger`.
- Segmentna kontrola dubine i `?dubina=` u URL-u; CLI `--dubina`; worker staje na plaćenom broju stranica.

**Odstupanja koja i danas važe:**
- Kolona se zove `pages` (broj stranica = poziva = kredita); nijedna funkcija keša ne menja povratni tip, `pages` se čita iz kolone.
- `spend_credit_and_scan` normalizuje `maxResults` na `stranice × 20` pre upisa u payload.
- Razlog naplate `plice`: keš je svež ali plići od tražene dubine; podrazumevana dubina se ne upisuje u URL.
- Pad čitanja `pages` u `stanjeKesa` se ne guta; `SCAN_DEEP=1` nikad na mašini koja vrti poslove iz weba.

### S18 — Paddle webhook, serverski checkout, kupon
**Isporučeno:** 21. avgust 2026 · bez migracije · izvor: plan lansiranja §1.6, S18

- Webhook: verifikacija potpisa, pa insert u `billing_events` (duplikat → 200 i stop), pa obrada; nepoznat tip se upiše i dobije 200.
- Obrada pre odgovora: trajan neuspeh → 200 i log, prolazan → brisanje markera i 500 da provajder ponovi.
- Odluke odvojene od upita (`billing.ts` + interfejs skladišta), testovi sa lažnim skladištem i pravim potpisom.

Zamenjeno u S25 (Stripe).

### S19 — Životni ciklus pristupa
**Isporučeno:** 21. avgust 2026 · bez migracije · izvor: plan lansiranja §1.5, S19

- `packages/shared/src/pristup.ts`: čista `stanjePristupa(profil, pretplata, sada)` vraća diskriminisanu uniju sa `pun`, `cita`, `planLimita` i datumima.
- `apps/web/src/lib/pristup.ts`: `citajPristup()` kroz React `cache()`, `zahtevajCitanje()`, `odbijenica()` / `odbijenicaCitanja()`.
- Kapije na svakoj strani u `(app)` i na API rutama koje troše ili čitaju; layout kapija nije zaštita.
- Strana `/zakljucano` (sama vraća u aplikaciju kad pristup postoji), `pristup-baner.tsx` i modal u `pristup-provider.tsx`.

**Odstupanja koja i danas važe:**
- Odbijenica zbog pristupa je `403`; `402` znači isključivo „nemaš dovoljno kredita". `dopuna` pretiče `grace`.
- `pristup === null` (kvar veze sa bazom) propušta kapije; `/api/job/[id]` namerno nema kapiju.
- Dnevni limiti se računaju po `planLimita` iz kapije, ne po `profiles.plan`.
- Modal pamti u `localStorage` sa potpisom stanja (istek) i u `sessionStorage` (nema kredita), bez kolone u bazi.

### S20 — Admin konzola: beta nalozi
**Isporučeno:** 21. avgust 2026 · migracija `0024` · izvor: plan lansiranja §1.1 (D1), §1.4–§1.5, S20

- Registracija zatvorena: `profiles.plan default 'dopuna'`, `DEFAULT_PLAN = "dopuna"`, `profiles_plan_valid` check.
- Triger-čuvar plana: dodela plana propušta samo transakciju sa `set_config(..., 'konzola', true)` iz jednog RPC-a.
- `create_profile_with_grant` razlikuje „created" od „existing" po `xmax = 0`.
- `admin_users_page` dobija kolone obe kase, oba roka, pretplatu i parametar `p_ids`; kolona i filter „Stanje" na `/admin/korisnici`.
- Blok „Pristup" i razbijen blok „Krediti" na detalju korisnika; CSV izvoz nosi obe kase i stanje.

Beta nalozi su u S25 postali komp pristup (`komp`, `admin_open_komp`, `profiles_komp_guard`, `komp_expires_at`).

**Odstupanja koja i danas važe:**
- Filter po stanju se računa u TS-u (`stanjePristupa`) i šalje u SQL kao `p_ids`; druga SQL implementacija stanja ne postoji.
- RPC za otvaranje ne piše `admin_audit`; red piše ruta kroz `saAuditom`.
- `<input type="date">` znači kraj izabranog lokalnog dana; podrazumevani datum se popunjava u `useEffect`.
- Plan koji daje besplatan pristup nije u padajućem spisku planova; statički test drži da ga samo `lib/admin-radnje.ts` dodeljuje.

### S21 — Cenovnik sa paketima, stanje pretplate, portal
**Isporučeno:** 23. avgust 2026 · bez migracije · izvor: plan lansiranja §1.2–§1.5, S21

- Svako mesto koje prikazuje kredite pokazuje zbir obe kase; `/krediti` blok „Pretplata" razdvaja kase i objašnjava ih.
- Sekcija „Paketi kredita" na `/cenovnik` sa sidrom `#paketi`; `PLAN_IME` / `imePlana()` za korisničko ime plana.
- Portal ruta čita kupca isključivo iz sesije, ne čita telo ni query, vraća `404` bez kupca i samo URL.

Zamenjeno u S25 (Stripe).

**Odstupanja koja i danas važe:**
- Nema iznosa u evrima na `/krediti`: pogrešan iznos o novcu je gori od izostalog.
- Prag „nisko stanje" je `max(3, 10% mesečne dodele)`; poziv na dokupljivanje u bočnoj traci je link, ne dugme.

### Izmena posle S21 — paket kredita traži plan
**Isporučeno:** 26. avgust 2026 · bez migracije · izvor: plan lansiranja §1.4–§1.5

- `smeDaKupiPaket()` i `STANJA_ZA_PAKET` u `packages/shared/src/pristup.ts`, isti za server i pregledač.
- Checkout ruta sprovodi pravilo sa `403`; ekran cena i dalje pokazuje pakete, sa katancem.
- Uklonjen izlaz „Samo dokupi kredite" sa `/zakljucano`; tri CTA-a pitaju `smeDaKupiPaket()` i nude plan kad paket nije opcija.

**Odstupanja koja i danas važe:**
- `smeDaKupiPaket(null)` je `false`: naplata pada zatvoreno, suprotno od `odbijenica()`.
- `dopuna` ne sme da kupi paket; iz nje se izlazi samo planom.

### S22 — Pravni tekstovi i futer
**Isporučeno:** 26. avgust 2026 · bez migracije · izvor: plan lansiranja S22, F8 PRD §3

- `/uslovi`, `/privatnost`, `/povracaj` kao statične javne strane kroz `pravni-okvir.tsx`.
- `components/futer.tsx` na javnim stranama; nikad u grupi `(app)` i ne na `/zakljucano`.
- Rečenica o prihvatanju Uslova i Privatnosti samo na kartici „Registracija" u `auth-ekran.tsx`.

**Odstupanja koja i danas važe:**
- `<Popuniti>` je vidljiv marker na strani uz `<NacrtBaner />`; baner se briše tek kad nestane poslednji marker.
- Tekstovi su komponente, ne markdown; pravna strana ne čita Clerk sesiju da bi ostala statična.
- U tekstu nema izmišljenih činjenica; odeljak 6 Privatnosti opisuje put brisanja naloga i menja se zajedno sa njim.

### Izmena posle S22 — dva domena, onboarding kao faza, O1
**Isporučeno:** 27. avgust 2026 · bez migracije · izvor: plan lansiranja §1.7–§1.8

- Landing `sajtoskop.com` je van repoa; aplikacija ide na `app.sajtoskop.com`, `/` ostaje ekran za prijavu.
- Pravne strane ostaju u aplikaciji, landing ih linkuje.
- Link sa landinga nosi slug plana, nikad ID cene provajdera.
- Onboarding postaje zasebna faza; krediti dobrodošlice idu u `credits_topup` pri kreiranju profila (razlog `onboarding`, `ref_id = user_id`).

**Odstupanja koja i danas važe:**
- Krediti dobrodošlice idu u `credits_topup` jer samo topup otvara pristup nalogu bez plana; smeju da odu i na skeniranje.
- Vodič postoji samo na zahtev; ništa se ne pokreće samo.

### S23 — Kopija landinga
Otpala: landing je napravljen van repoa.

### S24 — Preokret na `app.` poddomen i veze ka landingu
**Isporučeno:** 2. septembar 2026 · bez migracije · izvor: plan lansiranja S24, §1.7

- `lib/veze.ts`: jedino mesto koje zna domen landinga (`NEXT_PUBLIC_LANDING_URL`, normalizovana kosa crta), bez `server-only`.
- Logo na javnim stranama i stavka „Početna" u futeru vode na landing kroz `<a href>`; `/` ima „← Nazad na početnu".
- `/cenovnik` prima `?plan=`, `?ciklus=`, `?paket=`; gost se posle registracije vraća na isti izbor.
- `lib/cenovnik-namera.ts` odvojen od `cenovnik-namera-schema.ts` da Zod ne uđe u klijentski bundle.
- `test/veze.ts` obara zakucan domen van `lib/veze.ts` i vozi nameru kroz zatvoren krug.

**Odstupanja koja i danas važe:**
- Podrazumevani landing URL je `www` oblik (goli domen vraća `308`).
- Checkout se ne otvara sam iz `?plan=`; namera samo preselektuje, klik ostaje korisnikov.
- Bedž „Tvoj izbor" i primarno dugme idu na izabran plan; `?paket=` sam doskroluje do `#paketi`.
- User-Agent workera linkuje `https://sajtoskop.com/bot`, stranicu na landingu, namerno.

### S25 — Stripe backend, Paddle uklonjen, plaćen pristup kešu
**Isporučeno:** 10. septembar 2026 · migracija `0025` · izvor: `docs/naplata-stripe.md` (K1)

- Stripe je jedini provajder: hosted Checkout i Customer Portal, webhook nad `Stripe.Event`; `@paddle/*`, `paddle-*` fajlovi i skripte obrisani; `stripe:doktor` proverava 8 `lookup_key`-eva i kupon naspram `plans.ts`.
- `0025`: `stripe_customer_id`, `komp_expires_at`, `invite_id`; `subscriptions` u Stripe obliku; `apply_subscription`, `apply_invoice_paid`, `apply_trial_start`, `expire_subscription_credits`, `admin_open_komp`, `redeem_invite`; tabele `search_access`, `access_invites`, `access_invite_redemptions`, `trial_fingerprints`; `beta` → `komp`.
- `plans.ts`: cene u evrima, 150/450/1.200 kredita, paketi 75/200, proba 7 dana i 10 kredita; `pristup.ts` dobija sedmo stanje `proba`.
- D10: i otvaranje liste iz keša se plaća (`spend_credit_and_scan` ishod `cached`), a pristup važi 30 dana (`has_search_access`); `refund_scan(job, pages)` vraća razliku kad Google da manje stranica.
- Dnevni limit „Napiši drugačije" se stvarno sprovodi (`claim_ai_rewrite` / `release_ai_rewrite`); worker `monthly_grant` puni samo godišnje pretplate i komp.

**Odstupanja koja i danas važe:**
- `apiVersion` je pinovana na `2026-08-26.dahlia` (verzija SDK-a); webhook endpoint u panelu mora da ima istu.
- Delimičan povraćaj skeniranja ide posle upisa registra i posle grane za prazan rezultat — `refund_scan` je idempotentan po platiocu.
- Worker nema nijedan Stripe ključ; `sk_live_` se odbija van `VERCEL_ENV=production`.

### S26 — Stripe cenovnik, portal, proba UI, „Aktiviraj odmah"
**Isporučeno:** 11. septembar 2026 · bez migracije · izvor: `docs/naplata-stripe.md` (K2)

- `/cenovnik` bez SDK-a: cene iz `plans.ts`, godišnje sa mesečnim ekvivalentom, dugme → `POST /api/billing/checkout` → `location.assign`.
- `/api/billing/aktiviraj` + `aktiviraj-odmah.tsx`: proba postaje plaćen plan danas; `pretplata-blok.tsx` sa stanjima proba, otkazana proba, `past_due`, komp.
- Baner „Probni krediti su potrošeni" sa „Aktiviraj odmah"; `/welcome` čita Checkout sesiju samo za tekst.

**Odstupanja koja i danas važe:**
- Kupon „prvi mesec gratis" važi **samo uz mesečni ciklus** — uz godišnji bi dao celu godinu.
- Aktivacija šalje `payment_behavior: error_if_incomplete`: odbijena kartica vraća 402, a proba ostaje.
- `subscriptions.retrieve` pre `update` čuva od duplog klika posle uspešne aktivacije.
- Izvor istine za pozivnicu je `profiles.invite_id`, ne query parametar; 409 iz checkout-a nosi `kod` (`ima_plan` / `komp`).

### S27 — Pozivnice: komp i prvi mesec gratis
**Isporučeno:** 11. septembar 2026 · bez migracije · izvor: `docs/naplata-stripe.md` §9 (K3)

- `/admin/pozivnice` → „Pristupne pozivnice": obrazac (tip, dana, kredita, kod `SAJT-XXXX-XXXX`, upotreba, mejl, napomena), tabela, opoziv, kopiraj link.
- `/pozivnica/[code]` van `(app)`: gost vidi registraciju, prijavljen „Prihvati" → `POST /api/pozivnice/prihvati` → `redeem_invite`.
- Rute `POST/DELETE /api/admin/pozivnice/pristup` sa revizijom na uspeh i pad; 91 provera u `test/pozivnice.ts`.

**Odstupanja koja i danas važe:**
- Opoziv „prvi mesec" briše i `invite_id` nalozima koji su je prihvatili a nisu prošli checkout; komp se opozivom ne oduzima.
- Revizija nosi `invite.create` / `invite.revoke` sa `payload.tip = "pristupna"`, bez mejla i koda.
- Statusi: `not_found` 404, `revoked`/`expired` 410, `wrong_email` 403, ostalo 409, `no_user` 503.

### S28 — Krediti dobrodošlice, grace od registracije, otkaz pretplate pri brisanju
**Isporučeno:** 12. septembar 2026 · migracija `0026` · izvor: `docs/tok-i-onboarding.md` §0 (O2, O3, C6)

- `0026`: kolone `onboarding_steps` (jsonb), `onboarding_done_at`, `onboarding_skipped_at`, `onboarding_hints_seen`; RPC `onboarding_mark_step`; razlog `onboarding` puni `credits_topup`.
- `ONBOARDING_CREDITS = 2`, dodela u `create_profile_with_grant` (ref `signup:<user>`).
- O3: grace se broji od kasnijeg od plaćenog roka i registracije — nov nalog posle potrošenih kredita čita 30 dana.
- C6: `user.deleted` prvo otkazuje žive Stripe pretplate (`lib/otkazivanje.ts`), pa briše profil; pad → 500 i Svix ponavlja.

**Odstupanja koja i danas važe:**
- `onboarding_mark_step` baca na nepoznat korak i na `null` — tiho `false` bi bio traka koja se nikad ne završi.
- Invarijanta knjige je `sum(delta) = credits_balance + credits_topup`.

### S29 — Utisci: NPS, „Fali", citat, prijava greške
**Isporučeno:** 12.–13. septembar 2026 · migracija `0027` · izvor: `docs/tok-i-onboarding.md` §5.3 (K5)

- Pitanje o ceni obrisano; `nps-7` (0–10, bez nagrade, 7+ dana i bar jedan otključan), `fali` (tekst, ponavlja se posle 24 h), treći korak „citat" na `prvi-potpisan`.
- `0027`: `admin_nps()`, `admin_fali()`, `zabelezi_utisak` sa `p_ctx_extra` (samo `placeId`, `jobId`, `korak`), `admin_overview` sa NPS-om.
- „Prijavi grešku" na šest mesta sa kontekstom; admin panel „Kontekst" čita status posla pri prikazu; filteri Fali i Citat; „Kopiraj kao referencu".
- „Beta dnevnik" → „Novo u Sajtoskopu"; `ROK_PITANJA = "2027-12-31"`; treće odbacivanje pitanja traje 90 dana.

**Odstupanja koja i danas važe:**
- `answers` je `strictObject` (nepoznat ključ = 400), a telo utiska `z.object` (nepoznato polje se skida).
- `ctx.query` i `ctx.korak` dolaze iz `ctx`, ne iz `answers`; `korak` je iz profila, ne iz tela.
- `score` NPS-a je `NULL` bez odgovora, ne 0.

### S30 — Onboarding i kartica prospekta
**Isporučeno:** 13. septembar 2026 · migracija `0028` · izvor: `docs/tok-i-onboarding.md` §1.8–§1.13, §2.3, §4, §7 (K4)

- `0028`: `onboarding_city`, `onboarding_niche`, `onboarding_channel` (viber / mejl / instagram).
- `/pocetak` (četiri ekrana, samo sveže kombinacije iz keša), `OnboardingProvider`, traka „Prvih pet minuta", `vodjena-tacka.tsx`, `vodic.tsx`; kapija `zahtevajOnboarding()` na pet strana.
- `kartica-prospekta.tsx` u pet stanja zamenjuje `lead-tabela.tsx` na `/pretraga` i `/lista`; `UnlockResponse.enrichJobId`, polling `enrich_full`, tabovi Viber/Mejl/Instagram/Poziv.
- Prazna stanja §4.7, baneri po uzroku grace-a (§2.3), `/zakljucano` grana „Nalog čeka plan"; rute `api/onboarding/{korak,preskoci,hint}`.

**Odstupanja koja i danas važe:**
- Kapija čarobnjaka traži i `!steps.pretraga`, inače bi posle plaćene liste vratila čoveka u čarobnjak.
- Redirekcija posle ekrana 4 nosi `&dubina=brzo`; ekran 4 prvo pita bez naplate, da istekla kombinacija ne pokrene skeniranje tiho.
- „Sakrij" traku piše `onboarding_skipped_at` i oznaku `traka` u `onboarding_hints_seen`.
- Dugme „Otključaj" na kartici nije primarno (20 kartica = 20 primarnih dugmadi); ponovni `enrich_full` samo uz izričit `ponovi: true`.
- Prazan `/pipeline` = nula redova u `lead_status`; `/lista` crta po 30 kartica.

### Popravke posle S30 — `0025` nad beta nalogom, Clerk webhook
**Isporučeno:** 14.–15. septembar 2026 · izmena `0025` · izvor: prijave sa produkcije

- `0025` briše staro ograničenje plana **pre** `update … set plan = 'komp'`; `check:sql` sada ubacuje beta nalog pre `0025` i proverava prelaz.
- Clerk webhook čita ID događaja iz zaglavlja `svix-id`, ne iz tela.

### Popravke posle S30 — admin bez kredita, lista posle poslednjeg kredita, plan sa fakture
**Isporučeno:** 15. septembar 2026 · migracija `0029` · izvor: prijave iz upotrebe

- `0029`: obe `spend_*` funkcije nalogu sa `role = 'admin'` ne skidaju kredite i ne pišu knjigu; `unlocks`, `search_access` i posao nastaju normalno; dnevni osigurač i Places budžet važe.
- `stanjePristupa()` grana 0: admin je `komp` sa `admin: true` — bez banera, ∞ u bočnoj traci, bez cene u dugmadima.
- Posle poslednjeg kredita plaćeno ostaje otvoreno: `/api/search` servira plaćen pristup i posao u toku, `/api/unlock` pušta već otključan prospekt, `/pretraga` u režimu samo-čitanja; tekst „Nemaš više kredita".
- `invoice.paid` čita plan isključivo sa stavki fakture (`planIzFakture`, `prices.retrieve`) — downgrade kroz schedule šalje fakturu pre `subscription.updated`.

**Odstupanja koja i danas važe:**
- Samo uloga iz baze pravi admina bez kredita, ne `ADMIN_BOOTSTRAP_IDS` (SQL ne vidi env).
- Na `dahlia` stavka fakture nema `price` objekat; faktura van kataloga je `preskočeno` sa 200.
- Stara cena posle promene cene ostaje bez `lookup_key` — pre prve promene cene treba rezerva (checklista, „Posle lansiranja").

### Popravke posle S30 — povraćaji, `cancel_at`, spor
**Isporučeno:** 15.–16. septembar 2026 · migracije `0030`–`0033` · izvor: prijave iz Stripe sandboxa

- `0030`: `credit_ledger.balance_after`; `admin_adjust_credits(povracaj)` odseca na pod −1000 (`odseceno` / `na_podu`). `charge.refunded` nalazi fakturu kroz `invoicePayments.list`; izgubljen spor (`charge.dispute.closed`, `lost`) skida kredite.
- `0031`: `subscriptions.cancel_at`; otkaz kroz portal na `dahlia` stiže kao `cancel_at`, ne kao `cancel_at_period_end`; stanje `otkazan` i `trajeDo` čitaju `cancel_at`.
- `0032`: `apply_refund` i `credit_ledger.details` — povraćaj skida **sumu `delta` redova te naplate**, jedan red, bez granice od 500; paket iz dopune, pretplata iz balansa.
- `0033`: ključ povraćaja je **ID refunda** (`povracaj:<re_…>` iz `refunds.list`); preliv duga paketa u balans piše `admin_audit` red `refund_preliv`.
- `pnpm check:f4` dobio trku od 20 paralelnih plaćanja iste liste; stare tvrdnje iz F4 ispravljene za dve kase.

**Odstupanja koja i danas važe:**
- Refund fakture posle downgrade-a (delta −450) ne skida ništa, a refund prve fakture posle probe ostavlja 10 probnih — svesno, ispravlja se ručno iz konzole.
- `canceled_at` ne ulazi u odluku o stanju (Stripe ga postavlja već pri zakazivanju otkaza).
- Deterministički `ref_id` za plaćanje liste je odbijen: pristup traje 30 dana, pa se ista kombinacija posle isteka legitimno plaća ponovo; brana od duple naplate je `for update` nad profilom.

### Popravka posle S30 — skeniranje bez liste vraća kredit samo
**Isporučeno:** 16. septembar 2026 · migracija `0034` · izvor: prijava iz upotrebe

- `0034`: razlog `scan_refund` (ref `scan_refund:<job_id>`, `details` sa poslom i kombinacijom); `refund_scan` kod punog povraćaja briše `search_access` i piše `admin_audit`; nova `fail_scan_and_refund(job, error)` obara posao i vraća kredit u jednoj transakciji.
- Worker na neupisan registar zove `failScanAndRefund` (marker `bez_liste:` u `last_error`) umesto da posao završi kao `done`.
- Ponavljanje iste pretrage je dozvoljeno i naplaćuje se normalno; `scanBezRegistra` i grana `503` obrisani.
- Tekstovi stanja skeniranja A–F žive u `apps/web/src/lib/stanja-skeniranja.ts`; `JobStatusResponse.vraceno` nosi broj vraćenih kredita iz knjige.

**Odstupanja koja i danas važe:**
- Stari oblik povraćaja (`refund` + `scan:<job>`) i dalje važi kao dokaz da je posao refundiran.
- Broj posla, „keš" i zadatak korisniku ne smeju u tekst stanja — test to drži; stanje D upućuje na blok „Tvoji pristupi" na dnu `/pretraga`.
