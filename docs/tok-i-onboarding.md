# 02 — Tok korisnika, onboarding, feedback, kartica prospekta

> Datum: 10. septembar 2026. Izvor: `SAJTOSKOP-SUMMARY.md`, `00-MASTER-PLAN-SESIJE.md` §0, `01-stripe-migracija.md`, repo `remati037/sajtoskop` na grani `master` (commit `3d00a67`, „S25: Stripe backend, Paddle removed, paid cache access“) i repo `remati037/sajtoskop-website` (`master`). Odluke D1–D13 i A1–A8 se ne otvaraju.
>
> Skraćenice u celom dokumentu: **L** = `https://www.sajtoskop.com`, **A** = `https://app.sajtoskop.com`.

## 0. Šta je u kodu drugačije nego što plan pretpostavlja, i odluke koje ovaj dokument donosi

| # | Nađeno | Gde | Posledica | Rešeno |
|---|---|---|---|---|
| C1 | **Nov nalog dobija 0 kredita** (`KREDITI_NA_REGISTRACIJI = 0`), a `create_profile_with_grant` dodeljuje sa razlogom `monthly_grant` u `credits_balance`. `grant_credits` u 0025 puni `credits_topup` samo za `credit_pack`. Odluka O1 (LANSIRANJE §1.8, kredit dobrodošlice u `credits_topup`) **nije ugrađena** — S27 je nije stigao, a 0025 je preskočio. | `apps/web/src/lib/profile.ts`, `0024`, `0025` | Ko se registruje bez kartice završi na `/zakljucano` pre nego što išta vidi | O2, migracija `0026` (§4.3, K4) |
| C2 | **D10 čini prvu listu plaćenom, i iz keša.** S27 je onboarding gradio na „prvi rezultat iz keša je besplatan“; `spend_credit_and_scan` iz 0025 ishod `cached` naplaćuje `ceil(total/20)` kredita. Jedan kredit dobrodošlice više ne pokriva „lista + prvi prospekt“. | `0025 §6`, LANSIRANJE §1.8 | Onboarding sa 1 kreditom staje posle liste, pre otključavanja — tačno tamo gde O1 nije hteo | O2: **2 kredita** |
| C3 | **Kad potroši besplatne kredite, nalog bez pretplate pada u `zakljucan`, ne u `grace`** — `stanjePristupa()` računa grace iz `punDo`, a nov nalog nema nijedan datum. Čovek koji je upravo otključao prvi prospekt i kopirao poruku gubi pristup i toj poruci. | `packages/shared/src/pristup.ts` grana 4 | Aha momenat se briše sekund pošto nastane | O3 |
| C4 | **`/api/unlock` i dalje govori o beti**: „Nemaš dovoljno kredita. Beta plan dobija 30 kredita prvog u mesecu.“ Isti tekst u `pretraga-ekran.tsx` toastu za 402. | `app/api/unlock/route.ts` | Prvi plaćeni korisnik čita o beti | K4 |
| C5 | **Otključavanje ne javlja kad je `enrich_full` gotov.** `UnlockResponse` ne nosi ID posla; klijent ne poluje; `snimak.tsx` kaže „Osveži stranicu za koji trenutak“. | `lib/unlock.ts`, `search-types.ts`, `snimak.tsx` | Stanje „otključavanje u toku“ iz D12 nema na šta da se osloni | §7.4, K4 |
| C6 | **Brisanje naloga ne otkazuje Stripe pretplatu.** `user.deleted` webhook radi kaskadu nad profilom; `stripe_customer_id` nestane sa redom, a pretplata u Stripe-u ostaje i dalje se naplaćuje nalogu koga nema. | `app/api/webhooks/clerk/route.ts` | Chargeback sa sigurnošću | §2.5, K4 |
| C7 | **Landing nema link za prijavu**, ni `/povracaj`, ni `/bot`; `signUpUrl` vodi na `/sign-up` koji ne postoji; futer linkuje sopstvene kopije `/uslovi` i `/privatnost`. UA workera nosi `https://sajtoskop.com/bot` → 404. | `lib/site.ts`, `site-header.tsx`, `content.ts` `footer`, `apps/worker/src/lib/user-agent.ts` | R36 nije izvršen | §3, K7 |
| C8 | **Feedback sistem je pisan za betu**: pitanje `cena` („Beta se jednom završava“), `KRAJ_BETE` kao rok svih pitanja, naslov „Beta dnevnik“, „Pretraga · beta“ u panelu, rečenica „Ovo ne menja tvoj pristup u beti“. | `feedback-katalog.ts`, `dashboard/page.tsx`, `utisak-dugme.tsx` | Plaćeni korisnik čita da je u beti | §5, K5 |
| C9 | **`Poziv` nije kanal poruke** — `MessageChannel = mejl \| viber \| instagram`; `poziv` postoji samo kao `ContactChannel` u `lead_status`. Kartica iz D12 nudi „Viber / mejl / poziv“. | `packages/shared/src/outreach.ts` | Kartica bez teksta za fiksni telefon | §7.2 (tab Poziv = tekst Viber šablona pod naslovom „Šta da kažeš“ + `tel:` dugme; bez AI varijante) |

### Odluke koje ovaj dokument donosi (ne otvaraju se u K sesijama)

- **O2 — Kredit dobrodošlice je 2, ne 1**, oba u `credits_topup`, razlog `onboarding`, `ref_id = signup:<user_id>`, dodela u `create_profile_with_grant`. Jedan za prvu listu iz keša (D10 je naplaćuje), jedan za prvi prospekt. Trošak: €0 + €0,024. Nalog bez kartice ulazi u `dopuna`. Nalog u probi ima 10 + 2 = 12; troši prvo `credits_balance`, pa `credits_topup` (0022), pa 2 ostaju posle probe — prihvatljivo, vrede €0,05.
- **O3 — Svaki nalog sme da čita 30 dana od registracije ili od isteka pristupa, šta je kasnije.** `ProfilZaPristup` dobija `createdAt`; u grani 4 `stanjePristupa()` grace se računa nad `kasniji(punDo, createdAt)`. Nalog koji potroši 2 besplatna kredita čita svoju listu, prospekt i poruku 30 dana, ne troši ništa. `/zakljucano` posle toga. Jedan test u `test/pristup.ts`.
- **O4 — Čarobnjak je `/pocetak`**, tri koraka (grad → niša → kanal), plus četvrti ekran „Prva lista“ koji je istovremeno potvrda cene (D10 traži potvrdu za svako prvo otvaranje kombinacije; ovde je to isti klik). Stanje u `profiles.onboarding_*`, ne u `localStorage`-u.
- **O5 — Kartica prospekta zamenjuje red tabele** na `/pretraga` i `/lista` (D12). Jedna komponenta `KarticaProspekta`, jedan `PublicLead`, pet stanja (§7). Tabela `lead-tabela.tsx` se briše; CSV izvoz ostaje.
- **O6 — Vodič na zahtev i vođen prolaz koriste iste četiri tačke** definisane jednom u `packages/shared/src/onboarding.ts` (tekst + ključ koraka). Ista četiri koraka su i traka napretka. Tri prikaza, jedan izvor.

---

## 1. Kompletan tok — landing → naplata → prva poruka

Aha momenat: **otključana kartica sa telefonom, konkretnim problemima i porukom koju može da kopira.** Cilj: **ispod 90 sekundi od `/welcome`** (čarobnjak ≈ 20 s, lista odmah, otključavanje 10–40 s dok worker radi, poruka odmah). Bez ijednog Places poziva.

### 1.1 Posetilac na landingu — `L/`

| | |
|---|---|
| Vidi | 11 sekcija (SUMMARY §3.2). Svako dugme nosi `data-umami-event="cta-click"` i `source`. |
| Baza | Ništa. Umami događaj `cta-click`; `captureAttribution()` u `sessionStorage` (ostaje samo za waitlist fallback). |
| Pođe po zlu | Klik vodi na `/sign-up` → 404 u aplikaciji (C7). Ad-blocker obori Umami — `track()` ne baca, klik prolazi. |
| Hvata se | K7 menja sve URL-ove po §3. Umami `cta-click` po `source` pokazuje koji CTA radi. |

### 1.2 Klik na plan — `A/cenovnik?plan=<slug>&ciklus=<mesecno|godisnje>`

Slugovi: `starter` · `pro` · `advanced`. Ciklus na srpskom (`CIKLUS_IZ_LINKA` u `cenovnik-namera.ts`). Generički CTA (hero, header, završni) vodi na `A/cenovnik?plan=pro&ciklus=mesecno` — Pro je istaknut plan.

| | |
|---|---|
| Vidi | Cenovnik aplikacije, Pro kartica preselektovana (dugme primarno), red iznad kartica „Proba 7 dana, 10 kredita, kartica odmah, prva naplata osmog dana“ (K2). Iznosi iz `plans.ts`. Dole: „Plaćanje preko firme uz fakturu — javi se na podrska@sajtoskop.com.“ |
| Baza | Ništa. `/cenovnik` je javan; sesija se samo čita. |
| Pođe po zlu | Nepoznat slug ili ciklus → `citajNameru()` vraća `BEZ_NAMERE`, nijedna kartica nije preselektovana; nema greške. Iznos na landingu ≠ `plans.ts` → R35 (ručna provera pri svakoj izmeni cene). |
| Hvata se | `test/veze.ts` i `test/cenovnik.ts` već proveravaju slugove; K7 ne sme da doda četvrti slug. |

### 1.3 Gost klikne „Uzmi Pro“ — `A/?nalog=nov&nazad=%2Fcenovnik%3Fplan%3Dpro%26ciklus%3Dgodisnje`

| | |
|---|---|
| Vidi | Klik šalje `POST /api/billing/checkout` → `401` → `cenovnik-ekran.tsx` radi `location.href = naRegistraciju(nazad)`. Strana `/` sa karticom **Registracija** (jer `nalog=nov`), Google dugme i mejl + lozinka. Levo tri svojstva, dole „Nalog otvaraš odmah i besplatno…“. |
| Baza | Ništa. |
| Pođe po zlu | `?nazad=` sa tuđim domenom → `internaPutanja()` vraća `null` → posle ulaska ide na `/pretraga`, namera se gubi ali nema otvorene redirekcije. Ulogovan korisnik u drugom tabu → `/` ga odmah vodi na `nazad`. |
| Hvata se | Postoji od S18. K7 ne sme da sastavlja `nazad` na landingu — landing linkuje **samo** `/cenovnik?...`, aplikacija sama pravi `nazad`. |

### 1.4 Registracija — Clerk (Google ili mejl)

| | |
|---|---|
| Vidi | Google: jedan klik, povratak. Mejl: adresa + lozinka → šestocifren kod iz mejla (Clerk šablon, srpski od K6/P4). `fallbackRedirectUrl = nazad`. |
| Baza | Clerk `user.created` → `POST /api/webhooks/clerk` (Svix potpis, `webhook_events` dedup) → `create_profile_with_grant(user, email, 2, 'signup:<id>')` → red u `profiles` (`plan = dopuna`, `credits_topup = 2`, `country_code = RS`), red u `credit_ledger` (`onboarding`, +2). Ako webhook zakasni: `ensureProfile()` u `(app)/layout.tsx` i u checkout ruti radi isto, idempotentno po `ref_id`. |
| Pođe po zlu | Webhook ne stigne **i** korisnik ode pravo u checkout → checkout ruta zove `ensureProfile` pre novca (već tako). Dupli `user.created` (Clerk ponavlja) → `credit_ledger_grant_idem_idx` odbija drugu dodelu, vraća `already_granted`. Isti mejl, drugi provajder (Google pa mejl) → Clerk spaja u isti nalog ako je „account linking“ uključen (R: proveri u Clerk panelu; podrazumevano jeste za verifikovan mejl). |
| Hvata se | `select reason, delta, ref_id from credit_ledger where user_id = :id` — tačno jedan red `onboarding`. Kanarinac iz S25 prolazi isti put. |

### 1.5 Povratak na cenovnik sa preselekcijom — `A/cenovnik?plan=pro&ciklus=godisnje`

| | |
|---|---|
| Vidi | Isti ekran, sad ulogovan; Pro godišnje preselektovan. Klik „Uzmi Pro“ → dugme u stanju „Čekaj…“. |
| Baza | `POST /api/billing/checkout {vrsta: "plan", plan: "pro", ciklus: "year"}` → `ensureProfile` → `stanjePristupa` = `dopuna` (2 kredita, nema pretplate) → `stripe.customers.create` → `profiles.stripe_customer_id` → `checkout.sessions.create(mode: subscription, trial 7d, payment_method_collection: always)` → `{ url }` → `location.assign(url)`. |
| Pođe po zlu | `409` „Već imaš plan“ (drugi tab je već kupio) → tekst + link na `/krediti`. `409` komp → tekst. `503` `KonfigGreska` → „Naplata još nije podešena…“ (R39/R40). `502` Stripe ne radi → „Pokušaj ponovo za koji minut“. Rate limit `billing-checkout` po IP. |
| Hvata se | `pnpm stripe:doktor` pre svakog deploya (svih 8 `lookup_key`). Sentry (S26) na `502`. |

### 1.6 Stripe Checkout — `checkout.stripe.com/c/pay/cs_…`

| | |
|---|---|
| Vidi | Stripe hosted strana: logo, akcenat, „Sajtoskop Pro — 7 dana besplatno, zatim €590,00 godišnje od 17.9.2026“, kartica (broj, rok, CVC), ime, država; bez adrese, bez PIB-a. Dugme „Započni probni period“ (Stripe lokalizuje po `locale: auto`; ako pregledač nije na srpskom, engleski). Link „Nazad“ → `cancel_url`. |
| Baza | Ništa dok Stripe ne pošalje webhook. `client_reference_id = Clerk user_id`, `metadata.user_id`, `metadata.plan/ciklus/lookup_key`. |
| Pođe po zlu | Kartica odbijena na setup-u → Stripe pokazuje grešku, ostaje na Checkout-u. Zatvorio tab → ništa nije napravljeno osim `stripe_customer_id`; sledeći klik pravi novu sesiju sa istim customerom. „Nazad“ → `A/cenovnik?plan=pro&ciklus=godisnje` (K1 sklapa `cancel_url` tako). Otisak kartice već viđen na drugom nalogu → posle `checkout.session.completed` `trial_end: now` (naplaćuje odmah, §7.6 iz 01) — korisnik to vidi na `/welcome` kao „plan aktivan“ umesto „proba do“. |
| Hvata se | Stripe Dashboard → Payments → Checkout sessions (napuštene se vide). Radar pravilo za otisak. |

### 1.7 Success URL — `A/welcome?sesija=cs_…`

| | |
|---|---|
| Vidi | „Plaćanje je primljeno“ → K2 menja u: naslov **„Proba je počela“**, tekst „Pro, godišnje. Proba traje do **17.9.2026**, tada se kartica naplaćuje €590. Do tada imaš **10 probnih kredita** plus 2 dobrodošlice. Račun stiže mejlom posle svake naplate.“ (iz `sessions.retrieve`, samo za tekst). Dugme primarno **„Napravi prvu listu“** → `/pocetak`. Sekundarno „Stanje kredita“ → `/krediti`. Bez `?sesija` (otvoren rukom): isti ekran, opšti tekst. |
| Baza | Webhookovi, bilo kojim redom: `checkout.session.completed` (pretplata: samo `invite_id = null`, otisak kartice u `trial_fingerprints`), `customer.subscription.created` (`trialing`) → `apply_subscription` (`profiles.plan = pro`, `plan_expires_at = trial_end`, red u `subscriptions`) + `apply_trial_start` (`credits_balance = 10`, ledger `trial_grant`, ref `trial:<user>`), `invoice.paid` sa `amount_due = 0` → ništa. `billing_events` po `event_id`. |
| Pođe po zlu | Webhook stigne posle `/welcome` → strana to i kaže („aktivira se za koji sekund“); `/pocetak` čita profil iznova pri svakom učitavanju. Webhook nikad ne stigne (endpoint nije registrovan, R39) → korisnik ima 2 kredita, `dopuna`, čarobnjak radi, na `/krediti` nema probe → Sentry alarm na `billing_events` bez novih redova 10 min posle `checkout.session` (S26). |
| Hvata se | §12 scenario 2 iz 01 (test clock). `/krediti` mora da pokaže „Proba do 17.9.“. |

### 1.8 Onboarding — `A/pocetak`

Kapija: svaka strana u `(app)` posle `zahtevajCitanje()` zove `zahtevajOnboarding(profile, pristup)`: ako `pristup.pun && onboarding_done_at IS NULL && onboarding_skipped_at IS NULL` → `redirect("/pocetak")`. `/pocetak` sama: ako nije `pun` ili je već gotov/preskočen → `redirect("/pretraga")`. Layout ne sme da radi redirekciju (ne izvršava se na klijentskoj navigaciji, isti razlog kao kapija pristupa).

| | |
|---|---|
| Vidi | Tri ekrana po 5–8 s i četvrti sa cenom (tekstovi u §4.2). Kombinacije samo iz `search_cache` (`listaKesa()`, `fresh = true`). |
| Baza | Svaki korak: `POST /api/onboarding/korak {korak, vrednost}` → `profiles.onboarding_city/niche/channel`. Poslednji ekran: `POST /api/search {city, niche, dubina: "brzo", pay: true}` → `spend_credit_and_scan` → `cached` → `search_access` red (1 stranica, 30 dana), ledger `scan` −1, `onboarding_steps.pretraga = now()`. |
| Pođe po zlu | Keš prazan (nova baza) → ekran „Trenutno nema gotovih lista“ + dugme „Idi na pretragu“ (skeniranje košta normalno). Kombinacija istekla između ekrana 1 i 4 (30-dnevni rok) → `/api/search` vraća `needs_scan` sa `kind: osvezavanje` → ekran 4 se ponovo crta sa novom cenom i rečenicom „Ova lista je upravo istekla, osvežavanje košta isto“. Nema kredita (`insufficient_credits`, nemoguće sa 2, moguće posle probe) → `402` → link na `/cenovnik`. |
| Hvata se | SQL iz §4.7 (koliko naloga je stiglo do svakog koraka). Nula Places poziva: `api_budget` se ne menja tokom onboardinga — proveri u S25 metrici. |

### 1.9 Prva pretraga — `A/pretraga?grad=sabac&nisa=pvc-stolarija`

| | |
|---|---|
| Vidi | Lista kartica (§7), zeleni bedževi „Nema sajt“ prvi, rečenica iznad liste „Zeleni bedževi su najbolji prospekti — firme koje sajt uopšte nemaju.“, vođena tačka 1 uz prvi zeleni bedž (§4.5). Traka napretka u bočnoj traci: korak 1 štikliran. Header: „11 kredita“ (12 − 1). |
| Baza | `GET`/`POST /api/search pay:false` → `has_search_access` = true → `searchCachedLeads`. `searches` red za istoriju. |
| Pođe po zlu | `search_access` nije upisan (trka između ekrana 4 i redirekcije) → `needs_scan` → modal cene sa `already_paid` posle drugog klika (RPC je idempotentan). Lista prazna zbog filtera → prazno stanje „Filteri su preuski“ sa dugmetom „Skini filtere“. |
| Hvata se | `select * from search_access where user_id = :id` — tačno jedan red. |

### 1.10 Prvo otključavanje — ista strana, kartica

| | |
|---|---|
| Vidi | Dugme na prvoj kartici bez sajta: **„Otključaj · prvi je besplatan“** (dok `credits_topup ≥ 1` i nijedan `unlocks` red). Klik → bez modala potvrde za besplatan (modal „1 kredit“ ide tek od drugog, §7.3) → kartica prelazi u stanje „u toku“ (§7.4): telefon i mejl odmah (iz `enrich_basic`), skeleton na snimku i problemima, „Analiziram sajt… obično 10–40 s“. Kad worker završi: problemi, snimak, poruka. |
| Baza | `POST /api/unlock {placeId}` → `spend_credit_and_unlock` (`FOR UPDATE`) → `unlocks (user_id, place_id)`, ledger `unlock` −1 → `enqueueEnrichFull` → `job_queue` (`enrich_full`, dedupe po `place_id`) → worker: screenshot desktop + mobilni → Storage, PageSpeed, Claude vision → `website_audits`. `onboarding_steps.otkljucavanje = now()` upisuje `unlockLead` kad je to prvi `unlocks` red. |
| Pođe po zlu | `enqueueEnrichFull` padne → kredit skinut, red upisan, posao nije → kartica posle 60 s pollinga prelazi u stanje greške „Analiza nije stigla“ sa dugmetom „Pokušaj ponovo“ (`POST /api/unlock` isti `placeId` → `alreadyUnlocked`, K4 dodaje ponovni enqueue kad `website_audits` nema `enrich_full` polja). Sajt nedostupan → status `mrtav`, bez snimka — to je dobar lead, kartica to i kaže (§7.6). Screenshot pao a PSI/AI prošli → „Snimak nije sačuvan“ (postojeća logika iz `snimak.tsx`). |
| Hvata se | `select status, attempts, error from job_queue where type = 'enrich_full' and payload->>'placeId' = :pid`. |

### 1.11 Prva poruka — ista kartica, blok „Predlog poruke“

| | |
|---|---|
| Vidi | Tab po `phone_type` (mobilni → Viber, fiksni → Poziv, bez telefona → Mejl; iz čarobnjaka `onboarding_channel` ima prednost ako je primenljiv). Tekst, „Kopiraj“, „Napiši drugačije“ (AI, 0 kredita, dnevni limit), vođena tačka 3 uz tabove. Klik na „Kopiraj“: toast **„Kopirano. Označi kao kontaktiran?“** sa dugmetom **„Kontaktiran“** → pipeline. |
| Baza | `GET /api/poruke?placeId` (šablon, bez baze). „Kopiraj“ → `POST /api/onboarding/korak {korak: "poruka"}`. „Kontaktiran“ → `POST /api/pipeline` → `lead_status (status = kontaktiran, channel = viber)` → `onboarding_steps.pipeline = now()`, `onboarding_done_at = now()` kad su sva četiri, traka nestaje uz „Sva četiri koraka. Sad znaš sve.“ |
| Pođe po zlu | `aiSolidan = true` (Claude kaže da je sajt u redu) → generator odbija; blok kaže „Sajt izgleda solidno — ovde nema šta da se ponudi. Pogledaj sledeći prospekt.“ Clipboard API bez HTTPS/na starom pregledaču → fallback `execCommand('copy')` + ručno selektovan tekst. |
| Hvata se | `onboarding_steps` čitljiv jednim upitom (§4.7). Metrika S25 „prva poruka“ = `onboarding_steps->>'poruka' is not null`. |

### 1.12 Korisnik koji se registruje a NE kupi ništa

Tri puta do ovog stanja: (a) došao pravo na `A/` i napravio nalog; (b) sa cenovnika kliknuo „Nazad“ na Stripe Checkout-u; (c) zatvorio Checkout tab. U sva tri: `profiles.plan = dopuna`, `credits_topup = 2`, `subscriptions` prazno (u (b)/(c) ima `stripe_customer_id`). `stanjePristupa` = **`dopuna`** (grana 3), `pun = true`, `planLimita = dopuna` (30 skeniranja/dan, 500 CSV, 5 AI varijanti).

| Ekran | Šta vidi |
|---|---|
| `/pretraga` (Clerk `fallbackRedirectUrl`) | Kapija onboardinga → `/pocetak`. Isti čarobnjak. Ekran 4 kaže „**Imaš 2 besplatna kredita**: ovaj za listu, sledeći za prvi prospekt.“ |
| Baner (nov, u `pristup-baner.tsx`, stanje `dopuna` **bez** ijednog `credit_pack` reda) | „Nemaš plan. Dobio si 2 kredita da probaš: jedna lista, jedan prospekt. **Plan počinje sa 7 dana probe i 10 kredita, kartica se naplaćuje tek osmog dana.**“ Link „Pogledaj planove“ → `/cenovnik?plan=pro&ciklus=mesecno`. Stoji dok je `dopuna` bez paketa; nestaje sa pretplatom. |
| Header čip kredita | „2 kredita“ → „1 kredit“ → „0 kredita“. |
| Posle oba kredita | O3: stanje **`grace`** do `created_at + 30 dana`. Baner grace dobija granu: umesto „Pristup ti je istekao <datum>“ → **„Besplatni krediti su potrošeni.** Do <datum> možeš da otvaraš svoj prospekt, poruku i pipeline. Za nove liste i otključavanja treba plan — 7 dana probe, kartica se naplaćuje osmog dana.“ Link „Počni probu“. `/pretraga` prazno stanje: naslov **„Probao si besplatno. Za dalje treba plan.“**, primarno „Počni probu · 7 dana“ → `/cenovnik?plan=pro&ciklus=mesecno`. |
| Posle 30 dana | `zakljucan` → `/zakljucano`, grana bez `punDo`: naslov **„Nalog čeka plan“**, tekst „Besplatne kredite si potrošio <datum>, a rok za čitanje je prošao <datum>. Ništa nije obrisano — sa planom se sve vraća.“ Dugme „Pogledaj planove“. |

Sme: jedna lista iz keša (1 kredit), jedno otključavanje (1), sve tri poruke i AI varijante (limit 5/dan), pipeline, CSV izvoz (500 redova/dan), utisak. **Ne sme:** paket kredita (`smeDaKupiPaket(dopuna) = false` → checkout `403` sa porukom „Paket kredita je dopuna uz aktivan plan…“), drugo skeniranje.

Povratak na cenovnik: baner (uvek), prazno stanje `/pretraga`, dugme „Otključaj“ na drugoj kartici (kad je `credits = 0`: tekst **„Otključaj · treba plan“**, klik → modal „Nemaš kredita. Plan počinje sa 7 dana probe i 10 kredita.“ → „Pogledaj planove“), i tri mejla u 7 dana (P4: dan 0 dobrodošlica, dan 2 „ovo je tvoja lista“, dan 6 „proba je besplatna 7 dana“).

### 1.13 Korisnik sa pozivnicom

Link iz admin konzole: `A/pozivnica/SAJT-XXXX-XXXX` (K3). Javna strana, nije u `(app)` grupi.

| Korak | Komp | Prvi mesec gratis |
|---|---|---|
| Neprijavljen | `/?nalog=nov&nazad=/pozivnica/SAJT-…` → registracija (2 kredita dobrodošlice, kao svi) → nazad | isto |
| Strana | Naslov „Pozivnica“, ispod: „Komp pristup do <datum> / neograničeno, <N> kredita“ | „Prvi mesec gratis. Kartica se vezuje, naplata od drugog meseca.“ |
| Klik „Prihvati“ | `POST /api/pozivnice/prihvati` → `redeem_invite` → `admin_open_komp` (`plan = komp`, `komp_expires_at`, ledger `komp_grant`, `access_invite_redemptions`) | `redeem_invite` → `profiles.invite_id` |
| Zatim | `redirect("/pocetak?pozivnica=komp")` — čarobnjak, prvi ekran ima red iznad naslova „Komp pristup do <datum>, <N> kredita“. (Ne `/dashboard` sa tostom kako 01 §9.4 kaže — kapija onboardinga bi tost progutala.) | `redirect("/cenovnik?pozivnica=1")` → bedž „Prvi mesec €0“ → checkout sa kuponom, bez probe → `/welcome` naslov **„Plan je aktivan“** → `/pocetak` |
| Greške | `not_found` „Kod ne postoji.“ · `used_up` „Kod je već iskorišćen.“ · `expired` „Pozivnica je istekla.“ · `wrong_email` „Pozivnica je za drugu adresu.“ · `already_redeemed` „Već si iskoristio pozivnicu.“ · `has_subscription` „Već imaš plan.“ | isto |
| Baza posle | `stanjePristupa` = `komp`, limiti Advanced, checkout plana → `409` | `subscriptions.status = active`, `trial_end = null`, `invoice.paid` `amount_due = 0` + `total_discount_amounts > 0` → 450 kredita |

Vlada dobija komp (A3). Njegov komp nalog prolazi isti čarobnjak — to je i scena za video.

---

## 2. Životni ciklus — otkazivanje, pad kartice, grace, zaključano, brisanje

Sve odluke o stanju donosi `stanjePristupa()` (sedam stanja). Ovde je šta korisnik vidi i šta se upisuje.

### 2.1 Otkazivanje — `A/krediti` → „Upravljaj pretplatom“ → `billing.stripe.com/p/session/…`

| | |
|---|---|
| Vidi | Portal (srpski ako Stripe ima prevod, inače engleski): „Cancel plan“ → razlog (Stripe skuplja, §8 iz 01) → potvrda. Portal kaže „Your plan will be canceled on 17.10.2026“. Povratak (`return_url`) → `/krediti`: `pretplata-blok` naslov **„Pretplata otkazana, traje do 17.10.2026“**, tekst „Do tada radi sve. Posle toga imaš još 30 dana da izvezeš svoje prospekte i pipeline. Predomislio si se? Vrati plan kroz portal.“ Baner `otkazan` (plavi, postojeći). |
| Baza | `customer.subscription.updated` (`cancel_at_period_end = true`) → `apply_subscription` → `subscriptions.cancel_at_period_end`, `canceled_at`; `profiles.plan_expires_at` ostaje `current_period_end`. `stanjePristupa` = `otkazan`, `pun = true`. Krediti netaknuti. |
| Na kraju perioda | `customer.subscription.deleted` → `apply_subscription(canceled)` + `expire_subscription_credits` (ledger `expire`, `credits_balance = 0`; `credits_topup` ostaje). Stanje: `dopuna` ako je kupio paket, inače `grace` 30 dana. |
| Reaktivacija u periodu | Portal „Renew plan“ → `updated` sa `cancel_at_period_end = false` → `aktivan`, nula novih ledger redova. |
| Otkazana proba | `trialing` + `cancel_at_period_end` → `otkazan` sa `punDo = trial_end`. Baner: „Proba otkazana, traje do <datum>. Kartica se neće naplatiti.“ Na `trial_end` Stripe šalje `deleted` → probni krediti istek → `grace`. |
| Pođe po zlu | Portal sesija bez `stripe_customer_id` → `404` na `POST /api/billing/portal` → dugme kaže „Nemaš pretplatu“. Korisnik otkaže pa obriše nalog → §2.5. |

### 2.2 Istek probe bez kartice koja prolazi

Dan 8, 00:00 UTC po `trial_end`:

| Trenutak | Stripe | Baza | Korisnik vidi |
|---|---|---|---|
| Dan 8 | `invoice.payment_failed` (`subscription_cycle`), `subscription.updated` → `past_due` | ledger ništa; `subscriptions.status = past_due`; `plan_expires_at` ostaje dan 8 (§7.1/§7.5 iz 01) | `stanjePristupa` = **`grace`** (datum prošao, nema topup). Baner: **„Naplata nije prošla.** Kartica je odbijena 17.9. Ažuriraj karticu i plan se nastavlja; do 17.10. možeš da čitaš svoje prospekte.“ + dugme „Ažuriraj karticu“ → portal. `/pretraga` prazno stanje sa istim tekstom. |
| Dan 8–15 | Smart Retries 4× | na uspeh: `invoice.paid` → `apply_invoice_paid` (150/450/1200), `updated` → `active`, `plan_expires_at = +30d` | `aktivan`, baner nestaje, krediti puni. |
| Dan 15 | poslednji neuspeh → Stripe otkazuje (§2.2 iz 01) → `subscription.deleted` | `apply_subscription(canceled)` + `expire_subscription_credits` (ostatak probnih na 0) | i dalje `grace` do dana 38 (`plan_expires_at + 30`). Baner menja tekst na obični grace: „Pristup ti je istekao 17.9.“ |
| Dan 38 | — | — | `zakljucan` → `/zakljucano` (postojeća kopija sa datumima). |

Korisnik sa 2 kredita dobrodošlice u `credits_topup` (nije ih potrošio u probi jer se prvo troši `credits_balance`): grana 3 pretiče grace → stanje `dopuna`, `pun = true`, dva otključavanja. To je tačno i namerno (O2).

Mejlovi: dan 8 „kartica nije prošla“, dan 12 podsetnik, dan 15 „plan je otkazan“ — P4.

### 2.3 Grace — 30 dana čitanja

Stanje `grace` (`pun = false`, `cita = true`) nastaje: istek otkazane pretplate, pad kartice, istek kompa, potrošeni besplatni krediti (O3). Isti baner, tekst po uzroku (`grace` ne nosi uzrok — K4 ga izvodi iz `pretplata.status` i postojanja `unlocks`/`credit_pack`: `past_due` → „Naplata nije prošla“; nema pretplate nikad → „Besplatni krediti su potrošeni“; sve ostalo → „Pristup ti je istekao“).

Sme: `/lista` (čitanje + CSV, dnevni limit plana koji je istekao), `/pipeline` (menja statuse — to je čitanje svog rada), poruke za već otključane prospekte, `/utisci`, `/krediti`. **Ne sme:** `/api/search` (`403` `odbijenica`), `/api/unlock` (`403`), `/api/uvoz` koji otključava, `/api/poruke/ai` (`403`, `ai-poruka`). `/pretraga` crta objašnjenje umesto forme (postoji). Dugme „Otključaj“ na kartici u grace: **„Otključaj · vrati pristup“** → `/cenovnik`.

Izlaz iz grace: plan (proba se ne daje dvaput — `imaoProbuRanije()` — checkout bez probe, naplata odmah, `invoice.paid` → krediti) ili paket (**ne**, `smeDaKupiPaket(grace) = false`; `/zakljucano` i cenovnik to kažu).

### 2.4 Zaključano — `A/zakljucano`

`cita = false`. Svaka strana u `(app)` redirektuje ovamo (`zahtevajCitanje`); API koji čita vraća `403` (`odbijenicaCitanja`). Vidi: postojeći ekran sa tri grane teksta (datumi; O3 grana „Nalog čeka plan“). Jedno dugme „Pogledaj planove“ → `/cenovnik`. Ništa nije obrisano: `unlocks`, `lead_status`, `outreach_messages`, `credit_ledger` stoje. Po kupovini plana `/zakljucano` sam redirektuje na `/pretraga` (postoji).

### 2.5 Brisanje naloga

Put: Clerk `UserButton` → „Manage account“ → „Delete account“ (**mora da bude uključeno u Clerk panelu: User & Authentication → Email, Phone, Username → „Allow users to delete their accounts“ — R44**). Alternativa: admin konzola `/admin/korisnici/[id]` → „Obriši“ → `users.deleteUser` → isti webhook.

| | |
|---|---|
| Vidi | Clerk modal „Are you sure? Type DELETE“ (engleski, Clerk ne prevodi ovaj ekran — K6 proveri `localization` za `userProfile.deletePage`). Posle: odjavljen, na `A/`. |
| Baza | `user.deleted` → **K4 dodaje pre kaskade**: pročitaj `stripe_customer_id`; za svaku pretplatu `status in (trialing, active, past_due)` → `stripe.subscriptions.cancel(id, { prorate: false })`; `stripe.customers.update(id, { metadata: { deleted_user: 'true' } })` (customer se ne briše — računi ostaju zbog knjigovodstva). Tek onda `obrisiProfil` → `on delete cascade`: `unlocks`, `credit_ledger`, `searches`, `search_access`, `lead_status`, `outreach_messages`, `feedback`, `feedback_prompts`, `subscriptions`, `access_invite_redemptions`, `trial_fingerprints` (ostaje — otisak je zaštita od ponovljene probe, `user_id` na `set null`). `admin_audit` red (`actor null`, `KASKADA`). |
| Pođe po zlu | Stripe otkaz padne → webhook vraća `500` → Svix ponavlja; profil se ne briše dok Stripe ne prođe (redosled je bitan). Webhook nikad ne stigne → profil visi bez Clerk naloga; nedeljni SQL iz S25 (`profiles` bez `last_seen_at` 60 dana) + ručna provera u Clerk-u. |
| Šta ostaje | `businesses` i `website_audits` (nisu korisnikovi, pravilo iz SUMMARY §4.3). `billing_events` (istorija naplate). Stripe customer + računi. |

---
## 3. Landing veze — svaki CTA i tačan URL

### 3.1 `lib/site.ts` posle K7

```ts
export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.sajtoskop.com";

export type PlanSlug = "starter" | "pro" | "advanced";
export type CycleSlug = "mesecno" | "godisnje";

/** Jedini oblik linka ka kupovini. Slug, nikad price ID (LANSIRANJE §1.7). */
export function planUrl(plan: PlanSlug, cycle: CycleSlug): string {
  return `${appUrl}/cenovnik?plan=${plan}&ciklus=${cycle}`;
}
/** Generički CTA: Pro mesečno je podrazumevan izbor (P3 §4). */
export const startUrl = planUrl("pro", "mesecno");
export const loginUrl = `${appUrl}/`;
export const legalUrl = {
  uslovi: `${appUrl}/uslovi`,
  privatnost: `${appUrl}/privatnost`,
  povracaj: `${appUrl}/povracaj`,
} as const;
// `signUpUrl` se BRIŠE. `ctaMode` ostaje samo za waitlist fallback u sekciji regiona.
```

### 3.2 Spisak CTA-ova

| # | Gde (fajl, `source`) | Tekst | URL posle K7 | Danas |
|---|---|---|---|---|
| 1 | `site-header.tsx` desktop, `CtaButton source="header"` | Počni besplatno | `A/cenovnik?plan=pro&ciklus=mesecno` | `A/sign-up` |
| 2 | `site-header.tsx` desktop, **novo** ghost link levo od 1 | Prijava | `A/` | ne postoji |
| 3 | `site-header.tsx` mobilni meni, `source="mobile-menu"` | Počni besplatno | `A/cenovnik?plan=pro&ciklus=mesecno` | `A/sign-up` |
| 4 | `site-header.tsx` mobilni meni, **novo** ispod 3 | Već imaš nalog? Prijavi se | `A/` | ne postoji |
| 5 | `hero.tsx`, `WaitlistForm source="hero"` u `signup` režimu | Počni besplatno | `A/cenovnik?plan=pro&ciklus=mesecno` | `A/sign-up` |
| 6 | `pricing.tsx`, kartica Starter, `source="pricing-starter"` | Uzmi Starter | `A/cenovnik?plan=starter&ciklus=<mesecno\|godisnje>` po prekidaču | `A/sign-up` |
| 7 | `pricing.tsx`, kartica Pro, `source="pricing-pro"` | Uzmi Pro | `A/cenovnik?plan=pro&ciklus=<…>` | `A/sign-up` |
| 8 | `pricing.tsx`, kartica Advanced, `source="pricing-advanced"` | Uzmi Advanced | `A/cenovnik?plan=advanced&ciklus=<…>` | `A/sign-up` |
| 9 | `pricing.tsx`, **novo** ispod `reassurance`: red o paketima | Dopuna 75 kredita €19 · 200 kredita €49 (samo uz plan) | `A/cenovnik#paketi` | ne postoji |
| 10 | `final-cta.tsx`, `WaitlistForm source="final"` | Počni besplatno | `A/cenovnik?plan=pro&ciklus=mesecno` | `A/sign-up` |
| 11 | `faq.tsx` „ko stoji iza“ | mejl | `mailto:podrska@sajtoskop.com` (menja `site.email`, danas gmail) | gmail |
| 12 | `site-footer.tsx` Proizvod | Kako radi · Za koga je · Cene · Pitanja | `#kako-radi` · `#za-koga` · `#cene` · `#faq` | isto |
| 13 | `site-footer.tsx` Pravno | Uslovi korišćenja | `A/uslovi` | `L/uslovi` (kopija) |
| 14 | `site-footer.tsx` Pravno | Politika privatnosti | `A/privatnost` | `L/privatnost` (kopija) |
| 15 | `site-footer.tsx` Pravno, **novo** | Politika povraćaja | `A/povracaj` | ne postoji |
| 16 | `site-footer.tsx` Pravno, **novo** | Sajtoskop bot | `L/bot` | ne postoji |
| 17 | `site-footer.tsx` Kontakt | Piši mi | `L/kontakt` | isto |
| 18 | `site-footer.tsx`, **novo** uz socials | Prijava u aplikaciju | `A/` | ne postoji |
| 19 | **Sekcija „Region“** (waitlist fallback, jedini preostali `ctaMode=waitlist` element; K7 je pravi iz postojeće forme sa `source="region"`) | Javi mi kad Sajtoskop stigne u HR/BA/ME/MK | `POST /api/waitlist` | forma na `#pristup` |

Sve što ide na `A/cenovnik` nosi i `?utm_source=landing&utm_content=<source>` **ne** — aplikacija ne čita UTM, a Umami `cta-click` po `source` već daje isti podatak bez šuma u URL-u.

### 3.3 Strane koje landing dobija ili menja

| Ruta na L | Šta | Kako |
|---|---|---|
| `L/uslovi`, `L/privatnost` | **redirekcija 308** na `A/uslovi`, `A/privatnost` | `next.config.ts` `redirects()`; stare kopije (`app/uslovi`, `app/privatnost`, `legal-shell.tsx`) se brišu; `sitemap.ts` ih izbacuje |
| `L/povracaj` | redirekcija 308 na `A/povracaj` | isto; Stripe „Support URL“ pokazuje na `L/kontakt`, a portal linkuje `A/povracaj` |
| `L/bot` | **statična strana na landingu** (UA workera je linkuje: `Sajtoskop/1.0 (+https://sajtoskop.com/bot)`; goli domen → 308 na www, pa mora da postoji ovde, ne u aplikaciji) | `app/bot/page.tsx`, kopi u `content.ts` `bot` objektu, `robots.ts` je pušta, `sitemap.ts` je dodaje |
| `L/kontakt` | ostaje | mejl → `podrska@sajtoskop.com` |

**`L/bot` — tekst doslovno** (`content.bot`):

> **Sajtoskop bot**
> Ako si ovde iz logova svog servera: zahtev sa User-Agentom `Sajtoskop/1.0 (+https://sajtoskop.com/bot)` je došao od Sajtoskopa, alata koji ocenjuje kako sajtovi malih firmi u Srbiji rade na telefonu.
>
> **Šta radi.** Otvori početnu stranu, pročita HTML i napravi snimak ekrana kao što bi ga video posetilac. Ne prijavljuje se, ne šalje forme, ne prati linkove dublje od početne strane.
>
> **Koliko često.** Najviše jedan zahtev u sekundi po domenu, najviše nekoliko puta u 30 dana po sajtu.
>
> **Šta poštuje.** `robots.txt` — `Disallow` za `Sajtoskop` ili za `*` znači da sajt ne otvaramo. Ako nas već blokiraš, ne moraš ništa više da radiš.
>
> **Kako da nas blokiraš.** U `robots.txt`:
> ```
> User-agent: Sajtoskop
> Disallow: /
> ```
> Promena se primenjuje pri sledećem obilasku, najkasnije za 30 dana. Za hitno uklanjanje piši na podrska@sajtoskop.com sa domenom — brišemo snimak i skor istog dana.
>
> **Šta čuvamo.** Javne podatke sa Google Mapsa (naziv, adresa, telefon, sajt) do 30 dana, i ocenu sajta koju je bot sam napravio. Detalji su u [Politici privatnosti](https://app.sajtoskop.com/privatnost).

### 3.4 Šta se briše sa landinga

`signUpUrl` · `#pristup` sidro na svim dugmadima osim regiona · `arhiva/*.bak` · kopije `/uslovi` i `/privatnost` · rečenica „pretraga po kešu besplatna“ (D10, P3) · subject „Nova beta prijava“ i tekst waitlist mejla (P3/P4) · `NEXT_PUBLIC_CTA_MODE=waitlist` iz Vercel env-a (R: postaviti `signup`).

---

## 4. Onboarding — spec (S27 + S28)

### 4.1 Aha momenat i vreme

| Trenutak | Sekundi od `/welcome` (kumulativno) | Šta se desi |
|---|---|---|
| Čarobnjak, 3 ekrana | 20 | grad, niša, kanal — sve iz keša |
| Ekran „Prva lista“ + klik | 30 | 1 kredit skinut, `search_access`, redirekcija |
| Lista na ekranu | 32 | 20 kartica, zeleni bedževi prvi |
| Klik „Otključaj · prvi je besplatan“ | 40 | telefon i mejl odmah |
| **Aha: problemi + poruka** | **50–80** | worker `enrich_full` (10–40 s) |
| „Kopiraj“ → „Kontaktiran“ | 90 | traka napretka gotova |

Merilo (F8 §5, S25): `onboarding_steps->>'poruka'` popunjen **i** `last_seen_at` dan posle registracije.

### 4.2 Čarobnjak `/pocetak` — tekst svakog ekrana doslovno

Zajedničko: bez bočne trake i bez gornjeg menija (svoj layout, kao `/welcome`); wordmark gore levo; gore desno **„Preskoči“** (ghost, svaki ekran); dole levo „Nazad“ od drugog ekrana; jedno primarno dugme; **Enter** ide dalje; tačkice 1–4 ispod naslova, bez brojača „1 od 4“; animacija po §8 dizajn sistema (opacity + y, jedna ease kriva, `prefers-reduced-motion` → bez pomaka). `.num` na svakom broju. Obe teme, ≤ 390 px.

**Ekran 1 — grad**

> Eyebrow: `PRVI KORAK OD TRI`
> Naslov: **Gde tražiš klijente?**
> Lede: Prikazujem samo gradove za koje već imam gotove liste — prva lista stiže odmah, bez čekanja.
> Combobox placeholder: `Grad…`
> Ispod svakog grada u listi: `<N> gotovih lista · <M> firmi bez sajta` (iz `search_cache` agregata)
> Dugme: **Dalje**
> Fusnota: Grad koji ne vidiš ovde možeš da skeniraš kasnije, sa pretrage.

Redosled gradova: tier, pa broj svežih kombinacija opadajuće. Ako je `onboarding_city` već upisan (vratio se posle prekida) — preselektovan.

**Ekran 2 — niša**

> Eyebrow: `DRUGI KORAK OD TRI`
> Naslov: **Kome praviš sajtove?**
> Lede: Za **Šabac** imam <N> gotovih lista. Zelena brojka je koliko firmi u niši uopšte nema sajt — to su najlakši razgovori.
> Lista niša kao čipovi, svaki: `PVC stolarija · 41 firma · 24 bez sajta` (zelena brojka), sortirano po `noSite/total` opadajuće
> Dugme: **Dalje**
> Fusnota: Kad izabereš, nišu i grad pamtim kao podrazumevane za pretragu. Menjaš ih kad hoćeš.

**Ekran 3 — kanal**

> Eyebrow: `TREĆI KORAK OD TRI`
> Naslov: **Kako obično kontaktiraš firme?**
> Tri kartice (radio), jedna u redu na telefonu:
> ▸ **Viber** — „Kratka poruka bez linka. Za mobilne brojeve, najviše odgovora.“
> ▸ **Mejl** — „Duža poruka sa primerima. Kad firma ima adresu.“
> ▸ **Instagram** — „Dve poruke: prva bez ponude. Za firme koje žive na mrežama.“
> Dugme: **Dalje**
> Fusnota: Poruku pišem u kanalu koji izabereš; ostala dva su uvek na klik.

**Ekran 4 — prva lista (potvrda cene, D10)**

> Eyebrow: `SPREMNO`
> Naslov: **PVC stolarija · Šabac**
> Tri broja u redu: `41` firmi · `24` bez sajta · `9` sa mrtvim domenom (iz `search_cache`)
> Lede (proba / komp / plaćen): Lista je gotova i stiže odmah. Košta **1 kredit** — imaš **12**.
> Lede (nalog bez plana, `dopuna` bez paketa): Lista je gotova i stiže odmah. Imaš **2 besplatna kredita**: ovaj ide na listu, sledeći na prvi prospekt.
> Dugme: **Otvori listu · 1 kredit**
> Fusnota: Lista ti ostaje 30 dana. Sve što je u njoj već je proverio Sajtoskop bot — telefon, sajt, kako radi na telefonu.

Klik: `POST /api/search {city, niche, dubina: "brzo", pay: true}` → `cached` → `router.replace("/pretraga?grad=…&nisa=…")`. Dugme u stanju „Otvaram…“. Greške u §1.8.

**Preskoči (bilo koji ekran)** → `POST /api/onboarding/preskoci` → `onboarding_skipped_at = now()` → `/pretraga`. Bez potvrde, bez modala — čovek koji zna šta hoće ne sme da bude zarobljen (§1.8). Traka napretka i prazna stanja rade i za njega; vodič na zahtev ga vraća u čarobnjak jednim klikom („Ponovi prve korake“).

**Keš prazan** (nova baza, `listaKesa` bez `fresh`):

> Naslov: **Još nema gotovih lista**
> Lede: Prva lista za tvoj grad nastaje kad je neko skenira — možeš to da budeš ti. Skeniranje košta 1 kredit za 20 firmi.
> Dugme: **Idi na pretragu**

K4 to javlja u odgovoru i seed-uje 15–20 kombinacija pre snimanja (master plan §5).

### 4.3 Migracija `0026_onboarding.sql`

```sql
-- 0026_onboarding.sql — S28: čarobnjak, traka napretka, 2 kredita dobrodošlice (O2), grace od registracije (O3)

alter table profiles
  add column if not exists onboarding_city       text,
  add column if not exists onboarding_niche      text,
  add column if not exists onboarding_channel    text,
  -- jsonb {"pretraga": ts, "otkljucavanje": ts, "poruka": ts, "pipeline": ts}
  -- Jsonb, ne bitmask: S25 metrike traže KAD je korak urađen (medijana do prve
  -- poruke), ne samo da li jeste; ->> 'poruka' is not null je jednako brzo kao
  -- bit, a čitljivo bez legende. Četiri ključa, nikad više — vodič i traka
  -- čitaju isti spisak iz packages/shared/src/onboarding.ts.
  add column if not exists onboarding_steps      jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_done_at    timestamptz,
  add column if not exists onboarding_skipped_at timestamptz,
  -- Koje vođene tačke su nestale zauvek (S28): ["nema-sajt","otkljucaj","poruka","pipeline"]
  add column if not exists onboarding_hints_seen text[] not null default '{}';

alter table profiles drop constraint if exists profiles_onboarding_channel_valid;
alter table profiles add constraint profiles_onboarding_channel_valid
  check (onboarding_channel is null or onboarding_channel in ('viber','mejl','instagram'));

-- O2: dobrodošlica puni credits_topup (inače nalog bez pretplate ostaje zakljucan).
create or replace function grant_credits(
  p_user text, p_amount integer, p_reason text, p_ref_id text default null
)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- … telo iz 0025 nepromenjeno, osim grane ispod …
  if p_reason in ('credit_pack', 'onboarding') then
    update profiles set credits_topup = credits_topup + p_amount where id = p_user;
  else
    update profiles set credits_balance = credits_balance + p_amount where id = p_user;
  end if;
  return query select true, 'granted';
end $$;

-- Dodela na registraciji ide kao `onboarding`, ne `monthly_grant`.
create or replace function create_profile_with_grant(
  p_user text, p_email text, p_credits integer, p_ref_id text
)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_created boolean := false;
begin
  insert into profiles (id, email) values (p_user, p_email)
  on conflict (id) do update set email = coalesce(excluded.email, profiles.email)
  returning (xmax = 0) into v_created;
  if p_credits > 0 then
    perform grant_credits(p_user, p_credits, 'onboarding', p_ref_id);
  end if;
  return query select true, case when v_created then 'created' else 'existing' end;
end $$;

-- Korak trake. Jedini put upisa; ruta ga zove sa userId iz sesije.
create or replace function onboarding_mark_step(p_user text, p_step text)
returns table (steps jsonb, done_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_steps jsonb; v_done timestamptz;
begin
  if p_step not in ('pretraga','otkljucavanje','poruka','pipeline') then
    raise exception 'nepoznat korak %', p_step using errcode = 'check_violation';
  end if;
  update profiles
     set onboarding_steps = case when onboarding_steps ? p_step then onboarding_steps
                                 else onboarding_steps || jsonb_build_object(p_step, now()) end,
         onboarding_done_at = case
           when onboarding_done_at is not null then onboarding_done_at
           when (onboarding_steps || jsonb_build_object(p_step, now())) ?& array['pretraga','otkljucavanje','poruka','pipeline'] then now()
           else null end
   where id = p_user
   returning onboarding_steps, onboarding_done_at into v_steps, v_done;
  return query select v_steps, v_done;
end $$;

-- admin_users_page: dodati onboarding_done_at, onboarding_skipped_at u povratni tip
-- (drop function … pa create, isti obrazac kao 0024/0025 — v. SESIJE.md S25 odstupanje).
```

`KREDITI_NA_REGISTRACIJI = 2` u `profile.ts` (konstanta `ONBOARDING_CREDITS` u `plans.ts`, ne broj u fajlu). Kanarinci iz S25 dobijaju 2 — metrika „prvo otključavanje“ ih već isključuje po fingerprintu.

Koraci se upisuju **sa servera, iz ruta koje ih i rade**, ne iz klijenta: `pretraga` u `/api/search` (prvi `charged`/`already_paid` odgovor), `otkljucavanje` u `unlockLead` (prvi `unlocks` red), `poruka` u `POST /api/onboarding/korak` (jedini klijentski poziv — „Kopiraj“ nema serverski trag) i `pipeline` u `/api/pipeline` (prvi `lead_status` red). Ruta prima `{korak: "poruka"}` samo; Zod `strictObject`.

### 4.4 Prva lista i besplatno prvo otključavanje

- Rečenica iznad liste, samo dok `onboarding_done_at IS NULL`: **„Zeleni bedževi su najbolji prospekti — firme koje sajt uopšte nemaju.“** (S27, tekst zadržan.)
- Dugme na svakoj zaključanoj kartici: **„Otključaj · prvi je besplatan“** kad `credits_topup ≥ 1 && unlocks = 0 && nema credit_pack reda` (server šalje `prviBesplatan: boolean` uz odgovor pretrage — klijent ne računa). Inače **„Otključaj · 1 kredit“**. Klik na besplatno **ne otvara modal** — trošak je nula za korisnika; sve posle njega otvara potvrdu (§7.3).
- Dugme ne važi u `grace`/`zakljucan` (kapija to ionako brani) i posle prvog `unlocks` reda.
- SQL provere: `select count(*) from profiles p where exists (select 1 from unlocks u where u.user_id = p.id) and exists (select 1 from credit_ledger l where l.user_id = p.id and l.reason = 'onboarding')` — koliko naloga je iskoristilo bar jedan kredit dobrodošlice na otključavanje.

### 4.5 Vođen prvi prolaz — četiri tačke uz element

Definicija u `packages/shared/src/onboarding.ts`:

```ts
export const KORACI = [
  { kljuc: "pretraga",     naslov: "Prva lista",         hint: "nema-sajt" },
  { kljuc: "otkljucavanje", naslov: "Prvi prospekt",     hint: "otkljucaj" },
  { kljuc: "poruka",       naslov: "Prva poruka",        hint: "poruka" },
  { kljuc: "pipeline",     naslov: "Prvi u pipeline-u",  hint: "pipeline" },
] as const;
```

Tačka = mali balon (`bg-bg-elev`, `border-border-accent`, strelica ka elementu, širina 260 px, na ≤ 390 px puna širina ispod elementa, nikad preko njega), bez zatamnjenja, bez „Dalje“, bez brojača. Zatvara se na „Jasno“ ili kad se radnja uradi; upis u `onboarding_hints_seen` (`POST /api/onboarding/hint {hint}`), **nikad se ne vraća**. Prikazuje se najviše jedna odjednom, samo dok `onboarding_done_at IS NULL`, i nikad dok je otvoren modal, dok posao radi ili dok utisak-motor pokazuje pitanje (`UtisciProvider` izlaže `pitanjeOtvoreno`).

| # | Uz koji element | Kada | Tekst doslovno |
|---|---|---|---|
| 1 | prvi bedž **Nema sajt** u listi | lista sa ≥ 1 `nema_sajt` sedne | **Ovo je najbolji prospekt.** Firma ima ocene na Googlu, a nema sajt — ne moraš da ubeđuješ da je sajt loš, samo da ga nema. *Jasno* |
| 2 | dugme **Otključaj** na toj kartici | 3 s posle tačke 1, ili odmah ako je 1 već viđena | **Otključavanje otvara telefon, mejl, snimke sajta i gotovu poruku.** Košta 1 kredit; prvi je besplatan. Isti prospekt se ne plaća dvaput. *Jasno* |
| 3 | tabovi kanala u bloku **Predlog poruke** | kartica prešla u otključano stanje sa porukom | **Poruka je napisana za kanal koji si izabrao.** Promeni tab za mejl ili Instagram; „Napiši drugačije“ pravi novu verziju bez kredita. *Jasno* |
| 4 | dugme **Kontaktiran** u toastu posle „Kopiraj“ (i kolona „Nekontaktiran“ na `/pipeline`) | posle prvog kopiranja | **Označi kad pošalješ.** Pipeline pamti koga si kontaktirao, ko je odgovorio i ko je potpisao — i posle 30 dana znaš gde si stao. *Jasno* |

### 4.6 Traka napretka „Prvih pet minuta“

Bočna traka, ispod navigacije, iznad čipa kredita. Samo dok `onboarding_done_at IS NULL && onboarding_skipped_at IS NULL || (skipped && steps < 4)`. Nikad primarno dugme (isti razlog kao poziv na dokup u S21).

> Naslov: **Prvih pet minuta** · desno `2/4` (`.num`)
> ☑ Prva lista
> ☑ Prvi prospekt
> ☐ Prva poruka — *Kopiraj poruku sa otključane kartice*
> ☐ Prvi u pipeline-u — *Označi prospekt kao kontaktiran*
> Ispod: `Sakrij` (ghost, `onboarding_skipped_at = now()` — traka nestaje, koraci se i dalje beleže)

Svaki neurađen korak je link na ekran gde se radi (`/pretraga?grad=&nisa=` sa vrednostima iz čarobnjaka, `/pretraga`, `/lista`, `/pipeline`). Stanje iz `profiles` (čita ga `(app)/layout.tsx` — nula dodatnih upita); posle klijentske radnje ruta vraća `steps` i `PristupProvider`/novi `OnboardingProvider` ga osvežava bez reload-a. Kad četvrti korak sedne: traka 2 s pokazuje **„Sva četiri. Sad znaš sve što treba.“** pa nestaje. Blok „Prvi koraci“ na `/dashboard` se **briše** (dva izvora istine).

Skupljena bočna traka (ikonice): traka postaje ikonica sa prstenom `2/4` i tooltipom.

### 4.7 Prazna stanja — svaki ekran, doslovno

Komponenta `PraznoStanje` iz `components/ui/stranica.tsx` (proširiti: `ikona`, `naslov`, `opis`, jedno primarno dugme, opciono `fusnota`). Jedno dugme, uvek.

| Ekran | Uslov | Naslov | Opis | Dugme → |
|---|---|---|---|---|
| `/pretraga`, bez izbora | nema `?grad` | **Izaberi grad i nišu** | Gore levo. Sve što je u kešu stiže odmah — 1 kredit za 20 firmi; skeniranje nove kombinacije isto toliko. Ako nađemo manje firmi nego što si tražio, razliku vraćamo. | (nema dugmeta; forma je iznad) — fusnota: `Podrazumevano: <grad> · <niša> iz prvih koraka` |
| `/pretraga`, lista prazna zbog filtera | `total > 0`, `results = 0` | **Filteri su preuski** | U ovoj listi ima <N> firmi, ali nijedna ne prolazi filtere koje si uključio. | **Skini filtere** |
| `/pretraga`, prazan scan | `emptyScan` | **Google nema nijednu firmu za ovu kombinaciju** | Kredit ti je vraćen. Probaj širu nišu ili susedni grad — ili mi reci šta si tražio, pa dodam u taksonomiju. | **Probaj drugu nišu** (fokus na combobox) + mikro-pitanje `prazan-rezultat` (postoji) |
| `/pretraga`, `grace` posle besplatnih kredita | O3 grana | **Probao si besplatno. Za dalje treba plan.** | Lista i prospekt koje si otvorio čekaju te na „Moja lista“ do <datum>. Plan počinje sa 7 dana probe i 10 kredita; kartica se naplaćuje tek osmog dana. | **Počni probu · 7 dana** → `/cenovnik?plan=pro&ciklus=mesecno` |
| `/pretraga`, `grace` ostalo | postojeće | Pretraga i skeniranje su stali | (postojeći tekst sa datumima) | Uzmi plan |
| `/lista` | 0 `unlocks` | **Ovde stoji sve što otključaš** | Otključan prospekt ostaje tvoj zauvek: telefon, mejl, snimci, problemi i poruka. Odavde ide i CSV za tvoj Sheet. | **Otključaj prvi prospekt** → `/pretraga?grad=&nisa=` (čarobnjak) ili `/pretraga` |
| `/pipeline` | 0 `lead_status` | **Pipeline je prazan dok ne pošalješ prvu poruku** | Kad kopiraš poruku, klik na „Kontaktiran“ dovodi prospekt ovde. Pet kolona: Nekontaktiran → Kontaktiran → Odgovorio → Potpisan → Nezainteresovan. | **Idi na otključane prospekte** → `/lista` (ili `/pretraga` ako je `unlocks = 0`) |
| `/pipeline`, kolona prazna | po koloni | (bez naslova) | tekst u koloni: `Prevuci prospekt ovde` | — |
| Blok poruke na kartici | `aiSolidan = true` | **Sajt izgleda solidno** | Analiza nije našla dovoljno problema za poruku — bolje je ne slati ništa nego izmišljati. | **Sledeći prospekt** (skrol na sledeću zaključanu karticu) |
| Blok poruke na kartici | `phone = null && email = null && !instagram` | **Nema kanala** | Google nema ni telefon ni mejl za ovu firmu. Poruka je tu ako ih nađeš sam. | **Otvori na Google Mapsu** |
| `/utisci` | 0 prijava | **Još nisi ništa prijavio** | Kad prijaviš grešku ili ideju, ovde vidiš šta se sa njom desilo. Dugme „Utisak“ je dole desno na svakom ekranu. | **Pošalji prvi utisak** (otvara panel) |
| `/krediti`, ledger prazan | nemoguće posle 0026 (uvek `onboarding` red) | — | — | — |
| `/dashboard`, dnevnik prazan | 0 `changelog` | (sekcija se ne crta) | | |

Tekst „Kad otključaš prvi…“ i „Otključavanje troši jedan kredit…“ iz današnjeg `/lista` se zamenjuje gornjim.

### 4.8 Vodič na zahtev

Ikonica `CircleHelp` u gornjoj traci (desno od naslova, levo od kredita), tooltip „Vodič“. Klik → panel usidren ispod ikonice (isti obrazac kao panel utiska: 360 px, `Esc` i klik van zatvaraju, fokus se vraća). Sadržaj: ista četiri koraka iz `KORACI`, svaki sa jednom rečenicom (tekst tačaka iz §4.5, bez „Jasno“) i linkom „Pokaži mi“ → vodi na ekran i **ponovo prikazuje tu tačku** (jedini put kojim viđena tačka sme da se vrati — jer ju je korisnik sam pozvao). Dole: **„Ponovi prve korake“** → `/pocetak?ponovo=1` (čarobnjak sa preselektovanim vrednostima; ne dodeljuje kredite, ne resetuje `onboarding_steps`). Nikad se ne otvara sam.

### 4.9 SQL za merenje

```sql
-- Levak onboardinga po danu registracije (S25 metrika 1–4)
select date_trunc('day', p.created_at) as dan,
       count(*)                                                   as registrovano,
       count(*) filter (where p.onboarding_steps ? 'pretraga')      as lista,
       count(*) filter (where p.onboarding_steps ? 'otkljucavanje') as prospekt,
       count(*) filter (where p.onboarding_steps ? 'poruka')        as poruka,
       count(*) filter (where p.onboarding_steps ? 'pipeline')      as pipeline,
       count(*) filter (where p.onboarding_skipped_at is not null)  as preskocilo,
       percentile_cont(0.5) within group (order by
         extract(epoch from ((p.onboarding_steps->>'poruka')::timestamptz - p.created_at))/60)
         filter (where p.onboarding_steps ? 'poruka')               as medijana_min_do_poruke
from profiles p
where p.role <> 'kanarinac'   -- ili filter po fingerprintu iz S25
group by 1 order by 1 desc;
```

---
## 5. Feedback sistem

### 5.1 Šta postoji (F10 + F11, sve isporučeno)

| Sloj | Šta | Gde |
|---|---|---|
| Pasivni | plutajuće dugme „Utisak“ dole desno, panel 360 px (ocena ☹/⊙/☺ šalje na prvi klik, tekst, Bug/Ideja/Pohvala, **nalepi ili prevuci sliku**, čip „+1 kredit“ uz tekst), prečica `Ctrl/⌘+Shift+U`, tačka na dugmetu kad ima rešenih prijava | `utisak-dugme.tsx`, `POST /api/feedback`, `PATCH /api/feedback/[id]`, `POST /api/feedback/slika` → Storage bucket `feedback` |
| Podsetnik | jedan modal, dan 3, jednom po nalogu (`profiles.feedback_prompted_at`) | `POST /api/feedback/podsetnik-vidjen` |
| Kontekstualni | `prva-lista` · `tacnost-podataka` (3. otključavanje, čipovi) · `poruka-kvalitet` (kopirana prva AI poruka) · `prazan-rezultat` (tekst prvi) · `prvi-potpisan` (kartica + drugi korak „Bi li ga preporučio kolegi?“) | `feedback-katalog.ts`, `utisak-mikro.tsx`, `utisak-kartica.tsx` |
| Kampanjski | `cena` (dan 7 + 5 otključanih, opsezi RSD) · `zasto-ne-vracas` (pauza ≥ 10 dana) | isto |
| Incident | `posao-pao` (`job_queue failed`) → „Pošalji mi dnevnik“ = bug sa poslednjih 5 klijentskih grešaka | isto + `ctx.errors` |
| Motor | 1 po sesiji · 72 h cooldown (7 dana posle odgovora) · 1× po nalogu · 60 s od učitavanja · nikad dok posao radi ili modal stoji · 2 odbacivanja → 14 dana · 3. → do `KRAJ_BETE` | `feedback-motor.ts`, `profiles.feedback_*`, `feedback_prompts` |
| Povratni | „Moje prijave“ (`/utisci`, status, beleška, +10 za priznat bug), „Beta dnevnik“ na `/dashboard` (`changelog`, „iz tvog utiska“) | `/api/utisci/stanje`, cron `utisci-*` |
| Admin | `/admin/utisci` + `/utisci/[id]`: filteri (status, sloj, ocena, korisnik), status, oznake, beleška, „dodeli 10 kredita“ (`admin_adjust_credits` + `admin_audit`), veza sa dnevnikom; instant mejl za ocenu 1 / bug / incident, digest 21:00, nedeljni izveštaj | `admin-utisak-panel.tsx`, cron `utisci-digest`, `utisci-izvestaj` |

Tabela `feedback` već ima: `rating`, `kind`, `message`, `source` (`dugme|podsetnik|pitanje|kampanja|incident`), `route`, `ctx jsonb`, `prompt_key`, `answers jsonb`, `status`, `severity`, `tags`, `screenshot_path`, `reward_credits`, `user_note`. **Sve što sledi staje u ove kolone.** Nova tabela nije potrebna nigde.

### 5.2 Šta ne valja za lansiranje bez bete

| # | Problem | Fajl |
|---|---|---|
| F1 | `cena` pita „Koliko bi ti Sajtoskop mesečno vredeo?“ sa uvodom „Beta se jednom završava“ i napomenom „Ovo ne menja tvoj pristup u beti“ — čoveku koji je upravo uneo karticu za €59. **Briše se.** | `feedback-katalog.ts` |
| F2 | `KRAJ_BETE = "2026-12-31"` je rok **svih** pitanja. 1. januara motor ćuti zauvek, a treće odbacivanje = „ćutanje do kraja bete“. Rok postaje `do: "2027-12-31"` (godišnja revizija), treće odbacivanje = 90 dana. | `feedback-katalog.ts`, `feedback-motor.ts` |
| F3 | „Beta dnevnik“ na `/dashboard`, „Pretraga · beta“ u zaglavlju panela, `TIP_DNEVNIKA`. Postaje **„Novo u Sajtoskopu“** / „Pretraga“. | `dashboard/page.tsx`, `utisak-dugme.tsx` |
| F4 | Podsetnik dan 3 pada usred probe, kad je čovek najviše u alatu — i to je jedini modal. Ostaje, ali uslov dobija `otkljucano ≥ 1` (ko ništa nije otključao nema utisak, ima prepreku — nju hvata `zasto-ne-vracas`). | `lib/feedback.ts` `trebaPodsetnik` |
| F5 | Nema pitanja u trenutku u kom čovek odluči da **ne plati** (otkaz probe, kraj probe bez naplate). Stripe portal skuplja razlog otkaza (§8 iz 01) — to je dovoljno za otkaz; za istek probe bez naplate ide mejl P4, ne pitanje u aplikaciji (nije unutra da ga vidi). | — |
| F6 | `poruka-kvalitet` okida samo na **AI** poruku, ne na šablon — a prva poruka je šablon. Okidač postaje prvo „Kopiraj“ bilo koje poruke. | `poruke-panel.tsx` → kartica |
| F7 | Nagrada „+10 za potvrđen bug“ i „+1 za poruku“ ostaju; čip „+1 kredit“ uz tekst se **ne pokazuje u probi** (kredit u probi vredi 0 posle osmog dana i kvari brojku) — `nagradaDostupna` dobija `pristup.stanje !== 'proba'`. | `utisak-dugme.tsx`, `lib/feedback.ts` |

### 5.3 Predlog poboljšanja — bez nove infrastrukture

Sve ide kroz postojeći katalog, motor, `feedback` tabelu, rute i admin. Nova migracija samo za jedan SQL pogled.

**A. NPS posle 7. dana — ključ `nps-7`.** Odstupanje od F11 odluke 13 („bez NPS skale“): ta odluka je važila za besplatnu betu, gde ocena preporuke ne znači ništa. Posle lansiranja NPS je jedina brojka uporediva sa bilo čim spolja, i jedina koju Vlada ili budući partner mogu da pročitaju bez objašnjenja.

```ts
{
  kljuc: "nps-7", sloj: "kampanja", oblik: "kartica", prioritet: 42, do: "2027-12-31",
  uvod: "Nedelju dana si u alatu.",
  naslov: "Koliko je verovatno da bi Sajtoskop preporučio kolegi?",
  opcije: Array.from({ length: 11 }, (_, i) => ({ vrednost: String(i), label: String(i) })),
  sufiks: "0 = nikako · 10 = sigurno",
  dopuna: { placeholder: "Šta je presudilo?", obavezna: false },
  uslov: (u) => u.danaOdRegistracije >= 7 && u.otkljucano >= 1,
  bezNagrade: true,      // isti razlog kao cena: plaćena brojka je pokvarena brojka
  sema: z.object({ ocena: z.coerce.number().int().min(0).max(10) }).strict(),
}
```

Kartica na vrhu `/pretraga` (kao `cena` do sada), 11 čipova u jednom redu (na ≤ 390 px dva reda 0–5 / 6–10). Jednom po nalogu.

**B. Pitanje posle prvog potpisanog leada — `prvi-potpisan` postoji.** Dopuna: treći korak posle „Da“ na preporuku — **„Smem li da citiram tvoj rezultat na sajtu, sa imenom?“** *Da, sa imenom · Da, bez imena · Ne*. Odgovor u `answers.citat`. To je jedini legitiman put do testimonijala (P3 §6 traži placeholder za studiju slučaja — odavde se puni). Uz kartu: `dopuna.placeholder = "Koja firma, koliko si naplatio? (ostaje između nas ako kažeš ne)"`.

**C. „Šta ti fali“ u praznom stanju — ključ `fali`, oblik `mikro`, `tekstPrvi: true`, `ponovi: { naSati: 24 }`.** Naslov **„Šta ti ovde fali?“**, placeholder „Niša, grad, podatak, dugme…“, dugme „Pošalji“. Pojavljuje se **ispod** praznog stanja (ne umesto dugmeta) na: `/pretraga` bez rezultata za filter, `/lista` prazna posle 7 dana, combobox niša kad pretraga po tekstu vrati 0 („Ne vidiš svoju nišu? Napiši je.“ — `ctx.query = uneti tekst`), `/pipeline` prazan posle 7 dana. `source = 'pitanje'`, `route` iz konteksta. `prazan-rezultat` ostaje za `emptyScan` (drugi trenutak, druga informacija).

**D. Prijava greške sa screenshotom — postoji (nalepi/prevuci). Dodaje se ulaz sa mesta gde greška nastane.** Svako stanje greške u aplikaciji dobija link **„Prijavi grešku“** koji otvara postojeći panel sa `kind = bug` preselektovanim, poruka prazna, i `ctx` unapred popunjen sa servera (ne iz klijenta): `{ placeId, jobId, route, korak: onboarding_steps, stanje: pristup.stanje, greska: <poruka koju je korisnik video> }`. Mesta: kartica u stanju greške (§7.5), `skeniranje-modal` greška, toast `402/403/500` iz `/api/unlock` i `/api/search`, `/welcome` „ako se plan ne pojavi“, `pretplata-blok` `past_due`. Slika i dalje samo nalepljena. Za grešku na kartici prospekta, uz `ctx.placeId` admin panel prikazuje **link na tu karticu i poslednji `enrich_full` posao** (samo čitanje `job_queue` po `payload->>'placeId'`, već dostupno adminu).

**E. Kako se čita u admin konzoli — `/admin/utisci`, jedan red brojki + dva nova filtera.**

- Red brojki (već postoji: odgovorenost, medijana cene, otvoreni bugovi, prosek do odgovora) → medijana cene se **zamenjuje sa NPS**: `promoters − detractors` iz `feedback where prompt_key = 'nps-7'`, uz `n`. Nova SQL funkcija `admin_nps()` u `0026` (ili `0027`): vraća `score, n, promoteri, pasivni, detraktori, poslednjih_30_dana`.
- Filter `sloj` dobija vrednost **„Fali“** (`prompt_key = 'fali'`) — lista grupisana po `route`, tekstovi jedan ispod drugog, svaki sa brojem sličnih (`lower(trim(message))` grupisanje u SQL-u). Ovo je ulaz u taksonomiju.
- Filter **„Citat“** (`answers->>'citat' in ('da-ime','da-bez')`) — spisak ljudi koji su pristali; dugme „Kopiraj kao referencu“ (tekst: firma, ishod, ime po pristanku).
- Detalj bug prijave: uz sliku i dnevnik grešaka, blok **„Kontekst“** iz `ctx` (placeId → link, jobId → status i `error` iz `job_queue`, korak onboardinga, stanje pristupa). Jedan `select`, bez novih tabela.
- Digest 21:00 dobija dve linije na vrhu: „NPS ove nedelje: 8 (n = 5)“ i „Fali: 3 nova“.

Ništa od ovoga ne traži Storage, cron, tabelu ni servis koji ne postoji.

---

## 6. Prilike za dodatnu vrednost — jeftine, iz toka

Rang po vrednost/trud (1 = najbolji odnos). Trud u satima, sve ≤ 4 h.

| # | Prilika | Trud | Zašto |
|---|---|---|---|
| 1 | **„Kopiraj“ → toast „Označi kao kontaktiran?“** (§1.11): jedan klik upisuje `lead_status = kontaktiran` sa kanalom | 2 h | Pipeline se puni sam u trenutku slanja, umesto da ga korisnik vodi ručno — a „Potpisan“ iz tog pipeline-a je moat (E1). |
| 2 | **Gmail / Viber / Instagram deep-link na kartici**: `https://mail.google.com/mail/?view=cm&to=…&su=…&body=…` (i `mailto:` fallback), `viber://chat?number=%2B381…` na telefonu, `https://ig.me/m/<handle>` | 2 h | Poruka stiže u pravi prozor sa popunjenim primaocem — nula kopiranja, i mobilni tok radi. |
| 3 | **„Vreme za drugi pokušaj“ na `/pipeline`**: bedž na kartici u koloni Kontaktiran kad `updated_at < now() − 5 dana`, brojač u nav stavci Pipeline | 3 h | Follow-up je gde se potpisuje; alat ga sad ne podseća. `lead_status.updated_at` postoji. |
| 4 | **Link „Otvori na Google Mapsu“** na kartici (`https://www.google.com/maps/place/?q=place_id:<id>`) | 30 min | Korisnik proverava firmu i recenzije pre poruke bez guglanja; `place_id` je javan. |
| 5 | **„Nastavi gde si stao“ na `/dashboard`**: poslednja pretraga (`searches` red) kao jedno dugme sa gradom, nišom i brojem novih firmi od poslednjeg pogleda | 2 h | Drugi dan počinje jednim klikom, ne biranjem iz combobox-a — meri se baš povratak drugog dana. |
| 6 | **„U kešu i: Loznica · Valjevo · Šabac“** ispod liste — iste niše u drugim gradovima, sa cenom | 2 h | Prodaje sledeći kredit u trenutku kad je lista već potrošena; koristi `listaKesa()`. |
| 7 | **Potpis u poruci iz profila** (`profiles.signature_name`, `signature_company`, `signature_url`; `/krediti` → „Podešavanja poruke“) | 3 h | Poruka bez potpisa se prepravlja svaki put; sa potpisom „Kopiraj“ je zaista gotova poruka. Proveri da li `OutreachInput` već ima polje. |
| 8 | **Tooltip na Ugly Score bedžu**: bend + dve rečenice šta bend znači i šta korisnik dobija otključavanjem | 1 h | Bend je brend; bez objašnjenja je broj. Tekst iz `BAND_LABEL` + nov `BAND_OPIS` u `ui-tekst.ts`. |
| 9 | **Tastatura na listi**: `J/K` sledeća/prethodna kartica, `U` otključaj, `C` kopiraj poruku, `?` legenda | 3 h | Korisnici su developeri; 30 prospekata za 5 minuta umesto 15. |
| 10 | **Toast „Vratio sam ti 1 kredit“** kad `refund_scan` prođe (worker već zna; `/api/job/[id]` vraća `refunded`) | 2 h | Obećanje sa landinga („razliku vraćamo“) se vidi u trenutku, ne na `/krediti` sutra. |

Namerno **nije** ovde: batch otključavanje (F4 §1 zabranjuje), PDF audit (E3, više od pola dana), radar (E2).

---

## 7. Kartica prospekta (D12)

Jedna komponenta `components/kartica-prospekta.tsx`, prop `lead: PublicLead` + `stanje` izvedeno iz podataka, ne iz propa. Zamenjuje `lead-tabela.tsx` na `/pretraga` i tabelu u `moja-lista-ekran.tsx` (O5). Lista = `grid gap-3`, jedna kolona do 1024 px, dve iznad. Snimci i analiza ostaju u `snimak.tsx` preklopu — kartica ga otvara klikom na sličicu.

**Pravilo 9, doslovno:** `LockedLead` **nema** ključeve `phone`, `email`, `websiteUrl`, `uglyScore`, `signals`, `aiIssues`, `aiVerdict`, `screenshot`. Maska se crta iz `lead.isUnlocked === false`, tekstom `••• ••• •••` u `.num` fontu. **Nikad `filter: blur()` nad stvarnim podatkom** — stvarnog podatka u klijentu nema.

### 7.0 Šta se dodaje u `LeadBase` (javno, bezopasno)

`ratingCount: number | null` (`businesses.user_ratings_total`), `nicheLabel: string` (klijent ima `nicheLabels` mapu, ali kartica na `/lista` je nema — prosleđuje server), `issueCount: number | null` (za zaključano stanje: `website_audits.ai_issues` dužina, ili broj `signals` ako AI nije prošao; **broj, ne sadržaj**).

### 7.1 Raspored (po slici), obe teme

```
┌──────────────────────────────────────────────────────────┐
│ [rail 3px]  PVC Mont Šabac                 [Nema sajt]    │  ← naslov h3 + bedž statusa
│             PVC stolarija · Šabac                         │
│             ★ 4,6 · 38 recenzija            [Google Maps] │  ← .num
├──────────────┬────────────────┬──────────────────────────┤
│ ☏ TELEFON    │ ✉ MEJL         │ ⊕ SAJT                    │  ← eyebrow 11px uppercase, tracking
│ 064 312 8890 │ pvcmont…@gm…   │ nema domen                │  ← .num 15px
│ Mobilni · Viber (akcent) │    │                           │
├──────────────┴────────────────┴──────────────────────────┤
│ KONKRETNI PROBLEMI                        [sličica 40px] │
│ ⚠ Domen ne odgovara, greška 522                          │
│ ⚠ Nije prilagođen mobilnom telefonu                       │
│ ⚠ Nema kontakt formu ni broj telefona                     │
│ ⚠ Poslednja izmena sadržaja: 2019.                        │
├──────────────────────────────────────────────────────────┤
│ PREDLOG PORUKE · [Viber] [Mejl] [Instagram] [Poziv]   [Kopiraj] │
│ Dobar dan, video sam da imate odlične ocene na Googlu…   │
│                                          [Napiši drugačije] │
└──────────────────────────────────────────────────────────┘
```

Rail levo: `bg-accent` (nema sajt), `bg-warn` (mrtav), `bg-info` (samo društvene), providan (ima sajt) — postojeći `railColor`. Bedž: `STATUS_LABEL` za tri statusa, `BAND_LABEL` + platforma za `ok`. Sve boje kroz tokene; crvena/narandžasta/žuta samo kao semantika skora.

### 7.2 Otključano stanje — polja, izvor, ikone

| Element | Izvor (`UnlockedLead`) | Ikona (`lucide`) | Ponašanje |
|---|---|---|---|
| Naziv | `name` | — | `h3`, truncate na 2 reda |
| Kategorija · grad | `nicheLabel` · `cityLabels[citySlug]` | — | |
| Ocena · recenzije | `rating`, `ratingCount` | `Star` (fill `warn`) | `4,6 · 38 recenzija`; bez ocene: „bez ocena“ |
| Google Maps | `placeId` | `MapPin` | link, `target=_blank`, `rel=noreferrer` |
| Bedž statusa | `siteStatus`, `uglyBand`, `platform` | `LockOpen` u bedžu (po slici) | tooltip iz §6 #8 |
| TELEFON | `phone`, `phoneType` | `Phone` | broj `.num`; ispod `PHONE_LABEL` + kanal: **Mobilni · Viber** / **Fiksni · Poziv** / **Besplatni · Poziv**; klik = `telefonHref` (`viber://` mobilni, `tel:` ostalo); bez broja: „nema broj“ |
| MEJL | `email` | `Mail` | truncate sredina (`pvcmont…@gmail.com`), `title` pun; klik `mailto:`; bez: „nema mejl“ |
| SAJT | `websiteUrl` | `Globe` | domen bez `https://www.`, `target=_blank`, `nofollow`; `nema_sajt` → **„nema domen“**; `mrtav` → domen + „ne odgovara“ (warn); `samo_drustvene` → „samo Instagram/Facebook“ |
| KONKRETNI PROBLEMI | `aiIssues[].title` (3–5), fallback `signals[]` (do 4), fallback `[]` | `TriangleAlert` (`warn` visoka/srednja, `fg-muted` niska po `severity`) | `aiIssues = null && signals = []` i status `ok` → „Analiza u toku“ (§7.4) |
| Sličica snimka | `screenshot.mobile ?? desktop` | — | 40×64 px, klik otvara postojeći `Preklop` (snimci + PSI + AI verdikt) |
| PREDLOG PORUKE · tabovi | `GET /api/poruke?placeId` (`poruke.mejl/viber/instagram`), tab **Poziv** = tekst `viber` pod naslovom „Šta da kažeš“ (C9) | — | podrazumevan tab: `onboarding_channel` ako je primenljiv (Viber traži mobilni, Mejl traži mejl), inače `predlog` iz odgovora (`mobilni → viber`, `fiksni → poziv`, bez → mejl) |
| Kopiraj | tekst aktivnog taba | `Copy` → `Check` 2 s | `navigator.clipboard` + fallback; toast „Kopirano. Označi kao kontaktiran?“ [Kontaktiran] |
| Napiši drugačije | `POST /api/poruke/ai` (0 kredita, dnevni limit) | `Sparkles` | postojeći `AiVarijanta`; `429` → „Dnevni limit AI varijanti (5) je potrošen, sutra ponovo.“; nema za tab Poziv |
| Stanje pipeline-a | `lead_status.status` | `KanbanSquare` | mali select u gornjem desnom uglu bloka poruke: Nekontaktiran → … ; menja kroz `/api/pipeline` |

`aiSolidan = true`: blok poruke → prazno stanje „Sajt izgleda solidno“ (§4.7). Bez telefona i mejla → „Nema kanala“.

### 7.3 Zaključano stanje

Ista struktura, ista visina (kartice ne skaču pri otključavanju).

| Element | Prikaz | Zašto vidljivo |
|---|---|---|
| Naziv, kategorija · grad, ocena · recenzije, Maps link, rail, bedž statusa | **puni, javni** | mamac; sve je i na Google Mapsu |
| TELEFON | `06• ••• ••••` (`.num`, `text-fg-faint`) + ispod **Mobilni · Viber** (`PHONE_LABEL`, javan) | tip je javan i prodaje: „Viber“ znači brz odgovor |
| MEJL | `•••••@•••••` ili **„nema mejl“** ako `hasEmail = false` — `hasEmail: boolean` se dodaje u `LeadBase` kao i `hasWebsite` (boolean je javan, adresa nije) | čovek ne troši kredit na prospekt bez kanala |
| SAJT | `nema_sajt` → „nema domen“ (javno); inače `•••••.rs` | status je javan, domen nije |
| KONKRETNI PROBLEMI | naslov + **„4 problema“** (`issueCount`) i četiri reda `•••••••` različite dužine (statična maska, ne podatak); `nema_sajt` → jedan red „Firma nema sajt — to je ceo problem, i ceo razlog za poruku.“ | broj problema je argument, sadržaj je roba |
| PREDLOG PORUKE | eyebrow + tri reda maske `••••` + zatamnjen tab kanala koji bi bio podrazumevan (`predlog`, iz tipa telefona — javan) | |
| Dugme | jedno primarno preko bloka poruke: **„Otključaj za 1 kredit“** / **„Otključaj · prvi je besplatan“** (§4.4) / `credits = 0` → **„Otključaj · treba plan“** / `grace` → **„Otključaj · vrati pristup“**; ispod: „Telefon, mejl, sajt, snimci, problemi i poruka. Ne plaća se dvaput.“ | |

**Klik → potvrda „1 kredit“ → otključavanje bez reloada:**

1. Besplatno (`prviBesplatan`): bez modala → korak 3.
2. Modal (`Dialog`, jedno primarno dugme): naslov **„Otključaj PVC Mont Šabac?“**, tekst „1 kredit — ostaje ti **11**. Dobijaš telefon, mejl, sajt, snimke, listu problema i poruku. Isti prospekt se nikad ne naplaćuje drugi put.“, checkbox **„Ne pitaj me više danas“** (`sessionStorage`, jedini dozvoljen klijentski trag — potvrda je pojam sesije), dugme **„Otključaj · 1 kredit“**, ghost „Odustani“. `credits = 0` → tekst „Nemaš kredita. Plan počinje sa 7 dana probe i 10 kredita.“ + dugme „Pogledaj planove“.
3. `POST /api/unlock {placeId}` → optimistički: kartica odmah prelazi u stanje **u toku** (§7.4), čip kredita −1. Odgovor `UnlockResponse` (K4 dodaje `enrichJobId: number | null`) → `setLeads(zameni placeId)`. `alreadyUnlocked` → toast „Već otključan — kredit nije skinut.“, čip vraćen.
4. Greška `402` → modal sa planovima; `403` → tekst `odbijenice`; `500`/mreža → kartica se vraća u zaključano, toast „Nema veze sa serverom. Prospekt nije otključan i kredit nije skinut.“ + „Prijavi grešku“.
5. Onboarding tačka 2 nestaje.

### 7.4 Stanje „otključavanje u toku“ (10–40 s)

Odmah po odgovoru `/api/unlock` kartica ima: telefon, mejl, sajt, status, `signals` (iz `enrich_basic`) — sve **puno**. Nema još: snimke, `aiIssues`, `aiVerdict`, PSI.

| Element | Prikaz |
|---|---|
| Bedž statusa | pun |
| Blok problema | eyebrow + red **„Analiziram sajt na telefonu i desktopu… obično 10–40 s“** sa `Loader2` (spin, `prefers-reduced-motion` → statična ikonica) i ispod `signals` kao privremena lista (postojeći podaci — to nije laž: HTML heuristika je već prošla) |
| Sličica snimka | skeleton 40×64 sa pulsom |
| Blok poruke | **pun** odmah — šablon ne zavisi od AI koraka (`napisiPoruke` radi nad `signals`); kad AI stigne, tekst se **ne menja sam** (čovek možda već kopira); pojavi se link „Osvežena poruka sa analizom“ koji ga zameni na klik |
| Polling | `GET /api/job/<enrichJobId>` na 3 s, najviše 20 puta (60 s); `done` → `POST /api/unlock {placeId}` (idempotentno, `alreadyUnlocked`, vraća ceo lead — nula novih ruta) → zamena; `failed` → §7.5; 20 puta bez `done` → §7.5 sa tekstom „traje duže nego obično“ |
| `enrichJobId = null` (enqueue pao) | odmah §7.5 |

Napušta stranu usred: `/lista` čita iz baze — kartica bez snimka i AI polja crta isto stanje ako `job_queue` za `place_id` ima `pending/running` (server prosleđuje `enrichJobId` i na `/lista`), inače §7.5.

### 7.5 Stanje greške

Kad: `job failed`, 60 s bez `done`, enqueue pao, screenshot pao a PSI/AI prošli, `website_audits` bez `enrich_full` polja 5 min posle `unlocks.created_at`.

| Slučaj | Blok problema | Sličica | Dugme |
|---|---|---|---|
| Sajt nedostupan pri analizi, status **nije** `mrtav` (timeout, WAF 403) | „Sajt se nije otvorio pri analizi (**<greška: timeout / 403 / DNS>**). To može biti privremeno — ili je i vlasniku isto tako.“ + `signals` | `ImageOff` | **„Pokušaj ponovo“** (`POST /api/unlock` → K4: ako `website_audits.ai_*` i `screenshot_*` prazni → nov `enqueueEnrichFull`, dedupe po `place_id` sprečava dupli) — najviše 2 puta, pa „Prijavi grešku“ |
| Screenshot pao, AI prošao | problemi puni | „Snimak nije sačuvan“ (`ImageOff`, tooltip) | — |
| AI pao, screenshot prošao | `signals` + red „Analiza problema nije prošla, poruka je iz osnovnih signala.“ | slika | „Pokušaj ponovo“ |
| Sve palo / 60 s | „**Analiza nije stigla.** Kredit je skinut i prospekt je tvoj — kontakt je gore. Analizu možeš da tražiš ponovo.“ | `ImageOff` | „Pokušaj ponovo“ + link „Prijavi grešku“ (§5.3 D, `ctx.placeId + jobId`) |

Kredit se **ne vraća** automatski: kontakt je isporučen, a to je pola vrednosti; refund ide ručno iz admina uz bug prijavu (+10 nagrade rešava i to).

### 7.6 Varijanta „nema sajt“ (`siteStatus = nema_sajt`, i `mrtav`)

Bez snimka, bez skora, bez PSI — worker ih ni ne pravi. Kartica:

- SAJT: **„nema domen“** (`nema_sajt`) / **„<domen> · ne odgovara“** (`mrtav`, warn).
- KONKRETNI PROBLEMI → eyebrow **ZAŠTO JE OVO DOBAR PROSPEKT**: `nema_sajt` → „Firma ima **4,6 ★ i 38 recenzija** na Googlu, a nema sajt. Ljudi koji je nađu nemaju gde da vide radove i cene.“ · `mrtav` → „Domen **pvcmont.rs** ne odgovara (greška 522). Firma je nekad imala sajt — plaćali su ga, i verovatno bi opet.“ · `samo_drustvene` → „Firma živi na Instagramu/Facebooku. Nema mesto na koje Google šalje kupce.“
- Sličica: nema; umesto nje ikonica `Globe` precrtana u istoj dimenziji, da se raspored ne pomera.
- Stanje „u toku“ traje kraće (samo `enrich_basic` potvrda) — praktično ne postoji; kartica je puna odmah.
- Poruka: šablon `nema-sajt` iz `outreach.ts` (postoji; tekst kao na slici).

### 7.7 Mobilni ≤ 390 px

- Jedna kolona; naslov i bedž u dva reda (bedž ispod imena, levo).
- Tri kolone kontakta → **tri reda** (`grid-cols-1 divide-y`), svaki red: ikona + eyebrow levo, vrednost desno, `tap` površina cela linija (≥ 44 px), telefon otvara Viber/poziv, mejl otvara mail app.
- Problemi: puni.
- Tabovi kanala: `scroll-x` traka, aktivni tab ne sme da bude van vidokruga (scrollIntoView).
- „Kopiraj“ ostaje uz eyebrow; „Napiši drugačije“ ispod teksta, puna širina.
- Dugme „Otključaj“ puna širina, `sticky bottom-0` unutar kartice **ne** — kartica je kratka.
- Modal potvrde: `Dialog` puna širina sa dna (`sm:` centriran).
- Balon vođenog prolaza ispod elementa, puna širina.
- Font u `.num` poljima ≥ 15 px; iOS zoom se ne okida jer nema inputa.

### 7.8 Tekstovi doslovno (spisak za `ui-tekst.ts`, ključ → tekst)

```
kartica.telefon = "Telefon"        kartica.mejl = "Mejl"           kartica.sajt = "Sajt"
kartica.nemaBroj = "nema broj"     kartica.nemaMejl = "nema mejl"  kartica.nemaDomen = "nema domen"
kartica.neOdgovara = "ne odgovara" kartica.samoMreze = "samo društvene mreže"
kartica.recenzija = { 1: "recenzija", 2: "recenzije", 5: "recenzija" }   kartica.bezOcena = "bez ocena"
kartica.problemi = "Konkretni problemi"          kartica.zastoDobar = "Zašto je ovo dobar prospekt"
kartica.brojProblema = (n) => `${n} ${plural(n, "problem", "problema", "problema")}`
kartica.nemaSajtProblem = "Firma nema sajt — to je ceo problem, i ceo razlog za poruku."
kartica.analiziram = "Analiziram sajt na telefonu i desktopu… obično 10–40 s"
kartica.analizaDuze = "Traje duže nego obično. Kontakt je tvoj, analiza stiže — ili je zatraži ponovo."
kartica.analizaPala = "Analiza nije stigla. Kredit je skinut i prospekt je tvoj — kontakt je gore. Analizu možeš da tražiš ponovo."
kartica.sajtNijeOtvoren = (g) => `Sajt se nije otvorio pri analizi (${g}). To može biti privremeno — ili je i vlasniku isto tako.`
kartica.snimakNijeSacuvan = "Snimak nije sačuvan"    kartica.aiPao = "Analiza problema nije prošla, poruka je iz osnovnih signala."
kartica.poruka = "Predlog poruke"  kartica.kanal = { viber: "Viber", mejl: "Mejl", instagram: "Instagram", poziv: "Poziv" }
kartica.staDaKazes = "Šta da kažeš"  kartica.kopiraj = "Kopiraj"  kartica.kopirano = "Kopirano"
kartica.kopiranoToast = "Kopirano. Označi kao kontaktiran?"  kartica.kontaktiran = "Kontaktiran"
kartica.napisiDrugacije = "Napiši drugačije"  kartica.aiLimit = (n) => `Dnevni limit AI varijanti (${n}) je potrošen, sutra ponovo.`
kartica.osvezenaPoruka = "Osvežena poruka sa analizom"
kartica.otkljucaj = "Otključaj za 1 kredit"  kartica.otkljucajBesplatno = "Otključaj · prvi je besplatan"
kartica.otkljucajPlan = "Otključaj · treba plan"  kartica.otkljucajVrati = "Otključaj · vrati pristup"
kartica.otkljucajOpis = "Telefon, mejl, sajt, snimci, problemi i poruka. Ne plaća se dvaput."
kartica.otkljucavam = "Otključavam…"
kartica.potvrdaNaslov = (ime) => `Otključaj ${ime}?`
kartica.potvrdaTekst = (ostaje) => `1 kredit — ostaje ti ${ostaje}. Dobijaš telefon, mejl, sajt, snimke, listu problema i poruku. Isti prospekt se nikad ne naplaćuje drugi put.`
kartica.nePitajDanas = "Ne pitaj me više danas"   kartica.odustani = "Odustani"
kartica.nemaKredita = "Nemaš kredita. Plan počinje sa 7 dana probe i 10 kredita."
kartica.vecOtkljucan = (ime) => `${ime} je već otključan — kredit nije skinut.`
kartica.nemaVeze = "Nema veze sa serverom. Prospekt nije otključan i kredit nije skinut."
kartica.pokusajPonovo = "Pokušaj ponovo"  kartica.prijaviGresku = "Prijavi grešku"
kartica.solidan = "Sajt izgleda solidno"  kartica.solidanOpis = "Analiza nije našla dovoljno problema za poruku — bolje je ne slati ništa nego izmišljati."
kartica.nemaKanala = "Nema kanala"  kartica.nemaKanalaOpis = "Google nema ni telefon ni mejl za ovu firmu. Poruka je tu ako ih nađeš sam."
kartica.mapa = "Google Maps"
```

---

## 8. Promptovi za Claude Code

Pre svake: `git checkout . && git clean -fd && git pull` (D13); kopiraj ovaj dokument u `docs/tok-i-onboarding.md` i commituj. Svaka sesija počinje sa: „Pročitaj CLAUDE.md, docs/SESIJE.md (poslednje 2 sesije), docs/naplata-stripe.md (§3, §7) i docs/tok-i-onboarding.md. Zatim:“

### K4 — Onboarding + kartica prospekta (S28)

```
Sesija S28. Cilj: čovek od /welcome do kopirane poruke bez ijednog pitanja, bez ijednog
Places poziva; kartica prospekta po D12 zamenjuje tabelu. Commit: „S28: onboarding +
kartica prospekta". Preduslov: K3 mergovan (pozivnice).

Pročitaj docs/tok-i-onboarding.md §0 (C1–C6, O2–O6), §1.8–1.13, §2.3, §2.5, §4 CEO, §7 CEO;
docs/DIZAJN-SISTEM.md (§7.1 jedno primarno dugme, §8 animacije, tokeni); docs/LANSIRANJE.md
§1.8 samo zbog konteksta (nadjačan sa §4 ovog dokumenta gde se razlikuju: 2 kredita, ne 1;
prva lista se plaća 1 kredit iz keša po D10).

FAJLOVI
1. supabase/migrations/0026_onboarding.sql — doslovno iz §4.3: kolone onboarding_*,
   grant_credits grana ('credit_pack','onboarding') → credits_topup, create_profile_with_grant
   sa razlogom 'onboarding', onboarding_mark_step, admin_users_page dobija onboarding_done_at
   i onboarding_skipped_at (drop + create, obrazac iz S25). Idempotentno, pnpm check:sql dvaput.
2. packages/shared/src/plans.ts — ONBOARDING_CREDITS = 2. packages/shared/src/pristup.ts — O3:
   ProfilZaPristup.createdAt; grana 4 računa grace nad kasniji(punDo, createdAt); test u
   test/pristup.ts (nov nalog, 0 topup → grace 30 dana od registracije; posle → zakljucan).
   apps/web/src/lib/pristup.ts prosleđuje profile.created_at.
3. apps/web/src/lib/profile.ts — KREDITI_NA_REGISTRACIJI → ONBOARDING_CREDITS; komentar ažuriran.
4. packages/shared/src/onboarding.ts — KORACI (§4.5), tekst tačaka, tekst trake, tipovi.
   packages/shared/src/index.ts re-export.
5. apps/web/src/lib/onboarding.ts (server-only) — zahtevajOnboarding(profile, pristup):
   redirect('/pocetak') kad pristup.pun && !done && !skipped. Zove se u /pretraga, /lista,
   /pipeline, /dashboard, /krediti ODMAH posle zahtevajCitanje(). NE u layout-u.
6. app/pocetak/page.tsx + components/pocetak-ekran.tsx — čarobnjak §4.2, četiri ekrana,
   tekstovi doslovno; kombinacije SAMO iz listaKesa() sa fresh=true; agregati po gradu i niši
   (count, sum noSite); ekran 4 zove POST /api/search {pay:true, dubina:'brzo'} i redirektuje;
   ?pozivnica=komp red iznad naslova; ?ponovo=1 preselekcija bez dodele; prazan keš ekran.
   Svoj layout (bez bočne trake), obe teme, ≤390 px, animacija §8, prefers-reduced-motion.
7. app/api/onboarding/{korak,preskoci,hint}/route.ts — requireUserId, Zod strictObject,
   rate limit; korak prima SAMO {korak:'poruka'}; ostala tri koraka upisuju rute koje ih rade:
   api/search (prvi charged/already_paid → onboarding_mark_step 'pretraga'), lib/unlock.ts
   (prvi unlocks red → 'otkljucavanje'), api/pipeline (prvi lead_status → 'pipeline').
8. components/onboarding-traka.tsx u bočnoj traci (§4.6) + OnboardingProvider koji stanje
   dobija iz (app)/layout.tsx i osvežava iz odgovora ruta (steps u odgovoru unlock/search/
   pipeline/korak — dodaj polje onboardingSteps?: jsonb u te odgovore). Blok „Prvi koraci"
   na /dashboard se BRIŠE.
9. components/vodjena-tacka.tsx — balon uz element (§4.5), max jedna, nikad preko modala/
   posla/pitanja (UtisciProvider.pitanjeOtvoreno), upis u onboarding_hints_seen kroz
   /api/onboarding/hint; ≤390 px ispod elementa.
10. components/vodic.tsx — panel iz gornje trake (§4.8), Esc/klik van, „Pokaži mi" vraća tačku,
    „Ponovi prve korake" → /pocetak?ponovo=1.
11. components/ui/stranica.tsx — PraznoStanje proširiti (fusnota); sva prazna stanja iz §4.7
    doslovno na /pretraga, /lista, /pipeline, /utisci i u kartici.
12. KARTICA: components/kartica-prospekta.tsx po §7 (pet stanja, tekstovi iz §7.8 u
    lib/ui-tekst.ts pod `kartica`). lib/search-types.ts: LeadBase + ratingCount, hasEmail,
    nicheLabel, issueCount; UnlockResponse + enrichJobId; lib/public-lead.ts puni ih;
    lib/unlock.ts vraća job id i ponovo enqueue-uje enrich_full kad audit nema ai_*/screenshot
    polja (dedupe po place_id). lead-tabela.tsx se BRIŠE; pretraga-ekran.tsx i
    moja-lista-ekran.tsx crtaju grid kartica; snimak.tsx ostaje kao preklop. Polling
    §7.4 preko GET /api/job/[id] + POST /api/unlock (alreadyUnlocked). Modal potvrde §7.3,
    „Ne pitaj me više danas" u sessionStorage. Tab Poziv = viber tekst pod „Šta da kažeš"
    + tel: dugme, bez AI varijante. Toast „Kopirano. Označi kao kontaktiran?" → /api/pipeline.
    api/unlock/route.ts: 402 tekst „Nemaš dovoljno kredita." (bez bete) + isti toast u ekranu.
13. Baneri: pristup-baner.tsx — dopuna bez paketa (§1.12), grace sa uzrokom (§2.3: past_due /
    besplatni potrošeni / istekao). app/zakljucano/page.tsx — grana bez punDo „Nalog čeka
    plan" (§1.12). /pretraga prazno stanje grace posle besplatnih kredita.
14. Pozivnice: /api/pozivnice/prihvati za komp redirektuje na /pocetak?pozivnica=komp (ne
    /dashboard); /welcome primarno dugme „Napravi prvu listu" → /pocetak, naslov „Proba je
    počela" / „Plan je aktivan" po sesiji (dopuni ono što je K2 uradio).
15. app/api/webhooks/clerk/route.ts — C6: pre obrisiProfil, za stripe_customer_id otkaži
    sve pretplate status in (trialing, active, past_due) (stripe.subscriptions.cancel,
    prorate:false) i označi customer metadata deleted_user; pad → 500 (Svix ponavlja), profil
    se ne briše dok Stripe ne prođe. Test u test/clerk-webhook.ts sa lažnim Stripe klijentom.
16. Testovi: test/pristup.ts (O3), test/onboarding.ts (mark_step kroz validate-migrations:
    četiri koraka → done_at; nepoznat korak baca; idempotentno), test/kartica.ts (stanje iz
    podataka: locked/u toku/greška/nema sajt/otključano; LockedLead nema zabranjene ključeve —
    proveri JSON ključeve, ne tipove), test/unlock.ts (enrichJobId, ponovni enqueue).
    scripts/validate-migrations.ts: 0026 dvaput, create_profile_with_grant daje 2 u topup.

PRAVILA (CLAUDE.md): 3 (krediti samo kroz RPC — nema nove putanje, onboarding ide kroz
grant_credits/spend_*), 5 (nula Places poziva u onboardingu — proveri api_budget pre/posle
prolaza), 8 (userId iz sesije), 9 (LockedLead bez zaključanih ključeva; maska iz null), 11
(country_code), 16. DIZAJN-SISTEM §7.1, nijedan hex u JSX-u, obe teme, ≤390 px, .num na
brojevima. Terminologija SUMMARY §9: prospekt, otključaj, skeniranje, kredit, utisak; nikad
„beta" ni „trial" u UI. Zod 4 strictObject na svakoj novoj ruti. Ako nešto iz §4/§7 ne može
kako piše — reci tačno šta, ne improvizuj.

GOTOVO
- pnpm typecheck, pnpm check:sql, pnpm test, pnpm --filter web lint, pnpm build čisti.
- Ručni prolaz (lokalno, stripe listen): nov nalog bez kartice → /pocetak → lista (1 kredit)
  → „prvi je besplatan" → kartica u toku → puna → Kopiraj → Kontaktiran → traka „Sva četiri"
  nestaje; drugi prospekt → „treba plan"; /pretraga → „Probao si besplatno"; /lista i dalje
  radi; SQL iz §4.9 pokazuje sva četiri koraka. Zatim isti prolaz sa probom (12 kredita) i sa
  komp pozivnicom (/pocetak?pozivnica=komp).
- api_budget nepromenjen posle oba prolaza (paste output u SESIJE.md).
- Brisanje naloga iz Clerk-a sa živom test pretplatom → pretplata u Stripe-u canceled PRE
  nego što profil nestane (screenshot Stripe eventa u SESIJE.md).
- Kartica u pet stanja, obe teme, 390 px — screenshoti u docs/PROVERA-VIZUELNA.md.
- docs/SESIJE.md unos S28; docs/LANSIRANJE.md štiklirati S27 i S28 sa napomenom „po
  docs/tok-i-onboarding.md".
```

### K5 — Feedback poboljšanja (S29)

```
Sesija S29. Cilj: feedback sistem prestaje da govori o beti, dobija NPS, „šta ti fali",
citat posle potpisa i prijavu greške sa mesta gde nastaje. Commit: „S29: feedback". Preduslov:
K4 (kartica ima stanje greške i ctx).

Pročitaj docs/tok-i-onboarding.md §5 CEO, docs/F11-utisci-v2.md §2, §3, §6.2, §6.6 (kao
kontekst — §5.2 ovog dokumenta nadjačava gde se razlikuju), packages/shared/src/
feedback-katalog.ts CEO, feedback-motor.ts, apps/web/src/lib/feedback.ts,
components/utisak-dugme.tsx, utisak-kartica.tsx, utisak-mikro.tsx, utisci-provider.tsx,
app/(admin)/admin/utisci/page.tsx, components/admin-utisak-panel.tsx, app/api/cron/
utisci-digest/route.ts.

FAJLOVI
1. packages/shared/src/feedback-katalog.ts — obriši `cena` (i CENA_OPSEZI, medijanaCene,
   PRAG_CENE_RSD ako ih niko drugi ne koristi — grep); KRAJ_BETE → ROK_PITANJA = "2027-12-31"
   (svako `do`); dodaj `nps-7` (§5.3 A, doslovno), `fali` (§5.3 C: mikro, tekstPrvi,
   ponovi 24h, bez uslova, okida ga ekran), treći korak na `prvi-potpisan` (citat: da-ime /
   da-bez / ne, §5.3 B) sa dopunom placeholder-a; `poruka-kvalitet` okidač = prvo Kopiraj
   bilo koje poruke (kartica šalje događaj). Šeme Zod za sve. PITANJE_KLJUCEVI se sam ažurira.
2. packages/shared/src/feedback-motor.ts — treće odbacivanje = 90 dana (ne do kraja bete);
   test/feedback-motor.ts prilagoditi.
3. apps/web/src/lib/feedback.ts — trebaPodsetnik: + uslov otkljucano ≥ 1; nagradaDostupna:
   + pristup.stanje !== 'proba'.
4. components/utisak-dugme.tsx — zaglavlje „<Ekran>" bez „· beta"; prop `otvoriBug(ctx)` za
   §5.3 D: kind=bug preselektovan, ctx sa servera (placeId, jobId, route, korak, stanje,
   greska) — ruta POST /api/feedback prima `ctxKljuc` (placeId/jobId) i sama ČITA ostalo,
   nikad ne prima plan/stanje iz tela. Link „Prijavi grešku" na: kartica stanje greške,
   skeniranje-modal greška, toast 402/403/500 unlock i search, /welcome, pretplata-blok
   past_due.
5. Prazna stanja: `fali` mikro ispod praznog stanja na /pretraga (filteri), /lista (posle 7
   dana), combobox niša kad tekst pretraga vrati 0 (ctx.query), /pipeline (posle 7 dana).
   Događaj ide kroz UtisciProvider.prijavi('fali', ctx) — motor odlučuje, ekran ne.
6. NPS kartica: utisak-kartica.tsx podržava 11 opcija u redu (≤390 px: 0–5 / 6–10).
7. app/dashboard/page.tsx — „Beta dnevnik" → „Novo u Sajtoskopu"; grep -ri "beta" apps/web/src
   mora da vrati 0 u tekstu koji korisnik vidi (komentari smeju).
8. Migracija 0027_feedback_nps.sql — funkcija admin_nps() (score, n, promoteri, pasivni,
   detraktori, poslednjih_30_dana) i admin_fali(p_route text default null) (message,
   count, route, poslednji_put) grupisano po lower(trim(message)). Bez novih tabela.
9. Admin: /admin/utisci red brojki — medijana cene → NPS (admin_nps); filter sloj + „Fali"
   (admin_fali lista) i „Citat" (answers->>'citat'); dugme „Kopiraj kao referencu";
   admin-utisak-panel.tsx blok „Kontekst" iz ctx (placeId → link na /pretraga?…, jobId →
   status/error iz job_queue, korak, stanje). /admin pregled: kartica NPS.
10. Cron utisci-digest: dve linije na vrhu (NPS ove nedelje, Fali: N novih).
11. Testovi: test/feedback-katalog.ts (nps-7 šema 0–10 i odbija 11; fali traži tekst; citat
    samo posle preporuka=da), test/feedback-motor.ts (90 dana), test/feedback-ruta.ts (telo sa
    `plan` se ignoriše; ctx se čita sa servera). validate-migrations: 0027 dvaput, admin_nps
    na praznoj tabeli vraća n=0 bez greške.

PRAVILA: 3 (nagrade samo kroz grant_feedback_credits), 8 (ctx sa servera), 10 (RLS na
feedback ostaje using(false), čitanje kroz service_role rute), 13/14 (admin 404, admin_audit
na svaku mutaciju), 16 (pitanje ne postoji dok nije u katalogu). Terminologija: utisak,
prijava, pitanje (nikad anketa), „Novo u Sajtoskopu". Nijedan hex, obe teme, ≤390 px.
Nema nove infrastrukture: nijedan nov bucket, cron, servis ni tabela — ako ti se učini da
treba, stani i reci.

GOTOVO
- typecheck, check:sql, test, lint, build čisti; grep „beta" u UI tekstu = 0.
- Ručno: nalog star 7 dana (pomeri created_at u bazi) sa 1 otključanim → NPS kartica na
  /pretraga, odgovor 9 + tekst → feedback red prompt_key nps-7, answers.ocena=9, bez nagrade;
  admin_nps() vraća score 100, n 1. Prazan filter → „Šta ti ovde fali?" → tekst → admin_fali.
  Kartica u stanju greške → „Prijavi grešku" → panel sa bug + ctx.placeId → admin panel blok
  Kontekst sa linkom i statusom posla. Prvi potpisan → tri koraka → citat=da-ime → filter
  Citat → „Kopiraj kao referencu".
- docs/SESIJE.md unos S29; screenshoti u PROVERA-VIZUELNA.md (NPS kartica 390 px, panel bug
  sa kontekstom, admin NPS).
```
