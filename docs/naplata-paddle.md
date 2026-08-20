# Naplata preko merchant-of-record platforme — izveštaj, rizici i pitanja za knjigovođu

> ## Šta se promenilo prelaskom na Paddle
>
> **Ovaj dokument je pisan za Polar. Polar je napušten; naplata ide preko Paddle-a.**
> Preimenovan je iz `naplata-polar.md` u S16 (21. avgust 2026).
>
> **Šta i dalje važi doslovno, bez ijedne ograde:** ceo model *merchant of record*
> (§1), provera „može li uopšte iz Srbije" po tačkama (§2), sve o knjigovodstvu,
> fiskalizaciji i PDV-u (§4, §8, §9), i — najvažnije za kod — **§5.3, pet pravila
> idempotencije**. Paddle ponavlja isporuku webhooka na svaki non-2xx i na mrežni
> timeout, isto kao Polar; `billing_events` po ID-u događaja i `ref_id` u
> `credit_ledger` postoje baš zbog toga (migracija 0022).
>
> **Šta čitaj kao „provajder", a ne kao „Polar":** imena događaja u §5.3 i cene u
> §3 su Polarova. Paddle ima svoja imena (`transaction.completed`,
> `subscription.updated`, `subscription.canceled`…) i svoju naknadu; tačna
> preslikavanja su u `docs/LANSIRANJE.md` S18.
>
> **Šta više ne stoji — cena u dinarima.** §3.2 računa cenu od 3.990 RSD.
> **Paddle podržava 33 valute i RSD nije među njima.** Prvi pokušaj da se to
> zaobiđe bio je `unit_price_overrides` za zemlju `RS` — ne dinarska cena, nego
> **niži iznos u evrima** za kupce iz Srbije (€14 umesto €29 na Starteru).
>
> **Taj override je uklonjen u celosti** (odluka P7, `docs/LANSIRANJE.md` §1.3):
> **jedna EUR cena za ceo svet**, €29 / €59 / €119 mesečno. Tri razloga: override
> je bio upola jeftiniji od sopstvene ranije odluke iz `LANSIRANJE-PITANJA.md` #8
> (3.400 RSD ≈ €29), obarao je maržu u najgorem slučaju sa 11–22% na 30–56%, i
> udvostručavao je broj stavki koje se prepisuju iz sandboxa u produkciju.
> Reverzibilno je: override se vraća **jednim poljem na ceni** u Paddle panelu,
> bez migracije, bez izmene koda i bez deploya — ali tek sa podacima iz bete,
> a ne sa pretpostavkom.
>
> **Šta je otpalo kao pitanje:** §13 (odluke o paketima i kreditima) je
> zamenjen `docs/LANSIRANJE.md` §1.3 i §1.4 — tri plana, dva paketa, dve kase
> kredita. §10 (pitanja za Polar support) više nema kome da se pošalje.


**Status dokumenta:** analiza pre odluke, ne PRD. Ništa se ne implementira dok se ne završi
razgovor sa knjigovođom i dok ne stigne odgovor Polar supporta na pitanja iz §10.

**Kontekst:** Marko Milenković, paušalac u Srbiji (šifra 63.12). Sajtoskop je u besplatnoj beti.
Odluka o naplati se po `docs/ROADMAP.md` (Faza C) donosi 30 dana posle otvaranja bete.
Ovaj dokument priprema **jednu od dve moguće šine** te odluke — kartičnu naplatu preko
merchant-of-record platforme.

**Ispravka postojeće dokumentacije:** `docs/naplata-bez-firme.md` §2 navodi Polar sa ❌ uz
obrazloženje „Stripe-backed, Srbija nije na Stripe Connect listi". **To više ne stoji.**
Srbija je danas na Polarovoj zvaničnoj listi zemalja za isplate (Stripe Connect **Express**,
što je drugi proizvod od običnog Stripe Payments-a i pokriva znatno više zemalja).
Tu tabelu treba ispraviti da se za pola godine ne bi ponovo odlučivalo po pogrešnom podatku.

---

## 0. Rezime za nestrpljive

1. **Polar tehnički radi iz Srbije.** Srbija je na listi podržanih zemalja za isplate.
   Nije potrebna strana firma, nije potreban US LLC, nije potreban PayPal.
2. **Polar je merchant of record (MoR), a ne payment gateway.** To nije tehnički detalj nego
   pravna činjenica koja menja sve u knjigovodstvu: kupcu prodaje **Polar**, a ja prodajem
   **Polaru**. Sav moj prihod formalno dolazi od jednog američkog pravnog lica.
3. **Stvarna cena je ~8–9%**, ne 5%. Headline je 5% + 50¢, ali se na sve non-US kartice
   dodaje 1,5%, pa idu naknade za isplatu.
4. **RSD radi — cena kupcu ide u dinarima.** Ranija verzija ovog dokumenta je tvrdila
   suprotno, po objavi o deset valuta; dokumentacija danas navodi **130+ valuta za cene
   proizvoda**, a dinar je potvrđen i u samom panelu (`RSD 3400` kao fiksna mesečna cena).
   Time otpada friction oko konverzije na strani kupca i cena se prikazuje onako kako
   domaći kupac misli. Ostaje jedno ograničenje koje nema veze sa valutom: **DinaCard
   kartica ne prolazi**, jer je to pitanje kartične mreže, ne dinara.
5. **Polar nije registrovan za PDV u Srbiji.** Poreske registracije ima u SAD, EU (irski OSS)
   i Velikoj Britaniji. Prodaja srpskom kupcu preko Polara je pravno prodaja američke firme
   srpskom kupcu, van srpskog PDV sistema — i to je pitanje za knjigovođu, ne za mene.
6. **Kupci su većinski fizička lica (B2C), ne firme.** To menja težište celog dokumenta:
   prodaja usluga fizičkim licima u Srbiji je **promet na malo** i povlači obavezu
   **fiskalnog računa** — i kod prodaje preko interneta. Ako prodajem sam, ta obaveza je moja.
   Ako prodaje Polar kao merchant of record, po logici modela nije — ali to mora da potvrdi
   knjigovođa. Vidi §4.
7. **Zaključak koji predlažem:** kod B2C-a Polar je **jači kandidat nego što je delovao** —
   fizičkom licu treba kartica, a ne virman, i ne treba mu račun za knjiženje. Domaći IPS tok
   ostaje kao dopuna za one koji neće karticom, ali on nosi fiskalizaciju koju Polar možda ne nosi.
8. **Najozbiljnije otvoreno pitanje nije tehničko** nego poresko: 100% prihoda formalno od
   jednog stranog nalogodavca i test samostalnosti (§9, pitanje F).

---

## 1. Šta je Polar i šta znači „merchant of record"

Polar (`polar.sh`) je platforma za naplatu softvera, otvorenog koda, orijentisana na indie
developere i SaaS. Pravno lice je **Polar Software Inc.**, američka kompanija (Delaware C Corp).

Razlika koja je bitna:

| | Payment gateway (npr. Stripe direktno) | Merchant of record (Polar, Paddle, Lemon Squeezy) |
|---|---|---|
| Ko prodaje kupcu | **ja** | **Polar** |
| Ko izdaje račun kupcu | ja | Polar |
| Ko je odgovoran za PDV/sales tax | ja, u svakoj zemlji kupca | Polar, u zemljama u kojima je registrovan |
| Šta se vidi na izvodu kupca | moje ime | Polar |
| Šta je moj prihod | plaćanje svakog kupca posebno | **jedna zbirna uplata od Polara** |
| Ko snosi rizik chargebacka | ja | Polar (uz naknadu koju prebacuje na mene) |

MoR model postoji zbog PDV-a na digitalne usluge: da bih ja sam prodavao u EU, morao bih
OSS registraciju ili registraciju po zemljama. Polar to radi umesto mene i naplaćuje proviziju.

**Praktična posledica za mene:** ja nisam prodavac krajnjem korisniku. Ja sam dobavljač Polaru.
Sve što piše u nastavku o knjigovodstvu izlazi iz te jedne rečenice.

---

## 2. Može li uopšte iz Srbije — provera po tačkama

| Provera | Odgovor | Napomena |
|---|---|---|
| Srbija na listi zemalja za isplate | **da** | Lista ima 130+ zemalja, Srbija je na njoj. Mehanizam je Stripe Connect Express, ne Stripe Payments. |
| Treba li firma | **ne** | Prima i fizička lica i registrovane subjekte. Paušalac se prijavljuje kao registrovan preduzetnik — to je i tačnije i lakše za KYC. |
| KYC provera | ima je | Standardna MoR/KYC provera naloga, rok reda veličine nedelju dana. Traže lične podatke, dokument, podatke o delatnosti i sajt. |
| Poreski formular | verovatno W-8BEN/W-8BEN-E | Polar je američka firma; Stripe u onboardingu traži izjavu o ne-američkom statusu. **Potvrditi u onboardingu.** |
| Valuta cene | **130+ valuta, uključujući RSD** | Potvrđeno u panelu. Više valuta po proizvodu; valuta se bira po geolokaciji kupca, uz pad na podrazumevanu valutu organizacije. Domaća cena ide u dinarima, strana u evrima. |
| Valuta isplate | **RSD, na domaći dinarski račun** | Potvrđeno posredno: `RSD` stoji u Polarovoj tabeli minimalnih iznosa. Stripe Connect po pravilu traži račun u zemlji subjekta i u lokalnoj valuti. |
| Konverzija | **otvoreno pitanje** | Ako je i cena i isplata u dinarima, konverzije ne bi trebalo da bude. Ali dokumentacija ne opisuje u kojoj se valuti drži balans — ako je u dolarima, RSD prodaja se konvertuje dvaput. Pitanje 11 u §10. |
| Minimalni iznos isplate | **40 USD u protivvrednosti za RSD** | Četiri puta viši od minimuma za USD (10) i tri puta od EUR (13). Na malom obimu novac duže stoji na balansu. |
| Kada je novac raspoloživ | **7 dana** od transakcije | Za naloge otvorene posle 12. maja 2026. Stariji nalozi imaju trenutnu isplatu. Moj nalog bi bio novi. |
| Kako se isplaćuje | **ručno**, na moje pokretanje | Polar namerno ne prazni balans automatski, jer svaka isplata ima fiksni trošak. |
| Koliko traje isplata | obrada do 24h, dolazak 4–7 radnih dana | Realno: novac zarađen 1. u mesecu je na računu oko 12–15. |
| KYC provera | **do 14 dana** | Tri koraka: podaci o poslovanju, provera identiteta preko Stripe Identity (dokument + selfi), povezivanje računa za isplatu. |
| Dokument za knjigovodstvo | **„reverse invoice"** iz panela | Samofakturisanje. Podesivi su naziv, adresa, dodatno polje (tu ide PIB) i sopstvena numeracija umesto `POLAR-0001`. **Jednom generisan dokument se više ne menja** — podaci se podešavaju pre prve isplate. |

---

## 3. Prava cena, a ne headline cena

### 3.1 Cenovnik (aktuelan)

| Plan | Provizija | Mesečna pretplata |
|---|---|---|
| Starter (besplatan) | **5% + 50¢** | 0 |
| Pro | 3,8% + 40¢ | 20 USD |
| Growth | 3,6% + 35¢ | 100 USD |
| Scale | 3,4% + 30¢ | 400 USD |
| *Early Member* | *4% + 40¢ (+0,5% na pretplate)* | *0* |

**Early Member se mene ne tiče.** Ta stopa je zamrznuta samo za organizacije otvorene
**pre 27. maja 2026** i gubi se čim se pređe na plaćeni plan. Ja bih otvarao nalog sada,
dakle **5% + 50¢**.

Pored toga, na sve planove:

- **+1,5% za međunarodne (non-US) kartice.** Srpska kartica je non-US. Praktično: ovo nije
  izuzetak nego moj **default**. Realna stopa je **6,5% + 50¢**.
- **15 USD po sporu (chargeback)**, bez obzira na ishod.
- **2 USD mesečno** u svakom mesecu u kom se radi isplata.
- **0,25% + 0,25 USD po isplati.**
- **Konverzija valute 0,25% (EU) do 1% (ostatak)** — Srbija nije EU. **Ako i cena i isplata
  idu u dinarima, ove konverzije ne bi trebalo da bude**; vidi otvoreno pitanje u §2.
- Uslovi sadrže i otvorenu klauzulu o budućim naknadama.

### 3.2 Računica, sa cenom u dinarima

Pretpostavke: 1 USD ≈ 108 RSD, 1 EUR ≈ 117 RSD, jedna isplata mesečno, konverzija 0 na
dinarskoj prodaji. **Starter je 3.400 RSD mesečno sa 150 kredita** — to je odlučeno; ostale
cene u tabeli su i dalje ilustrativne.

| Proizvod | Cena | Provizija (6,5% + 50¢) | Isplata | **Ukupno** | Ostaje |
|---|---|---|---|---|---|
| Mesečna pretplata | 3.400 RSD | 275 RSD | ~9 RSD | **~8,4%** | 3.116 RSD |
| Godišnja pretplata | 29.900 RSD | 1.998 RSD | ~75 RSD | **~6,9%** | 27.827 RSD |
| Paket kredita | 2.900 RSD | 243 RSD | ~7 RSD | **~8,6%** | 2.650 RSD |
| Strani kupac, mesečno | €19 | €1,70 | ~€0,21 | **~10,0%** | €17,09 |

Poređenja radi, iz `naplata-bez-firme.md`: Lemon Squeezy preko PayPala izlazi ~9,5%,
**domaći IPS QR / virman izlazi 0%.**

**Ako se ispostavi da se balans drži u dolarima**, dinarska prodaja se konvertuje dvaput i
svaki red gore raste za do 1% — na mesečnoj pretplati ~34 RSD. Zato je to pitanje 11 za
Polar, a ne fusnota.

### 3.3 Dve stvari koje se vide tek iz računice

1. **Fiksnih 50¢ ubija male i česte transakcije.** Na €19 mesečno fiksni deo je 2,4% sam za sebe.
   Godišnja pretplata plaća fiksni deo jednom umesto dvanaest puta — to je isti zaključak
   do koga je `naplata-bez-firme.md` došao iz drugog razloga (nema recurring u dinarima).
   **Godišnja pretplata je jeftinija i na Polaru, ne samo na virmanu.**
2. **Pro plan (20 USD) se isplati oko 60 transakcija mesečno.** Razlika Starter → Pro je
   1,2% + 10¢ po transakciji; na pretplati od €19 to je ~€0,32 ušteđenih po transakciji,
   pa se 20 USD vraća na ~58–60 plaćanja mesečno (~€1.100 prometa). Do tada Starter.

---

## 4. Kupac je fizičko lice — šta to menja

**Profil kupca:** većinski **B2C** — frilenseri, dizajneri i mladi ljudi koji rade outreach,
uglavnom neregistrovani ili registrovani ali bez potrebe za računom. Manjina su firme sa PIB-om.
Ova sekcija je zbog toga prepisana; ranija verzija je pretpostavljala B2B i vodila u pogrešan
zaključak.

### 4.1 Šta B2C znači u korist Polara

- **Fizičko lice hoće da plati karticom, odmah.** Virman i IPS QR traže od njega da otvori
  m-banking, prepiše poziv na broj i sačeka da ja ujutru pogledam izvod. Kod pretplate od
  20-ak evra to je ubica konverzije. Kartica radi u tri klika, u dva ujutru, bez mog učešća.
- **Ne treba mu račun.** Neregistrovano fizičko lice nema šta da knjiži, pa mu je nebitno
  što račun izdaje američka firma na engleskom.
- **Nema poreza po odbitku ni internog PDV-a.** Te obaveze imaju pravna lica i preduzetnici
  koji vode knjige, ne fizička lica. Cela §4.2 iz prve verzije ovog dokumenta se odnosi
  na manjinu mojih kupaca.
- **Otkazivanje pretplate rešava Polarov portal**, ne ja mejlom. Kod B2C-a se to dešava
  često i mora da bude samouslužno, inače postaje moj posao.

### 4.2 Šta B2C znači na štetu Polara

- **DinaCard-only kartica ne prolazi.** Kod B2C-a je ovo teže nego kod firmi — mlad frilenser
  često ima baš tu karticu iz banke, bez Visa/Mastercard opcije za plaćanje u inostranstvu.
- ~~Naplata je u evrima.~~ **Otpada** — cena ide u dinarima (§0, tačka 4). Fizičko lice
  vidi „3.400 RSD mesečno" i to je iznos koji mu banka i naplati. Ostaje samo da se u UI-u
  ne pominju evri tamo gde kupac vidi dinare.
- **Plaćanje je i dalje prekogranično**, iako je iznos u dinarima — na izvodu kupca stoji
  strana firma. Neke banke na to lepe naknadu za plaćanje u inostranstvu. Vredi proveriti
  na sopstvenoj kartici pre lansiranja.
- **Povraćaji su češći nego u B2B-u**, a chargeback košta 15 USD po sporu bez obzira na ishod.
  Politika povraćaja mora da bude napisana pre prve prodaje, ne posle prve reklamacije.

### 4.3 Fiskalizacija — pitanje koje sada postaje glavno

Prodaja usluge **fizičkom licu** u Srbiji je **promet na malo**, a promet na malo se
evidentira preko elektronskog fiskalnog uređaja. To važi i za prodaju **preko interneta**;
sedište obveznika se tada tretira kao maloprodajni objekat. Način plaćanja (kartica, instant,
uplata na račun) po važećem zakonu **ne oslobađa** obaveze — oslobođenja postoje samo za
delatnosti navedene u posebnoj uredbi, čija je lista sužena.

Iz toga slede dva scenarija koja se **poreski razlikuju**, iako korisniku izgledaju isto:

| | Prodajem ja, direktno (IPS QR, račun u RSD) | Prodaje Polar kao merchant of record |
|---|---|---|
| Ko je prodavac kupcu | ja | Polar Software Inc. |
| Promet na malo u Srbiji | **da** | ne — moj promet je izvoz usluge jednom stranom pravnom licu |
| Fiskalni račun (ESIR/LPFR) | **verovatno obavezan** | po logici modela nije moja obaveza |
| Provizija | 0% | ~9% |
| Konverzija kupca | slaba (virman) | dobra (kartica) |

**Ovo je najveći argument za Polar koji sam do sada našao, i mora se proveriti pre svega
ostalog.** Ako je za direktnu prodaju domaćim fizičkim licima potreban fiskalni uređaj,
onda „0% provizije" na IPS QR-u nije 0% — to je 0% plus fiskalizacija, plus ESIR, plus
mesečna obaveza, plus ja kao operater kase. A ~9% proviziji tada plaćam da taj ceo sloj
ne postoji.

**Oprez:** i dalje kruži tumačenje da bezgotovinsko plaćanje na tekući račun oslobađa
fiskalizacije. To je pravilo starog zakona i **ne treba ga uzimati zdravo za gotovo.**
Zato je to pitanje 17 u §9, i zato mi treba pisani odgovor knjigovođe, ne usmena procena.

### 4.4 Manjina: kupac sa PIB-om

Za kupca koji jeste firma ili preduzetnik u PDV-u, prethodna verzija ovog dokumenta i dalje
važi: plaćanje američkoj firmi povlači **interni obračun PDV-a** i potencijalno **porez po
odbitku od 20%** (softverska licenca kao autorska naknada; Srbija nema ugovor sa SAD, pa nema
umanjenja stope). Takvom kupcu je domaći račun u dinarima jeftiniji i čistiji.

Pošto je to manjina, ne gradi se ceo drugi tok zbog njih — **domaći račun se izdaje ručno,
na zahtev.** Nekoliko računa mesečno ne traži nikakvu automatizaciju.

### 4.5 Arhitektura koja iz ovoga sledi

```
   Fizičko lice, domaće   ──► Polar checkout, RSD ──┐
   (većina kupaca)            kartica, samouslužno  │
                                                    ├─► Polar balans ──► dinarski račun
   Strani kupac           ──► Polar checkout, EUR ──┘     ~8-10% all-in

   Firma sa PIB-om        ──► ručno: domaći račun u RSD + IPS QR ──► poslovni račun
   (manjina, na zahtev)       0% provizije, bez poreza po odbitku kod kupca

   DinaCard-only kupac    ──► isto: IPS QR na zahtev, ručna aktivacija
```

Razlika u odnosu na `naplata-bez-firme.md` §4: tamo je domaći tok bio **glavni**, a strani
dopunski. Kod B2C profila je **obrnuto** — Polar je glavni tok, a domaći račun je izlaz za
manjinu (firme, DinaCard, ko izričito traži dinarsku uplatu).

---

## 5. Šta se menja u kodu

### 5.1 Šta ostaje netaknuto — i to je namerno

**Krediti ostaju u bazi. Polar ih ne dodiruje.**

Polar ima „credits & meters" (usage-based billing sa prepaid balansom) i deluje kao da bi
mogao da zameni `credit_ledger`. **Ne treba to raditi**, iz tri razloga:

1. Pravilo 3 i 6 iz `CLAUDE.md`: krediti se menjaju isključivo kroz `spend_credit_and_unlock`,
   `spend_credit_and_scan` i `grant_credits`. To su atomske SQL funkcije sa `FOR UPDATE`.
   Polarov meter je mrežni poziv sa eventual consistency na hot putanji otključavanja.
2. Test iz F4 §7 („20 paralelnih unlockova sa 1 kreditom → tačno jedan uspeh") ne može da
   se održi ako stanje kredita živi kod eksternog provajdera.
3. Vezivanje za provajdera. Ako se za godinu dana pređe na Stripe ili na domaći tok,
   `credit_ledger` ne sme da bude taj koji se seli.

**Polar je isključivo naplata. Krediti su i dalje moja baza.** Webhook koji stigne posle
uspešnog plaćanja poziva `grant_credits` i tu se njegova uloga završava.

### 5.2 Šta se dodaje

| Fajl / objekat | Izmena |
|---|---|
| `packages/shared/src/plans.ts` | `PlanId` sa `beta` raste na `beta \| starter \| pro \| agencija`; svaki plan dobija `monthlyCredits`, `cacheMissPerDay`, `exportPerDay` i **`polarProductId`** |
| `packages/shared/src/billing.ts` | `PolarProvider implements BillingProvider` pored postojećeg `FreeBetaProvider`; `billingProvider()` bira po env-u. Interfejs se ne menja — zato i postoji. |
| `apps/web/src/app/api/billing/checkout/route.ts` | kreira checkout sesiju, `user_id` isključivo iz Clerk sesije (pravilo 8) |
| `apps/web/src/app/api/billing/webhook/route.ts` | verifikacija potpisa, idempotencija, mapiranje događaja → RPC |
| `apps/web/src/app/api/billing/portal/route.ts` | redirekcija na Polarov customer portal (otkazivanje, kartica, računi — sve njihovo, ništa moje) |
| nova migracija | `billing_events` (idempotencija), `subscriptions`, kolone `profiles.polar_customer_id` i `profiles.plan_expires_at` |
| migracija za `grant_credits` | novi razlozi u `check` ograničenju: `subscription_grant`, `credit_pack`. Pravilo 3: menja se i ograničenje i telo funkcije. |

### 5.3 Događaji i pravila

Orijentaciono — tačna imena potvrditi u dokumentaciji pre implementacije:

| Događaj | Radnja |
|---|---|
| `order.paid` | jednokratna kupovina (paket kredita, lifetime) → `grant_credits(reason: 'credit_pack')` |
| `subscription.created` / `subscription.active` | `profiles.plan` = novi plan, prvi grant |
| `subscription.updated` | promena plana; `plan_expires_at` iz `current_period_end` |
| `subscription.canceled` | **ne gasi pristup odmah** — pristup traje do kraja plaćenog perioda |
| `subscription.revoked` | pad na `beta`/besplatno |
| `order.refunded` / `refund.created` | oduzimanje kredita kroz **`admin_adjust_credits`** — jedini omotač koji sme negativan iznos (migracija 0012) |
| `customer.state_changed` | zbirno stanje kupca; korisno kao „istina" pri neslaganju |

Pet pravila koja se ne pregovaraju:

1. **Idempotencija.** Svaki webhook se prvo upiše u `billing_events` po ID-u događaja.
   Duplikat se preskače. Bez ovoga se krediti dodeljuju dvaput.
2. **Vezivanje po `externalCustomerId` = Clerk `user_id`**, nikad po mejlu. Kupac često plati
   sa drugog mejla nego što se registrovao. Ovo je ista zamka opisana u
   `naplata-bez-firme.md` §6.
3. **Potpis webhooka se verifikuje uvek**, i u sandboxu. Neverifikovan webhook je javni
   endpoint koji deli kredite.
4. **`user_id` nikad iz body-ja.** Pravilo 8. Checkout se kreira na serveru iz Clerk sesije.
5. **Mesečni grant kredita ostaje idempotentan po mesecu** (`creditMonth()` iz `plans.ts`),
   bez obzira na to da li ga pokreće cron ili webhook.

### 5.4 Procena posla

| Deo | Procena |
|---|---|
| `PolarProvider`, checkout, portal | 0,5 dana |
| Webhook + idempotencija + migracija | 1 dan |
| UI: ekran planova, stanje pretplate, poruke o isteku | 1 dan |
| Testovi (dupli webhook, refund, otkazivanje pred kraj perioda) | 0,5 dana |
| Sandbox prolaz kroz sve događaje | 0,5 dana |
| **Ukupno** | **~3,5 dana** |

Domaći tok (IPS QR, `invoices`, admin označavanje plaćenog) je **odvojenih 2–3 dana** i opisan
je u `naplata-bez-firme.md` §5. Ta procena i dalje važi.

---

## 6. Rizici

| Rizik | Ozbiljnost | Šta radim |
|---|---|---|
| **Polar može da blokira plaćanja iz zemalja u kojima nije poreski registrovan.** To piše u njihovoj poreskoj politici. Srbija nije među njihovim registracijama. | **visok** — sruši ceo domaći kartični tok | Pitanje 1 za Polar support (§10). Domaći tok preko IPS-a je ionako plan A za srpske firme, pa ovo nije fatalno — ali mora se znati unapred. |
| **Cena je već rasla** (4% + 40¢ → 5% + 50¢ u maju 2026) i uslovi sadrže klauzulu o budućim naknadama | srednji | `BillingProvider` apstrakcija; nikad ne dozvoliti da se Polar ugradi dublje od naplate |
| 7 dana settlement + ručna isplata + minimum + 4–7 dana transfer | nizak, ali stvaran za cash flow | Realno: novac stiže ~2 nedelje posle prodaje |
| Chargeback 15 USD | nizak | Jasna politika povraćaja i vidljivo otkazivanje u portalu smanjuju sporove |
| **Polar sme sam da odobri povraćaj** u roku od 60 dana, i to i kad moja politika kaže „bez povraćaja" — radi izbegavanja chargebacka | **srednji do visok** | Krediti su do tada verovatno potrošeni. `admin_adjust_credits` na negativan iznos mora da podnese i negativan balans, a politika povraćaja mora da bude napisana pre prve prodaje |
| **Provizija se ne vraća pri povraćaju.** Vraćen €19 me košta ~€1,70 | srednji | Ugrađeno u cenu; kod paketa kredita razmisliti o manjim paketima |
| Povraćaj **ne otkazuje pretplatu** automatski | nizak, ali tih | Webhook `refund.created` i otkazivanje su dva odvojena toka; oba se moraju obraditi |
| **Zavisnost od Stripe Connect Express za Srbiju** — Polar je tu samo posrednik | srednji | Ako Stripe promeni listu, Polar to ne može da reši. Domaći tok je hedž. |
| Polar je mlada kompanija, a moj balans stoji kod nje | srednji | Isplaćivati često čim se pređe minimum; ne držati veliki balans preko kraja godine (i zbog §9, pitanje D) |
| Poreska prekvalifikacija zbog jednog stranog nalogodavca | **visok** | §9, pitanje F — bez odgovora knjigovođe ne idem dalje |

---

## 7. Alternative, ukratko

| Opcija | Kada je bolja od Polara |
|---|---|
| **Domaći račun + IPS QR** | **uvek za srpsku firmu sa PIB-om.** 0% provizije, čist papir, bez poreza po odbitku kod kupca |
| Lemon Squeezy | ne — Stripe ju je kupio 2024, gradi se migracija ka Stripe Managed Payments |
| Paddle | ako zatreba ozbiljan subscription engine (proration, dunning, seats); stroža provera, traže registrovan biznis |
| Dodo Payments | ako Polar odbije nalog ili blokira srpske kupce; grade se eksplicitno za non-Stripe tržišta |
| Creem | najjeftiniji flat MoR; proveriti listu zemalja |
| Strana firma + Stripe | kada godišnja razlika u proviziji pređe ~€700, tj. na ~€10.000 godišnjeg prometa |

Prelomna tačka iz `naplata-bez-firme.md` §7 se ne menja: **~€10.000 godišnjeg prometa**
je granica na kojoj strana firma počinje da se isplati.

---

## 8. Za knjigovođu — činjenice koje mora da zna pre pitanja

> Ovaj deo je napisan tako da može da se pošalje knjigovođi kao takav.

**Šta radim:** imam veb aplikaciju (SaaS) koju prodajem kao mesečnu/godišnju pretplatu i kao
pakete kredita. Iznosi su mali, reda 3.000–30.000 RSD po transakciji.

**Ko su kupci:** **većinski fizička lica** — frilenseri i dizajneri, uglavnom neregistrovani
ili registrovani ali bez potrebe za računom. Manjina su firme sa PIB-om. Kupci su domaći
i strani, sa težištem na domaćem tržištu.

**Kako bi tekao novac ako uzmem Polar:**

1. Kupac plaća karticom na sajtu. Domaćem kupcu je **cena u dinarima**, stranom u evrima —
   platforma podržava obe valute i bira po zemlji kupca.
2. Naplatu vrši **Polar Software Inc.**, američka kompanija sa sedištem u Delaware-u, koja
   nastupa kao **merchant of record** — dakle **ona je pravni prodavac** krajnjem kupcu i ona
   izdaje račun kupcu u svoje ime.
3. Polar zadržava proviziju (realno ~6,5% + 0,50 USD po transakciji) i ostatak drži na mom
   balansu kod sebe. Sredstva postaju raspoloživa 7 dana posle transakcije.
4. Ja **ručno pokrećem isplatu**. Novac stiže sa Stripe-a na moj račun u Srbiji, **u
   dinarima**, kao **jedna zbirna uplata** koja pokriva više kupaca i više transakcija.
   Uplatilac je strano pravno lice, iako je valuta domaća.
5. Polar mi ne šalje fakturu. Ja iz njihovog panela generišem **„reverse invoice"**
   (samofakturisanje) — dokument sa prometom umanjenim za naknade.
6. Polar je poreski registrovan u SAD, EU (irski OSS VAT) i Velikoj Britaniji.
   **U Srbiji nije registrovan ni za šta.**

**Pet stvari koje treba naglasiti, jer se lako previde:**

1. **Ovo nije payment gateway.** Nije kao domaći procesor gde novac kupca dolazi meni umanjen
   za proviziju. **Kupac pravno kupuje od američke firme.** Moj kupac, sa stanovišta papira,
   nije korisnik aplikacije nego Polar.
2. **Jedan uplatilac za sav prihod.** Bez obzira na to da li imam 5 ili 500 korisnika, na
   izvodu se vidi jedna strana firma. To je bitno i za devizni priliv i za test samostalnosti.
3. **Bruto ≠ neto.** Kupac plati 3.400 RSD, meni na račun stigne ~3.100 RSD. Pitanje je da
   li se kao prihod knjiži 3.400 ili 3.100 — to direktno utiče na limit za paušal, jer je
   razlika ~8%.
4. **Novac ume da prezimi kod Polara.** Ako na 31.12. imam neisplaćen balans, postavlja se
   pitanje u kojoj godini je to prihod (paušalac ide po naplati).
5. **Moji kupci su većinski fizička lica, i to je razlog zašto uopšte razmatram ovaj model.**
   Prodaja usluge fizičkom licu u Srbiji je promet na malo i traži fiskalni račun, i kod
   prodaje preko interneta. Ako prodaje Polar, ja ne prodajem fizičkom licu nego jednom
   stranom pravnom licu. **Da li me to stvarno oslobađa fiskalizacije — to je najvažnije
   pitanje koje imam.**

---

## 9. Pitanja za knjigovođu

Poređana po važnosti. Prva tri su ta bez kojih ne krećem.

### A. Status, limit i PDV

1. Da li ovakav model (SaaS pretplata, prihod iz inostranstva preko MoR platforme) uopšte
   ostaje u okviru **paušalnog oporezivanja** za šifru 63.12, ili me tera u vođenje knjiga?
2. Da li mi je za SaaS bolja šifra **62.01** (računarsko programiranje) nego 63.12
   (veb portali), i sa poreskog i sa suštinskog stanovišta?
3. Limit za paušal je 6.000.000 RSD godišnje, a prag za PDV 8.000.000 RSD u prethodnih
   12 meseci. **Da li se u oba ta iznosa računa i prihod iz inostranstva?**
4. Ako u ta dva limita ulazi **bruto** iznos (ono što je kupac platio), a ne neto (ono što
   mi stigne) — to znači da mi ~10% limita pojede provizija koju nikad nisam video.
   **Koji iznos ulazi u limit?**
5. Izvoz usluga stranom pravnom licu je van srpskog PDV-a (mesto prometa je sedište primaoca).
   **Da li taj promet ipak ulazi u prag od 8 miliona za obaveznu PDV registraciju?**

### B. Fakturisanje i dokumentacija — najkonkretnija grupa

6. **Kome i za šta izdajem račun?** Polaru, mesečno, na osnovu izveštaja o prometu?
   Ili je dovoljan njihov „reverse invoice" (samofakturisanje) koji ja generišem iz panela?
7. Ako izdajem račun Polaru — **na bruto ili na neto iznos?** Ako na bruto, gde se knjiži
   provizija kao trošak (paušalac troškove ne pravda, pa da li to uopšte ima smisla)?
8. Koji tačno dokumenti treba da završe u mojoj arhivi: izveštaj o transakcijama, reverse
   invoice, potvrda o isplati, bankarski izvod? **Šta banka i šta poreska mogu da traže?**
9. Kako se u **KPO knjizi** evidentira jedna zbirna uplata koja pokriva 30 kupaca — jednim
   redom po prilivu, ili se razdvaja?
10. Datum prihoda: **po datumu kada je kupac platio Polaru, ili po datumu kada je novac
    stigao na moj račun?** (Kod paušalca očekujem „po naplati", ali me zanima da li MoR
    menja odgovor.)
11. **Šta sa neisplaćenim balansom na 31.12.?** Novac je zarađen, ali stoji kod Polara.
    Da li je to prihod tekuće ili naredne godine, i da li treba da ga isplatim pre kraja
    godine da izbegnem nejasnoću?

### C. Priliv iz inostranstva — ali u dinarima

> Grupa je prepisana posle odgovora platforme: isplata srpskom prodavcu ide **u RSD na
> domaći dinarski račun**. Domaći kupac plaća takođe u dinarima, strani u evrima — pa je
> deo prihoda ipak konvertovan.

12. Domaći kupac plaća u dinarima, strani u evrima, a na račun mi u oba slučaja stiže
    **dinarski iznos od stranog pravnog lica**. Po kom kursu se priznaje prihod iz stranog
    dela — po izveštaju platforme, po kursu NBS-a na dan priliva, ili prosto po iznosu koji
    je banka odobrila? I koju **šifru osnova** koristim?
13. Iako je valuta dinar, posao je između rezidenta i nerezidenta. **Da li je to i dalje
    devizni posao** u smislu propisa — sa dokumentacijom, šifrom osnova i eventualnim
    izveštavanjem NBS-a?
14. Priliv dolazi **od Polara i sa Stripe-ovog računa**, ne od krajnjeg kupca, moguće i
    iz treće zemlje. **Da li je „plaćanje od trećeg lica" problem** za banku ili za
    deviznu kontrolu, i treba li mi ugovor sa platformom kao dokaz osnova?
15. Treba li mi **devizni račun** uopšte u ovoj postavci, ili je dovoljan dinarski
    poslovni? (Isto pitam i banku — prima li cross-border uplatu u dinarima na poslovni
    račun bez posebne procedure.)
16. **Postoji li rok** u kome sam dužan da naplatim potraživanje iz inostranstva, i da li
    balans koji stoji kod platforme ulazi u taj rok? Minimum za isplatu u dinarima je
    ~40 USD u protivvrednosti, pa mali iznosi znaju da stoje mesecima.

### D. Fiskalizacija i prodaja fizičkim licima — najvažnija grupa

17. **Ključno pitanje celog modela.** Moji kupci su većinski fizička lica u Srbiji. Ako
    prodaje Polar kao merchant of record, a ja fakturišem samo njemu — **da li ja imam
    obavezu evidentiranja prometa preko elektronskog fiskalnog uređaja?** Moja pretpostavka
    je da nemam, jer nisam ja taj koji vrši promet na malo, ali baš to hoću da mi potvrdite
    pisanim putem.
18. **Obrnuti scenario:** ako bih fizičkim licima prodavao **direktno** (uplata na moj račun
    preko IPS QR koda ili virmanom, bez ikakve platforme) — **da li mi je tada potreban ESIR
    i fiskalni račun?** Kruži tumačenje da bezgotovinsko plaćanje na tekući račun oslobađa
    te obaveze; koliko razumem, to je pravilo starog zakona. Šta važi danas?
19. Ako je odgovor na 18 „da, potreban je" — šta konkretno podrazumeva za paušalca:
    koji ESIR, koji trošak, koja mesečna obaveza, i da li može besplatno rešenje Poreske uprave?
20. Ja sam u Srbiji, kupac je u Srbiji, ali papirno prodaje američka firma. Može li poreska
    tvrditi da sam ja ipak izvršio promet u Srbiji i da je trebalo tako da ga tretiram?
21. Ako paralelno izdajem i **domaće račune u dinarima** (za manjinu kupaca koji su firme
    ili koji neće karticom), a većina ide preko platforme — **da li je taj kombinovani model
    uredan** i komplikuje li nešto u KPO knjizi?
22. Da li Polar kao strana firma ima obavezu da srpskom fizičkom licu obračuna srpski PDV
    od 20% na digitalnu uslugu, i ako je nema ili je ne izvršava — **da li ta obaveza na bilo
    koji način pada na mene** kao stvarnog pružaoca usluge?

### E. Porez po odbitku — manjina kupaca, ali skupa manjina

23. Kupac koji **jeste** d.o.o. ili preduzetnik u PDV-u plaća SaaS pretplatu **američkoj
    firmi**. Ima li obavezu **poreza po odbitku od 20%** (tretman softverske licence kao
    autorske naknade) i **internog obračuna PDV-a**?
24. Ako da — **Srbija nema ugovor o izbegavanju dvostrukog oporezivanja sa SAD**, pa nema ni
    umanjenja stope. Znači li to da je moja usluga takvom kupcu efektivno **20% skuplja**
    preko platforme nego uz moj domaći račun?
25. Ako je tako, slažete li se da firmama treba nuditi isključivo domaći račun u dinarima,
    a platformu ostaviti fizičkim licima i strancima?

### F. Test samostalnosti — najozbiljnije pitanje

26. Kod MoR modela **sav moj prihod formalno dolazi od jednog nalogodavca** (Polar Software Inc.),
    iako iza toga stoji na desetine nezavisnih kupaca. Jedan od kriterijuma testa samostalnosti
    je ostvarivanje **najmanje 70% prihoda od jednog nalogodavca** u periodu od 12 meseci.
    **Da li se MoR platforma smatra nalogodavcem u smislu tog testa?**
27. Ako se smatra — koliko drugih kriterijuma bi realno bilo ispunjeno u mom slučaju
    (radim iz svog prostora, svojom opremom, bez radnog vremena, bez uputstava, proizvod je
    moj i prodajem ga neograničenom broju kupaca) i da li je rizik prekvalifikacije ozbiljan?
28. **Da li paralelno izdavanje domaćih računa umanjuje taj rizik** time što razbija
    koncentraciju prihoda? Kod B2C profila to je mali broj računa, pa me zanima da li je
    uopšte dovoljan protivteg — ili je koncentracija prihoda cena koju MoR model nosi.

### G. Povraćaji, sporovi i korekcije

29. Kako se knjiži **povraćaj novca kupcu** koji Polar odbije od mog balansa u narednom
    mesecu — kao umanjenje prihoda tekućeg meseca ili storno prethodnog? Kod prodaje
    fizičkim licima povraćaja ima više nego u B2B-u.
30. Isto pitanje za **chargeback naknadu od 15 USD** i za **mesečne naknade platforme**
    koje se skidaju sa balansa.

### H. Rast

31. Na kom prometu mi se **isplati d.o.o.** umesto paušala, uz ovakav model prihoda?
32. Kada uđem u PDV — **kako se tada tretira prihod od Polara** (izvoz usluge, poreski
    oslobođen promet sa pravom na odbitak, ili van sistema)?
33. Ako u nekom trenutku otvorim stranu firmu i preselim naplatu na direktan Stripe,
    **šta se dešava sa mojim paušalom** i sa prihodom koji bi tada dolazio iz sopstvene
    strane firme?

---

## 10. Pitanja za Polar support (pre bilo kakve implementacije)

Ova pitanja nisu za knjigovođu nego za njih, i odgovori na prva dva mogu da obore ceo plan.

1. **Da li prihvatate plaćanja kupaca iz Srbije?** U poreskoj politici stoji da zadržavate
   pravo da blokirate plaćanja iz zemalja u kojima niste registrovani. Srbija nije na listi
   vaših registracija (SAD, EU/Irska OSS, UK).
2. Ako prihvatate — **da li se srpskom kupcu naplaćuje PDV od 20%** i ko ga prijavljuje?
3. U kojoj **valuti stiže isplata** na račun u Srbiji (EUR, USD, oboje) i da li se traži
   devizni račun?
4. Koji **poreski formular** traži onboarding za srpskog prodavca (W-8BEN kao fizičko lice
   ili W-8BEN-E kao registrovan preduzetnik) i šta je preporučeno za paušalca?
5. Da li „reverse invoice" iz panela može da nosi moje podatke kao preduzetnika
   (naziv, adresa, PIB/MB) i moju numeraciju računa?
6. Postoji li ograničenje broja isplata mesečno i da li mesečna naknada od 2 USD ide
   po mesecu ili po isplati?
7. Koliko traje **KYC provera** i šta se traži od registrovanog preduzetnika iz Srbije?
8. Postoji li **sandbox** koji pokriva sve događaje uključujući refund i chargeback?

**Dopisano posle prvog kruga odgovora** (§12) — na ovo još nema odgovora:

9. Molim **pisanu potvrdu čoveka** da za prodavca registrovanog u Srbiji isplata ide u RSD
   na domaći bankovni račun, i da li je moguć bilo koji drugi aranžman.
10. Konkretan odgovor na pitanje 2 gore: **naplaćuje li se srpskom kupcu srpski PDV** i,
    ako ne, da li planirate registraciju u Srbiji?
11. **U kojoj se valuti drži balans?** Ako proizvod naplaćujem u RSD, a i isplata ide u RSD,
    da li se dinar uopšte konvertuje — ili prolazi kroz dolar, pa se konverzija do 1%
    naplaćuje dvaput? Ovo direktno menja moju maržu, jer prodajem domaćem tržištu.

---

## 11. Preporuka i redosled poteza

**Preporuka:** kod B2C profila je **Polar glavni tok**, a domaći račun izlaz za manjinu.
Ali ne pre nego što stignu odgovori na pitanja 17 i 18 iz §9 (fiskalizacija) i pitanje 1
iz §10 (da li Polar uopšte prima srpske kupce). Ta tri odgovora određuju sve ostalo.

Redosled koji predlažem:

1. **Sada:** poslati §8 i §9 knjigovođi, a §10 Polar supportu. Nula linija koda, nula troška.
2. **Odgovor na 17 i 18 određuje arhitekturu, ne cenu:**
   - fiskalizacija nije moja obaveza ni u jednom scenariju → domaći IPS tok je i dalje
     najjeftiniji i vredi ga graditi za sve kupce;
   - fiskalizacija je moja obaveza kod direktne prodaje, a nije kod MoR-a → **Polar je
     glavni tok**, IPS ostaje ručni izuzetak za firme i DinaCard;
   - fiskalizacija je moja obaveza u oba slučaja → onda je ceo račun drugačiji i vraćamo se
     na crtaću tablu.
3. **Polar je potvrdio da prima srpske kupce** (§12). Otvaranje naloga i KYC traju **do 14
   dana** — pokrenuti ih paralelno sa razvojem, ne posle njega.
4. **Domaći račun ne graditi kao sistem dok se ne pokaže da treba.** Kod B2C-a je to
   nekoliko računa mesečno — ručno, bez `invoices` tabele i bez admin ekrana. Automatizuje
   se onda kada ručno počne da smeta, ne pre.
5. **Ne dirati `credit_ledger`.** Polar naplaćuje, baza vodi kredite. Uvek.
6. **Odluka o naplati i dalje čeka podatke iz bete** (`ROADMAP.md`, Faza C). Ovaj dokument
   ne ubrzava tu odluku — samo je čini izvodljivom onog dana kada padne.

---

## 12. Odgovori platforme — šta je potvrđeno, šta i dalje visi

Pitanja iz §10 su poslata i odgovorena. Provereno u dokumentaciji: sve što je navedeno
poklapa se sa njihovim docs-ima, uz jedan izuzetak označen niže.

| Pitanje | Odgovor | Moja provera |
|---|---|---|
| 1. Srpski kupci | prihvataju se; blokirane su samo sankcionisane zemlje (Kuba, Rusija, Iran, Severna Koreja, Sirija) | **potvrđeno** u dokumentaciji. Klauzula o pravu na blokadu neregistrovanih tržišta i dalje stoji u poreskoj politici — može da se promeni, ali danas ne važi za Srbiju |
| 2. Srpski PDV | ne razrešeno; kao MoR preuzimaju odgovornost globalno, ali za Srbiju nemaju registraciju | **i dalje otvoreno, i to je pitanje koje najviše treba knjigovođi.** Praktično: srpskom kupcu se najverovatnije **ne** naplaćuje srpskih 20% |
| 3. Dokumenti kupcu | i račun i potvrda o plaćanju, samouslužno iz portala, kupac sam dopisuje naziv firme i PIB | **potvrđeno**, i dobra vest — nemam ulogu u tome |
| 4. Povraćaji | ja iniciram iz panela ili preko API-ja; **i oni sami smeju da odobre povraćaj u roku od 60 dana**, čak i uz „bez povraćaja" politiku, radi izbegavanja spora. Provizija se ne vraća. Povraćaj **ne otkazuje** pretplatu. Webhook `refund.created` | **potvrđeno i najvažniji tehnički nalaz.** Ušlo u §6 kao rizik |
| 5. Valuta isplate | **RSD, na domaći dinarski račun**; minimum ~40 USD u protivvrednosti; Wise/Revolut/Payoneer verovatno odbijeni | **delimično.** Da je isplata u dinarima — potvrđuje Polarova tabela minimalnih iznosa, gde `RSD` stoji sa pragom od 40 USD. Ali tvrdnja da je to „dobro dokumentovano" i deo o Wise/Payoneer **ne stoje u njihovoj dokumentaciji** — to je izvedeno iz opšteg Stripe pravila. **Tražiti pisanu potvrdu od čoveka, ne od bota** |
| 6. W-8BEN / W-8BEN-E | nije dokumentovano; rešava se u Stripe onboardingu | prihvatljivo, ali knjigovođi treba odgovor pre nego što potpišem |
| 7. Reverse invoice | podesivi naziv, adresa, dodatno polje (tu ide PIB), sopstvena numeracija; **posle generisanja se ne menja** | **potvrđeno.** Operativno: podesiti sve **pre** prve isplate, i numeraciju uskladiti sa knjigovođom |
| 8. Naknada od 2 USD | po kalendarskom mesecu sa bar jednom isplatom, ne po isplati | **potvrđeno** |
| 9. KYC | do **14 dana**; Stripe Identity (dokument + selfi) + povezivanje računa | potvrđeno; moja ranija procena od nedelju dana bila je optimistična |
| 10. Sandbox | nije eksplicitno odgovoreno | proveriti u praksi pre nego što se plati prva prava transakcija |

### Ispravka koja nije došla iz odgovora nego iz panela

**RSD jeste podržana valuta cene.** Prva verzija ovog dokumenta je tvrdila suprotno, na
osnovu Polarove objave o deset valuta. Panel to demantuje — proizvod prima `RSD` uz `EUR`,
sa fiksnom cenom u dinarima — a i dokumentacija danas govori o **130+ valuta za cene
proizvoda**, uz izbor po geolokaciji kupca.

Posledice:

- domaći kupac vidi i plaća dinarski iznos, bez konverzije na svojoj strani;
- ako je i cena i isplata u dinarima, sopstvena konverzija bi trebalo da otpadne — ali to
  zavisi od valute balansa, što nigde nije dokumentovano (pitanje 11 u §10);
- **DinaCard i dalje ne prolazi** — to je ograničenje kartične mreže, ne valute;
- računica u §3.2 je prepisana u dinarima.

### Šta se zbog ovoga promenilo u planu

1. **Nema deviznog računa u priči.** Domaću prodaju naplaćujem u dinarima, stranu u evrima,
   a isplata u oba slučaja stiže u dinarima. Grupa C pitanja za knjigovođu je prepisana.
2. **Minimum od 40 USD u dinarima je 4× viši nego u dolarima.** Na početnom obimu novac
   ostaje na balansu duže nego što sam računao.
3. **Politika povraćaja se piše pre lansiranja**, ne posle prve reklamacije — jer povraćaj
   može da odobri i platforma, mimo mene.
4. **KYC do 14 dana** ulazi u raspored kao stavka, ne kao formalnost.

### Šta ostaje neodgovoreno

- **Srpski PDV na prodaju domaćem fizičkom licu** (pitanje 2 njima, pitanje 22 knjigovođi).
- **Fiskalizacija** — na to platforma ne može ni da odgovori; to je isključivo pitanje 17 i 18
  za knjigovođu i i dalje je najvažnija stavka u celom dokumentu.
- **Valuta isplate, pisano potvrđeno** — i da li moja banka prima cross-border uplatu u
  dinarima na poslovni račun.

---

## 13. Odluke o paketima i kreditima

Donete pri postavljanju prvog proizvoda u panelu. Implementacija ide u fazu naplate
(`ROADMAP.md`, Faza C) — ovde stoje da se ne izgube.

### Starter

| Stavka | Vrednost |
|---|---|
| Cena | **3.400 RSD mesečno** (~22,7 RSD po kreditu) |
| Krediti | **150 mesečno**, bez rollovera |
| Polar proizvod | `Sajtoskop Starter`, recurring 1 mesec, fiksna cena, bez probnog perioda |
| Metapodaci | `plan_id: starter`, `monthly_credits: 150` — webhook mapira na `PLANS`, bez ID-jeva u env-u |
| Vidljivost u portalu | **Private** — v. obrazloženje niže |
| Automated benefits | nijedan; kredite dodeljuje `grant_credits` iz webhooka |

### Cena akcije u kreditima

| Akcija | Krediti | Stvaran trošak | Obrazloženje |
|---|---|---|---|
| Skeniranje | **2** | ~11,3 RSD | Do 3 Places poziva; jedina akcija koja stvarno košta |
| Otključavanje | **1** | ~2,2 RSD | Claude vision; PSI je besplatan, screenshot je moj worker |
| Prva poruka | **0** | ~0,3 RSD | Deo onoga što je kupac platio otključavanjem |
| „Napiši drugačije" | **0**, ali **max 3 varijante po leadu** | ~0,3 RSD | Brojanje redova u `outreach_messages` po `(user_id, place_id)` — bez migracije, bez novca na hot putanji. Zaštita od curenja troška je već tu: `AI_OUTREACH_DAILY_CAP` |

`SCAN_CREDIT_COST` ide sa 1 na **2**. Konstanta se čita na četiri mesta (modal potvrde,
traka ispod forme, poruka o nedostatku kredita, provera balansa) — nijedan od tih tekstova
više ne sme da ima ukucanu jedinicu.

### Beta plan

Sa 30 na **50 kredita** mesečno, da poskupljenje skeniranja ne pogodi ljude usred besplatne
bete. Efekat, tačno:

| | Danas (30 kredita, skeniranje 1) | Posle (50 kredita, skeniranje 2) |
|---|---|---|
| Maksimum skeniranja | 30 | **25** |
| Maksimum otključavanja | 30 | **50** |
| Najgori slučaj u Places pozivima | 90 | **75** |

Korisnik koji radi isključivo skeniranja gubi pet skeniranja. Ako se to ne želi ni kod koga,
broj je **60**, ne 50 — tada niko ne gubi ništa, a otključavanja se udvostručuju.
Promena stiže **prvog u sledećem mesecu**: `grant_monthly_credits` je idempotentan po mesecu
i postavlja balans na plan, pa se tekući mesec ne dira sam od sebe.

### Zašto Private, a ne Public

Prvobitna preporuka u §5 je bila `Public`. **Menja se u `Private`**, iz jednog razloga koji
nadjačava udobnost portala:

Checkout se kreira **isključivo sa servera**, sa `externalCustomerId` = Clerk `user_id`
(pravilo 8). To je jedina veza između uplate i profila. `Public` proizvod je vidljiv i
kupljiv izvan te putanje — neko ko ga plati bez naloga u aplikaciji stvara pretplatu koju
webhook nema na šta da veže, pa ostaje samo mapiranje po mejlu, tačno ono što je
`naplata-bez-firme.md` §6 označio kao krhko. Uz to, `Public` znači i stranu koju ne pišem ja,
na engleskom, sa mojim cenama.

**Za proveru u sandboxu pre nego što se ovo zaključa:** da li `Private` proizvod i dalje
dozvoljava postojećem pretplatniku da u portalu vidi pretplatu, promeni karticu i otkaže.
Vidljivost bi trebalo da uređuje samo izlog, ne upravljanje — ali to je tvrdnja koju treba
videti, ne pretpostaviti.

---

## Izvori

Polarova dokumentacija i cenovnik:

- [Supported countries — Polar](https://polar.sh/docs/merchant-of-record/supported-countries)
- [Pricing — Polar](https://polar.sh/resources/pricing)
- [Payouts — Polar](https://polar.sh/docs/features/finance/payouts)
- [Tax — Polar as Merchant of Record](https://polar.apidocumentation.com/documentation/polar-as-merchant-of-record/tax)
- [Merchant of Record — introduction](https://polar.sh/docs/merchant-of-record/introduction)
- [Credits & Prepaid Balances](https://polar.sh/features/credits) · [Usage-Based Billing](https://polar.sh/features/usage-billing)
- [Next.js adapter](https://polar.sh/docs/integrate/sdk/adapters/nextjs) · [Customer State](https://docs.polar.sh/integrate/customer-state)
- [Polar potvrđuje Stripe Connect Express kao mehanizam isplate](https://x.com/polar_sh/status/1915379610809782428)
- [Multi-currency: podržane valute](https://x.com/polar_sh/status/2026979022962401441)

Nezavisni pregledi cenovnika (promena 4%+40¢ → 5%+50¢):

- [Polar.sh Review 2026 — Fungies](https://fungies.io/polar-sh-review-2026/)
- [Polar.sh Review 2026 — Dodo Payments](https://dodopayments.com/blogs/polar-sh-review)
- [Polar Payments Review 2026 — Rebounce](https://www.rebounce.dev/blog/polar-payments-review)

Domaći poreski kontekst (orijentaciono, sve proveriti sa knjigovođom):

- [Limit za paušalce 2026 — 6 i 8 miliona](https://www.platnilistic.rs/blog/limit-za-pausalce)
- [Paušalac u Srbiji 2026: porezi, limiti, KPO i fakture](https://fakturko.io/blog/pausalac-u-srbiji-2026-porezi-limiti-kpo-i-fakture)
- [Porez po odbitku na usluge iz inostranstva](https://aktivasistem.com/news/porez-po-odbitku-na-usluge-iz-inostranstva/)
- [Svaka prodaja fizičkom licu se mora evidentirati u fiskalnom uređaju — i kod prodaje preko interneta](https://www.paragraf.rs/dnevne-vesti/051222/051222-vest5.html)
- [Zakon o fiskalizaciji — promet na malo](https://www.paragraf.rs/propisi/zakon-o-fiskalizaciji-republike-srbije.html)
- [Fiskalna kasa za paušalce: ko mora, a ko je oslobođen](https://pausalko.rs/blog/da-li-pausalci-moraju-da-imaju-fiskalnu-kasu-i-ko-je-oslobodjen-obaveze-evidentiranja-prometa-preko-kase/)
- [Poreski tretman naknada za softverske licence](https://gclegaltax.com/poreski-tretman-naknada-koje-se-nerezidentima-isplacuju-za-softverske-licence-i-odrzavanje-softvera/)

---

*Nisam ni poreski savetnik ni knjigovođa. Sve poresko iz ovog dokumenta je pitanje, ne tvrdnja.*
