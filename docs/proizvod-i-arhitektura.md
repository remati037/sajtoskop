# Proizvod i arhitektura

Kontekst koji se čita pre svakog rada na projektu. Nema zadataka — samo šta proizvod jeste,
kako je sklopljen i koje su odluke donete. Stanje na **16. septembar 2026**, migracija `0034`.

Kad se nešto ovde promeni, menja se u istom commitu kao i kod.

---

## 1. Šta je proizvod

Web aplikacija koja pretražuje Google Maps po **gradu i niši** u Srbiji, automatski analizira
sajtove tih firmi i vraća listu poređanu po tome **koliko im je sajt loš** — sa kontaktom,
snimkom ekrana, konkretnom listom problema i pripremljenom porukom za prvi kontakt.

**Korisnik:** frilens web developer, dizajner, SEO ili marketing agencija u Srbiji koja radi
hladan outreach i gubi sate na ručno traženje prospekata.

**Posao koji korisnik unajmljuje alat da uradi:** *„Daj mi 30 firmi u mom gradu kojima sajt
ne radi na telefonu, sa telefonom i mejlom, i reci mi šta da im napišem."*

**Pozicioniranje:** nije scraper, nego **baza domaćih firmi kojima treba sajt**. Scraper je
alat koji korisnik pokreće; baza je imovina koju korisnik pretražuje. Istorija audita je
prednost koju konkurent koji krene sutra nema.

### Zašto baš Srbija

Stvarni podaci iz skeniranja, jul–avgust 2026:

| Niša / grad | Bez funkcionalnog sajta |
|---|---|
| PVC stolarija / Šabac | 58% |
| Advokat / Kragujevac | 57% |
| Autoplac / Čačak | 48% |
| Prosek Novi Sad | 25% |
| Prosek Niš | 20% |

Zapadni alati traže „ružan sajt". Ovde je najbolji prospekt **firma koja sajt uopšte nema** ili
kojoj je domen mrtav — kategorija koju ti alati ne prikazuju. Uz to: tip telefona iz prefiksa
(mobilni → Viber, fiksni → poziv), ćirilica u Places odgovorima (transliteracija), poruke na
srpskom po kanalima.

---

## 2. Dva domena

```
www.sajtoskop.com      landing — prodajna strana, VAN ovog repozitorijuma
app.sajtoskop.com      aplikacija — apps/web iz ovog repoa
```

- Landing se ne pravi i ne menja odavde. Aplikacija na njega pokazuje kroz
  `NEXT_PUBLIC_LANDING_URL` (kanonski oblik sa `www` — goli domen odgovara `308`).
- Landing na aplikaciju pokazuje **slugom plana**, nikad Stripe ID-jem:
  `app.sajtoskop.com/cenovnik?plan=pro&ciklus=godisnje`, `?paket=75|200`, `#paketi`.
  Aplikacija sama preslikava slug u cenu (`lookup_key`), pa prelazak test → live ne traži
  izmenu na landingu.
- **Pravne strane žive u aplikaciji** (`/uslovi`, `/privatnost`, `/povracaj`), jer se menjaju
  zajedno sa kodom (grace period, dve kase kredita, put brisanja naloga). Landing ih linkuje.
- **Kupovina se dešava samo u aplikaciji** — checkout pravi server iz Clerk sesije, gost nema
  `user_id` za koji bi se kupovina vezala. Gost ide kroz registraciju i vraća se na isti izbor
  (`/?nalog=nov&nazad=…`, zaštićeno od otvorene redirekcije).
- `/` u aplikaciji je ekran za prijavu i registraciju; `/prijava` i `/registracija` su
  redirekcije na njega.

Detaljan spisak svih CTA-ova sa landinga: `docs/tok-i-onboarding.md` §3.

---

## 3. Arhitektura

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  apps/web  · Vercel     │         │  apps/worker · Hetzner   │
│  Next.js App Router     │         │  Node + tsx + Playwright │
│  Clerk auth             │         │  Docker, bez otvorenih   │
│  Stripe (server)        │         │  portova                 │
└───────────┬─────────────┘         └────────────┬─────────────┘
            │ upiši posao                        │ povuci posao
            │ pročitaj rezultat                  │ upiši rezultat
            ▼                                    ▼
        ┌────────────────────────────────────────────┐
        │  Supabase Postgres + Storage (Frankfurt)   │
        │  job_queue · businesses · website_audits   │
        │  profiles · credit_ledger · subscriptions  │
        └────────────────────────────────────────────┘
                            ▲
                            │ Places / PageSpeed / Anthropic
                            └── isključivo iz workera
```

```
apps/web        Next.js 15 · TypeScript · Tailwind · shadcn/ui · Clerk · Stripe · Vercel
apps/worker     Node 24 · tsx · Playwright · Hetzner CX22 · Docker
apps/cli        Node 24 · tsx · commander — ručna skeniranja i seed, ostaje živ
packages/shared ugly-score · taxonomy · translit · csv · plans · pristup · onboarding · tipovi
```

### Zašto Postgres red umesto Redis + BullMQ

Worker nema nijedan otvoren port. Vercel ga ne doziva — worker sam vuče posao iz `job_queue`
preko `FOR UPDATE SKIP LOCKED`. To uklanja Redis, Caddy, TLS na workeru i ceo dolazni napadni
vektor, po cenu ~80 linija koda za retry i backoff. Na obimu od desetina poslova dnevno Redis
ne rešava nijedan stvaran problem; ingest sloj je jedini deo koji bi se menjao.

### Ključni tok

```
korisnik bira grad + nišu + dubinu (Brzo / Standardno / Duboko)
        │
        ├─ već plaćen pristup toj listi (search_access, 30 dana) → odmah, bez naplate
        │
        ├─ lista je u kešu i svež Google podatak → spend_credit_and_scan (ishod `cached`)
        │     naplata min(stranica, ceil(firmi/20)) kredita, lista odmah, 0 Places poziva
        │
        └─ nema u kešu / plići keš / star podatak → spend_credit_and_scan (ishod `charged`)
              → posao `scan` u red → worker: Places (1 poziv po stranici) → upsert businesses
              → `enrich_basic` po firmi: fetch sajta + Ugly Score → website_audits
              → manje stranica nego plaćeno → refund_scan vraća razliku
              → lista nije upisana → fail_scan_and_refund vraća sve, u jednoj transakciji

korisnik klikne „Otključaj"
        └─ spend_credit_and_unlock (FOR UPDATE) → posao `enrich_full`:
           snimci desktop + mobilni, PageSpeed, Claude analiza → kartica se sama osveži
```

---

## 4. Naplata i krediti

**Stripe** (hosted Checkout + Customer Portal), prodavac **Remati LLC**, EUR, Stripe Tax
isključen. Tehnički spec, webhook događaji i plan testova: `docs/naplata-stripe.md`.
Nijedan Stripe ID (`prod_`, `price_`, `cus_`, kupon) ne ulazi u kod — samo `lookup_key` iz
`packages/shared/src/plans.ts`, koji je **jedini izvor cena i kredita**.

### Planovi i paketi

| | Mesečno | Godišnje | Krediti mesečno | Skeniranja dnevno (osigurač) | CSV redova dnevno | „Napiši drugačije" dnevno |
|---|---|---|---|---|---|---|
| **Starter** | €29 | €290 | 150 | 30 | 500 | 5 |
| **Pro** | €59 | €590 | 450 | 60 | 2.000 | 20 |
| **Advanced** | €119 | €1.190 | 1.200 | 120 | 10.000 | 60 |
| **Komp** | — | — | 300 | 120 | 10.000 | 60 |
| **Dopuna** (stanje, ne plan) | — | — | 0 | 30 | 500 | 5 |

- **Paketi:** Dopuna 75 = €19, Dopuna 200 = €49. Jednokratno, krediti **ne ističu**. Kupuje
  se samo uz stanje `aktivan`, `otkazan`, `komp` ili `proba` (`smeDaKupiPaket()`; checkout
  ruta vraća `403` ostalima).
- **Proba:** 7 dana, 10 kredita, kartica unapred (`payment_method_collection: always`), prva
  naplata osmog dana; jednom po nalogu i po otisku kartice. „Aktiviraj odmah" završava probu
  i naplaćuje danas.
- **Nov nalog bez kartice:** 2 kredita dobrodošlice u `credits_topup` (`ONBOARDING_CREDITS`,
  razlog `onboarding`) — jedan za prvu listu, jedan za prvi prospekt. Nalog je `dopuna`.
- **Komp:** pun pristup bez Stripe-a, otvara ga samo admin (`admin_open_komp`) ili komp
  pozivnica (`redeem_invite`). Rok u `komp_expires_at`, `NULL` = bez roka.
- **Pozivnica „prvi mesec gratis":** normalan checkout sa kuponom 100 % `once`, samo uz
  mesečni ciklus; kartica obavezna, bez probe; prvi period dobija pune kredite plana.
- **Admin** (`profiles.role = 'admin'`) ne troši kredite i ne piše knjigu (0029); dnevni
  osigurač i Places budžet važe i za njega.

### Cena u kreditima

| Akcija | Kredita | Stvaran trošak |
|---|---|---|
| Skeniranje Brzo / Standardno / Duboko (do 20 / 40 / 60 firmi) | 1 / 2 / 3 — **i iz keša** | €0,032 po stranici (Places), €0 iz keša |
| Otključavanje prospekta | 1 | ≈ €0,024 (Claude vision, PageSpeed, snimci) |
| „Napiši drugačije" | 0, dnevni limit po planu | ≈ €0,0045 |

**1 kredit = 1 Places poziv** kad keša nema, pa novčanik sam ograničava trošak. Pristup
plaćenoj listi važi 30 dana (ili kraće, ako Google podatak ranije ističe) i sve unutar njega —
paginacija, filteri, ponovno otvaranje — je besplatno. Manje stranica od plaćenog → razlika
se vraća automatski.

### Dve kase kredita

| Kolona | Šta drži | Ponašanje |
|---|---|---|
| `credits_balance` | pretplata, proba, komp | mesečna dodela ga **postavlja** (bez rollovera) |
| `credits_topup` | paketi, krediti dobrodošlice | **ne ističe**, mesečna dodela ga ne dira |

Troši se prvo `credits_balance`, pa `credits_topup`. Prikazuje se zbir; odvojeno na `/krediti`
i u konzoli.

**Ko puni kredite:** mesečne pretplate — `invoice.paid` (`apply_invoice_paid`, ref `in_…`);
godišnje pretplate i komp — worker `monthly_grant` prvog u mesecu (beogradski kalendar);
proba — `apply_trial_start`; paket — `apply_credit_pack` (ref `pi_…`). Vraćen novac —
`apply_refund` skida tačno ono što je ta naplata upisala (ref `povracaj:<re_…>` /
`spor:<dp_…>`). Sva pravila o tome ko sme da menja kredite: `CLAUDE.md`, pravilo 3.

### Places budžet

SKU je **Text Search Enterprise** ($35 / 1.000 poziva, **1.000** besplatnih mesečno — ne
10.000, to je Essentials red), jer `FIELD_MASK` traži telefon i sajt.

```
GLOBAL_MONTHLY_API_CAP = 1.000 + PLACES_MONTHLY_BUDGET_EUR / 0,032
GLOBAL_DAILY_API_CAP   = mesečni / 20
€60 → 2.875 / 143     €100 → 4.125 / 206     €150 → 5.687 / 284
```

`PLACES_MONTHLY_BUDGET_EUR` se čita iz env-a i mora biti **isti na Vercelu i na workeru**.
Budžet raste sa brojem pretplatnika (nedeljna rutina u checklisti) — odbijeno skeniranje
plaćenom korisniku skuplje je od svakog Places računa.

---

## 5. Životni ciklus pristupa

Jedna funkcija, `stanjePristupa()` u `packages/shared/src/pristup.ts`, odlučuje za kapije,
rute, banere i modal. Sedam stanja, drugog nema:

| Stanje | Kada | Šta sme |
|---|---|---|
| `komp` | `plan = komp`, rok u budućnosti ili bez roka; i admin | sve |
| `proba` | pretplata `trialing` | sve; baner „Proba do…", „Aktiviraj odmah" |
| `aktivan` | pretplata `active` (i `past_due` dok period traje) | sve |
| `otkazan` | otkaz zakazan (`cancel_at`) ili `canceled`, period još traje | sve; plava traka „traje do…" |
| `dopuna` | nema plaćenog roka, `credits_topup > 0` | sve, sa Starter dnevnim limitima |
| `grace` | 30 dana posle kasnijeg od: plaćenog roka i registracije | **samo čitanje**: plaćene liste, prospekti, pipeline, poruke, oba izvoza |
| `zakljucan` | posle grace-a | ništa; `/zakljucano` sa izlazom na cenovnik |

- Pun pristup traje do `max(komp_expires_at, plan_expires_at)`. Datumi se ne skladište dvaput.
- Grace ima tri uzroka i tri teksta: pala naplata, istekao pristup, potrošeni besplatni krediti.
- Posle poslednjeg kredita plaćeno ostaje otvoreno — lista, otključani prospekti i poruke se ne
  sklanjaju iza katanca.
- Kapija stoji uz podatak na svakoj strani i u svakoj ruti, ne samo u layout-u.

---

## 6. Onboarding i kartica prospekta

Spec sa doslovnim tekstovima: `docs/tok-i-onboarding.md` (§4 onboarding, §5 utisci, §7 kartica).

- **Čarobnjak `/pocetak`:** grad → niša → kanal → „Prva lista". Nudi **samo sveže kombinacije
  iz keša**, pa onboarding ne pravi nijedan Places poziv. Odgovori se pamte na profilu.
- **Vođen prvi prolaz:** četiri tačke uz element (bedž „Nema sajt", „Otključaj", tabovi poruke,
  „Kontaktiran"), traka „Prvih pet minuta" sa stanjem **u bazi** (`onboarding_steps`), vodič
  samo na zahtev — nijedna tura se ne pokreće sama.
- **Kartica prospekta** zamenjuje red tabele na `/pretraga` i `/lista`: pet stanja (zaključana,
  u toku, greška, nema sajt, otključana), poruka po kanalu direktno na kartici.
- **Mera uspeha:** koliko novih naloga stigne do prve kopirane poruke i koliko se vrati drugog dana.

---

## 7. Model podataka

Puna šema je u `supabase/migrations/`. RLS je uključen na **svakoj** tabeli.

| Tabela | Uloga | Čitanje |
|---|---|---|
| `profiles` | nalog: plan, uloga, obe kase, rokovi, Stripe kupac, onboarding, dnevni brojači | svoj red |
| `businesses` | Google podaci, TTL 30 dana (`place_id` trajno) | `using (false)` — samo kroz API |
| `website_audits` | naša imovina: skor, signali, snimci, PageSpeed, AI analiza | `using (false)` — samo kroz API |
| `unlocks` | PK `(user_id, place_id)` — isti prospekt se ne plaća dvaput | svoje |
| `credit_ledger` | jedini izvor istine za kredite; `balance_after`, `details` | svoje |
| `search_cache` | koje su kombinacije skenirane, kada i koliko duboko | kroz API |
| `search_access` | plaćen pristup listi (korisnik, grad, niša, stranice, rok) | svoje |
| `searches` | istorija pretraga | svoje |
| `job_queue`, `job_subscribers` | red poslova i ko čeka rezultat | kroz API |
| `api_budget` | dnevni i mesečni brojač Places poziva (dan po `America/Los_Angeles`) | kroz API |
| `subscriptions` | ogledalo Stripe pretplate (status, plan, ciklus, rokovi, `cancel_at`) | kroz API |
| `billing_events` | deduplikacija Stripe događaja po `evt_…` | kroz API |
| `trial_fingerprints` | otisci kartica koje su već imale probu | kroz API |
| `access_invites`, `access_invite_redemptions` | pozivnice komp / prvi mesec i ko ih je iskoristio | kroz API |
| `lead_status`, `outreach_messages`, `signed_events` | pipeline, poslate poruke, potpisani poslovi | svoje |
| `feedback`, `feedback_prompts`, `changelog` | utisci, pitanja, „Novo u Sajtoskopu" | svoje / kroz API |
| `admin_audit` | revizija svake admin radnje i novčanih događaja bez aktera | kroz API |
| `request_limits`, `webhook_events` | tempo zahteva, deduplikacija Clerk webhooka | kroz API |

**Vlasništvo nad podacima je pravno bitno:** `businesses` su Google podaci sa rokom od 30 dana.
`website_audits` je ono što je proizvod sam napravio — i to se čuva neograničeno. Brisanje
naloga (Clerk → `user.deleted` → otkaz Stripe pretplate → kaskada) ne dira ni jedno ni drugo.

---

## 8. Ugly Score

Živi **samo** u `packages/shared/src/ugly-score.ts` — jedan izvor za web, worker i CLI.

- **Sloj 0 — status sajta:** `NEMA SAJT`, `SAMO DRUŠTVENE`, `MRTAV`. Najbolji prospekti, bez
  numeričkog skora.
- **Sloj 1 — HTML heuristika** (bez API poziva): `viewport`, HTTPS, stara copyright godina,
  zastareli tagovi, jQuery 1.x, platforma.
- **Sloj 2 — PageSpeed** mobilni skor, na otključavanju.
- **Sloj 3 — Claude vision:** 3–5 konkretnih problema na srpskom, na otključavanju.

Bendovi: **Solidan / Osrednji / Ružan / Katastrofa**. Težine signala nikad ne idu u klijentski
bundle (CI to proverava).

---

## 9. Kako smo stigli dovde

| Period | Šta | Detalji |
|---|---|---|
| F0–F9 | monorepo, baza i auth, pretraga, worker, krediti, snimci, PageSpeed i AI, poruke i kanban, cena skeniranja | `docs/dnevnik-isporuka.md` |
| S1–S7 | utisci (F11) i admin konzola (F12) | isto |
| S8–S15 | revizija koda: novac, bezbednost, ispravnost, performanse, UX, dizajn, baza, testovi | isto |
| S16–S24 | novčanik i dve kase, dubina skeniranja, životni ciklus, pravne strane, `app.` poddomen | isto |
| S25–S30 | Stripe umesto Paddle-a, plaćen pristup kešu, proba, pozivnice, onboarding, kartica, NPS | isto |
| posle S30 | admin bez kredita, povraćaji po knjizi, `cancel_at`, automatski povraćaj skeniranja (`0029`–`0034`) | isto |

Šta je ostalo do lansiranja: `docs/lansiranje-checklista.md`.

---

## 10. Šta nije u opsegu do stabilne naplate

- Region HR/BA/ME/MK — ali `country_code` postoji u šemi od prvog dana
- Radar i obaveštenja o novim firmama, mejl kampanje
- PDF izveštaj o auditu za vlasnika firme
- Timovi i više korisnika po nalogu
- Mobilna aplikacija
- Domaća naplata (IPS QR, račun za firme sa PIB-om)
