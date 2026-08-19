# Plan mejlova — šta se šalje, kada i zašto

**Šta je ovo:** kompletna mapa mejlova koje korisnik dobija, od registracije do otkazivanja
pretplate. Za svaki mejl: okidač, trenutak slanja i kratko objašnjenje svrhe. Tekstovi i
dizajn se pišu kasnije, mejl po mejl — ovaj dokument samo fiksira **koji mejlovi postoje i
kada idu**, da se sekvenca ne izmišlja u hodu.

**Oznake prioriteta** (isti sistem kao `LANSIRANJE-PITANJA.md`):

- **[BETA]** — mora da postoji pre otvaranja bete
- **[NAPLATA]** — mora da postoji pre prve naplaćene pretplate
- **[POSLE]** — sme da sačeka; zapisan da se ne zaboravi

**Napomena o opsegu:** `00-kontekst.md` §7 kaže da „mejl kampanje" nisu u opsegu do kraja
bete. To važi za marketinške kampanje ka spoljnom svetu — ne za transakcione i lifecycle
mejlove postojećim korisnicima, koji su deo proizvoda (podsetnik na dan 3 već postoji od F10).

---

## 0. Infrastruktura i pravila — pre prvog novog mejla

| Pravilo | Zašto |
|---|---|
| **Svaki mejl ide kroz `lib/mail.ts`** | Jedini izlaz ka Resend-u već postoji (tajmaut, header-injection provera, čišćenje ključa iz grešaka). Ne prave se paralelni putevi. |
| **Sve na srpskom, latinica, sa dijakritikom** | Pravilo jezika iz `CLAUDE.md`. Uključuje i Clerk mejlove — proveriti lokalizaciju (pitanje 34 iz `LANSIRANJE-PITANJA.md`). |
| **Terminologija iz `CLAUDE.md`** | prospekt, otključaj, skeniranje, krediti, utisak, prijava, Beta dnevnik. Nikad „lead", „feedback", „anketa". |
| **Tabela `email_log` (nova migracija)** | `(user_id, email_key, sent_at)` sa unique po `(user_id, email_key)` za jednokratne mejlove. Bez ovoga onboarding sekvenca šalje duplikate posle svakog restarta crona. |
| **Odjava za sve što nije transakciono** | Onboarding, digest, novosti i win-back nose link za odjavu (kolona `profiles.email_opt_out` ili granularnije). Transakcioni mejlovi (potvrde, krediti, prijave) su izuzeti. |
| **Zakazano slanje ide iz workera ili cron rute** | Playwright pravilo ne važi ovde, ali princip da: Vercel funkcija ne sme da „čeka dan 3". Cron ruta jednom dnevno pita bazu „kome danas šta sleduje" — isti obrazac kao podsetnik iz F10. |
| **`Reply-To` na moju adresu na svakom mejlu** | Beta odnos je lični; odgovor na bilo koji mejl mora da stigne meni, ne u no-reply rupu. |
| **Jedan mejl dnevno po korisniku, maksimum** | Ako se u istom danu stekne više okidača (npr. krediti pri kraju + podsetnik), šalje se samo važniji. Prioritet: transakcioni > onboarding > retencija. |

---

## 1. Nalog i autentifikacija (šalje Clerk)

Ove mejlove ne pišem ja — ali moram da ih **lokalizujem i proverim**.

| # | Mejl | Okidač | Prioritet | Objašnjenje |
|---|---|---|---|---|
| 1.1 | **Potvrda mejl adrese** (verifikacioni kod) | registracija | [BETA] | Clerkov mejl. Uključiti srpsku lokalizaciju — „Verify your email" usred srpskog proizvoda ubija utisak. |
| 1.2 | **Reset lozinke** | zahtev korisnika | [BETA] | Clerkov mejl, ista priča sa lokalizacijom. |
| 1.3 | **Pozivnica u betu** | admin pošalje iz konzole | [BETA] ✅ | Već postoji (S5): šalje se mojim Resend-om, ne Clerkovim šablonom, sa ličnom porukom. |
| 1.4 | **Pristup za otvoren nalog** | admin otvori nalog korisniku | [BETA] ✅ | Već postoji (S5), sa generisanom lozinkom. |

---

## 2. Onboarding sekvenca (prvih 7 dana)

Cilj sekvence: dovesti korisnika do „aha momenta" (prva lista sa Katastrofa bendovima) i do
prvog otključavanja. Sekvenca je **uslovna** — ako je korisnik korak već uradio, mejl za taj
korak se preskače ili menja sadržaj. Zato svaki mejl ima okidač i uslov.

| # | Mejl | Kada | Uslov | Prioritet | Objašnjenje |
|---|---|---|---|---|---|
| 2.1 | **Dobrodošlica** | odmah po registraciji (ili < 1 h) | uvek | [BETA] | Ton ličnog pisma, ne korporativni šablon: šta je Sajtoskop u jednoj rečenici, imaš 50 kredita, pretraga keša je besplatna i neograničena, skeniranje 2 kredita — i JEDAN poziv na akciju: „napravi prvu pretragu". Potpisan ja, sa pravim Reply-To. |
| 2.2 | **Aktivacioni podsetnik** | dan 2 | nije napravio nijednu pretragu | [BETA] | Najverovatniji ishod prvog kruga bete je „registrovao se i nestao" (pitanje 28 iz `LANSIRANJE-PITANJA.md`). Kratak, ličan: „probaj svoj grad + svoju nišu, evo šta ćeš videti" + stvarna brojka (58% PVC stolarija u Šapcu bez sajta). Za prvih 20 korisnika ovaj mejl može biti i ručna lična poruka — šablon svejedno treba. |
| 2.3 | **Kako se čita Ugly Score** | dan 3 | napravio bar jednu pretragu | [BETA] | Tutorijal: bendovi (Solidan → Katastrofa), zašto su NEMA SAJT i MRTAV najbolji prospekti, šta znači TTL od 30 dana (svežina kao obećanje kvaliteta). Gradi poverenje u brojku koja je srce proizvoda. |
| 2.4 | **Prvo otključavanje** | dan 4–5 | ima pretrage, nema nijedan unlock | [BETA] | Objasni šta se dobija za 1 kredit: telefon, mejl, screenshot, konkretna lista problema, spremna poruka. Snimak ekrana otključanog prospekta u mejlu. Ovo je most preko najvažnijeg praga konverzije. |
| 2.5 | **Od prospekta do posla** (outreach + pipeline) | dan 7 | ima bar 1 unlock | [BETA] | Tutorijal: generisana poruka, slanje na Viber (mobilni prefiks!) ili mejl, vođenje kroz kanban kolone. Zatvara priču „alat → potpisan klijent". |
| 2.6 | **Nedelju dana — kako ti se čini?** | dan 8–10 | aktivan bar jednom posle dana 1 | [BETA] | Lični mejl bez šablona i bez dugmadi: „šta ti smeta, šta fali?". Dopuna in-app utisaka — neki ljudi pišu mejl a nikad ne klikću ankete u aplikaciji. Odgovori idu direktno meni. |

**Napomena:** podsetnik na dan 3 iz F10 (utisak) se **stapa** sa 2.3 ili pomera, da korisnik
ne dobije dva mejla istog dana — vidi pravilo „jedan mejl dnevno".

---

## 3. Događajni mejlovi (šalju se kad se nešto desi)

| # | Mejl | Okidač | Prioritet | Objašnjenje |
|---|---|---|---|---|
| 3.1 | **Prijava obrađena** (utisak sa statusom) | admin promeni status prijave u konzoli | [BETA] | Zatvaranje petlje iz F11.4: „tvoja prijava je rešena / u radu", plus red o nagradi ako su dodeljeni krediti (+10 za potvrđen bug). Najjači mejl za odnos sa beta korisnicima — pokazuje da prijave neko stvarno čita. Proveriti šta od ovoga F11.4 već šalje, pa dopuniti, ne duplirati. |
| 3.2 | **Krediti pri kraju** | balans padne na ≤ 20 % plana (10 od 50) | [BETA] | Jednom po mesecu, ne na svaki unlock. U beti je i signal engagementa („potrošio si skoro sve — super, javi šta misliš"); posle naplate postaje upsell tačka za paket kredita. |
| 3.3 | **Krediti dopunjeni** | mesečni grant (1. u mesecu) | [POSLE] | „Stiglo ti je novih 50 kredita." Mali, ali vraća neaktivne — razlog da se ovog meseca opet uloguje. U beti opciono; posle naplate praktično obavezan (čovek je platio, neka zna šta je dobio). |
| 3.4 | **Skeniranje završeno sa delimičnim rezultatom** | `partial: true` (pukao budžet/429) | [POSLE] | Korisnik obično gleda ekran dok se skenira, pa je in-app poruka primarna. Mejl tek ako se pokaže da ljudi zatvaraju tab. Ne graditi unapred. |
| 3.5 | **Prospekti čekaju u pipeline-u** | X prospekata > 7 dana u „Nekontaktiran" | [POSLE] | Podsetnik vezan za korisnikov posao, ne za moj proizvod: „otključao si 8 firmi, 5 još nisi kontaktirao". Vrednost mejla je što gura korisnika ka NJEGOVOM rezultatu (potpisan klijent) — a to je i moja retencija. |

---

## 4. Retencija i angažman

| # | Mejl | Kada | Prioritet | Objašnjenje |
|---|---|---|---|---|
| 4.1 | **Win-back** | 14 dana bez ijednog logina | [BETA] | Par mejlova ove vrste u beti vredi više od ankete: „šta te je zaustavilo?" — iskren, jedna rečenica, bez popusta i trikova. Uparen sa in-app pitanjem `zasto-ne-vracas` (koji neaktivan korisnik po definiciji ne vidi — zato mejl). Šalje se JEDNOM, ne ponavlja se. |
| 4.2 | **Beta dnevnik — novosti** | na ~2 nedelje, ručno okinut | [BETA] | Digest objava iz `changelog` tabele: šta je novo, šta je popravljeno (posebno stvari koje su korisnici sami prijavili — „tražili ste, uradio sam"). Beta korisnici moraju da vide da se proizvod kreće. Ručno okidanje iz admin konzole, ne automatski cron — šalje se kad ima šta da se kaže. |
| 4.3 | **Nedeljni pregled** (digest) | ponedeljkom ujutru | [POSLE] | „U tvojim pretragama prošle nedelje: X novih firmi, Y palo u Katastrofu." Zahteva praćenje promena po korisnikovim pretragama — to je praktično Radar iz „nije u opsegu" liste. Zapisano da se ne zaboravi; ne gradi se pre kraja bete. |
| 4.4 | **Priča o rezultatu** | ručno, kad korisnik prijavi potpisan posao (`prvi-potpisan`) | [POSLE] | Lični mejl: čestitka + molba za dozvolu da citiram („platio 3.400, potpisao posao od 60.000"). Testimonial mašina iz pitanja 60 `LANSIRANJE-PITANJA.md`. Ručno, jer je ovakvih događaja malo i svaki je zlato. |

---

## 5. Prelaz beta → naplata

Ovi mejlovi se **pišu unapred** (pitanje 53 iz `LANSIRANJE-PITANJA.md`), a šalju kad padne
odluka o naplati. Redosled i razmaci su deo obećanja „besplatno do kraja bete, ne zauvek".

| # | Mejl | Kada | Prioritet | Objašnjenje |
|---|---|---|---|---|
| 5.1 | **Najava kraja bete** | ~30 dana pre kraja bete | [NAPLATA] | Fer najava: kad se beta završava, šta se menja, šta beta korisnici dobijaju (founding uslovi). Niko ne sme da sazna za naplatu tako što mu nešto prestane da radi. |
| 5.2 | **Founding ponuda** | na dan otvaranja naplate | [NAPLATA] | „Hvala što si bio tu od početka" + konkretna founding cena/uslovi sa rokom. Sadržaj zavisi od odluke iz pitanja 14 `LANSIRANJE-PITANJA.md` (trajan popust / X meseci gratis). |
| 5.3 | **Podsetnik isteka founding roka** | 3 dana pre isteka ponude | [NAPLATA] | Jedan podsetnik, ne kampanja od pet mejlova. Rok bez podsetnika nije rok. |

---

## 6. Naplata i pretplata (posle uvođenja Polara)

**Šta šalje Polar, ne ja:** račun/potvrdu plaćanja kupcu, potvrdu otkazivanja iz portala,
svoje dunning mejlove za neuspelu naplatu (proveriti u sandboxu šta tačno šalje i na kom
jeziku — pitanje 65 iz `LANSIRANJE-PITANJA.md`). Moji mejlovi dole pokrivaju ono što Polar
ne zna: stanje kredita i plana u aplikaciji.

| # | Mejl | Okidač (webhook) | Prioritet | Objašnjenje |
|---|---|---|---|---|
| 6.1 | **Pretplata aktivirana** | `subscription.active` | [NAPLATA] | Potvrda iz aplikacije: plan, broj kredita, datum obnove. Račun je Polarov posao; ovaj mejl kaže „krediti su ti na nalogu, sve radi". |
| 6.2 | **Kupljen paket kredita** | `order.paid` (credit pack) | [NAPLATA] | Ista logika: koliko kredita je leglo, koliki je balans sada. |
| 6.3 | **Problem sa naplatom** | neuspela obnova (dunning događaj) | [NAPLATA] | Polar pokušava ponovo sam — moj mejl objašnjava šta se dešava u aplikaciji u međuvremenu (grace period, kad se pristup gasi) i vodi u Polarov portal na promenu kartice. Na srpskom, jer Polarov verovatno nije. |
| 6.4 | **Pretplata se ne obnavlja** | `subscription.canceled` | [NAPLATA] | Potvrda + tačan datum do kog sve radi + **šta ostaje zauvek** (otključani prospekti i pipeline — odluka iz pitanja 15 `LANSIRANJE-PITANJA.md`). Jasnoća ovde direktno smanjuje chargebackove. |
| 6.5 | **Pretplata istekla** | `subscription.revoked` | [NAPLATA] | Šta se ugasilo, šta je ostalo, dugme za povratak. Bez dramatike i bez „žao nam je što odlaziš" patetike. |
| 6.6 | **Povraćaj obrađen** | `refund.created` | [NAPLATA] | Potvrda povraćaja + stanje kredita posle korekcije (može i negativan balans — `naplata-polar.md` §6). Bolje da korisnik pročita od mene nego da se iznenadi brojkom u aplikaciji. |

---

## 7. Administrativno i pravno

| # | Mejl | Okidač | Prioritet | Objašnjenje |
|---|---|---|---|---|
| 7.1 | **Nalog obrisan** | `user.deleted` webhook (kaskada završena) | [POSLE] | Kratka potvrda: profil, krediti i pipeline su obrisani. Šalje se na mejl koji je upravo obrisan iz baze — dakle iz samog webhook handlera, pre kaskade ili sa adresom iz payload-a. |
| 7.2 | **Promena uslova korišćenja / politike privatnosti** | ručno, uz svaku bitnu izmenu | [NAPLATA] | Pravna higijena, posebno kad se uvodi naplata (uslovi se tada sigurno menjaju). Ručno okinut, svi korisnici. |
| 7.3 | **Poruka od admina** | admin iz konzole | [BETA] ✅ | Već postoji (S5): pojedinačna poruka korisniku, 20/dan limit. |

---

## 8. Kalendar iz ugla korisnika — tipičan put

```
Dan 0   registracija ──► 1.1 potvrda mejla (Clerk) ──► 2.1 dobrodošlica
Dan 2   nije pretraživao? ──► 2.2 aktivacioni podsetnik
Dan 3   pretraživao? ──► 2.3 kako se čita Ugly Score
Dan 4–5 nema unlock? ──► 2.4 prvo otključavanje
Dan 7   ima unlock? ──► 2.5 od prospekta do posla
Dan 8+  aktivan? ──► 2.6 kako ti se čini?
Dan 14  nestao? ──► 4.1 win-back (jednom)

Stalno  prijava rešena ──► 3.1 · krediti pri kraju ──► 3.2 · novosti ──► 4.2

Kraj bete  −30 dana ──► 5.1 najava · dan D ──► 5.2 founding · rok −3 ──► 5.3 podsetnik

Pretplata  aktivacija ──► 6.1 · pad naplate ──► 6.3 · otkaz ──► 6.4 · istek ──► 6.5
```

---

## 9. Šta se gradi prvo — predlog redosleda

1. **[BETA] minimum, pre otvaranja bete:** migracija `email_log` + odjava, pa mejlovi
   2.1 (dobrodošlica), 2.2 (aktivacija), 3.1 (prijava obrađena — dopuna F11.4), i provera
   Clerk lokalizacije (1.1, 1.2). To je jedna sesija rada.
2. **[BETA] drugi krug, prve nedelje bete:** ostatak onboarding sekvence (2.3–2.6),
   3.2 (krediti pri kraju), 4.1 (win-back), 4.2 (Beta dnevnik — ručno okidanje iz konzole).
3. **[NAPLATA]:** ceo §5 (pišu se unapred, čekaju odluku) i §6 (ide uz implementaciju
   Polar webhookova — svaki mejl je jedna grana u već planiranom webhook handleru).
4. **[POSLE]:** 3.3–3.5, 4.3, 4.4, 7.1 — tek kad podaci iz bete kažu da vrede.

## 10. Otvorene odluke (za tebe)

1. **Adresa pošiljaoca:** sve sa jedne adrese (npr. `marko@sajtoskop.com`) ili razdvojiti
   transakciono (`app@`) od ličnog (`marko@`)? Za betu predlažem sve lično sa jedne.
2. **Format:** čist tekst ili HTML šablon? Za onboarding i lične mejlove predlažem skoro čist
   tekst (deluje kao pismo, bolja isporuka), HTML samo za Beta dnevnik i naplatu.
3. **Granularnost odjave:** jedan prekidač „ne šalji mi ništa osim transakcionog" ili posebno
   za novosti/tutorijale? Za betu je jedan prekidač dovoljan.
4. **Da li 2.2 (aktivacija) za prvih 20 korisnika ide ručno?** `LANSIRANJE-PITANJA.md`
   (pitanje 28) kaže: za 20 ljudi lična poruka, uvek. Šablon svejedno napisati.
