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

