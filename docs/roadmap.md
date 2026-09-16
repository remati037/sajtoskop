# Sajtoskop — roadmap

> Stanje na **16. septembar 2026** · kod zaključno sa migracijom `0034`.
> PDF verzija: `docs/roadmap.pdf` (`pnpm docs:pdf`). Šta mora pre otvaranja, korak po korak:
> `docs/lansiranje-checklista.md` — ovde se ti koraci ne ponavljaju, samo se na njih upućuje.

**Kako se čita.** Sav preostali razvojni posao, poređan po horizontu. Svaka stavka ima ID,
obrazloženje, trud i zavisnosti. Kad se stavka isporuči: unos u `docs/dnevnik-isporuka.md`, a
ovde se stavka **briše** (ne štiklira) — roadmap pokazuje samo ono što je ostalo.

| Horizont | Kada | Pravilo |
|---|---|---|
| **H0** | pre otvaranja | samo ono bez čega se ne naplaćuje pošteno; sve je u checklisti |
| **H1** | prvih 30 dana posle otvaranja | ono što prvi korisnici odmah osete: mejlovi, obrada prijava, sitni dobici |
| **H2** | 1–3 meseca | ono što pravi naviku i prednost: javna tabla, retencija, „Potpisan" u skoringu, radar |
| **H3** | kasnije, po brojkama | region, timovi, mobilno, tehnički dug |

**Trud:** **S** do pola dana · **M** 1–2 dana · **L** 3–5 dana · **XL** više od nedelju dana.
Jedna stavka = jedna sesija sa Claude-om (L i XL se dele na faze navedene uz stavku).

---

## 0. Pregled

| ID | Stavka | Horizont | Trud | Zavisi od |
|---|---|---|---|---|
| H0.1 | Sentry za serverske greške | H0 | M | checklista 2.1 |
| H0.2 | Mejlovi: pad naplate korisniku, spor tebi | H0 | S | checklista 2.2 |
| H0.3 | Mejl pred kraj probe i potvrda uplate | H0 | S | checklista 2.6 |
| H0.4 | Sitne ispravke teksta i test za `svix-id` | H0 | S | checklista 2.3 |
| H0.5 | Treći cron (`utisci-slike`) | H0 | S | Vercel Pro |
| H0.6 | Kanarinci i metrike aktivacije | H0/H1 | M | checklista 2.5 |
| H1.1 | Mejlovi — infrastruktura (dnevnik slanja, odjava, šabloni, dve adrese) | H1 | M | H0.3 |
| H1.2 | Mejlovi — naplata, proba, komp i pozivnice | H1 | M | H1.1 |
| H1.3 | Mejlovi — onboarding sekvenca | H1 | M | H1.1 |
| H1.4 | Utisci v3, faza 1: trijaža u konzoli | H1 | M | — |
| H1.5 | Brzi dobici na kartici i u pipeline-u | H1 | S–M po stavci | — |
| H1.6 | Pristupna pozivnica mejlom | H1 | S | H1.1 |
| H1.7 | Rezerva za `lookup_key` pre prve promene cene | H1 | S | pre promene cene |
| H1.8 | Razlog pada analize sa workera na kartici | H1 | S | — |
| H1.9 | Prazan `/pipeline` za nalog sa otključanim prospektima | H1 | S | odluka |
| H2.1 | Javna tabla „Plan razvoja" (predlozi i glasanje) | H2 | L | H1.1, H1.4 |
| H2.2 | Utisci v3, faza 2: automatske greške, GitHub, niti, „Moje prijave" v2 | H2 | L | H1.4, H0.1 |
| H2.3 | Mejlovi — retencija i novosti | H2 | M | H1.1, H2.1 |
| H2.4 | Povratna sprega „Potpisan" u skoringu | H2 | L | podaci iz upotrebe |
| H2.5 | Radar: nove firme bez sajta u praćenim kombinacijama | H2 | L | H1.1 |
| H2.6 | Detekcija deljenja naloga | H2 | M | — |
| H2.7 | Porez, računi i Stripe Tax po odgovoru savetnika | H2 (uslovno) | M | checklista 4.1 |
| H2.8 | Učvršćivanje naplate: `incomplete`, povraćaj posle downgrade-a | H2 | S | — |
| H2.9 | Admin: 2FA i obaveštenja tebi | H2 | S | — |
| H2.10 | Broj mrtvih domena u `search_cache` | H2 | S | keš > ~50 kombinacija |
| H3.1 | PDF izveštaj o auditu za vlasnika firme | H3 | L | — |
| H3.2 | Napredni skoring: istorija audita, domaće agencije, APR | H3 | XL | H2.4 |
| H3.3 | Region HR/BA/ME/MK | H3 | XL | stabilna naplata |
| H3.4 | Timovi i više korisnika po nalogu | H3 | XL | stabilna naplata |
| H3.5 | Domaća naplata (IPS QR, račun za firme sa PIB-om) | H3 (uslovno) | L | checklista 4.1 |
| H3.6 | Mobilna aplikacija | H3 | XL | 100+ aktivnih korisnika |
| H3.7 | Tehnički dug i skaliranje | H3 | po stavci | brojke |
| H3.8 | Žig kod ZIS-a, domeni | H3 | — | prvi kupci |

---

## 1. H0 — pre otvaranja

Sve stavke su u `docs/lansiranje-checklista.md`, sekcija 2, sa gotovim promptom. Ovde samo zašto
spadaju u H0:

- **H0.1 Sentry** — pad webhooka ili workera danas vidiš samo ako gledaš log u tom trenutku.
- **H0.2 i H0.3 mejlovi** — Stripe mejlovi kupcima su isključeni, a naših nema: proba prelazi u
  naplatu bez upozorenja, kupac nema potvrdu uplate, a spor ima rok za odgovor. To su
  najčešći razlozi za sporove i zahteve za povraćaj.
- **H0.4 sitne ispravke** — tekst na `/dashboard` i dalje tvrdi da je keš besplatan.
- **H0.5 treći cron** — bez njega se slike prijava ne čiste same.
- **H0.6 kanarinci i metrike** — metrike trebaju od prvog dana, jer se prvi dani ne mogu
  izmeriti naknadno; kanarinci mogu i prve nedelje.

---

## 2. H1 — prvih 30 dana

### H1.1 · Mejlovi — infrastruktura · M

Temelj za sve mejlove iz §5. Bez njega svaki novi mejl ponavlja isti posao i isti rizik od
duplikata. Pravila i odluke: §5.0.

- tabela `email_log` (`user_id`, `email_key`, `ref`, `sent_at`, `status`, `error`), unique po
  `(user_id, email_key, ref)` — ponovljen cron ili webhook ne šalje dvaput;
- `profiles.email_opt_out_at` + strana `/odjava?t=<token>` (HMAC token, bez prijave) i zaglavlje
  `List-Unsubscribe` sa one-click odjavom; transakcioni mejlovi se ne mogu odjaviti;
- dve adrese pošiljaoca kroz env (`EMAIL_FROM_TRANSAKCIONI`, `EMAIL_FROM_LICNI`), `Reply-To` uvek
  tvoja adresa;
- šablon: HTML sa logom i jednim dugmetom + tekstualna verzija; boje iz `docs/dizajn-sistem.md`
  §3.1 upisane samo u modul šablona (mejl ne čita CSS promenljive — izuzetak se dopisuje u
  `CLAUDE.md`);
- dnevni cron `/api/cron/mejlovi`: pita bazu „kome danas šta sleduje", najviše jedan
  netransakcioni mejl dnevno po korisniku;
- DNS: DMARC zapis (`p=none` za početak) uz postojeće SPF i DKIM iz Resend-a;
- admin: `/admin/korisnici/[id]` prikazuje poslednjih 20 poslatih mejlova.

**Gotovo kad:** probni mejl ide kroz `email_log`, drugi poziv sa istim ključem se ne šalje,
odjava radi bez prijave, Gmail prikazuje dugme „Unsubscribe".

### H1.2 · Mejlovi — naplata, proba, komp i pozivnice · M

Katalog §5.5 i §5.6, bez stavki iz H0. Okidači su postojeći Stripe webhookovi plus
`invoice.upcoming` (godišnja obnova) i dnevni cron (komp ističe). Svaki mejl nosi tačan datum i
tačan broj kredita iz baze, nikad iz `plans.ts` pretpostavke.

### H1.3 · Mejlovi — onboarding sekvenca · M

Katalog §5.2. Uslovna sekvenca: mejl za korak koji je korisnik već uradio se preskače
(`onboarding_steps`). Meri se isto što i onboarding: prva kopirana poruka i povratak drugog dana.

### H1.4 · Utisci v3, faza 1 — trijaža u konzoli · M

Predlog u §6.3 (tačke 1, 3 i 7). Posle otvaranja prijave stižu od ljudi koji su platili; danas se
čitaju kao lista, bez spajanja duplikata, prioriteta i mere vremena do odgovora.

### H1.5 · Brzi dobici na kartici i u pipeline-u · S–M po stavci

Iz `docs/tok-i-onboarding.md` §6, ono što još nije urađeno. Svaka je posebna mala sesija.

| # | Dobitak | Trud | Zašto |
|---|---|---|---|
| a | Gmail / Viber / Instagram deep-link na kartici (`mail.google.com/mail/?view=cm…`, `viber://chat?number=…`, `ig.me/m/…`, `mailto:` rezerva) | S | poruka stiže u pravi prozor sa popunjenim primaocem, i na telefonu |
| b | Bedž „Vreme za drugi pokušaj" u koloni Kontaktiran posle 5 dana + brojač na stavci Pipeline | S | posao se potpisuje na drugom javljanju; alat ga sad ne podseća |
| c | „Nastavi gde si stao" na `/dashboard`: poslednja lista jednim klikom, sa brojem novih firmi | S | drugi dan počinje jednim klikom — a baš povratak drugog dana se meri |
| d | „Ista niša i u: Loznica · Valjevo…" ispod liste, sa cenom | S | prodaje sledeći kredit kad je lista potrošena |
| e | Podešavanja poruke: ime, firma i sajt u potpisu (danas potpis nosi samo ime iz naloga) | S | poruka bez punog potpisa se prepravlja svaki put |
| f | Objašnjenje uz Ugly Score bedž (bend + šta dobijaš otključavanjem) | S | bend je brend; bez objašnjenja je samo broj |
| g | Tastatura na listi: `J/K` sledeća/prethodna, `U` otključaj, `C` kopiraj, `?` legenda | S | korisnici su developeri; 30 prospekata za 5 minuta |

### H1.6 · Pristupna pozivnica mejlom · S

Danas admin kopira link pozivnice i šalje ga ručno. Pozivnica vezana za mejl treba da ode sama,
sa ličnom porukom iz obrasca (§5.1, mejl 1.5).

### H1.7 · Rezerva za `lookup_key` pre prve promene cene · S

Stripe pravi novu cenu sa istim `lookup_key`, a stara ostaje bez njega — fakture postojećih
pretplatnika na staroj ceni bile bi u `invoice.paid` „preskočeno" i ne bi dobile kredite. Rešenje:
`price.metadata.plan` i `metadata.ciklus` na svakoj ceni (`pnpm stripe:seed` ih upisuje), pa
`planIzFakture` čita metapodatke kad `lookup_key` fali. **Mora pre prve promene cene.**

### H1.8 · Razlog pada analize na kartici · S

Kartica u stanju greške ne zna zašto analiza nije stigla (timeout, 403, DNS), jer `enrich_full`
za nedostupan sajt vraća napomenu, ne grešku. Worker upisuje razlog u audit, kartica prikazuje
rečenicu po razlogu, a prijava greške ga nosi u kontekstu.

### H1.9 · Prazan `/pipeline` za nalog sa otključanim prospektima · S

Danas je pipeline „prazan" dok nalog ne pošalje prvu poruku, iako ima otključane prospekte (S30,
odstupanje 10). Odluka: kanban odmah, sa otključanim u koloni Nekontaktiran — ili prazno stanje
kao sad. Preporuka: kanban odmah; jedna linija u `pipeline/page.tsx`.

---

## 3. H2 — 1–3 meseca

### H2.1 · Javna tabla „Plan razvoja" · L

Predlog u §7. Faze: (1) tabla sa planom i isporučenim, bez glasanja; (2) predlozi i glasanje sa
moderacijom; (3) veza sa utiscima i mejlovi glasačima.

### H2.2 · Utisci v3, faza 2 · L

Predlog u §6.3 (tačke 2, 4, 5, 6 i 8): automatsko grupisanje serverskih grešaka i veza sa
prijavama, GitHub issue iz konzole, odgovor u niti, „Moje prijave" sa vremenskom linijom.

### H2.3 · Mejlovi — retencija i novosti · M

Katalog §5.3 i §5.4: krediti pri kraju, dodela stigla, prospekti čekaju u pipeline-u, win-back
posle 14 dana, „Novo u Sajtoskopu" (ručno okidanje), obaveštenja glasačima (§7.7).

### H2.4 · Povratna sprega „Potpisan" u skoringu · L

Jedini podatak koji raste s vremenom i koji konkurent ne može da kupi. Podaci se već skupljaju
(`lead_status`, `signed_events`, pitanje `prvi-potpisan`).
1. Agregat „koji prospekt se potpisuje": po niši, gradu, bendu, statusu sajta i kanalu prve poruke.
2. Nedeljni izveštaj konverzije po segmentu u konzoli.
3. Kasnije: oznaka „često se potpisuje" na kartici, kad ima dovoljno podataka (prag: 50 potpisanih).

### H2.5 · Radar · L

Praćenje kombinacije (grad, niša): mejl kad se pojavi nova firma bez sajta ili kad sajt padne u
Katastrofu. **Troši Places pozive** (periodično osvežavanje praćenih kombinacija) — pre izrade
izračunati trošak po praćenju i ceniti ga u kreditima (pravilo 5a: nijedan Places poziv bez
naplate).

### H2.6 · Detekcija deljenja naloga · M

Jedan nalog sa više uređaja i gradova istovremeno ili neuobičajen tempo otključavanja (npr. 300
na sat) → oznaka u konzoli, pa ponuda većeg plana, ne blokada.

### H2.7 · Porez, računi i Stripe Tax · M · uslovno

Zavisi od pisanog odgovora iz checkliste 4.1: uključivanje Stripe Tax-a, PDV u ceni, podaci o
kupcu na računu (firma, PIB), eventualno ograničenje prodaje. Ne radi se dok odgovor ne stigne.

### H2.8 · Učvršćivanje naplate · S

- `apply_subscription` upisuje `plan_expires_at` i za `incomplete`/`unpaid`; naš tok to ne pravi,
  ali pretplata napravljena ručno u Stripe panelu bi dala pristup bez naplate. Ignorisati te statuse.
- Povraćaj fakture posle downgrade-a ne skida ništa, a posle probe ostavlja probne kredite (svesno
  od `0032`). Ako se desi više od jednom: automatsko skidanje po `balance_after`, uz red u reviziji.

### H2.9 · Admin: 2FA i obaveštenja · S

- 2FA na admin nalogu (Clerk) i provera u `requireAdminPage()` da sesija ima drugi faktor.
- Mejl tebi (§5.7): nova pretplata, otkaz, neuspela webhook obrada, posao pao konačno.

### H2.10 · Broj mrtvih domena u `search_cache` · S

Čarobnjak za svaku svežu kombinaciju pravi jedan `count` upit za mrtve domene. Kad keš pređe
~50 kombinacija: kolona u `search_cache` koju održava isti triger kao `total`/`no_site`.

---

## 4. H3 — kasnije

- **H3.1 PDF izveštaj** — „napravi PDF za vlasnika": snimci, problemi, Ugly Score, sa korisnikovim
  potpisom. Prodajni alat korisnika; najbliže automatskom leadu.
- **H3.2 Napredni skoring** — istorija audita po domenu („sajt nije diran od januara"), prepoznavanje
  domaćih agencija u AI analizi, APR podaci (naziv, delatnost) kad je pravno čisto.
- **H3.3 Region HR/BA/ME/MK** — `country_code` postoji svuda od `0001`, migracija nije potrebna:
  taksonomija gradova i niša po zemlji, `regionCode` i jezik u Places pozivu, ćirilica u BA/MK,
  AI prompt po jeziku, keš i cenovnik po zemlji.
- **H3.4 Timovi** — više korisnika po nalogu, deljeni pipeline, uloge; plan za agencije.
- **H3.5 Domaća naplata** — IPS QR i račun za firme sa PIB-om, samo ako savetnik (4.1) ili prvi
  kupac-firma to traži.
- **H3.6 Mobilna aplikacija** — ne pre 100 aktivnih korisnika; web radi na telefonu.
- **H3.7 Tehnički dug i skaliranje** — materijalizovani pogledi za admin agregate; Supabase PITR;
  Redis/BullMQ samo ako red poslova postane usko grlo; penetration test na ~500 korisnika;
  odvojena staging okolina.
- **H3.8 Brend** — provera imena u ZIS bazi i RNIDS-u, `.rs`/`.co.rs`/`.com`, žig posle prvih kupaca.

---

## 5. Mejlovi — kompletan plan

Svaki mejl koji korisnik (ili ti) dobija, od registracije do brisanja naloga. Prepisano iz
nekadašnjeg `MEJLOVI-PLAN.md` na današnji model: nema bete, postoje proba, komp i pozivnice,
naplata je Stripe. Tekstovi se pišu pri izradi, mejl po mejl; ovde su okidač, uslov, naslov
(predlog) i svrha.

**Oznake:** ✅ postoji · **[H0]** pre otvaranja · **[H1]** prvih 30 dana · **[H2]** 1–3 meseca ·
**[H3]** kasnije. **T** = transakcioni (`podrska@`, bez odjave) · **L** = lični (`marko@`, sa odjavom).

### 5.0 Pravila i infrastruktura

| Pravilo | Zašto |
|---|---|
| Svaki mejl ide kroz `lib/mail.ts` | jedini izlaz ka Resend-u: tajmaut, zaštita od header injection-a, ključ ne curi u grešku |
| Srpski, latinica, dijakritika; terminologija iz `CLAUDE.md` | prospekt, otključaj, skeniranje, krediti, proba, komp pristup, pozivnica, utisak — nikad lead, trial, feedback |
| **Dve adrese** (odluka): transakcioni `Sajtoskop <podrska@sajtoskop.com>`, lični `Marko iz Sajtoskopa <marko@sajtoskop.com>` | račun i lično pismo ne dele sanduče; lični mejl deluje kao pismo, ne kao sistem |
| **Format** (odluka): transakcioni jednostavan HTML sa jednim dugmetom + tekst; lični skoro čist tekst | lični mejl kao pismo ima bolju isporuku i odgovor |
| `Reply-To` na tvoju adresu, na svakom mejlu | odgovor na bilo koji mejl mora da stigne tebi |
| `email_log` sa unique `(user_id, email_key, ref)` | restart crona ili ponovljen webhook ne šalje duplikat |
| **Jedan prekidač za odjavu** (odluka) od svega što nije transakciono + `List-Unsubscribe` | zakon i Gmail/Yahoo pravila za pošiljaoce; transakcioni ne smeju da se odjave |
| Najviše jedan netransakcioni mejl dnevno po korisniku | prioritet: transakcioni > onboarding > retencija |
| Zakazani mejlovi iz dnevnog crona `/api/cron/mejlovi` (Vercel Pro) | isti obrazac kao digest utisaka; Vercel funkcija ne „čeka dan 3" |
| Datumi i brojevi iz baze u trenutku slanja | mejl koji kaže pogrešan datum naplate je gori od nikakvog |
| Stripe šalje samo ono što mi ne šaljemo (v. 5.6) | jedan izvor po obaveštenju, da kupac ne dobije dva ista |

### 5.1 Nalog i autentifikacija

| # | Mejl | Okidač | Ko šalje | Status | Svrha |
|---|---|---|---|---|---|
| 1.1 | Kod za potvrdu adrese | registracija | Clerk | **[H0]** prevod šablona | „Verify your email" usred srpskog proizvoda kvari prvi utisak (checklista 1.10) |
| 1.2 | Reset lozinke | zahtev | Clerk | **[H0]** prevod šablona | isto |
| 1.3 | Poziv u Sajtoskop (Clerk pozivnica) | admin, `/admin/pozivnice` | mi | ✅ | lična poruka + link za registraciju |
| 1.4 | Pristup za nalog otvoren iz konzole | admin | mi | ✅ | generisana lozinka i link |
| 1.5 | Pristupna pozivnica (komp / prvi mesec) · T | admin napravi pozivnicu sa mejlom | mi | **[H1]** H1.6 | danas admin kopira link ručno; naslov „Pozivnica za Sajtoskop — <pun pristup N dana / prvi mesec gratis>" |

### 5.2 Onboarding sekvenca (prvih 10 dana) · L

Cilj: prva lista, prvo otključavanje, prva kopirana poruka. Uslovna — korak koji je već urađen
(`onboarding_steps`) se preskače ili menja sadržaj. Za prvih 20 korisnika 2.2 i 2.6 mogu biti
ručne poruke; šablon svejedno postoji.

| # | Mejl | Kada | Uslov | Status | Naslov (predlog) · svrha |
|---|---|---|---|---|---|
| 2.1 | Dobrodošlica | odmah posle registracije | uvek | **[H1]** | „Dobro došao u Sajtoskop" · ko piše, šta alat radi u jednoj rečenici, šta nalog ima **danas** (2 besplatna kredita / proba sa 10 / komp sa N), jedan poziv: „Otvori prvu listu" → `/pocetak` |
| 2.2 | Aktivacioni podsetnik | dan 2 | nije otvorio nijednu listu | **[H1]** | „Tvoj grad, tvoja niša — 20 sekundi" · stvarna brojka iz keša (npr. 58% PVC stolarija u Šapcu bez sajta), link na `/pocetak` |
| 2.3 | Kako se čita Ugly Score | dan 3 | otvorio bar jednu listu | **[H1]** | „Zašto je ‚Nema sajt' najbolji prospekt" · bendovi, NEMA SAJT i MRTAV, zašto su podaci sveži 30 dana |
| 2.4 | Prvo otključavanje | dan 4–5 | ima listu, nema otključanih | **[H1]** | „Šta dobijaš za 1 kredit" · telefon, mejl, snimci, problemi, gotova poruka; snimak kartice |
| 2.5 | Od prospekta do posla | dan 7 | ima bar jedno otključavanje | **[H1]** | „Kako se piše prva poruka koja dobije odgovor" · kanali, Viber za mobilni, pipeline, drugi pokušaj posle 5 dana |
| 2.6 | Kako ti se čini? | dan 8–10 | aktivan bar jednom posle prvog dana | **[H1]** | „Jedno pitanje" · bez dugmadi: šta smeta, šta fali; odgovor ide tebi |

Napomena: podsetnik za utisak dana 3 u aplikaciji (modal) i mejl 2.3 ne smeju isti dan — cron
proverava `feedback_prompted_at`.

### 5.3 Događajni mejlovi

| # | Mejl | Okidač | Status | Svrha |
|---|---|---|---|---|
| 3.1 | Prijava rešena · T | status prijave → `reseno` | ✅ (samo „rešeno") | proširenje u §6: i „potvrđeno", „neće se raditi" sa obrazloženjem, nagrada ako je dodeljena |
| 3.2 | Krediti pri kraju · L | balans padne na ≤ 10 % mesečne dodele (najmanje 3) | **[H2]** | jednom po periodu; plan → ponuda paketa, dopuna → ponuda plana |
| 3.3 | Krediti su stigli · T | `invoice.paid` (mesečna dodela) i worker dodela (godišnji, komp) | **[H2]** | „Stiglo je 450 kredita" — razlog da se vrati tog meseca |
| 3.4 | Skeniranje delimično | `partial: true` | **[H3]** | in-app je dovoljno dok se ne pokaže da ljudi zatvaraju tab |
| 3.5 | Prospekti čekaju | ≥ 3 prospekta > 7 dana u Nekontaktiran | **[H2]** · L | „Otključao si 8 firmi, 5 još nisi kontaktirao" — gura korisnikov rezultat |
| 3.6 | Stanje tvog predloga · T | predlog na javnoj tabli promeni status (§7.7) | **[H2]** | autor i glasači saznaju da je planirano ili isporučeno |

### 5.4 Retencija i novosti · L

| # | Mejl | Kada | Status | Svrha |
|---|---|---|---|---|
| 4.1 | Win-back | 14 dana bez prijave, nalog ima pristup | **[H2]** | „Šta te je zaustavilo?" — jednom, bez popusta; zamena za pitanje `zasto-ne-vracas`, koje neaktivan korisnik po definiciji ne vidi u aplikaciji |
| 4.2 | Novo u Sajtoskopu | ručno iz konzole, na ~2 nedelje | **[H2]** | iz tabele `changelog` + isporučeni predlozi sa table: „tražili ste, uradio sam" |
| 4.3 | Nedeljni pregled praćenih kombinacija | ponedeljkom | **[H3]** uz radar (H2.5) | „U tvojim kombinacijama: X novih firmi, Y palo u Katastrofu" |
| 4.4 | Priča o rezultatu | ručno, kad `prvi-potpisan` + citat = da | **[H2]** ručno | zahvalnica i molba za citat na landingu |

### 5.5 Proba, komp i pozivnice (zamenjuje „beta → naplata")

| # | Mejl | Okidač | Status | Svrha |
|---|---|---|---|---|
| 5.1 | Proba je počela · T | `customer.subscription.created` sa `trialing` | **[H1]** | plan, 10 kredita, **tačan datum i iznos prve naplate**, kako se otkazuje (portal); dokaz uslova probe |
| 5.2 | Proba ističe za 3 dana · T | `customer.subscription.trial_will_end` | **[H0]** checklista 2.6 | datum i iznos naplate, link „Upravljaj pretplatom"; bez ovoga naplata stiže bez upozorenja |
| 5.3 | Proba završena bez naplate · T | `customer.subscription.deleted` dok je bio `trialing` | **[H1]** | šta ostaje (30 dana čitanja), link na planove |
| 5.4 | Komp ističe za 7 dana · T | dnevni cron nad `komp_expires_at` | **[H1]** | datum, šta posle, link na planove |
| 5.5 | Komp je istekao · T | dnevni cron, dan isteka | **[H1]** | šta radi 30 dana, šta ne |
| 5.6 | Prvi mesec gratis se završava · T | `invoice.upcoming` za pretplatu sa pozivnicom | **[H1]** | datum i iznos prve prave naplate |

### 5.6 Naplata i pretplata

**Stripe šalje (uključiti u podešavanjima, checklista 2.6):** potvrdu uspešne uplate sa računom
(PDF) i potvrdu povraćaja. Jezik Stripe mejlova zavisi od podržanih jezika — proveriti na prvom
test mejlu; ako srpski nije podržan, isti mejl šaljemo mi (6.2, 6.7) i Stripe ga isključuje.

| # | Mejl | Okidač | Ko | Status | Svrha |
|---|---|---|---|---|---|
| 6.1 | Plan je aktivan · T | prva plaćena `invoice.paid` (posle probe ili odmah) | mi | **[H1]** | plan, krediti koji su stigli, datum sledeće naplate |
| 6.2 | Potvrda uplate / račun · T | `invoice.paid`, `checkout.session.completed` (paket) | Stripe | **[H0]** checklista 2.6 | pravni dokaz uplate, PDF račun |
| 6.3 | Paket kupljen · T | `checkout.session.completed` mode `payment` | mi | **[H1]** | koliko je leglo, balans obe kase, da ne ističu |
| 6.4 | Naplata nije prošla · T | `invoice.payment_failed` | mi | **[H0]** checklista 2.2 | šta se dešava sa pristupom, do kada, „Ažuriraj karticu" |
| 6.5 | Pretplata se neće obnoviti · T | `subscription.updated` sa `cancel_at` | mi | **[H1]** | tačan datum do kog sve radi, **šta ostaje zauvek** (otključani, pipeline), kako da se predomisli |
| 6.6 | Pretplata je istekla · T | `customer.subscription.deleted` (posle perioda) | mi | **[H1]** | šta se ugasilo, 30 dana čitanja, povratak jednim klikom |
| 6.7 | Povraćaj obrađen · T | `charge.refunded` | Stripe + mi | **[H1]** | Stripe potvrđuje novac; naš mejl kaže koliko je kredita skinuto i kakav je balans — bolje da pročita od nas nego da se iznenadi |
| 6.8 | Godišnja obnova za 7 dana · T | `invoice.upcoming` za `ciklus = year` | mi | **[H1]** | iznos i datum; godišnja naplata bez podsetnika je sigurna zamerka |
| 6.9 | Promena plana · T | `subscription.updated` sa novim `lookup_key` | mi | **[H2]** | upgrade: novi krediti odmah; downgrade: od kog datuma |
| 6.10 | Spor otvoren · tebi | `charge.dispute.created` | mi | **[H0]** checklista 2.2 | iznos, rok, link na Stripe |

Za `invoice.upcoming` u Stripe-u: **Settings → Billing → Subscriptions and emails → Upcoming
renewal events** na 7 dana, i događaj dodat na webhook endpoint.

### 5.7 Administrativno, pravno i mejlovi tebi

| # | Mejl | Okidač | Status | Svrha |
|---|---|---|---|---|
| 7.1 | Nalog je obrisan · T | `user.deleted` (posle kaskade) | **[H2]** | potvrda šta je obrisano i da je pretplata otkazana; adresa iz payload-a |
| 7.2 | Izmena uslova ili privatnosti · T | ručno, uz svaku bitnu izmenu | **[H1]** | pravna higijena; svi korisnici, 14 dana pre stupanja na snagu |
| 7.3 | Poruka od admina | admin iz konzole | ✅ | pojedinačna poruka, 20 dnevno |
| 7.4 | Utisak / digest / nedeljni izveštaj · tebi | postojeći cron | ✅ | ostaje; digest dobija linije iz §6 |
| 7.5 | Nova pretplata, otkaz · tebi | Stripe webhook | **[H2]** H2.9 | brojke u realnom vremenu dok ih je malo |
| 7.6 | Kvar u naplati ili workeru · tebi | neuspela obrada webhooka, posao pao konačno | **[H2]** H2.9 | dok Sentry nije podešen ili kao rezerva |

### 5.8 Kalendar iz ugla korisnika

```
Dan 0    registracija ─► 1.1 kod (Clerk) ─► 2.1 dobrodošlica
         checkout probe ─► 5.1 proba je počela (bez računa — nema naplate)
Dan 2    nije otvorio listu? ─► 2.2
Dan 3    otvorio listu? ─► 2.3
Dan 4    proba ─► 5.2 ističe za 3 dana
Dan 4–5  nema otključanih? ─► 2.4
Dan 7    ima otključanih? ─► 2.5
Dan 8    naplata ─► 6.2 račun (Stripe) + 6.1 plan je aktivan   |  pala ─► 6.4
Dan 8–10 aktivan? ─► 2.6
Dan 14+  nestao? ─► 4.1 (jednom)
Stalno   prijava rešena 3.1 · krediti pri kraju 3.2 · stigli 3.3 · prospekti čekaju 3.5 · novosti 4.2
Otkaz    6.5 ─► kraj perioda 6.6 ─► 30 dana čitanja
```

### 5.9 Redosled gradnje

1. **H0** (checklista 2.2 i 2.6): 5.2, 6.2, 6.4, 6.10 i prevod Clerk šablona 1.1–1.2.
2. **H1.1** infrastruktura, pa **H1.2**: 5.1, 5.3–5.6, 6.1, 6.3, 6.5–6.8, 7.2; pa **H1.3**: 2.1–2.6; pa
   **H1.6**: 1.5.
3. **H2.3**: 3.2, 3.3, 3.5, 4.1, 4.2; uz **H2.1**: 3.6; uz **H2.9**: 7.5, 7.6; 6.9, 7.1.
4. **H3**: 3.4, 4.3.

### 5.10 Odluke

- ✅ Dve adrese: transakcioni `podrska@`, lični `marko@`.
- ✅ Format: transakcioni HTML + tekst, lični skoro čist tekst.
- ✅ Jedan prekidač za odjavu od svega što nije transakciono.
- ☐ `marko@sajtoskop.com` mora da postoji i da prima poštu (isto kao `podrska@`, checklista 1.9) i
  da bude verifikovan pošiljalac u Resend-u (isti domen, ne traži novi DNS).

---

## 6. Utisci i prijava grešaka — sistem v3 (predlog)

Odluka: **sve ostaje u aplikaciji**, bez spoljnog alata koji bi video podatke korisnika; javna
tabla (§7) je dodatak za ideje, ne za bugove.

### 6.1 Šta postoji

- **Ulazi:** plutajuće dugme „Utisak" (ocena, tekst, Bug/Ideja/Pohvala, slika, `Ctrl/⌘+Shift+U`),
  pitanja u aplikaciji (`prva-lista`, `tacnost-podataka`, `poruka-kvalitet`, `prazan-rezultat`,
  `prvi-potpisan` sa citatom, `nps-7`, `fali`, `zasto-ne-vracas`), „Prijavi grešku" na šest mesta sa
  kontekstom (stanje pristupa, prospekt, poruka koju je čovek video, onboarding, posao), dnevnik
  poslednjih 5 klijentskih grešaka.
- **Obrada:** `/admin/utisci` sa filterima (status, sloj, ocena, Fali, Citat), panel sa blokom
  „Kontekst", statusi `novo / priznato / u_radu / reseno / odbijeno / duplikat`, `severity` 1–3,
  oznake, beleška, +10 kredita za potvrđen bug, NPS i „Fali" agregati.
- **Povratno:** „Moje prijave" na `/utisci`, tačka na dugmetu, mejl „rešeno", „Novo u Sajtoskopu".
- **Tebi:** instant mejl za bug / ocenu 1 / incident, digest u 21:00, nedeljni izveštaj.

### 6.2 Šta fali

| # | Problem | Posledica |
|---|---|---|
| U1 | Nema prave trijaže: nove prijave, bugovi i ideje su jedna lista | posle otvaranja se prijave čitaju redom, ne po važnosti |
| U2 | `duplikat` je samo status — nema veze ka originalu ni broja pogođenih | isti bug od 5 ljudi izgleda kao 5 malih, a ne kao jedan veliki |
| U3 | Nema mere vremena do prvog odgovora i do rešenja | ne vidi se da li obećanje „prijave se čitaju" stoji |
| U4 | Greške koje niko ne prijavi se ne vide (osim u logu) | većina korisnika ne prijavljuje — ode |
| U5 | Veza prijave sa poslom na kodu je u tvojoj glavi | „rešeno" ne kaže u kom commitu, prijava se zaboravi posle popravke |
| U6 | Korisnik vidi samo status; ne može da odgovori ni da doda informaciju | razgovor se seli u mejl i gubi kontekst |
| U7 | Ideje nemaju gde da žive osim u listi utisaka | isti predlog stiže deset puta, a niko ne vidi da je već planiran |
| U8 | Obrazac prijave ne pita šta je čovek očekivao | reprodukcija zavisi od pogađanja |

### 6.3 Predlog

**1. Trijaža u konzoli (H1.4).**
- Nov prikaz **„Za obradu"** na `/admin/utisci`: samo `novo`, poređano po težini (bug sa
  `severity 1` → incident → ocena 1 → bug → ideja → ostalo), obrada sa tastature (`J/K`, `P`
  priznato, `D` duplikat, `R` rešeno, `1–3` težina).
- Težina bugova P1–P3 sa značenjem: **P1** ne može da plati, da uđe ili gubi kredite → cilj
  odgovora 24 h; **P2** funkcija ne radi → 72 h; **P3** kozmetika → sledeća isporuka.
- **Spajanje duplikata:** `feedback.duplicate_of` → original nosi broj pogođenih naloga; svi
  pogođeni dobijaju isti mejl kad je original rešen; nagrada ide samo prvom prijavljivaču.
- **Ideja → predlog:** dugme „Pretvori u predlog" (§7.4) umesto da ideja ostane u listi.
- **Mera u redu brojki:** medijana vremena do prvog odgovora i do rešenja, otvoreni P1/P2, starost
  najstarije neobrađene prijave.

**2. Automatski signal grešaka (H2.2).**
- Serverske greške iz API ruta i poslovi koji padnu konačno grupišu se po otisku (ruta + tip
  greške + prva linija poruke, bez ličnih podataka) u tabelu `error_groups`: broj pojava, broj
  naloga, prva i poslednja pojava. Ako je Sentry (H0.1) podešen, otisak je Sentry issue ID i tabela
  čuva samo vezu.
- Prijava sa istom rutom ili poslom u roku od 10 minuta se sama veže za grupu → u panelu:
  „3 prijave · 17 pojava · 9 naloga".

**3. Bolji obrazac prijave (H1.4).**
- Za tip **Bug** tri kratka polja (sva opciona): *Šta si uradio?* · *Šta si očekivao?* · *Šta se
  desilo?* — iznad slobodnog teksta, ne umesto njega.
- Kontekst sa servera se dopunjuje sa: verzija aplikacije (`VERCEL_GIT_COMMIT_SHA`), pregledač i
  širina ekrana, statusi poslednja 3 API poziva (samo putanja i status, nikad telo).

**4. GitHub issue iz konzole (H2.2).**
- Dugme „Napravi issue" u panelu: pravi issue u privatnom repou kroz GitHub API sa naslovom, koracima,
  kontekstom i vezom ka `/admin/utisci?utisak=<id>`. **Bez mejla, telefona, kontakata prospekta i
  bez slike** — slika ostaje u privatnom bucketu.
- `feedback.issue_url`; kad se issue zatvori (GitHub webhook ili ručno), prijava prelazi u
  `reseno` sa „popravljeno u <commit>" i ide mejl 3.1.
- Env: `GITHUB_TOKEN` (fine-grained, samo Issues na jednom repou), `GITHUB_REPO`.

**5. Odgovor u niti (H2.2).**
- Tabela `feedback_replies` (`feedback_id`, `author` = korisnik | admin, `body`, `created_at`):
  admin postavlja pitanje, korisnik odgovara u „Moje prijave", mejl obaveštenje u oba smera.
- Ograničenje: korisnik odgovara samo na svoju prijavu, 20 odgovora dnevno.

**6. „Moje prijave" v2 (H2.2).**
- Vremenska linija po prijavi: poslato → potvrđeno → u radu → rešeno (sa datumom isporuke i vezom
  na stavku u „Novo u Sajtoskopu") ili „neće se raditi" sa obrazloženjem.
- „Ovo je prijavilo još N ljudi" kad je prijava spojena kao duplikat.

**7. Nagrade i poštenje (H1.4).**
- +10 kredita za potvrđen bug ostaje, samo za prvog prijavljivača i samo za P1/P2; +1 za odgovor
  na pitanje ostaje; u probi nema nagrade (već tako).
- Javna rečenica u panelu: „Svaku prijavu čitam. Odgovor na grešku koja te blokira stiže u roku od
  jednog dana."

**8. Privatnost (sve faze).**
- Snimci prijava žive 90 dana (cron `utisci-slike`), nikad ne izlaze u GitHub, digest ni izveštaj.
- Kontekst nikad ne nosi tela zahteva, kontakte prospekta ni query string.

### 6.4 Podaci (predlog)

```
feedback             + duplicate_of bigint references feedback(id)
                     + issue_url text
                     + first_response_at timestamptz, resolved_commit text
                     + error_group_id bigint
feedback_replies     id, feedback_id, author_kind ('korisnik'|'admin'), author_id, body, created_at
error_groups         id, fingerprint unique, route, kind, first_seen, last_seen,
                     occurrences, users, sentry_issue text, status
```

RLS na svakoj tabeli; čitanje i upis kroz rute (pravilo 10). Svaka admin radnja u reviziji
(pravilo 14).

### 6.5 Faze

| Faza | Stavka | Sadržaj |
|---|---|---|
| 1 | H1.4 | trijaža „Za obradu", težina P1–P3, spajanje duplikata, mera vremena, bolji obrazac, pravila nagrade |
| 2 | H2.2 | `error_groups` i veza sa prijavama, GitHub issue, niti, „Moje prijave" v2 |
| 3 | H2.1 | ideja → predlog na javnoj tabli |

---

## 7. Javna tabla „Plan razvoja" (predlog)

### 7.1 Cilj

Korisnici vide šta se gradi i šta je isporučeno, predlažu funkcionalnosti i glasaju. Za tebe:
ideje na jednom mestu sa brojem ljudi koji ih žele, umesto deset istih utisaka. Za prodaju:
dokaz da se proizvod kreće.

### 7.2 Šta se vidi

- **Adresa:** `app.sajtoskop.com/plan` — javna strana, čita se **bez prijave**; landing je linkuje
  („Šta gradimo") iz futera. Glasanje i predlaganje traže nalog.
- **Kolone plana:** *Razmatramo* · *Planirano* · *U izradi* · *Isporučeno* (poslednjih 90 dana, sa
  vezom na stavku u „Novo u Sajtoskopu"). **Bez datuma** — plan nije obećanje roka.
- **Predlozi:** lista odobrenih predloga poređana po broju glasova, filter po kategoriji
  (*Pretraga i podaci · Kartica i poruke · Pipeline · Naplata i nalog · Region · Ostalo*) i pretraga
  po tekstu pre nego što se napiše nov (da se ne duplira).
- **Kartica predloga:** naslov, opis, kategorija, status, broj glasova, dugme „Glasaj". Autor se ne
  prikazuje javno (ime korisnika je lični podatak); prikazuje se „tvoj predlog" samo autoru.
- U aplikaciji: stavka „Plan razvoja" u bočnoj traci (grupa Nalog) i dugme u panelu utiska:
  „Imaš ideju? Predloži je na planu".

### 7.3 Pravila glasanja i predlaganja

- Glasa i predlaže **svaki nalog koji nije zaključan** (i proba, i komp, i dopuna); zaključan nalog
  čita.
- **Jedan glas po predlogu po nalogu**, može da se povuče. **Najviše 10 aktivnih glasova** po
  nalogu — glas se vraća kad predlog bude isporučen ili odbijen. Ograničenje tera na izbor i čini
  brojku smislenom.
- Predlog: naslov do 80 znakova, opis do 1.000, kategorija. **Najviše 3 predloga dnevno** po nalogu.
- **Moderacija:** nov predlog nije javan dok ga admin ne odobri (spam, lični podaci, psovke,
  duplikati). Autor vidi „čeka pregled".
- Glasovi plaćenih planova se u konzoli vide odvojeno (po planu), javno samo zbir.

### 7.4 Veza sa utiscima i dnevnikom

- Utisak tipa **Ideja** → admin „Pretvori u predlog": admin prepiše naslov i opis (utisak je bio
  privatan), autor utiska se upisuje kao autor predloga i dobija prvi glas, utisak dobija status i
  vezu na predlog.
- **Spajanje:** duplikat predloga se spaja u original; glasovi se sabiraju bez dupliranja istog naloga.
- Predlog prelazi u *Isporučeno* → admin bira ili pravi stavku u „Novo u Sajtoskopu"; stavka nosi
  vezu nazad na predlog.
- Stavke iz ovog roadmap-a koje nisu osetljive (bez cena, bez pravnih i bezbednosnih tema) mogu
  da se objave kao početni sadržaj kolona.

### 7.5 Podaci (predlog)

```
ideas        id, title, body, category, status ('na_pregledu'|'razmatramo'|'planirano'|
             'u_izradi'|'isporuceno'|'odbijeno'|'spojeno'), author_id, feedback_id,
             merged_into bigint references ideas(id), changelog_id, votes_count,
             admin_note, status_note, created_at, updated_at, shipped_at
idea_votes   PK (idea_id, user_id), created_at, notify boolean default true
```

- RLS uključen, bez javnih politika; javna strana čita kroz API rutu koja vraća samo odobrene
  predloge i nikad `author_id` (pravilo 10).
- Glasanje kroz RPC sa `for update` nad profilom (limit 10 aktivnih) — isti obrazac kao novčane
  funkcije, da dva paralelna klika ne probiju limit.
- `votes_count` održava triger; javna strana keširana 60 s.
- `user_id` glasa isključivo iz Clerk sesije (pravilo 8); tempo po IP-u i nalogu.

### 7.6 Admin

`/admin/plan`: red za pregled (odobri / odbij sa razlogom / spoji), kanban statusa, izmena teksta,
veza sa utiskom i dnevnikom, raspodela glasova po planu. Ne-admin dobija 404 (pravilo 13), svaka
radnja u reviziji (pravilo 14).

### 7.7 Obaveštenja

- Autor i glasači sa `notify = true` dobijaju mejl 3.6 kad predlog pređe u *Planirano* ili
  *Isporučeno* (ne na svaku izmenu); jedan zbirni mejl ako se više predloga pomeri isti dan.
- Autor dobija mejl kad je predlog odobren ili odbijen (sa razlogom).
- Odjava kroz isti prekidač (§5.0) i po glasu („ne javljaj mi za ovaj").

### 7.8 Terminologija (dopisuje se u `CLAUDE.md` pri izradi)

| Kod | UI |
|---|---|
| roadmap / public board | plan razvoja |
| idea | predlog |
| vote | glas |
| shipped | isporučeno |

### 7.9 Mera

Udeo aktivnih naloga koji su glasali bar jednom (cilj: 30 %), broj novih predloga nedeljno, vreme
od *Planirano* do *Isporučeno*, broj utisaka tipa Ideja pre i posle table (treba da padne).

### 7.10 Odluke pri izradi (sa predlogom)

| Pitanje | Predlog |
|---|---|
| Da li anonimni posetilac vidi i predloge ili samo plan? | vidi oba; glasanje traži nalog |
| Limit aktivnih glasova | 10 |
| Da li plaćeni glas vredi više? | ne javno; interno se vidi raspodela po planu |
| Komentari na predlozima | ne u prvoj verziji — komentari traže moderaciju i pretvaraju tablu u forum |
| Gde živi tabla | u aplikaciji, ne na landingu — landing je van repoa i nema bazu |

### 7.11 Faze

1. **Plan bez glasanja (S–M):** `ideas` bez glasova, javna strana sa kolonama, `/admin/plan`, veza sa
   „Novo u Sajtoskopu". Punjenje iz ovog roadmap-a.
2. **Predlozi i glasanje (M):** `idea_votes`, RPC glasanja, obrazac predloga, moderacija, limiti.
3. **Veza i obaveštenja (S–M):** utisak → predlog, spajanje, mejlovi 3.6.

---

## 8. Promptovi za veće stavke

Svaki prompt se kopira u prazan prozor Claude Code-a u ovom repou. Sitne stavke (H1.5–H1.9,
H2.8–H2.10) ne traže poseban prompt: „Pročitaj CLAUDE.md i docs/roadmap.md, uradi stavku <ID>."

### H1.1 + H1.2 — mejlovi: infrastruktura, naplata, proba, komp

```
Pročitaj CLAUDE.md, docs/roadmap.md §5 (ceo), docs/naplata-stripe.md §6 i §7, i
apps/web/src/lib/mail.ts. Radimo H1.1 pa H1.2 iz roadmap-a.

1. Migracija: email_log (unique user_id+email_key+ref) i profiles.email_opt_out_at.
   RLS uključen, bez politika.
2. lib/mejlovi/: šablon (HTML + tekst, logo, jedno dugme, boje iz dizajn-sistem.md §3.1 samo
   u tom modulu — dopiši izuzetak u CLAUDE.md), posaljiJednom(userId, kljuc, ref, mejl) nad
   email_log, dve adrese iz env-a (EMAIL_FROM_TRANSAKCIONI, EMAIL_FROM_LICNI) sa rezervom na
   FEEDBACK_EMAIL_FROM, Reply-To uvek FEEDBACK_EMAIL_TO.
3. /odjava?t= (HMAC token, bez prijave) i List-Unsubscribe + List-Unsubscribe-Post zaglavlja
   na svakom netransakcionom mejlu. Transakcioni mejlovi ignorišu odjavu.
4. Mejlovi iz §5.5 i §5.6 označeni [H1], svaki iz svog Stripe događaja u lib/billing.ts
   (invoice.upcoming dodaj u obradu i u docs/naplata-stripe.md §6.1) ili iz dnevnog crona
   /api/cron/mejlovi (komp ističe / istekao). Pad slanja nikad ne obara webhook.
5. Na detalju korisnika u konzoli: poslednjih 20 mejlova iz email_log.
Tekstovi na srpskom po terminologiji iz CLAUDE.md; datumi i krediti iz baze.
Testovi: idempotencija po ključu, odjava ne blokira transakcioni, svaki Stripe događaj
šalje tačno jedan mejl. pnpm typecheck, pnpm test, pnpm check:sql, lint, build.
Dopuni docs/plan-testiranja.md, unos u docs/dnevnik-isporuka.md, obriši H1.1/H1.2 iz roadmap-a.
```

### H1.3 — onboarding sekvenca

```
Pročitaj CLAUDE.md, docs/roadmap.md §5.0 i §5.2, docs/tok-i-onboarding.md §4. Radimo H1.3.
Dnevni cron /api/cron/mejlovi (postoji od H1.1) dobija sekvencu 2.1–2.6: uslovi iz
onboarding_steps, unlocks i last_seen_at; najviše jedan netransakcioni mejl dnevno po
korisniku; 2.3 se ne šalje isti dan kad je podsetnik utiska prikazan. Lični mejlovi sa
EMAIL_FROM_LICNI, skoro čist tekst. Predloži mi tekstove svih šest mejlova PRE nego što ih
upišeš. Testovi uslova za svaki mejl. Unos u dnevnik, obriši H1.3 iz roadmap-a.
```

### H1.4 — utisci v3, faza 1

```
Pročitaj CLAUDE.md, docs/roadmap.md §6 (ceo), docs/tok-i-onboarding.md §5, i postojeće
/admin/utisci i utisak-dugme.tsx. Radimo H1.4 = §6.3 tačke 1, 3 i 7.
Migracija: feedback.duplicate_of, first_response_at. Prikaz „Za obradu" sa redosledom po
težini i tastaturom, težina P1–P3 (postojeći severity 1–3), spajanje duplikata (broj
pogođenih, mejl „rešeno" svima, nagrada samo prvom), mera vremena u redu brojki, tri polja
za Bug u panelu, verzija aplikacije u kontekstu. Admin radnje kroz saAuditom (pravilo 14).
Obe teme, 390 px. Testovi. Dopuni plan testiranja (Deo 10), unos u dnevnik, obriši H1.4.
```

### H2.1 — javna tabla, faza 1 i 2

```
Pročitaj CLAUDE.md, docs/roadmap.md §7 (ceo), docs/dizajn-sistem.md. Radimo H2.1, faze 1 i 2
iz §7.11. Pre koda mi predloži šemu (§7.5) i tačan izgled javne strane /plan i
/admin/plan, i čekaj potvrdu.
Pravila: javna strana bez prijave i bez author_id u odgovoru; glas kroz RPC sa for update
i limitom 10 aktivnih; predlog nije javan do odobrenja; 3 predloga dnevno; user_id samo iz
sesije; 404 za ne-admina; revizija za svaku admin radnju; terminologija iz §7.8 dopisana u
CLAUDE.md. Obe teme, 390 px, .num na brojevima glasova. Testovi (limit glasova u trci,
nevidljiv neodobren predlog, nema author_id u JSON-u). Dopuni plan testiranja, unos u
dnevnik, ažuriraj roadmap (faza 3 ostaje).
```

### H2.2 — utisci v3, faza 2

```
Pročitaj CLAUDE.md, docs/roadmap.md §6.3 tačke 2, 4, 5, 6 i 8, i §6.4. Radimo H2.2. Pre koda
predloži otisak greške (šta ulazi, šta nikad ne ulazi) i čekaj potvrdu. error_groups sa
vezom na prijave; „Napravi issue" kroz GitHub API bez ličnih podataka i bez slike
(GITHUB_TOKEN, GITHUB_REPO); feedback_replies sa obaveštenjem u oba smera; „Moje prijave" sa
vremenskom linijom. Testovi, obe teme, 390 px. Unos u dnevnik, obriši H2.2.
```
