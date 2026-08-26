# Roadmap — razvoj posle revizije

> Redosled isporuka van tekućih popravki (`docs/PLAN-IZMENA.md`). Faze prate
> filozofiju projekta: jedan PRD po sesiji, svaka faza ostavlja proizvod u
> ispravnom stanju, i ništa se ne radi „usput".
>
> Reference: `docs/00-kontekst.md` (model lansiranja), `docs/SESIJE.md`
> (redosled isporuka), `docs/F8-landing.md`, `docs/naplata-bez-firme.md`.

---

## 0. Gde smo sada

Završene faze: F0–F9, F10, F11.1–F11.4 (F11 ceo), F12.1–F12.3 (F12 ceo).
Neradjeno iz originalnog opsega: **F8** (landing, pravni, beta).

> **Dopuna 27. avgusta 2026.** F8 se raspao: **landing je napravljen van ovog repozitorijuma**
> na `sajtoskop.com` (aplikacija je na `app.sajtoskop.com`), **pravni tekstovi i futer su
> isporučeni u S22**, a **onboarding je zasebna faza** od dve sesije — S27 i S28. Ostaju
> kanarinci i merenje (S25). Operativni plan je `docs/LANSIRANJE.md`, ne ovaj fajl.

Tekuće: popravke iz `docs/REVIZIJA.md` po `docs/PLAN-IZMENA.md`.

---

## Faza A — S7: F11.4 — zatvaranje petlje utisaka ☑ isporučeno

**PRD:** `docs/F11-utisci-v2.md` §6.4, §6.5, §7, §9, §10 · **Prompt:** „S7" u `docs/SESIJE.md`.

Isporučeno u celosti (v. „S7" u `docs/SESIJE.md`):

- `/utisci` — „Moje prijave": statusi, obrazloženje (`user_note`), `seen_at` +
  nuliranje brojača pri otvaranju
- Tačka sa brojačem na plutajućem dugmetu (nepročitane rešene prijave)
- Mejl „rešeno je ono što si prijavio" iz dnevne cron rute (max 1/dan po
  korisniku, jedan mejl za više prijava, 3 pokušaja)
- Beta dnevnik: sekcija na `/dashboard` + `/admin/dnevnik` CRUD
- Provera teze u nedeljnom izveštaju (kohorte „video rešeno" vs „nije")

**F11 i F12 su kompletno zatvoreni; `docs/SESIJE.md` ažuriran.**

---

## Faza B — F8: Landing, pravni tekstovi i otvaranje bete

**PRD:** `docs/F8-landing.md` — ceo.

Ovo je **jedina faza koja dovodi korisnike**, i po `00-kontekst §2` odlučuje o
tome da li proizvod uopšte ima smisla. Ne preskakati.

1. ~~**Landing** na `sajtoskop.com`~~ — **urađeno 27.8., van repoa.** Domeni su razdvojeni
   tačno kako je ovde i predviđeno: landing na golom domenu, aplikacija na `app.` poddomenu,
   a koren aplikacije ostaje prijava (`LANSIRANJE.md` §1.7)
2. **Pravni tekstovi** — Uslovi korišćenja + Politika privatnosti (ZZPL),
   linkovani iz futera i iz registracije; copyright notice
3. **Kanarinci** — 5–10 lažnih biznisa sa fingerprintima (§4 PRD-a)
4. **Merenje** — 5 SQL upita aktivacije iz §5 (registracije, aktivacija,
   unlock, povratak drugi dan, prosečne pretrage)
5. **Onboarding** — prvih 90 sekundi iz §2 (nadovezuje se na 4.7 iz
   `docs/PLAN-IZMENA.md`)
6. **Otvaranje bete** — 5 ljudi lično, pa 20; od svakog pitanje o ceni

**Gotovo kad:** čovek koji te ne poznaje registruje se i napravi pretragu bez
pitanja; pravni tekstovi objavljeni; kanarinci u bazi; 5 metrika čitljive
jednim upitom; prvih 5 beta korisnika unutra.

---

## Faza C — Odluka o naplati (30 dana posle otvaranja bete)

**Kriterijum** (`00-kontekst §2`): broj korisnika koji su se vratili drugi put +
medijana odgovora na pitanje o ceni. Ispod 1.500 RSD medijane → alat je
interni alat za Remati (legitiman ishod).

**Ako je „naplaćuj":** `docs/naplata-bez-firme.md` — IPS QR za domaće,
Lemon Squeezy za strane; `BillingProvider` iz F4 dobija pravu implementaciju.
Prati `docs/mvp-plan.md` ako treba MVP varijanta.

**Priprema koja se može raditi i pre odluke (nezavisno od naplate):**
- `PLANS` sa više planova (starter/pro/agency) — čisti podatak, bez UI-ja
- Testovi novčanih RPC-ova (Faza 7 iz `PLAN-IZMENA.md`)
- Anomaly detekcija (300 unlocka/sat) i deljenje naloga → ponuda upgrade-a

**Gotovo kad:** korisnik plaća kartično ili IPS-om; krediti se dodeljuju po
planu; `credit_ledger` i dalje jedini izvor istine.

---

## Faza D — Region (HR/BA/ME/MK)

`country_code` postoji svuda od 0001 — migracija nije potrebna. Posao:

- Taksonomija: gradovi i niše po zemlji; `resolveCity`/`resolveNiche` po zemlji
- Places: `regionCode` po zemlji, `languageCode` (`hr`, `sr-Latn`, `sl`?)
- Translit: HR/BA latinica je već latinica; ćirilica u BA/MK
- Skoring: isti Ugly Score; srpski AI prompt → per-jezički
- Keš: `search_cache` već ima `country_code`; lista keša po zemlji
- UI: jezik po zemlji korisnika? (Clerk localization postoji)

**Gotovo kad:** izbor zemlje na pretrazi; keš i naplata po zemlji; bez ijedne
nove tabele.

---

## Faza E — Produkt posle bete (po vrednosti, ne po redu)

### E1. Feedback loop na konverziju — najvažniji moat
„Potpisan" u kanbanu je jedini podatak koji raste s vremenom i koji konkurent
ne može da kupi (`bezbednost-i-zastita.md`, Sloj 3). Ugraditi ga u skoring:
- agregatna statistika „koji tip leada konvertuje" (po niši, gradu, bandu,
  statusu sajta, kanalu prve poruke)
- nedeljni izveštaj sa konverzijom po segmentu
- (kasnije) skor „verovatnoća potpisa" pored Ugly Score-a

### E2. Radar i notifikacije
- pretplate na (grad, niša): mejl kad se pojavi novi biznis bez sajta
- dnevni/sedmični sažetak novih prospekata

### E3. PDF izveštaj o auditu
Jedna komanda „napravi PDF za vlasnika" — prodajni alat za korisnika; najbliža
stvar automatskom lead-u. Ne pre naplate.

### E4. Timovi
Više korisnika po nalogu, deljeni pipeline, uloge. Posle stabilne naplate.

### E5. Mobilna aplikacija
Ne pre 100 korisnika. Web je već upotrebljiv na telefonu; prvo popraviti
kanban touch (Faza 4 u `PLAN-IZMENA.md`).

### E6. Napredni skoring
- istorija audita po domenu („sajt nije diran od januara") — moat iz
  `00-kontekst §7`
- fingerprinti domaćih agencija u AI analizi
- APR enrichment (naziv firme, delatnost) kad bude legalno čisto

---

## Faza F — Tehnički dug i skaliranje (kad brojke porastu)

- **Pretraga u SQL-u** (3.4 iz `PLAN-IZMENA.md`) — pre nego što baza pređe
  ~50k biznisa
- **Redis/BullMQ** — samo ako red postane usko grlo; ingest sloj je jedini deo
  koji se menja (`00-kontekst §3`)
- **Materijalizovani pogledi / denormalizacija** za liste i admin agregacije
- **Sentry** (P2) — pre prvih 100 korisnika, sa scrubovanjem PII
- **2FA za admin** (Clerk)
- **Penetration test** na ~500 korisnika
- **Pro plan na Vercelu** — treći cron (čišćenje slika) dobija raspored, ništa
  u kodu se ne menja

---

## Faza G — Stalni procesi (ne faze, nego navika)

- **Posle svake isporuke:** `docs/SESIJE.md` se ažurira (pravilo projekta)
- **Nedeljno:** pogledaj `admin_overview` — budžet, poslovi na čekanju, medijana
  cene; `npm audit` izveštaj
- **Mesečno:** `pg_dump` provera (obnova iz backup-a jednom), rotacija tajni po
  potrebi
- **Po rastu:** prati `api_budget` tempo (`dailyPace`) — ako mesečni cap
  priđe, prvo se smanjuje `SCAN_MAX_QUERIES`/deep, pa se razmišlja o naplati

---

## Pregled faza

| Faza | Sadržaj | Zavisnost | Krajnji ishod |
|---|---|---|---|
| A | F11.4 — zatvaranje petlje utisaka | — (tekuća) | F11/F12 kompletni |
| B | F8 — landing, pravni, beta | A | prvi korisnici |
| C | Odluka o naplati | B + 30 dana bete | proizvod se održava ili je interni |
| D | Region HR/BA/ME/MK | C (ili paralelno) | širi tržište |
| E | Feedback loop, radar, PDF, timovi, mobilno | C | moat i zadržavanje |
| F | Tehnički dug i skaliranje | po brojkama | sistem ostaje brz |
| G | Stalni procesi | uvek | higijena bez zaborava |
