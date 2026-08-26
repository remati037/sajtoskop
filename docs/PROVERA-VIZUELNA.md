# Vizuelna provera — PLAN-IZMENA (Faze 0–7) i lansiranje (S16+)

> Lista onoga što se stvarno može proveriti kroz aplikaciju i terminal posle
> svih osam faza iz `docs/PLAN-IZMENA.md` (isporuke S8–S15, migracije 0017–0021),
> uz sekcije dopisane za isporuke iz `docs/LANSIRANJE.md` (S16+, migracije 0022+).
> Grupisana po ekranima — ide se kroz app u jednom prolazu. Svaka stavka kaže
> **šta uraditi** i **šta očekivati**. Prazan kvadratić = još nije provereno.
>
> Za stavke koje traže pokvarenu mrežu/limit, radi se lokalno sa `GOOGLE_DAILY_LIMIT`
> i slično — nijedna ne traži pravi Google poziv.

---

## 1. Pretraga (`/pretraga`)

### Stanje u URL-u i Back (Faza 4, 4.3)
- [ ] Pretraži grad + nišu — adresa dobije `?grad=…&nisa=…`; osveži stranu — ista pretraga se vrati.
- [ ] Kopiraj URL, otvori u drugom tabu — isti rezultat, ista strana.
- [ ] Promeni filter („Bez funkcionalnog sajta") — u URL-u se pojavi `bezSajta=1`.
- [ ] Idi na stranu 2 — URL dobije `strana=2`; klikni Back — vraća se prethodna pretraga.
- [ ] Deljiv link koji vodi na kombinaciju koja košta: strana se učitava, traka cene kaže cenu, **nema** modal prozora — korisnik sam klikne „Pretraži".

### Reset pri promeni grada/niše (Faza 4, 4.4)
- [ ] Prikaži rezultate, pa promeni grad u comboboxu — tabela se **prazni** (ne prikazuje stari grad), traka cene se osvežava.

### Polling, traka napretka i „Proveri ponovo" (Faza 3, 3.2 · Faza 4, 4.5)
- [ ] Pokreni skeniranje kombinacije van keša — traka napretka raste kako auditi stižu.
- [ ] U DevTools → Network: `/api/job/:id` je **jedan** zahtev po krugu, a krugovi se razređuju (3 s → 10 s).
- [ ] Prebaci se u drugi tab dok scan radi — u Network tabu **nema** novih zahteva dok si na drugom tabu; vrati se — nastavlja.
- [ ] Sačekaj da čekanje istekne (ili prekini internet pa vrati): pojavi se „Traje duže nego obično" sa dugmetom **„Proveri ponovo"** — klik ga vraća na posao bez nove naplate; traka cene je sveža (kombinacija koja je stigla u keš piše „besplatno").

### Rezultati, paginacija i sumar (Faza 3, 3.4 · Faza 6, 6.1)
- [ ] Veliki grad (npr. Beograd + neka niša): lista se učitava brzo, brojke u sumaru („X bez sajta", „Y ružnih"…) tačne.
- [ ] Pređi na stranu 2 pa nazad — **isti redosled** redova (stabilna paginacija).
- [ ] Biznis koji je poslednji scan ispustio iz rezultata ne izlazi u pretrazi ni kad je kombinacija sveža (per-red TTL; teško se vidi na svežim podacima — proveri na kombinaciji koja je skenirana pre > 30 dana ako postoji).

### Otključavanje (Faza 4, 4.6 · Faza 1, 1.2)
- [ ] Otključaj lead — red se osveži sa kontaktom, balans u bočnoj traci se smanji.
- [ ] Isprazni kredite pa pokušaj otključavanje — poruka o neuspehu stoji **odmah iznad tabele**, ne na vrhu strane.
- [ ] Isključi internet pa klikni „Otključaj" — poruka „Nema veze sa serverom…" uz tabelu, kredit nije skinut.
- [ ] Brzi klik na „Otključaj" 100+ puta iz konzole (`for i in $(seq 101); do curl -X POST …`) — 101. vraća **429** sa porukom na srpskom; sledeći minut opet radi.

### Dubina skeniranja i cena po stranici (S17)
> 1 kredit = 1 stranica = 1 Places poziv. Sve ispod se proverava u **obe teme**.

**Prekidač**
- [ ] Ispod forme stoji segmentna kontrola **Brzo / Standardno / Duboko**, klizač je **jedan** element koji se pomera (isti obrazac kao mesečno/godišnje na `/cenovnik`), staza i klizač idu `--border-strong`.
- [ ] Podrazumevano je **Standardno** — na svežoj strani, bez ijednog klika.
- [ ] Uz svaku opciju stoje broj prospekata i cena (`20 · 1 kredit`, `40 · 2 kredita`, `60 · 3 kredita`), oba `.num` — brojevi ne skaču pri prelasku sa opcije na opciju.
- [ ] Tab dovodi fokus na aktivnu opciju; **strelice levo/desno** menjaju izbor i vrte se u krug.
- [ ] Dok scan traje, prekidač je isključen (ne može da se promeni dubina posla koji je već plaćen).

**Cena prati izbor — nigde ne sme da ostane „1 kredit"**
- [ ] Izaberi kombinaciju van keša i prođi kroz sve tri dubine: dugme piše **„Skeniraj za 1 / 2 / 3 kredita"** (pazi na oblik — „2 kredita", nikad „2 kredit").
- [ ] Traka ispod forme menja iznos zajedno sa dugmetom.
- [ ] Modal potvrde: naslov, red **Cena**, red **Posle skeniranja** i dugme potvrde — sva četiri broja se slažu sa izabranom dubinom.
- [ ] Modal ima i red **Dubina** („Standardno · do 40").
- [ ] Posle naplate poruka glasi „Skinuto je N kredita za … skeniranje", a balans u bočnoj traci padne za tačno toliko.
- [ ] `grep -rn "1 kredit" apps/web/src` ne vraća **nijedan** string o skeniranju (otključavanje i +1 za utisak ostaju — oni i dalje koštaju 1).

**Plitak keš za dublji zahtev (zamka 1)**
- [ ] Skeniraj kombinaciju na **Brzo**. Prebaci na **Duboko** — tabela se **isprazni** (nije filter nego druga ponuda), traka kaže „U kešu je samo 1 stranica — duboko košta 3 kredita", ne „stariji od 30 dana".
- [ ] Klik → modal ima ikonicu slojeva i tekst koji izričito kaže da **podaci nisu stari, samo ih je manje**.
- [ ] Vrati se na **Brzo** — ista kombinacija je opet **besplatno**.
- [ ] Posle dubokog scana ista kombinacija je besplatna na **sve tri** dubine.

**URL i deljenje**
- [ ] Izaberi „Duboko" — adresa dobije `&dubina=duboko`; osveži stranu, prekidač je i dalje na „Duboko".
- [ ] Vrati na „Standardno" — parametar **nestaje** iz URL-a (podrazumevano se ne upisuje), a stari link `?grad=…&nisa=…` i dalje radi.
- [ ] Otvori link sa `dubina=duboko` u drugom tabu nad plaćenom kombinacijom: strana se učita, traka kaže cenu za 3 kredita, **nema** modala dok korisnik sam ne klikne.
- [ ] Zalepi `&dubina=izmisljeno` — pada na Standardno, bez greške na ekranu.

**Lista keša**
- [ ] Svaki red nosi oznaku dubine (**Brzo / Standardno / Duboko**); hover pokazuje objašnjenje sa brojem stranica.
- [ ] Sa izabranim „Duboko", klik na red označen „Brzo" je i dalje **besplatan** — prekidač se vidljivo spusti na „Brzo". Lista se zove „besplatne pretrage" i klik na red nikad ne otvara modal sa računom.

**Tanak novčanik**
- [ ] Nalog sa **1 kreditom** + „Duboko": dugme je isključeno, traka kaže „Imaš 1 kredit — dovoljno za pliću dubinu", veza „Vidi kredite" radi.
- [ ] Prebaci na „Brzo" — dugme oživi i skeniranje prođe. Nigde nema pada ni praznog ekrana.

**Da se ne skenira dublje nego što je plaćeno**
- [ ] U logu workera posle „Brzo" scana piše **1 API poziv**, posle „Standardno" 2, posle „Duboko" 3 — ni jedan više.
- [ ] `select pages, last_results_count from search_cache order by last_scanned_at desc limit 5` — dubina odgovara ponudi koja je plaćena.
- [ ] `select delta, ref_id from credit_ledger where reason = 'scan' order by id desc limit 5` — iznos je −1 / −2 / −3, poklapa se sa dubinom.

### Besplatne pretrage / lista keša (Faza 5, 5.6 · Faza 6, 6.4)
- [ ] Sklopljeni red „Besplatne pretrage" je jedna kartica bez unutrašnjeg okvira — samo razdelnici.
- [ ] Ako ikad napraviš parcijalan scan (dnevni budžet stane usred): red kombinacije nosi malu oznaku **„delimično"**; sledeći pun scan je skida.

---

## 2. Pipeline (`/pipeline`)

### „Premesti u…" i sinhronizacija (Faza 4, 4.1 · 4.2)
- [ ] Svaka kartica ima padajući **„Premesti u…"** — na telefonu (≤ 390 px) status se menja bez prevlačenja; i prevlačenje i select zovu isti `pomeri` (prvi „Potpisan" javlja pitanje isto).
- [ ] Uvezi CSV (Pipeline → Uvoz) — **uvezeni prospekti se pojave odmah**, bez punog reloada.

### Beleška (Faza 4, 4.9)
- [ ] Klikni „dodaj belešku", kucaj, pritisni **Esc** — unos se zatvara **bez upisa**; klik pored (blur) i dalje upisuje.

### Dizajn (Faza 5, 5.1 · 5.3)
- [ ] Ni jedna kartica ni dugme u kanbanu nema zelenu senku osim pravog primarnog dugmeta.
- [ ] Datum kontakta na kartici ne „skače" po širini (`.num`).

---

## 3. Poruke (panel u pipeline-u)

### Jedno primarno dugme (Faza 5, 5.2)
- [ ] Otvori poruke za lead sa šablonom + follow-up + AI varijantom: **samo glavna** poruka ima zeleni „Kopiraj"; ostali su outline.
- [ ] Check ikonica na „Kopirano" je tamnozelena i čitljiva u svetloj temi (`text-accent-text`).

### Dupli klik i AI varijanta (Faza 2, 2.4 · 2.5)
- [ ] Dvaput brzo klikni „Kopiraj" — lead se pomera jednom, arhiva ima jedan red (proverljivo u bazi: `outreach_messages` po (user, place, kanal, tekst)).
- [ ] „Napiši drugačije" — dok se piše, polling prestaje kad pređeš na drugi tab (Network).
- [ ] Kad je AI posao gotov: poruka je **baš za ovaj lead** — otvori dva leads-a i traži varijantu jednog dok je drugi u toku; ne sme da se pomeša.

---

## 4. Moja lista (`/lista`) i izvoz

### `.num` i snimci (Faza 5, 5.3 · Faza 4, 4.10)
- [ ] Telefon, mejl, sajt i datum otključavanja u tabeli ne „skaču" po širini.
- [ ] Za lead sa `nema_sajt`/`mrtav`: dugme kaže **„nema"** (poruka, ne greška).
- [ ] Za lead čiji je enrichment gotov a snimka nema: tooltip kaže **„Snimak nije dostupan"**, ne „Snimak se pravi".
- [ ] Za svež otključan lead (enrichment u toku): „Snimak se pravi. Osveži stranicu…".

### Izvoz bez Storage poziva (Faza 3, 3.1)
- [ ] Izvezi CSV (velika lista) — u Network tabu **nijedan** poziv ka Storage-u; fajl stiže brzo.

---

## 5. Dashboard (`/dashboard`)

### Onboarding (Faza 4, 4.7)
- [ ] Nov nalog (ili nalog bez ijednog otključanog): iznad statistike stoji kartica **„Prvi koraci"** sa tri koraka.
- [ ] Posle prvog otključavanja (na sledećem učitavanju) kartica nestaje.
- [ ] Kartica „Plan" prikazuje IME plana bez `.num` problema (reč se ne razvlači).

### Plan i obe kase (S21)
- [ ] Kartica **„Krediti"** pokazuje **zbir obe kase**. Nalogu sa `credits_balance = 4` i
      `credits_topup = 50` piše `54`, a podnaslov `4 iz pretplate · 50 dokupljeno`.
- [ ] Nalogu bez plana (`dopuna`, mesečna dodela 0) **nema trake napunjenosti** — traka na nuli
      iznad punog novčanika kupljenih kredita je najgori mogući prikaz.
- [ ] Kartica **„Plan"** piše ime iz cenovnika (`Starter` / `Pro` / `Advanced` / `Beta`), a za
      nalog bez pretplate **„Bez pretplate"** — nikad sirovo `dopuna` iz baze.
- [ ] Podnaslov ispod imena plana prati stanje: `pretplata aktivna` / `otkazana, traje do kraja
      perioda` / `bez pretplate, radi na kreditima` / `pristup istekao — samo čitanje`.
- [ ] Nigde ne piše „Grace" ni „Zaključan" — ta imena postoje samo u admin konzoli.

---

## 6. Krediti (`/krediti`)

- [ ] Datumi stavki su `.num` (ne skaču).
- [ ] Lista se učitava brzo i sa dosta stavki (indeks `(user_id, created_at desc)`).

### Blok „Pretplata" (S21)
> Stoji iznad izvoda. Sve ispod se proverava u **obe teme** i na **telefonu ≤ 390 px**.

**Stanje naloga**
- [ ] Gore levo: eyebrow **„Pretplata"**, ispod njega **ime plana** i, kad pretplata postoji,
      `· mesečno` ili `· godišnje` — ciklus se izvodi iz `price_id`, ne iz zasebne kolone.
- [ ] Aktivna pretplata: rečenica **„Sledeća naplata \<datum\>"**, datum `.num`.
- [ ] Otkazana pretplata koja još traje: **„otkazana i neće se obnoviti, ali traje do \<datum\>"**.
- [ ] Beta sa rokom: **„Beta nalog, traje do \<datum\>"**; beta bez roka: **„bez roka"**, bez
      izmišljenog datuma.
- [ ] Nalog bez pretplate sa kupljenim kreditima: **„Nemaš pretplatu i radiš na kupljenim
      kreditima"**, uz pomen Starter dnevnih limita.
- [ ] `grace`: žuto upozorenje unutar bloka sa **oba** datuma (istekao i „čitanje do"), a
      rečenica iznad ne ponavlja iste datume.
- [ ] **Iznosa u evrima nigde nema** — i to je namerno: v. zaglavlje
      `components/pretplata-blok.tsx` (popust `BETA2026` bi ovde ispisao cenovničku cenu umesto
      one koja se naplaćuje). Umesto iznosa stoji rečenica da su iznos, kartica i računi kod
      Paddle-a.

**Obe kase**
- [ ] Dva polja jedno pored drugog, u jednoj mreži bez dvostrukih linija: **„Iz pretplate"** i
      **„Dokupljeni"**.
- [ ] „Iz pretplate" kaže **„Obnavlja se \<datum\> — tada se postavlja na \<N\>, ne sabira"**.
      Datum je **prvi dan narednog meseca** — proveri 28. u mesecu da ne piše datum iz prošlosti.
- [ ] „Dokupljeni" kaže **„Ne ističu"** podebljano, i da ih mesečna dodela ne dira.
- [ ] Desno od naslova „Krediti" stoji **ukupno**, `.num`, i jednako je zbiru dva polja.
- [ ] Ispod: rečenica da se troši prvo ono što ističe.
- [ ] Stanje kredita se na ovoj strani pojavljuje **tačno jednom** — stat kartica „Stanje" je
      obrisana, ostale su samo dve dnevne (skeniranja, CSV).

**Dugmad**
- [ ] **Jedno primarno**: „Dokupi kredite" → `/cenovnik#paketi`, sa strelicom.
- [ ] **„Upravljaj pretplatom"** je sekundarno; nalogu koji je kupio samo paket piše **„Računi i
      plaćanja"**; nalogu koji nikad ništa nije kupio stoji „Pogledaj planove" umesto portala.
- [ ] Klik na portal: dugme pređe u **„Otvaram portal"** sa spinerom i **ne vraća se** u mirno
      stanje — strana odlazi na Paddle.
- [ ] Isti link **nikad se ne koristi dvaput**: vrati se nazad i klikni ponovo — u Network tabu
      je nov `POST /api/billing/portal` i **drugačiji** URL.
- [ ] Ugasi mrežu pa klikni — crvena rečenica ispod dugmeta, dugme se vrati u mirno stanje.

---

## 7. Životni ciklus naloga (S19)

> Šest stanja pristupa iz `LANSIRANJE.md` §1.5. Sve se podešava **rukom u Supabase-u**,
> nad testnim nalogom — nijedna stavka ne traži Paddle, tunel ni pravu uplatu:
>
> ```sql
> -- grace: pristup je istekao juče
> update profiles set beta_expires_at = now() - interval '1 day' where id = '<clerk_id>';
> -- zaključan: grace je istekao
> update profiles set beta_expires_at = now() - interval '40 days' where id = '<clerk_id>';
> -- dopuna: nema roka, ima kupljenih kredita
> update profiles set credits_topup = 25 where id = '<clerk_id>';
> -- povratak na početak
> update profiles set beta_expires_at = null, credits_topup = 0 where id = '<clerk_id>';
> ```
>
> Posle svake izmene ide **puno osvežavanje strane** (`Cmd+Shift+R`), ne klik u aplikaciji:
> stanje se čita na serveru, a klijentska navigacija ne pokreće layout.

### Neograničena beta — ništa se ne menja
- [ ] `beta_expires_at` je `NULL`: nema banera, nema modala, pretraga i skeniranje rade.
- [ ] Isprazni kredite na nulu — **i dalje** nema banera ni zaključavanja: prazan novčanik nije istekao pristup.

### Grace — trajan baner
- [ ] Postavi rok u prošlost i osveži: iznad sadržaja stoji **žuta traka** (`--warn-wash`), na **svakom** ekranu.
- [ ] Traka piše **tačan datum** isteka i **tačan datum** do kog čitanje radi; oba su `.num` i ne skaču.
- [ ] Traka ima link **„Vrati pristup"** koji vodi na `/cenovnik`.
- [ ] Traka stoji **ispod** trake o kvaru veze sa bazom, ako se obe pojave.
- [ ] Obe teme; telefon ≤ 390 px — tekst se prelama, link pada ispod, ništa ne izlazi iz ekrana.

### Grace — šta radi a šta ne
- [ ] `/pretraga`: umesto forme stoji objašnjenje sa datumima i dva dugmeta (**„Uzmi plan"** primarno, **„Dokupi kredite"** ghost). Nema mrtvog comboboxa ni ugašenog prekidača dubine.
- [ ] `/lista`: tabela radi, **„Izvezi CSV" prolazi** i fajl stiže.
- [ ] `/pipeline`: kartica se prevlači, beleška se čuva.
- [ ] Poruke: tri poruke se generišu i kopiraju; **„Napiši drugačije" ne radi** i vraća objašnjenje.
- [ ] `curl -X POST .../api/search` sa sesijom → **403** i rečenica na srpskom sa datumom i `/cenovnik`. Isto za `/api/unlock` i `/api/uvoz`.
- [ ] `curl .../api/export` → **200** i CSV. Ovo je stavka koja grace period čini smislenim.

### Grace — modal
- [ ] Prvo učitavanje posle isteka: modal **„Pristup ti je istekao"**, sa datumom do kog čitanje radi i dva dugmeta ka `/cenovnik`.
- [ ] Zatvori ga i osveži stranu **pet puta** — više se ne pojavljuje.
- [ ] Pomeri `beta_expires_at` na drugi datum u prošlosti i osveži — modal se pojavi **ponovo** (potpis stanja se promenio).

### Modal „ostao si bez kredita"
- [ ] Nalog sa punim pristupom i nula kredita: pokreni skeniranje → poruka uz formu **i** modal sa dva izlaza.
- [ ] Zatvori modal, pokušaj ponovo u istom tabu → **nema** drugog modala, poruka uz formu i dalje stoji.
- [ ] Otvori isti ekran u novom tabu i pokušaj → modal se pojavi (pamćenje je po tabu).

### Zaključan nalog
- [ ] Rok 40 dana u prošlost, otvori `/pretraga` → preusmerava na **`/zakljucano`**.
- [ ] Strana ima naslov, **oba datuma**, rečenicu „Ništa nije obrisano" i dva dugmeta ka cenovniku. **Nije** prazna i **nije** `404`.
- [ ] Kucaj `/lista`, `/pipeline`, `/krediti`, `/dashboard`, `/utisci` rukom u adresu — svaka vodi na istu stranu.
- [ ] `curl .../api/export` → **403**, ne CSV.
- [ ] Postavi `credits_topup = 25` i osveži `/zakljucano` → **odmah preusmerava u aplikaciju** (kupljen paket je pun pristup). Strana ne sme da bude slepa ulica posle kupovine.
- [ ] Obe teme, telefon ≤ 390 px.

### Otkazana pretplata koja još traje
> Bez Paddle-a: `insert into subscriptions (...) values (..., status => 'canceled', canceled_at => now(), current_period_end => now() + interval '12 days')` uz `update profiles set plan = 'starter', plan_expires_at = now() + interval '12 days'`.
- [ ] Baner je **plav** (`--info-wash`), ne žut: ovo je obaveštenje, ne upozorenje.
- [ ] Piše **„traje do &lt;datum&gt;"** sa tačnim datumom.
- [ ] Pretraga, skeniranje i otključavanje **rade normalno** — ovo nije grace.

---

## 7a. Beta nalozi u konzoli (S20)

> Sve odavde traži admin nalog. Prolaz je najbrži nad **drugim** nalogom, ne svojim.

### `/admin/korisnici` — kolona i filter
- [ ] Kolona **„Stanje"** stoji odmah do plana i nosi bedž po stanju: `Beta` zeleni,
      `Aktivan` zeleni, `Otkazan` plavi, `Dopuna` sivi, `Grace` žuti, `Zaključan` crveni.
- [ ] `title` na bedžu objašnjava stanje i nosi **tačan datum** („Pun pristup do …",
      „Čitanje do …", ili „Bez roka — neograničeno").
- [ ] Padajući filter **„Svako stanje"** menja adresu (`?stanje=grace`), radi posle
      osvežavanja i posle dugmeta „nazad".
- [ ] Broj u podnožju („N korisnika") prati filter — ne pokazuje ukupan broj naloga.
- [ ] Kolona **„Krediti"** pokazuje **zbir obe kase**; kad ima kupljenih, u zagradi stoji
      `(+N)` sa `.num` i objašnjenjem u `title`-u.

### `/admin/korisnici/[id]` — blok „Pristup"
- [ ] Bedž stanja, a uz neograničenu betu i drugi bedž **`NEOGRANIČENO`**.
- [ ] Pet redova: rok bete, rok pretplate, **pun pristup do**, **čitanje do**, i „Otkazana"
      samo kad je otkazana. Svi datumi nose `.num`.
- [ ] „Pun pristup do" je zaista **kasniji** od dva roka — postavi beta rok 20 dana unapred
      nalogu čija pretplata ističe za 2 dana i proveri koji datum piše.
- [ ] Blok „Krediti" ima tri reda: **Ukupno / Iz pretplate / Dokupljeni**.

### Obrazac „Otvori beta nalog"
- [ ] Polja su unapred popunjena: **50 kredita**, datum **za 30 dana**.
- [ ] Sekcija „Plan" nema `beta` u padajućem spisku, i ispod nje stoji rečenica zašto.
- [ ] Čekiranje **„Neograničeno"** gasi polje za datum.
- [ ] Datum **u prošlosti** otvara žuto polje sa potvrdom; dok potvrda nije čekirana, oba
      dugmeta su ugašena.
- [ ] Klik na **„Otvori beta nalog"** → jedna rečenica sa rokom i kreditima; strana se
      osvežava; blok „Pristup" odmah pokazuje `Beta`.
- [ ] **Dvostruki klik** na isto dugme → druga poruka kaže da su krediti već dodeljeni, a
      balans se **nije** promenio.
- [ ] **„Samo rok"** menja datum, ne dira ni plan ni kredite.
- [ ] Rok u prošlost + potvrda → stanje pada u `Grace`, pa posle 30 dana u `Zaključan`.

### Revizija
- [ ] `/admin/revizija` ima **dve** nove radnje: `user.beta_open` i `user.beta_expiry`.
- [ ] `payload` nosi plan, rok i broj kredita — i nijedan ključ ni token.
- [ ] Namerno pokvaren zahtev (npr. rok 20 godina unapred) ostavlja red sa `ok = false`.

### Obe teme i telefon
- [ ] Tamna i svetla: lista, detalj, žuto polje potvrde, oba bedža.
- [ ] Telefon ≤ 390 px: filteri se prelamaju u dva reda, tabela skroluje vodoravno, kolona
      radnji je ispod blokova, a polja „Kredita" i „Rok" stoje jedno pored drugog.

---

## 7b. Cenovnik i paketi kredita (S21)

> `/cenovnik` je javan — sve ispod se proverava **i odjavljen** i prijavljen, u **obe teme**
> i na **telefonu ≤ 390 px**.

### Sekcija „Paketi kredita"
- [ ] Stoji **ispod** tri plana, kao jedan panel na `--bg-subtle`, a **ne** kao četvrta i peta
      kartica u redu od tri.
- [ ] Dva paketa, oba iz `plans.ts`: **Dopuna 50** i **Dopuna 150**, sa brojem kredita u `.num`.
- [ ] Cene stižu **istim** `PricePreview()` pozivom kao planovi — u Network tabu je **jedan**
      poziv ka Paddle-u za svih osam cena, ne dva.
- [ ] Dok cene stižu, na mestu iznosa stoji sivi pravougaonik koji pulsira; kartice ne poskaču
      kad cifra stigne.
- [ ] Uz cenu piše **„jednokratno"**, ne „/ mesečno".
- [ ] Kopija kaže obe stvari, jasno: **„Krediti iz paketa ne ističu"** i **„Paket nije zamena za
      plan"** (po kreditu je skuplji), plus **„Pretplata nije uslov"**.
- [ ] **Jedno primarno dugme na celom ekranu** — ono je na istaknutom planu (Pro). Dugmad
      paketa su sekundarna.

### Ko sme da kupi (izmena 26.8. — paket traži plan ili betu)
- [ ] **Gost** (odjavljen): sekcija paketa se **vidi**, ali umesto dugmeta stoji katanac i
      „Dostupno uz aktivan plan ili betu — uzmi plan iznad". Bedž gore desno kaže **„Traži
      aktivan plan"**, ne „Bez roka trajanja".
- [ ] **Nalog bez plana** (`dopuna` — ima kupljene kredite, nema pretplatu): isto zaključano,
      ali tekst glasi „Otključava se čim uzmeš plan ili dobiješ betu".
- [ ] **Beta nalog**: dugmad **rade**.
- [ ] **Aktivna i otkazana pretplata**: dugmad rade.
- [ ] **`grace`**: zaključano.
- [ ] ‼️ **Serverska provera, ne samo ekran.** Iz konzole naloga koji NE sme:
      `fetch("/api/billing/checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({priceId:"pri_01m0ffx0j4pyxenvfxrjwz55pf"})}).then(r=>r.status)`
      → mora da vrati **`403`**, ne 200. Ako vrati 200, kapija je samo kozmetika.
- [ ] Nigde na `/cenovnik` ne piše „Pretplata nije uslov" ni „kupuje se i sam".
- [ ] `/zakljucano` ima **jedno** dugme („Pogledaj planove") — „Samo dokupi kredite" je
      uklonjeno, jer bi vodilo u `403`.
- [ ] Modal „Ostao si bez kredita" nalogu koji SME nudi dva dugmeta, a onome ko NE sme samo
      „Uzmi plan".
- [ ] Blok na `/krediti`: primarno dugme je „Dokupi kredite" onome ko sme, „Pogledaj planove"
      onome ko ne sme.
- [ ] Bočna traka na niskom stanju: red kaže „Dokupi kredite" ili „Uzmi plan", zavisno od stanja.

### Kupovina
- [ ] Prijavljen korisnik klikne „Uzmi Dopuna 50" → dugme pređe u **„Otvaram plaćanje"**, ostala
      dugmad (i planovi i paketi) se **ugase**, pa se otvori Paddle modal u temi aplikacije.
- [ ] **Gost** klikne bilo koje dugme → vodi ga na registraciju sa povratkom na `/cenovnik`.
- [ ] Popust `BETA2026` **ne** hvata pakete (ograničen je na tri proizvoda pretplate) — beta
      nalog koji kupuje paket vidi punu cenu, i to je tačno.

### Sidro `#paketi`
- [ ] Link **„paket kredita"** u uvodnom pasusu skroluje na sekciju, a ona ne završava ispod
      zaglavlja.
- [ ] Modal „Ostao si bez kredita" → **„Dokupi kredite"** → otvara `/cenovnik` **na sekciji
      paketa**, ne na vrhu strane.
- [ ] Isto sa `/zakljucano` → „Samo dokupi kredite" i sa `/krediti` → „Dokupi kredite".

### Linkovi ka `/cenovnik` (do S21 ih je bilo nula)
- [ ] Bočna traka, grupa **„Nalog"**, stavka **„Planovi i cene"** — postoji i raširena i
      skupljena (tada tooltip „Pretplata i paketi kredita").
- [ ] **Nisko stanje kredita**: spusti balans na ≤ 10% mesečne dodele (nikad ispod 3) — kartica
      kredita u bočnoj traci dobija **žutu** traku i ikonicu, i ispod nje se pojavi red
      **„Dokupi kredite"**. Iznad praga tog reda **nema**.
- [ ] Nalog bez plana (`dopuna`): kartica kredita **nema traku**, a tekst kaže „Kupljeni krediti
      ne ističu".
- [ ] Broj u bočnoj traci i u gornjoj traci na telefonu je **zbir obe kase** — isti broj koji
      `/api/search` koristi za naplatu.
- [ ] Kvar veze sa bazom (`krediti = null`): piše `—` i **nema** poziva na dokupljivanje.
- [ ] **Futer:** ☐ **NE POSTOJI — čeka S22.** Kad futer stigne, link ka `/cenovnik` ide i u
      njega; do tada je ovo jedina stavka iz S21 koja nije isporučena.

---

## 8. Tema i pristupačnost (Faza 4, 4.8 · Faza 5)

- [ ] Prekidač teme: **Tab** ulazi u celu grupu, **strelicama ← →** menja temu; klik radi isto.
- [ ] Čitač ekrana (VoiceOver/NVDA): greška (crveni Alert) se najavljuje kao **alert**; combobox čita koja je opcija označena; sklopljena kes-lista najavljuje da je sklopljena.
- [ ] Obe teme (tamna i svetla) na: Pretraga, Pipeline, Moja lista, Dashboard, Poruke panel.
- [ ] Telefon ≤ 390 px: kanban („Premesti u…"), pretraga, onboarding.

---

## 9. Terminal / logovi (nije vizuelno, ali zatvara faze)

### Worker — novac i pouzdanost (Faza 0)
- [ ] `GOOGLE_DAILY_LIMIT=0` + scan → u logu **„odloženo do …"**, ne „PAO konačno"; posao `pending` sa `run_after` sutra (baza: `job_queue`).
- [ ] `kill -9` radnika usred scana → žetva posle 15 min vraća posao u red; posle 3 pokušaja → `failed` + povraćaj kredita.
- [ ] Zaustavi Supabase (ili pogrešan URL) → RPC padne za ≤ 30 s, posao ide na retry.
- [ ] Mrtav `ANTHROPIC_API_KEY` + `rewrite_message` → tačno 2 plaćena poziva u logu, ne 6–9.

### Čišćenje i backup (Faza 6)
- [ ] Worker log jednom nedeljno: „čišćenje: N poslova, M pretraga, K dana budžeta".
- [ ] `scripts/backup.sh` nad pravim `DATABASE_URL` — dump + 7 kopija u `BACKUP_DIR`.

### CI (Faza 7)
- [ ] Push na `main`: CI prolazi — typecheck, testovi, check:sql, build, **lint (0/0)**, grep da težine nisu u bundle-u, audit, gitleaks.

---

## Brzi prolaz (ako imaš malo vremena)

1. Pretraga → URL sa `?grad=&nisa=` + Back + deljiv link (4.3)
2. Promena grada prazni tabelu (4.4)
3. Scan → traka raste, polling sve ređi, tab-pauza (3.2, 4.11)
4. „Proveri ponovo" posle dugog čekanja (4.5)
5. Pipeline → „Premesti u…" + uvezeni prospekti odmah (4.1, 4.2)
6. Esc otkazuje belešku (4.9)
7. Poruke → jedno primarno „Kopiraj" (5.2)
8. Dashboard → „Prvi koraci" (4.7)
9. Obe teme + telefon na tri ekrana
10. Životni ciklus: rok u prošlost → baner + modal, izvoz prolazi a skeniranje ne; rok 40 dana unazad → `/zakljucano`; `credits_topup = 25` → vraća se unutra (S19)
11. Konzola: otvori beta nalog jednim obrascem, klikni dvaput, pa ga ugasi rokom u prošlosti (S20)
12. Cenovnik → sekcija paketa, kupi paket bez pretplate; `/krediti` → obe kase odvojeno i portal (S21)
