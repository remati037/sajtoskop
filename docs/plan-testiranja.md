# Sajtoskop — plan testiranja pred lansiranje

> Stanje na **16. septembar 2026** · kod zaključno sa migracijom `0034`.
> PDF verzija: `docs/plan-testiranja.pdf` (`pnpm docs:pdf`). Redosled i veza sa lansiranjem:
> `docs/lansiranje-checklista.md`, sekcija 3.

**Kako se koristi.** Svaki scenario ima **korake** i **očekivano**. Scenario je prošao tek
kad važi sve iz „očekivano" — i na ekranu i u bazi. Štikliraj ovde; sve što padne upiši u
zapisnik na dnu (šta, gde, snimak ili SQL izlaz), pa tek onda idi dalje.

**Delovi:** 0 Priprema · 1 Automatske provere · 2 Registracija i onboarding · 3 Pretraga,
skeniranje i pristup · 4 Kartica i otključavanje · 5 Poruke, pipeline, lista i izvoz ·
6 Naplata · 7 Pozivnice · 8 Životni ciklus pristupa · 9 Admin konzola · 10 Utisci ·
11 Brisanje naloga · 12 Worker i budžet · 13 Bezbednost · 14 Vizuelni prolaz ·
15 Produkcija posle live-a · Zapisnik.

---

## 0. Priprema

**Okruženje.** Delovi 1–10 i 12–14 rade se lokalno. Deo 11 traži Clerk webhook, pa se radi
na `app.sajtoskop.com` **dok Production još nosi Stripe test ključeve** (pre koraka 6.4
checkliste). Deo 15 je posle prelaska na live.

‼️ Ako lokalni `.env` i dalje gađa **produkcijsku** bazu (checklista 1.5 nije urađena), sve
što ovde napraviš završava među pravim podacima i troši pravi Places budžet. Posle testiranja
obavezno checklista 6.6.

**Šta mora da radi pre prvog scenarija**
1. Terminal 1: `pnpm dev` → `http://localhost:3000`.
2. Terminal 2: `stripe listen --forward-to localhost:3000/api/billing/webhook`. Ispisani
   `whsec_…` mora da bude `STRIPE_WEBHOOK_SECRET` u lokalnom `.env` (posle izmene restartuj
   `pnpm dev`).
3. Terminal 3 (za skeniranje i otključavanje): `pnpm worker`. Prvi put:
   `pnpm --filter @sajtoskop/worker exec playwright install chromium`.
   Ako lokalni i Hetzner worker gledaju istu bazu, poslove uzima onaj ko stigne prvi — i to je
   u redu.
4. `pnpm stripe:doktor` prolazi.

**Nalozi.** Clerk development instanca prihvata adrese sa `+clerk_test` i kod za potvrdu
**`424242`** — nijedan mejl ne mora stvarno da stigne.

| Oznaka | Nalog | Za šta |
|---|---|---|
| **A** | tvoj admin nalog | konzola, pozivnice, admin bez kredita |
| **B** | `ime+b+clerk_test@gmail.com` | nov nalog bez kartice (onboarding, 2 kredita) |
| **C** | `ime+c+clerk_test@gmail.com` | proba i pretplata |
| **D** | `ime+d+clerk_test@gmail.com` | komp pozivnica |
| **E** | `ime+e+clerk_test@gmail.com` | pozivnica „prvi mesec gratis" |
| **F** | `ime+f+clerk_test@gmail.com` | životni ciklus (rokovi u prošlosti) |

Pre svakog dela koji ponovo koristi nalog: ako treba „čist" nalog, obriši ga u Clerku i
napravi nov sa novim aliasom (`+b2`, `+b3`…).

**Stripe test kartice**

| Kartica | Ponašanje |
|---|---|
| `4242 4242 4242 4242` | prolazi |
| `4000 0025 0000 3155` | traži 3D Secure potvrdu |
| `4000 0000 0000 0341` | kartica se sačuva, ali svaka naplata pada |
| `4000 0000 0000 9995` | odbijena odmah (nedovoljno sredstava) |
| `4000 0000 0000 0259` | naplata prolazi, pa se otvara spor |

Bilo koji budući datum, bilo koji CVC, bilo koje ime.

**Test clock — pomeranje vremena** (`scripts/stripe-sat.ts`). Kupac mora da nastane pod
satom, pa se pravi pre checkout-a:
1. Nađi `profiles.id` naloga (SQL ispod).
2. `pnpm stripe:sat nov <profiles.id> <mejl>` — ispiše `clock_id` i SQL koji upisuje
   `stripe_customer_id` u profil. Pusti taj SQL.
3. Checkout radiš normalno iz aplikacije — ruta zatekne postojećeg kupca.
4. `pnpm stripe:sat pomeri <clock_id> +8d` — čeka dok sat ne bude spreman; webhookovi stižu
   kroz `stripe listen`.
5. Između dve izmene iste pretplate sačekaj par minuta (Stripe rate limit na satu).

**SQL koji se stalno koristi** (Supabase → SQL Editor)
```sql
-- profil
select id, plan, role, credits_balance, credits_topup, komp_expires_at, plan_expires_at,
       stripe_customer_id, invite_id, created_at, onboarding_steps, onboarding_done_at
from profiles where id = '<clerk_id>';
-- knjiga kredita
select id, reason, ref_id, delta, balance_after, details, created_at
from credit_ledger where user_id = '<clerk_id>' order by id;
-- pretplata
select stripe_subscription_id, status, plan, ciklus, lookup_key, current_period_end,
       trial_end, cancel_at_period_end, cancel_at, canceled_at
from subscriptions where user_id = '<clerk_id>';
-- pristupi listama
select city_slug, niche_slug, pages, expires_at, job_id from search_access where user_id = '<clerk_id>';
-- poslednji poslovi
select id, type, status, attempts, last_error, created_at from job_queue order by id desc limit 10;
-- Places budžet
select day, month, calls, exhausted_at from api_budget order by day desc limit 3;
-- revizija
select action, ok, actor_id, target_user, payload, created_at from admin_audit order by id desc limit 10;
-- webhook događaji
select event_id, event_type, received_at from billing_events order by received_at desc limit 10;
```

---

## 1. Automatske provere

- [ ] **1.1 · Tip, lint, testovi, migracije, build**
  ```bash
  pnpm install
  pnpm typecheck
  pnpm --filter @sajtoskop/web lint
  pnpm test
  pnpm check:sql
  pnpm build
  pnpm check:secrets
  ```

  **Očekivano:** svaka komanda završava bez greške; `check:sql` ispisuje „Sve prošlo";
  `check:secrets` posle build-a ne nalazi `service_role` ni ključ u `.next/static`.

- [ ] **1.2 · Provere nad pravom bazom**
  ```bash
  pnpm check:f1
  pnpm check:f4
  ```
  Pusti nad bazom kojoj je namenjeno (dev baza ako postoji) — skripte prave i brišu privremene
  profile.

  **Očekivano:** obe „Sve prošlo"; u `check:f4` trka od 20 paralelnih otključavanja i 20
  paralelnih plaćanja iste liste daje tačno jednu naplatu.

- [ ] **1.3 · CI**
  GitHub → Actions → poslednji commit na `main`.

  **Očekivano:** zeleno (typecheck, testovi, `check:sql`, build, lint, provera da težine Ugly
  Score-a nisu u bundle-u, audit, gitleaks).

---

## 2. Registracija i onboarding

Pre prvog klika u ovom delu i posle poslednjeg: `select day, calls from api_budget order by day desc limit 1;`
— **broj mora da bude isti**. Onboarding ne sme da napravi nijedan Places poziv. Keš mora da
ima bar nekoliko svežih kombinacija (checklista 7.1), inače čarobnjak nema šta da ponudi.

- [ ] **2.1 · Nov nalog bez kartice (B) — ceo prolaz**
  1. Privatni prozor → `http://localhost:3000` → kartica **Registracija** → uz dugme stoji
     rečenica sa linkovima na Uslove i Privatnost → registruj nalog B.
  2. Aplikacija sama vodi na **`/pocetak`** (bez bočne trake).
  3. Ekran 1 (grad): gradovi imaju red sa brojem gotovih lista i firmi bez sajta; **Enter** ide
     dalje; tačkice 1–4 ispod naslova, bez „1 od 4"; „Preskoči" gore desno.
  4. Ekran 2 (niša): čipovi sa brojem firmi i brojem bez sajta; „Nazad" dole levo radi.
  5. Ekran 3 (kanal): tri kartice Viber / mejl / Instagram.
  6. Ekran 4: tri broja i rečenica „Imaš 2 besplatna kredita…"; dugme „Otvori listu · 1 kredit".
  7. Klik → `/pretraga?grad=…&nisa=…&dubina=brzo`, lista stoji odmah, **bez modala**; u bočnoj
     traci „Prvih pet minuta 1/4".
  8. Tačka 1 stoji uz prvi bedž „Nema sajt" → „Jasno" → posle par sekundi tačka 2 uz „Otključaj".
  9. Dugme na kartici kaže **„Otključaj · prvi je besplatan"** → klik (bez modala) → kartica u
     toku (telefon i mejl odmah, analiza traje) → puna kartica posle završetka.
  10. Tab poruke je kanal izabran u čarobnjaku (Viber za mobilni broj); tačka 3 uz tabove.
  11. **Kopiraj** → poruka „Kopirano. Označi kao kontaktiran?" sa tačkom 4 → klik → traka kaže
      „Sva četiri…" i nestaje.
  12. Drugi prospekt: dugme **„Otključaj · treba plan"** → modal „Nemaš kredita…" →
      „Pogledaj planove" vodi na `/cenovnik`.

  **Očekivano (baza):**
  ```sql
  -- knjiga: onboarding +2 (ref signup:<id>), scan −1 (lista iz keša), unlock −1
  select reason, ref_id, delta from credit_ledger where user_id = '<B>' order by id;
  -- profil: plan dopuna, credits_topup 0, onboarding_done_at popunjen, onboarding_city/niche/channel popunjeni
  ```
  Sva četiri ključa u `onboarding_steps` (`pretraga`, `otkljucavanje`, `poruka`, `pipeline`)
  imaju vreme. `api_budget` nepromenjen.

- [ ] **2.2 · Posle poslednjeg kredita lista ostaje**
  Nastavak 2.1, nalog B sa 0 kredita.
  1. Osveži `/pretraga`.
  2. Baner i modal kažu **„Nemaš više kredita"** i do kada ostaje otvoreno ono što je plaćeno,
     uz jedan link „Pogledaj planove". Modal ima i „U redu".
  3. Plaćena lista se i dalje otvara, lista se i filtrira; „Osveži" i „Skeniraj ponovo" su skriveni.
  4. Izaberi kombinaciju koju B **nije** platio → nema modala sa cenom, nema naplate.
  5. `/lista` radi, otključan prospekt se otvara sa kontaktom.

  **Očekivano:** ništa od plaćenog ne nestaje; nijedan nov red u knjizi.

- [ ] **2.3 · Preskoči i vodič na zahtev**
  1. Nov nalog (`+b2`) → `/pocetak` → **Preskoči** na ekranu 1 → završava na `/pretraga`;
     `onboarding_skipped_at` je popunjen; traka „Prvih pet minuta" i dalje stoji.
  2. **Sakrij** u traci → traka nestaje i ne vraća se posle osvežavanja; koraci se i dalje beleže.
  3. Ikonica **„?"** u gornjoj traci → panel vodiča; `Esc` i klik van njega zatvaraju.
  4. „Ponovi prve korake" → `/pocetak?ponovo=1` sa preselekcijom; već plaćena lista se ne
     naplaćuje ponovo.

  **Očekivano:** kao u koracima; nijedna naplata u koraku 4.

- [ ] **2.4 · Prazna stanja**
  Nalog bez aktivnosti: `/pretraga` bez izbora (fusnota „Podrazumevano: …"), `/lista`,
  `/pipeline` („Prevuci prospekt ovde"), `/utisci` („Pošalji prvi utisak" otvara panel).

  **Očekivano:** svako prazno stanje kaže šta tu ide i nudi jedno dugme koje to i uradi.

- [ ] **2.5 · Onboarding za probu i komp**
  1. Nalog C posle checkout-a (scenario 6 · N2, dan 0): `/welcome` „Proba je počela" → dugme
     „Napravi prvu listu" → čarobnjak; ekran 4 kaže „Košta 1 kredit — imaš 12".
  2. Nalog D posle prihvatanja komp pozivnice (7 · P1): završava na `/pocetak?pozivnica=komp`
     sa redom „Komp pristup do …, N kredita" iznad naslova.

  **Očekivano:** kao u koracima; `api_budget` nepromenjen.

---

## 3. Pretraga, skeniranje i pristup listama

Skeniranje van keša troši **pravi** Places poziv (1–3 po skeniranju). Za ovaj deo izaberi
male kombinacije i ne ponavljaj bez potrebe.

- [ ] **3.1 · Dubina i cena**
  1. Izaberi kombinaciju van keša. Ispod forme: **Brzo / Standardno / Duboko**, podrazumevano
     Standardno; uz svaku opciju broj firmi i cena (`20 · 1 kredit`, `40 · 2 kredita`,
     `60 · 3 kredita`).
  2. Prođi kroz sve tri: dugme, traka ispod forme i modal potvrde pokazuju istu cenu
     („2 kredita", nikad „2 kredit").
  3. Izaberi Duboko → adresa dobija `&dubina=duboko`; osveži — ostaje. Vrati na Standardno —
     parametar nestaje.
  4. `&dubina=izmisljeno` u adresi → pada na Standardno, bez greške.
  5. Nalog sa 1 kreditom + Duboko → dugme ugašeno, rečenica da je dovoljno za pliću dubinu.

  **Očekivano:** cena svuda ista; posle skeniranja `delta` u knjizi je −1/−2/−3 prema dubini.

- [ ] **3.2 · Pristup listi iz keša se plaća jednom (D10)**
  1. Nalog sa kreditima → kombinacija koja **jeste** u kešu, a nalog je nije platio → modal
     potvrde „iz keša · N kredita · odmah".
  2. Potvrdi → lista stiže odmah, bez skeniranja.
  3. Otvori istu kombinaciju ponovo (i posle osvežavanja, i sa druge strane liste) → bez modala,
     bez naplate.
  4. Blok **„Tvoji pristupi"** na dnu `/pretraga` pokazuje kombinaciju sa rokom „plaćeno do …".

  **Očekivano:**
  ```sql
  select reason, ref_id, delta from credit_ledger where user_id = '<id>' order by id desc limit 3;
  -- jedan scan red (−N); drugi put nema novog reda
  select city_slug, niche_slug, pages, expires_at from search_access where user_id = '<id>';
  -- red postoji, expires_at ≈ +30 dana ili ranije ako Google podatak ranije ističe
  ```
  `api_budget` nepromenjen (keš nema Places poziv).

- [ ] **3.3 · Plitak keš za dublji zahtev**
  1. Kombinacija keširana na **Brzo** → izaberi **Duboko** → lista se prazni, traka kaže da je u
     kešu samo 1 stranica i da duboko košta 3 kredita; modal kaže da podaci nisu stari, samo ih je manje.
  2. Vrati na Brzo → otvara se ono što je plaćeno.

  **Očekivano:** dublji zahtev ide u pravo skeniranje i plaća se; plići ne.

- [ ] **3.4 · Manje firmi nego plaćeno — razlika se vraća**
  1. Izaberi mali grad i retku nišu (manje od 40 firmi) → **Duboko** (3 kredita) → skeniraj.
  2. Ekran kaže „Pronađeno N firmi u …" i koliko je kredita vraćeno (stanje A).

  **Očekivano:**
  ```sql
  select reason, ref_id, delta, details from credit_ledger
  where user_id = '<id>' and reason like 'scan%' order by id desc limit 3;
  -- scan −3 i scan_refund +M (M < 3), ref scan_refund:<job_id>; broj na ekranu = M
  select pages from search_access where user_id = '<id>' order by paid_at desc limit 1;
  -- pages = broj stvarno napravljenih Places poziva
  ```

- [ ] **3.5 · Nula rezultata**
  Kombinacija za koju Google ne vraća ništa (npr. retka niša u malom gradu).

  **Očekivano:** stanje C „Nema rezultata za …", „Nije naplaćeno"; u knjizi nema minusa (ili je
  pun povraćaj), `search_access` za nju ne postoji.

- [ ] **3.6 · Skeniranje bez liste — kredit se vraća sam (stanje B)**
  1. Pokreni skeniranje, pa dok je posao u toku nađi mu `id` (`job_queue`).
  2. Simuliraj pad upisa:
     ```sql
     update job_queue set status = 'running' where id = <id>;
     select fail_scan_and_refund(<id>, 'bez_liste: test');
     ```
  3. Ekran: „Nešto je zastalo kod nas… Vratili smo ti N kredita." sa „Pokušaj ponovo" — bez broja
     posla, bez reči „keš".
  4. „Pokušaj ponovo" → skeniranje se normalno naplaćuje i prolazi.

  **Očekivano:** `scan_refund +N` sa ref `scan_refund:<id>`; `search_access` za tu kombinaciju je
  obrisan; u `admin_audit` red `scan_refund`; ponovni pokušaj pravi nov `scan` red.

- [ ] **3.7 · Skeniranje u toku i povratak**
  1. Pokreni skeniranje → stanje D „Skeniram … — listu ćeš naći u „Tvoji pristupi", na dnu ove strane".
  2. Zatvori tab dok traje, vrati se posle minut → lista je u „Tvoji pristupi" i otvara se bez naplate.
  3. DevTools → Network: `/api/job/:id` je jedan zahtev po krugu, krugovi se proređuju; na
     skrivenom tabu nema novih zahteva.

  **Očekivano:** kao u koracima.

- [ ] **3.8 · Stanje pretrage u adresi**
  1. Grad + niša + filter „Bez funkcionalnog sajta" + strana 2 → adresa nosi `grad`, `nisa`,
     `bezSajta=1`, `strana=2`.
  2. Kopiraj adresu u nov tab → isti prikaz; **Back** vraća prethodno stanje.
  3. Link na kombinaciju koja se plaća → strana pokazuje cenu, **modal se ne otvara sam**.
  4. Promena grada u comboboxu prazni listu.

  **Očekivano:** kao u koracima.

---

## 4. Kartica prospekta i otključavanje

- [ ] **4.1 · Pet stanja kartice**
  Snimak svakog stanja u obe teme, na 1280 px i 390 px:
  1. **Zaključana** — maska telefona `06• ••• ••••`, maska mejla ili „nema mejl", broj problema
     i redovi maske; nigde zamućen pravi tekst.
  2. **U toku** — „Analiziram sajt…", signali, skeleton sličice.
  3. **Greška** — poruka, „Pokušaj ponovo" (najviše 2×), „Prijavi grešku" otvara panel sa
     tipom Bug.
  4. **Nema sajt** — „nema domen", objašnjenje zašto je to dobar prospekt.
  5. **Otključana** — telefon (Mobilni · Viber), mejl skraćen u sredini, problemi po težini,
     sličica otvara preklop, tabovi Viber/Mejl/Instagram/Poziv, Kopiraj, Napiši drugačije.

  **Očekivano:** na 390 px kontakti su u tri reda, tabovi skroluju i aktivni ostaje vidljiv.

- [ ] **4.2 · Otključavanje košta tačno jednom**
  1. Otključaj prospekt → potvrda „1 kredit" (sa „Ne pitaj me više danas") → balans −1.
  2. Otvori isti prospekt ponovo, iz `/pretraga` i iz `/lista` → bez naplate.
  3. Dupli brzi klik na „Otključaj" na drugom prospektu → jedna naplata.

  **Očekivano:** `unlock` red po prospektu tačno jednom; `unlocks` ima po jedan red.

- [ ] **4.3 · Otključavanje bez kredita**
  Nalog sa punim pristupom i 0 kredita → „Otključaj".

  **Očekivano:** modal „Nemaš kredita…" sa izlazom na planove (ili pakete, ako nalog sme da ih
  kupi); ništa se ne skida.

- [ ] **4.4 · Admin ne troši kredite (0029)**
  Nalog A → otključaj prospekt i skeniraj Brzo.

  **Očekivano:** balans se ne menja, u knjizi **nema** novih redova; `unlocks` i
  `search_access` nastaju; bočna traka i zaglavlje pokazuju ∞; nema banera ni ponude plana;
  `api_budget` raste (budžet važi i za admina).

---

## 5. Poruke, pipeline, lista i izvoz

- [ ] **5.1 · Poruka i „Napiši drugačije"**
  1. Otključan prospekt → tab Viber → Kopiraj → „Označi kao kontaktiran?" → klik → u pipeline-u
     prospekt je „Kontaktiran". Isto iz panela poruka u pipeline-u (tamo Kopiraj sam označava).
  2. „Napiši drugačije" → nova varijanta stiže za taj prospekt (otvori dva prospekta paralelno
     — varijante se ne mešaju).
  3. Ponavljaj „Napiši drugačije" do dnevnog limita plana (Starter/dopuna 5, Pro 20, Advanced i
     komp 60).

  **Očekivano:** posle limita poruka sa datumom kad se limit resetuje (429), bez pada.

- [ ] **5.2 · Pipeline**
  1. Prevuci karticu kroz kolone Nekontaktiran → Kontaktiran → Odgovorio → Potpisan.
  2. Na 390 px promeni status kroz „Premesti u…" bez prevlačenja.
  3. Beleška: kucaj pa **Esc** → ne upisuje; klik pored → upisuje.
  4. Prvi „Potpisan" → iskoči pitanje iz utisaka (Deo 10.4).

  **Očekivano:** statusi se čuvaju posle osvežavanja.

- [ ] **5.3 · Moja lista i CSV izvoz**
  1. `/lista` → svi otključani prospekti; „Prikaži još" posle 30.
  2. **Izvezi CSV** → fajl se otvara u Excelu/Numbers sa ispravnim č/ć/š/ž.
  3. Izvezi iz pipeline-a isto.

  **Očekivano:** CSV ima samo otključane; u Network tabu izvoz ne zove Storage.

- [ ] **5.4 · Uvoz u pipeline**
  Pipeline → Uvoz → CSV sa 20 redova.

  **Očekivano:** uvezeni prospekti se pojave odmah, bez punog osvežavanja; ponovljen uvoz ne
  duplira.

---

## 6. Naplata (Stripe test mod)

Posle **svakog** scenarija zalepi izlaz knjige i pretplate u zapisnik. Webhookovi se vide u
terminalu sa `stripe listen` — svaki mora da vrati `200`.

- [ ] **N1 · Pro mesečno, bez probe**
  Nalog koji je već imao probu (npr. C posle N3) — samo takvom checkout ne daje novu probu.
  1. `/cenovnik` → Pro, Mesečno → dugme → Stripe Checkout → `4242…` → plati.
  2. `/welcome` kaže „Plan je aktivan" (za paket: „Plaćanje je primljeno").
  3. `/krediti` pokazuje Pro, mesečno, datum sledeće naplate.
  4. Potvrda uplate: u test modu Stripe ne šalje račune sam — Dashboard → Payments → uplata →
     **Send receipt** na svoju adresu i proveri jezik i sadržaj (ili naš mejl „Uplata primljena",
     ako je isporučen u 2.6).

  **Očekivano:** `subscriptions.status = active`, `plan = pro`, `ciklus = month`;
  `profiles.plan = pro`, `plan_expires_at ≈ +30 dana`, `stripe_customer_id` popunjen; knjiga ima
  `monthly_grant` sa ref `in_…`, balans **450**; `billing_events` ima
  `checkout.session.completed`, `customer.subscription.created`, `invoice.paid`.

- [ ] **N2 · Proba → plaćeno posle 8 dana**
  1. Nov nalog C → `pnpm stripe:sat nov <C> <mejl>` → pusti ispisani SQL.
  2. `/cenovnik` → Starter mesečno → `4242…` → `/welcome` „Proba je počela", „Starter, mesečno,
     proba do …".
  3. `/krediti` → „Proba do <datum>", kasa „Probni".
  4. `pnpm stripe:sat pomeri <clock> +4d` → `customer.subscription.trial_will_end` u
     `billing_events` i mejl „Proba se završava <datum>" na adresi naloga (checklista 2.6).
  5. `pnpm stripe:sat pomeri <clock> +4d`.

  **Očekivano:** dan 0 — `status trialing`, `trial_end ≈ +7d`, knjiga `trial_grant +10` ref
  `trial:<C>`, balans 10 (+2 dopune), **nema** `monthly_grant`. Posle sata — `invoice.paid`
  (`subscription_cycle`), `monthly_grant` ref `in_…`, balans **150 (ne 160)**, `status active`,
  `plan_expires_at ≈ +30d`.

- [ ] **N3 · Proba otkazana pre kraja**
  1. Nalog u probi (pod satom) → `/krediti` → Upravljaj pretplatom → portal → otkaži.
  2. `/krediti` i baner: „Proba je otkazana i traje do …".
  3. `pnpm stripe:sat pomeri <clock> +8d`.

  **Očekivano:** posle otkaza `cancel_at = trial_end`, `status trialing`, stanje `otkazan`.
  Posle sata: `customer.subscription.deleted`, knjiga `expire` (−ostatak), balans 0,
  `status canceled`, stanje `grace` (samo čitanje).

- [ ] **N4 · Kartica pada osmog dana**
  1. Nov nalog pod satom → checkout sa `4000 0000 0000 0341`.
  2. `pnpm stripe:sat pomeri <clock> +8d`.
  3. `/krediti` → „Naplata nije prošla. Ažuriraj karticu." sa dugmetom za portal; baner isti.
  4. `pnpm stripe:sat pomeri <clock> +8d` (Smart Retries se iscrpe).

  **Očekivano:** dan 8 — `invoice.payment_failed` u `billing_events`, `status past_due`, stanje
  `grace` (čitanje radi, skeniranje i otključavanje ne). Posle retry-a —
  `customer.subscription.deleted`, balans 0.

- [ ] **N5 · Aktiviraj odmah**
  1. Nalog u probi → `/krediti` → **Aktiviraj odmah** → modal „Naplaćuje se €29 sada…" → potvrdi.
  2. Posle par sekundi `/krediti` kaže „Pretplata je aktivna", balans 150.
  3. Drugi nalog u probi sa karticom `…0341` → Aktiviraj odmah.

  **Očekivano:** (1–2) `trial_end` nestaje, `invoice.paid` `monthly_grant`, balans 150. (3) poruka
  da kartica nije prošla (402), **proba i dalje traje**, ništa se ne menja u knjizi.

- [ ] **N6 · Upgrade Starter → Pro kroz portal**
  Aktivan Starter → Upravljaj pretplatom → promeni plan → Pro mesečno.

  **Očekivano:** `customer.subscription.updated` sa `pro_month`, `profiles.plan = pro`;
  `invoice.paid` (`subscription_update`, proraciona faktura) → `monthly_grant` sa novim `in_…`,
  balans **450**.

- [ ] **N7 · Downgrade Pro → Starter**
  Aktivan Pro pod satom → portal → Starter → `pnpm stripe:sat pomeri <clock> +31d`.

  **Očekivano:** do obnove `profiles.plan = pro`, balans netaknut; na obnovi faktura po Starter
  ceni → balans **150**, i kad `invoice.paid` stigne pre `subscription.updated` (pogledaj
  redosled u `billing_events`).

- [ ] **N8 · Otkaz pa reaktivacija**
  Aktivan plan → portal → otkaži → `/krediti` „otkazana, traje do <datum>" → portal → **Renew**.

  **Očekivano:** `cancel_at` popunjen pa `null`, stanje `otkazan` → `aktivan`; nula novih redova u
  knjizi. Zapiši da li Stripe pri „Renew" briše i `canceled_at`.

- [ ] **N9 · Povraćaj pretplate**
  1. Aktivan Pro (450) → upgrade na Advanced (proracija, +750).
  2. Stripe Dashboard (test) → Payments → proraciona naplata → **Refund** pun iznos.
  3. `stripe events resend <evt_ charge.refunded>`.
  4. Druga proraciona naplata → dva delimična refunda po 50 %.

  **Očekivano:** (2) **jedan** red `povracaj` −750, ref `povracaj:re_…`, balans nazad na
  pre-fakturno stanje; `details` nosi srazmeru. (3) `duplikat`, bez novih redova. (4) **dva**
  reda po −375, svaki sa svojim `re_…`. Balans sme u minus najviše do −1000.

- [ ] **N10 · Paket kredita**
  1. Aktivan plan (ili proba, ili komp) → `/cenovnik#paketi` → Dopuna 200 → `4242…`.
  2. Nalog B (dopuna, bez plana) → sekcija paketa ima katanac i objašnjenje umesto dugmeta.
  3. Iz konzole pregledača naloga B:
     ```js
     fetch("/api/billing/checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({vrsta:"paket",paket:"dopuna-200"})}).then(r=>r.status)
     ```

  **Očekivano:** (1) `credit_pack +200` ref `pi_…`, `credits_topup = 200`, `credits_balance`
  netaknut. (3) **403** — kapija je na serveru, ne samo na ekranu.

- [ ] **N11 · Povraćaj delimično potrošenog paketa**
  Nalog iz N10 potroši 50 kredita iz paketa (posle balansa), pa refund paketa u Dashboardu.

  **Očekivano:** red `povracaj` −200; dopuna na 0, ostatak kao dug u balansu; u `admin_audit`
  red `refund_preliv` sa `iz_dopune` i `iz_balansa`.

- [ ] **N12 · Dupli webhook**
  1. `stripe events resend <evt_ invoice.paid>` → odgovor `duplikat`.
  2. `delete from billing_events where event_id = '<evt_>';` pa ponovo resend.

  **Očekivano:** (1) knjiga nepromenjena. (2) `grant_monthly_credits` vraća `already_granted`,
  balans isti.

- [ ] **N13 · Godišnji plan**
  Nov nalog → Starter **Godišnje** → `4242…`.

  **Očekivano:** `ciklus = year`, `plan_expires_at ≈ +1 godina`; prva dodela 150 iz `invoice.paid`
  (`subscription_create`, ili posle probe `subscription_cycle`). Worker u tekućem mesecu ne
  dodeljuje ponovo (mesec nastanka pretplate se preskače); sledeće dodele stižu 1. u mesecu.

- [ ] **N14 · Spor (dispute)**
  1. Aktivan nalog → paket sa karticom `4000 0000 0000 0259` → posle par sekundi Stripe otvara spor.
  2. Dashboard → Disputes → spor → Submit evidence, u tekst upiši `losing_evidence` → pošalji.

  **Očekivano:** `charge.dispute.created` → samo log, krediti netaknuti.
  `charge.dispute.closed` sa `lost` → red `povracaj` sa ref `spor:dp_…`, iznos jednak dodeli.

- [ ] **N15 · Odbijena kartica i 3DS**
  1. Checkout sa `4000 0000 0000 9995` → Stripe prikazuje odbijanje, u bazi se ništa ne menja.
  2. Checkout sa `4000 0025 0000 3155` → potvrdi 3DS → isto kao N1/N2.

  **Očekivano:** kao u koracima.

---

## 7. Pozivnice

- [ ] **P1 · Komp pozivnica**
  1. Nalog A → `/admin/pozivnice` → Pristupne pozivnice → Komp, 30 dana, 300 kredita, upotreba 1
     → Napravi → Kopiraj link.
  2. Privatni prozor → link → gost vidi karticu pozivnice i registraciju → registruj D →
     „Prihvati".
  3. Drugi nov nalog istim linkom → „Prihvati".
  4. Nalog D → `/cenovnik` → pokušaj kupovinu plana.

  **Očekivano:** (2) `profiles.plan = komp`, `komp_expires_at ≈ +30d`, `komp_grant +300` ref
  `invite:<id>`, red u `access_invite_redemptions`; D završava na `/pocetak?pozivnica=komp`.
  (3) „Kod je već iskorišćen." (4) 409 sa objašnjenjem. U reviziji `invite.create` bez mejla i
  koda u `payload`.

- [ ] **P2 · Prvi mesec gratis**
  1. A pravi pozivnicu tipa „Prvi mesec" vezanu za mejl E.
  2. E se registruje preko linka → Prihvati → `/cenovnik` pokazuje bedž „Prvi mesec €0" i „od
     drugog meseca €59" (samo mesečni ciklus).
  3. Pro mesečno → `4242…` (Checkout pokazuje €0 danas).
  4. Prebaci na Godišnje → bedža nema, kupon se ne primenjuje.

  **Očekivano:** `invite_id` postavljen pa `null` posle `checkout.session.completed`;
  `invoice.paid` sa `amount_due = 0` → **dodela 450** (za razliku od probe); `status active`,
  `trial_end null`.

- [ ] **P3 · Greške pozivnica**
  1. Pozivnica vezana za drugi mejl → „…za drugu adresu. Prijavi se nalogom sa adresom na koju je
     poslata."
  2. Nalog sa aktivnim planom prihvata pozivnicu → „Već imaš plan."
  3. A opozove pozivnicu → link pokazuje opozvanu pozivnicu bez dugmeta, i bez prijave.
  4. Nepostojeći kod `/pozivnica/SAJT-XXXX-XXXX` → „Kod ne postoji."
  5. `fetch("/api/pozivnice/prihvati",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:"X",userId:"user_tudji"})}).then(r=>r.status)` → **400**.

  **Očekivano:** kao u koracima; opoziv „prvi mesec" briše `invite_id` i nalozima koji ga još
  nisu iskoristili.

---

## 8. Životni ciklus pristupa

Sedam stanja: `komp`, `proba`, `aktivan`, `otkazan`, `dopuna`, `grace`, `zakljucan`. Posle
svake izmene u bazi: **puno osvežavanje** (`Cmd+Shift+R`), ne klik u aplikaciji.

- [ ] **8.1 · Komp → grace → zaključano**
  1. A → `/admin/korisnici/<F>` → Otvori komp (30 dana, 300 kredita) → F ima pun pristup.
  2. A → rok komp pristupa na **juče** (potvrdi rok u prošlosti).
  3. F: žuta traka na svakom ekranu sa datumom isteka i datumom do kog čitanje radi, link ka
     cenovniku; modal „Pristup ti je istekao" jednom (posle zatvaranja i 5 osvežavanja se ne vraća).
  4. F u grace-u: `/lista` i izvoz CSV rade, pipeline radi, poruke se kopiraju; skeniranje,
     otključavanje, uvoz i „Napiši drugačije" ne rade.
  5. A → rok na **pre 40 dana**.
  6. F: svaka strana u aplikaciji (`/pretraga`, `/lista`, `/pipeline`, `/krediti`, `/dashboard`,
     `/utisci`) vodi na **`/zakljucano`** sa oba datuma i „Pogledaj planove".

  **Očekivano (API):** u grace-u `POST /api/search` sa `pay`, `/api/unlock` i `/api/uvoz` → 403 sa
  rečenicom na srpskom; `/api/export` → 200 i CSV. Zaključan: `/api/export` → 403.

- [ ] **8.2 · Nalog bez kartice koji je potrošio kredite**
  Nalog B posle 2.2.
  1. `update profiles set created_at = now() - interval '31 days' where id = '<B>';`
  2. Osveži → `/zakljucano` sa naslovom **„Nalog čeka plan"**.
  3. `update profiles set created_at = now() - interval '10 days' where id = '<B>';` → nazad u
     samo-čitanje.

  **Očekivano:** kao u koracima.

- [ ] **8.3 · Stanja koja su već pokrivena drugde**
  `proba` (N2), `otkazan` (N3, N8 — plava traka, sve radi normalno), `aktivan` (N1), `dopuna`
  (2.1), grace zbog naplate (N4).

  **Očekivano:** svako stanje je viđeno na ekranu bar jednom; upiši u zapisnik gde.

---

## 9. Admin konzola

- [ ] **9.1 · Ne-admin ne zna da konzola postoji**
  Nalog B → `/admin`, `/admin/korisnici`, `/admin/pozivnice`, `/admin/utisci`, `/admin/revizija`,
  `/admin/dnevnik`; i iz konzole `fetch("/api/admin/pozivnice/pristup",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(r=>r.status)`.

  **Očekivano:** svuda **404**, nigde 403.

- [ ] **9.2 · Lista i detalj korisnika**
  1. `/admin/korisnici` → kolona stanja sa bedžom po stanju; filter po stanju menja adresu
     (`?stanje=proba`, `?stanje=grace`…) i preživljava Back.
  2. Kolona krediti: balans i dopuna odvojeno (`450 +2`).
  3. Detalj → blok „Pristup": rokovi, „pun pristup do", „čitanje do", pozivnica ako postoji;
     blok „Krediti" sa obe kase.

  **Očekivano:** brojevi odgovaraju bazi.

- [ ] **9.3 · Radnje i revizija**
  Na detalju naloga F: korekcija kredita (+10 pa −5), promena dnevnog limita, otvori komp dvaput
  zaredom, rok komp u prošlosti.

  **Očekivano:** svaka radnja ima red u `/admin/revizija` sa `ok = true`, a `payload` bez ključa,
  tokena i lozinke; drugo „Otvori komp" ne dodeljuje kredite ponovo; namerno neispravan unos
  (npr. rok 20 godina unapred) ostavlja red sa `ok = false`.

- [ ] **9.4 · Pregled, dnevnik, utisci**
  `/admin` (brojke, NPS, budžet), `/admin/dnevnik` (napravi, izmeni, obriši stavku → vidi se na
  `/dashboard` kao „Novo u Sajtoskopu"), `/admin/utisci` (filteri Fali i Citat, panel „Kontekst",
  „Kopiraj kao referencu").

  **Očekivano:** sve radi u obe teme, tabele skroluju vodoravno na 390 px.

---

## 10. Utisci

- [ ] **10.1 · NPS kartica**
  `update profiles set created_at = now() - interval '8 days' where id = '<id>';` na nalogu sa
  bar jednim otključanim → `/pretraga` → posle ~60 s kartica „Koliko je verovatno…".

  **Očekivano:** skala 0–10 (na 390 px 0–5 i 6–10 u dva reda); ocena 9 → polje za rečenicu, bez
  „+1 kredit"; u bazi `feedback.prompt_key = 'nps-7'`, `answers.ocena = 9` kao broj,
  `reward_credits = 0`. Nalog bez otključanog kartice ne vidi.

- [ ] **10.2 · „Šta ti ovde fali"**
  1. Filteri dok lista ne ostane prazna → traka „Šta ti ovde fali?".
  2. Niša koje nema u comboboxu (npr. „kotlarnica") → traka „Ne vidiš svoju nišu? Napiši je."
  3. Odgovori → `/admin/utisci` filter Fali → isti tekst tri puta = jedan red sa brojem 3.

  **Očekivano:** nikad dve trake odjednom; upit je u `ctx.query`.

- [ ] **10.3 · Prijava greške sa mesta gde nastaje**
  Otključavanje ili skeniranje koje padne → „Prijavi grešku" uz poruku → panel „Šta nije radilo?"
  sa tipom Bug.

  **Očekivano:** u `/admin/utisci` blok „Kontekst" nosi stanje pristupa, prospekt, poruku koju je
  čovek video, onboarding korake i **trenutni** status posla.

- [ ] **10.4 · Citat posle prvog potpisanog**
  Prvi prospekt u kolonu Potpisan → tri koraka pitanja; na „Bi li preporučio" odgovor „Da" →
  treći korak „Smem li da citiram…"; odgovor „Možda/Ne" → trećeg nema.

  **Očekivano:** `da-ime` + rečenica → filter Citat → „Kopiraj kao referencu" daje
  `„<rečenica>” — <mejl>, <datum>`.

- [ ] **10.5 · Mejl utiska**
  Pošalji utisak sa slikom.

  **Očekivano:** mejl stiže na `FEEDBACK_EMAIL_TO`; slika je u privatnom bucketu `feedback`.

---

## 11. Brisanje naloga

Radi se na **`app.sajtoskop.com`** dok Production nosi Stripe **test** ključeve (Clerk webhook
ne stiže do `localhost` bez tunela).

- [ ] **11.1 · Brisanje otkazuje pretplatu pre brisanja profila**
  1. Nov nalog na produkciji → Starter mesečno sa `4242…` (proba).
  2. Clerk Dashboard → Production → Users → taj nalog → **Delete user**.
  3. Stripe Dashboard (test) → Customers → taj kupac → pretplata.
  4. SQL: `select * from profiles where id = '<id>';` i `admin_audit` poslednji redovi.

  **Očekivano:** pretplata `canceled` (vreme otkaza pre brisanja profila); kupac ima metapodatke
  `deleted_user`; profil ne postoji; `unlocks`, `credit_ledger`, `search_access` tog naloga
  obrisani kaskadom; `businesses` i `website_audits` netaknuti; u reviziji red sa spiskom
  otkazanih pretplata, bez podataka o kartici.

- [ ] **11.2 · Clerk webhook isporuke**
  Clerk Dashboard → Production → Webhooks → endpoint → Message logs.

  **Očekivano:** `user.created` i `user.deleted` za nalog iz 11.1 imaju status uspešno.

---

## 12. Worker i budžet

- [ ] **12.1 · Jedan Places poziv po stranici**
  Skeniraj Brzo, Standardno i Duboko (tri različite kombinacije).

  **Očekivano:** u logu workera 1, 2 i 3 API poziva; `api_budget.calls` raste za 1/2/3;
  `search_cache.pages` odgovara plaćenoj dubini.

- [ ] **12.2 · Budžet iscrpljen**
  Lokalno, samo lokalni worker (Hetzner worker privremeno na drugoj bazi ili zaustavljen):
  `GOOGLE_DAILY_LIMIT=0 pnpm worker` → pokreni skeniranje.

  **Očekivano:** u logu „odloženo do …", posao `pending` sa `run_after` sutra, ne `failed`;
  plaćeno skeniranje čeka i završava se kad se kvota vrati — bez druge naplate.

- [ ] **12.3 · Worker ubijen usred posla**
  `docker kill <id>` (ili `Ctrl+C` lokalno) dok skeniranje traje → podigni worker.

  **Očekivano:** posle ~15 min žetva vraća posao u red; posle 3 neuspeha `failed` i povraćaj.

- [ ] **12.4 · Mesečna dodela** — 1. u mesecu, na produkciji
  ```sql
  select user_id, delta, ref_id, balance_after, created_at from credit_ledger
  where reason = 'monthly_grant' and created_at > date_trunc('month', now()) order by id;
  ```

  **Očekivano:** dodela samo godišnjim pretplatama (osim u mesecu nastanka) i komp nalozima;
  mesečne pretplate i probe **nemaju** red od workera (njih puni `invoice.paid`).

---

## 13. Bezbednost

- [ ] **13.1 · Zaključana polja ne postoje u odgovoru (pravilo 9)**
  Nalog bez otključanih → `/pretraga` sa listom → DevTools → Network → odgovor `/api/search` →
  pretraži `phone`, `email`, `website_url`, `ugly_score`, `ai_issues`, `screenshot`.

  **Očekivano:** nijedan ključ ne postoji za neotključane prospekte (ne prazan — ne postoji).

- [ ] **13.2 · Webhookovi bez potpisa**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/billing/webhook -d '{}'
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/clerk -d '{}'
  ```

  **Očekivano:** 401 za Stripe, 400 za Clerk; u bazi ništa novo.

- [ ] **13.3 · Tempo zahteva**
  U konzoli pregledača prijavljenog naloga:
  ```js
  Promise.all(Array.from({length:110},()=>fetch("/api/unlock",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(r=>r.status))).then(s=>console.log(s.filter(x=>x===429).length))
  ```

  **Očekivano:** broj 429 odgovora je veći od nule; posle minut rute ponovo rade; nijedan kredit
  nije skinut (telo je neispravno).

- [ ] **13.4 · Bezbednosna zaglavlja**
  ```bash
  curl -sI https://app.sajtoskop.com | grep -iE "content-security-policy|strict-transport-security|x-frame-options|referrer-policy"
  ```

  **Očekivano:** sva četiri zaglavlja postoje; CSP ne pominje `paddle`.

- [ ] **13.5 · Otvorena redirekcija**
  `http://localhost:3000/?nalog=nov&nazad=https://evil.example` → registracija/prijava.

  **Očekivano:** posle prijave ostaješ u aplikaciji, ne ideš na spoljni domen.

- [ ] **13.6 · Cenovnik prima samo poznatu nameru**
  `/cenovnik?plan=Pro`, `?plan=enterprise`, `?ciklus=annual`, `?paket=999`,
  `?plan=<script>alert(1)</script>`.

  **Očekivano:** običan cenovnik, bez greške, ništa se ne izvršava; `?plan=pro&ciklus=godisnje`
  preselektuje Pro godišnje („Tvoj izbor"); `?paket=200` skroluje do Dopune 200.

---

## 14. Vizuelni prolaz

Svaki ekran u **četiri** prikaza: tamna 1280 px · svetla 1280 px · tamna 390 px · svetla 390 px
(DevTools → Toggle device toolbar → 390 × 844).

**Pravila koja se proveravaju na svakom ekranu**
- nijedan tekst ne izlazi iz ekrana, nema vodoravnog skrola strane na 390 px
- tačno **jedno** primarno (zeleno) dugme po ekranu
- brojevi, datumi, ID-jevi, URL-ovi i telefoni se ne „trzaju" po širini (`.num`)
- zelena kao tekst je čitljiva u svetloj temi; žuta upozorenja čitljiva na beloj podlozi
- nigde „beta", „trial", „lead", „feedback", „anketa" u vidljivom tekstu; nigde emodži

- [ ] **14.1 · Javne strane:** `/` (prijava i registracija, link „Nazad na početnu") ·
  `/cenovnik` (gost, prijavljen, pozivnica, godišnje, paketi zaključani i otključani) ·
  `/welcome` (proba, plan aktivan, paket) · `/zakljucano` (istekao, nalog čeka plan) ·
  `/pozivnica/[kod]` (gost, prijavljen, opozvana, nepostojeća) · `/uslovi` · `/privatnost` ·
  `/povracaj` · futer (nema ga u aplikaciji, ima ga na javnim stranama; logo i „Početna" vode na
  landing).
- [ ] **14.2 · Onboarding:** `/pocetak` sva četiri ekrana · traka „Prvih pet minuta" (raširena i
  skupljena) · četiri vođene tačke · vodič.
- [ ] **14.3 · Aplikacija:** `/pretraga` (prazno, lista, kartica u pet stanja, modal skeniranja,
  stanja A–F, samo-čitanje, „Tvoji pristupi") · `/lista` · `/pipeline` sa panelom poruka ·
  `/krediti` (proba, aktivan, otkazan, `past_due`, komp, dopuna) · `/dashboard` · `/utisci` ·
  baneri (grace žut, otkazan plav, nemaš plan) · modali.
- [ ] **14.4 · Admin:** `/admin` · `/admin/korisnici` i detalj · `/admin/pozivnice` ·
  `/admin/utisci` sa panelom · `/admin/dnevnik` · `/admin/revizija`.
- [ ] **14.5 · Stripe strane:** Checkout i Customer Portal — logo, ime „Sajtoskop", akcentna boja.
- [ ] **14.6 · Tastatura i čitač ekrana:** prekidač teme (Tab ulazi, strelice menjaju) · combobox
  najavljuje izabranu opciju · crvena greška se najavljuje · `Esc` zatvara vodič i modale.

**Očekivano:** svaki ekran prošao u sva četiri prikaza, ili je nalaz upisan u zapisnik.

---

## 15. Produkcija posle prelaska na live

Posle koraka 6.4 checkliste. Kupovina i povraćaj pravom karticom su u checklisti 6.5.

- [ ] **15.1 · Webhook isporuke** — Stripe (live) → Developers → Webhooks → endpoint: sve
  isporuke `200`, nijedna na čekanju.
- [ ] **15.2 · Cron** — Vercel → Settings → Cron Jobs → poslednje izvršenje `utisci-digest` bez
  greške (sutradan posle deploya).
- [ ] **15.3 · Worker** — `docker compose -f apps/worker/docker-compose.yml logs --since 24h | grep PAO` ne
  vraća ništa neočekivano.
- [ ] **15.4 · Sentry** (ako je 2.1 urađeno) — nema novih grešaka posle deploya.
- [ ] **15.5 · Registracija na produkciji** — privatni prozor, prava adresa (ne `+clerk_test`),
  Google i mejl, do kopirane poruke; `api_budget` nepromenjen.

---

## Zapisnik

Upiši svaki pad i svaki SQL izlaz koji scenario traži. Kad se nalaz popravi, dopiši commit.

| Datum | Scenario | Ishod | Nalaz / izlaz | Popravljeno u |
|---|---|---|---|---|
| | | | | |
