# F8 — Landing, pravni tekstovi i otvaranje bete

**Cilj:** čovek sa liste dobije link, u minut shvati šta je alat, registruje se i napravi
prvu pretragu bez tvoje pomoći.

**Procena:** 2–3 dana · **Preduslov:** F4 minimum, idealno F7

---

## ‼️ Stanje na 27. avgust 2026 — pročitaj pre svega ostalog

Ovaj PRD je pisan pre nego što je model naplate donet i pre nego što je landing napravljen.
Delovi su isporučeni, delovi nadjačani. **Operativni izvor istine je `docs/LANSIRANJE.md`.**

| Sekcija | Stanje |
|---|---|
| §1 Landing ne prodaje pretplatu | **Isporučeno van repoa.** Landing je napravljen i stoji na `sajtoskop.com`; aplikacija je na `app.sajtoskop.com` (`LANSIRANJE.md` §1.7). Struktura i ton iz ove sekcije važe za taj sajt, ali **kopija se ne održava ovde**. Beta ponuda iz §1 je mrtva — v. napomenu na licu mesta. |
| §2 Onboarding — prvih 90 sekundi | **Nadjačano `LANSIRANJE.md` §1.8.** Onboarding je od 27.8. zasebna faza od dve sesije (S27, S28) i mnogo je širi od četiri crtice odavde. Jedina stavka koja je preživela doslovno je besplatno prvo otključavanje (odluka O1). |
| §3 Pravni tekstovi | **Isporučeno u S22**, 26.8. Tri strane žive u aplikaciji, landing ih linkuje. Ostali su `<POPUNITI: …>` markeri (korak R19). |
| §4 Kanarinci | Nije rađeno — **S25**. |
| §5 Merenje | Nije rađeno — **S25**. Metrike se od S27 čitaju iz `profiles.onboarding_steps`. |
| §6 Otvaranje bete | Važi, uz jednu ispravku: beta više nije javna ponuda nego **ručni izuzetak** iz admin konzole, 50 kredita (`LANSIRANJE.md` §1.1). |
| §8 Posle F8 | Nadjačano. Odluka „naplaćuj" je pala pre bete: naplata ide od prvog dana, kroz Paddle (`LANSIRANJE.md` §1.1). |
| §9 Prompt za sesiju | **Otpalo** sa sesijom S23 — kopija landinga se ne piše u ovom repou. |

---

## 1. Landing ne prodaje pretplatu

Prodaje **ulazak u besplatnu betu**. Jedan CTA, ponovljen tri puta, uvek isti.

### Hero

> ## U Šapcu 58% PVC stolarija nema sajt koji radi.
> ## Sajtoskop zna njihova imena, telefone i tačan problem.
>
> Izabereš grad i nišu. Alat skenira Google Maps, oceni svaki sajt od 0 do 100, i da ti kontakt,
> screenshot i listu konkretnih problema — spremno za slanje.
>
> **[Uđi u besplatnu betu]**

Broj u naslovu je **tvoj stvaran podatak** iz scana, ne procena. Zameni ga aktuelnim brojem iz
seed izveštaja u F1 ako se promenio. Konkretan broj radi bolje od svakog obećanja.

### Ispod hero-a, ovim redom

**1. Problem** — tri stavke, kratko:
- Sati odlaze na guglanje firmi, pa još sat na proveru ko od njih ima loš sajt
- Kad nađeš nekoga, ne znaš šta da napišeš da ne pređe u spam
- Zapadni alati traže „ružan sajt". Kod nas je najbolji lead firma koja sajt **uopšte nema**.

**2. Dokaz** — tri stvarne brojke iz tvojih scanova, kao tabela:
PVC stolarija Šabac 58% · Advokat Kragujevac 57% · Autoplac Čačak 48%
Ispod: *„Ovo nisu procene. To su brojevi iz stvarnih skeniranja."*

**3. Kako radi** — tri koraka sa screenshotom aplikacije (ne terminala — sada imaš pravi UI)

**4. Srpske specifičnosti** — ovo je diferencijator, ne skrivaj ga:
- Filter „nema sajt", „samo Instagram" i „mrtav domen"
- Tip telefona iz prefiksa — znaš da li ide Viber ili poziv
- Poruke na srpskom, po kanalima
- Ćirilica i latinica normalizovane

**5. Beta ponuda** — bez skrivanja:
> ### Beta je besplatna dok traje.
> 30 kredita mesečno, bez kartice, bez obaveze.
> Kad uvedem planove, javljam unapred i ljudi iz bete dobijaju cenu koja se ne ponavlja.

> ⊘ **Nadjačano 27.8.** Ove tri rečenice **ne smeju** da stoje ni na landingu ni u
> aplikaciji. Naplata ide od prvog dana (`LANSIRANJE.md` §1.1), beta je **ručni izuzetak**
> koji se otvara iz admin konzole i nosi **50** kredita, a nov nalog dobija plan `dopuna` i
> **nula** kredita — plus jedno besplatno otključavanje (O1). Umesto beta ponude, landing
> pokazuje planove i vodi na `app.sajtoskop.com/cenovnik?plan=…`.

**6. FAQ**
- *Da li je legalno?* → Podaci su javni, sa Google Maps-a, preko zvaničnog API-ja. Ti si odgovoran za način na koji šalješ poruke; u alatu je uputstvo i opt-out šablon.
- *Radi li za Hrvatsku i Bosnu?* → Ne još. Srbija prvo.
- *Šta ako podaci nisu tačni?* → Google podaci se osvežavaju u 30-dnevnom ciklusu. Ocena sajta se radi u trenutku otključavanja.
- *Koliko traje beta?* → Dok ne skupim dovoljno povratnih informacija. Javljam unapred pre bilo kakve promene.
- *Ko si ti?* → Ime, čime se baviš, i rečenica da alat koristiš sam za svoj pipeline.

**Ne stavljaj:** cenovnik, roadmap, tehnički stack, lifetime ponudu, brojač mesta.

---

## 2. Onboarding — prvih 90 sekundi

> ⊘ **Nadjačano 27. avgusta 2026 — v. `LANSIRANJE.md` §1.8.** Onboarding je postao zasebna
> faza: čarobnjak od tri pitanja, prvi rezultat iz keša, vođen prvi prolaz uz element, traka
> napretka u bazi, prazna stanja koja uče i vodič na zahtev — sesije **S27** i **S28**.
>
> Dve stvari odavde su preživele doslovno: **prvi rezultat je pogodak u kešu** (instant i
> besplatan) i **prvo otključavanje je besplatno** kroz `grant_credits(+1, 'onboarding')`
> **pre** unlocka — to je odluka **O1**, zatvorena 27.8. Zabrana tura i dalje važi za sve što
> se pokreće samo; vodič koji korisnik sam pozove nije isto.

Ovde se gubi većina korisnika i to je jedini deo landing posla koji stvarno menja brojke.

- [ ] Posle registracije **ne vodi na prazan dashboard.** Vodi na pretragu sa unapred izabranim gradom i nišom koji su **već u kešu** — rezultat je instant i utisak je „ovo stvarno radi"
- [ ] Prvi otključan lead je besplatan i ne skida kredit (`grant_credits(+1, 'onboarding')` pre unlocka)
- [ ] Kratka poruka u prvom rezultatu: *„Zeleni bedževi su najbolji leadovi — firme koje sajt uopšte nemaju."*
- [ ] Bez tura kroz aplikaciju, bez modala sa 6 koraka

---

## 3. Pravni tekstovi

> ☑ **Isporučeno u S22, 26. avgusta 2026.** `/uslovi`, `/privatnost` i `/povracaj` žive u
> aplikaciji (`app.sajtoskop.com`), futer postoji, a landing ih linkuje (korak R36). Uz
> obavezne klauzule odavde ušle su i one koje ovaj PRD nije mogao da zna: Paddle kao
> merchant of record, pravilo o dve kase kredita i pristup posle isteka (30 dana čitanje i
> izvoz). **Ostalo je 25 `<POPUNITI: …>` markera** — korak R19.

Bez ovoga ne puštaš nijednog korisnika.

**Uslovi korišćenja** — obavezne klauzule:
- Zabrana automatizovanog pristupa, scrapinga i reverse engineeringa
- Zabrana preprodaje, dalje distribucije i deljenja pristupa
- Zabrana korišćenja podataka za izgradnju konkurentskog proizvoda
- Jedan nalog = jedno lice
- Pravo na suspenziju u slučaju kršenja
- Korisnik je odgovoran za način na koji kontaktira prospekte
- Beta status: usluga se menja, može biti prekinuta, bez garancija dostupnosti

**Politika privatnosti** — ZZPL:
- Koji podaci se obrađuju (mejl korisnika; kontakti firmi su podaci o ličnosti preduzetnika)
- Osnov obrade, rok čuvanja, prava lica
- Procedura brisanja na zahtev — mora da postoji stvarno, ne samo u tekstu
- Ne loguj pun kontakt u aplikacione logove

**Copyright notice** u futeru i u zaglavljima izvornih fajlova.

> Ovo su tekstovi koje pišeš sam iz šablona. Advokat tek posle 100 korisnika ili prve žalbe.

---

## 4. Kanarinci

Pre otvaranja bete, P1 mera iz `docs/bezbednost.md` koja košta pola sata:

- [ ] 5–10 lažnih biznisa sa jedinstvenim fingerprintima: nepostojeći nazivi, tvoj testni broj telefona, `.rs` domeni koje kontrolišeš
- [ ] Prati kome su prikazani i ko ih je otključao
- [ ] Ako se pojave u konkurentskom proizvodu ili tuđem CSV-u, imaš dokaz kopiranja sa tragom do naloga

---

## 5. Merenje

Minimalno, bez analitičkog cirkusa:

- [ ] Registracije po danu
- [ ] Broj korisnika koji su napravili **bar jednu pretragu** (aktivacija)
- [ ] Broj koji su otključali **bar jedan lead**
- [ ] **Broj koji su se vratili drugog dana** — jedina metrika koja stvarno odlučuje
- [ ] Prosečan broj pretraga po korisniku nedeljno

Sve ovo su SQL upiti nad tabelama koje već imaš. Ne instaliraj analitički alat.

---

## 6. Otvaranje bete

- [ ] Pozovi prvo **5 ljudi** sa beta liste, lično, jednu po jednu poruku
- [ ] Gledaj šta rade — gde staju, šta pitaju. Pet ljudi ti da 80% nalaza.
- [ ] Popravi ono što je očigledno, pa onda pozovi ostalih 20
- [ ] Od svakog traži odgovor na jedno pitanje: *„Koliko bi mesečno platio za ovo?"*
- [ ] Nemoj slati javnu objavu dok prvih 5 ne prođe kroz alat bez tvoje pomoći

---

## 7. Gotovo kad

- Čovek koji te ne poznaje dođe sa linka, registruje se i napravi pretragu bez ijednog pitanja
- Uslovi korišćenja i politika privatnosti su objavljeni i linkovani u futeru
- Kanarinci su u bazi
- Pet metrika iz sekcije 5 se čitaju jednim SQL upitom
- Prvih pet beta korisnika je unutra i koristi alat

---

## 8. Posle F8

Trideset dana bete, pa odluka na osnovu dve brojke: **koliko se korisnika vratilo drugi put** i
**medijana odgovora na pitanje o ceni**. Ispod 1.500 RSD medijane — alat je interni alat za
Remati i to je legitiman ishod, ne neuspeh.

Ako odluka bude „naplaćuj", otvara se `docs/naplata.md`: IPS QR za domaće, Lemon Squeezy za
strane, `BillingProvider` interfejs iz F4 dobija drugu implementaciju.

---

## 9. Prompt za sesiju

> ⊘ **Otpalo 27. avgusta 2026.** Sesija S23 je ukinuta: landing je napravljen van ovog
> repozitorijuma, pa `docs/landing-kopi.md` ne nastaje. Prompt ispod ostaje kao trag.

```
Radimo docs/F8-landing.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Prvo mi napiši ceo kopi landing stranice kao markdown, bez ijedne linije koda.
Hoću da pročitam tekst i prepravim ga pre nego što se pretvori u komponente.

Brojeve za hero i sekciju „Dokaz" izvuci SQL upitom iz baze, ne iz PRD-a —
možda su se promenili posle novih scanova.
```
