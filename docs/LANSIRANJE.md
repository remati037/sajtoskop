# Lansiranje — od današnjeg stanja do spremne aplikacije

> **Šta je ovo:** jedini dokument koji treba da bude otvoren od danas do dana lansiranja.
> Sve što je ostalo — naplata, životni ciklus naloga, pravni tekstovi, landing, beta i
> operativa — podeljeno na **sesije** (radi Claude, po jedan gotov prompt) i **ručne korake**
> (radim ja, u tuđim konzolama).
>
> **Zatečeno stanje na 21. avgust 2026:** migracije do `0021`, `PLAN-IZMENA.md` kompletan,
> F0–F7 i F9–F12 isporučeni. **F8 nije rađen. Naplata je pola gotova.**
>
> **Sve odluke su donete i sva pitanja zatvorena** (D1–D6, P1–P9 — v. §1 i §4).
> **Paddle sandbox katalog je kompletan**: 8 cena, 0 override-a, kupon aktivan.
> **S16 može da počne bez ijednog preduslova.**
>
> **Pravilo:** jedna sesija = jedan blok posla = jedan commit. Posle svake sesije se ažurira
> `docs/SESIJE.md` i štiklira red u tabeli §5.

---

## 0. Kako se čita

| Oznaka | Značenje |
|---|---|
| **§1** | Donete odluke — model naplate, planovi, krediti, životni ciklus naloga |
| **§2–4** | Stanje danas, definicija „spremno", trag odluka po pitanjima |
| **S16–S26** | Sesije. Svaka ima gotov prompt koji se kopira u prazan prozor. |
| **R1–R32** | Ručni koraci. Ja, u Paddle/Supabase/Clerk/Vercel konzoli ili u pošti. **R1, R2, R5, R5a i R6 su gotovi.** |

---

## 1. Donete odluke

### 1.1 Model naplate (D1, D3)

**Idemo odmah sa naplatom.** Svaki nov korisnik od prvog dana može da kupi plan ili paket
kredita. Nema besplatnog plana za javnost.

**Beta nalozi su ručni izuzetak.** Ja ih dodajem kroz admin konzolu, dobijaju **50 kredita**
i rok trajanja bete koji ja postavljam. Zaobilaze naplatu dok im beta traje. Beta plan
**nikad** ne nastaje sam — ni registracijom, ni kuponom, ni webhookom. Samo iz admin konzole.

**Tri plana**, svaki mesečno i godišnje: **Starter, Pro, Advanced**. Godišnje je 10 mesečnih
(2 meseca gratis). Katalog u Paddle sandboxu već postoji i tačan je.

### 1.2 Cena skeniranja po dubini (D6, prošireno)

**Ovo je odluka koja povlači sve ostale**, pa ide prva.

Skeniranje je do sada bilo jedna fiksna cena (2 kredita) bez obzira na to koliko rezultata
traži. To je bilo pogrešno na način koji se nije video dok se nije izračunao trošak:

- `MAX_PAGES = 3`, `PAGE_SIZE = 20` u `apps/worker/src/lib/places.ts`
- jedan `consume()` po stranici → **broj stranica JE broj Places poziva**
- skeniranje za 20 rezultata košta 1 poziv, za 60 rezultata 3 — **trostruka razlika u
  trošku, ista cena za korisnika**

Zato cena postaje **1 kredit po stranici**:

| Dubina | Prospekata | Stranica | Places poziva | **Kredita** | Trošak |
|---|---|---|---|---|---|
| **Brzo** | do 20 | 1 | 1 | **1** | €0,032 |
| **Standardno** | do 40 | 2 | 2 | **2** | €0,064 |
| **Duboko** | do 60 | 3 | 3 | **3** | €0,096 |

Otključavanje ostaje **1 kredit** (~€0,020 — Claude vision).

#### Zašto ovo menja ceo model

**1 kredit = 1 Places poziv.** Cena se poklapa sa troškom, pa novčanik sam po sebi
ograničava izloženost — nema više scenarija u kome korisnik potroši kredite na način koji
košta 4,8× više nego drugi način.

Posledice, redom:

- **`scansPerMonth` više nije potreban** i ispada iz modela. Kredit je ograničenje.
  To je jedna poluga manje po planu, jedan brojač manje u bazi i jedan broj manje na
  ekranu cena.
- **Najgori slučaj postaje ujednačen** preko svih planova (~11–22% umesto 30–56%).
- **„2 kredita" ostaje podrazumevani izbor**, dakle korisnik koji ništa ne dira plaća isto
  kao pre.
- Korisnik koji traži samo brz pregled niše plaća **upola manje** nego danas.

#### Šta traži u kodu (S17)

Nije samo množenje. Tri stvari koje se lako promaše:

1. **Keš mora da pamti dubinu.** `search_cache` danas zna samo `last_results_count`.
   Zahtev za „Duboko" nad kombinacijom keširanom kao „Brzo" **nije pogodak** — 20 redova
   nije 60. Bez kolone sa brojem stranica, korisnik plaća 3 kredita i dobije 20 rezultata.
2. **Ključ deduplikacije mora da uključi dubinu.** Danas je `country:city:niche`, pa bi
   dva korisnika sa različitim dubinama u istoj sekundi delila jedan posao — plitki bi
   „pobedio", a duboki bi platio 3 kredita za 20 rezultata.
3. **`spend_credit_and_scan` naplaćuje fiksno 1 kredit** (`-1` upisano u telo funkcije),
   iako **već prima `p_max_results`**. Cena mora da se izvede iz broja stranica, u istoj
   transakciji, pre upisa.

### 1.3 Planovi i limiti (D2)

#### Jedna cena za sve — RS override se uklanja

> **Šta je bio `RS` override:** Paddle `unit_price_overrides` je **drugi iznos u ISTOJ
> valuti** za kupce iz određene zemlje. Nikad nisu bili dinari — kupac iz Srbije bi platio
> **€14 u evrima**, a kupac iz Nemačke **€29 u evrima**. Isti račun, ista valuta, drugi broj.
>
> **Odakle je došao:** raniji pokušaj je bio da cena za Srbiju bude u dinarima. Paddle
> podržava 33 valute i **RSD nije među njima**, pa je override na zemlju `RS` ostao kao
> zamena za tu ideju — sniženi evro umesto dinara.

**Odluka: override se uklanja. Jedna cena, svuda.**

| Zašto | |
|---|---|
| Bila je jeftinija od sopstvene ranije odluke | `LANSIRANJE-PITANJA.md` #8 je odredio **3.400 RSD ≈ €29** za Starter. Override na €14 je bio **upola jeftiniji od plana**, i to nesvesno. |
| Margina | Najgori slučaj pada sa 30–56% na **11–22%**. |
| Katalog | Sandbox → produkcija se prepisuje **8 cena umesto 8 cena + 8 override-a**. |
| Reverzibilno | Override se dodaje kasnije **jednim poljem na ceni** u Paddle panelu — bez migracije, bez izmene koda, bez deploya. |

**Trošak odluke, pošteno:** €29 mesečno ≈ 3.400 RSD je stvaran novac srpskom frilenseru i
konverzija će verovatno biti niža nego na €14. Dve stvari to ublažavaju: **kupon za betu**
(33% → €19,43 prve godine ako uzme godišnju) i **godišnja pretplata** (€290 = €24,17
mesečno). A ako beta pokaže da €29 ne prolazi, override se vraća — sa podacima umesto sa
pretpostavkom.

#### Tabela planova

| | **Beta** | **Dopuna** | **Starter** | **Pro** | **Advanced** |
|---|---|---|---|---|---|
| Mesečno | — | — | **€29** | **€59** | **€119** |
| Godišnje | — | — | **€290** | **€590** | **€1.190** |
| **Krediti mesečno** | **50** (ručno) | 0 | **100** | **300** | **800** |
| Skeniranja dnevno *(osigurač)* | 15 | 30 | 30 | 60 | 120 |
| CSV redova dnevno | 500 | 500 | **500** | **2.000** | **10.000** |
| „Napiši drugačije" dnevno | 5 | 5 | **5** | **20** | **60** |

`Dopuna` nije plan koji se kupuje — to je stanje korisnika koji ima samo kredite iz paketa
(v. §1.5). Dobija Starter limite i nikad mesečnu dodelu.

**Cena po kreditu:** Starter €0,290 · Pro €0,197 (−32%) · Advanced €0,149 (−49%).

**Šta plan stvarno daje:** 100 kredita je do 100 prospekata, ili 50 prospekata uz 25
standardnih skeniranja, ili 100 brzih skeniranja. Korisnik bira, i svaka kombinacija košta
mene približno isto — što je i bila poenta §1.2.

#### Najgori slučaj

Svi krediti potrošeni na najskuplji mogući način (duboka skeniranja koja promašuju keš):

| Plan | Kredita | Places poziva | Trošak | % cene |
|---|---|---|---|---|
| Starter | 100 | 100 | €3,20 | **11%** |
| Pro | 300 | 300 | €9,60 | **16%** |
| Advanced | 800 | 800 | €25,60 | **22%** |

Uz Paddle naknadu (~8% mesečno, manje godišnje) bruto margina je **70–80% na sva tri plana**.
Realan slučaj je još povoljniji jer keš radi: skup (grad, niša) kombinacija u Srbiji je
konačan — reda 2.000 — pa se sa 20+ korisnika preklapaju.

**Nijedan plan nema tanak red.** To je razlika koju su napravile dve odluke iz §1.2 i §1.3
zajedno; ni jedna sama ne bi bila dovoljna.

#### Dve izmene u ponudi

**1. „AI poruke po kanalu" ispada kao Pro razlika.** Cenovnik je to obećavao, a kod daje sve
kanale svima. Umesto da se Starter osakati, razlika postaje **dnevni broj „Napiši drugačije"
varijanti** — jedini AI poziv koji korisnik ponavlja iz radoznalosti, dakle jedini koji
stvarno košta po kliku. Svi kanali ostaju svima.

**2. „CSV bez ograničenja" postaje 10.000 redova dnevno.** Beskonačno bi tražilo posebnu
granu u `claim_export`, a 10.000 redova dnevno je za jednog čoveka isto što i beskonačno —
uz zaštitu od naloga koji povlači celu bazu.

#### Globalni Places budžet

Trošak je potvrđen: `FIELD_MASK` traži `nationalPhoneNumber` i `websiteUri`, dakle SKU je
**Places API Text Search Enterprise** (`E967-44BC-B44D`) — **$35/1.000 ≈ €0,032 po pozivu,
1.000 besplatnih mesečno.**

> ‼️ **Zamka u Google tabeli:** Essentials SKU-ovi imaju **10.000** besplatnih poziva
> mesečno, Enterprise ima **1.000**. Pogrešan red daje budžet deset puta veći nego što jeste.

`GLOBAL_DAILY_API_CAP = 75` i `GLOBAL_MONTHLY_API_CAP = 900` prelaze u:

```
PLACES_EUR_PER_CALL          0,032                    ($35 / 1.000, Enterprise)
PLACES_FREE_CALLS_MONTH      1.000                    Google, isti SKU
PLACES_MONTHLY_BUDGET_EUR    60      iz env-a         odluka: max €60 mesečno

GLOBAL_MONTHLY_API_CAP  = 1.000 + 60 / 0,032  ≈ 2.800
GLOBAL_DAILY_API_CAP    = 2.800 / 20          ≈ 140
```

Deljenje sa 20, ne sa 30: dozvoljava neravnomeran mesec bez toga da jedan dan pojede sve.

**Šta €60 kupuje:** ~2.800 poziva mesečno. Pošto je **1 kredit = 1 poziv**, to je i gornja
granica kredita koji smeju otići na skeniranje — dakle **28 Starter korisnika koji SVE
kredite bace na skeniranje**, ili realno **60–100 korisnika** u normalnom režimu.

> ‼️ **Svesno povećanje broja Places poziva**, prijavljeno po pravilu iz `CLAUDE.md`.
> Očekivan račun na prvih 20 korisnika: **€3–10 mesečno**; tvrda granica €60. Preko nje se
> skeniranje zaustavlja i vraća `partial: true`, kao i danas.
>
> **Budžet mora da raste sa brojem pretplatnika.** Ulazi u nedeljnu rutinu: pogledaj
> `api_budget` tempo naspram broja aktivnih pretplata i podigni
> `PLACES_MONTHLY_BUDGET_EUR` pre nego što cap počne da odbija skeniranje **plaćenom**
> korisniku. Odbijeno skeniranje je povraćaj i loša reč — skuplje od svakog Places računa.

### 1.4 Paketi kredita (D4)

**Dva paketa, oba jednokratna, krediti ne ističu. Jedna cena, bez override-a.**

| Paket | Krediti | Cena | €/kredit | vs. Starter |
|---|---|---|---|---|
| **Dopuna 50** | 50 | **€19** | €0,380 | **+31%** |
| **Dopuna 150** | 150 | **€49** | €0,327 | **+13%** |

**Zašto su skuplji po kreditu od pretplate:** paket ne sme da kanibalizuje pretplatu. Oba su
iznad Starter cene po kreditu (€0,290), pa je pretplata uvek povoljnija za nekoga ko troši
redovno — a paket ostaje pošten izlaz za nekoga ko troši povremeno, i jedini put za beta
korisnika koji neće pretplatu.

**Zašto nema trećeg, većeg paketa:** da bi ostao iznad Startera, paket od 400 kredita bi
morao ~€120 — više od Advanced plana (€119) koji daje 800 kredita. Veliki paket je
matematički besmislen. **Dva je tačan broj.**

#### Dve kase kredita — obavezna posledica

`grant_monthly_credits` (migracija 0004) **postavlja** balans na ciljnu vrednost, ne dodaje —
tako je izvedeno pravilo „bez rollovera". Krediti iz paketa bi bili **obrisani** prvom
mesečnom dodelom.

| Kolona | Šta drži | Ponaša se |
|---|---|---|
| `credits_balance` | krediti iz pretplate i bete | **resetuje se** mesečno, bez rollovera |
| `credits_topup` | krediti iz paketa | **nikad ne ističe** |

- Prikazano stanje = zbir; razbijeno na dva reda samo na `/krediti`
- **Troši se prvo `credits_balance`** (ističe), pa `credits_topup` (ne ističe) — jedini
  redosled koji je u korist korisnika
- `spend_credit_and_unlock` i `spend_credit_and_scan` menjaju se **jednom**, atomski, pod
  istim `for update`. Novčana putanja — `pnpm check:f4` ide ponovo nad pravom bazom.

### 1.5 Životni ciklus naloga (D5)

Šest stanja. **Jedna funkcija `stanjePristupa()` je izvor istine** — koriste je i kapija u
layout-u, i API rute, i baneri, i modal. Nikad dva mesta koja zaključuju različito.

| Stanje | Kada | Šta može |
|---|---|---|
| **`beta`** | plan `beta`, rok u budućnosti ili neograničeno | sve, dok ima kredita |
| **`aktivan`** | pretplata `active` / `trialing` | sve |
| **`otkazan`** | pretplata `canceled`, period još traje | sve; baner „traje do \<datum\>" |
| **`dopuna`** | nema pretplate ni bete, ali `credits_topup > 0` | sve, sa `dopuna` limitima iz §1.3 |
| **`grace`** | rok istekao, **30 dana** posle | **samo čitanje**: postojeći prospekti, pipeline, **izvoz oba**. Bez pretrage, skeniranja i otključavanja. |
| **`zakljucan`** | grace istekao | ništa — ulaz vodi na `/cenovnik` |

**Pristup ima ko ispunjava bar jedno:** aktivna pretplata · beta koja traje · `credits_topup > 0`.

**Grace je 30 dana i to je namerno.** Korisnik koji prestane da plaća dobija mesec dana da
izvuče svoj rad. Otključani prospekti su plaćeni, pipeline je njegov rad — oduzeti mu ih
istog dana je najbrži put do chargebacka.

**Datumi se ne skladište dvaput.** Čuvaju se samo ulazi:

```
profiles.beta_expires_at    admin postavlja; NULL = neograničeno
profiles.plan_expires_at    iz Paddle current_period_end
pun pristup do    = max(beta_expires_at, plan_expires_at)
čitanje do        = pun pristup do + GRACE_DAYS (30)
```

**Podrazumevana dužina bete: 30 dana** od otvaranja naloga (odluka P6). Admin sme da postavi
drugi datum ili „neograničeno".

**Šta korisnik vidi:**

- U `grace` stanju: trajan baner sa **tačnim datumom** i dugmetom ka `/cenovnik`; pretraga,
  skeniranje i otključavanje su vidljivo onemogućeni sa objašnjenjem
- Kad beta istekne ili ponestane kredita usred rada: **modal** koji vodi na `/cenovnik` —
  gde može da uzme plan **ili samo paket kredita**
- U `zakljucan` stanju: ulaz je stranica sa objašnjenjem i dugmetom ka cenovniku, ne prazan
  ekran i ne 404
- Mejlovi („beta ti ističe za 7 dana", „pristup ističe za 7 dana") — **odloženo**, ne
  blokiraju lansiranje

### 1.6 Kupon za beta korisnike (D5, P3, P8)

**Jedan kod, 33% popusta, jednokratan, važi do kraja 2026.**

| Cena | Puna | Sa kuponom | Cilj iz P3 |
|---|---|---|---|
| Starter mesečno | €29 | **€19,43** | €19 ✓ |
| Pro mesečno | €59 | **€39,53** | €39 ✓ |
| Advanced mesečno | €119 | **€79,73** | €89 — €9 povoljnije |
| Starter godišnje | €290 | **€194,30** | — |

**Zašto jedan procenat, a ne tačno €19/€39/€89:** Paddle popust je **jedan procenat na sve
proizvode na koje je ograničen**. Tražene cifre su tri različita popusta (34,5% / 33,9% /
25,2%), što bi značilo **tri koda** — tri stvari koje mogu da se pomešaju i tri kupca koji
dobiju pogrešan. 33% pogađa Starter i Pro skoro tačno; Advanced ispadne €10 povoljniji, što
je za šačicu beta korisnika prihvatljiva cena jednostavnosti.

**Zašto `recur: false` (samo prva transakcija) — i zašto je to bolje nego što izgleda:** na
mesečnom planu popust važi jedan mesec, na godišnjem **celu prvu godinu**. To samo od sebe
gura beta korisnika ka godišnjoj pretplati, a godišnja je bolja i za tok novca i za Paddle
naknadu (fiksnih €0,50 jednom umesto dvanaest puta). Popust se ne pretvara u trajni niži
cenovnik.

```
type                  percentage
amount                33
code                  BETA2026
enabled_for_checkout  true                    kupac ga ukuca u checkout-u
recur                 false                   SAMO prva transakcija
restrict_to           [pro_Starter, pro_Pro, pro_Advanced]
                                              samo pretplate; paketi se NE popuštavaju
usage_limit           50                      gornja granica za beta krug
expires_at            2026-12-31T23:59:59Z    do kraja godine (odluka P8)
```

**Popust se primenjuje sam.** Pošto server pravi Paddle transakciju iz Clerk sesije, u tom
trenutku se zna da li je korisnik beta — pa se `discountId` prosleđuje bez kucanja. Kod
ostaje kao rezerva za nekoga ko kupuje pre nego što se uloguje. Isti popust, dva puta.

## 2. Stanje na 20. avgust 2026

### Radi — provereno

- **Paddle sandbox katalog je KOMPLETAN.** Provereno preko API-ja 21.8.: 4 proizvoda,
  **8 cena, 0 override-a**, sve `active`. Starter €29/€290, Pro €59/€590, Advanced
  €119/€1.190, „Dopuna kredita" €19 i €49 (jednokratne). Godišnje = 10× mesečno.
- **Kupon `BETA2026` aktivan** — `dsc_01m0fgb2e0ex6dh5g3hba2c1ep`, 33%, `recur: false`,
  50 iskorišćenja, ističe 31.12.2026, ograničen na tri proizvoda pretplate.
- **Svih 8 `pri_` ID-jeva stoji u `lib/cenovnik.ts`** (`TIERS` i `PAKETI`); pogodnosti su
  usklađene sa tabelom iz §1.3.
- **`.env.example` ima serverske Paddle promenljive** (`PADDLE_API_KEY`,
  `PADDLE_WEBHOOK_SECRET`, `PADDLE_BETA_DISCOUNT_ID`); poslednja je popunjena u `.env`.
- `components/cenovnik-ekran.tsx` — `PricePreview` u jednom pozivu, overlay checkout, tema
- `lib/paddle-okruzenje.ts` — Zod + ukrštena provera `test_`/`live_` prema okruženju
- `next.config.ts` — CSP proširen na `*.paddle.com`, uključujući `frame-src`
- `/welcome` — ispravna kopija („plaćanje primljeno", ne „plan aktiviran")
- `pnpm typecheck` i `pnpm --filter web lint` prolaze

### Ne radi — naplata

| # | Šta | Gde |
|---|---|---|
| N1 | **Webhook ne postoji.** Polar stub je obrisan u S16 i rute sada nema uopšte; u Paddle sandboxu je `notification_settings` i dalje **prazan niz**. RPC koje treba da pozove (`apply_subscription`, `apply_credit_pack`) postoje od `0022`. | — |
| N2 | **Checkout ne nosi `user_id`.** Samo `customer.email`. | `components/cenovnik-ekran.tsx` |
| ~~N3~~ ☑ | **Rešeno u S16.** `billing_events`, `subscriptions`, `profiles.credits_topup` i `apply_*` funkcije. | `0022_naplata.sql` |
| ~~N4~~ ☑ | **Rešeno u S16.** Pet planova, `pri_` katalog i budžetski kapovi su sada u `plans.ts`. | `packages/shared/src/plans.ts` |
| N5 | **Nema obnavljanja kredita po pretplati.** | — |
| N6 | **Nema portala ni otkazivanja.** | — |
| N7 | **Nema UI stanja pretplate.** | `app/(app)/krediti/page.tsx` |
| N8 | **`/cenovnik` nije linkovan niotkuda.** Nula linkova u celom `src`. | — |
| ~~N9~~ ☑ | **Rešeno u S16.** Stub, zavisnost, lockfile i env očišćeni; `grep -ri polar` vraća samo `docs/`. | — |
| N10 | **Paketi postoje kao podatak, ali ne i kao ekran.** Cene se učitavaju (u `SVI_PRICE_ID` su), sekcija koja ih prikazuje dolazi u S21. | `components/cenovnik-ekran.tsx` |
| ~~N11~~ | ~~`SCAN_CREDIT_COST` je i dalje 1~~ — **rešeno u S17.** Konstanta je obrisana, cena se izvodi iz broja stranica, i sva mesta koja su pisala „1 kredit" (i tri van `pretraga-ekran.tsx` koje spisak nije imao) promenjena su odjednom. | `plans.ts`, `pretraga-ekran.tsx` |

### Ne radi — životni ciklus i ostalo

| # | Šta |
|---|---|
| Z1 | **Nema pojma o isteku.** `beta_expires_at`, `plan_expires_at` i `GRACE_DAYS` postoje od S16, ali ih **niko ne čita**: nema `stanjePristupa()`, nema kapije, nema banera. Ko ima nalog — ima pristup, zauvek. |
| Z2 | **Admin ne može da postavi beta rok** ni da vidi stanje pristupa. Može plan i kredite. |
| ~~Z3~~ ☑ | **Rešeno u S16.** `admin_adjust_credits(p_kind => 'povracaj')` sme u minus; obična korekcija i dalje ne sme. |
| V1 | **F8 nije rađen uopšte.** Landing, pravni tekstovi, kanarinci, merenje, onboarding. |
| V2 | **Nema futera.** Pravni linkovi nemaju gde da stoje. |
| V3 | **`CRON_SECRET` nije u `.env`** → sve tri `/api/cron/*` vraćaju `404`. |
| V4 | **Sentry ne postoji.** Pad webhooka je tih — korisnik misli da je platio. |
| V5 | **`podrska@sajtoskop.com`** stoji na `/cenovnik` i `/welcome`; nije provereno da postoji. |
| V6 | **Poresko pitanje otvoreno.** `naplata-paddle.md` §9 — 19 pitanja, nijedan odgovor. |
| V7 | **Backup nikad pokrenut** nad pravim `DATABASE_URL`-om. |
| ~~V8~~ ☑ | **Rešeno u S16.** `naplata-polar.md` → `naplata-paddle.md` sa blokom o prelasku; ispravljen i `naplata-bez-firme.md` §2. |

---

## 3. Šta znači „spremno za lansiranje"

1. Čovek koji te ne poznaje dođe sa linka, registruje se i napravi pretragu bez pitanja
2. Uslovi, Privatnost i Politika povraćaja objavljeni i linkovani
3. Kupovina plana **i paketa kredita** prolazi, webhook stigne, plan i krediti se dodele —
   provereno na duplom webhooku, povraćaju i otkazivanju
4. Otkazivanje je samouslužno (portal), ne mejl tebi
5. Beta nalog se otvara iz konzole, sa kreditima i rokom; istek roka vodi u grace, pa u
   zaključano — sve provereno na testnom nalogu
6. Pet metrika aktivacije se čita jednim SQL upitom; kanarinci u bazi
7. Pad bilo čega stigne u Sentry, ne do korisnika
8. Backup jednom stvarno obnovljen
9. Knjigovođa pisano odgovorio na pitanje fiskalizacije
10. Obe teme i telefon (≤ 390 px) provereni na svakom ekranu

---

## 4. Pitanja — sva zatvorena

> Trag odluka, da se za pola godine ne odlučuje ponovo o istom.
> **Nijedno pitanje nije otvoreno; S16 nema preduslova.**

### Zatvoreno 20. avgusta

| # | Odgovor |
|---|---|
| **P1** ✅ | Places Text Search **Enterprise**: **$35/1.000** (≈ €0,032 po pozivu), **1.000 besplatnih poziva mesečno**. Potvrđeno iz Google pricing tabele i nezavisnog izvora; SKU izveden iz `FIELD_MASK`-a u `places.ts`. |
| **P2** ✅ | `PLACES_MONTHLY_BUDGET_EUR = 60` — tvrda gornja granica. |
| **P3** ✅ | Kupon: **jedan kod, 33%, jednokratan** (v. §1.6). |
| **P4** ✅ | Cene potvrđene: planovi €29/€59/€119 mesečno i €290/€590/€1.190 godišnje; paketi €19 (50 kredita) i €49 (150 kredita). |
| **P5** ✅ | **Landing je na `sajtoskop.com`, u istoj Next aplikaciji.** `/` postaje prodajna strana; prijava se seli na `/prijava`, koja danas postoji samo kao redirekcija. **Bez `app.` subdomena** — v. obrazloženje ispod. |
| **P6** ✅ | Beta traje **30 dana** od otvaranja naloga; admin sme drugi datum ili „neograničeno". |

#### Zašto landing ide u istu aplikaciju, a ne na `app.` subdomen

F8 predlaže razdvajanje domena. Sa `sajtoskop.com` kao prodajnom stranom, jeftinija varijanta
je jedna aplikacija:

| | Ista aplikacija (`/` = landing) | `app.` subdomen |
|---|---|---|
| Clerk | jedna izmena: sign-in URL na `/prijava` | novi domen, nova podešavanja, novi redirect URL-ovi |
| CSP | bez izmene | novi origin u svakoj direktivi |
| `successUrl` checkout-a | bez izmene | menja se |
| Paddle default payment link | bez izmene | menja se |
| Deploy | jedan | dva (ili rewrite pravila) |
| SEO | landing i cenovnik na golom domenu | isto |

`/prijava` i `/registracija` **već postoje** kao redirekcije na `/`, pa je preokret
mehanički. Ulogovan korisnik na `/` više se ne preusmerava na `/pretraga` nego vidi landing
sa dugmetom „Otvori aplikaciju" — prodajna strana mora da bude čitljiva i onome ko je već
kupio.

### Zatvoreno 21. avgusta

| # | Odgovor |
|---|---|
| **P7** ⊘ | **Otpalo — `RS` override se uklanja u celosti.** Nije bio dinarska cena nego sniženi EUR iznos za kupce iz Srbije; ostatak napuštenog pokušaja da cena bude u dinarima (Paddle ne podržava RSD). Jedna cena, svuda. Obrazloženje u §1.3. |
| **P8** ✅ | Kupon `BETA2026` važi **do 31. decembra 2026**, 50 iskorišćenja. |
| **P9** ⊘ | **Otpalo iz istog razloga kao P7.** Paketi su €19 i €49, bez override-a. |

**Nema otvorenih pitanja.** S16 može da počne.

Jedina stvar koja i dalje čeka odgovor sa strane je **fiskalizacija** (korak R18, pisani
odgovor knjigovođe). Ne blokira nijednu sesiju — blokira **produkciju**, ne razvoj.

---

## 5. Mapa isporuka

| # | Isporuka | Zavisi od | Procena | Stanje |
|---|---|---|---|---|
| ~~R1, R2, R5, R5a, R6~~ | Places cena, budžet, paketi, override-i, kupon | — | — | ☑ |
| **R3, R4, R7, R8** | Paddle: API ključ, payment link, tunel, destination | — | 45 min | ☐ |
| ~~**S16**~~ | Novčanik, planovi, paketi, migracija `0022` | — | 1,5 dana | ☑ |
| ~~**S17**~~ | Dubina skeniranja, cena po stranici, migracija `0023` | S16 | 1 dan | ☑ |
| **S18** | Paddle webhook + serverski checkout + kupon | S17, R3+R4+R7+R8 | 1,5 dana | ☐ |
| **S19** | Životni ciklus pristupa: beta istek, grace, modal, baneri | S16 | 1,5 dana | ☐ |
| **S20** | Admin konzola: beta nalozi | S19 | 0,75 dana | ☐ |
| **S21** | Cenovnik sa paketima, stanje pretplate, portal, linkovi | S18, S19 | 1 dan | ☐ |
| **S22** | Pravni tekstovi + futer | — | 0,5 dana | ☐ |
| **S23** | F8 — kopi landinga (samo tekst) | — | 0,5 dana | ☐ |
| **S24** | F8 — landing na `/` + onboarding | S22, S23 | 1,5 dana | ☐ |
| **S25** | F8 — kanarinci + pet metrika | — | 0,5 dana | ☐ |
| **S26** | Sentry + testovi naplate + sandbox prolaz | S18, S19 | 1 dan | ☐ |
| **R9–R32** | Ostali ručni koraci iz §7 — zaostalo iz ranijih faza, knjigovođa, operativa | razno | ~2,5 dana | ☐ |

**Ukupno: ~11,5 dana koda + ~2,5 dana ručnog rada.**

---

## 6. Sesije

---

### S16 — Novčanik, planovi i paketi kredita

**Šta se menja:** dve kase kredita; `PLANS` dobija četiri prava plana; paketi kredita ulaze
u model; globalni Places kapovi prelaze na budžet iz env-a; Polar nestaje.

**Zašto prvo:** sve ostalo piše u ove tabele i čita ove brojeve.

**Preduslovi:** nema. Sve cene, budžet i limiti su potvrđeni — v. §1.3.
Bez ručnih koraka u Paddle-u.

```
Radimo S16 iz docs/LANSIRANJE.md — novčanik, planovi i paketi kredita. Pročitaj prvo
CLAUDE.md, docs/00-kontekst.md, docs/LANSIRANJE.md (CELU sekciju 1 — tamo su donete odluke
i obrazloženja) i docs/naplata-polar.md sekciju 5. Ne piši nijednu rutu, nijedan webhook,
nijednu komponentu i nijednu kapiju pristupa — to su S18, S19 i S21.

Zatečeno stanje: migracije do 0021. Naplata je Paddle (Polar je napušten pokušaj).
Sandbox katalog je KOMPLETAN i tačan: 3 proizvoda pretplate sa 6 cena, plus proizvod
„Dopuna kredita" sa dve jednokratne cene. **Nema nijednog `RS` override-a — jedna EUR cena
za ceo svet** (odluka P7). Svih 8 `pri_` ID-jeva već stoji u apps/web/src/lib/cenovnik.ts,
paketi kao `PAKETI`. Ne izmišljaj ID-jeve i ne pravi markere.

1. ČIŠĆENJE POLARA
   - obriši apps/web/src/app/api/billing/webhook/route.ts (Polar stub)
   - ukloni @polar-sh/nextjs iz apps/web/package.json i iz pnpm-lock.yaml
   - ukloni POLAR_ACCESS_TOKEN i POLAR_WEBHOOK_SECRET iz .env
   - preimenuj docs/naplata-polar.md u docs/naplata-paddle.md; na vrh dopiši blok
     „Šta se promenilo prelaskom na Paddle": Paddle ne podržava RSD (33 valute, RSD nije
     među njima), pa su cene za Srbiju EUR override na zemlju RS. Ostatak dokumenta o MoR
     modelu, knjigovodstvu i pravilima idempotencije važi doslovno.
   - u docs/naplata-bez-firme.md sekcija 2 ispravi red o provajderu

2. MIGRACIJA supabase/migrations/0022_naplata.sql

   a) DRUGA KASA KREDITA — v. LANSIRANJE.md 1.3
      - profiles.credits_topup integer not null default 0, sa check >= 0
      - grant_monthly_credits ostaje NEPROMENJEN i i dalje POSTAVLJA credits_balance;
        credits_topup ne dira. To je cela poenta razdvajanja.
      - spend_credit_and_unlock i spend_credit_and_scan: provera je nad ZBIROM obe kase,
        a skidanje ide PRVO sa credits_balance (ističe), pa sa credits_topup (ne ističe).
        Sve u istoj transakciji, pod istim `for update`. Ovo je novčana putanja — ne
        uvodi „pročitaj pa upiši" ni na jednom mestu.
      - admin_adjust_credits: mora da podnese POVRAĆAJ paketa čiji su krediti već
        potrošeni. Danas vraća 'balans bi bio negativan' i odbija. Dozvoli negativan
        rezultat SAMO za razlog povraćaja i objasni u komentaru zašto; obična admin
        korekcija i dalje ne sme u minus. Predloži mi oblik pre nego što ga napišeš ako
        vidiš čistije rešenje.

   b) NAPLATA
      - billing_events (event_id text primary key, event_type text not null,
        occurred_at timestamptz, received_at timestamptz default now())
      - subscriptions (user_id text references profiles, paddle_subscription_id text
        unique, paddle_customer_id text, status text, price_id text, plan text,
        current_period_end timestamptz, canceled_at timestamptz, country_code text)
        sa check na status i na country_code ~ '^[A-Z]{2}$'
      - profiles: paddle_customer_id text, plan_expires_at timestamptz,
        beta_expires_at timestamptz (NULL = neograničena beta — v. LANSIRANJE.md 1.4)
      - RLS enable + force na obe nove tabele, BEZ ijedne politike (pravilo 10)

   c) RAZLOZI U KNJIZI
      - credit_ledger_reason_valid dobija: 'subscription_grant', 'credit_pack', 'onboarding'
      - PAŽNJA, zamka koju 0011 izričito imenuje (pravilo 3): nov razlog mora i u CHECK
        ograničenje I U TELO grant_credits, inače svaki poziv tiho vrati invalid_reason
      - 'credit_pack' puni credits_topup, ne credits_balance — grant_credits mora da zna
        u koju kasu ide koji razlog. Predloži oblik (dodatni parametar ili mapa razloga
        u telu) i objasni izbor u komentaru.
      - 'onboarding' je za besplatan prvi unlock iz F8 sekcija 2; dodaje se sada da S24 ne
        bi tražio drugu migraciju. ref_id = user_id, dakle jednom po nalogu.
      - dopuni parcijalni indeks credit_ledger_grant_idem_idx novim razlozima

   d) apply_subscription(...) i apply_credit_pack(...)
      - obe security definer, revoke from public/anon/authenticated, grant to service_role
      - apply_subscription: upiše red u subscriptions, postavi profiles.plan i
        plan_expires_at, pozove grant_credits('subscription_grant'). ref_id je Paddle
        transaction ID → dvostruka dodela nemoguća.
      - apply_credit_pack: doda kredite u credits_topup kroz grant_credits('credit_pack'),
        ref_id je Paddle transaction ID
      - migracija mora biti idempotentna (drop if exists / create or replace)

3. packages/shared/src/plans.ts — PREPIŠI po tabeli iz LANSIRANJE.md 1.3
   - PlanId = "beta" | "dopuna" | "starter" | "pro" | "advanced"
     * "beta"   — postavlja ISKLJUČIVO admin; nikad registracija, kupon ni webhook
     * "dopuna" — korisnik bez pretplate koji ima samo kupljene kredite; monthlyCredits 0,
       dnevni limiti kao Starter
   - polja po planu: monthlyCredits, cacheMissPerDay (= dnevni osigurač za skeniranja),
     exportPerDay, aiRewritePerDay
   - NEMA mesečnog capa na skeniranja. U S17 cena skeniranja postaje 1 kredit po stranici,
     pa je novčanik sam po sebi ograničenje — v. LANSIRANJE.md 1.2. Dnevni cap ostaje samo
     kao osigurač od odbeglog skripta.
   - SCAN_CREDIT_COST NE DIRAJ. Ostaje 1, kako i jeste u kodu.
     Razlog: UI na desetak mesta u components/pretraga-ekran.tsx tvrdo piše „1 kredit"
     („Skeniraj za 1 kredit", „Osveži za 1 kredit", poruka posle naplate…). Podizanje
     konstante na 2 bez izmene tih stringova pravi prozor u kome se naplaćuje jedno a
     piše drugo — nad novcem. S17 menja i cenu i sve stringove ODJEDNOM.
   - GRACE_DAYS = 30
   - PAKETI: dva, po tabeli iz 1.4 (50 kredita €19, 150 kredita €49). ID-jevi već postoje
     u lib/cenovnik.ts kao PAKETI — preuzmi ih odatle, ne prepisuj
   - mapa pri_… → PlanId za pretplate i pri_… → broj kredita za pakete. ID-jevi pretplata
     već stoje u apps/web/src/lib/cenovnik.ts — NE prepisuj ih, nego napravi jedan izvor
     istine tako da razilaženje pukne u typecheck-u, ne u produkciji.
   - GLOBALNI KAPOVI prelaze na budžet (v. LANSIRANJE.md 1.2):
       PLACES_EUR_PER_CALL        0,032    ($35/1.000, Text Search ENTERPRISE)
       PLACES_FREE_CALLS_MONTH    1.000    Googleov besplatan prag za taj SKU
       PLACES_MONTHLY_BUDGET_EUR  60       iz env-a, podrazumevano 60
       GLOBAL_MONTHLY_API_CAP  = PLACES_FREE_CALLS_MONTH + budžet / cena  ≈ 2.800
       GLOBAL_DAILY_API_CAP    = mesečni / 20                            ≈ 140
     Zadrži postojeća imena i tipove da worker ne mora da se prepisuje. U komentaru zapiši:
     (a) da je SKU Enterprise jer FIELD_MASK traži nationalPhoneNumber i websiteUri —
         Essentials SKU ima 10.000 besplatnih poziva, Enterprise samo 1.000, i lako je
         pogledati pogrešan red u Google tabeli;
     (b) da je ovo SVESNO povećanje broja Places poziva, sa očekivanim računom od €5–15 na
         prvih 20 korisnika i tvrdom granicom od €60;
     (c) da budžet MORA da raste sa brojem pretplatnika — jedan Advanced korisnik u najgorem
         režimu troši trećinu celog kapa, a odbijeno skeniranje plaćenom korisniku je skuplje
         od svakog Places računa.
   - aiRewritePerDay traži brojač po korisniku, po uzoru na cache_miss_day i export_day iz
     migracije 0004. Dodaj kolonu i claim funkciju u istoj migraciji 0022.

4. apps/web/src/lib/cenovnik.ts
   - Pogodnosti su VEĆ usklađene sa tabelom iz 1.3 (šest istih stavki po kartici, menja se
     samo broj). Ne prepisuj ih — PROVERI da se svaki broj poklapa sa plans.ts i javi mi ako
     se negde razilazi. Ako plans.ts i cenovnik.ts mogu da dele izvor tih brojeva bez
     ružnog spajanja, uradi to; ako ne, ostavi i dopiši komentar.
   - `drzavaIzZaglavlja()` u app/cenovnik/page.tsx OSTAJE i posle uklanjanja override-a:
     Paddle i dalje traži zemlju zbog poreza koji ulazi u prikazanu cenu.
   - izbaci „AI poruke po kanalu" kao Pro razliku — svi kanali ostaju svima; Pro razlika je
     broj „Napiši drugačije" varijanti dnevno (v. LANSIRANJE.md 1.2, tačka 4)
   - „Izvoz u CSV bez dnevnog ograničenja" → „10.000 redova dnevno" (tačka 5)
   - dodaj sekciju za pakete kredita kao PODATAK (bez UI-ja — UI je S21)

5. scripts/validate-migrations.ts — blok „S16 — novčanik i naplata":
   - RLS na billing_events i subscriptions
   - potrošnja skida prvo credits_balance pa credits_topup; zbir se ne razlikuje
   - grant_monthly_credits resetuje credits_balance i NE dira credits_topup
   - apply_subscription i apply_credit_pack idempotentni po istom ref_id-u
   - grant_credits prihvata tri nova razloga i odbija nepoznat
   - povraćaj kroz admin_adjust_credits kad su krediti potrošeni — prolazi

Na kraju: pnpm typecheck, pnpm check:sql, pnpm test, pnpm --filter web lint, pnpm build.
Podseti me da pustim `pnpm check:f4` nad pravom bazom — menjana je novčana putanja.
Ažuriraj docs/SESIJE.md i štikliraj S16 u docs/LANSIRANJE.md sekcija 5.
```

**Gotovo kad:** `pnpm check:sql` prolazi sa `0022`; `grep -ri polar` vraća samo istorijske
pomene u `docs/`; `planFor("pro")` vraća Pro limite; potrošnja prazni pravu kasu prvo.

**☑ Isporučeno 21. avgusta 2026.** Sva četiri uslova ispunjena; 46 novih provera u bloku
„S16 — novčanik i naplata". Detalji i odstupanja u `docs/SESIJE.md`.

**Preneto u S17 (i tamo isporučeno):** `SCAN_CREDIT_COST` je bio `1` (namerno — v. N11),
a cena po dubini je tražila i kolonu sa brojem stranica u `search_cache` i dubinu u ključu
deduplikacije (§1.2).

**Preneto u S21:** `/krediti`, `/dashboard` i admin ekran korisnika i dalje prikazuju samo
`credits_balance`. Dok webhook ne postoji, `credits_topup` ne može ni da bude različit od
nule, pa ovo nikoga ne pogađa — ali mora da se sredi PRE S18.

---

### S17 — Dubina skeniranja i cena po stranici

**Šta se menja:** skeniranje prestaje da bude jedna fiksna cena i postaje 1 kredit po
stranici rezultata. Time se **1 kredit izjednačava sa 1 Places pozivom**.

**Zašto odmah, a ne posle lansiranja:** menja `spend_credit_and_scan`, ključ deduplikacije i
`search_cache` — sve tri su stvari koje se posle lansiranja menjaju nad živim podacima i
živim korisnicima koji su platili po staroj ceni. Jeftinije je sada.

**Preduslovi:** S16 gotov (migracija `0022` puštena, `plans.ts` prepisan).

```
Radimo S17 iz docs/LANSIRANJE.md — dubina skeniranja i cena po stranici. Pročitaj prvo
CLAUDE.md, docs/DIZAJN-SISTEM.md (ima UI deo), docs/LANSIRANJE.md sekciju 1.2 (tamo je cela
odluka i tri zamke), docs/F9-cena-pretrage.md, apps/worker/src/lib/places.ts i
supabase/migrations/0009_f9_cena_pretrage.sql.

Ne diraj webhook, pristup ni ekran cenovnika — to su S18, S19 i S21.

CILJ: 1 kredit = 1 stranica rezultata = 1 Places poziv.

   Brzo         do 20 prospekata   1 stranica   1 kredit
   Standardno   do 40 prospekata   2 stranice   2 kredita     ← podrazumevano
   Duboko       do 60 prospekata   3 stranice   3 kredita

1. packages/shared/src/plans.ts
   - SCAN_CREDIT_COST kao konstanta NESTAJE. Zamenjuje je cenaSkeniranja(maxResults) ili
     tip Dubina sa tri člana — predloži oblik i objasni izbor. Cena mora da bude izvedena
     iz BROJA STRANICA, jednom, u shared paketu, i da je koriste web, worker i CLI.
     Broj stranica se već računa u places.ts (stranicaZaRezultate) — ne dupliraj tu logiku,
     nego je premesti u shared ako tamo pripada (ugly-score je presedan: jedan izvor istine).
   - Ukloni scansPerMonth ako je S16 ostavio — v. LANSIRANJE.md 1.2: kredit je sada
     ograničenje i taj cap više nema svrhu. Dnevni cap (cacheMissPerDay) OSTAJE kao
     osigurač od odbeglog skripta, sa vrednostima iz tabele u 1.3.

2. MIGRACIJA supabase/migrations/0023_dubina_skeniranja.sql

   a) spend_credit_and_scan — TRI izmene
      - Već prima p_max_results, ali naplaćuje FIKSNO 1 kredit (`-1` u telu i
        `credits_balance - 1`). Cena mora da se izvede iz broja stranica.
      - Provera balansa mora da bude nad ZBIROM obe kase (S16 je uveo credits_topup) i
        nad IZVEDENOM cenom, ne nad 1.
      - Ključ deduplikacije v_key je danas `country:city:niche`. MORA da uključi broj
        stranica. Bez toga dva korisnika sa različitim dubinama u istoj sekundi dele jedan
        posao: plitki „pobedi", a duboki plati 3 kredita za 20 rezultata.
        Provera „da li sam već platio" (already_paid) mora da nastavi da radi za isti
        (korisnik, kombinacija, dubina) — dupli klik i dalje ne sme da naplati dvaput.

   b) search_cache dobija broj stranica
      - nova kolona (predloži ime — `pages` ili `depth`), integer 1–3, sa check-om
      - record_scan je prima i upisuje (potpis je već proširivan u 0021 sa p_partial —
        isti obrazac, i pazi da 0021 i 0009 ostanu idempotentni u check:sql)
      - POGODAK U KEŠU je sada uslovan i po dubini: zahtev za dubinu D je besplatan samo
        ako je keširana dubina >= D I ako je mlađi od 30 dana (pravilo 1). Plići keš za
        dublji zahtev NIJE pogodak — 20 redova nije 60.
      - backfill: postojeći redovi dobijaju dubinu koja odgovara njihovom
        last_results_count, ne podrazumevanu vrednost. Red sa 55 rezultata je bio duboki
        scan i ne sme posle migracije da se ponaša kao plitki.

   c) refund_scan mora da vrati TAČAN iznos, ne 1 kredit. Danas vraća fiksno; posle ove
      izmene posao koji je naplaćen 3 kredita mora da vrati 3. Iznos pročitaj iz
      credit_ledger stavke za taj job, ne iz payload-a.

3. WEB — izbor dubine
   - segmentna kontrola sa tri opcije u formi pretrage, po obrascu prekidača ciklusa iz
     components/cenovnik-ekran.tsx (staza i klizač `--border-strong`, klizač je JEDAN
     element koji se pomera). Podrazumevano „Standardno".
   - uz svaku opciju stoji i broj prospekata i cena u kreditima; `.num` na oba
   - modal potvrde, dugme i traka ispod forme moraju da pokažu cenu IZABRANE dubine.
     ‼️ U components/pretraga-ekran.tsx „1 kredit" stoji TVRDO KODIRANO na bar deset mesta:
     „Skeniraj za 1 kredit", „Osveži za 1 kredit" (tri puta), „Skinut je 1 kredit za
     skeniranje", „Skeniraj ipak ponovo za 1 kredit", „skeniranje košta 1 kredit" (dva
     puta), „sutra skeniranje košta 1 kredit". Nađi ih grepom, ne po ovom spisku — spisak
     je od 21.8. i mogao je da se pomeri. Nijedan ne sme da ostane.
   - stanje dubine ide u URL, kao grad i niša (Faza 4, 4.3), da Back i deljenje linka rade
   - lista keša mora da pokaže dubinu keširane kombinacije, inače korisnik ne zna zašto je
     jedna pretraga besplatna a druga nije

4. WORKER — apps/worker/src/jobs/scan.ts
   - maxResults već stiže kroz payload i places.ts već iz njega računa stranice; proveri da
     ništa ne zaokružuje naviše i ne skenira dublje nego što je plaćeno. Skeniranje DUBLJE
     od plaćenog je trošak koji niko nije odobrio.
   - record_scan dobija dubinu

5. CLI — apps/cli: `--dubina` ili postojeći `--max` mapiran na isti izvor istine iz shared

6. TESTOVI (check:sql + apps/web/test/)
   - 1/2/3 stranice → 1/2/3 kredita naplaćeno
   - dupli klik na istu dubinu → jedna naplata (already_paid)
   - dva korisnika, različite dubine, isti trenutak → DVA posla, svaki plaća svoje
   - keš dubine 1, zahtev dubine 3 → naplaćeno; keš dubine 3, zahtev dubine 1 → besplatno
   - refund_scan vraća 3 kredita za posao naplaćen 3 kredita
   - nedovoljno kredita za „Duboko", dovoljno za „Brzo" → uredna poruka, ne pad

Na kraju: pnpm typecheck, pnpm check:sql, pnpm test, pnpm --filter web lint, pnpm build.
Podseti me da pustim `pnpm check:f4` nad pravom bazom — opet je dirana novčana putanja.
Dopuni docs/PROVERA-VIZUELNA.md sekcijom za izbor dubine. Ažuriraj docs/SESIJE.md i
štikliraj S17 u docs/LANSIRANJE.md.
```

**Gotovo kad:** „Brzo" naplaćuje 1 kredit i vraća 20 prospekata; „Duboko" nad kombinacijom
keširanom plitko naplaćuje i ide u Places; `pnpm check:f4` prolazi.

**☑ Isporučeno 20. avgusta 2026.** Migracija `0023_dubina_skeniranja.sql`. Sve tri zamke iz
§1.2 pokrivene proverama: keš pamti dubinu (`search_cache.pages`, sa backfillom iz
`last_results_count`), ključ deduplikacije nosi broj stranica (`RS:grad:nisa:p2`), a cena
se izvodi iz stranica i meri nad zbirom obe kase. `SCAN_CREDIT_COST` više ne postoji.
33 nove provere u `check:sql` i nov `apps/web/test/dubina.ts`. Detalji i odstupanja u
`docs/SESIJE.md`.

**Preneto u S18:** ništa. **Preneto u S21:** ekran cenovnika i prikaz zbira obe kase na
`/krediti`, `/dashboard` i admin ekranu — strana pretrage je već prešla na zbir, jer
odlučuje o naplati.

---

### S18 — Paddle webhook, serverski checkout, kupon

**Preduslovi:** S17 gotov. **R3, R4, R7, R8** (API ključ, payment link, tunel, destination).
Paketi i kupon su već napravljeni.

```
Radimo S18 iz docs/LANSIRANJE.md — Paddle webhook, serverski checkout i kupon. Pročitaj
prvo CLAUDE.md, docs/LANSIRANJE.md (sekcije 1 i 2), docs/naplata-paddle.md sekciju 5 i
apps/web/src/lib/env.ts. Ne diraj kapije pristupa (S19), admin konzolu (S20) ni UI
cenovnika i pretplate (S21).

Zatečeno stanje posle S16: migracija 0022 puštena; postoje billing_events, subscriptions,
credits_topup, apply_subscription, apply_credit_pack i prepisan plans.ts sa paketima.
U Paddle sandboxu postoje i pretplate i dva paketa kredita; imam pdl_sdbx_ API ključ,
pdl_ntfset_ webhook tajnu i napravljen notification destination.

1. ZAVISNOST
   pnpm --filter web add @paddle/paddle-node-sdk
   (paddle-js 1.6.4 ostaje — on je klijentski)

2. ENV — .env i .env.example VEĆ IMAJU sve tri promenljive sa objašnjenjima:
   PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_BETA_DISCOUNT_ID. Ne dopisuj ih ponovo.
   Dodaj samo čitanje u lib/env.ts:
   - prve dve u ODVOJENU Zod šemu koja BACA kad fali, po uzoru na webhookSecret(), ne po
     uzoru na cronSecret(): neverifikovan webhook je javni endpoint koji deli kredite
   - PADDLE_BETA_DISCOUNT_ID je opciono i NE sme da baca: bez njega se popust prosto ne
     primenjuje sam, a kod se i dalje kuca u checkout-u

3. POST /api/billing/checkout
   - runtime "nodejs", dynamic "force-dynamic"
   - user_id ISKLJUČIVO iz requireSession() (pravilo 8) — nikad iz tela
   - telo: { priceId } validiran Zodom protiv mape iz plans.ts (i pretplate i paketi);
     nepoznat pri_ = 400
   - kreira Paddle transakciju sa custom_data: { user_id, kind: "subscription" | "pack" }
     i vraća { transactionId }
   - KUPON: ako je korisnik beta (profiles.plan === "beta") i PADDLE_BETA_DISCOUNT_ID
     postoji, primeni popust na transakciju sam. Popust je u Paddle-u podešen kao
     jednokratan (recur:false) i ograničen na proizvode pretplata — dakle ne hvata pakete,
     i to je namerno. Kod i dalje može ručno da se ukuca u checkout-u; oba puta vode do
     istog popusta.
   - rate limit po korisniku, po uzoru na postojeće rute

4. components/cenovnik-ekran.tsx
   - otvoriCheckout zove /api/billing/checkout, pa Paddle.Checkout.open({ transactionId })
   - gost ide na registraciju sa povratkom na cenovnik: bez Clerk sesije nema user_id-ja,
     pa nema čime da se poveže kupovina
   - postojeći eventCallback za checkout.error ostaje

5. POST /api/billing/webhook
   - runtime "nodejs", dynamic "force-dynamic"
   - RAW body kroz await req.text(). Nikad req.json() — parsiranje razbija potpis.
   - paddle.webhooks.unmarshal(rawBody, secret, signature) iz Paddle-Signature zaglavlja.
     Verifikuje se UVEK, i u sandboxu.
   - idempotencija: prvo insert u billing_events po event_id, on conflict do nothing;
     ako je red postojao → 200 i STANI
   - VRATI 2xx UNUTAR 5 SEKUNDI. Sandbox retry-uje 3× za 15 min (produkcija 60× za 3 dana).
     Verifikuj, upiši event, vrati 200, pa radi ostalo.
   - događaji:
       transaction.completed  → grana po custom_data.kind:
                                "subscription" → apply_subscription (plan + krediti);
                                  ovo je i okidač mesečne obnove, pa cron nije potreban
                                  (Hobby plan nema slobodan slot)
                                "pack" → apply_credit_pack (krediti u credits_topup)
       subscription.created   → upis u subscriptions
       subscription.updated   → promena plana; plan_expires_at iz current_period_end
       subscription.canceled  → NE gasi pristup; upiši canceled_at, pristup do kraja perioda
       subscription.past_due  → označi stanje, ne oduzimaj ništa
       adjustment.created     → povraćaj → admin_adjust_credits (jedini omotač za negativan
                                iznos); mora da prođe i kad su krediti potrošeni
   - vezivanje po custom_data.user_id uz proveru da profil postoji. NIKAD po mejlu —
     kupac često plati sa druge adrese (pravilo 2 iz naplata-paddle.md 5.3).
   - VAŽNO: webhook NIKAD ne sme da postavi plan na "beta". Beta se dodeljuje isključivo iz
     admin konzole (odluka D1). Ako ikad stigne takav podatak — odbij i loguj.
   - nepoznat tip: upiši event, vrati 200, ne ruši se
   - logovanje bez PII-ja i bez ijednog ključa

6. TESTOVI (apps/web/test/, obrazac iz ide-odmah.ts)
   - isti event_id dvaput → jedna stavka u knjizi
   - pogrešan potpis → 401, ništa se ne upisuje
   - transaction.completed bez custom_data.user_id → ne ruši se, upiše event, javi grešku
   - kupovina paketa → krediti u credits_topup, ne u credits_balance
   - webhook koji pokušava plan "beta" → odbijen

Na kraju: pnpm typecheck, pnpm check:sql, pnpm test, pnpm --filter web lint, pnpm build.
Ažuriraj docs/SESIJE.md i štikliraj S18 u docs/LANSIRANJE.md.
```

**Gotovo kad:** simulacija `subscription_creation` dodeli plan i kredite; ponovljena ne
dodeli ništa; kupovina paketa napuni `credits_topup`; pogrešan potpis vraća 401.

---

### S19 — Životni ciklus pristupa

**Šta se menja:** aplikacija prvi put zna da pristup može da istekne.

**Zašto odvojeno od S18:** webhook je razgovor sa Paddle-om, ovo je pravilo o tome ko sme
unutra. Dve različite stvari, dva različita testa.

**Preduslovi:** S16 gotov (kolone `beta_expires_at`, `plan_expires_at`).

```
Radimo S19 iz docs/LANSIRANJE.md — životni ciklus pristupa. Pročitaj prvo CLAUDE.md,
docs/DIZAJN-SISTEM.md (ovo je delom UI sesija), docs/LANSIRANJE.md sekciju 1.4 (tamo je
cela tabela stanja) i apps/web/src/lib/auth.ts + app/(app)/layout.tsx.

Ne diraj admin konzolu (S20) ni ekran cenovnika i pretplate (S21). Bez mejlova — oni su
odloženi i nisu deo ove sesije.

1. JEDAN IZVOR ISTINE
   Nova funkcija stanjePristupa(profile, subscription) u packages/shared ili u
   apps/web/src/lib — odluči gde i objasni izbor. Vraća diskriminisanu uniju sa šest
   stanja iz LANSIRANJE.md 1.4: beta | aktivan | otkazan | dopuna | grace | zakljucan,
   i uz svako nosi datume koje UI prikazuje.

   Datumi se IZVODE, ne skladište dvaput:
     pun pristup do = max(beta_expires_at, plan_expires_at)   NULL beta = neograničeno
     čitanje do     = pun pristup do + GRACE_DAYS (30, iz plans.ts)

   Ovu funkciju koriste SVI: kapija u layout-u, API rute, baneri, modal. Ako se ikad
   zatekne druga računica o pristupu bilo gde u kodu, ova funkcija je izgubila smisao.

2. KAPIJE
   - grace: pretraga, skeniranje i otključavanje vraćaju odbijenicu sa jasnim razlogom.
     Prospekti, pipeline i OBA izvoza (lista i pipeline) rade normalno.
   - zakljucan: ulaz u (app) vodi na stranicu sa objašnjenjem i dugmetom ka /cenovnik.
     NE prazan ekran i NE 404 — korisnik mora da razume šta se desilo i šta može.
   - dopuna: pun pristup dok credits_topup > 0, sa Starter dnevnim limitima
   - Kapija ide UZ PODATAK, u svaku rutu i stranicu, ne samo u layout — layout se ne
     izvršava ponovo pri klijentskoj navigaciji (v. komentar na vrhu (app)/layout.tsx).

3. UI
   - Trajan baner u grace stanju: TAČAN datum do kog ima pristup, šta može a šta ne, i
     dugme ka /cenovnik. Isti baner (drugi tekst) za otkazanu pretplatu koja još traje.
   - Modal kad beta istekne ili ponestane kredita usred rada: objašnjenje + dva puta na
     /cenovnik — „uzmi plan" i „dokupi kredite". Ne prekidaj korisnika više puta za istu
     stvar; pamti da je viđen, po uzoru na motor utisaka.
   - Terminologija po tabeli iz CLAUDE.md. Obe teme, telefon (≤ 390 px), .num na datume.

4. TESTOVI
   - beta_expires_at NULL → uvek aktivan, i sa nula kredita
   - beta istekla juče → grace; za 31 dan → zaključan
   - otkazana pretplata sa periodom u budućnosti → pun pristup, ne grace
   - grace → izvoz prolazi, skeniranje ne
   - credits_topup > 0 bez pretplate → dopuna, pun pristup

Na kraju: pnpm typecheck, pnpm test, pnpm --filter web lint, pnpm build.
Dopuni docs/PROVERA-VIZUELNA.md sekcijom „Životni ciklus naloga". Ažuriraj docs/SESIJE.md
i štikliraj S19 u docs/LANSIRANJE.md.
```

**Gotovo kad:** testni nalog sa `beta_expires_at` u prošlosti vidi baner, može da izveze,
ne može da skenira; posle 30 dana ga ulaz vodi na cenovnik.

---

### S20 — Admin konzola: beta nalozi

**Preduslovi:** S19 gotov. Nema otvorenih pitanja.

```
Radimo S20 iz docs/LANSIRANJE.md — beta nalozi u admin konzoli. Pročitaj prvo CLAUDE.md,
docs/F12-admin.md, docs/LANSIRANJE.md sekciju 1.4 i postojeće apps/web/src/lib/admin-radnje.ts
(tamo su promeniPlan, korigujKredite, resetujLimit — nove radnje idu po istom obrascu).

Ne diraj naplatu ni ekran cenovnika.

1. NOVA ADMIN RADNJA: beta rok
   - PATCH /api/admin/korisnici/[id]/beta
   - telo: { do: <ISO datum> | null }  — null znači NEOGRANIČENO (v. LANSIRANJE.md 1.4)
   - postavlja profiles.beta_expires_at
   - kao i sve admin mutacije: pripremiRadnju → saAuditom → upis u admin_audit i na uspeh
     i na pad (pravilo 14), payload bez ijedne tajne
   - nov unos u RADNJE

2. „Otvori beta nalog" kao JEDNA radnja
   Danas admin mora tri poteza: promeni plan, dodaj kredite, (nema roka). Spoji ih u jedan
   obrazac na /admin/korisnici/[id]: plan „beta" + broj kredita + rok (datum ili
   neograničeno). Podrazumevano: **50 kredita, rok 30 dana** (odluka P6).
   Sve tri izmene u JEDNOM auditovanom pozivu — pola odrađenog beta naloga je gore nego
   nijedan.

3. Prikaz stanja pristupa
   - na /admin/korisnici: kolona sa stanjem iz stanjePristupa() (beta / aktivan / otkazan /
     dopuna / grace / zaključan) i filter po njemu
   - na detalju korisnika: oba datuma, izvedeni „pun pristup do" i „čitanje do", stanje
     obe kase kredita (credits_balance i credits_topup odvojeno)

4. Zaštita
   - plan „beta" sme da se postavi ISKLJUČIVO odavde (odluka D1). Proveri da nijedan drugi
     put — registracija, webhook, kupon — ne može da ga dodeli, i napiši test koji to drži.
   - beta rok u prošlosti je dozvoljen (tako se beta gasi ručno), ali traži potvrdu u UI-ju

5. Obe teme, telefon, .num na datume i brojeve.

Na kraju: pnpm typecheck, pnpm check:sql, pnpm test, pnpm --filter web lint, pnpm build.
Ažuriraj docs/SESIJE.md i štikliraj S20 u docs/LANSIRANJE.md.
```

**Gotovo kad:** beta nalog se otvara jednim obrascem; `/admin/korisnici` pokazuje stanje
pristupa i filtrira po njemu.

---

### S21 — Cenovnik sa paketima, stanje pretplate, portal, linkovi

**Preduslovi:** S18 i S19 gotovi. Paketi napravljeni (**R5**) i njihovi `pri_` ID-jevi upisani.

```
Radimo S21 iz docs/LANSIRANJE.md — cenovnik sa paketima, stanje pretplate i portal.
Pročitaj prvo CLAUDE.md, docs/DIZAJN-SISTEM.md (obavezno — UI sesija), docs/LANSIRANJE.md
sekcije 1.2, 1.3 i 1.4, i postojeće components/cenovnik-ekran.tsx i (app)/krediti/page.tsx.

1. POST /api/billing/portal
   - requireSession(), pročitaj paddle_customer_id iz profiles
   - Paddle customer portal session preko SDK-a; vrati URL za redirekciju
   - korisnik bez pretplate → 404, ne 403 (ne otkrivaj postojanje)
   - otkazivanje, kartica i računi ostaju kod Paddle-a — to je pola razloga zašto se
     merchant of record uopšte koristi

2. /cenovnik — sekcija „Paketi kredita" ispod tri plana
   - dva paketa iz plans.ts, cena kroz isti PricePreview poziv kao i planovi (dodaj ih u
     SVI_PRICE_ID, i dalje jedan mrežni poziv za sve)
   - kopija mora da kaže dve stvari jasno: krediti iz paketa NE ISTIČU, i paket NIJE
     zamena za pretplatu (skuplji je po kreditu — v. LANSIRANJE.md 1.3)
   - paket se kupuje i bez pretplate; to je podržan slučaj, ne izuzetak
   - hijerarhija: paketi su sekundarni blok, ne četvrta kartica u redu od tri. Jedno
     primarno dugme po ekranu i dalje važi (sekcija 7.1 dizajn sistema).

3. /krediti — blok „Pretplata" iznad izvoda
   - stanje iz stanjePristupa(): ime plana, cena, sledeća naplata, ili baner grace stanja
   - OBE KASE odvojeno: „iz pretplate — obnavlja se <datum>" i „dokupljeni — ne ističu".
     Korisnik mora da razume zašto mu se jedan deo balansa resetuje a drugi ne.
   - dugme „Upravljaj pretplatom" (sekundarno)
   - dugme „Dokupi kredite" → /cenovnik
   - .num na svaki datum i iznos

4. LINKOVI KA /cenovnik — danas ih ima NULA u celom src-u
   - stavka u bočnoj traci (okvir-aplikacije.tsx)
   - u futeru (nastaje u S22 — ako S22 nije gotov, ostavi TODO i reci mi)
   - poziv na akciju kad je stanje kredita nisko

5. Obe teme, telefon (≤ 390 px). Nijedan hex ni oklch u JSX-u.

Na kraju: pnpm typecheck, pnpm test, pnpm --filter web lint, pnpm build.
Dopuni docs/PROVERA-VIZUELNA.md. Ažuriraj docs/SESIJE.md i štikliraj S21.
```

**Gotovo kad:** paket se kupuje sa cenovnika bez pretplate; `/krediti` pokazuje obe kase;
otkazivanje prolazi bez mejla tebi.

---

### S22 — Pravni tekstovi i futer

**Zašto sada:** Paddle traži vidljive Uslove i Politiku povraćaja za odobrenje naloga u
produkciji, a F8 §3 kaže: *„Bez ovoga ne puštaš nijednog korisnika."*

**Preduslovi:** **R17** (odluka o politici povraćaja). Posle sesije ide **R18**.

```
Radimo S22 iz docs/LANSIRANJE.md — pravni tekstovi i futer. Pročitaj prvo CLAUDE.md,
docs/F8-landing.md sekciju 3, docs/DIZAJN-SISTEM.md i docs/bezbednost-i-zastita.md.
Ne radi landing (S23/S24) ni bilo šta iz naplate.

VAŽNO O OPSEGU: ovo su tekstovi iz šablona koje Marko posle čita i prepravlja. Ne
predstavljaj ih kao pravni savet i ne izmišljaj podatke — svuda gde treba stvarna činjenica
(matični broj, PIB, adresa, ime rukovaoca, rok čuvanja koji nije u kodu) ostavi vidljiv
<POPUNITI: …> marker i na kraju mi daj spisak svih markera.

1. Tri javne strane, izvan grupe (app):
   /uslovi · /privatnost · /povracaj

2. Uslovi korišćenja — obavezne klauzule po F8 sekcija 3:
   - zabrana automatizovanog pristupa, scrapinga i reverse engineeringa
   - zabrana preprodaje, dalje distribucije i deljenja pristupa
   - zabrana korišćenja podataka za izgradnju konkurentskog proizvoda
   - jedan nalog = jedno lice
   - pravo na suspenziju u slučaju kršenja
   - korisnik je odgovoran za način na koji kontaktira prospekte
   - naplatu vodi Paddle kao merchant of record — kupac pravno kupuje od Paddle-a, koji
     izdaje račun i obračunava porez
   - PRISTUP POSLE ISTEKA: 30 dana samo za čitanje i izvoz, pa prestanak pristupa
     (v. LANSIRANJE.md 1.4). Ovo mora da stoji u Uslovima, ne samo u UI-ju.
   - krediti iz pretplate se ne prenose u sledeći mesec; krediti iz paketa ne ističu

3. Politika privatnosti — ZZPL:
   - koji se podaci obrađuju: mejl korisnika iz Clerk-a; kontakti firmi su podaci o
     ličnosti preduzetnika i to mora izričito da piše
   - osnov obrade, rok čuvanja, prava lica
   - procedura brisanja na zahtev MORA da postoji stvarno — opiši postojeći put
     (Clerk → user.deleted webhook → kaskada, pravilo 15), ne izmišljen
   - obrađivači: Clerk, Supabase, Vercel, Hetzner, Anthropic, Resend, Paddle, Google
   - prenos van zemlje (svi navedeni su strani)

4. Politika povraćaja — po odluci iz R17. Mora da uzme u obzir da Paddle sme SAM da odobri
   povraćaj u roku od 60 dana i onda kad naša politika kaže drugačije. Objasni i šta biva
   sa već potrošenim kreditima pri povraćaju.

5. FUTER — ne postoji nijedna komponenta, pravi se sada
   - linkovi: Uslovi, Privatnost, Povraćaj, Cenovnik, kontakt
   - copyright notice
   - montira se na /, /cenovnik, /welcome i na tri nove strane; NE u grupi (app)
   - obe teme, telefon

6. Link na Uslove i Privatnost uz dugme za registraciju (auth-ekran.tsx).

Na kraju: pnpm typecheck, pnpm --filter web lint, pnpm build. Daj mi spisak svih
<POPUNITI: …> markera. Ažuriraj docs/SESIJE.md i štikliraj S22.
```

---

### S23 — F8: kopi landinga, samo tekst

**Zašto odvojeno:** tako traži `F8-landing.md` §9 — *„Prvo mi napiši ceo kopi landing
stranice kao markdown, bez ijedne linije koda."*

```
Radimo S23 iz docs/LANSIRANJE.md — kopi landing stranice. Pročitaj prvo CLAUDE.md,
docs/00-kontekst.md, docs/F8-landing.md (sekcije 1 i 9) i docs/LANSIRANJE.md sekciju 1
(cene i planovi su doneti i landing mora da im odgovara).

NE PIŠI NIJEDNU LINIJU KODA. Izlaz je jedan fajl: docs/landing-kopi.md.

Brojeve za hero i za sekciju „Dokaz" izvuci SQL upitom iz baze, ne iz PRD-a. Ako nemaš
pristup bazi iz sesije, napiši mi upite i ostavi <BROJ: opis> markere.

Struktura je u F8 sekcija 1 („Hero", pa „Ispod hero-a, ovim redom") — drži taj redosled.

Kopi je na srpskom, latinica, sa dijakritikom. Terminologija po tabeli iz CLAUDE.md:
prospekt (ne lead), otključaj (ne unlock), skeniranje (ne pretraga) — pretraga po kešu
jeste pretraga i besplatna je, i ta razlika mora da se vidi iz teksta.

Landing NE prodaje pretplatu (F8 sekcija 1); poziv na akciju je registracija, a cena živi
na /cenovnik. Ali pomen cene sme i treba — najniža ulazna cena je argument, ne prepreka.
Bete nema u kopiji: beta nalozi su ručni izuzetak, ne javna ponuda (odluka D1).
```

---

### S24 — F8: landing i onboarding prvih 90 sekundi

**Preduslovi:** S22 i S23 gotovi, kopi prepravljen (**R20**). Odluka o domenu je pala (P5).

```
Radimo S24 iz docs/LANSIRANJE.md — landing i onboarding. Pročitaj prvo CLAUDE.md,
docs/DIZAJN-SISTEM.md (obavezno), docs/F8-landing.md sekcije 1 i 2, docs/landing-kopi.md
(prepravljen tekst — ON je izvor istine za kopi, ne PRD) i docs/LANSIRANJE.md.

Ne radi kanarince ni metrike — to je S25.

1. LANDING po docs/landing-kopi.md

   ODLUKA JE DONETA (P5): landing je na sajtoskop.com, U ISTOJ APLIKACIJI. Bez app.
   subdomena. Konkretno:
   - `/` prestaje da bude ekran za prijavu i postaje prodajna strana
   - prijava i registracija se sele na `/prijava` i `/registracija`, koje danas postoje
     SAMO kao redirekcije na `/` — dakle preokret, ne nova strana. Postojeći sadržaj
     `app/page.tsx` (AuthEkran, leva brend kolona) seli se tamo skoro nepromenjen.
   - ulogovan korisnik na `/` se VIŠE NE preusmerava na /pretraga nego vidi landing sa
     dugmetom „Otvori aplikaciju" — prodajna strana mora da bude čitljiva i kupcu
   - CSP, successUrl checkout-a i Paddle default payment link se NE menjaju
   - jedina izmena van koda je Clerk sign-in / sign-up URL → `/prijava` (ručni korak R32).
     Reci mi tačno koja polja u Clerk konzoli menjam.
   Ako naiđeš na nešto što ova odluka ne pokriva, STANI i pitaj.
   - futer iz S22 se montira i ovde
   - obe teme, telefon (≤ 390 px), .num na svaki broj

2. ONBOARDING — prvih 90 sekundi (F8 sekcija 2). Jedini deo koji stvarno menja brojke.
   - posle registracije NE vodi na prazan dashboard, nego na /pretraga sa unapred
     izabranim gradom i nišom koji su VEĆ U KEŠU — rezultat je instant i besplatan.
     Kombinaciju izaberi upitom nad search_cache, ne zakucaj je.
   - prvi otključan prospekt je besplatan: grant_credits(+1, 'onboarding') PRE unlocka.
     Razlog je dodat u 0022; ref_id = user_id, dakle jednom po nalogu.
   - jedna kratka poruka u prvom rezultatu: „Zeleni bedževi su najbolji prospekti — firme
     koje sajt uopšte nemaju."
   - BEZ ture kroz aplikaciju, bez modala sa šest koraka
   - postojeći onboarding blok na /dashboard (Faza 4, 4.7) NE briši nego uskladi da se
     poruke ne dupliraju
   - onboarding NE sme da se pokrene za nalog u grace ili zaključanom stanju

Na kraju: pnpm typecheck, pnpm test, pnpm --filter web lint, pnpm build.
Dopuni docs/PROVERA-VIZUELNA.md. Ažuriraj docs/SESIJE.md i štikliraj S24.
```

---

### S25 — F8: kanarinci i pet metrika

```
Radimo S25 iz docs/LANSIRANJE.md — kanarinci i merenje. Pročitaj prvo CLAUDE.md,
docs/F8-landing.md sekcije 4 i 5, i docs/bezbednost-i-zastita.md (mera sa kanarincima).
Ne diraj landing ni naplatu.

1. KANARINCI (F8 sekcija 4, P1 mera)
   - scripts/kanarinci.ts ubacuje 5–10 lažnih biznisa sa jedinstvenim fingerprintima:
     nepostojeći nazivi, testni broj telefona koji kontrolišem, .rs domeni koje kontrolišem
   - izgledaju kao običan red u businesses, ali su prepoznatljivi meni. Predloži mehanizam
     obeležavanja koji NE curi ni u API odgovor ni u CSV izvoz, i objasni izbor.
   - prati kome su prikazani i ko ih je otključao (unlocks već nosi vezu — proveri da li
     je dovoljno ili treba pogled)
   - country_code kao i svuda (pravilo 11)

2. PET METRIKA (F8 sekcija 5) — SQL, bez ijednog analitičkog alata
   - registracije po danu
   - broj korisnika sa bar jednom pretragom (aktivacija)
   - broj sa bar jednim otključavanjem
   - broj koji su se vratili DRUGOG dana — jedina metrika koja stvarno odlučuje
   - prosečan broj pretraga po korisniku nedeljno
   Isporuči kao jedan SQL fajl koji vraća svih pet jednim upitom, i kao blok na
   /admin/pregled ako se uklapa bez preprojektovanja tog ekrana. Ako se ne uklapa — samo
   SQL; ne pravi nov admin ekran zbog pet brojeva.

3. Pošto naplata postoji od prvog dana, dodaj i šestu i sedmu brojku: broj plaćenih
   pretplata po planu i broj kupljenih paketa. Oba su jedan `count` nad subscriptions i
   nad credit_ledger — ne uvodi novu tabelu.

Na kraju: pnpm typecheck, pnpm check:sql, pnpm test. Ažuriraj docs/SESIJE.md i štikliraj S25.
```

---

### S26 — Sentry, testovi naplate, sandbox prolaz

**Preduslovi:** S18 i S19 gotovi. **R20** (Sentry projekat i DSN).

```
Radimo S26 iz docs/LANSIRANJE.md — Sentry i testovi naplate. Pročitaj prvo CLAUDE.md,
docs/bezbednost-i-zastita.md (mera P2), docs/LANSIRANJE.md i apps/web/test/ide-odmah.ts.

1. SENTRY — apps/web i apps/worker
   - PII se scrubuje: nikad mejl, telefon, pun kontakt prospekta, nijedan ključ ni token.
     Napiši beforeSend koji to stvarno radi, ne samo podešavanje.
   - webhook naplate i kapije pristupa moraju da budu pokriveni — pad tamo je danas tih,
     jer korisnik misli da je platio i ne žali se
   - DSN iz env-a; odsustvo DSN-a NIJE greška (lokalni razvoj)
   - CSP u next.config.ts: dodaj Sentry host u connect-src, uz komentar sa IZMERENIM
     spiskom (kao za Clerk i Paddle), ne prepisanim iz dokumentacije

2. TESTOVI NAD NOVCEM I PRISTUPOM
   - dupli webhook sa istim event_id → jedna stavka u knjizi
   - povraćaj kad je balans već potrošen → prolazi, ostavlja negativan balans
   - otkazivanje pred kraj perioda → pristup traje do current_period_end
   - apply_subscription i apply_credit_pack sa istim ref_id-om dvaput → jedna dodela
   - potrošnja prazni credits_balance pre credits_topup
   - grace: izvoz prolazi, skeniranje ne
   - zaključan nalog: svaka rutu koja troši kredite vraća odbijenicu

3. Dopuni docs/PROVERA-VIZUELNA.md sekcijom „Naplata — sandbox prolaz" po koracima iz
   docs/LANSIRANJE.md, R26 — tako da postoji jedna lista koju prolazim rukom.

Na kraju: pnpm typecheck, pnpm check:sql, pnpm test, pnpm --filter web lint, pnpm build.
Ažuriraj docs/SESIJE.md i štikliraj S26.
```

---

## 7. Ručni koraci

### Blok 1 — pre S16 ✅ zatvoreno

| # | Korak | Ishod |
|---|---|---|
| **R1** | ✅ **Cena Places poziva potvrđena.** SKU je **Text Search Enterprise** (`E967-44BC-B44D`), jer `FIELD_MASK` traži `nationalPhoneNumber` i `websiteUri`. **$35/1.000 ≈ €0,032 po pozivu, 1.000 besplatnih mesečno.** Ne mešati sa Essentials redovima iz tabele — oni imaju 10.000 besplatnih i drugu cenu. | §1.2 |
| **R2** | ✅ **`PLACES_MONTHLY_BUDGET_EUR = 60`** — tvrda gornja granica. Daje ~2.800 poziva ≈ 930 skeniranja mesečno globalno. | §1.2 |
| **R2a** | ✅ **`RS` override se uklanja** (P7, P9). Jedna cena za sve. **To je izmena u Paddle katalogu — korak R5a.** | §1.3 |

### Blok 2 — pre S18 (~1,5 h)

| # | Korak | Gde |
|---|---|---|
| **R3** | **Paddle API ključ.** Developer tools → Authentication → API keys. Počinje sa `pdl_sdbx_`. U `.env` kao `PADDLE_API_KEY`. | Paddle sandbox |
| **R4** | **Default payment link.** Checkout → Checkout settings → `http://localhost:3000/`. **Bez ovoga svaki `Checkout.open()` pukne sa „Something went wrong".** | Paddle sandbox |
| **R5** | ✅ **Paketi napravljeni** (21.8.). Proizvod „Dopuna kredita" `pro_01m0ffx0dc49v48wt023xz0dzv`; cene `pri_01m0ffx0j4pyxenvfxrjwz55pf` (Dopuna 50, €19) i `pri_01m0ffx0q683zv2z0d7dh0qm3v` (Dopuna 150, €49), obe jednokratne. **Upisane u `lib/cenovnik.ts` kao `PAKETI`.** | ✔ |
| **R5a** | ✅ **`RS` override skinut sa svih šest cena** (21.8.). Provereno: 8 cena u katalogu, **0 override-a**. | ✔ |
| **R6** | ✅ **Kupon napravljen** (21.8.). `BETA2026` — `dsc_01m0fgb2e0ex6dh5g3hba2c1ep`, 33%, `recur: false`, 50 iskorišćenja, ističe 31.12.2026, ograničen na Starter/Pro/Advanced (**ne** na „Dopunu kredita"). **Upisan u `.env` kao `PADDLE_BETA_DISCOUNT_ID`.** | ✔ |

> **Blok 2 je gotov osim R3, R4, R7 i R8** (API ključ, payment link, tunel, destination —
> to su koraci koje ne može da odradi sesija).
>
> Katalog: **8 cena, 0 override-a.** Starter €29/€290, Pro €59/€590, Advanced €119/€1.190,
> Dopuna 50 €19, Dopuna 150 €49 — sve u EUR, isto za svakoga. Kupon `BETA2026` aktivan.
>
> **`.env.example` je dopunjen** sa `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` i
> `PADDLE_BETA_DISCOUNT_ID`; poslednji je već popunjen u `.env`. S18 ih samo čita.
| **R7** | **Tunel.** `brew install hookdeck/hookdeck/hookdeck`, pa `hookdeck listen 3000 paddle-local --path /api/billing/webhook`. Zapiši javni URL. (`ngrok http 3000` radi isto.) | terminal |
| **R8** | **Notification destination.** URL iz R7. **Usage type = „Platform and simulation"** (`traffic_source: all`) — bez toga simulator ne radi. Događaji: `transaction.completed`, `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.past_due`, `adjustment.created`. **Sačuvaj `pdl_ntfset_…` odmah — ne može se pročitati drugi put.** | Paddle sandbox |

### Blok 3 — zaostalo iz ranijih faza, uradi ovih dana (~1 h)

Skupljeno iz pet `‼️ Ručni korak` sekcija razasutih po `docs/SESIJE.md`. **Nijedan nikad
nije potvrđen.**

| # | Korak | Posledica ako fali |
|---|---|---|
| **R9** | **Supabase Storage bucket `feedback`** — Storage → New bucket, **Public = off**, bez ijedne politike | `POST /api/feedback/slika` vraća `502` |
| **R10** | **`ADMIN_BOOTSTRAP_IDS`** — tvoj Clerk ID (`user_…`); `.env` **i** Vercel | `/admin/*` je `404` za sve, i za tebe |
| **R11** | **Clerk webhook: uključi `user.deleted`** — i na dev i na produkcijskom endpointu | brisanje naloga prođe u Clerku, profil ostaje zauvek (krši pravilo 15) |
| **R12** | **Provera da su migracije `0013`–`0021` stvarno puštene** na pravoj bazi | admin konzola pada |
| **R13** | **`CRON_SECRET`** — `openssl rand -base64 32`; `.env` **i** Vercel. **Danas ga nema.** | sve tri `/api/cron/*` vraćaju `404` |
| **R14** | **Resend: verifikuj domen**, popuni `FEEDBACK_EMAIL_FROM` i `FEEDBACK_EMAIL_TO` | pozivnice se naprave ali mejl ne ode |
| **R15** | **Anthropic spend limit** — platform.claude.com → Settings → **Billing → Spend limits** (ne `/settings/limits`) | jedini ključ sa potrošnjom po zahtevu, bez plafona |
| **R16** | **`pnpm install` + `pnpm lint`** na normalnoj mašini posle S15 commita | flat ESLint config nije potvrđen van sandboxa |

### Blok 4 — poresko i pravno, pokreni ODMAH (traje najduže)

| # | Korak | Vreme |
|---|---|---|
| **R17** | **Odluči politiku povraćaja** — rok i uslovi. Paddle sme **sam** da odobri povraćaj u roku od 60 dana i onda kad tvoja politika kaže drugačije; politika mora to da prizna umesto da tvrdi suprotno. Odluči i šta biva sa već potrošenim kreditima. **Ulaz u S22.** | 30 min |
| **R18** | **Pošalji knjigovođi §8 i §9 iz `naplata-paddle.md`.** Zameni „Polar Software Inc., Delaware" sa „Paddle.com Market Ltd." — model je isti (MoR). **Traži pisani odgovor na pitanje 17**: da li te MoR model oslobađa fiskalnog računa kod prodaje domaćim fizičkim licima. Jedino pitanje koje može da obori ceo model. | 1 h + do 2 nedelje |
| **R19** | **Pročitaj i prepravi tekstove iz S22**, popuni sve `<POPUNITI: …>` markere | 1 h |
| **R20** | **Pročitaj i prepravi `docs/landing-kopi.md` iz S23** pre S24 | 1 h |
| **R21** | **Paddle KYC / odobrenje naloga za produkciju.** Traži registrovan biznis i sajt sa vidljivim Uslovima i Politikom povraćaja — dakle **posle S22 i R19**. | 30 min + do 2 nedelje |

### Blok 5 — operativa, pre otvaranja (~4 h)

| # | Korak | Vreme |
|---|---|---|
| **R22** | **Sentry projekat + DSN** (web i worker). Ulaz u S26. | 20 min |
| **R23** | **`podrska@sajtoskop.com`** — napravi adresu i proveri da stiže | 15 min |
| **R24** | **`pnpm check:f4` nad pravom bazom** posle S16 — menjana je novčana putanja (dve kase) | 15 min |
| **R25** | **`scripts/backup.sh` nad pravim `DATABASE_URL`-om**, pa cron na Hetzneru i `rclone` off-site. **Zatim jednom stvarno obnovi bazu iz dumpa** — backup koji nije obnovljen nije backup. | 1 h |
| **R26** | **Sandbox prolaz kroz naplatu — rukom.** Test kartice: `4242 4242 4242 4242` (prolazi), `4000 0038 0000 0446` (3DS), `4000 0000 0000 0002` (odbijena), `4000 0027 6000 3184` (prva prođe, obnova padne). Bilo koje ime, budući datum, CVV `100`. Redom: (1) kupovina plana → plan i krediti; (2) 3DS → isto; (3) odbijena → uredna poruka, ništa; (4) **kupovina paketa bez pretplate** → krediti u `credits_topup`, pristup radi; (5) **kupon na prvoj pretplati** → popust primenjen; (6) kupon na obnovi → **NIJE** primenjen; (7) simulator `subscription_renewal` → krediti obnovljeni jednom, `credits_topup` netaknut; (8) simulator `subscription_cancellation` → pristup do kraja perioda; (9) povraćaj (sandbox auto-odobrava na 10 min) → krediti oduzeti i kad su potrošeni; (10) isti webhook dvaput → jedna stavka. | 2 h |
| **R27** | **Prolaz kroz životni ciklus — rukom.** Testni nalog: otvori betu iz konzole → radi; postavi rok u prošlost → grace baner, izvoz prolazi, skeniranje ne; pomeri rok 31 dan unazad → zaključan, vodi na cenovnik; kupi paket → ponovo pun pristup. | 45 min |
| **R28** | **Puna vizuelna provera** po `docs/PROVERA-VIZUELNA.md` + novi ekrani: `/cenovnik` sa paketima na 390 px, Paddle overlay **u svetloj temi**, `/welcome`, tri pravne strane, landing, blok pretplate na `/krediti`, grace baner, modal. Obe teme svuda. | 2 h |
| **R32** | **Clerk: sign-in i sign-up URL na `/prijava` i `/registracija`.** Radi se **uz S24**, kad `/` postane landing. Dok Clerk pokazuje na `/`, ulogovanje sa landinga vodi u krug. Ovo je jedina izmena van koda koju odluka P5 traži. | 10 min |
| **R29** | **`/api/cron/utisci-slike` rukom** — nije zakazan (Hobby ima dva slota, oba zauzeta): `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://sajtoskop.com/api/cron/utisci-slike` | 2 min |

### Blok 6 — otvaranje

| # | Korak |
|---|---|
| **R30** | **Spisak od 20 imena** za prve beta naloge. Otvori ih iz konzole (50 kredita, rok po P6) i pošalji kupon kod. |
| **R31** | **Pozovi prvih 5, lično.** Gledaj šta rade. Popravi očigledno, pa ostalih 15. **Ne šalji javnu objavu** dok prvih 5 ne prođe kroz alat bez tvoje pomoći. |

---

## 8. Go / no-go pred lansiranje

Prolazi se u jednom sedenju, na **produkciji**, sa čistim nalogom.

### Proizvod
- [ ] Registracija → pretraga po kešu → skeniranje → otključavanje → poruka (Viber i mejl)
- [ ] Prvi otključan prospekt besplatan; knjiga pokazuje `onboarding`
- [ ] Obe teme na svakom ekranu; telefon ≤ 390 px; `.num` na svakom broju
- [ ] Kanarinci u bazi i nevidljivi u izvozu

### Naplata
- [ ] Svih deset koraka iz **R26** prošlo
- [ ] **R27** (životni ciklus) prošao
- [ ] Prelazak na produkciju po §9, **svih pet stavki zajedno**
- [ ] Jedna **prava** kupovina pravom karticom, pa povraćaj — na svom nalogu
- [ ] Otkazivanje kroz portal radi bez ijednog mejla tebi
- [ ] Politika povraćaja objavljena i linkovana

### Pravno
- [ ] Uslovi, Privatnost, Povraćaj objavljeni i linkovani iz futera i iz registracije
- [ ] Nijedan `<POPUNITI: …>` marker nije ostao
- [ ] **Pisani odgovor knjigovođe o fiskalizaciji** (R18) stigao i zaveden
- [ ] Paddle nalog odobren za produkciju (R21)

### Operativa
- [ ] `ADMIN_BOOTSTRAP_IDS`, `CRON_SECRET`, `PLACES_MONTHLY_BUDGET_EUR`, Paddle i Sentry
      promenljive postavljene **na Vercelu**, ne samo lokalno
- [ ] `POLAR_*` uklonjene i iz `.env` i sa Vercela
- [ ] Clerk webhook ima sva tri događaja, uključujući `user.deleted`, na **produkcijskom** endpointu
- [ ] Worker radi na Hetzneru; red poslova se prazni
- [ ] Backup napravljen **i jednom obnovljen** (R25)
- [ ] Sentry hvata web i worker; PII se scrubuje
- [ ] `api_budget` kapovi odgovaraju budžetu iz R2 (~2.800 mesečno, ~140 dnevno)
- [ ] Clerk sign-in / sign-up URL pokazuju na `/prijava` i `/registracija` (R32)
- [ ] `/` je landing, a ne ekran za prijavu — i za ulogovanog i za gosta

---

## 9. Prelazak sandbox → produkcija

Sandbox i produkcija su **odvojeni nalozi**: proizvodi, cene, popusti, kupci, ključevi i
webhook destinacije se ne dele. `pri_` i `dsc_` ID iz jednog ne postoje u drugom.

Posao je upola manji nego što je bio pre odluke P7: **8 cena umesto 8 cena + 8 override-a**.

**Menja se svih pet stavki odjednom.** Nesparen par ne puca nego tiho otvori checkout ka
drugom nalogu — a to se ne primeti dok neko ne plati.

| # | Šta | Gde |
|---|---|---|
| 1 | Ponovo napravi katalog: **3 proizvoda + 6 cena + 2 paketa + kupon**. Bez ijednog override-a — jedna cena za sve (P7). | Paddle live |
| 2 | Prepiši svih osam `pri_` ID-jeva i `dsc_` ID | `lib/cenovnik.ts`, `plans.ts`, env |
| 3 | Nov klijentski token (`live_…`) | `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` |
| 4 | `NEXT_PUBLIC_PADDLE_ENV=production` | Vercel env |
| 5 | Nov API ključ (`pdl_live_…`) i **nova** webhook tajna uz nov destination na pravom URL-u | `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` |

Uz to, dve stvari kojih u sandboxu nije bilo:

- **Default payment link mora biti verifikovan, odobren domen.** `localhost` tamo obara naplatu.
- **Sajt mora da prođe Paddle odobrenje** — traže vidljive Uslove i Politiku povraćaja.

`lib/paddle-okruzenje.ts` već poredi prefiks tokena sa okruženjem i baca kad se ne poklapaju.
Ta provera **ne hvata** stare `pri_` ID-jeve — njih hvata samo to što `PricePreview` vrati
„price not found". **Otvori `/cenovnik` odmah posle prelaska.**

---

## 10. Prvo posle lansiranja

Ne radi se pre, ali je zapisano da se ne izgubi:

1. **Cena skeniranja po dubini** — 1/2/3 kredita za 20/40/60 prospekata (§1.2). Poklapa se
   sa Places paginacijom jedan na jedan i čini cenu jednakom trošku.
2. **Mejlovi o isteku** — „beta ti ističe za 7 dana", „pristup ističe za 7 dana",
   „pretplata nije naplaćena". Infrastruktura postoji (Resend, `lib/mail.ts`).
3. **Domaći tok naplate** (IPS QR, ručni račun za firme sa PIB-om) — `naplata-bez-firme.md`
   §5, 2–3 dana. Radi se **tek ako** knjigovođa iz R18 potvrdi da je potreban, ili kad se
   javi prvi kupac sa PIB-om.
4. **Podizanje `PLACES_MONTHLY_BUDGET_EUR`** kako raste broj pretplatnika. Ulazi u nedeljnu
   rutinu iz `ROADMAP.md` Faze G: pogledaj `api_budget` tempo naspram broja aktivnih
   pretplata. Odbijeno skeniranje plaćenom korisniku je skuplje od svakog Places računa.
5. **Region, feedback loop, radar, PDF izveštaj, timovi** — `ROADMAP.md` Faze D i E.

---

## 11. Dnevnik izmena

| Datum | Izmena |
|---|---|
| 2026-08-20 | Prva verzija. |
| 2026-08-20 | **S17 isporučen — cena skeniranja je 1 kredit po stranici.** Migracija `0023`: `search_cache.pages` (1–3, backfill iz `last_results_count`), dubina u ključu deduplikacije (`RS:grad:nisa:p2`), cena izvedena iz stranica i merena nad zbirom obe kase, `refund_scan` vraća tačan iznos iz knjige. `SCAN_CREDIT_COST` obrisan; zamenili su ga `Dubina` (zatvoren skup za UI i URL) i `cenaSkeniranja()` (totalna funkcija za worker, CLI i SQL). `PLACES_PAGE_SIZE`/`PLACES_MAX_PAGES` preseljeni iz `places.ts` u `plans.ts`. Nov razlog naplate `plice` — svež ali plitak keš. **Nijedna funkcija ne menja povratni tip**, jer bi drugi prolaz `check:sql` pukao; dubina se čita iz kolone, kao `partial` u 0021. `searchText` staje na plaćenom broju stranica — dotad je umeo da povuče stranicu preko plaćene. |
| 2026-08-21 | **Dokument očišćen od zaostalih „otvoreno" oznaka.** §4 preimenovan u „Pitanja — sva zatvorena"; zaglavlje kaže da S16 nema preduslova; `P6` skinut sa preduslova S20; `N10` prepravljen (paketi POSTOJE u katalogu i kodu, fali im samo ekran); dodat `N11` (`SCAN_CREDIT_COST` je i dalje 1, menja se u S17); mapa isporuka razdvaja odrađene ručne korake od preostalih. |
| 2026-08-21 | **Kupon `BETA2026` napravljen** (`dsc_01m0fgb2e0ex6dh5g3hba2c1ep`) i upisan u `.env`. **Pogodnosti u `cenovnik.ts` usklađene** sa tabelom §1.3: šest istih stavki po kartici, „AI poruke po kanalu" zamenjeno dnevnim brojem AI varijanti, Advanced 800 kredita i 10.000 CSV redova. Lede na `/cenovnik` prepravljen — kredit je sada prospekt ILI stranica skeniranja. **S16 više ne dira `SCAN_CREDIT_COST`** (ostaje 1 do S17), jer UI na ~10 mesta tvrdo piše „1 kredit". |
| 2026-08-21 | **Paddle sandbox katalog dovršen iz sesije.** `RS` override skinut sa svih šest cena; napravljen proizvod „Dopuna kredita" sa dve jednokratne cene (€19 / €49); svih 8 `pri_` ID-jeva upisano u `lib/cenovnik.ts`; `.env.example` dopunjen sa tri serverske Paddle promenljive. **Kupon `BETA2026` ostaje ručno** — MCP ključ nema `discount.write` (korak R6). |
| 2026-08-21 | **Zatvorena pitanja P7–P9.** `RS` override se **uklanja u celosti** — nije bio dinarska cena nego sniženi EUR iznos, ostatak napuštenog RSD pokušaja; jedna cena svuda, margina raste sa 30–56% na 11–22% najgoreg slučaja. **Cena skeniranja po dubini ulazi pre lansiranja** kao nova sesija **S17** (1 kredit = 1 stranica = 1 Places poziv); time **`scansPerMonth` ispada iz modela** — kredit je sada ograničenje. Sesije S17–S25 renumerisane u S18–S26. Kupon važi do 31.12.2026. |
| 2026-08-20 | **Zatvorena pitanja P1–P6.** Places SKU potvrđen kao Text Search **Enterprise** ($35/1.000, 1.000 besplatnih — ne Essentials sa 10.000); budžet €60; kupon 33% jednokratno; cene potvrđene; landing ide u **istu aplikaciju** na `/`, bez `app.` subdomena; beta 30 dana. Uveden **`scansPerMonth`** kao četvrta poluga po planu — skeniranje je 4,8× skuplje od otključavanja a košta 2× više kredita, pa ne sme da zavisi samo od novčanika. Otvoreno: P7 (RS cena Advanced), P8 (rok kupona), P9 (RS cene paketa). |
| 2026-08-20 | **Prepisano po odlukama D1–D6.** Naplata od prvog dana; beta kao ručni izuzetak sa rokom; tri plana + dva paketa kredita; dve kase kredita; šest stanja pristupa sa grace periodom od 30 dana; kupon za betu; globalni Places kapovi vezani za budžet iz env-a. Sesija sa 8 na 10 (S16–S26), ručnih koraka sa 28 na 31. |
