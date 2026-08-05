# 00 — Kontekst: proizvod i arhitektura

Ovaj dokument čitaš pre svakog faznog PRD-a. On ne sadrži zadatke, samo kontekst i odluke.

---

## 1. Šta je proizvod

Web aplikacija koja pretražuje Google Maps po **gradu i niši** u Srbiji, automatski analizira
sajtove tih biznisa i vraća listu poređanu po tome **koliko im je sajt loš** — sa kontaktom,
screenshotom, konkretnom listom problema i pripremljenom outreach porukom.

**Korisnik:** frilens web developer, dizajner, SEO ili marketing agencija u Srbiji koja radi
cold outreach i gubi sate na ručno traženje prospekata.

**Job to be done:** *„Daj mi 30 firmi u mom gradu kojima sajt ne radi na telefonu, sa telefonom
i mejlom, i reci mi šta da im napišem."*

**Pozicioniranje:** nije scraper, nego **baza domaćih biznisa kojima treba sajt**. Scraper je alat
koji korisnik pokreće; baza je imovina koju korisnik pretražuje. Baza je i moat — konkurent koji
krene sutra nema istoriju audita.

### Zašto ovo radi baš u Srbiji

Stvarni podaci iz postojećih scanova, jul–avgust 2026:

| Niša / grad | Bez funkcionalnog sajta |
|---|---|
| PVC stolarija / Šabac | 58% |
| Advokat / Kragujevac | 57% |
| Autoplac / Čačak | 48% |
| Prosek Novi Sad | 25% |
| Prosek Niš | 20% |

Zapadni alati traže „ružan sajt". Ovde je najbolji lead **firma koja sajt uopšte nema** ili
kojoj je domen mrtav — kategorija koju ti alati ne prikazuju. To je diferencijator, ne detalj.

Dodatne domaće specifičnosti koje ulaze u proizvod: tip telefona iz prefiksa (mobilni → Viber,
fiksni → poziv), ćirilica u Places odgovorima (transliteracija je obavezna), detekcija domaćih
agencija koje su pravile sajtove, poruke na srpskom po kanalima.

---

## 2. Model lansiranja

**Besplatna beta.** Korisnik ne plaća ništa u prvoj fazi. Ali:

- Krediti postoje od prvog dana, samo se dele besplatno
- Beta plan: **30 kredita mesečno**, bez rollovera, **10 cache-miss pretraga dnevno**
- Cela kreditna mašinerija (`credit_ledger`, `unlocks`, `spend_credit_and_unlock`) piše se kao
  da se naplaćuje — jer se posle bete naplaćuje
- Korisniku se eksplicitno kaže: besplatno **do kraja bete**, ne zauvek

**Zašto:** jedan unlock me realno košta PageSpeed poziv + dva Playwright screenshota + Claude
vision poziv, plus Places poziv za cache-miss. Bez limita 20 korisnika × 100 unlockova je trošak
bez ijednog dinara prihoda.

**Metrika koja odlučuje o naplati** posle 30 dana bete: koliko se korisnika **vratilo drugi put**
(ne koliko se registrovalo), i medijana odgovora na pitanje *„koliko bi mesečno platio za ovo"*.
Ispod 1.500 RSD medijane → alat je interni alat za Remati i to je legitiman ishod.

---

## 3. Arhitektura

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  apps/web  · Vercel     │         │  apps/worker · Hetzner   │
│  Next.js App Router     │         │  Node + tsx + Playwright │
│  Clerk auth             │         │  Docker, bez otvorenih   │
│  čita iz baze           │         │  portova                 │
└───────────┬─────────────┘         └────────────┬─────────────┘
            │ upiši job                          │ povuci job
            │ pročitaj rezultat                  │ upiši rezultat
            ▼                                    ▼
        ┌────────────────────────────────────────────┐
        │  Supabase Postgres + Storage               │
        │  businesses · website_audits · job_queue   │
        │  profiles · unlocks · credit_ledger        │
        └────────────────────────────────────────────┘
                            ▲
                            │ Places / PageSpeed / Anthropic
                            └── isključivo iz workera
```

### Zašto Postgres red umesto Redis + BullMQ

Worker nema nijedan otvoren port. Vercel ga ne doziva — worker sam vuče posao iz tabele
`job_queue` preko `FOR UPDATE SKIP LOCKED`. To uklanja Redis, Caddy, TLS na workeru i ceo
inbound napadni vektor, po cenu ~80 linija koda za retry i backoff.

Na obimu bete (desetine poslova dnevno) Redis ne rešava nijedan problem koji stvarno imam.
BullMQ ostaje putanja za kasnije; ingest sloj je jedini deo koji bi se menjao.

### Ključni tok podataka

```
korisnik bira grad + nišu
        │
        ├─ postoji u kešu i mlađe od 30 dana → instant, besplatno, neograničeno
        │
        └─ nema u kešu → provera dnevnog cache-miss limita
                       → job "scan" u red
                       → worker: Places → upsert businesses → job "enrich_basic" po biznisu
                       → worker: fetch-site + ugly-score → website_audits
                       → web polluje status, lista se popuni

korisnik klikne "Otključaj"
        │
        └─ spend_credit_and_unlock (FOR UPDATE)
           → job "enrich_full": screenshot desktop + mobilni, PageSpeed, Claude analiza
           → otključana polja postaju vidljiva
```

**Keš je i marketinška poenta, ne samo optimizacija.** Pretrage iz keša su instant i neograničene —
to je razlog zašto proizvod postaje bolji što ga više ljudi koristi.

---

## 4. Model podataka — pregled

Puna SQL šema je u `F1-baza-auth.md`. Ovde su samo tabele i njihova uloga.

| Tabela | Uloga | RLS |
|---|---|---|
| `profiles` | korisnik, plan, stanje kredita, dnevni brojači | vidi samo svoj red |
| `businesses` | Google podaci, TTL 30 dana, `place_id` trajno | `using (false)` |
| `website_audits` | moja intelektualna svojina: skor, signali, screenshot, AI | `using (false)` |
| `unlocks` | PK `(user_id, place_id)` | vidi samo svoje |
| `credit_ledger` | jedini izvor istine za kredite | vidi samo svoje |
| `job_queue` | red poslova, `FOR UPDATE SKIP LOCKED` | `using (false)` |
| `api_budget` | dnevni i mesečni brojač Places poziva | `using (false)` |
| `searches` | istorija pretraga, cache-miss računanje | vidi samo svoje |
| `lead_status` | kanban status po korisniku i leadu (F7) | vidi samo svoje |
| `outreach_messages` | generisane poruke (F7) | vidi samo svoje |

**Podela vlasništva nad podacima** je pravno bitna i određuje ceo dizajn:
`businesses` su Google podaci sa TTL-om 30 dana. `website_audits` je ono što sam **ja** izgenerisao —
skor, screenshot, AI analiza, iskrolan mejl — i to čuvam neograničeno. To je imovina proizvoda.

---

## 5. Ugly Score

Živi u `packages/shared/src/ugly-score.ts`, prenet iz CLI-a, **već radi u produkciji na stvarnim
podacima**. Ne prepisuje se, ne „poboljšava" usput.

Slojevi:

- **Sloj 0 — status sajta:** `NEMA SAJT`, `SAMO DRUŠTVENE`, `MRTAV` (timeout, DNS greška, 4xx/5xx). Ovo su najbolji leadovi i nemaju numerički skor.
- **Sloj 1 — HTML heuristika (bez dodatnih API poziva):** nedostatak `viewport` mete, HTTPS problemi, stara copyright godina, `marquee`, `font`/`center` tagovi, jQuery 1.x, detekcija platforme (WordPress, Joomla, Wix, Drupal, custom)
- **Sloj 2 — PageSpeed (F6):** mobilni performance skor
- **Sloj 3 — Claude vision (F6):** 3–5 konkretnih problema opisanih na srpskom

Bendovi: Solidan / Osrednji / Ružan / Katastrofa. Pragovi su definisani u postojećem modulu.

**Težine signala nikad ne idu u klijentski bundle.** Ugly Score se reklamira kao brend, ne kao tabela.

---

## 6. Faze

| Faza | Sadržaj | Rezultat |
|---|---|---|
| F0 | monorepo, preseljenje CLI koda | CLI radi iz novog repoa |
| F1 | Supabase šema, Clerk, seed postojećih scanova | ulogovan korisnik, baza puna |
| F2 | pretraga i lista iz keša | app pokazuje ono što CLI pokazuje |
| F3 | worker, red poslova, Places uživo | **proizvod postoji** |
| F4 | unlock, krediti, export | korisnik dobija kontakte |
| F5 | screenshot | vizuelni dokaz |
| F6 | PageSpeed + Claude analiza | rečenica koja se lepi u poruku |
| F7 | generator poruka + kanban | feedback loop |
| F8 | landing, beta, pravni tekstovi | korisnici ulaze |

**Posle F3 imam proizvod.** Sve od F5 nadalje je dodatak. Ako se nešto raspadne, F4 je verzija
koja se pušta.

---

## 7. Šta nije u opsegu do kraja bete

- Stripe, Lemon Squeezy, IPS QR naplata — samo `BillingProvider` interfejs, bez implementacije
- Region (HR/BA/ME/MK) — ali `country_code` postoji u šemi
- Radar, notifikacije, mejl kampanje
- PDF izveštaj o auditu
- Timovi, više korisnika po nalogu
- Mobilna aplikacija
- Testovi za sve — samo za `ugly-score` i `spend_credit_and_unlock`
