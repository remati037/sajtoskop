# Pitanja pre lansiranja — kompletna lista

**Šta je ovo:** svako pitanje na koje mora da postoji odgovor pre nego što Sajtoskop izađe
pred ljude. Nije plan rada (to je `ROADMAP.md`) nego lista odluka — jer se svaka od njih,
ako se ne donese svesno, donese sama od sebe i to obično loše.

**Kako se čita:** svaka stavka ima oznaku trenutka do kog odgovor mora da postoji:

- **[BETA]** — pre otvaranja besplatne bete (Faza B). Bez odgovora se ne otvara.
- **[NAPLATA]** — pre prve naplaćene pretplate (Faza C). Beta može bez ovoga.
- **[POSLE]** — sme da sačeka prve korisnike, ali pitanje mora da postoji da se ne zaboravi.

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

## 2. Cene, planovi i krediti

8. ✅ **[NAPLATA] Cena Starter plana.** Odlučeno: **3.400 RSD mesečno, 150 kredita, bez
   rollovera** (`naplata-polar.md` §13). Potvrditi tek naspram medijane iz beta pitanja o
   ceni — ako medijana ispadne 1.500 RSD, ovo se vraća na sto.

9. ✅ **[NAPLATA] Cena akcija u kreditima.** Odlučeno: skeniranje 2, otključavanje 1, prva
   poruka 0, „napiši drugačije" 0 uz max 3 varijante po leadu (`naplata-polar.md` §13).

10. **[NAPLATA] Da li postoji više od jednog plaćenog plana na dan uvođenja naplate?**
    `plans.ts` predviđa `starter | pro | agencija`. Predlog: lansirati **samo Starter**.
    Jedan plan = jedna odluka za kupca i nula analize „koji mi treba". Pro/Agencija se
    dodaju kad prvi korisnik udari u plafon od 150 kredita — to je signal, ne pretpostavka.
    Ali odluka mora da padne, jer određuje ekran cena.

11. **[NAPLATA] Godišnja pretplata od prvog dana ili kasnije?** Računica iz
    `naplata-polar.md` §3.3 kaže da je godišnja jeftinija i za tebe (fiksnih 50¢ jednom
    umesto 12×). Pitanja: koliki popust (standard je ~2 meseca gratis; 29.900 RSD je već
    u tabeli kao ilustracija), i da li je smisleno nuditi godišnju obavezu proizvodu koji
    kupac još nije koristio mesec dana.

12. **[NAPLATA] Paketi kredita (top-up) — postoje li i po kojoj ceni?** Tabela pominje
    2.900 RSD paket. Odluke: koliko kredita u paketu, da li krediti iz paketa ističu
    (predlog: ne ističu — plaćeni su jednokratno), i da li je cena po kreditu u paketu
    **viša** nego u pretplati (treba da bude — inače paket kanibalizuje pretplatu).

13. **[NAPLATA] Postoji li besplatan plan posle bete, ili samo probni period?** Tri opcije:
    (a) trajni free tier sa malo kredita — stalna akvizicija, ali stalan trošak i magnet za
    zloupotrebu multi-nalozima; (b) probni period 7–14 dana; (c) ništa besplatno, samo
    demo/screenshotovi na landingu. Za proizvod gde svaka akcija ima realan trošak (Places,
    Claude), (a) je najskuplja opcija — odluka mora da bude svesna, sa kapom troška po
    besplatnom nalogu.

14. **[NAPLATA] Šta dobijaju beta korisnici kad počne naplata?** Oni su prvi evangelisti i
    izvor svih podataka za odluku o ceni. Opcije: trajan popust („founding member" cena),
    X meseci gratis, samo raniji pristup. Obećanje iz bete je „besplatno do kraja bete" —
    šta tačno znači kraj bete za njih mora da se saopšti **pre** nego što počne naplata,
    ne tim danom.

15. **[NAPLATA] Šta se dešava sa nalogom koji prestane da plaća?** Krediti nestaju odmah ili
    na kraju perioda (✅ odlučeno u `naplata-polar.md` §5.3: pristup do kraja plaćenog
    perioda)? Ali dalje: da li zadržava **pristup već otključanim leadovima** i kanbanu?
    Predlog: da, zauvek — otključano je kupljeno, pipeline je njegov rad; oduzimanje toga
    je najbrži put do chargebacka. Pretraga i novi unlockovi se gase.

16. **[NAPLATA] Da li je 25 skeniranja + 50 otključavanja mesečno (150 kredita) stvarno
    dovoljno za jednog aktivnog frilensera?** Proveriti na beta podacima: kolika je stvarna
    mesečna potrošnja najaktivnijih? Plan mora da pokrije „ozbiljan korisnik radi ceo mesec",
    inače churn zbog frustracije, a ne zbog cene.

17. **[POSLE] Politika popusta.** Studenti? Neprofitne? „Javi se za popust"? Predlog: nema
    popusta osim founding-member — solo osnivač nema vreme za pregovaranje o 3.400 RSD.

---

## 3. Naplata — tehnika i provajder

18. ✅ **[NAPLATA] Provajder: Polar kao glavni tok, domaći račun ručno za manjinu.**
    Odlučeno u `naplata-polar.md` §11, ali **uslovno** — čeka tri odgovora: fiskalizacija
    (pitanja 17–18 za knjigovođu), srpski PDV (pitanje 22), pisana potvrda RSD isplate.
    **Da li su §8 i §9 poslati knjigovođi? Da li je §10 (9–11) poslato Polaru?** To je
    akcija broj jedan sa ove cele liste — nula koda, a sve blokira.

19. **[NAPLATA] Ko je knjigovođa i da li razume digitalne usluge?** Pitanja iz
    `naplata-polar.md` §9 nisu za prosečnog paušalskog knjigovođu. Ako sadašnji ne ume da
    odgovori pisano na pitanja 17, 18 i 26 (fiskalizacija + test samostalnosti), treba
    poreski savetnik za jednokratnu konsultaciju — to košta manje od jedne pogrešne godine.

20. **[NAPLATA] Fallback za DinaCard-only kupce.** Deo ciljne grupe (mladi frilenseri) ima
    samo DinaCard, koja preko Polara ne prolazi. Odlučeno je „IPS QR na zahtev, ručno" —
    ali kako taj put izgleda u UI-u? Dugme „Plati uplatnicom — javi se" na ekranu cena,
    ili se ne pominje dok neko ne pita? Nevidljiva opcija = izgubljen kupac koji ne pita.

21. **[NAPLATA] Politika povraćaja — napisana pre prve prodaje.** Nepregovarljivo po
    `naplata-polar.md` §6: Polar sme sam da odobri povraćaj u 60 dana, mimo tvoje politike.
    Odluke: rok (14 dana? 30?), da li se vraća srazmerno potrošenim kreditima, šta sa već
    otključanim kontaktima (vrednost je isporučena i ne može da se „vrati"). Predlog:
    povraćaj u punom iznosu ako je potrošeno < X kredita, inače srazmerno; napisati na
    srpskom i engleskom.

22. **[NAPLATA] Da li `admin_adjust_credits` i UI podnose negativan balans?** Refund posle
    potrošenih kredita vodi balans ispod nule (`naplata-polar.md` §6). Proveriti da RPC to
    dozvoljava i da UI prikaže negativan broj razumno, a ne NaN ili sakriveno.

23. **[NAPLATA] KYC na Polaru — pokrenut na vreme?** Do 14 dana. Pokreće se **paralelno**
    sa razvojem naplate, ne posle. Uz to: reverse-invoice podešavanja (naziv, PIB,
    numeracija) se zaključavaju **pre prve isplate** i posle se ne menjaju — numeraciju
    uskladiti sa knjigovođom unapred.

24. **[NAPLATA] Test kupovina sopstvenom karticom pre lansiranja.** Uključuje proveru da li
    tvoja banka lepi naknadu za „plaćanje u inostranstvu" iako je iznos u RSD
    (`naplata-polar.md` §4.2) — ako lepi, kupci će to videti i pitati.

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

39. **[NAPLATA] Kolika je bruto margina po Starter korisniku?** 3.400 RSD − Polar (~8,4%)
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
    odbila. Polar ima retry logiku — proveriti šta tačno radi, i šta aplikacija pokazuje u
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

74. **[NAPLATA] Go/no-go lista za dan naplate.** Pisani odgovor knjigovođe (fiskalizacija +
    test samostalnosti); Polar KYC prošao; reverse-invoice podešen; politika povraćaja
    objavljena; sandbox prošao sve događaje uključujući refund; test kupovina pravom
    karticom; founding-mejl spreman; cena potvrđena naspram beta medijane.

---

## Deset pitanja koja samo ti možeš da odgovoriš (počni od njih)

Sve ostalo iznad je izvedivo ili proverivo; ovih deset su čiste odluke:

1. Ko je primarna publika za prvih 20 korisnika — frilenseri ili agencije? (pitanje 2)
2. Otvorena beta ili invite-only? (51)
3. Datum/uslov kraja bete i šta founding korisnici dobijaju? (14, 25)
4. Jedan plan ili više na dan naplate? (10)
5. Besplatan plan posle bete: da, trial, ili ništa? (13)
6. Da li su pitanja već poslata knjigovođi i Polaru? Ako ne — to je prvi sledeći potez. (18)
7. Ko piše/pregleda pravne tekstove i do kada? (43)
8. Koliki je prihvatljiv mesečni trošak bete u evrima? (38)
9. Koja je North Star metrika? (58)
10. Spisak od 20 imena/mesta odakle dolaze beta korisnici? (50)
