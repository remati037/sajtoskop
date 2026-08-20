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
- [ ] Kartica „Plan" prikazuje „beta" bez `.num` problema (reč se ne razvlači).

---

## 6. Krediti (`/krediti`)

- [ ] Datumi stavki su `.num` (ne skaču).
- [ ] Lista se učitava brzo i sa dosta stavki (indeks `(user_id, created_at desc)`).

---

## 7. Tema i pristupačnost (Faza 4, 4.8 · Faza 5)

- [ ] Prekidač teme: **Tab** ulazi u celu grupu, **strelicama ← →** menja temu; klik radi isto.
- [ ] Čitač ekrana (VoiceOver/NVDA): greška (crveni Alert) se najavljuje kao **alert**; combobox čita koja je opcija označena; sklopljena kes-lista najavljuje da je sklopljena.
- [ ] Obe teme (tamna i svetla) na: Pretraga, Pipeline, Moja lista, Dashboard, Poruke panel.
- [ ] Telefon ≤ 390 px: kanban („Premesti u…"), pretraga, onboarding.

---

## 8. Terminal / logovi (nije vizuelno, ali zatvara faze)

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
