# Sesije — redosled isporuka i gotovi promptovi

Ovaj fajl postoji zato što jedna sesija radi iz **jednog PRD-a** i zato što se kontekst ne
prenosi sam. Ispod je redosled preostalog posla i, za svaku sesiju, prompt koji se kopira u
prazan prozor bez ijedne dopune.

**Pravilo:** poslednji korak svake sesije je ažuriranje ovog fajla — štiklirano gotovo,
dopisano šta se u praksi razišlo sa PRD-om, i, ako se opseg promenio, prepravljen prompt za
sledeću sesiju.

---

## Stanje

| # | Isporuka | PRD | Migracija | Procena | Stanje |
|---|---|---|---|---|---|
| S1 | F11.1 — motor utisaka | `F11-utisci-v2.md` | `0011` | 1,5 dan | ☑ |
| S2 | F11.2 — kampanje, panel, slika | `F11-utisci-v2.md` | — | 1 dan | ☑ |
| S3 | F12.1 — admin temelj | `F12-admin.md` | `0012` | 1 dan | ☑ |
| S4 | F12.2 — admin radnje | `F12-admin.md` | — | 1 dan | ☑ |
| S5 | F12.3 — pozivnice i pregled | `F12-admin.md` | `0013`, `0014` | 0,5–1 dan | ☑ |
| S6 | F11.3 — utisci u konzoli | `F11-utisci-v2.md` | `0015` | 0,75 dan | ☑ |
| S7 | F11.4 — zatvaranje petlje | `F11-utisci-v2.md` | `0016` | 0,75 dan | ☑ |
| S8 | Faza 0 — worker: novac i pouzdanost | `PLAN-IZMENA.md` | `0017` | 0,5–1 dan | ☑ |
| S9 | Faza 1 — bezbednost: P1 lista | `PLAN-IZMENA.md` | `0018` | 0,5–1 dan | ☑ |
| S10 | Faza 2 — ispravnost: uvoz, pretraga, web | `PLAN-IZMENA.md` | `0019` | 1–2 dana | ☑ |
| S11 | Faza 3 — performanse | `PLAN-IZMENA.md` | `0020` | 1–2 dana | ☑ |

**Zašto ovaj redosled:** S1 i S2 počinju da skupljaju podatke odmah i ne zavise ni od jednog
admin ekrana. S6 i S7 zavise — status prijave nema gde da se postavi bez konzole. Dakle:
skupljaj → napravi mesto za obradu → zatvori petlju.

---

## Kraj svake sesije — ista lista

```
pnpm typecheck
pnpm check:sql
pnpm check:secrets
```

- [ ] Obe teme provereno (tamna i svetla), i telefon (≤ 390 px)
- [ ] Nijedan hex ni oklch u JSX-u; sve kroz tokene
- [ ] `.num` na svakom broju, ID-u, URL-u i telefonu
- [ ] Nijedan `any` u novom kodu
- [ ] Migracija je numerisan fajl u `supabase/migrations/`, nikad ručna izmena u konzoli
- [ ] `docs/SESIJE.md` ažuriran, prompt za sledeću sesiju prepravljen ako se opseg pomerio
- [ ] Commit poruka na engleskom, u obliku `F11.1 feedback prompt engine`

---

## S1 — F11.1: motor utisaka ☑ isporučeno

### Šta je isporučeno

- `supabase/migrations/0011_f11_utisci_v2.sql` — `feedback` prošireno (rating nullable + 11
  kolona + četiri ograničenja + dva indeksa), `feedback_prompts`, četiri kolone na
  `profiles`, `changelog`, razlog `feedback` u knjizi **i u telu `grant_credits`**,
  `grant_feedback_credits`
- `packages/shared/src/feedback-katalog.ts` — tipovi + tri pitanja (`prva-lista`,
  `prazan-rezultat`, `posao-pao`), Zod šema po pitanju, `proveriOdgovor()`, `opisOdgovora()`
- `packages/shared/src/feedback-motor.ts` — `odluci()`, `sledecePitanje()`, `smeDaSePita()`,
  `poslePrikaza()`, `posleOdgovora()`, `posleOdbacivanja()`; sve čiste funkcije
- `apps/web/src/lib/utisci.ts` — čitanje stanja za layout, upis prikaza, odbacivanja, odgovora
- rute `POST /api/feedback/pitanje/[kljuc]/prikazano` i `.../odbaceno`, prošireni
  `POST /api/feedback` (`prompt_key` + `answers`, validirani prema katalogu)
- `UtisciProvider` u `okvir-aplikacije.tsx`, `utisak-mikro.tsx`, montaža sva tri pitanja na
  `/pretraga`
- provere: `pnpm check:sql` (F11 blok), `pnpm test` (motor i katalog)

### Šta se razišlo sa PRD-om

1. **`credit_ledger_reason_valid` zadržava `'scan'`.** F11 §4 piše listu bez njega, jer je
   pisan pre F9. Doslovan prepis bi oborio `spend_credit_and_scan` na prvom pozivu. Lista je
   `('unlock','scan','monthly_grant','admin','refund','feedback')`.
2. **`grant_feedback_credits` hvata ishod `grant_credits`** umesto `perform`. PRD-ova verzija
   na ponovljen poziv vraća `ok = true` iako drugi kredit nije dodeljen; sada to izlazi kao
   `vec dodeljeno`. Broj dodeljenih kredita je isti, menja se samo šta se javlja.
3. **Mejl i dalje ide instant za sve, kao u F10.** Digest u 21:00 je F11.3; do njega bi
   „samo bug i ocena 1 idu odmah" značilo da odgovori na pitanja nigde ne stignu. Mejl nosi
   red „Pitanje" i „Odgovor", ali **ne** i link na `/admin/utisci/<id>` — konzola još ne
   postoji.
4. **Rate limit `/pitanje/*` nije poseban brojač.** Gornju granicu daje sama šema: PK
   `(user_id, prompt_key)` pušta jedan prikaz po pitanju (409 na drugi), `posao-pao` jedan na
   24 h, a odbacivanje je idempotentno po pitanju — dupli klik ne diže streak drugi put. Ako
   se ikad pokaže potreba, brojač 30/24 h se dodaje bez izmene ugovora.
5. **Polje `do:` po pitanju nije dodato** — po planu ide u S2, zajedno sa pitanjima koja ga
   stvarno traže.
6. **Mikro-traka rezerviše visinu u trenutku odluke**, ne trajno. Trajna rezervacija bi
   značila prazan procep od 44 px na svakom ekranu i za korisnike koji pitanje neće dobiti.
   Sadržaj ulazi `opacity + y(8px)` unutar već rezervisane visine, pa ništa u traci ne skače.
7. **Katalog ima tri polja kojih nema u PRD-ovom tipu:** `tekstPrvi` (tekst kao prvi korak,
   za `prazan-rezultat`), `ponovi` (izuzetak „1× po nalogu", za `posao-pao`) i `prijava`
   (server iz njega izvodi `kind` i `severity` — nikad iz tela).
8. **`posao-pao` se javlja i kad polling istekne**, kako PRD i traži, sa `jobId` u
   `answers`. Dnevnik klijentskih grešaka nije uz njega — to je S2.
9. Dodata dva ograničenja kojih nema u PRD-u: `feedback_reward_valid` (0–10) i
   `profiles_feedback_counters_nonneg`.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm check:secrets`, `pnpm test` i `pnpm build` prolaze.
Nijedan hex ni oklch u JSX-u; sve kroz tokene. **Vizuelna provera obe teme i telefona
(≤ 390 px) ostaje na meni** — nije je moguće obaviti iz sesije bez pregledača.

### Prompt (za ponavljanje isporuke iz nule)

```
Radimo F11.1 iz docs/F11-utisci-v2.md. Pročitaj prvo CLAUDE.md, docs/00-kontekst.md,
docs/DIZAJN-SISTEM.md i ceo docs/F11-utisci-v2.md. Ne implementiraj ništa iz F11.2, F11.3,
F11.4 ni iz F12 — te faze su namerno odvojene.

Zatečeno stanje: F10 je isporučen i radi (plutajuće dugme, modal u dva koraka, tabela
feedback, mejl kroz Resend, podsetnik na dan 3). F11.1 ga NE prepisuje nego dodaje sloj
iznad.

Napravi:

1. supabase/migrations/0011_f11_utisci_v2.sql — tačno kako stoji u F11 §4:
   - feedback: rating postaje nullable, novi stupci (prompt_key, answers, status, severity,
     tags, admin_note, resolved_at, notified_at, seen_at, screenshot_path, reward_credits),
     nova check ograničenja, prošireno feedback_source_valid, dva nova indeksa
   - nova tabela feedback_prompts sa RLS enable + force, bez politike
   - profiles: feedback_cooldown_until, feedback_muted_until, feedback_dismiss_streak,
     feedback_unseen_count
   - tabela changelog sa jedinom politikom select using (published)
   - credit_ledger: reason 'feedback' u check ograničenju I u telu funkcije grant_credits
     (ona interno validira razlog — bez izmene tela svaka dodela tiho vrati invalid_reason),
     prošireni parcijalni unique indeks za idempotenciju
   - funkcija grant_feedback_credits
   Migracija ne sme da dira nijedan postojeći podatak.

2. packages/shared/src/feedback-katalog.ts — tipovi Pitanje/Oblik/Sloj i katalog sa tri
   pitanja koja žive na /pretraga: prva-lista, prazan-rezultat, posao-pao. Zod šema za
   answers po pitanju. Eksport kroz src/index.ts barrel. Kopi tačno iz F11 §2.1 i §2.2.

3. packages/shared — čiste funkcije motora pravila iz F11 §3: sledecePitanje(stanje,
   kandidati, sada) i pravila za cooldown, ćutanje i streak. Bez React-a, bez fetch-a.

4. apps/web — UtisciProvider (klijentski kontekst): dobija stanje motora iz (app)/layout.tsx
   (profil se već čita — nijedan dodatan upit po navigaciji) i jedan upit nad
   feedback_prompts po punom učitavanju. Sesija je sessionStorage ključ
   sajtoskop-utisak-sesija.

5. apps/web/src/components/utisak-mikro.tsx — mikro-traka po F11 §6.1: 44 px, bez senke,
   rezerviše visinu pre pojave, ulaz opacity + y(8px) 0,34 s, klik na odgovor menja traku u
   mestu, nestaje posle 6 s, role="status".

6. Rute: POST /api/feedback/pitanje/[kljuc]/prikazano i .../odbaceno; proširen POST
   /api/feedback (prompt_key + answers, validirani prema katalogu — nepoznat ključ je 400).

7. Montaža na /pretraga za sva tri pitanja.

Nepregovarljivo: pravila 3, 8, 10 i 16 iz CLAUDE.md; nijedan hex u JSX-u; obe teme; nijedan
novi Places poziv.

Kad završiš: pusti pnpm typecheck i pnpm check:sql, prođi kroz listu „Kraj svake sesije" iz
docs/SESIJE.md, ažuriraj taj fajl (štikliraj S1, upiši šta se razišlo sa PRD-om) i napiši mi
prompt za sledeću sesiju.
```

---

## S2 — F11.2: kampanje, panel, slika ☑ isporučeno

### ‼️ Ručni korak pre puštanja

**Bucket `feedback` se pravi rukom, u Supabase konzoli** — Storage → New bucket,
ime `feedback`, **Public = off**, bez ijedne politike (F11 §8). Migracija ga ne
pravi: `storage.buckets` ne postoji u PGlite-u, pa bi `pnpm check:sql` pao na
svakoj migraciji. Dok bucketa nema, `POST /api/feedback/slika` vraća `502` sa
porukom „Slika trenutno ne može da se sačuva" — utisak i dalje prolazi bez nje.

### Šta je isporučeno

- `packages/shared/src/feedback-katalog.ts` — **osam pitanja** (dodata
  `tacnost-podataka`, `poruka-kvalitet`, `prvi-potpisan`, `cena`,
  `zasto-ne-vracas`), obavezno polje `do:` na svakom, tip `Uslovi`, opsezi cene
  (`CENA_OPSEZI`) i `medijanaCene()`, `vaziPitanje()`, polja `uvod`, `napomena`,
  `sufiks`, `drugiKorak`, `cipovi`, `bezNagrade`, `uslov`
- `feedback-motor.ts` — `odluci()` poštuje `do:` i `uslov` (kroz
  `MotorTrenutak.uslovi`); pitanje sa uslovom bez prosleđenog stanja **otpada**
- `apps/web/src/components/utisak-dugme.tsx` — **panel umesto modala**: 360 px,
  usidren uz dugme, focus trap, `Esc` vraća fokus na dugme, prečica
  `Ctrl/⌘ + Shift + U`, zona za sliku (paste i drop), čip „+1 kredit" uz polje za
  tekst. Podsetnik na dan 3 **ostaje modal** i deli isto telo forme
- `utisak-kartica.tsx` — kampanjska kartica (§6.3), jedina sa akcentom
- `utisak-mikro.tsx` — dodat korak sa čipovima i potvrda sa nagradom
- `lib/dnevnik-gresaka.ts` (~65 linija sa komentarima) — poslednjih 5 grešaka u
  memoriji taba; ruta bez query stringa, bez steka, bez `localStorage`-a
- `lib/slika.ts` + `POST /api/feedback/slika` — ≤ 2 MB, png/jpeg/webp po
  **magičnim bajtovima**, ime iz `uuid`, privatan bucket, 10 otprema na 24 h
- `lib/feedback.ts` — `nagradaDostupna()`, `porukaZasluzujeNagradu()`,
  `nagradiZaPoruku()` (kroz `grant_feedback_credits`), dnevnik grešaka u `ctx`,
  spajanje drugog koraka odgovora u `dopuniUtisak()`
- `lib/utisci.ts` — `citajUslove()`; layout ga čita paralelno sa stanjem motora
- montaža: `cena` i `zasto-ne-vracas` na `/pretraga`, `tacnost-podataka` uz
  potvrdu otključavanja, `poruka-kvalitet` u panelu poruka, `prvi-potpisan` u
  kanbanu
- provere: `pnpm test` (rok, uslovi, medijana, drugi korak, čipovi),
  `pnpm check:sql` (slika i dnevnik staju uz utisak)

### Šta se razišlo sa PRD-om

1. **`poruka-kvalitet` se javlja na PRVU kopiranu poruku, ne na prvu AI poruku.**
   PRD §2.1 traži AI varijantu, ali „Napiši drugačije" je dugme koje mnogi neće
   ni kliknuti — pitanje bi stiglo do šačice ljudi. Poreklo (`sablon` / `ai`) i
   kanal ulaze u `answers`, pa se brojka po izvoru i dalje vidi.
2. **`tacnost-podataka` stoji uz potvrdu otključavanja na `/pretraga`, ne u
   „panelu prospekta".** Panela prospekta u proizvodu nema (F5 ga nije doneo kao
   zaseban ekran). Traka je tu gde su i podaci o kojima pita — u redu koji je
   upravo dobio telefon, mejl i skor.
3. **`danaPauze` se čita iz `searches`, ne iz `profiles.last_seen_at`.** Ta
   kolona dolazi tek sa F12 (migracija 0012). `searches` ima indeks
   `(user_id, created_at desc)` i piše se i za keš i za plaćeno skeniranje. Kad
   F12 stigne, menja se samo `citajUslove()`.
4. **Dva dodatna upita po punom učitavanju** (broj otključanih, poslednja
   pretraga). Klijentska navigacija i dalje ne košta ništa, i nijedan nije Places
   poziv.
5. **Drugi korak odgovora ide kroz `PATCH /api/feedback/[id]` sa `answers`**, a
   ne kroz novu rutu. Server ga spaja sa već upisanim odgovorom i **ponovo**
   provuče kroz šemu iz kataloga — drugi korak nije rupa u kapiji (pravilo 16).
6. **`postaviMir` prima i izvor** (`postaviMir("pretraga", true)`). Sa jednim
   booleanom bi zatvaranje panela proglasilo ekran mirnim usred skeniranja, jer
   pobeđuje poslednji koji javi. Panel sa porukama se **namerno ne prijavljuje**
   kao nemir — on jedini nosi pitanje, pa bi ućutkao sopstvenu traku.
7. **Nagrada: kapije se proveravaju pre odgovora, dodela ide u `after()`.** PRD
   traži `after()`, ali korisnik u istoj potvrdi mora da sazna šta se desilo.
   Prozor između to dvoje je jedan zahtev, a RPC je idempotentan po `fb:<id>` —
   u najgorem slučaju se dvaput pokuša isto, nikad se dvaput ne dodeli.
8. **Dnevna i mesečna kvota broje stavke sa `delta = 1`**, ne sve sa razlogom
   `feedback`: ručnih +10 za potvrđen bug (F11.3) ima isti razlog u knjizi, a ne
   sme da pojede korisnikovu dnevnu kvotu. Dan i mesec se računaju po UTC-u, isto
   kao `date_trunc('month', now())` u RPC-u.
9. **`do:` je obavezno polje, ne opciono.** Sva pitanja bete nose `KRAJ_BETE`
   (`2026-12-31`), jedna konstanta; `posao-pao` nosi `2027-12-31`, jer je usluga
   korisniku a ne kampanja. Rok se poštuje u motoru **i** u rutama
   (`prikazano` → `410`, `POST /api/feedback` → `410`).
10. **`screenshot_path` se proverava po vlasniku** u obe rute (`<user_id>/…`).
    To je jedino polje koje putuje kroz pregledač između dve rute, dakle jedino
    koje klijent može da zameni tuđim.
11. **Sirotani u Storage-u se još ne brišu.** F11 §9 traži nedeljni cron za slike
    bez `feedback_id` starije od 24 h — to ide uz ostale cron rute u S6.
12. **Rate limit `/slika` se broji nad bucketom**, ne nad `feedback.screenshot_path`:
    slika koja je otpremljena a utisak nikad poslat mora da se računa, inače je
    limit od 10 zapravo neograničen.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm check:secrets`, `pnpm test` i
`pnpm build` prolaze. Nijedan hex ni oklch u JSX-u; nijedna nova biblioteka
(focus trap je ~25 linija, otprema ide kroz `FormData` iz pregledača); nijedan
nov Places poziv. **Vizuelna provera obe teme i telefona (≤ 390 px) ostaje na
meni** — nije je moguće obaviti iz sesije bez pregledača. Uz nju ide i jedna
funkcionalna: nalepi snimak ekrana u panel i proveri da je stigao u bucket.

### Prompt (za ponavljanje isporuke iz nule)

```
Radimo F11.2 iz docs/F11-utisci-v2.md. Pročitaj CLAUDE.md, docs/DIZAJN-SISTEM.md, ceo
docs/F11-utisci-v2.md i odeljak „S1 — F11.1" u docs/SESIJE.md (šta je isporučeno i šta se
razišlo sa PRD-om). Ne diraj admin — to je docs/F12-admin.md i ide u zasebnoj sesiji.

Zatečeno stanje iz S1, ne prepisuje se nego se dopunjuje:
- packages/shared/src/feedback-katalog.ts — tipovi Pitanje/Oblik/Sloj, tri pitanja sa
  /pretrage, Zod šema po pitanju, proveriOdgovor(), opisOdgovora()
- packages/shared/src/feedback-motor.ts — odluci(), smeDaSePita(), poslePrikaza(),
  posleOdgovora(), posleOdbacivanja(); čiste funkcije, pokrivene u pnpm test
- apps/web/src/components/utisci-provider.tsx — UtisciProvider i useUtisci();
  prijaviDogadjaj(kljuc, dodatak) je jedina ulazna tačka za nov okidač
- apps/web/src/components/utisak-mikro.tsx — mikro-traka (oblik „mikro")
- apps/web/src/lib/utisci.ts + rute prikazano/odbaceno + prošireni POST /api/feedback
  (prompt_key, answers, izvor i severity se IZVODE iz kataloga, ne primaju iz tela)

Napravi:

1. Katalog dopunjen sa: tacnost-podataka (3. otključavanje, panel prospekta),
   poruka-kvalitet (prva kopirana AI poruka), prvi-potpisan (prvi lead u koloni Potpisan),
   cena (≥ 7 dana i ≥ 5 otključanih), zasto-ne-vracas (povratak posle ≥ 10 dana).
   Svako pitanje dobija polje `do:` — datum posle kog ga motor ne vidi; motor ga poštuje u
   odluci() i za pitanja koja su već u katalogu.

2. Kampanjska kartica po F11 §6.3: jedina kartica koja sme da nosi akcenat. Pitanje o ceni
   sa šest opsega u RSD, medijana iz sredina opsega. Rečenica „Iskren odgovor mi je vredniji
   od lepog" stoji ispod. Odgovor o ceni se NE nagrađuje kreditima.

3. Panel umesto modala za plutajuće dugme (F11 §6.2): 360 px, usidren uz dugme, focus trap,
   Esc vraća fokus na dugme, prečica Ctrl/⌘+Shift+U. Klik na ocenu i dalje odmah šalje.
   Čip „+1 kredit" stoji uz polje za tekst i samo kad je nagrada zaista dostupna.

4. Slika uz utisak: paste i drop u panel, POST /api/feedback/slika — ≤ 2 MB, png/jpeg/webp
   po magičnim bajtovima a ne po Content-Type, ime iz uuid, privatan bucket `feedback`, bez
   ijedne javne politike. Bez ijedne nove biblioteke u bundle-u.

5. Dnevnik klijentskih grešaka (~40 linija): poslednjih 5 (poruka ≤ 200, tip, ruta BEZ query
   stringa, vreme). Šalje se samo uz kind='bug' i uz incident. Nikad telo zahteva, nikad
   sadržaj polja, nikad localStorage.

6. Nagrada +1 kredit za utisak sa porukom: u after() posle uspešnog PATCH-a, kapija je
   poruka ≥ 20 znakova, najviše 1 dnevno i 10 mesečno (u lib/feedback.ts), mesečni plafon 20
   je u RPC-u. Poziv ide kroz grant_feedback_credits (već postoji, migracija 0011) — nova
   migracija nije potrebna. Potvrda korisniku: „Poslato. Hvala — dodao sam ti 1 kredit."
   Kad je kvota potrošena, obična potvrda bez ijedne reči o kvoti.

Nepregovarljivo: pravila 3, 8, 10 i 16 iz CLAUDE.md; nijedan hex u JSX-u; obe teme; nijedan
novi Places poziv; nijedna nova biblioteka u bundle-u.

Kad završiš: typecheck, check:sql, check:secrets, pnpm test, lista iz docs/SESIJE.md,
ažuriraj taj fajl i napiši prompt za sledeću sesiju.
```

---

## S3 — F12.1: admin temelj ☑ isporučeno

### ‼️ Ručni korak pre puštanja

**`ADMIN_BOOTSTRAP_IDS` mora da se popuni pre prvog otvaranja konzole.** Dok je
prazan i dok nijedan profil nema `role = 'admin'`, `/admin/*` je `404` za sve — i za
mene. Vrednost je moj Clerk ID (`user_…`), iz Clerk konzole → Users → detalj. Ide u
`.env` lokalno i u Vercel env u produkciji. Objašnjenje stoji u `.env.example`.

### Šta je isporučeno

- `supabase/migrations/0012_f12_admin.sql` — `profiles.role` + `last_seen_at` sa
  `check` i dva indeksa, tabela `admin_audit` sa RLS `enable` + `force` i bez
  politike, `admin_adjust_credits`, `admin_users_page`
- `apps/web/src/lib/env.ts` — `adminBootstrapIds()` u odvojenoj Zod šemi, po
  obrascu `webhookSecret()`; prazna vrednost nije greška i ne baca
- `apps/web/src/lib/admin.ts` — `jeAdmin()`, `requireAdminPage()` → `notFound()`,
  `requireAdminRoute()` + `NeAdmin` + `odgovorNeAdmin()` → `404` sa praznim telom
- `apps/web/src/lib/admin-korisnici.ts` — `citajKorisnike()` (jedan RPC + jedan
  Clerk poziv za celu stranicu), `citajKorisnika()` (šest paralelnih čitanja),
  `citajReviziju()`, `citajRadnje()`
- grupa `(admin)` sa svojim layout-om, `admin-okvir.tsx` (bočna traka, `ADMIN`
  bedž), `admin-navigacija.ts`, `admin-filteri.tsx` (pretraga, segmentni filter,
  sortiranje po koloni, paginacija — sve kroz URL)
- `/admin/korisnici` (25 po strani, pet filtera, četiri sorta),
  `/admin/korisnici/[id]` (četiri bloka, samo čitanje), `/admin/revizija`
- `profiles.last_seen_at`: upis iz `(app)/layout.tsx` kroz `after()`, najviše
  jednom na sat; `citajUslove()` prebačen sa `searches` na tu kolonu
- `ui-tekst.ts` — `vremeUnazad()` i `RAZLOG_KREDITA` (izvučen iz `/krediti`, sad
  ga dele korisnički i admin prikaz iste knjige)
- `.env.example` — `ADMIN_BOOTSTRAP_IDS` sa objašnjenjem
- provere: `pnpm check:sql` (F12 blok — uloga, korekcija kredita, idempotencija
  po `ref_id`, dnevnik preživljava brisanje aktera, filteri i sortiranje liste)

### Šta se razišlo sa PRD-om

1. **`admin_audit.actor_id` je nullable.** F12 §2 piše `text not null references
   profiles(id) on delete set null` — to dvoje se isključuje: kad se akterov profil
   obriše, `on delete set null` pokušava `null` u `not null` kolonu i **brisanje
   naloga puca**. A brisanje admina je tačno onaj slučaj u kom dnevnik njegovih
   radnji mora da preživi. Kolona je zato nullable; u reviziji se `null` čita kao
   „obrisan nalog". Pokriveno proverom u `check:sql`.
2. **Dodata funkcija `admin_users_page`, koje nema u PRD-u.** §3.1 traži tri stvari
   zajedno: brojeve po korisniku iz **jednog** agregatnog upita, filter „bez ijedne
   aktivnosti" **nad tim brojevima**, i sortiranje **po broju otključanih**.
   PostgREST ume ugnježđen `count`, ali po njemu ne ume ni da filtrira ni da
   sortira — pa bi jedina alternativa bila N+1 petlja, koju §3.1 izričito zabranjuje.
   Funkcija je `stable`, samo čita, i revokovana je od `anon`/`authenticated`.
3. **Nema `GET /api/admin/korisnici` ni `GET /api/admin/korisnici/[id]`.** Ekrani su
   serverske komponente i čitaju direktno kroz `lib/admin-korisnici.ts`; rute iz §4
   bi bile drugi put do istih podataka, sa istom proverom i bez ijednog pozivaoca.
   `requireAdminRoute()` svejedno postoji — prve rute pod `/api/admin` dolaze u S4 i
   sve su mutacije.
4. **`(admin)/layout.tsx` takođe zove `requireAdminPage()`** — ne kao zaštitu (to
   ostaje na svakoj strani, pravilo 13) nego zbog onoga što se vidi: kad `notFound()`
   pozove **strana**, Next crta 404 **unutar** najbližeg layout-a, dakle unutar bočne
   trake sa `ADMIN` bedžom. To bi otkrilo tačno ono što `404` umesto `403` krije.
   Kad `notFound()` pozove layout, granica je iznad njega i okvira nema.
5. **Neprijavljen dobija redirekciju na prijavu, ne `404`.** Tako stoji i u §1
   (`requireAdminPage()` počinje sa `requireSession()`). Neprijavljen čovek time ne
   saznaje ništa što ne bi saznao i sa `/pipeline`, a admin sa zabeleženom adresom u
   odjavljenom pregledaču dobija prijavu umesto ćorsokaka. Rute se ponašaju
   drugačije: tamo i neprijavljen dobija `404`, jer rutu ne otvara čovek nego kod.
6. **`admin_adjust_credits` sam upisuje `admin_audit`** (tako i stoji u §2). Ruta iz
   S4 zato **ne sme** da upiše drugi red za uspelu korekciju — samo za pad, koji RPC
   ne vidi. **`grant_feedback_credits` (0011) to NE radi**, pa „dodeli 10 kredita" iz
   F11.3 mora sam da upiše svoj red. Dva omotača nad kreditima, dva različita
   ponašanja — to je jedina zamka u ovom delu.
7. **Dodat indeks `profiles_last_seen_idx`**, kog nema u §2. Kolona nosi i filter
   „aktivni 7d" i jedan od četiri sorta; bez indeksa bi oba bila puno čitanje tabele.
8. **`citajUslove()` više ne čita `searches`.** Time otpada dug iz S2 (tačka 3) i
   jedan upit po punom učitavanju. Usput se ispravlja i tačnost: po `searches` bi
   čovek koji svakog dana otvara pipeline a ništa ne pretražuje ispao odsutan
   mesecima i dobio `zasto-ne-vracas` a da nikad nije ni otišao. **Prvi dolazak posle
   0012 se svima broji kao početak, ne kao povratak** — `last_seen_at` je tada `null`,
   pa je pauza nula.
9. **Bočna traka konzole nosi samo dva ekrana** (Korisnici, Revizija). `/admin`
   pregled je F12.3, `/admin/utisci` je F11.3, `/admin/dnevnik` je F11.4 — stavka u
   meniju koja vodi na `404` je gora od stavke koje nema.
10. **Konzola se ne skuplja i nema mobilnu fioku.** Dva ekrana ne traže dugme za
    skupljanje; na telefonu se navigacija preliva u gornju traku kao dve ikonice.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm check:secrets`, `pnpm test` i `pnpm build`
prolaze. Nijedan hex ni oklch u JSX-u; nijedna nova biblioteka; nijedan nov Places
poziv. Sve tri admin rute su dinamičke. **Vizuelna provera obe teme i telefona
(≤ 390 px) ostaje na meni** — nije je moguće obaviti iz sesije bez pregledača. Uz nju
ide i jedna funkcionalna: popuni `ADMIN_BOOTSTRAP_IDS`, otvori `/admin/korisnici`, pa
proveri da je `/admin/korisnici` `404` iz naloga koji nije admin.

### Prompt (za ponavljanje isporuke iz nule)

```
Radimo F12.1 iz docs/F12-admin.md. Pročitaj CLAUDE.md (naročito nova pravila 13–15),
docs/00-kontekst.md, docs/DIZAJN-SISTEM.md i ceo docs/F12-admin.md. Ništa iz F12.2 i F12.3.

Zatečeno stanje: F11.1 i F11.2 su isporučeni (v. „S1" i „S2" u docs/SESIJE.md) i već
skupljaju podatke. Admin ih NE dira u ovoj sesiji — /admin/utisci je S6.

Napravi:

1. supabase/migrations/0012_f12_admin.sql: profiles.role + profiles.last_seen_at sa check i
   parcijalnim indeksom, tabela admin_audit sa RLS enable + force i bez politike, funkcija
   admin_adjust_credits (samo service_role). Tačno kako stoji u F12 §2.

2. apps/web/src/lib/admin.ts: jeAdmin(), requireAdminPage() → notFound(), requireAdminRoute()
   → 404 sa praznim telom. ADMIN_BOOTSTRAP_IDS u ODVOJENOJ Zod šemi u lib/env.ts, po obrascu
   webhookSecret() — prazna vrednost nije greška i aplikacija se podiže bez nje.

3. Grupa (admin) sa svojim layout-om i bočnom trakom: isti dizajn sistem, jedan ADMIN bedž uz
   logo. Layout NIJE zaštita — requireAdminPage() je prva linija svake strane.

4. /admin/korisnici: lista sa 25 po strani, filteri (mejl ILIKE, plan, aktivni 7d, admini, bez
   aktivnosti), sortiranje. Brojevi po korisniku iz JEDNOG agregatnog upita, nikad N+1. Ime,
   avatar, lastSignInAt i status blokade iz Clerka JEDNIM pozivom za celu stranicu.

5. /admin/korisnici/[id]: četiri bloka iz F12 §3.2, samo čitanje. Radnje dolaze u S4.

6. profiles.last_seen_at: upis iz (app)/layout.tsx kroz after(), najviše jednom na sat po
   korisniku. Kad ta kolona postoji, prebaci citajUslove() u apps/web/src/lib/utisci.ts
   sa `searches` na nju — danas dužinu pauze izvodi iz poslednje pretrage, jer kolone
   nije bilo (v. „S2 — šta se razišlo", tačka 3). To je jedina izmena i jedan upit manje.

7. /admin/revizija: čitanje admin_audit, filter po radnji i korisniku.

Nepregovarljivo: provera u svakoj ruti i strani, 404 a ne 403, nijedan hex u JSX-u, obe teme.

Kad završiš: typecheck, check:sql, lista iz docs/SESIJE.md, ažuriraj taj fajl i napiši
prompt za sledeću sesiju. U .env.example dopiši ADMIN_BOOTSTRAP_IDS sa objašnjenjem.
```

---

## S4 — F12.2: admin radnje ☑ isporučeno

### ‼️ Ručni korak pre puštanja

**Događaj `user.deleted` mora da se uključi na Clerk webhook endpointu.** Clerk šalje
samo one tipove koji su štiklirani u konzoli (Configure → Webhooks → endpoint →
Subscribe to events). Do sada su tamo bili `user.created` i `user.updated`; bez
trećeg, brisanje naloga prođe u Clerku a profil ostane zauvek — dakle tačno stanje
koje ova isporuka zatvara. Ista provera važi i za dev i za produkcijski endpoint.

Lokalno webhook ne stiže bez tunela, pa posle brisanja profil ostaje do prve isporuke
u kojoj Clerk može da dosegne aplikaciju. To nije kvar nego posledica puta
Clerk → webhook → kaskada (pravilo 15).

### Šta je isporučeno

- `apps/web/src/lib/admin.ts` — dopunjen: `RADNJE` (imenski prostor `action`
  vrednosti), `upisiAudit()` sa čišćenjem `payload`-a, `ipZahteva()`,
  `proveriTempo()` (120/h po adminu)
- `apps/web/src/lib/admin-radnje-schema.ts` — Zod tela za svih pet mutacija,
  `noviRefId()` (`adm:<uuid>`), tip `RadnjaOdgovor`
- `apps/web/src/lib/admin-radnje.ts` — `pripremiRadnju()` (admin → profil aktera →
  tempo), `procitajTelo()`, `saAuditom()` i same izmene: `korigujKredite()`,
  `promeniPlan()`, `resetujLimit()`, `brojAdmina()`, `promeniUlogu()`,
  `postaviBlokadu()`, `obrisiNalog()`
- rute pod `/api/admin/korisnici/[id]`: `POST /krediti`, `PATCH /plan`,
  `PATCH /uloga`, `POST /limit`, `POST /blokada`, `DELETE` — sve dinamičke, sve sa
  `Cache-Control: private, no-store`
- `apps/web/src/lib/profile.ts` — `obrisiProfil()`, idempotentan, jedini pozivalac je
  webhook
- `apps/web/src/app/api/webhooks/clerk/route.ts` — grana `user.deleted`
- `apps/web/src/components/admin-radnje.tsx` — desna kolona detalja korisnika: četiri
  obične radnje, pa linija, pa opasna zona sa tipkanim mejlom
- `/admin/korisnici/[id]` — raspored u dve kolone, `refId` se generiše pri renderu,
  uklonjena traka „ovaj ekran samo čita"
- `scripts/validate-migrations.ts` — blok „F12.2 — kaskada brisanja naloga"

### Šta se razišlo sa PRD-om

1. **„Poslednji admin ostaje" nije u jednoj transakciji, nego je brojanje pre izmene
   plus ponovno brojanje posle nje.** §1 traži „provera brojanjem u istoj
   transakciji"; PostgREST nema transakciju preko dva zahteva, a nova migracija u
   ovoj isporuci nije u opsegu. Sa samo prvom proverom bi dva admina koja se u istoj
   sekundi degradiraju međusobno oba prošla. Zato `promeniUlogu()` posle upisa broji
   ponovo i, ako je konzola ostala bez ijednog admina, vraća ulogu i vraća `409`.
   Trka se time rešava u bezbednom smeru: najgori ishod je da obojica ostanu admini.
   Kad F12.3 ionako donese migraciju, ovo je prvi kandidat da postane RPC.
2. **Brojač tempa je sam `admin_audit`, bez nove tabele.** Svaka mutacija po
   definiciji ostavlja red u njemu, pa je broj redova aktera u poslednjih sat vremena
   tačno broj njegovih mutacija. Zasebna tabela bi bila drugi izvor istine za isti
   podatak. **Pali pokušaji se broje** — to je i poenta, jer skript koji lupa
   neispravnim telom mora da udari u isti zid.
3. **Pad čitanja dnevnika zaustavlja mutaciju (`503`), ne propušta je.** Ako se
   `admin_audit` ne može pročitati, ne može ni da se upiše — a izmena bez traga je
   tačno ono što pravilo 14 zabranjuje. Sumnja ovde ide protiv radnje, isto kao u
   `jeAdmin()`.
4. **`pripremiRadnju()` traži da akter ima red u `profiles`.** `admin_audit.actor_id`
   je strani ključ; admin iz `ADMIN_BOOTSTRAP_IDS` prolazi `jeAdmin()` bez ijednog
   upita, pa bi onaj koji je sebe obrisao iz Clerk konzole (§6) ušao u konzolu, a
   njegov red u dnevniku pao na stranom ključu — mutacija bez traga. Sada dobija
   `409` sa porukom iz §6 („nalog ne postoji, prijavi se ponovo").
5. **`searches` NE nestaje u kaskadi.** §4 ga nabraja među obrisanim tabelama, ali
   kolona je `on delete set null` još od 0001 i to ostaje: udeo keša u pretragama je
   brojka o sistemu, ne o čoveku, pa depersonalizovan red i dalje ima smisla.
   Pokriveno proverom u `check:sql`.
6. **Brisanje naloga kog u Clerku više nema.** §6 opisuje stanje „brisanje prošlo u
   Clerku, webhook nije stigao", ali ne daje izlaz — profil tada ostaje zauvek. Kad
   `users.getUser` vrati `404`, potvrda se poredi sa `profiles.email` i profil se
   briše direktno. To je jedini slučaj u kom se od pravila 15 odstupa, jer Clerk
   strane tog pravila više nema.
7. **Blokada je u dnevniku dve radnje, `user.ban` i `user.unban`.** Filter na
   `/admin/revizija` je po `action`, pa bi jedna radnja sa `blokiran` u `payload`-u
   značila da se „ko je blokiran ovog meseca" čita red po red.
8. **Reset limita nulira samo `cache_miss_count`, ne i `cache_miss_day`.** Dan je
   oznaka perioda i menja ga isključivo `claim_cache_miss` (0003); ishod je isti, a
   kolona koju ovaj sloj nema razloga da dira ostaje netaknuta.
9. **Promena uloge nad sobom je zabranjena cela, ne samo degradacija.** Dodela sebi
   je ionako besmislena, a jedno pravilo se pamti — dva se mešaju.
10. **Neispravno telo takođe upisuje red u dnevnik.** „Ko je pokušao" je pitanje koje
    se postavlja tačno onda kad pokušaj nije uspeo. Zato se telo čita UNUTAR
    `saAuditom()`, pa ruta nema nijednu granu koja preskače trag.
11. **Webhook `user.deleted` upisuje red `user.delete.cascade` sa `actor_id = null`.**
    Nema ga u PRD-u. Bez njega je brisanje iz Clerk konzole jedina izmena nad bazom
    bez ijednog zapisa; `actor_id` je nullable od 0012, pa je `null` ovde ispravno
    čitanje „obrisano izvan konzole".
12. **„Pošalji poruku" iz tabele u §3.2 nije u ovoj isporuci.** Traži Resend i rate
    limit 20/dan, i stoji uz ostale odlazne mejlove u S5 — tamo je i bila planirana.
13. **Padajući spisak planova ima danas tačno jednu vrednost.** Enum se gradi iz
    `PLANS`, pa se spisak ne može razići sa kodom, ali dugme „Sačuvaj" je do drugog
    plana praktično neaktivno. To je tačan prikaz stanja proizvoda, ne propust.
14. **`check:sql` je dobio blok iako migracija nije menjana.** Webhook sada briše
    JEDAN red i računa na to da baza odnese ostalo. Nijedna od tih veza nije iz 0012 —
    sve su starije, i baš zato niko ne bi primetio da se raziđu. Prvi
    `references profiles` bez `on delete cascade` u nekoj budućoj migraciji pretvara
    brisanje naloga u grešku stranog ključa, u produkciji.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm check:secrets`, `pnpm test` i `pnpm build`
prolaze. Nijedan hex ni oklch u JSX-u; nijedna nova biblioteka; nijedan nov Places
poziv. Svih šest ruta je dinamično. **Vizuelna provera obe teme i telefona (≤ 390 px)
ostaje na meni** — nije je moguće obaviti iz sesije bez pregledača. Uz nju idu i tri
funkcionalne, jer nijedna ne može bez pravog Clerka:

1. dodaj kredite, pa dva puta brzo klikni „Dodaj" — drugi klik mora da vrati „već
   primenjeno", a balans da poraste jednom;
2. blokiraj probni nalog i pokušaj prijavu iz drugog pregledača;
3. obriši probni nalog i proveri da je profil nestao — ako nije, `user.deleted` nije
   uključen na webhook endpointu (v. ručni korak gore).

### Prompt (za ponavljanje isporuke iz nule)

```
Radimo F12.2 iz docs/F12-admin.md. Pročitaj CLAUDE.md, ceo docs/F12-admin.md i odeljak
„S3 — F12.1" u docs/SESIJE.md (šta je isporučeno i šta se razišlo sa PRD-om). Ništa iz F12.3.

Zatečeno stanje iz S3, ne prepisuje se nego se dopunjuje:
- migracija 0012 (profiles.role + last_seen_at, admin_audit, admin_adjust_credits,
  admin_users_page) — nova migracija u ovoj sesiji NIJE potrebna
- apps/web/src/lib/admin.ts — jeAdmin(), requireAdminPage(), requireAdminRoute(),
  NeAdmin, odgovorNeAdmin(); prve rute pod /api/admin praviš ti, sve su mutacije
- apps/web/src/lib/admin-korisnici.ts — čitanje liste, detalja i revizije
- grupa (admin) sa layout-om, bočnom trakom i tri ekrana; /admin/korisnici/[id] je
  danas SAMO ČITANJE i u njemu nema desne kolone sa radnjama — nju praviš ti

Napravi radnje iz F12 §3.2 i rute iz §4:

1. Krediti: POST /api/admin/korisnici/[id]/krediti → admin_adjust_credits. refId se generiše
   pri OTVARANJU forme, ne pri slanju — dupli klik ne sme da dodeli dvaput. Balans ne može
   ispod nule. PAŽNJA: taj RPC SAM upisuje admin_audit (v. S3, tačka 6), pa ruta ne sme da
   upiše drugi red za uspelu korekciju — samo za pad, koji RPC ne vidi.
2. Plan (vrednost iz PLANS), uloga (ne sebi; poslednji admin u bazi ne može da bude
   degradiran — provera brojanjem u transakciji), reset dnevnog cache-miss brojača.
3. Blokada i odblokada kroz Clerk users.banUser / unbanUser. Ne sebi.
4. Brisanje naloga: DELETE ruta traži tipkani mejl u telu, server ga poredi sa stvarnim
   mejlom iz Clerka. Clerk users.deleteUser → webhook → kaskada. Ne sebi.
5. Webhook user.deleted u postojećoj ruti /api/webhooks/clerk — danas ga nema, pa brisanje iz
   Clerk konzole ostavlja profil zauvek. Idempotentno: brisanje nepostojećeg reda je uspeh.
   businesses i website_audits OSTAJU.
6. Svaka mutacija upisuje admin_audit — i na uspeh i na pad (ok=false, error). payload nikad
   ne sadrži lozinku ni ključ. Izuzetak je korekcija kredita iz tačke 1, gde uspeh upisuje
   sam RPC. Napravi jedan pomoćni upis (npr. upisiAudit() u lib/admin.ts) da se `action`
   imenski prostor ne raziđe po rutama.
7. Rate limit 120/h po adminu na mutacije.

Kad dodaš prvu rutu pod /api/admin, dopiši i proveru u scripts/validate-migrations.ts ako
migracija dobije bilo šta novo — u ovoj sesiji ne bi trebalo, jer 0012 već ima sve.

Opasne radnje su vizuelno odvojene linijom i imaju tipkanu potvrdu. Destruktivno dugme je
ghost sa color: var(--danger), nikad crveni fill (dizajn sistem §7.1).

Kad završiš: typecheck, check:sql, lista iz docs/SESIJE.md, ažuriraj taj fajl i napiši
prompt za sledeću sesiju.
```

---

## S5 — F12.3: pozivnice i pregled sistema ☑ isporučeno

### ‼️ Ručni koraci pre puštanja

1. **Migracije `0013` i `0014` moraju da se puste pre nego što se otvori `/admin`.** Bez
   0013 pregled pada na `admin_overview does not exist`, a promena uloge na
   `admin_set_role`; bez 0014 lista korisnika pada, jer `admin_users_page` više ne prima
   isti spisak parametara.
2. **Resend mora da bude podešen da bi pozivnica stigla.** Bez `RESEND_API_KEY` i
   `FEEDBACK_EMAIL_FROM` pozivnica se i dalje NAPRAVI u Clerku i link se prikaže u
   konzoli (pa se može poslati ručno), ali mejl ne ode sam — a „Pošalji poruku" tada uvek
   pada. Objašnjenje stoji u `.env.example`.
3. **Clerkov šablon za pozivnicu se ne koristi** — mejl šaljem sam (v. tačku 3 niže). Ako
   se ikad vratim na `notify: true`, taj šablon je na engleskom i treba ga prevesti.

### Šta je isporučeno

- `supabase/migrations/0013_f12_pozivnice_pregled.sql` — `admin_set_role` (promena uloge
  sa brojanjem admina u istoj transakciji, iza `pg_advisory_xact_lock`) i `admin_overview`
  (šest kartica iz jednog poziva, kapovi ulaze kao parametri)
- `apps/web/src/lib/mail.ts` — **jedini izlaz ka Resend-u**: tajmaut, čišćenje ključa iz
  poruke o grešci, provera adrese na header injection, `escapeHtml`. `feedback-mail.ts`
  je prebačen na njega i zadržao samo sastavljanje tela
- `apps/web/src/lib/admin-mail.ts` — tri mejla koja idu drugim ljudima: pozivnica,
  pristup za otvoren nalog, pojedinačna poruka. Svi sa `Reply-To` na mene
- `apps/web/src/lib/admin-pozivnice.ts` — `citajPozivnice()`, `posaljiPozivnicu()`,
  `opoziviPozivnicu()`, `otvoriNalog()` (generisana lozinka, `crypto.getRandomValues`),
  prevod Clerkovih kodova grešaka u srpske rečenice
- `apps/web/src/lib/admin-izvoz.ts` — CSV korisnika kroz `toCsv()` iz `packages/shared`,
  u stranicama od 100, plafon 5000 sa eksplicitnim „odsečeno"
- `apps/web/src/lib/admin-pregled.ts` — `citajPregled()`, pragovi crvenog stanja
  (`PRAG_BUDZETA` 80 %, `PRAG_CEKANJA_SEC` 30 min), `trajanje()`
- `apps/web/src/lib/admin.ts` — pet novih vrednosti u `RADNJE`, `proveriDnevniTempo()`
  i `PORUKA_NA_DAN` (20/24 h); `proveriTempo()` je sada omotač nad istim brojačem
- `apps/web/src/lib/admin-radnje.ts` — `Ishod.podaci` (kanal ka klijentu koji NIKAD ne
  dodiruje dnevnik), `Kontekst.target` sme da bude `null`, `posaljiPoruku()`,
  `promeniUlogu()` prepisan na RPC
- rute: `POST`/`DELETE /api/admin/pozivnice`, `POST /api/admin/korisnici/[id]/poruka`,
  `GET /api/admin/izvoz?sta=korisnici`
- ekrani: `/admin` (šest kartica), `/admin/pozivnice` (obrazac + spisak sa opozivom);
  `+ Pozovi` i `Izvezi CSV` u zaglavlju liste korisnika; blok „Poruka" u desnoj koloni
  detalja
- `admin-navigacija.ts` — četiri stavke i `jeAktivna()` sa zastavicom `tacno`
- `scripts/validate-migrations.ts` — blok „F12.3" (osam provera nad `admin_set_role`,
  deset nad `admin_overview`)

### Šta se razišlo sa PRD-om

1. **Migracija 0013 postoji, iako F12.3 nije tražio nijednu.** Ušla su dva RPC-a. Prvi je
   `admin_set_role`, predložen u samom promptu. Drugi je `admin_overview`, i on je ušao
   zato što bi §3.4 kroz PostgREST bio petnaestak `head: true` zahteva — za brojke koje se
   po definiciji gledaju zajedno, u jednom pogledu na ekran.
2. **`admin_set_role` NE upisuje `admin_audit` sam**, za razliku od `admin_adjust_credits`.
   Taj izuzetak je u 0012 dobro obrazložen (upis balansa i njegov trag moraju da budu ista
   transakcija), ali je izuzetak — i ne umnožava se. Red za promenu uloge piše ruta, kroz
   `saAuditom()`, kao i za svih ostalih šest radnji. Time zamka iz „S3, tačka 6" ostaje
   jedna, a ne dve.
3. **Pozivnicu šaljem svojim mejlom (`notify: false`), a ne Clerkovim.** §3.3 kaže „Clerk
   šalje mejl", i Clerk to ume — ali njegov šablon je na engleskom i u njega ne ulazi lična
   poruka iz obrasca, a to polje je pola razloga zbog kog forma postoji. Cena odstupanja je
   stvarna: kad Resend padne, pozivnica u Clerku postoji a mejl nije otišao. Zato taj slučaj
   NIJE pad radnje nego uspeh sa drugom rečenicom, i link se vraća adminu da ga pošalje
   ručno (ponovno slanje bi dalo „već postoji").
4. **Pozivnice su ekran, ne modal.** §3.3 ih crta kao modal iznad liste korisnika. Dva
   razloga: spisak poslatih sa opozivom bi u modalu tražio svoje učitavanje, dakle i `GET`
   rutu pod `/api/admin` koje inače nema; i lozinka i link se prikazuju **tačno jednom**, a
   modal koji se zatvara klikom pored je najgore mesto za podatak koji se više ne može
   dobiti. Dugme `+ Pozovi` sa liste vodi na taj ekran, pa je put isti kao u PRD-u.
5. **Nema `GET /api/admin/pozivnice`.** Spisak čita serverska komponenta ekrana, direktno
   iz Clerka — isto obrazloženje kao u „S3, tačka 3".
6. **`Ishod.podaci` je nov kanal ka klijentu, odvojen od `payload`-a.** Lozinka i link
   putuju njime i u dnevnik ne stižu zato što taj put ne postoji, a ne zato što ih mreža u
   `upisiAudit()` izbaci. Mreža je i dalje tu, ali kao poslednja odbrana.
7. **`lib/mail.ts` je izdvojen iz `feedback-mail.ts`.** Do sada je Resend `fetch` živeo uz
   sastavljanje mejla sa utiskom; sa tri nova mejla bi to bila dva mesta na kojima se pamti
   da ključ ne sme da procuri u poruku o grešci. F10 mejl ide kroz novi modul i ponaša se
   isto — `posaljiUtisak()` je i dalje jedini pozivalac za utiske.
8. **Brojač poruka je opet `admin_audit`, bez nove tabele** — isto obrazloženje kao za
   tempo („S4, tačka 2"). 20 u prozoru od 24 h po adminu, i pali pokušaji se broje.
   Odbijanje po tempu ne piše red, jer mutacije nije ni bilo.
9. **Izvoz je `GET` koji piše u dnevnik**, i time troši i tempo od 120/h. To nije previd:
   §5 traži red u auditu sa brojem redova, a radnja koja iznosi tuđe mejlove sme da bude
   ograničena kao i svaka druga.
10. **Izvoz ide kroz `admin_users_page`, u stranicama od 100, sa plafonom od 5000.** Kroz
    istu funkciju kroz koju ide i ekran, da bi brojevi u fajlu bili isti oni sa ekrana. Kad
    se plafon dosegne, to stoji u `X-Sajtoskop-Truncated` — tiho odsečen CSV je fajl na
    osnovu koga se donese pogrešan zaključak.
11. **`target_user` je prazan za pozivnicu, otvaranje naloga i izvoz.** Adresa ide u
    `payload`. Razlog je konkretan: `/admin/revizija` iz te kolone pravi link na detalj
    korisnika, a link na nalog koji još ne postoji je `404`.
12. **Dva puta unutra su dve radnje u dnevniku** (`invite.create` i `user.create`), iz istog
    razloga iz kog su ban i unban razdvojeni u S4 — filter revizije je po `action`.
13. **`/admin` u meniju ima zastavicu `tacno`.** Bez nje bi pregled bio osvetljen na svakom
    ekranu konzole, jer je `/admin` prefiks svake druge adrese. `jeAktivna()` je sada jedno
    pravilo za bočnu traku, gornju traku i naslov.
14. **Medijana cene se ne računa u SQL-u.** `admin_overview` vraća sirove odgovore, a
    `medijanaCene()` iz `feedback-katalog.ts` ostaje jedini izvor istine — sredine opsega
    stoje tamo gde i sami opsezi. Uz medijanu iz manje od 12 odgovora ekran piše „signal,
    ne dokaz".
15. **„Najstariji na čekanju" gleda `run_after`, ne `created_at`.** Posao koji je namerno
    odložen (`defer_job`) nije zaglavljen posao i ne sme da pali crveno stanje; odloženi se
    broje zasebno, da razlika ne bi izgledala kao greška u brojanju.

### Popravke posle prve upotrebe (migracija `0014`)

Četiri stvari koje su se videle tek kad je konzola otvorena nad pravim podacima:

1. **Filter „Admini" je vraćao praznu listu.** Uzrok nije bio filter nego podatak: prvi
   admin postoji ISKLJUČIVO u `ADMIN_BOOTSTRAP_IDS`, a `profiles.role` mu je `'user'` — jer
   ga niko nije postavio i ne može sam sebi (§1). `admin_users_page` je zato dobio osmi
   parametar, `p_bootstrap text[]`; env se i dalje NE upisuje u bazu, jer bi to značilo da
   uklanjanje ID-ja iz env-a više ne skida prava. Lista i detalj nose `ADMIN` bedž i za
   takvog admina, uz rečenicu zašto mu se uloga odavde ne može skinuti. Funkcija je
   `drop`-ovana pa napravljena ponovo — `create or replace` sa novim parametrom bi napravio
   drugu, preopterećenu verziju između kojih PostgREST bira nasumično.
2. **Isti mejl se pojavljivao dvaput.** To su profili koji su nadživeli svoje Clerk
   korisnike — brisanje iz Clerk konzole pre nego što je `user.deleted` webhook postojao
   (dodat u F12.2). §6 taj slučaj opisuje i traži da se prepozna „upoređivanjem sa listom",
   ali to nije bilo implementirano. Sada `citajIzClerka()` razlikuje **„Clerk ćuti"** od
   **„tog naloga tamo nema"** (`uClerku: null` vs `false`), red nosi bedž `NEMA U CLERKU`, a
   detalj objašnjenje i put napolje — brisanje iz opasne zone, koje u tom slučaju poredi
   potvrdu sa `profiles.email` i briše red direktno.
3. **Kolona „Utisci" je bila go broj među tri druga.** Sada je `Javio se`: bedž sa ikonicom
   kad je bilo utisaka, crtica kad nije. „Otklj." i „Pretrage" takođe prikazuju nulu kao
   crticu — tabela puna nula se ne čita. Sva tri zaglavlja imaju objašnjenje u `title`.
4. **U konzolu se ulazilo samo ručnim kucanjem adrese.** Bočna traka aplikacije sada nosi
   „Admin konzola", vidljivo samo adminu. To NIJE zaštita nego navigacija — link koji se ne
   prikaže ne štiti ništa, a `/admin` svakog neadmina i dalje dočekuje `404` iz same strane.
   Računa se iz profila koji `(app)/layout.tsx` ionako čita (`jeAdminIzProfila()`), pa je
   cena nula upita.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm check:secrets`, `pnpm test` i `pnpm build`
prolaze. Nijedan hex ni oklch u JSX-u; jedine zakucane boje su u telu mejlova
(`admin-mail.ts`), gde tokena nema jer mejl klijent ne vidi `globals.css` — isto kao i u
`feedback-mail.ts` od F10. Nijedna nova biblioteka; nijedan nov Places poziv; sve četiri
nove rute su dinamične. **Vizuelna provera obe teme i telefona (≤ 390 px) ostaje na meni.**
Uz nju idu i četiri funkcionalne, jer nijedna ne može bez pravog Clerka i Resend-a:

1. pošalji pozivnicu na svoju drugu adresu i registruj se kroz link — profil mora da
   nastane sa 30 kredita;
2. pošalji pozivnicu drugi put na istu adresu — mora da izađe kao stanje („već postoji"),
   ne kao pad;
3. otvori nalog odmah i prijavi se generisanom lozinkom, pa proveri da lozinke nema ni u
   `/admin/revizija` ni u Vercel logovima;
4. izvezi CSV i proveri da je u reviziji red `export.users` sa brojem redova.

### Prompt (za ponavljanje isporuke iz nule)

```
Radimo F12.3 iz docs/F12-admin.md. Pročitaj CLAUDE.md, ceo docs/F12-admin.md i odeljke
„S3 — F12.1" i „S4 — F12.2" u docs/SESIJE.md (šta je isporučeno i šta se razišlo sa
PRD-om). Ovo je poslednja isporuka F12; ništa iz F11.3 i F11.4.

Zatečeno stanje iz S3 i S4, ne prepisuje se nego se dopunjuje:
- lib/admin.ts — jeAdmin(), requireAdminPage(), requireAdminRoute(), odgovorNeAdmin(),
  RADNJE (imenski prostor za `action`), upisiAudit(), proveriTempo() 120/h, ipZahteva()
- lib/admin-radnje.ts — pripremiRadnju() (admin → profil aktera → tempo), procitajTelo(),
  saAuditom(); NOVA RUTA POD /api/admin IDE KROZ TA TRI, ne piše svoju proveru ni svoj
  upis u dnevnik
- lib/admin-korisnici.ts — čitanje liste, detalja i revizije
- grupa (admin): bočna traka nosi Korisnike i Reviziju; /admin pregled praviš ti i tek
  tada stavka ide u meni (admin-navigacija.ts)
- migracija 0012 ima sve iz F12 §2

Napravi:

1. Pozivanje (F12 §3.3): clerkClient.invitations.createInvitation sa opcionom porukom, lista
   poslatih pozivnica sa statusom i opozivom. Podrazumevana opcija. Nov `action` ide u
   RADNJE, ne kao string u ruti.
2. Otvaranje naloga: clerkClient.users.createUser sa generisanom lozinkom koja se prikazuje
   JEDNOM u odgovoru i nigde ne upisuje — ni u bazu, ni u audit, ni u log. upisiAudit() već
   izbacuje ključeve koji liče na lozinku, ali se na tu mrežu ne oslanjaj: lozinka prosto
   ne ulazi u payload.
3. Pojedinačna poruka korisniku kroz Resend, Reply-To na mene, rate limit 20/dan. Postojeći
   tempo od 120/h je po adminu i nad svim mutacijama — ovo je drugi, uži brojač.
4. Izvoz korisnika u CSV kroz postojeći packages/shared/src/csv.ts. Upisuje red u audit sa
   brojem redova (PII izlazi iz sistema).
5. /admin pregled sistema (F12 §3.4): šest kartica iz baze, bez ijednog spoljnog poziva.
   Crveno stanje SAMO za budžet preko 80% i posao koji čeka duže od 30 minuta.

Ako ova isporuka ionako donosi migraciju 0013, razmisli da u nju uđe i RPC za promenu
uloge — danas je „poslednji admin ostaje" rešeno brojanjem pre i posle upisa, jer
transakcije preko PostgREST-a nema (v. „S4 — šta se razišlo", tačka 1).

Kad završiš: typecheck, check:sql, check:secrets, lista iz docs/SESIJE.md, ažuriraj taj
fajl i napiši prompt za sledeću sesiju.
```

---

## S6 — F11.3: utisci u konzoli ☑ isporučeno

### ‼️ Ručni koraci pre puštanja

1. **Migracija `0015` mora da se pusti pre nego što se otvori `/admin` ili
   `/admin/utisci`.** Ona dopunjuje `admin_overview` sa `utisci.po_pitanju` i
   `utisci.obrada`; bez nje oba ključa nedostaju u `jsonb`-u i red brojki puca na
   `undefined`. Sama migracija ne dira nijedan podatak — menja jednu funkciju i dodaje
   jedan indeks.
2. **`CRON_SECRET` mora da se popuni**, i lokalno i u Vercel env-u. Dok je prazan, sve tri
   `/api/cron/*` rute vraćaju `404` i **nijedan zakazan posao ne radi** — nema digesta, nema
   nedeljnog izveštaja, sirotani u bucketu se gomilaju. Vrednost je `openssl rand -base64 32`;
   objašnjenje stoji u `.env.example`. Na Vercelu se promenljiva zove baš tako, jer je
   platforma sama šalje kao `Authorization: Bearer …`.
3. **Zakazana su samo DVA crona, jer projekat nije na Pro planu.** Hobby dozvoljava dva cron
   posla i oba najviše jednom dnevno. `apps/web/vercel.json` zato nosi digest (`0 19 * * *`)
   i nedeljni izveštaj (`0 7 * * 1`). **`/api/cron/utisci-slike` nije zakazan** i pokreće se
   rukom, jednom u nekoliko nedelja:

   ```bash
   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
        https://sajtoskop.com/api/cron/utisci-slike
   ```

   Odgovor je `{"ok":true,"obrisano":N,"pregledano":M,"odseceno":false,"razlog":null}`. Posao
   je idempotentan: drugi poziv za redom nema šta da obriše. Kad pređem na Pro, dodaje se red
   u `vercel.json` i ništa u kodu se ne menja. Isti oblik komande radi i za ostala dva, kad
   hoću da ih okinem van termina.

   Bez ovog čišćenja se u bucketu gomilaju samo slike koje je neko otpremio a utisak nikad
   poslao — nekoliko stotina kilobajta mesečno u privatnom bucketu. Zato je baš ovaj cron
   ispao napolje, a ne digest ili izveštaj.
4. **Raspored je u UTC-u** — Vercel cron ne poznaje vremenske zone. `0 19 * * *` je 21:00 po
   Beogradu leti, a 20:00 zimi. Isto važi za ponedeljak u 09:00 (`0 7 * * 1`). Na Hobby planu
   Vercel garantuje samo sat, ne i minut — digest ume da stigne bilo kad u tom satu.

### Šta je isporučeno

- `supabase/migrations/0015_f11_admin_utisci.sql` — `admin_overview` dopunjen sa
  `utisci.po_pitanju` (funnel po ključu pitanja) i `utisci.obrada` (prosek od prijave do
  ishoda, broj nerešenih, najstarija nerešena); indeks `feedback_created_idx`
- `packages/shared/src/db.ts` — `AdminOverview.utisci` prati oblik iz 0015
- `apps/web/src/lib/admin-utisci.ts` — `citajUtiske()` (filteri status/sloj/ocena/korisnik,
  paginacija, mejlovi za celu stranicu jednim upitom), `citajUtisak()`, `citajOznake()`
- `apps/web/src/lib/admin-utisci-schema.ts` — Zod tela za `PATCH` i za vezu sa dnevnikom,
  `STATUS_UTISKA` i `SLOJ_UTISKA` (labele koje dele server, klijent i digest), `NAGRADA_ZA_BUG`
- `apps/web/src/lib/admin-utisci-radnje.ts` — `izmeniUtisak()` (status, oznake, beleška, i
  `resolved_at` koji se IZVODI iz statusa), `nagradiBug()` (kroz `grant_feedback_credits`),
  `veziSaDnevnikom()`, `vlasnikUtiska()`
- `apps/web/src/lib/cron.ts` — `jeCron()` (poređenje heševa kroz `timingSafeEqual`),
  `odgovorNeCron()` → `404` sa praznim telom, `saCronAuditom()` — `saAuditom()` za rute bez sesije
- `apps/web/src/lib/utisci-izvestaj.ts` — `posaljiDigest()` i `posaljiNedeljniIzvestaj()`, oba
  kroz `lib/mail.ts`; medijana isključivo iz `medijanaCene()`
- `apps/web/src/lib/slika.ts` — `potpisanUrlSlike()` (TTL 10 min) i `obrisiSirotanskeSlike()`
- `apps/web/src/lib/feedback.ts` — `ideOdmah()`: instant mejl samo za `kind='bug'`,
  `rating=1` i incident; sve ostalo čeka digest
- rute: `PATCH /api/admin/utisci/[id]`, `POST …/nagrada`, `POST …/dnevnik`,
  `GET|POST /api/cron/utisci-digest`, `…/utisci-izvestaj`, `…/utisci-slike`
- ekrani: `/admin/utisci` (red brojki, funnel po pitanju, filteri, lista, panel desno),
  `/admin/utisci/[id]` (stalna adresa iz mejla)
- `admin-utisak-panel.tsx` — detalj i sve četiri radnje
- `admin-navigacija.ts` — stavka „Utisci"; `RADNJE` dobio šest novih vrednosti
- `.env.example` + `apps/web/vercel.json` — `CRON_SECRET` i **dva** rasporeda (treći se
  pokreće rukom, v. ručni korak 3)
- `scripts/validate-migrations.ts` — blok „F11.3" (osam provera nad dopunjenim `admin_overview`)

### Šta se razišlo sa PRD-om

1. **„Prosek do odgovora" je brojka o MENI, ne o korisniku.** §6.6 je ne definiše. Čita se kao
   vreme od prijave (`created_at`) do ishoda (`resolved_at`), jer ekran za obradu prijava stoji
   pored „otvorenih bugova" i mora da kaže koliko obrada zaista traje. Koliko korisniku treba da
   odgovori na pitanje meri `po_pitanju`, koji je tu odmah pored. Uz prosek stoji i najstarija
   nerešena — prosek sam ume da laže, jer pet prijava rešenih za sat i jedna koja stoji tri
   nedelje daju odličan broj.
2. **`resolved_at` se ne prima iz tela nego izvodi iz statusa.** Prelazak u `reseno`,
   `odbijeno` ili `duplikat` ga upisuje, povratak u otvoreno stanje ga briše. Prvi upis
   pobeđuje: prijava koja iz `reseno` pređe u `duplikat` zadržava originalni trenutak, jer je
   obrada tada već bila gotova.
3. **Nagrada i veza sa dnevnikom su zasebne rute, a ne polja u istom `PATCH`-u.** §5 crta
   `nagrada?` unutar `PATCH /api/admin/utisci/[id]`. Razlog za razdvajanje je isti kao za
   `user.ban` / `user.unban` („S4", tačka 7): filter na `/admin/revizija` je po `action`, pa bi
   „kome sam dodelio 10 kredita" moralo da se čita kroz `payload` svake izmene statusa. Tri
   radnje, tri vrednosti u `RADNJE`.
4. **Kapija za nagradu je šira od `status = 'priznato'`.** §6.7 traži baš taj status; ovde
   prolaze i `u_radu` i `reseno`. Bug se prizna u ponedeljak a plati kad se popravi u sredu —
   sa doslovnom kapijom bih morao da vratim status unazad da bih dodelio kredit, i time
   pokvario `resolved_at`. Odbijeno i duplikat se ne nagrađuju, `novo` takođe ne.
5. **Cron rute primaju i `GET` i `POST`.** §5 ih crta kao `POST`; **Vercel Cron poziva `GET`** i
   ne ume drugačije. `GET` je ono što okida raspored, `POST` ostaje za ručno pokretanje iz
   terminala. Obe metode idu kroz isti posao.
6. **`/admin/utisci/[id]` nije drugi ekran nego redirekcija na `?utisak=<id>`.** Detalj živi u
   panelu, a mejl mora da vodi tačno tamo gde se prijava i obrađuje — sa listom i filterima pri
   ruci. Zasebna adresa svejedno postoji, jer link u pošti mora da preživi promenu oblika query
   stringa. `requireAdminPage()` je i tamo prva linija, pre redirekcije: preusmerenje pre
   provere prava je potvrda da ekran postoji.
7. **Digest gleda 48 h unazad, ne 24.** Cron ume da promaši termin (deploy, pad regiona), a
   utisak koji je promašio svoj digest ne sme da promaši i sve sledeće.
8. **Digest je „poslato" = `emailed_at`, bez nove kolone.** Isto polje koje puni i instant mejl,
   pa je „šta još nije otišlo" jedan uslov a ne dva stanja koja se raziđu. Posledica: zapis
   kome je instant mejl PAO ulazi u sledeći digest — što je ujedno i jedini mehanizam ponovnog
   pokušaja, i tačno ono što §9 traži za pad Resend-a.
9. **U digest ulaze i zapisi preko dnevnog limita za mejl** (F10 odluka 6). Limit čuva inboks
   od poplave pojedinačnih mejlova; jedan red u dnevnom pregledu ga ne davi, a izgubljen utisak
   je izgubljen podatak.
10. **Instant mejl od sada nosi link na `/admin/utisci/<id>`.** Time se zatvara dug iz „S1 —
    šta se razišlo", tačka 3 (link nije postojao jer nije postojala ni konzola). Potpisan URL
    slike i dalje NE ide u mejl — mejl nosi samo putanju i link na ekran, gde se potpis pravi u
    trenutku otvaranja.
11. **„Poveži sa stavkom dnevnika" radi, ali je do F11.4 prazno.** CRUD nad `changelog`-om je
    `/admin/dnevnik`, dakle sledeća isporuka. Panel zato eksplicitno piše da stavke još ne
    postoje — prazan padajući meni bez objašnjenja izgleda kao kvar. Jedna prijava ide uz
    najviše jednu stavku: pre upisa se skida sa svake druge, jer je izbor u panelu jedan.
12. **Filter po korisniku su dva upita, ne ugnježđen `profiles!inner(email)`.** PostgREST to
    ume, ali filter nad ugnježđenim resursom menja i značenje `count`-a — a paginacija ne sme
    da bude „skoro tačna". Vrednost koja počinje sa `user_` ide direktno kao Clerk ID.
13. **Cron rute upisuju `admin_audit` sa `actor_id = null`**, isto kao kaskada iz webhooka.
    Prazan dan ne ostavlja red: cron koji svakog dana zapiše „nije bilo posla" zatrpa reviziju
    i pojede jedini razlog zbog kog se ona čita. Nedeljni izveštaj je izuzetak i piše red iako
    ništa ne menja — bez njega je izveštaj koji nikad nije stigao nerazlučiv od onog koji je
    stigao pa se izgubio u spamu.
14. **Mejl korisniku „rešeno je ono što si prijavio" NIJE u ovoj isporuci.** §7 ga nabraja, ali
    F11 §11 ga izričito stavlja u F11.4, zajedno sa `/utisci` i tačkom na dugmetu. `notified_at`
    i `feedback_unseen_count` zato i dalje niko ne puni.
15. **Dodat indeks `feedback_created_idx`.** Lista sortira po `created_at desc` bez ijednog
    filtera čim se otvori, a `feedback_status_idx` iz 0011 tu ne pomaže jer vodeća kolona nije u
    upitu.
16. **Labele statusa i slojeva žive u `admin-utisci-schema.ts`, ne uz čitanje.** `admin-utisci.ts`
    je `server-only`, pa ih klijentski panel odande ne može uzeti; treći prepis istih šest
    stringova bio bi treći koji se raziđe.
17. **Nema `GET /api/admin/utisci`.** Ekran je serverska komponenta i čita direktno — isto
    obrazloženje kao u „S3", tačka 3, i „S5", tačka 5.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm check:secrets`, `pnpm test` i `pnpm build` prolaze.
Nijedan hex ni oklch u JSX-u; jedine zakucane boje su u telu mejlova (`utisci-izvestaj.ts`),
gde tokena nema jer mejl klijent ne vidi `globals.css` — isto kao u `feedback-mail.ts` i
`admin-mail.ts`. Nijedna nova biblioteka; nijedan nov Places poziv. Svih šest novih ruta je
dinamično. **Vizuelna provera obe teme i telefona (≤ 390 px) ostaje na meni.** Uz nju idu i
četiri funkcionalne, jer nijedna ne može bez pravog Resend-a i pravog bucketa:

1. pošalji utisak sa ocenom 2 i idejom — mejl NE sme da stigne odmah; pokreni digest rukom i
   proveri da je stigao jedan mejl sa tim redom, pa da drugi poziv ne šalje ništa;
2. pošalji bug sa nalepljenom slikom — mejl stiže odmah i nosi link na `/admin/utisci/<id>`,
   ali NE i potpisan URL slike; otvori taj link i proveri da se slika vidi;
3. u panelu klikni „Dodeli 10 kredita" dvaput brzo — balans sme da poraste jednom, a u
   `/admin/revizija` moraju da stoje dva reda `feedback.reward` (drugi sa „već dodeljeno");
4. otpremi sliku pa ne pošalji utisak, pomeri joj `created_at` unazad i pokreni
   `utisci-slike` — fajl mora da nestane, a slika vezana za živu prijavu da ostane.

### Prompt (za ponavljanje isporuke iz nule)

```
Radimo F11.3 iz docs/F11-utisci-v2.md. Pročitaj CLAUDE.md, ceo docs/F11-utisci-v2.md,
docs/F12-admin.md i odeljke „S3", „S4" i „S5" u docs/SESIJE.md. Konzola već postoji i
gotova je — ovo je jedan ekran u njoj i nekoliko cron ruta, ne nov okvir. Ništa iz F11.4.

Zatečeno stanje, ne prepisuje se nego se dopunjuje:
- lib/admin.ts — jeAdmin(), requireAdminPage(), requireAdminRoute(), odgovorNeAdmin(),
  RADNJE (imenski prostor za `action` — nov `action` ide TAMO, ne kao string u ruti),
  upisiAudit(), proveriTempo() 120/h, proveriDnevniTempo() za uže brojače, ipZahteva()
- lib/admin-radnje.ts — pripremiRadnju() (admin → profil aktera → tempo), procitajTelo(),
  saAuditom(); SVAKA NOVA RUTA POD /api/admin IDE KROZ TA TRI. `Ishod.podaci` je kanal ka
  klijentu koji nikad ne dodiruje dnevnik; `Ishod.payload` je ono što u dnevnik ide
- lib/mail.ts — JEDINI izlaz ka Resend-u (tajmaut, čišćenje ključa iz greške, provera
  adrese, escapeHtml). Digest i nedeljni izveštaj idu kroz njega, ne kroz nov fetch
- lib/admin-korisnici.ts, admin-pozivnice.ts, admin-izvoz.ts, admin-pregled.ts — čitanja
- ekrani (admin): /admin pregled, /admin/korisnici (+ detalj), /admin/pozivnice,
  /admin/revizija. Nova stavka u meniju ide u admin-navigacija.ts TEK kad ekran postoji
- migracije zaključno sa 0014; sledeća je 0015

Napravi:

1. /admin/utisci po F11 §6.6: filteri (status, sloj, ocena, korisnik), lista, detalj u panelu
   desno. Radnje: status, oznake, beleška, „dodeli 10 kredita" (grant_feedback_credits),
   „poveži sa stavkom dnevnika". Sve kroz pripremiRadnju()/saAuditom() — PAŽNJA:
   grant_feedback_credits, za razliku od admin_adjust_credits, NE upisuje audit sam, pa ga
   ruta mora upisati (v. „S3 — šta se razišlo", tačka 6, i „S5", tačka 2).
2. Red brojki iznad liste: odgovorenost po pitanju, medijana cene iz sredina opsega, broj
   otvorenih bugova, prosek do odgovora. Brojke moraju da se poklope sa karticom „Utisci" na
   /admin pregledu — ona već čita `admin_overview` (migracija 0013). Ako ti treba još neka
   agregacija, dopuni TU funkciju, nemoj praviti drugu koja broji isto.
3. Slika uz utisak: potpisan URL TTL 10 minuta, generisan u trenutku otvaranja detalja.
   NIKAD u mejlu — mejl nosi link na /admin/utisci/[id].
4. Digest u 21:00: /api/cron/utisci-digest, Vercel cron, CRON_SECRET poređen otporno na
   vreme. Instant mejl ostaje samo za kind='bug', rating=1 i incident. Prazan dan ne šalje
   mejl. Cron ruta NIJE admin ruta — ona nema sesiju, pa ide kroz tajnu, ali sve što menja
   podatke i dalje mora da ostavi trag.
5. Nedeljni izveštaj ponedeljkom u 09:00 sa funnelom po pitanju i medijanama. Medijanu NE
   računaj ponovo — `medijanaCene()` iz packages/shared/src/feedback-katalog.ts je jedini
   izvor istine, jer su sredine opsega tamo gde i sami opsezi (isto pravilo poštuje i
   admin_overview: on vraća sirove odgovore). U izveštaju uvek stoji rečenica da medijana iz
   manje od 12 odgovora nije dokaz nego signal.
6. Nedeljni cron koji briše slike bez `feedback_id` starije od 24 h (F11 §9). Bucket je
   `feedback`, privatan; S2 ga puni ali sirotane još ne čisti.

Nepregovarljivo: pravila 3, 13, 14 i 16 iz CLAUDE.md; nijedan hex u JSX-u; obe teme;
nijedan nov Places poziv.

Kad završiš: typecheck, check:sql, check:secrets, lista iz docs/SESIJE.md, ažuriraj taj
fajl i napiši prompt za sledeću sesiju.
```

---

## S7 — F11.4: zatvaranje petlje ☑ isporučeno

### Šta je isporučeno

- `supabase/migrations/0016_f11_petlja.sql` — `feedback.user_note` (obrazloženje
  za korisnika), `feedback.notify_attempts` (brojač pokušaja mejla „rešeno") i
  parcijalni indeks za tačno taj upit
- `apps/web/src/app/(app)/utisci/page.tsx` — „Moje prijave": statusi kao bedževi
  (rešeno → akcenat, u radu → info, odbijeno/duplikat bez obrazloženja →
  „Pročitano"), sadržaj prijave, `user_note` kao obrazloženje, +N kredita uz
  nagrađen bug; otvaranje upisuje `seen_at` i nulira `feedback_unseen_count`
  kroz `after()`
- `apps/web/src/lib/moje-prijave.ts` — čitanje korisnikovih prijava i oznaka
  viđenog; `apps/web/src/lib/navigacija.ts` — stavka „Moje prijave" u meniju
  „Nalog", ne u „Rad"
- Tačka sa brojačem na plutajućem dugmetu (`utisak-dugme.tsx`), koja vodi na
  `/utisci`; brojač se čita iz profila koji layout ionako čita — nijedan dodatan
  upit; inkrement pri prelasku u `reseno` u `izmeniUtisak`
- Mejl „rešeno je ono što si prijavio" — u `utisci-izvestaj.ts`
  (`posaljiResenoObavestenja`), pokreće se iz iste cron rute kao i digest
  (21:00); jedan mejl po korisniku za sve njegove rešene prijave, 3 pokušaja po
  prijavi (`notify_attempts`), bez mejla → tačka ostaje kanal
- Beta dnevnik: `apps/web/src/lib/dnevnik.ts` (čitanje + CRUD), sekcija na
  `/dashboard` (5 poslednjih stavki, „N od M promena iz utisaka", oznaka
  „iz tvog utiska"), ekran `/admin/dnevnik` sa CRUD-om i stavka „Dnevnik" u
  admin meniju; tri radnje u `RADNJE` (`changelog.create/update/delete`)
- Provera teze (F11 §10) u nedeljnom izveštaju — kohorte „video rešeno" vs
  „nije video", sa rečenicom „mehanika NE radi" kad je razlika < 10 pp
- `scripts/validate-migrations.ts` — blok „F11.4" (kolone, indeks, ograničenje)

### Šta se razišlo sa PRD-om

1. **„Čita se kroz API rutu" nije sprovedeno.** Ekran `/utisci` je serverska
   komponenta i čita direktno kroz `adminSupabase()` sa `user_id` iz sesije —
   isto odstupanje koje konzola ima od F12 §4 („S3", tačka 3; „S6", tačka 17).
   RLS na `feedback` ostaje `using (false)` netaknut. Ruta pod `/api` bi bila
   drugi put do istih podataka, sa istom proverom i bez ijednog pozivaoca.
2. **Uvedena je kolona `user_note` umesto deljenja `admin_note`.** PRD traži
   „odluči da li se to polje deli ili se uvodi drugo". Uvedeno je drugo:
   `admin_note` je radna beleška (sme da sadrži interne stvari — „isti koren
   kao #42", linkove, podsetnike), a `user_note` je javno obrazloženje (ide u
   „Moje prijave" i u mejl). Pomešati to dvoje bi ili procurelo interne stvari
   spolja, ili nateralo admina da piše belešku kao da je javna.
3. **Mejl „rešeno" nema svoju cron rutu — živi u digest ruti (21:00).** Vercel
   Hobby dozvoljava samo dva rasporeda (već zauzeta: digest i nedeljni izveštaj).
   „Najviše 1 dnevno po korisniku" i „jedan mejl za 5 prijava" se ionako mogu
   ispuniti samo u dnevnom prolazu, pa digest ruta sada radi dva posla redom:
   prvo korisniku („rešeno"), pa meni (digest).
4. **Tačka i mejl prate samo `reseno`, ne i `odbijeno`.** F11 §9 govori o
   „rešenoj prijavi", a odbijeno se korisniku ionako prikazuje kao „Pročitano".
   Odbijeno bez obaveštenja je svesna odluka po PRD-u; ako zatreba, isti cron i
   isti brojač primaju `odbijeno` bez ijedne izmene šeme.
5. **`seen_at` se upisuje samo redovima sa ishodom** (rešeno/odbijeno/duplikat),
   a brojač se nulira uvek. Otvorena prijava nema šta da bude „viđena".
6. **Inkrement brojača tačke je čitanje-pa-upis, bez trke.** Brojač je kozmetika
   (tačka na dugmetu), ne novac, i samo se nulira pri otvaranju `/utisci` —
   najgori ishod trke je tačka 2 umesto 1, i ispravi se prvim otvaranjem.
   Pravilo 3 nije u igri (krediti se ne diraju).
7. **Nema `GET /api/dnevnik`** — dashboard čita direktno; stavka „Cache-Control
   … `/api/dnevnik` sme `private, max-age=60`" iz §8 je time bez predmeta.
8. **Korisnik bez mejla u profilu** — prijava se broji kao pokušaj do 3 i
   ispada iz crona; kanal obaveštavanja je tačka na dugmetu, koja ne zavisi od
   mejla.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm check:secrets`, `pnpm test` i
`pnpm build` prolaze. Nijedan hex ni oklch u JSX-u (jedine zakucane boje su u
telu mejlova, gde tokena nema — isto kao u `feedback-mail.ts`). Nijedna nova
biblioteka; nijedan nov Places poziv. **Vizuelna provera obe teme i telefona
(≤ 390 px) ostaje na meni**, uz funkcionalne:
1. postavi `reseno` na prijavu iz konzole — tačka na dugmetu korisnika, jedan
   mejl „rešeno" u sledećem digest prolazu, i stavka u „Moje prijave";
2. postavi `reseno` na 5 prijava istog korisnika odjednom — JEDAN mejl sa 5
   stavki, brojač tačke 5;
3. otvori „Moje prijave" — tačka nestaje, `seen_at` se upisuje;
4. napravi stavku u `/admin/dnevnik` i poveži je sa prijavom — na dashboard-u
   stoji „iz tvog utiska";
5. ubaci obrazloženje (`user_note`) uz `odbijeno` — korisnik vidi „Odbijeno" +
   rečenicu; bez njega vidi „Pročitano".

```
Radimo F11.4 iz docs/F11-utisci-v2.md — poslednja isporuka F11. Pročitaj CLAUDE.md, ceo
docs/F11-utisci-v2.md i odeljak „S6 — F11.3" u docs/SESIJE.md (šta je isporučeno i šta se
razišlo sa PRD-om). F12 je ceo gotov; admin konzola se ne prepisuje.

Zatečeno stanje, ne prepisuje se nego se dopunjuje:
- lib/admin.ts — RADNJE (nov `action` ide TAMO), upisiAudit(), proveriTempo(), ipZahteva(),
  originZahteva()
- lib/admin-radnje.ts — pripremiRadnju(), procitajTelo(), saAuditom(); SVAKA nova ruta pod
  /api/admin ide kroz ta tri
- lib/cron.ts — jeCron() (CRON_SECRET, poređenje otporno na vreme), odgovorNeCron() → 404,
  saCronAuditom(); svaka nova cron ruta ide kroz njega, ne piše svoju proveru tajne
- lib/mail.ts — JEDINI izlaz ka Resend-u; lib/utisci-izvestaj.ts — digest u 21:00 i nedeljni
  izveštaj ponedeljkom, oba već rade i oba čitaju admin_overview
- lib/feedback.ts — ideOdmah(): instant mejl SAMO za kind='bug', rating=1 i incident; sve
  ostalo čeka digest. `emailed_at` je jedini marker „poslato"
- lib/admin-utisci*.ts + /admin/utisci — lista, panel, status, oznake, beleška, nagrada od 10
  kredita, veza sa stavkom dnevnika. `resolved_at` se upisuje pri prelasku u završni status
- tabela `changelog` postoji od 0011 i PRAZNA je: `from_feedback` se već puni iz
  /admin/utisci, ali stavke nema ko da napravi — to je ova sesija
- profiles.feedback_unseen_count i feedback.notified_at / seen_at postoje od 0011 i NIKO ih
  još ne puni
- migracije zaključno sa 0015; sledeća je 0016

Napravi:

1. Ekran /utisci („Moje prijave", F11 §6.4): statusi kao bedževi, obrazloženje uz rešeno.
   ODBIJENO BEZ OBRAZLOŽENJA se prikazuje kao „pročitano" — ko vidi „odbijeno" bez reči više
   ne piše. Otvaranje ekrana upisuje seen_at i nulira feedback_unseen_count. Stavka ide u
   meni „Nalog", ne u „Rad". Čita se kroz API rutu sa service_role; RLS na feedback ostaje
   using (false). Beleška iz admina (`admin_note`) NIJE obrazloženje za korisnika — odluči
   da li se to polje deli ili se uvodi drugo, i reci mi zašto.
2. Tačka na plutajućem dugmetu kad postoji rešena prijava koju korisnik nije video.
   feedback_unseen_count se čita u (app)/layout.tsx, gde se profil ionako čita — nijedan
   dodatan upit po navigaciji.
3. Mejl „rešeno je ono što si prijavio": kad status pređe u reseno, najviše jednom dnevno po
   korisniku, sa rečenicom obrazloženja i linkom na /utisci. Ako je 5 prijava istog korisnika
   rešeno odjednom — JEDAN mejl sa 5 stavki, brojač tačke ide na 5 (§9). Pad Resend-a →
   notified_at ostaje null i sledeći prolaz pokušava ponovo, najviše 3 puta; to znači i brojač
   pokušaja. Slanje ide iz cron rute, ne iz PATCH-a u /admin/utisci: „najviše 1 dnevno po
   korisniku" i „jedan mejl za 5 prijava" se ne mogu ispuniti u trenutku klika.
4. Beta dnevnik (F11 §6.5): poslednjih 5 stavki na /dashboard, oznaka „iz tvog utiska" kad je
   presek changelog.from_feedback sa korisnikovim prijavama neprazan, brojač „N od M promena
   iz utisaka". Uz to /admin/dnevnik — CRUD stavki, i tek tada stavka u admin-navigacija.ts.
   `changelog` već ima politiku `select using (published)`, jedinu u projektu.
5. Provera cele teze (§10, poslednji red): uporedi stopu drugog utiska kod onih koji su videli
   „rešeno" i kod onih koji nisu. Brojka ide u nedeljni izveštaj, u lib/utisci-izvestaj.ts —
   ne u nov izveštaj. Ako nema razlike, mehanika ne radi i to piše u izveštaju.

Nepregovarljivo: pravila 3, 8, 10, 13, 14 i 16 iz CLAUDE.md; nijedan hex u JSX-u; obe teme;
nijedan nov Places poziv.

Kad završiš: typecheck, check:sql, check:secrets, pnpm test, lista iz docs/SESIJE.md,
ažuriraj taj fajl. F11 i F12 su tada gotovi — napiši mi kratak pregled šta je isporučeno i
šta ostaje kao dug.
```

---

## F11 i F12 — gotovo

Svih sedam isporuka (S1–S7) je zatvoreno. F11 (utisci v2 — motor, kampanje, konzola,
petlja) i F12 (admin konzola) su kompletni. Preostali dug nije u ovim fazama:

- `docs/REVIZIJA.md` — nalazi revizije (najvažniji: `retryAfter` u `BudgetError`, statusna
  zaštita `complete_job`, IP rate limit, bezbednosni headeri, zadržavanje podataka)
- `docs/PLAN-IZMENA.md` — redosled tih popravki (Faza 0 počinje od worker-a)
- `docs/ROADMAP.md` — kasniji razvoj (F8 landing + beta, naplata, region, …)

Naredne sesije više ne rade iz F11/F12 PRD-a; sledeći korak je `docs/PLAN-IZMENA.md`
ili `docs/ROADMAP.md`.

---

## S8 — Faza 0: worker — novac i pouzdanost ☑ isporučeno

Rad iz `docs/PLAN-IZMENA.md`, Faza 0. Zatvara nalaze K1, V1, V2, V5, V7 i N5
iz `docs/REVIZIJA.md`.

### Šta je isporučeno

- **0.1 — `retryAfter` u oba `BudgetError` mesta (K1):**
  - `apps/worker/src/lib/api-budget.ts` — nova čista funkcija `nextDayReset()` (ponoć
    sledećeg LA dana) i `nextMonthReset()` (prvi sledećeg LA meseca). Obe vraćaju TAČNO
    ponoć po LA (koračanje od celog UTC sata, pa DST ne pomera rezultat), ne „sutra u ovo
    doba".
  - `assertAvailable()` (pre-flight) sada baca `BudgetError` sa `retryAfter` za sve tri
    vrste odbijanja: `exhausted` i `daily` → `nextDayReset()`, `monthly` → `nextMonthReset()`.
  - 429 handler u `places.ts` baca sa `retryAfter` = `nextDayReset()` (i `scope:
    "exhausted"`, koji je ranije bio `undefined`).
  - Posledica u `index.ts`: scan koji udari u iscrpljen budžet ide kroz `defer_job` u
    `pending` sa `run_after` = reset kvote, umesto da potroši sva tri pokušaja, padne i
    refunduje kredit.
- **0.2 — statusna zaštita završetka posla (V1):**
  - `supabase/migrations/0017_f0_worker.sql` — `complete_job`, `fail_job` i `defer_job`
    menjaju stanje samo nad poslovima sa `status = 'running'`. Gotov posao ostaje `done`,
    kasno stigao `fail_job`/`defer_job` je no-op, ponovljen `complete_job` ne pomera
    `finished_at`. Granice se ne menjaju, pa `create or replace` čuva privilegije iz 0003.
  - `apps/worker/src/index.ts` — `completeJob(job.id)` izvučen IZVAN try-ja: greška u
    završetku ne ulazi u catch, pa ne poziva `fail_job` (koji bi vratio gotov posao u red
    ili refundovao uspešan scan). Pad `complete_job` se loguje, a posao koji je stvarno
    ostao `running` vraća u red prva žetva — isto kao kad proces pogine.
  - **`defer_job` je dobio istu zaštitu iako plan pominje samo `complete_job`/`fail_job`**
    — ista klasa greške: kasno stiglo odlaganje ne sme da produži `run_after` gotovog posla.
- **0.3 — timeout na sve Supabase pozive workera (V2):** `apps/worker/src/lib/supabase.ts`
  — `global.fetch` omotač sa `AbortSignal.timeout(30_000)` na oba klijenta (`supabaseAdmin`
  i `supabaseAnon`). Zakačen RPC se završi greškom za 30 s, posao ide na retry kroz
  `fail_job`/backoff, slot se oslobađa — žetva ne stigne da duplira posao.
- **0.4 — `maxRetries: 0` na Anthropic klijentu (V5):** `rewrite-message.ts` — SDK po
  podrazumevanoj vrednosti sam ponavlja mrežne greške do 2 puta; sa 3 pokušaja posla kroz
  red to je do 9 plaćenih poziva za jedan zahtev. Retry već radi red poslova, pa se ne
  duplira: dva uzastopna pada = tačno 2 plaćena poziva. (`ai-audit.ts` ima svoj
  `maxRetries: 1` i nije u opsegu Faze 0.)
- **0.5 — `unhandledRejection`/`uncaughtException` handleri (V7):** `index.ts` — greška se
  loguje i proces nastavlja; posao ne umire usred rada zbog neuhvaćenog odbijanja promise-a.
- **0.6 — odluka o više niša po biznisu (N5):** **ODLUKA: „poslednji scan pobeđuje"** —
  dokumentovana u komentaru `upsertBusinesses` (db-writes.ts) i u ovoj sesiji. Razlog je
  u odstupanjima ispod.
- **Provere:** `scripts/validate-migrations.ts` — blok „reset kvote — TS i SQL se slažu
  (Faza 0, 0.1)" poredi `nextDayReset`/`nextMonthReset` sa `budget_next_day_reset`/
  `budget_next_month_reset` (uključujući prelazak dana pre LA ponoći i DST 8. mart 2026);
  blokovi 0.2 proveravaju no-op ponašanje `fail_job`/`defer_job` na ne-running poslovima i
  ceo scenarij „complete → kasno stigla greška". `apps/worker/test/api-budget.ts` — test
  reset helpera (tačna ponoć, DST granice, redosled dnevnog i mesečnog reseta).

### Šta se razišlo sa planom

1. **0.6 — izabrano je dokumentovano prihvatanje, ne konfliktni ključ.** Plan nudi oba:
   „biznis u dve niše ostaje u obe (ili je odluka zapisana u SESIJE)". Konfliktni ključ
   `(place_id, country_code, city_slug, niche_slug)` kao PK bi oborio tri strana ključa
   koja gledaju u `businesses(place_id)` (`website_audits`, `unlocks`, `outreach_messages`
   — svi `on delete cascade`) i zahtevao bi prepravku pretrage i otključavanja. Prava
   podrška za više niša je zasebna tabela članstva + prepravka `search.ts` — to je izmena
   šeme i upita (veličina Faze 2/3), ne popravka, i ne staje u Fazu 0. Posledica je svesna:
   biznis koji Google vrati u dve niše vidljiv je samo u poslednje skeniranoj. Ako odluka
   zatreba da se promeni, ide kao zasebna faza.
2. **0.2 — zaštita je dodata i na `defer_job`**, koji plan ne pominje (v. isporučeno).
3. **0.1 — 429 handler sada nosi i `scope: "exhausted"`**, koji je ranije bio `undefined`
   (BudgetError se pravio sa dva argumenta). Ishod se ne menja — `index.ts` gleda samo
   `retryAfter` — ali je greška sada i tipski tačna.
4. **`nextDayReset`/`nextMonthReset` su nove čiste funkcije u `api-budget.ts`**, kako bi se
   mogle porediti sa SQL funkcijama u `pnpm check:sql` — isti obrazac kao `budgetDay()`.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm test` prolaze (uključujući novi
`apps/worker/test/api-budget.ts`). Nijedan nov Places poziv; migracija 0017 ne dira nijedan
postojeći podatak. **Ručne provere ostaju na meni** (nijedna ne traži pravi Google poziv):

1. postavi `GOOGLE_DAILY_LIMIT=0` (ili isprazni `api_budget` dnevni brojač) i pokreni scan —
   posao mora da ode u `pending` sa `run_after` sutra u 09:00 po Beogradu, ne u `failed`;
   `attempts` se vraća unazad;
2. `kill -9` radnika usred scana — posao se pojavi kao `running` do žetve (15 min), pa
   `pending` sa `attempts+1`; posle tri puta → `failed` + povraćaj kredita;
3. zaustavi Supabase (ili ga učini nedostupnim) — worker RPC mora da padne za ≤ 30 s i
   posao ode na retry, a slot da se odmah oslobodi (ne posle 15 min preko žetve);
4. dvaput pokreni `rewrite_message` sa mrtvim ANTHROPIC_API_KEY — u logu tačno 2 plaćena
   pokušaja (2 poziva), ne 6–9;
5. sa iscrpljenim budžetom pokreni scan — u logu „odloženo do …" umesto „PAO konačno".

### Prompt (za sledeću sesiju — Faza 1, bezbednost)

```
Radimo Fazu 1 iz docs/PLAN-IZMENA.md (bezbednost: zatvaranje P1 liste). Pročitaj prvo
CLAUDE.md, docs/bezbednost-i-zastita.md, docs/PLAN-IZMENA.md i odeljak „S8 — Faza 0" u
docs/SESIJE.md. Ne diraj Fazu 2 (ispravnost) ni Fazu 3 (performanse) — idu redom.

Zatečeno stanje: S1–S7 (F11/F12) i S8 (Faza 0) su gotovi. Migracije idu do 0017; sledeća
je 0018.

Stavke Faze 1:
1.1 Bezbednosni headeri (CSP, HSTS, X-Frame-Options, Referrer-Policy) u next.config.ts
    headers() — CSP ne sme da lomi app u obe teme.
1.2 IP rate limit na novčane rute (/api/unlock, /api/search, /api/feedback*) — nova tabela
    ili Upstash, 100/min po IP, 429 preko.
1.3 webhook_events(provider, event_id) — insert pre obrade u webhooks/clerk/route.ts,
    dupla isporuka preskočena. (Migracija 0018.)
1.4 Env šema: CLERK_SECRET_KEY format (sk_…) + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY u
    lib/env.ts.
1.5 kind/source za utiske van pitanja izvoditi na serveru (bez lažnog incident/bug) —
    api/feedback/route.ts + feedback-schema.ts.
1.6 Dnevni plafon utisaka i dopuniUtisak u RPC sa for update — lib/feedback.ts + migracija.

Gotovo kad: P1 lista iz docs/bezbednost-i-zastita.md nema otvorenih stavki osim backup-a
(Faza 6) i kanarinaca/deljenja naloga (ROADMAP). typecheck, check:sql, test prolaze.

Kad završiš: prođi kroz listu „Kraj svake sesije" iz docs/SESIJE.md, ažuriraj taj fajl
(S9 — Faza 1) i napiši mi prompt za Fazu 2.
```

---

## S9 — Faza 1: bezbednost — zatvaranje P1 liste ☑ isporučeno

Rad iz `docs/PLAN-IZMENA.md`, Faza 1. Zatvara nalaze S1–S4 iz revizije i P1 stavke
iz `docs/bezbednost-i-zastita.md` koje su bile otvorene.

### Šta je isporučeno

- **1.1 — Bezbednosni headeri:** `next.config.ts` `headers()` na svim rutama — CSP
  (sastavljen oko onoga što app stvarno koristi: Clerk connect/img, Supabase connect/img,
  `blob:`/`data:` za snimke i avatare, `'unsafe-inline'` u script-src zbog temne skripte u
  `<head>`-u), HSTS (1 godina + poddomeni), `X-Frame-Options: DENY`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`
  (camera/mic/geo isključeni). Provereno `curl -I` nad buildanim app-om — svi headeri
  izlaze.
- **1.2 — IP rate limit:** `request_limits` tabela + `claim_request` RPC (fiksni prozor od
  minuta, 100 zahteva po IP+ruta, čišćenje starih redova na prvom zahtevu svakog minuta).
  `lib/rate-limit.ts` — `proveriIpTempo(req, ruta)`; ubačen na 8 mesta: `/api/unlock`,
  `/api/search`, `/api/feedback` (POST), `/api/feedback/[id]` (PATCH), `/api/feedback/slika`,
  `/api/feedback/pitanje/[kljuc]/prikazano` + `/odbaceno`, `/api/feedback/podsetnik-vidjen`.
  Pad brojača NE ruši rutu (log + nastavi) — za razliku od admin tempa, ovde je brojač
  čista odbrana, ne deo ispravnosti.
- **1.3 — Webhook idempotencija:** `webhook_events(provider, event_id)` u migraciji 0018;
  ruta upisuje marker PRE obrade (na konflikt preskoči → `{duplicate: true}`), a na padu
  obrade BRIŠE marker da Svix retry može ponovo. Clerkov tip događaja ne nosi `id`, pa se
  event_id čita iz sirovog tela pre verifikacije (zahtev se rekonstruiše za Svix potpis).
- **1.4 — Env šema:** `CLERK_SECRET_KEY` se validira na `sk_(test|live)_`, a
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` na `pk_(test|live)_` — tipfeler pada odmah sa jasnom
  porukom.
- **1.5 — `kind`/`source` van pitanja na serveru:** POST `/api/feedback` bez `prompt_key`
  odbija `source ∉ {dugme, podsetnik}` i `kind ∉ {ideja, pohvala, drugo}` sa 400 —
  `{rating:3, kind:'bug', source:'incident'}` bez pitanja ne može da izazove instant mejl
  ni da zagadi metriku bugova. Klijent (panel) ne šalje `kind` pri nastanku — ništa se ne
  lomi.
- **1.6 — Utisci u RPC-u:** migracija 0018 donosi `zabelezi_utisak` (dnevni plafon u ISTOJ
  transakciji sa upisom, `for update` nad profilom — dva paralelna POST-a se serijalizuju,
  plafon se ne probija; `ctx` gradi RPC) i `dopuni_utisak` (CAS upis sa `for update` nad
  redom: TS spoji+validira Zod-om, RPC upisuje samo ako se `answers` nije promenio od
  čitanja; 'stale' → TS ponavlja sa svežim stanjem, najviše 3 puta). Oba vraćaju ceo red
  kao jsonb.
- **Provere:** `check:sql` — blokovi „Faza 1": claim_request (100 ok → 101. odbijen, nova
  ruta svoj brojač, nov minut reset), webhook dedup (on conflict preskoči), zabelezi_utisak
  (plafon 2 → treći je plafon, no_user, ctx oblik), dopuni_utisak (CAS stale, nema);
  `request_limits` i `webhook_events` u RLS listi; tri nove funkcije u listi prava.

### Šta se razišlo sa planom

1. **`dopuni_utisak` je CAS upis, ne „jedan RPC koji validira".** Validaciju odgovora radi
   Zod iz kataloga (pravilo 16) — SQL nema katalog, pa spajanje+validacija ostaju u TS-u,
   a RPC je jedina tačka upisa: zaključa red, poredi `answers` sa očekivanim, upisuje
   očišćeni spoj. To je isto „u RPC sa `for update`" kako plan traži, sa CAS retry petljom
   kao nužnim dodatkom (maksimalno 3 pokušaja, pa 500).
2. **`zabelezi_utisak` je uzeo i građenje `ctx`-a iz TS-a.** Stara verzija je čitala profil
   + broj otključanih + broj utisaka u tri paralelna upita pa upisivala; RPC radi sve pod
   istom bravom i vraća gotov `ctx` — manje upita i jedna transakcija manje. Oblik `ctx`-a
   je isti (plan, credits, unlocks, ua, viewport, errors uz bug) i pokriven u check:sql.
3. **`podsetnik-vidjen` ruta je dobila `req` parametar** (ranije `POST()` bez argumenta) —
   da bi limiter uopšte imao odakle da čita IP.
4. **`X-Content-Type-Options` i `Permissions-Policy` su dodati uz četiri planirana
   headera** — oba su jedna linija i bez njih lista ne bi bila kompletna.
5. **P1 stavka „Zavisnosti" (Dependabot + `npm audit` u CI) ostaje za Fazu 6.9**, kako je i
   planirano u PLAN-IZMENA.md — „Gotovo kad" Faze 1 pominje samo backup, ali plan eksplicitno
   drži zavisnosti u Fazi 6. Pravni tekstovi (P0, ZZPL) su F8/ROADMAP.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm test`, `pnpm build` prolaze; `curl -I` nad
buildanim app-om pokazuje svih šest headera. Nijedan nov Places poziv. **Ručne provere
ostaju na meni**:

1. otvori app u obe teme (tamna i svetla) i prođi ceo tok — CSP ne sme da lomi ništa
   (najrizičnije: Clerk prijava, slika uz utisak, snimci u `/lista`);
2. 101 brzih POST-ova na `/api/unlock` (npr. `for i in $(seq 101); do curl -X POST …; done`)
   — 101. mora da vrati 429; sledeći minut ponovo radi;
3. pošalji isti Clerk webhook dvaput (Svix retry ili `curl` sa istim telom i potpisom) —
   drugi put `{ok:true, duplicate:true}`, bez duplog profila ni kredita;
4. pošalji `POST /api/feedback` sa `{rating:3, kind:"bug", source:"incident"}` bez
   `prompt_key` — 400; sa `{rating:3}` — prolazi;
5. dva brza `POST /api/feedback` iste sekunde na plafonu 50/24h — najviše jedan preko.

### Prompt (za sledeću sesiju — Faza 2, ispravnost)

```
Radimo Fazu 2 iz docs/PLAN-IZMENA.md (ispravnost: uvoz, pretraga, web bugovi). Pročitaj
prvo CLAUDE.md, docs/PLAN-IZMENA.md, docs/REVIZIJA.md (odeljci 4 i 5.4) i odeljak „S9 —
Faza 1" u docs/SESIJE.md. Ne diraj Fazu 3 (performanse) ni Fazu 4 (UX).

Zatečeno stanje: S1–S9 gotovi (F11/F12, Faza 0, Faza 1). Migracije idu do 0018; sledeća
je 0019. IP rate limit već stoji na /api/unlock, /api/search i /api/feedback* — nove rute
u ovoj fazi (npr. /api/uvoz) dobijaju isti limiter.

Stavke Faze 2:
2.1 CSV uvoz: batch RPC (petlja u SQL-u) ili paralelizovane grupe + dedupeKey/transakcija —
    lib/uvoz.ts, api/uvoz/route.ts, migracija. 2000 redova < 60 s; retry ne duplira.
2.2 .in() u grupama ~100–200 — search.ts, moja-lista.ts, krediti.ts, admin-korisnici.ts.
2.3 spend_credit_and_scan/enqueue_job: unique_violation → re-select (joined) — migracija.
2.4 poruke/ai: provera payload.placeId === placeId pre čitanja.
2.5 Dedup insert outreach_messages.
2.6 job: { id: charge.jobId ?? 0 } → interna greška ako nema jobId.
2.7 Posle naplate uvek status: "queued" i sa pao keš-read.
2.8 Seed: ne pregaziti sveže audite (audit_level > 1).

Gotovo kad: svi W1–W7 i N1–N6 nalazi zatvoreni ili svesno odloženi uz zapis u SESIJE.
typecheck, check:sql, test prolaze.

Kad završiš: prođi kroz listu „Kraj svake sesije", ažuriraj docs/SESIJE.md (S10 — Faza 2)
i napiši mi prompt za Fazu 3.
```

---

## S10 — Faza 2: ispravnost — uvoz, pretraga, web bugovi ☑ isporučeno

Rad iz `docs/PLAN-IZMENA.md`, Faza 2. Zatvara nalaze W1–W7, N1 i N6 iz revizije.

### Šta je isporučeno

- **2.1 — CSV uvoz u paralelnim grupama (W1):** petlja red-po-red (do 4000+ RPC
  poziva za 2000 redova, uvek istekne u 60 s) je zamenjena grupama od 30 paralelnih
  zadataka. Uz to, novo `otkljucajZaUvoz` u `lib/unlock.ts` — isti
  `spend_credit_and_unlock` (jedini put do kredita) + upis `enrich_full` posla, ali BEZ
  ~4 UI čitanja koja `unlockLead` radi za odgovor ekrana. `kreditiPresli` je kumulativna
  provera budžeta: kad balans padne na nulu, nove grupe preskaču otključavanje; samu
  granicu i dalje drži baza, atomično po redu. **W2 (retry ne duplira):** otključavanja
  su idempotentna po (user_id, place_id), statusi i beleške su upsert — ponovljen uvoz
  ne skida kredit dvaput. To je zapisano u `lib/uvoz.ts` i u odstupanjima ispod.
- **2.2 — `.in()` u grupama (W3):** novi `lib/upiti.ts` (`inGrupe`, po 200) primenjen na
  svih 7 mesta: `search.ts` (auditi do 1200 + otključani), `moja-lista.ts` (biznisi i
  auditi do 2000), `krediti.ts` (place_id i job_ids), `admin-korisnici.ts` (place_id).
- **2.3 — trka na prvom scanu (N1):** `enqueue_job` u migraciji 0019 hvata
  `unique_violation` (dva procesa prošla kroz prazan `for update`) i preuzima tuđi red —
  `joined=true`, isti job_id, nijedan 500.
- **2.4 — poruke drugog posla (W4):** `GET /api/poruke/ai` posle provere pretplate čita
  `job_queue.payload` i uparuje `placeId` i kanal (i tip posla) pre čitanja poruke.
  Neusklađeno → 404, isti odgovor kao za tuđ posao.
- **2.5 — dupli klik na „Kopiraj" (W5):** jedinstveni indeks
  `outreach_messages_dedupe_idx (user_id, place_id, channel, body)` u migraciji 0019;
  ruta (`lib/poruke.ts`) i worker (`rewrite-message.ts`) upisuju kroz `upsert` sa
  `ignoreDuplicates: true`. Retry posla u workeru ne upisuje drugi red.
- **2.6 — nema pollovanja posla 0 (N6):** `spend_credit_and_scan` koji vrati `ok` bez
  `job_id` je interna greška (500), ne `job: {id: 0}`. Klijent se ne kači na posao koji
  ne postoji; ponovljen pokušaj je bezbedan (idempotencija po kombinaciji).
- **2.7 — plaćen scan nikad ne vrati 500 (W7):** keš-čitanje posle naplate je u
  `try/catch` — pad se loguje, odgovor ostaje `queued` sa job id, klijent polluje posao.
- **2.8 — seed ne pregazi sveže audite:** `existingAudits` sada čita i `enriched_at`;
  seed upisuje osnovni audit samo tamo gde ga nema ili gde je arhiva novija. `audit_level
  > 1` se i dalje ne dira; svež level-1 audit iz rada više ne biva prepisan podacima iz
  avgusta (nalaz 5.3).
- **Limiter:** `/api/uvoz` i `POST /api/poruke/ai` su dobili IP tempo (Faza 1 obrazac).
- **Provere:** `check:sql` — blok „Faza 2": enqueue_job drugi upis → joined + isti
  job_id; outreach_messages dedup (dupli red odbijen, `on conflict do nothing` ne
  duplira).

### Šta se razišlo sa planom

1. **2.1 — paralelne grupe, ne batch RPC.** Plan nudi oba; izabrane su grupe od 30 jer
   batch RPC u SQL-u ne može da pozove postojeću kreditnu mašineriju bez dupliranja
   logike (a `enrich_full` enqueue ionako ide kroz red). Uz `otkljucajZaUvoz` (bez UI
   čitanja) 2000 redova staje u sekunde, daleko ispod 60 s.
2. **2.1/W2 — „ceo uvoz u jednoj transakciji" nije sprovedeno.** PostgREST nema
   transakciju preko više poziva, a job_queue varijanta je nesrazmerna beti. Umesto toga:
   retry je dokazano bezbedan (unlocks idempotentni po PK, statusi upsert — provereno i
   zapisano u kodu). Ono što ostaje je parcijalan rezultat na TVRDOM timeoutu (Vercel
   ubije funkciju, ne može se uhvatiti) — sa grupama od 30 je to praktično nestalo. Ako
   ikad zatreba sve-ili-ništa, put je job_queue posao, ne nova migracija.
3. **2.5 — dedup ključ bez vremenskog prozora.** Isti tekst kopiran NAMERNO drugi put za
   isti lead ne pravi nov red u arhivi. Retko (tekst se menja), a jedinstvenost je
   vrednija — zapisano u migraciji.
4. **2.8 — seed sada poredi `enriched_at` za level-1 audite**, ne samo `audit_level`.
   Plan pominje `audit_level > 1`; prošireno na svežinu jer je nalaz revizije bio o
   svežim level-1 auditima.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm test`, `pnpm build` prolaze. Nijedan nov
Places poziv; migracija 0019 ne dira nijedan podatak. **Ručne provere ostaju na meni:**

1. uvezi CSV sa 2000 redova (i sa `trosiKredite`) — izveštaj stiže za nekoliko sekundi,
   ne 60 s; pokreni isti uvoz drugi put — broj otključanih se ne menja;
2. uvezi CSV posle ispražnjenog balansa — `bezKredita` raste, uvoz staje, nijedan kredit
   ne ide ispod nule;
3. dva brza POST-a na `/api/search` za istu kombinaciju koja se prvi put skenira — oba
   dobiju isti `jobId`, nijedan 500;
4. dupli klik na „Kopiraj" — jedan red u `outreach_messages`; ponovljen `rewrite_message`
   posao — jedan AI red;
5. uvezi CSV pa izmeni `enriched_at` na svež audit (level 1) i ponovi seed — audit ostaje;
6. `/api/poruke/ai` GET sa jobId drugog posla (drugi placeId) — 404, ne tuđa poruka.

### Prompt (za sledeću sesiju — Faza 3, performanse)

```
Radimo Fazu 3 iz docs/PLAN-IZMENA.md (performanse). Pročitaj prvo CLAUDE.md,
docs/PLAN-IZMENA.md, docs/REVIZIJA.md (odeljak 6) i odeljak „S10 — Faza 2" u
docs/SESIJE.md. Ne diraj Fazu 4 (UX) ni Fazu 5 (dizajn sistem).

Zatečeno stanje: S1–S10 gotovi (F11/F12, Faze 0–2). Migracije idu do 0019; sledeća
je 0020. `.in()` je već u grupama (2.2); `lib/upiti.ts` ima `inGrupe`.

Stavke Faze 3:
3.1 signedScreenshots: false za CSV izvoz; lenjo potpisivanje za /lista —
    lib/moja-lista.ts, lib/export.ts. Izvoz bez ijednog Storage poziva.
3.2 Worker upisuje found/analyzed na red posla → polling je jedan upit —
    migracija + jobs/scan.ts + lib/jobs.ts. Polling s backoffom (3 s → 10 s).
3.3 search_cache brojači umesto pogleda — migracija + record_scan + upis audita.
3.4 Pretraga: filter/sort u SQL-u ili keš stranice 30 s — migracija + lib/search.ts.
3.5 Indeksi: credit_ledger (user_id, created_at desc), admin_audit (actor_id,
    created_at desc), businesses (city_slug) — migracija.
3.6 Suspense + skeletoni; feedback-engine čitanja van blokirajućeg puta layout-a —
    (app)/layout.tsx, stranice.

Gotovo kad: polling jednog scana troši < 60 upita (danas ~180); izvoz i pretraga ne
potpisuju nepotrebno; EXPLAIN na glavnim upitima bez seq scan-a.

```

---

## S11 — Faza 3: performanse ☑ isporučeno

Rad iz `docs/PLAN-IZMENA.md`, Faza 3. Zatvara nalaze P1–P4 i P6–P8 iz revizije.

### Šta je isporučeno

- **3.1 — izvoz bez Storage poziva (P1):** `getMojaLista(filter, { potpisi: false })`;
  CSV izvoz više ne potpisuje screenshotove (izvoz 2000 redova = nula Storage
  poziva). `/lista` i kanban potpisuju i dalje, jednim `createSignedUrls`.
- **3.2 — polling posla = 1 upit (P3):** migracija 0020 dodaje `job_queue.found/
  analyzed` + RPC `get_job_for_user(p_job_id, p_user)` (pretplata + red u istoj
  transakciji) + `inkrementiraj_analizu`. Worker upisuje `found`/`analyzed` na
  kraju scana (početno `analyzed` = već postojeći auditi), a svaki `enrich_basic`
  koji upiše audit diže `analyzed` roditeljskog posla (`scanJobId` u payloadu,
  opciono — CLI i ručno pokretanje ga nemaju). `getJobForUser(userId, jobId)` u
  web-u zove RPC; rute `job/[id]` i `poruke/ai` prosleđuju identitet. Polling u
  `pretraga-ekran` dobija backoff 3 s → 10 s.
- **3.3 — brojači keša umesto pogleda (P6):** `search_cache.total/no_site` +
  trigger na `website_audits` (osvežava oba brojača pri svakoj izmeni
  `site_status`) + `record_scan` (upisuje početno stanje). `search_cache_state`
  i `search_cache_overview` čitaju brojače; pogled `search_cache_stats` je
  OBRIŠAN — puna agregacija po zahtevu više ne postoji ni kroz jedan put.
- **3.4 — pretraga u SQL-u (P2):** RPC `search_listing` — filter (toggle-i +
  minScore), sort (status, pa skor desc nulls last, pa ime, pa place_id) i
  LIMIT/OFFSET u jednom upitu, sa agregatima cele filtrirane kombinacije kroz
  window funkcije (`count(*) over ()`). `searchCachedLeads` više ne povlači 1200
  redova ni ne sortira u JS-u — stiže samo tražena stranica; `FETCH_CAP` je
  uklonjen.
- **3.5 — indeksi (B7–B9):** `credit_ledger (user_id, created_at desc)`
  (zamenjuje stari `(user_id)`), `admin_audit (actor_id, created_at desc)`,
  `businesses (city_slug)`.
- **3.6 — prvi bajt bez feedback upita (P4):** layout više ne čeka
  `citajStanjeMotora` + `citajUslove` — `UtisciProvider` ih povlači klijentski,
  sa nove rute `GET /api/utisci/stanje`, posle prvog prikaza. Isti broj upita,
  samo posle prvog bajta; dok stanje ne stigne, motor ne donosi nijednu odluku
  (nema pitanja na osnovu praznog stanja).
- **Provere:** `check:sql` — blok „Faza 3": get_job_for_user (pretplaćeni vidi,
  nepretplaćeni ništa, found/analyzed sa reda, inkrement), search_cache brojači
  (record_scan + trigger), search_listing (agregati, filter). Tri nove funkcije
  u listi prava.

### Šta se razišlo sa planom

1. **3.4 — izabran je SQL listing, ne keš stranice 30 s.** Keš u serverless-u je
   per-instanca i nepouzdan; SQL put je robustan i ujedno rešava „total" i
   sumar. Sort je isti kao u TS-u, samo je konačni razvezivač `place_id`
   umesto `localeCompare` — redosled stranica ostaje stabilan.
2. **3.3 — brojače održava i trigger, ne samo `record_scan`.** Bez toga bi
   `no_site` bio zamrznut na stanje poslednjeg scana, a auditi (koji stižu POSLE
   scana) ga menjaju — kes-lista bi pokazivala „0 bez sajta" za kombinaciju koja
   ih ima 20. Trigger preračunava i `total` i `no_site` pri svakoj izmeni
   `site_status`; brojači su tako uvek konzistentni sa stvarnim stanjem.
3. **3.6 — Suspense/skeletoni po stranama nisu rađeni.** Jezgro (prvi bajt bez
   feedback upita) jeste; same stranice su serverske komponente sa brzim
   upitima (indeksi iz 3.5) i u „Gotovo kad" Faze 3 ih nema. Ako se pokaže
   potreba, ide uz Fazu 4 (UX).
4. **`isSubscribed` je uklonjen iz `lib/jobs.ts`** — pretplatu sada proverava
   RPC (isti uslov, ista politika, jedan upit).

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm test`, `pnpm build` prolaze. Nijedan
nov Places poziv. **Ručne provere ostaju na meni:**

1. pokreni scan i gledaj mrežu: `/api/job/:id` je jedan zahtev po krugu, a
   krugovi se razređuju (3 s → 10 s); traka napretka i dalje raste kako auditi
   stižu;
2. `/lista` i CSV izvoz: u Network tabu izvoz nema nijedan poziv ka Storage-u;
3. otvori Pretragu za veliki grad — prvi bajt stiže odmah, brojevi (total,
   „bez sajta") tačni; pređi na stranu 2 i nazad — stabilan redosled;
4. otvori bilo koju stranu — feedback pitanja se i dalje javljaju (sad posle
   prvog prikaza, klijentski); `EXPLAIN` na `search_listing`, `credit_ledger`
   po korisniku i `admin_audit` po akteru — bez seq scan-a.

### Prompt (za sledeću sesiju — Faza 4, UX)

```
Radimo Fazu 4 iz docs/PLAN-IZMENA.md (UX). Pročitaj prvo CLAUDE.md,
docs/DIZAJN-SISTEM.md, docs/PLAN-IZMENA.md, docs/REVIZIJA.md (odeljak 7) i
odeljak „S11 — Faza 3" u docs/SESIJE.md. Ne diraj Fazu 5 (dizajn sistem).

Zatečeno stanje: S1–S11 gotovi (F11/F12, Faze 0–3). Migracije idu do 0020;
sledeća je 0021 (verovatno nije ni potrebna za ovu fazu — sve je komponentno).

Stavke Faze 4:
4.1 „Premesti u…" u kanban kartici (touch/tastatura rezerva) — pipeline-tabla.tsx.
4.2 Sinhronizacija redovi ← kartice prop — pipeline-tabla.tsx:53.
4.3 Stanje pretrage u URL-u (?grad=&nisa=&bezSajta=1&strana=) + Back —
    pretraga-ekran.tsx.
4.4 Reset poslednji/data pri promeni comboboxa — pretraga-ekran.tsx:152.
4.5 Polling timeout → osveziKes() + dugme „Proveri ponovo" — pretraga-ekran.tsx:420.
4.6 Poruka o otključavanju uz tabelu (ili scrollIntoView) — pretraga-ekran.tsx:682.
4.7 Onboarding „Prvi koraci" na dashboard — dashboard/page.tsx.
4.8 A11y: role=alert, aria-activedescendant, aria-expanded, roving tabindex —
    ui/alert.tsx, combobox.tsx, kes-lista.tsx, prekidac-teme.tsx.
4.9 Beleška u kanbanu: Esc otkazuje — pipeline-tabla.tsx:355.
4.10 „Snimak se pravi" ≠ „nije dostupan" — snimak.tsx:146.
4.11 Polling pauza na skriveni tab — pretraga-ekran.tsx, poruke-panel.tsx.

Gotovo kad: sve stavke iz §7 REVIZIJA zatvorene; obe teme i telefon
(≤ 390 px) vizuelno provereni. typecheck, check:sql, test prolaze.

Kad završiš: prođi kroz listu „Kraj svake sesije", ažuriraj docs/SESIJE.md
(S12 — Faza 4) i napiši mi prompt za Fazu 5.
```

