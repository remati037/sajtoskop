# Pitanja pre lansiranja — kompletna lista

**Šta je ovo:** svako pitanje na koje mora da postoji odgovor pre nego što Sajtoskop izađe
pred ljude. Nije plan rada (to je `ROADMAP.md`) nego lista odluka — jer se svaka od njih,
ako se ne donese svesno, donese sama od sebe i to obično loše.

**Kako se čita:** svaka stavka ima oznaku trenutka do kog odgovor mora da postoji:

- **[BETA]** — pre otvaranja bete.
- **[NAPLATA]** — pre prve naplaćene pretplate.
- **[POSLE]** — sme da sačeka prve korisnike, ali pitanje mora da postoji da se ne zaboravi.

> ‼️ **Od 20. avgusta 2026. [BETA] i [NAPLATA] više nisu dva odvojena trenutka.** Odluka D1
> je da naplata ide od prvog dana, a beta nalozi su ručni izuzetak koji ja otvaram iz admin
> konzole. Oznake su ostavljene jer i dalje govore *zašto* je pitanje važno, ali rok je za
> sve isti: dan lansiranja.
>
> **Plan rada i redosled su u `docs/LANSIRANJE.md`** — tamo su sesije S16–S25, ručni koraci
> R1–R31 i go/no-go lista. Ovaj fajl je lista odluka, ne plan.

Stavke označene ✅ su **već odlučene** u postojećim dokumentima — navedene su da se vidi
cela slika i da se odluka potvrdi, ne da se ponovo otvara.

---

## 1. Pozicioniranje i ponuda vrednosti

1. **[BETA] Koja je JEDNA rečenica kojom se proizvod prodaje?** Landing hero, prvi red
   outreach poruke, odgovor na „šta je to što praviš". Kandidat iz `00-kontekst.md`:
   *„Daj mi 30 firmi u tvom gradu kojima sajt ne radi na telefonu, sa telefonom i mejlom,
   i reci ti šta da im napišeš."* Da li je to TA rečenica, ili postoji bolja? Testiraj je
   naglas na nekome ko ne zna šta radiš.

2. **[BETA] Kome se proizvod obraća prvom?** Dokument kaže: frilens developeri, dizajneri,
   SEO/marketing agencije. To su tri različite publike sa tri različite poruke i tri
   različite cene bola. Ko je **primarni** za lansiranje — kome ide prvih 5 ličnih poziva?
   (Frilenser bez klijenata ima najveći bol ali najplići džep; agencija obrnuto.)

3. **[BETA] Šta je odgovor na „pa to mogu i sam preko Google Maps"?** Prigovor broj jedan.
   Odgovor mora da bude spreman i na landingu i u razgovoru: vreme (sati ručnog rada po
   pretrazi), podaci kojih na Maps nema (Ugly Score, mrtvi domeni, spremna poruka), i baza
   koja raste. Napisati ga, ne improvizovati.

4. **[BETA] Šta je odgovor na „ovo je scraper / da li je ovo legalno"?** Pozicioniranje iz
   `00-kontekst.md` („baza, ne scraper") mora da ima i pravnu potporu u FAQ-u — v. §9.

5. **[BETA] Da li se najjači diferencijator — firme BEZ sajta — vidi na prvi pogled?**
   Zapadni alati traže ružne sajtove; ovde je najbolji lead firma bez sajta ili sa mrtvim
   domenom. Ako to nije u hero sekciji sa stvarnim brojkama (58% PVC stolarija u Šapcu…),
   diferencijator postoji samo u dokumentaciji.

6. **[BETA] Šta je „aha momenat" i za koliko sekundi korisnik stiže do njega?** F8 §2 kaže
   „prvih 90 sekundi". Konkretno: koji ekran, sa kojim podacima, izaziva „opa"? Prva lista
   sa Katastrofa bendovima? Prvi otključan kontakt? Onboarding se gradi unazad od tog momenta.

7. **[POSLE] Da li „Sajtoskop" i vizuelni identitet komuniciraju ono što treba?** Ime je
   dobro (skop = gleda sajtove), ali proveriti: izgovorljivost u razgovoru, da li se domen
   diktira bez slovkanja, i kako zvuči kada agencija kaže klijentu „našli smo vas kroz
   Sajtoskop".

---

## 2. Cene, planovi i krediti ✅ ZATVORENO 2026-08-20

> **Cela ova sekcija je zatvorena odlukama D1–D6.** Izvor istine je sada
> **`docs/LANSIRANJE.md` §1** — tamo su brojevi, obrazloženja i računica troška.
> Ovde ostaje samo sažetak i ono što je i dalje otvoreno.
>
> ‼️ Raniji sadržaj ove sekcije (3.400 RSD, 150 kredita, „samo Starter") **više ne važi** i
> nikad nije bio usklađen sa Paddle katalogom. Paddle ne podržava RSD, pa su cene u EUR sa
> `RS` override-om.

### Zatvoreno

8. ✅ **Cene i planovi.** Tri plana, mesečno i godišnje (10 mesečnih = 2 meseca gratis).
   **Jedna cena za ceo svet — `RS` override je uklonjen** (v. #8a).

   | | Starter | Pro | Advanced |
   |---|---|---|---|
   | Mesečno | €29 | €59 | €119 |
   | Godišnje | €290 | €590 | €1.190 |
   | Krediti mesečno | 100 | 300 | 800 |
   | Skeniranja dnevno *(osigurač)* | 30 | 60 | 120 |
   | CSV redova dnevno | 500 | 2.000 | 10.000 |
   | „Napiši drugačije" dnevno | 5 | 20 | 60 |

   Cena po kreditu: €0,290 / €0,197 / €0,149. Najgori slučaj troška: 11% / 16% / 22%.

8a. ✅ **`RS` override uklonjen.** Nikad nije bio dinarska cena — Paddle podržava 33 valute i
   RSD nije među njima. Bio je **sniženi EUR iznos za kupce iz Srbije** (€14 umesto €29),
   ostatak napuštenog pokušaja da cena bude u dinarima. Uklonjen jer je bio **jeftiniji od
   ove sopstvene odluke #8** (3.400 RSD ≈ €29), jer prepolovljava maržu i jer udvostručuje
   posao pri prelasku na produkciju. **Reverzibilno** — vraća se jednim poljem u Paddle
   panelu, bez migracije i bez koda, ako beta pokaže da €29 ne prolazi u Srbiji.

9. ✅ **Cena akcija — po dubini skeniranja, ne fiksno.**

   | Dubina | Prospekata | Stranica | Places poziva | Kredita |
   |---|---|---|---|---|
   | Brzo | do 20 | 1 | 1 | **1** |
   | Standardno | do 40 | 2 | 2 | **2** |
   | Duboko | do 60 | 3 | 3 | **3** |

   Otključavanje **1 kredit**, prva poruka 0, „Napiši drugačije" 0 uz dnevni cap po planu.
   Pretraga po kešu besplatna i neograničena. **1 kredit = 1 Places poziv**, pa se cena
   poklapa sa troškom i novčanik sam ograničava izloženost. Radi se pre lansiranja
   (sesija S17 u `docs/LANSIRANJE.md`). *Kod je imao `SCAN_CREDIT_COST = 1`; ranija odluka
   „2 kredita" ostaje kao podrazumevana dubina.*

10. ✅ **Tri plana na dan lansiranja**, ne jedan. Raniji predlog „samo Starter" je pregažen.

11. ✅ **Godišnja pretplata od prvog dana**, popust = 2 meseca gratis.

12. ✅ **Dva paketa kredita.** „Dopuna 50" — €19. „Dopuna 150" — €49. Bez override-a.
    Krediti iz paketa **ne ističu** i žive u odvojenoj kasi (`profiles.credits_topup`);
    krediti iz pretplate se resetuju mesečno. Cena po kreditu je namerno **viša** nego u
    pretplati (+31% i +13% naspram Startera). Trećeg, većeg paketa nema — bio bi skuplji
    od Advanced plana za manje kredita.

13. ✅ **Nema javnog besplatnog plana.** Naplata ide od prvog dana. Plan `beta` postoji, ali
    ga dodeljujem **isključivo ja iz admin konzole** — 50 kredita i rok (30 dana
    podrazumevano, ili neograničeno). Nijedan drugi put ne sme da ga dodeli: ni
    registracija, ni kupon, ni webhook.

14. ✅ **Beta korisnici dobijaju kupon:** jedan kod `BETA2026`, **33%**, **jednokratan**
    (`recur: false`), ograničen na proizvode pretplata — ne na pakete, usage limit 50,
    ističe **31.12.2026**. Daje Starter €19,43 i Pro €39,53. Jedan procenat umesto tri koda,
    jer Paddle popust je jedan procenat na sve proizvode na koje je ograničen. Na godišnjem
    planu pokriva **celu prvu godinu**, što gura beta korisnika ka godišnjoj pretplati.

15. ✅ **Prestanak plaćanja.** Pristup do kraja plaćenog perioda, pa **30 dana samo za
    čitanje** — postojeći prospekti, pipeline i izvoz oba rade; pretraga, skeniranje i
    otključavanje ne. Posle toga ulaz vodi na cenovnik. Otključani prospekti i pipeline se
    **nikad ne brišu**. Šest stanja pristupa je u `LANSIRANJE.md` §1.5.

16. ✅ **Da li je plan dovoljan za aktivnog frilensera?** Starter = do 100 prospekata
    mesečno, ili 50 prospekata uz 25 standardnih skeniranja, ili 100 brzih skeniranja —
    korisnik bira, a svaka kombinacija košta približno isto. Provera na beta podacima ostaje.

17. ✅ **Nema popusta** osim kupona za beta korisnike.

### Otvoreno

Nema. P1–P9 su zatvorena; puna obrazloženja su u `docs/LANSIRANJE.md` §1 i §4.

---

## 3. Naplata — tehnika i provajder

18. ✅ **[NAPLATA] Provajder: Paddle**, domaći račun ručno za manjinu (firme sa PIB-om,
    DinaCard-only kupci). **Polar je napušten** — katalog, checkout i ekran cena su
    napravljeni na Paddle-u. Model je isti (merchant of record), pa cela analiza iz
    `naplata-paddle.md` važi; razlika je što **Paddle ne podržava RSD**, pa su cene za
    Srbiju EUR override na zemlju `RS`, ne dinari.
    **I dalje uslovno:** čeka pisani odgovor knjigovođe o fiskalizaciji (korak R18 u
    `docs/LANSIRANJE.md`). To je i dalje akcija broj jedan — nula koda, a sve blokira.

19. **[NAPLATA] Ko je knjigovođa i da li razume digitalne usluge?** Pitanja iz
    `naplata-paddle.md` §9 nisu za prosečnog paušalskog knjigovođu. Ako sadašnji ne ume da
    odgovori pisano na pitanja 17, 18 i 26 (fiskalizacija + test samostalnosti), treba
    poreski savetnik za jednokratnu konsultaciju — to košta manje od jedne pogrešne godine.

20. **[NAPLATA] Fallback za DinaCard-only kupce.** Deo ciljne grupe (mladi frilenseri) ima
    samo DinaCard, koja preko Paddle-a ne prolazi. Odlučeno je „IPS QR na zahtev, ručno" —
    ali kako taj put izgleda u UI-u? Dugme „Plati uplatnicom — javi se" na ekranu cena,
    ili se ne pominje dok neko ne pita? Nevidljiva opcija = izgubljen kupac koji ne pita.

21. **[NAPLATA] Politika povraćaja — napisana pre prve prodaje.** Nepregovarljivo po
    `naplata-paddle.md` §6: Paddle sme sam da odobri povraćaj u 60 dana, mimo tvoje politike.
    Odluke: rok (14 dana? 30?), da li se vraća srazmerno potrošenim kreditima, šta sa već
    otključanim kontaktima (vrednost je isporučena i ne može da se „vrati"). Predlog:
    povraćaj u punom iznosu ako je potrošeno < X kredita, inače srazmerno; napisati na
    srpskom i engleskom.

22. ⚠️ **[NAPLATA] `admin_adjust_credits` NE podnosi negativan balans — provereno.**
    Vraća `'balans bi bio negativan'` i odbija. Povraćaj paketa čiji su krediti potrošeni
    danas pada. Ispravlja se u S16 (`docs/LANSIRANJE.md`). Ostaje pitanje: Refund posle
    potrošenih kredita vodi balans ispod nule (`naplata-paddle.md` §6). Proveriti da RPC to
    dozvoljava i da UI prikaže negativan broj razumno, a ne NaN ili sakriveno.

23. **[NAPLATA] KYC na Paddle-u — pokrenut na vreme?** Do 14 dana. Pokreće se **paralelno**
    sa razvojem naplate, ne posle. Uz to: reverse-invoice podešavanja (naziv, PIB,
    numeracija) se zaključavaju **pre prve isplate** i posle se ne menjaju — numeraciju
    uskladiti sa knjigovođom unapred.

24. **[NAPLATA] Test kupovina sopstvenom karticom pre lansiranja.** Uključuje proveru da li
    tvoja banka lepi naknadu za „plaćanje u inostranstvu" iako je iznos u RSD
    (`naplata-paddle.md` §4.2) — ako lepi, kupci će to videti i pitati.

---

## 4. Prelaz beta → naplata

25. **[BETA] Koliko beta tačno traje i šta je okidač kraja?** „30 dana posle otvaranja"
    stoji u ROADMAP-u za odluku, ali odluka ≠ kraj bete. Da li beta traje dok naplata ne
    proradi (KYC + razvoj = još 3–4 nedelje posle odluke)? Datum ili uslov — jedno od ta
    dva mora da se kaže korisnicima unapred (`KRAJ_BETE` konstanta već kaže 2026-12-31 za
    pitanja — da li je to i zvaničan kraj bete?).

26. ✅ **[BETA] Kriterijum odluke o naplati.** Odlučeno (`00-kontekst.md` §2): povratak
    drugi put + medijana odgovora o ceni; ispod 1.500 RSD → interni alat. Potvrdi da su
    oba merljiva od prvog dana bete: pitanje `cena` je u katalogu ✅, povratak drugi put
    mora da bude jedan od 5 SQL upita iz F8 §5.

27. **[BETA] Koliko beta korisnika je dovoljno za validnu odluku?** Plan je 5 → 20.
    Medijana od 7 odgovora je anegdota. Definisati minimum (npr. ≥ 15 odgovora na pitanje
    o ceni i ≥ 20 naloga starijih od 2 nedelje) — inače se odluka donosi na osećaj a
    dokumenti postaju pozorište.

28. **[BETA] Šta je plan ako se beta korisnici registruju i ne vrate?** To je najverovatniji
    ishod prvog kruga. Ko ih zove/piše im, posle koliko dana, i da li je to automatski mejl
    ili lična poruka? (Za 20 ljudi: lična poruka, uvek.)

---

## 5. Proizvod — spremnost za tuđe oči

29. **[BETA] Može li čovek koji te ne poznaje da prođe registracija → prva lista → prvi
    unlock bez ijednog pitanja?** Kriterijum iz ROADMAP Faze B. Test: posadi nekoga ko
    proizvod nikad nije video, ćuti i gledaj. Jedno posmatranje vredi više od deset
    pretpostavki o onboardingu.

30. **[BETA] Šta korisnik vidi kad je baza za njegov grad/nišu prazna?** Prvi korisnici će
    pogađati kombinacije kojih u kešu nema. Prazan rezultat sa jasnim „skeniraj sada (2
    kredita)" je prodajni momenat; prazan ekran je kraj sesije. Pitanje `prazan-rezultat`
    postoji ✅ — ali šta sam ekran nudi?

31. **[BETA] Da li je jasno šta je besplatno a šta troši kredite — PRE klika?** Pretraga iz
    keša besplatna i neograničena; skeniranje 2 kredita; unlock 1. Ako korisnik i jednom
    potroši kredit a da nije razumeo da će ga potrošiti, poverenje je otišlo. Proveriti da
    svaki plaćeni klik ima cenu napisanu na samom dugmetu ili uz njega.

32. **[BETA] Postoji li stranica/sekcija „Kako radi" + FAQ?** Minimalno: šta je Ugly Score
    (bez otkrivanja težina), odakle podaci, koliko su sveži (TTL 30 dana — ovo je i
    obećanje kvaliteta), šta znači skeniranje, šta su krediti. Bez ovoga svaki beta
    korisnik postavlja ista pitanja tebi lično.

33. **[BETA] Kuda korisnik prijavljuje problem i šta mu se obećava?** Sistem utisaka
    postoji ✅ (F10/F11). Ali za beta odnos treba i direktan kanal — mejl adresa
    (podrska@sajtoskop.com?), i interno obećanje odgovora (24h u beti?). Odlučiti i
    napisati u futer.

34. **[BETA] Da li su svi tekstovi koje korisnik vidi na srpskom, uključujući Clerk
    ekrane, mejlove i greške?** Clerk ima lokalizaciju — da li je uključena? Engleski
    „Verify your email" usred srpskog proizvoda ubija utisak zanatske ozbiljnosti koju
    dizajn sistem gradi.

35. **[BETA] Radi li sve na telefonu?** Frilenser će pola sesija imati na telefonu, a
    outreach (Viber!) se dešava sa telefona. Čeklista „≤ 390 px" postoji po sesijama —
    ali je li ceo tok registracija → pretraga → unlock → kopiranje poruke → Viber prošao
    na stvarnom telefonu?

36. **[BETA] Šta se dešava kad dnevni Places budžet pukne usred bete?** Mehanika postoji ✅
    (`api_budget`, `partial: true`). Pitanje je UX i komunikacija: šta korisnik vidi
    („dnevna kvota skeniranja je potrošena, pokušaj sutra"?) i da li ti stiže obaveštenje
    da se to desilo, pre nego što ti kaže korisnik.

37. **[POSLE] Eksport — u kom formatu i sa čim?** CSV postoji od F4. Da li beta korisnici
    traže nešto drugo (Excel sa ćirilicom bez raspada encodinga, Google Sheets)? Pitati, ne
    graditi unapred.

---

## 6. Troškovi i jedinična ekonomija

38. **[BETA] Koliki je maksimalan mesečni trošak bete u najgorem slučaju, u evrima?**
    20 korisnika × 50 kredita × najgori miks (sve skeniranja = 75 Places poziva po
    korisniku) + Claude na unlockove + fiksno (Hetzner, Vercel, Supabase, Clerk, Resend,
    domen). Izračunati JEDAN broj i odlučiti: da li je prihvatljiv kao trošak učenja?
    Ako nije — kapovi se stežu sada, ne kad stigne račun.

39. ✅ **[NAPLATA] Bruto margina — izračunata** u `docs/LANSIRANJE.md` §1.3. Najgori slučaj
    (svi krediti na duboka skeniranja koja promašuju keš): **11% Starter, 16% Pro, 22%
    Advanced**. Uz Paddle naknadu (~8%) bruto margina je **70–80% na sva tri plana**.
    Raniji tekst je računao sa 3.400 RSD i Polarom i više ne stoji: 3.400 RSD − Paddle (~8,4%)
    − najgori slučaj potrošnje kredita (150 kredita = do 225 Places poziva ako je sve
    skeniranje? proveriti realan miks) − Claude − srazmerni deo infrastrukture. Ako je
    margina ispod ~70% kod prosečne potrošnje, cena ili krediti se koriguju pre lansiranja.

40. **[NAPLATA] Šta ograničava korisnika koji potroši sve kredite na najskuplji način?**
    Dnevni cache-miss limit postoji ✅. Proveriti i da 1.000 besplatnih Places poziva
    mesečno + rast broja korisnika imaju definisan prag na kom se uključuje plaćeni Google
    tier — i da li je taj trošak u ceni plana.

41. **[BETA] Postoji li plafon za Claude/AI trošak po korisniku i ukupno?**
    `AI_OUTREACH_DAILY_CAP` postoji ✅. Proveriti da isti tip kapa pokriva i vision analizu
    na unlock, i da postoji ukupan mesečni „circuit breaker" (npr. alarm na X evra API
    troška).

42. **[POSLE] Na kom broju korisnika pucaju CX22 worker i Supabase free/pro tier?**
    Ne optimizovati sada — samo znati broj, da se rast ne dočeka rušenjem.

---

## 7. Pravno i privatnost

43. **[BETA] Uslovi korišćenja i Politika privatnosti — ko ih piše i šta pokrivaju?**
    ROADMAP Faza B ih traži. Ključne klauzule za OVAJ proizvod: podaci se pružaju „kakvi
    jesu" (bez garancije tačnosti Google podataka), zabrana masovnog spama kroz alat,
    zabrana preprodaje podataka, prekid naloga za zloupotrebu, izmena uslova. ZZPL: pravni
    osnov obrade, prava lica, rok čuvanja. Da li ih pišeš sam (uz šablon + AI) pa daš
    advokatu na pregled, ili ceo posao advokatu? Za betu: pregled advokata je minimum.

44. **[BETA] ZZPL status podataka o biznisima — kontakt podaci su lični podaci.** Telefon i
    mejl preduzetnika (fizičkog lica koje obavlja delatnost) jesu podaci o ličnosti po
    ZZPL. Obrađuješ ih po legitimnom interesu (javno objavljeni poslovni kontakti, B2B
    svrha) — ali to mora da stoji u Politici privatnosti, i mora da postoji **kanal za
    prigovor/uklanjanje** (v. sledeće pitanje). Ovo je pitanje za advokata, ne za osećaj.

45. **[BETA] Šta se dešava kad se javi biznis iz baze i traži uklanjanje?** Desiće se.
    Treba: mejl kanal, definisan postupak (uklanjanje iz rezultata? oznaka `opted_out`?),
    rok odgovora, i tehnička mogućnost da se `place_id` trajno isključi iz servisa. Ako
    postupka nema, prvi ljutiti vlasnik firme je prvi pravni rizik.

46. **[BETA] Google Places ToS — da li je trenutna upotreba u okviru dozvoljenog?**
    TTL 30 dana ✅ i trajni `place_id` ✅ prate pravila keširanja. Ali proveriti još dve
    stvari pre nego što proizvod postane javan: prikaz Google podataka bez mapa (atribucija?)
    i kombinovanje sa sopstvenim auditima. Rizik nije tužba nego gašenje API ključa — što
    je smrt proizvoda preko noći. Vredi jedan pažljiv prolaz kroz Places ToS sa listom
    „šta tačno radimo".

47. **[BETA] Da li generisane outreach poruke guraju korisnike u kršenje pravila o
    neželjenoj pošti?** Poruka koju korisnik sam šalje svojim kanalom je njegova
    odgovornost — ali alat ne sme da je podstiče na masovnost (bulk slanje NIJE u
    proizvodu ✅ — tako i ostaje; to je i pravna i pozicijska odluka koju vredi zapisati
    u uslove korišćenja).

48. **[NAPLATA] Ugovorni odnos sa kupcem: šta kupac tačno kupuje?** Pretplata na pristup
    bazi i alatima, ne „vlasništvo nad podacima". Definisati u uslovima: šta sme sa
    eksportovanim podacima, šta ostaje tvoje (`website_audits` je tvoja IP ✅).

49. **[POSLE] Zaštita žiga „Sajtoskop" i „Ugly Score"?** Nije hitno; zapisati kao stavku
    da se proveri bar da li je neko drugi registrovao slično.

---

## 8. Marketing i akvizicija

50. **[BETA] Odakle dolazi prvih 20 korisnika, imenom i prezimenom?** „5 ljudi lično, pa
    20" iz ROADMAP-a. Konkretna lista: ko su tih 5? Iz kojih zajednica dolazi sledećih 15
    (FB grupe za frilensere/dizajnere, LinkedIn, Discord serveri, lokalni IT meetup-i)?
    Ako lista ne postoji, otvaranje bete je objava u prazno.

51. **[BETA] Šta landing mora da ima na dan otvaranja?** F8 kaže: hero sa stvarnim brojkama
    iz seed skenova + FAQ. Minimum koji prodaje: rečenica iz pitanja 1, brojke (58%…),
    screenshot proizvoda (pravi, ne mockup), poziv na betu, pravni tekstovi u futeru.
    Šta je CTA — „registruj se" otvoreno ili pozivnice/waitlist? (Pozivnice postoje u
    adminu ✅ — odlučiti da li je beta otvorena ili invite-only. Invite-only štedi budžet
    i pravi ekskluzivnost; otvorena daje više podataka.)

52. **[BETA] Kako se meri odakle je ko došao?** Bar UTM parametri + pitanje pri
    registraciji („gde si čuo za Sajtoskop?") ili ručna evidencija za prvih 20. Bez ovoga
    Faza C nema podatak koji kanal radi.

53. **[NAPLATA] Koja je priča lansiranja naplate?** „Beta se završava, hvala + founding
    cena za vas" je mejl koji se piše unapred. Ko ga dobija, kada, sa kojim rokom za
    founding uslove?

54. **[POSLE] Content/SEO strategija.** Podaci su sadržaj koji niko drugi nema: „X% firmi
    u [grad] nema upotrebljiv sajt" je članak/objava koja se sama deli i privlači tačno
    ciljnu publiku. Odlučiti posle bete da li je to kanal — ali seed izveštaji se čuvaju
    već sada kao sirovina.

55. **[POSLE] Referral — da li postojeći sistem kredita može da ga nosi?** „Pozovi kolegu,
    obojica dobijate X kredita" je prirodan za ovaj proizvod i za ovu publiku (frilenseri
    se znaju međusobno). Ne graditi sada; zapisati.

---

## 9. Metrike i analitika

56. **[BETA] Kojih 5 brojki gledaš svako jutro tokom bete?** F8 §5 definiše: registracije,
    aktivacija (prva pretraga), prvi unlock, povratak drugi dan, prosečne pretrage.
    Potvrditi da su svih 5 čitljive jednim upitom (ili na `/admin` pregledu ✅ —
    proveriti šta od toga pregled već pokazuje).

57. **[BETA] Šta je definicija „aktiviran korisnik"?** Predlog: napravio prvu pretragu +
    otvorio bar jedan rezultat. Bez precizne definicije se „aktivacija" računa svaki put
    drugačije i brojke iz dve nedelje nisu uporedive.

58. **[BETA] Koja je North Star metrika?** Kandidat: **broj otključanih leadova nedeljno** —
    meri i vrednost za korisnika i put ka prihodu, bolje nego registracije ili pretrage.
    Odlučiti jednu; sve ostale su dijagnostika.

59. **[BETA] Da li postoji ikakva analitika ponašanja na landingu i u aplikaciji?**
    Serverske metrike postoje; za landing treba bar posete → registracije konverzija
    (Vercel Analytics? Plausible? — odluka i zbog privacy politike, GA4 povlači cookie
    banner koji Plausible ne povlači).

60. **[POSLE] Praćenje ISHODA korisnika — da li je neko potpisao klijenta?** Pitanje
    `prvi-potpisan` postoji ✅. To je testimonial mašina i dokaz ROI-ja („platio 3.400,
    potpisao posao od 60.000") — plan: od prvog potpisanog tražiti dozvolu za citat.

---

## 10. Operacije, podrška i pouzdanost

61. **[BETA] Šta se dešava kad worker padne u 2 ujutru?** Skeniranja vise u redu; ko sazna
    prvi — ti ili korisnik? Minimum za betu: uptime ping na worker (healthcheck fajl/red
    star više od X min → mejl), i isti alarm za pukotinu budžeta. Odlučiti alat
    (UptimeRobot/Hetzner alert/cron mejl — bilo šta, ali nešto).

62. **[BETA] Backup baze — postoji li i da li je isproban restore?** Supabase ima
    automatske backupe po planu — proveriti šta tačno tvoj plan daje (PITR ili dnevni),
    i jednom probno vratiti bazu u staging. Backup koji nikad nije vraćen je nada, ne
    backup. `website_audits` je imovina proizvoda — nju je najskuplje izgubiti.

63. **[BETA] Koliko vremena dnevno realno imaš za podršku i ko te menja kad te nema?**
    Solo osnivač: odmor, bolest, dan posla za klijenta. Za betu je odgovor „niko, ali
    očekivanja su postavljena" — zato rok odgovora iz pitanja 33 mora da bude realan
    (24–48h, ne „odmah").

64. **[BETA] Runbook za tri najverovatnija kvara.** Places 429/gašenje ključa, Supabase
    nedostupan, worker mrtav. Po pola strane: kako se prepoznaje, šta se radi, šta se kaže
    korisnicima. Piše se sada dok je mirno, čita se kad gori.

65. **[NAPLATA] Šta korisnik vidi kad plaćanje padne (dunning)?** Kartica istekla, banka
    odbila. Paddle ima retry logiku (sandbox 3× za 15 min, produkcija 60× za 3 dana) — proveriti šta aplikacija radi, i šta aplikacija pokazuje u
    međuvremenu (grace period pre pada na besplatno?).

66. **[POSLE] Status stranica / obaveštenja o radovima.** Za 20 beta korisnika: poruka u
    aplikaciji je dovoljna. Zapisati kao stavku za posle.

---

## 11. Bezbednost i zloupotreba

67. ✅ **[BETA] Kanarinci u bazi.** Odlučeno (F8 §4): 5–10 lažnih biznisa sa
    fingerprintima za detekciju krađe baze. Potvrditi da su ubačeni pre prvog stranog oka.

68. **[BETA] Šta se dešava kad neko napravi 5 naloga za 5× besplatnih kredita?** Clerk
    zna mejl i telefon — da li je telefon obavezan pri registraciji (dobar filter, ali i
    trenje)? Za betu sa pozivnicama problem ne postoji; za otvorenu betu odlučiti bar
    detekciju (isti IP/fingerprint → oznaka u adminu, ne automatska blokada).

69. **[BETA] Rate limiti na javnim rutama — prošli kroz P0/P1 listu?** `bezbednost.md`
    P0 lista ✅ i S9 (P1) ✅ su rađeni. Pre otvaranja: jedan prolaz kroz listu sa svežim
    očima, posebno rute koje troše novac (scan, unlock, AI poruke) i webhook rute.

70. **[NAPLATA] Anomalija detekcija pre naplate.** ROADMAP Faza C pominje „300 unlocka/sat"
    i deljenje naloga. Za start: alarm adminu, ne automatika.

71. **[BETA] Da li je scraping tvoje aplikacije otežan?** Neko će probati da izvuče bazu
    kroz UI. Zaključana polja ne postoje u API odgovoru ✅ (pravilo 9) — to je glavna
    odbrana. Proveriti još: paginacija ima razuman plafon, nema rute koja vraća „sve".

---

## 12. Dan lansiranja — checklist odluka

72. **[BETA] Koji je datum otvaranja bete i šta ga uslovljava?** Nabrojati blokere poimence
    (F8 landing, pravni tekstovi, kanarinci, onboarding, metrike — po ROADMAP Fazi B) i
    staviti datum. Bez datuma je „još samo da doteram X" beskonačno.

73. **[BETA] Go/no-go lista za dan otvaranja.** Predlog minimuma: svih 5 tokova prošlo na
    produkciji sa čistim nalogom (registracija, pretraga keš, skeniranje, unlock, poruka →
    Viber/mejl); obe teme; telefon; pravni tekstovi linkovani; alarmi žive; backup
    proveren; `ADMIN_BOOTSTRAP_IDS` postavljen; Clerk webhook događaji štiklirani
    (ručni koraci iz SESIJE.md!); budžet kapovi provereni.

74. ✅ **[NAPLATA] Go/no-go lista je spojena sa danom lansiranja** — naplata ide od prvog
    dana (odluka D1), pa nema dva odvojena datuma. Lista je u `docs/LANSIRANJE.md` §8.
    Raniji tekst, i dalje tačan po sadržaju: Pisani odgovor knjigovođe (fiskalizacija +
    test samostalnosti); Paddle nalog odobren za produkciju; reverse-invoice podešen; politika povraćaja
    objavljena; sandbox prošao sve događaje uključujući refund; test kupovina pravom
    karticom; founding-mejl spreman; cena potvrđena naspram beta medijane.

---

## Deset pitanja koja samo ti možeš da odgovoriš (počni od njih)

Sve ostalo iznad je izvedivo ili proverivo; ovih deset su čiste odluke:

1. Ko je primarna publika za prvih 20 korisnika — frilenseri ili agencije? (pitanje 2)
2. Otvorena beta ili invite-only? (51)
3. ✅ Beta je ručna, sa rokom po nalogu; founding korisnici dobijaju kupon. (D1, D5)
4. ✅ Tri plana: Starter, Pro, Advanced. (D3)
5. ✅ Nema javnog besplatnog plana; `beta` postoji samo kao ručni izuzetak. (D1, D5)
6. ⏳ Da li su pitanja poslata knjigovođi? Ako ne — to je i dalje prvi sledeći potez.
   (pitanje 18; korak R18 u `docs/LANSIRANJE.md`)
7. Ko piše/pregleda pravne tekstove i do kada? (43)
8. Koliki je prihvatljiv mesečni trošak bete u evrima? (38)
9. Koja je North Star metrika? (58)
10. Spisak od 20 imena/mesta odakle dolaze beta korisnici? (50)
