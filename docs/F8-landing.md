# F8 — Landing, pravni tekstovi i otvaranje bete

**Cilj:** čovek sa liste dobije link, u minut shvati šta je alat, registruje se i napravi
prvu pretragu bez tvoje pomoći.

**Procena:** 2–3 dana · **Preduslov:** F4 minimum, idealno F7

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

**6. FAQ**
- *Da li je legalno?* → Podaci su javni, sa Google Maps-a, preko zvaničnog API-ja. Ti si odgovoran za način na koji šalješ poruke; u alatu je uputstvo i opt-out šablon.
- *Radi li za Hrvatsku i Bosnu?* → Ne još. Srbija prvo.
- *Šta ako podaci nisu tačni?* → Google podaci se osvežavaju u 30-dnevnom ciklusu. Ocena sajta se radi u trenutku otključavanja.
- *Koliko traje beta?* → Dok ne skupim dovoljno povratnih informacija. Javljam unapred pre bilo kakve promene.
- *Ko si ti?* → Ime, čime se baviš, i rečenica da alat koristiš sam za svoj pipeline.

**Ne stavljaj:** cenovnik, roadmap, tehnički stack, lifetime ponudu, brojač mesta.

---

## 2. Onboarding — prvih 90 sekundi

Ovde se gubi većina korisnika i to je jedini deo landing posla koji stvarno menja brojke.

- [ ] Posle registracije **ne vodi na prazan dashboard.** Vodi na pretragu sa unapred izabranim gradom i nišom koji su **već u kešu** — rezultat je instant i utisak je „ovo stvarno radi"
- [ ] Prvi otključan lead je besplatan i ne skida kredit (`grant_credits(+1, 'onboarding')` pre unlocka)
- [ ] Kratka poruka u prvom rezultatu: *„Zeleni bedževi su najbolji leadovi — firme koje sajt uopšte nemaju."*
- [ ] Bez tura kroz aplikaciju, bez modala sa 6 koraka

---

## 3. Pravni tekstovi

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

```
Radimo docs/F8-landing.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Prvo mi napiši ceo kopi landing stranice kao markdown, bez ijedne linije koda.
Hoću da pročitam tekst i prepravim ga pre nego što se pretvori u komponente.

Brojeve za hero i sekciju „Dokaz" izvuci SQL upitom iz baze, ne iz PRD-a —
možda su se promenili posle novih scanova.
```
