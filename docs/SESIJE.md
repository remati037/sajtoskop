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
| S12 | Faza 4 — UX | `PLAN-IZMENA.md` | — | 2–3 dana | ☑ |
| S13 | Faza 5 — dizajn sistem | `PLAN-IZMENA.md` | — | 0,5–1 dan | ☑ |
| S14 | Faza 6 — baza, zadržavanje, higijena | `PLAN-IZMENA.md` | `0021` | 1 dan | ☑ |
| S15 | Faza 7 — testovi i kvalitet | `PLAN-IZMENA.md` | — | 1 dan | ☑ |
| S16 | Novčanik, planovi i paketi kredita | `LANSIRANJE.md` | `0022` | 1,5 dana | ☑ |
| S17 | Dubina skeniranja i cena po stranici | `LANSIRANJE.md` | `0023` | 1 dan | ☑ |
| S18 | Paddle webhook, serverski checkout, kupon | `LANSIRANJE.md` | — | 1,5 dana | ☑ |
| S19 | Životni ciklus pristupa | `LANSIRANJE.md` | — | 1,5 dana | ☑ |
| S20 | Admin konzola: beta nalozi | `LANSIRANJE.md` | `0024` | 0,75 dana | ☑ |
| S21 | Cenovnik sa paketima, stanje pretplate, portal, linkovi | `LANSIRANJE.md` | — | 1 dan | ☑ |
| S22 | Pravni tekstovi i futer | `LANSIRANJE.md`, `F8-landing.md` §3 | — | 0,5 dana | ☑ |
| — | *Izmena posle S22: dva domena, onboarding kao faza, O1* | `LANSIRANJE.md` §1.7, §1.8 | — | — | ☑ |

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

### Popravke posle prve upotrebe

1. **CSP je blokirao Clerk JS.** Clerk 6 dinamički učitava `clerk-js` sa Frontend
   API domena (`https://<domen>/npm/@clerk/…`), a Faza 1 CSP je u `script-src`
   dozvoljavao samo `'self'` + `'unsafe-inline'` — sa custom domenom
   (`clerk.sajtoskop.com`) app se uopšte nije dizao („Failed to load Clerk JS").
   CSP sada izvlači Clerk domen iz `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   (dekoduje `pk_test_<base64>` u `<domen>$`) i ubacuje ga u `script-src`,
   `connect-src` (+`wss://`) i `img-src` — radi i za default instancu
   (`*.clerk.accounts.dev`) i za custom domen. Fallback kad ključ nedostaje:
   `*.clerk.accounts.dev` + `clerk.sajtoskop.com`.

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

```

---

## S12 — Faza 4: UX ☑ isporučeno

Rad iz `docs/PLAN-IZMENA.md`, Faza 4. Zatvara nalaze I1–I8 i §7 revizije. Nijedna
migracija — sve je komponentno.

### Šta je isporučeno

- **4.1 — „Premesti u…" u kanban kartici:** select sa pet kolona ispod svake
  kartice — ista `pomeri` funkcija kao prevlačenje (i „prvi potpisan" se javlja
  isto). Touch i tastatura menjaju status bez miša (nalaz 7.1.1).
- **4.2 — sinhronizacija `redovi` ← `kartice`:** `useEffect(() => setRedovi(kartice),
  [kartice])` — uvezeni prospekti se pojavljuju odmah, bez punog reloada (I1).
  Lokalne izmene ostaju (prop je izvor na svakom serverskom osvežavanju).
- **4.3 — stanje pretrage u URL-u:** `?grad=&nisa=&bezSajta=&strana=` — link se
  deli i vraća isti rezultat, Back prolazi kroz istoriju pretraga (I3). Pri
  montiranju se stanje čita iz URL-a i pretraga se pokreće bez modalnog prozora
  (plaćena kombinacija samo pokaže cenu).
- **4.4 — reset pri promeni comboboxa:** `promeniGrad`/`promeniNisu` brišu
  `poslednji` i `data` — forma i rezultati se ne razdesinhronizuju (I2).
- **4.5 — polling timeout:** na isteku se poziva `osveziKes()` (traka cene
  odražava stvarnost — kombinacija je možda sada besplatna) i `predugo` poruka
  dobija dugme „Proveri ponovo" koje ponovo prati posao bez plaćanja (nalaz
  7.1.3).
- **4.6 — neuspeh otključavanja uz tabelu:** posebno stanje `greskaOtkljuc`
  prikazuje poruku odmah iznad tabele, tamo gde je pogled korisnika (nalaz
  7.1.2).
- **4.7 — onboarding „Prvi koraci":** tri kartice na dashboard-u (izaberi grad i
  nišu → otključaj prvi prospekt → napiši prvu poruku), dok korisnik nema
  nijedan otključan prospekt (broj kroz RLS „own unlocks").
- **4.8 — A11y:** `Alert` danger → `role="alert"`, ostalo `role="status"`;
  combobox → `aria-activedescendant` + `id` na opcijama + izabrana vrednost
  vidljiva dok je query prazan; kes-lista sklopljeni red → `aria-expanded`;
  prekidač teme → roving tabindex (Tab u grupu, strelice menjaju temu).
- **4.9 — Esc otkazuje belešku u kanbanu:** tekst se vraća na staro i unos se
  zatvara bez upisa (nalaz 7.1.5).
- **4.10 — „Snimak se pravi" ≠ „nije dostupan":** ako je skup enrichment prošao
  (PSI/AI podaci postoje) a snimaka nema, oznaka kaže da nije dostupan — samo
  dok nema nikakvog enrichment podatka snimak stvarno može da bude u izradi
  (nalaz 7.1.4).
- **4.11 — polling pauza na skriveni tab:** `pratiPosao` i `sacekajPosao`
  (poruke) čekaju u tihim krugovima dok je `document.hidden` (P5).

### Šta se razišlo sa planom

1. **4.5 — „Proveri ponovo" ponovo poziva `pretrazi` (bez `pay`), ne
   `pratiPosao` sa čuvanim jobId.** Sa svežim kešom ili živim poslom isti
   rezultat, a bez dodatnog stanja u komponenti — `poslednji` zahtev je već tu.
2. **4.3 — upis u URL je `push`, ne `replace`.** `push` pravi istoriju pa Back
   radi kako treba (vraća se na prethodnu pretragu); svaka promena filtera je
   jedan unos u istoriju — prihvatljivo za ovu skalu.
3. **4.10 — „nije dostupan" se zaključuje iz PSI/AI polja**, kojih u
   `website_audits` nema signala o uspehu screenshot koraka posebno. PSI i AI se
   upisuju tek POSLE screenshotova (saveScreenshots → savePsi → saveAiAnalysis),
   pa njihovo prisustvo dokazano znači da je enrichment prošao do kraja.
4. **Vizuelna provera obe teme i telefona (≤ 390 px) ostaje na meni** — nije je
   moguće obaviti iz sesije bez pregledača.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm test`, `pnpm build` prolaze. Nijedna
migracija, nijedan nov Places poziv. **Ručne provere ostaju na meni:**

1. na telefonu (≤ 390 px): „Premesti u…" menja status bez prevlačenja; u pregledaču
   Esc otkazuje belešku;
2. uvezi CSV pa otvori pipeline — novi prospekti su tu bez reloada;
3. pretraži grad+nišu, promeni filter, klikni nazad — vraća se prethodna pretraga;
   kopiraj URL i otvori ga u drugom tabu — ista pretraga, ista strana;
4. promeni grad dok su rezultati prikazani — tabela se prazni, ne prikazuje stari
   grad;
5. prekini internet dok je scan u toku, pa vrati — po isteku čekanja „Proveri
   ponovo" vraća traku; traka cene je sveža (osveziKes);
6. otključaj lead bez kredita — poruka je iznad tabele, ne na vrhu strane;
7. nov nalog: dashboard pokazuje „Prvi koraci" do prvog otključavanja;
8. čitač ekrana (VoiceOver/NVDA): greška se najavljuje kao alert, combobox čita
   aktivnu opciju, tema se menja strelicama.

### Prompt (za sledeću sesiju — Faza 5, dizajn sistem)

```
Radimo Fazu 5 iz docs/PLAN-IZMENA.md (dizajn sistem). Pročitaj prvo CLAUDE.md,
docs/DIZAJN-SISTEM.md, docs/PLAN-IZMENA.md, docs/REVIZIJA.md (odeljak 8) i
odeljak „S12 — Faza 4" u docs/SESIJE.md. Ne diraj Fazu 6 (baza) ni Fazu 7
(testovi).

Zatečeno stanje: S1–S12 gotovi (F11/F12, Faze 0–4). Nijedna migracija ne
sledi za ovu fazu osim ako se ne pokaže potreba.

Stavke Faze 5:
5.1 shadow-accent samo na primarnom dugmetu — pretraga-ekran.tsx:1021,
    lead-tabela.tsx:116, moja-lista-ekran.tsx:162.
5.2 Jedno primarno „Kopiraj" po dijalogu — poruke-panel.tsx:422-441.
5.3 .num na datumima i URL-ovima — krediti, moja-lista-ekran, pipeline-tabla,
    lead-tabela, snimak.
5.4 text-accent-text umesto text-accent na ikonicama — snimak.tsx:308,
    poruke-panel.tsx:430.
5.5 StatKartica opciona `num` — ui/stat.tsx, dashboard.
5.6 Kes-lista bez ugnježđenog okvira — kes-lista.tsx:203.
5.7 Dokumentovati radijus odstupanje u CLAUDE.md — CLAUDE.md + globals.css.

Gotovo kad: dizajn sistem bez odstupanja (osim dokumentovanih); grep provera
nema hex u JSX-u. typecheck, check:sql, test prolaze.

```

---

## S13 — Faza 5: dizajn sistem ☑ isporučeno

Rad iz `docs/PLAN-IZMENA.md`, Faza 5. Zatvara nalaze D1–D8 iz revizije. Nijedna
migracija.

### Šta je isporučeno

- **5.1 — `shadow-accent` samo na primarnom dugmetu (D3):** skinut sa filter
  čipa „Bez funkcionalnog sajta" (`moja-lista-ekran`), toggle čipova filter trake
  (`pretraga-ekran`) i hover-a dugmeta „Otključaj" (`lead-tabela`). Stanja sada
  nose obod i podloga; `ui/button.tsx` je jedini koji ga koristi.
- **5.2 — jedno primarno „Kopiraj" po dijalogu (D4):** `PorukaBlok` dobija
  `primarno` prop — glavna (šablonska) poruka je primary, follow-up i AI
  varijanta su outline.
- **5.3 — `.num` na datumima i URL-ovima (D1, D2):** krediti (datum), moja-lista
  (mejl, sajt, datum otključavanja), lead-tabela (mejl, sajt; telefon je već
  imao), pipeline-tabla (datum kontakta), snimak (sajt u preklopu).
- **5.4 — `text-accent-text` na ikonicama (D6):** Check ikonice u `snimak` i
  `poruke-panel` — zelena kao tekst isključivo kroz `--accent-text`.
- **5.5 — `StatKartica` opciona `num` (D7):** dashboard kartica „Plan" (vrednost
  „beta") je bez `.num`; cifre i dalje imaju istu širinu.
- **5.6 — kes-lista bez ugnježđenog okvira (D8):** unutrašnji spisak je samo
  `divide-y` — ivicu nosi spoljna kartica.
- **5.7 — radijus odstupanje dokumentovano (D5):** tablica „Odstupanja od
  dokumenta" u CLAUDE.md dobila red o `--r-sm/--r/--r-lg` → `--radius-*`
  mapiranju i postojanju `--radius-sm/md`.

### Šta se razišlo sa planom

Ništa bitno — svih sedam stavki je urađeno kako je planirano. Napomena: `5.3` je
pokrio i mejl linkove (nisu URL ali su adrese — ista logika `.num`-a).

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm test`, `pnpm build` prolaze.
`grep -rn "shadow-accent" apps/web/src` pokazuje samo `ui/button.tsx`.
**Vizuelna provera obe teme i telefona (≤ 390 px) ostaje na meni.**

### Prompt (za sledeću sesiju — Faza 6, baza i higijena)

```
Radimo Fazu 6 iz docs/PLAN-IZMENA.md (baza, zadržavanje, operativna higijena).
Pročitaj prvo CLAUDE.md, docs/PLAN-IZMENA.md, docs/REVIZIJA.md (odeljak 9 i 11) i
odeljak „S13 — Faza 5" u docs/SESIJE.md. Ne diraj Fazu 7 (testovi) — osim ako
sama faza ne zatraži proveru.

Zatečeno stanje: S1–S13 gotovi (F11/F12, Faze 0–5). Migracije idu do 0020;
sledeća je 0021.

Stavke Faze 6:
6.1 Odluka o per-redu TTL-u (B1) + primera (filter ili oznaka) — lib/search.ts,
    moja-lista.ts, poruke.ts + SESIJE zapis.
6.2 Prekid kaskade website_audits/signed_events od businesses (restrict) — migracija.
6.3 Nedeljni cron čišćenja: job_queue > 30 dana, searches > 90 dana,
    api_budget > 3 meseca — novi /api/cron/cistka + vercel.json.
6.4 partial zastavica u search_cache — migracija + scan.ts + UI oznaka.
6.5 CHECK-ovi: rating ≤ 5, http_status 100–599, signed_events.country_code —
    migracija.
6.6 Tipovi: JobQueueRow.dedupe_key, JobSubscriberRow — packages/shared/src/db.ts.
6.7 validate-migrations.ts: RLS lista + lead_status/outreach_messages/
    signed_events.
6.8 pg_dump backup skripta (cron na Hetzneru, 7 dana, offsite) — scripts/ +
    komentar u docker-compose.yml.
6.9 npm audit --prod u CI + Dependabot — .github/workflows/ci.yml +
    .github/dependabot.yml.

Gotovo kad: check:sql prolazi sa novim migracijama; backup skripta isprobana;
CI ima audit korak. typecheck, check:sql, test prolaze.

```

---

## S14 — Faza 6: baza, zadržavanje, operativna higijena ☑ isporučeno

Rad iz `docs/PLAN-IZMENA.md`, Faza 6. Zatvara nalaze B1, B2, B5, B6, B7–B10 i
B12 iz revizije.

### Šta je isporučeno

- **6.1 — per-red TTL (B1), ODLUKA: opcija (b).** `search_listing` dobija
  `p_ttl_days` (30, `GOOGLE_TTL_DAYS`) i filter
  `google_refreshed_at >= now() - 30 dana`: kombinacija može da bude sveža a
  neki njeni redovi stari (biznis koji je poslednji scan ispustio) — oni ne
  izlaze iz pretrage. **Otključani prospekti su svesno izuzeti** (moja-lista,
  poruke): to su kupovani podaci korisnika i ne nestaju posle 30 dana; njihova
  svežina se obnavlja kroz `refresh_google` posao. Zapisano ovde i u migraciji.
- **6.2 — prekid kaskade (B2):** `website_audits.place_id` i
  `signed_events.place_id` → `on delete restrict`. Biznis sa auditom ili
  potpisom se ne može obrisati kaskadom; `businesses` redovi se ionako nikad ne
  brišu (komentar u migraciji).
- **6.3 — nedeljno čišćenje (B6):** `cistkaZastarelo()` u workeru
  (`db-writes.ts`) — `job_queue` done/failed stariji od 30 dana, `searches`
  stariji od 90, `api_budget` stariji od 3 meseca; pokreće se iz reaper petlje
  jednom nedeljno (Vercel Hobby ima samo dva cron slota, oba zauzeta). Knjiga
  `credit_ledger` se ČUVA.
- **6.4 — `partial` u `search_cache` (B5):** kolona + `record_scan(p_partial)`;
  worker je prosleđuje kad budžet stane usred scana. Oznaka „delimično" u
  kes-listi (bezbednosno — parcijalan rezultat ne izgleda kao potpun). Oblik
  `search_cache_state`/`search_cache_overview` se NE menja (0009 ih ponovo
  kreira u check:sql), pa web čita zastavicu direktno iz tabele.
- **6.5 — CHECK-ovi (B10):** `businesses.rating <= 5`, `website_audits.
  http_status` 100–599, `signed_events.country_code ~ '^[A-Z]{2}$'`.
- **6.6 — tipovi (B11):** `JobQueueRow.dedupe_key` + `found`/`analyzed`,
  `JobSubscriberRow` u `packages/shared/src/db.ts`.
- **6.7 — validate-migrations (B12):** RLS lista dobija `lead_status`,
  `outreach_messages`, `signed_events`.
- **6.8 — backup:** `scripts/backup.sh` — dnevni `pg_dump` (read-only,
  `--no-owner --no-privileges`), 7 kopija, uputstvo za off-site; komentar u
  `apps/worker/docker-compose.yml`.
- **6.9 — zavisnosti:** `pnpm audit --prod` u CI (informativno) +
  `.github/dependabot.yml` (nedeljno, grupisanje TypeScript alata).

### Šta se razišlo sa planom

1. **6.1 — izabrana je opcija (b) iz B1** (filter na `google_refreshed_at`), ne
   (c) („samo redovi koje je poslednji scan dirnuo"). (b) je najbezbednije po
   pravilo 1 i trivijalno se izvodi u SQL-u; (c) traži vezu red-scan koja ne
   postoji. Razlika u praksi je mala — red koji je poslednji scan ispustio ima
   star `google_refreshed_at` i ispadne pod (b).
2. **6.3 — čišćenje živi u workeru, ne u `/api/cron/cistka`.** Hobby plan
   dozvoljava dva crona i oba su zauzeta (digest + nedeljni izveštaj); worker
   već ima reaper petlju i radi na Hetzneru non-stop.
3. **6.4 — `partial` ne menja oblik RPC funkcija** (v. iznad); web ga čita
   direktno iz `search_cache`. Cena: jedan mali upit po `/api/search` i po listi
   keša — prihvatljivo naspram lomljenja idempotencije migracija.
4. **6.8 — backup skripta je isporučena ali nije isprobana na pravom
   `DATABASE_URL`-u** (nema ga lokalno). Ostaje kao ručni korak.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm test`, `pnpm build` prolaze.
**Ručni koraci ostaju na meni:**

1. `scripts/backup.sh` nad pravim `DATABASE_URL`-om — dump + 7 kopija;
2. postavi cron na Hetzneru (primer u skripti) i rclone za off-site;
3. parcijalan scan (isprazni dnevni budžet usred rada) — kes-lista pokazuje
   „delimično", a sledeći pun scan skida oznaku;
4. proveri da obrisan biznis (ručno, ako ikad) sada puca umesto da obriše
   audite i potpise.

### Prompt (za sledeću sesiju — Faza 7, testovi i kvalitet)

```
Radimo Fazu 7 iz docs/PLAN-IZMENA.md (testovi i kvalitet). Pročitaj prvo
CLAUDE.md, docs/PLAN-IZMENA.md, docs/REVIZIJA.md (odeljak 10) i odeljak „S14 —
Faza 6" u docs/SESIJE.md. Ovo je poslednja faza plana.

Zatečeno stanje: S1–S14 gotovi (F11/F12, Faze 0–6). Migracije idu do 0021.

Stavke Faze 7:
7.1 Test za trke: spend_credit_and_scan (dupli prvi scan), admin_adjust_credits
    (idempotencija), enqueue_job (unique_violation) — kroz
    scripts/validate-migrations.ts ili PGlite testove.
7.2 Test za ideOdmah granu (bug/ocena 1/incident) posle izmene 1.5.
7.3 ESLint + eslint-config-next (flat) u CI.
7.4 CI garancija da ugly-score ne uđe u bundle (grep nad .next/static).
7.5 apps/web/.clerk/ u .gitignore.

Gotovo kad: pnpm test pokriva novčane trke; pnpm lint prolazi; CI dokazuje da
težine nisu u bundle-u. typecheck, check:sql, test prolaze.

```

---

## S15 — Faza 7: testovi i kvalitet ☑ isporučeno

Rad iz `docs/PLAN-IZMENA.md`, Faza 7 — poslednja faza plana. Zatvara nalaze
SH1–SH3 i 11.8 iz revizije.

### Šta je isporučeno

- **7.1 — trke nad novcem:** blok „Faza 7 — trke nad novcem" u `check:sql`:
  dupli prvi scan (`spend_credit_and_scan` → `already_paid`, isti job, jedan
  kredit), `enqueue_job` isti ključ → isti job + joined, `admin_adjust_credits`
  isti ref_id → jedna stavka u knjizi. PGlite ima jednu konekciju, pa pravi
  paralelizam pokriva `pnpm check:f4` nad pravom bazom (postojeći skript).
- **7.2 — `ideOdmah` test:** novi `apps/web/test/ide-odmah.ts` (pokreće se kroz
  `pnpm --filter web test`) — bug, ocena 1 i incident idu odmah; pohvala i
  ideja čekaju digest. Učitava PRAVU funkciju iz `lib/feedback.ts` kroz resolve
  hook koji zamenjuje Next module (isti mehanizam kao route-harness).
- **7.3 — ESLint:** `eslint@^9` + `eslint-config-next@^15` + `@eslint/eslintrc`
  (FlatCompat) u `apps/web`; flat config `eslint.config.mjs`. `pnpm --filter web
  lint` prolazi sa 0 grešaka i 0 upozorenja. Isključeno pravilo
  `react/no-unescaped-entities` (pisano za engleski apostrof; srpski kopi koristi
  „…" navodnike — svesno, komentar u config-u). Lint korak je u CI. Usput
  uklonjen mrtav kod koji je lint otkrio (`isSubscribed`, neiskorišćeni importi).
- **7.4 — težine van bundle-a:** CI korak `grep -rq "scoreSite\|no_viewport"
  apps/web/.next/static` posle build-a — tree-shaking više nije garancija nego
  provera (SH1).
- **7.5 — `.clerk/` u `.gitignore`** (`apps/web/.clerk/`).

### Šta se razišlo sa planom

1. **ESLint 10 i eslint-config-next 16 su preskočeni.** `pnpm add` bez verzije
   dovlači najnovije — ESLint 10 puca na `eslint-plugin-react` (Next 15 radi sa
   ESLint 9), a config-next 16 je za Next 16. Zakucano je `eslint@^9` +
   `eslint-config-next@^15`.
2. **`verify-deps-before-run=false` je u korenom `.npmrc`.** pnpm 11 proverava
   sinhronizaciju node_modules pre svake komande i sam pokreće `pnpm install`;
   u headless okruženju taj automatski install puca na TTY pitanju o brisanju
   modules dir-a. U ovoj sesiji (sandbox) pnpm nije čitao `.npmrc`, pa su
   komande morale sa `pnpm_config_verify_deps_before_run=false` — na normalnoj
   mašini `.npmrc` radi sam.
3. **Nijedna migracija** — sve je config, CI i testovi.

### Provereno

`pnpm typecheck`, `pnpm check:sql`, `pnpm test` (sada 6 paketa sa ide-odmah
testom), `pnpm --filter web lint` (0/0) i `pnpm build` prolaze. CI: lint + grep
nad bundle-om + sve postojeće provere. **Ostaje na meni:** prvi `pnpm install`
na normalnoj mašini posle ovog commita (novi devDeps u `apps/web`), pa prvi
`pnpm lint` da potvrdi da flat config radi van sandbox-a.

---

## PLAN-IZMENA.md — kompletno ☑

Svih osam faza iz `docs/PLAN-IZMENA.md` je isporučeno: Faza 0 (worker novac i
pouzdanost), Faza 1 (bezbednost), Faza 2 (ispravnost), Faza 3 (performanse),
Faza 4 (UX), Faza 5 (dizajn sistem), Faza 6 (baza i higijena), Faza 7 (testovi i
kvalitet). Migracije 0017–0021; svaka faza je proverena (typecheck, check:sql,
test, build) i push-ovana posebnim commit-om.

Sledeći koraci više nisu u planu izmena — to su `docs/ROADMAP.md` (F8 landing,
naplata, region) i otvorene stavke koje su faze svesno ostavile (backup na
pravom serveru, vizuelne provere, pravni tekstovi).
```


---

## Posle S15 — plan do lansiranja je u `docs/LANSIRANJE.md`

`PLAN-IZMENA.md` je zatvoren. Sve što je ostalo — naplata (Paddle), F8 (landing, pravni
tekstovi, kanarinci, merenje), operativa i otvaranje bete — vodi se iz
**`docs/LANSIRANJE.md`**: odluke D1–D8, sesije **S16–S28** sa gotovim promptovima, ručni
koraci **R1–R28** i go/no-go lista.

Numeracija sesija se nastavlja odatle (S16 je sledeća). Pravilo ostaje isto: posle svake
isporuke se ažurira i ovaj fajl i tabela u `LANSIRANJE.md` §4.

---

## S16 — Novčanik, planovi i paketi kredita ☑

**Isporučeno 21. avgusta 2026.** Izvor: `docs/LANSIRANJE.md` §1.3–§1.5 i §6, sesija S16.
Migracija `0022_naplata.sql`. Nijedna ruta, nijedan webhook, nijedna komponenta i nijedna
kapija pristupa — to su S18, S19 i S21.

### Šta je urađeno

- **Polar je uklonjen u celosti.** Obrisan stub `app/api/billing/webhook/route.ts`,
  izbačen `@polar-sh/nextjs` iz `apps/web/package.json` i iz `pnpm-lock.yaml`
  (regenerisan kroz `pnpm install`, ne ručno), uklonjeni `POLAR_ACCESS_TOKEN` i
  `POLAR_WEBHOOK_SECRET` iz `.env`. `grep -ri polar` vraća samo `docs/`.
- **`docs/naplata-polar.md` → `docs/naplata-paddle.md`** (`git mv`, istorija sačuvana) sa
  blokom „Šta se promenilo prelaskom na Paddle" na vrhu. Ispravljen red o provajderu u
  `naplata-bez-firme.md` §2 i pokazivači na staro ime u `MEJLOVI-PLAN.md` i `LANSIRANJE.md`.
- **Migracija `0022_naplata.sql`** — dve kase kredita, tabele naplate, tri nova razloga u
  knjizi, `apply_subscription` / `apply_credit_pack`, dnevni cap na AI varijante.
- **`packages/shared/src/plans.ts` prepisan** — pet planova, Paddle katalog, budžetski kapovi.
- **`apps/web/src/lib/cenovnik.ts`** — pogodnosti se sada računaju iz `PLANS`.
- **`scripts/validate-migrations.ts`** — blok „S16 — novčanik i naplata", 46 provera.

### Odluke koje nisu bile doslovno u promptu

1. **Prag balansa je pomeren na `-1000`, `check` NIJE obrisan.** Povraćaj paketa čiji su
   krediti potrošeni traži negativan balans, ali brisanje `profiles_credits_nonneg` bi
   ukinulo P0-1 zaštitu na svakoj putanji. Prag je dvostruko od najvećeg dozvoljenog
   pojedinačnog podešavanja (500), pa `check` i dalje hvata odbegli skript.
   `credits_topup` ostaje na tvrdoj nuli.
2. **`admin_adjust_credits` je dobio šesti parametar `p_kind`** (`'korekcija'` /
   `'povracaj'`) sa podrazumevanom vrednošću, pa svaki postojeći pozivalac radi
   nepromenjeno. Razlog u knjizi ostaje `'admin'` — time `credit_ledger_grant_idem_idx`
   i dalje pokriva ovu putanju, a razlika se čuva u `admin_audit.payload`.
   Funkcija je zato `drop`-ovana i napravljena iznova; prava su joj vraćena eksplicitno.
3. **Kasu bira RAZLOG u telu `grant_credits`, ne parametar.** Parametar bi značio da
   odluku „ističe / ne ističe" donosi webhook — jedno mesto gde greška znači ili trajne
   kredite koje niko nije kupio, ili kupljene kredite obrisane prvom mesečnom dodelom.
   Samo `'credit_pack'` puni `credits_topup`.
4. **`pri_` ID-jevi su PRESELJENI iz `cenovnik.ts` u `plans.ts`, ne kopirani.** Prompt je
   tražio jedan izvor istine koji puca u typecheck-u; `packages/shared` ne sme da uvozi iz
   `apps/web`, pa je smer morao da se obrne. `cenovnik.ts` sada uvozi `PLAN_PRICE_IDS` i
   `CREDIT_PACKS`, a obrnute mape (`planForPriceId`, `creditsForPriceId`) se **grade iz**
   tih objekata umesto da se pišu ručno.
5. **Pogodnosti na karticama se računaju iz `PLANS`**, a ne prepisuju. Brojevi su se i
   ranije poklapali sa §1.3 (provereno red po red — v. „Provereno" niže), ali su stajali
   kao tekst na dva mesta. Sada `tsc` traži da plan postoji, a broj je isti po
   konstrukciji. Formatiranje hiljada je ručno, ne kroz `Intl` — isti string mora da
   ispadne i na serveru i u pregledaču, inače je to hydration mismatch nad ponudom.
6. **Dodat je i `release_ai_rewrite`, ne samo `claim_ai_rewrite`.** `claim_cache_miss` iz
   0003 ima svoj `release` baš zato što korisnik ne sme da izgubi dnevnu kvotu zbog pada
   koji nije njegov; par bez druge polovine bi tražio novu migraciju čim ga S21 zakači.
7. **`ProfileRow`, `CreditReason` i novi RPC tipovi su dopunjeni u `db.ts`.**
   `Record<CreditReason, string>` u `lib/ui-tekst.ts` je odmah pukao na tri nova razloga —
   to je i bila poenta tog tipa. Dodati su prevodi: „Dodela uz pretplatu", „Kupljen paket",
   „Dobrodošlica".

### Šta se razišlo sa promptom

**Tekst za `naplata-paddle.md` u promptu je bio zastareo.** Prompt je tražio da se napiše
da su „cene za Srbiju EUR override na zemlju `RS`", ali je odluka **P7** taj override
uklonila u celosti — i sam prompt to kaže tri reda iznad („Nema nijednog `RS` override-a").
Napisana je tačna verzija: RSD nije među 33 Paddle valute, override je bio ostatak
napuštenog pokušaja da cena bude u dinarima, i uklonjen je — **jedna EUR cena za ceo svet**.

### Provereno

`pnpm typecheck`, `pnpm check:sql` (dva prolaza, „Sve prošlo"), `pnpm test`,
`pnpm --filter web lint` (0/0) i `pnpm build` prolaze. `/api/billing/webhook` više nije u
listi ruta posle build-a.

Brojevi u `cenovnik.ts` provereni red po red naspram §1.3 **pre** izmene — sva tri plana su
se već poklapala (100/300/800 kredita, 30/60/120 skeniranja, 5/20/60 AI varijanti,
500/2.000/10.000 CSV redova). Obe izmene u ponudi iz §1.3 su takođe već bile unete:
„AI poruke po kanalu" nije bilo u spisku, a Advanced je već pisao „10.000 redova dnevno".

### Ostaje na meni

- **`pnpm check:f4` nad PRAVOM bazom** — menjana je novčana putanja
  (`spend_credit_and_unlock`, `spend_credit_and_scan`, `grant_credits`,
  `admin_adjust_credits`). PGlite ima jednu konekciju i pravu trku ne može da izvede;
  test „20 paralelnih unlockova sa 1 kreditom → tačno jedan uspeh" mora preko `check:f4`.
- **Pustiti `0022` na Supabase-u** pre S17.

### Preneto dalje

- **S17:** `SCAN_CREDIT_COST` je i dalje `1`, namerno — UI na ~10 mesta tvrdo piše
  „1 kredit" i menja se zajedno sa cenom. Uz to: kolona sa brojem stranica u
  `search_cache` i dubina u ključu deduplikacije (§1.2).
- **S18:** webhook zove `apply_subscription` / `apply_credit_pack`, koje već postoje i već
  su idempotentne po Paddle transaction ID-ju. `planForPriceId()` i `creditsForPriceId()`
  su tu za preslikavanje `pri_` → plan / broj kredita.
- **S19:** `beta_expires_at`, `plan_expires_at` i `GRACE_DAYS` postoje, ali ih niko ne
  čita. `stanjePristupa()` je S19.
- **S21:** `/krediti`, `/dashboard` i admin ekran korisnika i dalje prikazuju samo
  `credits_balance`, a prikazano stanje treba da bude **zbir obe kase**. Dok webhook ne
  postoji, `credits_topup` ne može biti različit od nule — ali ovo mora PRE S18.
- **Poznata posledica, zapisana namerno:** `grant_monthly_credits` POSTAVLJA balans, pa
  prva sledeća mesečna dodela briše negativan balans nastao povraćajem. Dug traje najviše
  do kraja meseca. To je cena odluke iz §1.4 da ta funkcija ostane nepromenjena; ako se
  pokaže kao stvaran problem, rešenje je zasebna kolona duga, a ne izmena te funkcije.

---

## S17 — Dubina skeniranja i cena po stranici ☑

**Isporučeno 20. avgusta 2026.** Izvor: `docs/LANSIRANJE.md` §1.2 i §6, sesija S17.
Migracija `0023_dubina_skeniranja.sql`. Webhook, kapija pristupa i ekran cenovnika nisu
dirani — to su S18, S19 i S21.

**Cilj, ispunjen:** 1 kredit = 1 stranica rezultata = 1 Places poziv.

| Dubina | Prospekata | Stranica | Kredita |
|---|---|---|---|
| Brzo | do 20 | 1 | 1 |
| Standardno *(podrazumevano)* | do 40 | 2 | 2 |
| Duboko | do 60 | 3 | 3 |

### Šta je urađeno

1. **`packages/shared/src/plans.ts`** — `SCAN_CREDIT_COST` obrisan. Umesto njega:
   `stranicaZaRezultate()` / `cenaSkeniranja()` (totalne nad bilo kojim brojem),
   tip `Dubina` sa tri člana, `DUBINA_OPIS`, `DUBINE`, `PODRAZUMEVANA_DUBINA`,
   `cenaDubine()`, `maxRezultataZaDubinu()`, `dubinaZaRezultate()`, `dubinaIli()`.
   `PLACES_PAGE_SIZE` i `PLACES_MAX_PAGES` **preseljeni iz `places.ts`** — nisu kopirani.
   `scansPerMonth` u modelu nikad nije ni postojao (S16 ga nije ostavio); `cacheMissPerDay`
   ostaje kao dnevni osigurač sa vrednostima iz §1.3.
2. **Migracija `0023`** — `spend_credit_and_scan` izvodi cenu iz broja stranica, meri je
   nad zbirom obe kase i nosi dubinu u ključu deduplikacije (`RS:grad:nisa:p2`);
   `search_cache.pages` sa `check (pages between 1 and 3)` i backfillom iz
   `last_results_count`; `record_scan` prima sedmi argument `p_pages`; `refund_scan` čita
   iznos iz `credit_ledger` i vraća tačno onoliko koliko je naplaćeno.
3. **Web** — segmentna kontrola sa tri opcije po obrascu prekidača ciklusa iz
   `cenovnik-ekran.tsx`, stanje dubine u URL-u (`?dubina=`), četvrti razlog naplate
   (`plice`) kroz traku cene i modal, dubina uz svaki red u listi keša.
   **Nijedan „1 kredit" o skeniranju nije ostao** — ni u `pretraga-ekran.tsx`, ni u
   `skeniranje-modal.tsx`, ni na `/dashboard`, ni u bočnoj traci.
4. **Worker** — `searchText` staje na PLAĆENOM broju stranica; `record_scan` dobija dubinu
   iz `scan` i iz `refresh_google`.
5. **CLI** — nov `--dubina`, a `--broj` se normalizuje kroz isti `stranicaZaRezultate`.
   Ispisuje koliko bi izabrani obim koštao u aplikaciji. `seed.ts` upisuje `pages`.
6. **Testovi** — 33 nove provere u `check:sql` (blokovi „S17 — dubina skeniranja" i
   „S17 — keš pamti dubinu") i nov `apps/web/test/dubina.ts` sa 25 provera.

### Odluke koje nisu bile doslovno u promptu

1. **I `Dubina` I `cenaSkeniranja()`, ne jedno ili drugo.** Prompt je tražio da se predloži
   oblik. Cena je funkcija broja stranica i mora da bude totalna — worker dobija sirov
   `maxResults` iz payloada (uključujući `30` iz poslova upisanih pre S17), CLI ima
   slobodan `--broj`, a SQL prelazi istu formulu. Ali korisnik ne bira „37 rezultata":
   bira jednu od tri ponude, a ta ponuda ide u URL i mora da preživi Back i deljenje
   linka. Zato je `Dubina` **zatvoren skup** (token za UI i URL), a `DUBINA_OPIS[d].maxResults`
   je samo IMENOVANA vrednost iste funkcije — `dubinaZaRezultate` je njen inverz, pa dva
   izvora ne mogu da se raziđu.
2. **Kolona se zove `pages`, ne `depth`.** Nosi broj stranica, a to je istovremeno broj
   Places poziva i cena u kreditima. „Depth" bi bio naziv ponude — a ponuda se sme
   preimenovati i preurediti bez ijedne migracije dokle god je u bazi broj stranica.
3. **NIJEDNA funkcija ne menja povratni tip.** `spend_credit_and_scan`, `search_cache_state`
   i `search_cache_overview` prave 0009, 0020 i 0022 kroz `create or replace`; drugi prolaz
   `check:sql` bi na izmenjenom `returns table` pukao sa „cannot change return type of
   existing function". Zato se `pages` čita **iz kolone**, u `search-cache.ts` — isti
   obrazac kojim je 0021 uveo `partial`. `record_scan` sme da menja argumente jer se pre
   kreiranja eksplicitno `drop`-uje, i to je jedina funkcija koja to radi.
4. **`spend_credit_and_scan` NORMALIZUJE `maxResults` na `stranica × 20` pre upisa u
   payload.** Bez toga bi worker iz `maxResults: 45` izračunao 3 stranice, a naplaćeno bi
   bilo… takođe 3, ali samo slučajno. Ovako su plaćeno i skenirano isti broj po
   konstrukciji.
5. **`searchText` sada staje na plaćenom broju stranica, ne na `MAX_PAGES`.** Ovo je jedina
   izmena koja je stvarno zaustavila skeniranje dublje od plaćenog: petlja je išla do 3 i
   izlazila tek na `out.length >= maxResults`, a taj uslov se proverava POSLE poziva — scan
   za 20 rezultata je umeo da povuče drugu stranicu ako je Google na prvoj vratio 19
   (firma van grada, duplikat po `place_id`). Jedna stranica preko plaćenog je jedan
   Places poziv koji niko nije odobrio.
6. **Nov razlog naplate: `plice`.** Kombinacija koja JESTE u kešu i JESTE sveža, ali je
   skenirana pliće nego što se traži. To je jedini slučaj u kome se plaća a podaci nisu
   stari, pa rečenica govori o OBIMU: „U kešu je samo 1 stranica — duboko košta 3 kredita".
   „Stariji od 30 dana" bi tu bio prosto netačan.
7. **Klik na red u listi keša SPUŠTA izabranu dubinu na keširanu.** Lista se zove
   „besplatne pretrage" i klik na red koji piše „besplatno do 11.09." ne sme da otvori
   modal sa računom — a otvorio bi ga zbog prekidača koji korisnik nije ni dodirnuo.
   Prekidač se pri tome vidljivo pomeri, pa je promena očigledna.
8. **Promena dubine briše rezultate**, kao promena grada (Faza 4, 4.4), i **ne pokreće**
   novu pretragu. Tabela sa 20 redova ispod prekidača na kome piše „Duboko · do 60" bi
   tvrdila da je to duboka lista; a automatska pretraga bi značila da se plaća pomeranjem
   prekidača.
9. **Podrazumevana dubina se ne upisuje u URL.** `?grad=…&nisa=…` ostaje kratak link koji
   je i do sada radio i znači tačno ono što je i značio — 2 kredita.
10. **`budzetZaScan()` prima broj poziva.** Odbiti „Brzo" zato što u dnevnoj kvoti nema
    mesta za tri poziva značilo bi odbiti skeniranje koje bi stalo.
11. **`refund_scan` i dalje vraća BROJ PLATILACA, ne zbir kredita.** Oblik funkcije se ne
    dira (v. 3), a logovi u workeru koji su pisali „vraćeno N kredita" su ispravljeni u
    „kredit vraćen na N naloga" — od S17 iznos po platiocu nije uvek 1.
12. **Poruka o nedovoljnim kreditima nudi izlaz.** „Ovo skeniranje košta 3, a imaš 1. Za
    „Brzo" (1 kredit) ti je dovoljno ono što imaš." Ista logika u modalu i u traci cene.
13. **Prikazani balans na strani pretrage je ZBIR obe kase.** `route.ts` je čitao samo
    `credits_balance`, pa bi korisniku sa kupljenim paketom pisalo „nemaš dovoljno" iako
    `spend_credit_and_scan` meri nad zbirom. Ovo je bio zaostatak iz S16 („Preneto u S21"),
    ali na putanji koja odlučuje o naplati nije smeo da sačeka.
14. **Pad čitanja `pages` u `stanjeKesa` se NE guta**, za razliku od `partial`. `partial` je
    oznaka na ekranu; `pages` je polovina uslova naplate. Tiho `0` bi svaku pretragu
    proglasilo plaćenom, tiho `3` bi dublji zahtev nad plitkim kešom pustio besplatno.
    U `listaKesa` se pad i dalje guta — ta lista ništa ne naplaćuje.

### Šta se razišlo sa promptom

**Funkcija u `places.ts` se zvala `pagesNeeded`, ne `stranicaZaRezultate`.** Prompt je
naveo srpsko ime; u kodu je stajalo englesko. Preseljena je u shared pod imenom
`stranicaZaRezultate` — `plans.ts` već ima `Ciklus` i `PaketId`, pa je to ime lokalnoj
konvenciji tog fajla bliže od `pagesNeeded`.

**`scansPerMonth` nije postojao.** Prompt je tražio da se ukloni „ako je S16 ostavio" —
nije ga ostavio, u `plans.ts` ga nikad nije ni bilo. Ništa nije uklonjeno.

**Spisak „1 kredit" mesta iz prompta je bio nepotpun.** Grep je našao i tri van
`pretraga-ekran.tsx`: dva na `/dashboard` i jedno u bočnoj traci (`okvir-aplikacije.tsx`).
Sva tri su ispravljena.

### Provereno

`pnpm typecheck`, `pnpm check:sql` (dva prolaza, „Sve prošlo" — 33 nove provere),
`pnpm test`, `pnpm --filter web lint` (0/0) i `pnpm build` prolaze.

Provere koje pokrivaju baš ono što je prompt tražio: 1/2/3 stranice → 1/2/3 kredita
(mereno i u knjizi i u balansu); dupli klik na istu dubinu → jedna naplata; dva korisnika
sa različitim dubinama → dva posla i dva različita iznosa; keš dubine 1 + zahtev dubine 3
→ naplata, keš dubine 3 + zahtev dubine 1 → besplatno; `refund_scan` vraća 3 za posao
naplaćen 3; nedovoljno kredita za „Duboko" a dovoljno za „Brzo" → uredna poruka i uspešno
plitko skeniranje.

### Ostaje na meni

- **`pnpm check:f4` nad PRAVOM bazom** — opet je dirana novčana putanja
  (`spend_credit_and_scan`, `refund_scan`). PGlite ima jednu konekciju i pravu trku ne
  može da izvede.
- **Pustiti `0023` na Supabase-u** pre S18.
- Proći sekciju „Dubina skeniranja i cena po stranici (S17)" u `docs/PROVERA-VIZUELNA.md`,
  u obe teme.

### Preneto dalje

- **S21 (ekran cenovnika):** lede na `/cenovnik` i dalje treba da kaže da je kredit
  „prospekat ILI **stranica** skeniranja" — tekst je usklađen još u S16, ali sada iza njega
  stoji i kod. Ekran cenovnika u ovoj sesiji nije diran.
- **S21 (prikaz kredita):** `/krediti`, `/dashboard` i admin ekran korisnika i dalje
  prikazuju samo `credits_balance`. Strana pretrage je od S17 izuzetak (v. odluka 13) —
  ostala tri ekrana ostaju na S21.
- **Ako se ikad uvede četvrta ponuda:** menja se `DUBINA_OPIS` u `plans.ts`, `check` na
  `search_cache.pages`, i odsecanje u `stranicaZaRezultate` / `v_pages`. Ništa drugo —
  prekidač, URL, modal i traka cene se grade iz `DUBINE`.
- **`SCAN_DEEP=1` je jedini preostali put do skeniranja dubljeg od plaćenog.** Nije u
  payloadu i web ga ne može poslati, ali NIKAD ne sme da se uključi na mašini koja vrti
  poslove iz weba. Zapisano i u zaglavlju `apps/worker/src/jobs/scan.ts`.

---

## S18 — Paddle webhook, serverski checkout, kupon ☑

**Isporučeno 21. avgusta 2026.** Izvor: `docs/LANSIRANJE.md` §1.6 i §6, `docs/naplata-paddle.md`
§5, sesija S18. **Bez migracije** — `0022` je dao sve tabele i sve RPC-je. Kapije pristupa
(S19), admin konzola (S20) i UI cenovnika/pretplate (S21) nisu dirani.

**Cilj, ispunjen:** novac koji stigne u Paddle završi kao krediti na pravom nalogu, tačno
jednom, i to bez ijednog podatka o identitetu koji je prošao kroz pregledač.

### Šta je urađeno

1. **`packages/shared/src/plans.ts`** — dodat `kupovinaZaPriceId()` i tip `Kupovina`.
   `pri_` → `{ kind: "subscription", plan, ciklus, credits }` ili `{ kind: "pack", paket,
   credits }`, `null` za tuđ katalog. Postojali su `planForPriceId` i `creditsForPriceId`,
   ali je svaki pozivalac sam sklapao „ako nije plan, valjda je paket" — a to „valjda" je
   na novčanoj putanji. Sada checkout i webhook granaju nad istim spiskom.
2. **`apps/web/src/lib/env.ts`** — `paddleServerEnv()` (baca; `PADDLE_API_KEY` i
   `PADDLE_WEBHOOK_SECRET` u jednoj šemi, oba sa proverom prefiksa) i
   `paddleBetaDiscountId()` (**ne baca nikad**). Promenljive su već stajale u `.env` i
   `.env.example`; dopisano je samo čitanje.
3. **`apps/web/src/lib/paddle-server.ts`** — `paddleServer()`, jedini fajl u kome serverski
   ključ postoji u procesu. `server-only`, singleton po procesu, i **ukrštena provera
   `pdl_sdbx_` / `pdl_live_` prema `NEXT_PUBLIC_PADDLE_ENV`** — isti kvar koji
   `paddleKonfig()` hvata na klijentu, samo skuplji: nespareni par ne puca, nego otvori
   transakciju u drugom Paddle nalogu.
4. **`POST /api/billing/checkout`** — `runtime: "nodejs"`, `dynamic: "force-dynamic"`,
   IP tempo, `requireUserId()`, telo `{ priceId }` validirano Zodom protiv `ALL_PRICE_IDS`.
   Pravi Paddle transakciju sa `custom_data: { user_id, kind }`, vraća `{ transactionId }`.
   Beta nalog dobija `discountId` **bez kucanja koda**; paketi ga namerno ne dobijaju, jer
   je popust u Paddle-u ograničen na proizvode pretplata i uz paket bi bio odbijen.
5. **`POST /api/billing/webhook`** — sirovo telo kroz `req.text()`, potpis kroz
   `paddle.webhooks.unmarshal` **uvek**, pa insert u `billing_events` (duplikat → 200 i
   stop), pa obrada. Nepoznat tip se upiše i dobije 200.
6. **`apps/web/src/lib/billing.ts` + `billing-skladiste.ts`** — odluke odvojene od upita.
   Interfejs `NaplataSkladiste` ima devet metoda, svaka jedan upit ili jedan RPC.
7. **`components/cenovnik-ekran.tsx`** — `Checkout.open({ transactionId })` umesto
   `{ items, customer }`. Gost ide na `/?nalog=nov&nazad=%2Fcenovnik`; `app/page.tsx` taj
   parametar **proverava** (mora interna putanja) i prosleđuje `AuthEkran`-u kao `posle`.
8. **`apps/web/test/naplata.ts` + `lazno-skladiste.ts`** — **43 provere**, sve offline.

### Mapa događaja

| Događaj | Radnja |
|---|---|
| `transaction.completed` | grana po katalogu: pretplata → `apply_subscription` (plan + krediti), paket → `apply_credit_pack`. **Ovo je i okidač mesečne obnove** — cron ne postoji. |
| `subscription.created` / `.updated` / `.activated` / `.trialing` / `.paused` / `.resumed` | osveži ogledalo (`apply_subscription`, `credits: 0`) |
| `subscription.canceled` | `canceled_at` upisan, **pristup ostaje** do `current_period_end` |
| `subscription.past_due` | samo obeleži stanje, ništa se ne oduzima |
| `adjustment.created` / `.updated` | pun odobren povraćaj → `admin_adjust_credits(p_kind => 'povracaj')` |
| sve ostalo | upiši i vrati 200 |

### Odstupanja od PRD-a — namerna

1. **Grananje `transaction.completed` ide po `pri_`, ne po `custom_data.kind`.**
   Prompt je tražio `kind`. Katalog se ionako mora pročitati (bez njega se ne zna ni plan
   ni broj kredita), a `pri_` je na transakciji uvek — i za onu napravljenu ručno u Paddle
   panelu, kojoj `custom_data` fali. `kind` je zadržan kao **ukrštena provera**: neslaganje
   se loguje, a odluku donosi ono što je stvarno plaćeno. Test 10 to i tvrdi.
2. **Posao se radi PRE odgovora, ne posle njega.** Prompt je predlagao „vrati 200, pa radi
   ostalo". To bi značilo da pad obrade niko ne vidi: Paddle pamti uspeh, ponavljanja nema,
   korisnik ima naplaćenu karticu i nula kredita. Ceo posao su dva do tri upita — daleko
   ispod budžeta od 5 sekundi. Umesto toga je razdvojeno po mehanizmu: **trajan** neuspeh
   (nema profila, tuđ `pri_`, pokušaj bete) → 200 i log; **prolazan** (skladište baca) →
   marker se briše i vraća se 500, pa Paddle pokuša ponovo. Isti obrazac kao Clerk webhook.
3. **`adjustment.updated` se takođe hvata.** Prompt navodi samo `created`. Povraćaj koji
   traži kupac stiže kao `pending_approval` i sme da bude odbijen; skidanje kredita pre
   odluke bilo bi skidanje kredita bez povraćaja. Trenutak odobrenja je često tek `updated`.
4. **Delimičan povraćaj ne dira kredite automatski.** Srazmera bi tražila iznos originalne
   transakcije, a njega ne čuvamo — knjiga je kod Paddle-a, koji je merchant of record.
   Loguje se i rešava iz admin konzole, gde ista funkcija stoji sa iznosom koji čovek unese.
5. **Povraćaj se deli na komade od najviše 500 kredita.** `admin_adjust_credits` odbija
   veći iznos (0012), a Advanced daje 800. Komadi nose različit `ref_id`
   (`povracaj:adj_…`, pa `#2`), jer bi isti drugi komad bio proglašen duplikatom.
6. **`subscriptions.country_code` ostaje `null`.** Nijedan Paddle notification payload ne
   nosi zemlju — samo `address_id`. Dovlačenje adrese je još jedan mrežni poziv unutar
   budžeta od 5 sekundi, za podatak koji trenutno niko ne čita. Kolona postoji (pravilo 11);
   puni se kad se prvi put nekome zatreba.
7. **`supabaseSkladiste()` je u zasebnom fajlu.** Ne zbog urednosti nego zato što testovi
   ovog repozitorijuma module menjaju resolve hookom, koji radi po specifikatoru. Alternativa
   bi bio prekidač „ako je test" u samoj naplati — tačno ono što `route-harness.ts` odbija.
8. **Email prefil u checkout-u je otpao.** Uz `transactionId` kupca određuje transakcija, a
   ne `Checkout.open`. Ne gubi se ništa bitno: vezivanje ide po `user_id`, pa kupovina sa
   druge adrese svejedno završi na pravom nalogu — što je i bila poenta pravila 2.
   Povratnom kupcu se prosleđuje `customerId` sa profila, pa on i dalje vidi svoje podatke.

### Šta je test pokrio

43 provere, sve bez mreže i bez baze. **Potpis se ne lažira** — telo se potpisuje pravim
HMAC-SHA256 nad `"<ts>:<telo>"` i verifikuje ga pravi `unmarshal`; lažna je samo baza.

Pet slučajeva iz prompta: isti `event_id` dvaput → jedna stavka u knjizi · pogrešan potpis
→ 401 i nijedan upis · `transaction.completed` bez ijednog traga o korisniku → 200, događaj
upisan, greška javljena · paket → `credits_topup`, ne `credits_balance` · plan `beta` iz
webhooka → odbijen (i kroz `transaction.completed` i kroz `subscription.updated`).

Uz njih: otkazivanje ne dira ni kredite ni plan · povraćaj prolazi i kad su krediti
potrošeni (balans ide na −50) i ne skida dvaput na drugi `event_id` · nepoznat tip događaja
dobija 200 · `pri_` van kataloga je odbijen · pogrešan `kind` ne odvodi paket u pogrešnu
kasu · prolazna greška daje 500 **i briše marker**, pa retry prođe i tek on donese kredite.

### Ostaje na meni

- **R3, R4, R7, R8** — bez njih webhook ne dobija ni jedan zahtev: payment link u
  **Paddle > Checkout > Checkout settings** (bez njega `Checkout.open()` puca sa „Something
  went wrong"), tunel do localhosta, i notification destination na
  `/api/billing/webhook`. Destinacija mora da bude pretplaćena bar na:
  `transaction.completed`, `subscription.created`, `subscription.updated`,
  `subscription.canceled`, `subscription.past_due`, `adjustment.created`,
  `adjustment.updated`.
- **Prolaz kroz Paddle simulator** za `subscription_creation` i za povraćaj — to je S26.
- **Provera da su sve tri `PADDLE_*` promenljive na Vercelu**, ne samo u `.env`.
- `pnpm check:f4` nad pravom bazom nije potreban: S18 nije dirao nijednu SQL funkciju.

### Preneto dalje

- **S19 (kapija pristupa):** `plan_expires_at` i `subscriptions.status` sada stvarno imaju
  ko da ih puni. `canceled` NAMERNO ne obara `profiles.plan` — granicu drži datum, i to je
  pretpostavka na kojoj `stanjePristupa()` treba da se gradi.
- **S21 (ekran pretplate i portal):** tabela `subscriptions` je popunjena i čita se bez
  mreže. Sekcija sa paketima na `/cenovnik` i dalje ne postoji, iako se njihove cene već
  učitavaju i njihov checkout već radi kroz istu rutu.
- **S21 (portal):** `paddle.customerPortalSessions` postoji u SDK-u, a
  `profiles.paddle_customer_id` se od S18 puni pri svakoj kupovini — dakle preduslov za
  samouslužno otkazivanje je namiren.
- **S26 (Sentry):** jedina mesta na kojima pad naplate danas završava su `console.error` u
  webhook ruti. Dok Sentry ne stigne, tih 500-ica se vidi samo u Vercel logovima.

---

## S19 — Životni ciklus pristupa ☑

**Isporučeno 21. avgusta 2026.** Izvor: `docs/LANSIRANJE.md` §1.5 i §6, sesija S19.
**Bez migracije** — `0022` je dao obe kolone (`beta_expires_at`, `plan_expires_at`), a S18 je
dao ko će ih puniti. Admin konzola (S20) i ekran cenovnika/pretplate (S21) nisu dirani.
Mejlova nema — odloženi su i nisu bili deo ove sesije.

**Cilj, ispunjen:** aplikacija prvi put zna da pristup može da istekne, i zna to na **jednom**
mestu.

### Gde je `stanjePristupa()` i zašto tamo

**`packages/shared/src/pristup.ts`**, ne `apps/web/src/lib`. Tri razloga, redom po težini:

1. **`GRACE_DAYS` je već u `plans.ts`.** Funkcija koja od njega izvodi datum ne sme da živi u
   drugom paketu od broja koji koristi — to je prvi korak ka dva broja.
2. **Odluku čita i server i pregledač.** Baner i modal su klijentske komponente; sve u
   `apps/web/src/lib` što dodiruje bazu nosi `server-only`. Da je funkcija tamo, klijentska
   polovina bi dobila kopiju — dakle drugu računicu, tačno ono što je sesija trebalo da
   spreči.
3. **Obrazac je već dokazan** na `feedback-motor.ts`: čiste funkcije, trenutak se
   **prosleđuje** (`sada: number` je obavezan argument, nema `Date.now()` u telu odluke), pa
   se ista pravila proveravaju u testu, u ruti i u komponenti.

Web polovina — upiti, odbijenice, preusmeravanja — je u `apps/web/src/lib/pristup.ts` i ne
donosi nijednu odluku.

### Šta je urađeno

1. **`packages/shared/src/pristup.ts`** — `stanjePristupa(profil, pretplata, sada)` vraća
   diskriminisanu uniju sa šest stanja (`beta`, `aktivan`, `otkazan`, `dopuna`, `grace`,
   `zakljucan`). Uz svako idu `pun` (sme da troši), `cita` (sme da čita svoje), `planLimita`
   i oba datuma. Unija, a ne `{ stanje, pun, cita }` sa opcionim datumima: baner u `grace`
   **mora** da ispiše tačan datum, a sa `punDo?: string` bi svaki prikaz imao svoje
   `?? "uskoro"`.
2. **`apps/web/src/lib/pristup.ts`** — `citajPretplatu()` i `citajPristup()` (oba kroz React
   `cache()`, dakle jedan par upita po zahtevu za layout + stranu + kapiju),
   `pristupZaProfil()` za layout koji profil već ima, `zahtevajCitanje()` za strane, i
   `odbijenica()` / `odbijenicaCitanja()` za rute.
3. **Kapije uz podatak** — svih šest strana u `(app)` i osam API ruta (devet kapija: `/api/poruke` ima i `GET` i `POST`). Layout ima svoju,
   ali ona **nije** zaštita: ne izvršava se ponovo pri klijentskoj navigaciji.
4. **`/zakljucano`** — nova strana izvan grupe `(app)`, sa oba datuma, rečenicom „Ništa nije
   obrisano" i dva dugmeta ka cenovniku. Sama preusmerava nazad u aplikaciju čim nalog
   ponovo ima pristup, pa nije slepa ulica posle kupovine.
5. **`components/pristup-baner.tsx`** — trajna traka za `grace` (žuta, `--warn-wash`) i za
   otkazanu pretplatu koja još traje (plava, `--info-wash`). Stoji ispod trake o kvaru veze
   sa bazom: pokvarena veza je hitnija vest, i uz nju stanje pristupa ionako nije pouzdano.
6. **`components/pristup-provider.tsx`** — modal sa dva izlaza na `/cenovnik` („Uzmi plan",
   „Dokupi kredite") i pamćenje da je viđen.
7. **`packages/shared/test/pristup.ts` (28 provera) i `apps/web/test/pristup.ts` (31)** —
   odluka i žice, sve offline.

### Tabela stanja, onako kako je kod stvarno čita

| Stanje | Kad | `pun` | `cita` | Šta se vidi |
|---|---|---|---|---|
| `beta` | plan `beta`, rok u budućnosti ili `NULL` | ✔ | ✔ | ništa |
| `aktivan` | `plan_expires_at` u budućnosti, pretplata nije otkazana | ✔ | ✔ | ništa |
| `otkazan` | isto, ali `status = canceled` **ili** `canceled_at` postoji | ✔ | ✔ | plav baner „traje do <datum>" |
| `dopuna` | nema roka koji traje, ali `credits_topup > 0` | ✔ | ✔ | ništa, Starter limiti |
| `grace` | rok istekao, unutar `GRACE_DAYS` | ✘ | ✔ | žut baner + modal jednom |
| `zakljucan` | i grace istekao | ✘ | ✘ | `/zakljucano` |

### Odluke koje nisu bile doslovno u promptu

1. **`null` u `beta_expires_at` je „neograničeno" SAMO uz plan `beta`.** Uz plaćen plan
   znači „bete nema". Drugo čitanje ne postoji: kad bi `null` uvek bio neograničen, svaki
   pretplatnik kome pretplata istekne dobio bi večan pristup. Ovo je jedina zamka u celoj
   funkciji i zato stoji i u komentaru tipa i u testu.
2. **Odbijenica je `403`, ne `402`.** U ovom kodu `402` znači tačno jednu stvar — „nemaš
   dovoljno kredita" — i klijent na njega nudi „vidi kredite". Istekao pristup nije stanje
   novčanika: u `grace` stanju kupovina kredita **jeste** izlaz, ali dva različita razloga
   sa istim statusom bi značila jedno pogrešno dugme. Modal razdvaja ta dva slučaja tekstom.
3. **`dopuna` pretiče `grace`.** Redosled provera je deo odluke: čovek koji je maločas kupio
   paket ne sme da vidi baner „pristup ti ističe" nad kreditima koje je upravo platio.
   Zato i `/zakljucano` sam preusmerava nazad.
4. **Besplatna pretraga po kešu se u `grace` stanju TAKOĐE odbija.** §1.5 daje grace nalogu
   „samo čitanje **postojećih** prospekata", a pretraga je pronalaženje novih. Odbijeni su i
   `/api/search` i `/api/search/kes` — lista koja radi ispod forme koja ne radi je samo
   zbunjujuća.
5. **`/api/poruke/ai` dobija kapiju za TROŠENJE, iako ne troši kredit.** Prompt nabraja
   pretragu, skeniranje i otključavanje. „Ne troši kredit" nije isto što i „ne košta": svaka
   AI varijanta je plaćen Anthropic poziv. Same poruke (`GET /api/poruke`) rade i u `grace`
   stanju — sklapaju se iz podataka koje je korisnik već platio, bez ijednog spoljnog poziva.
6. **`/api/uvoz` isto.** Uvoz pipeline CSV-a ume da **otključava** redove, dakle troši
   kredite. Bez ove kapije bi grace nalog imao rupu širu od `/api/unlock`.
7. **`/api/job/[id]` NEMA kapiju, namerno.** To je pollovanje posla koji je već plaćen, na
   svakih 3–10 sekundi. Dva dodatna upita po krugu, za svakog korisnika, radi podatka koji
   se ne može dobiti bez `pun` pristupa — cena bez koristi. Posao se ne može ni pokrenuti
   bez kapije na `/api/search`.
8. **Dnevni limiti se od sada računaju po `planLimita` iz kapije**, ne po `profiles.plan`.
   Bez toga stanje `dopuna` nikad ne bi dobilo limite koje mu §1.3 obećava: `profiles.plan`
   posle isteka i dalje piše `starter` (ili `beta`), jer `apply_subscription` plan nikad ne
   spušta. Promenjeno na tri mesta: `/api/search` (`claim_cache_miss`), `/api/export` i
   tekst uz dugme za izvoz na `/lista`.
9. **Nepoznato stanje ne zaključava.** `pristup === null` znači da profil nije pročitan
   (pokvarena Clerk↔Supabase veza), i sve kapije tada **propuštaju**. Kvar veze ne sme da
   izgleda kao istekla pretplata, a svaka putanja koja stvarno troši novac ionako pada niže,
   u `no_user` granu SQL funkcije.
10. **Modal pamti u pregledaču, ne u bazi.** `localStorage` sa **potpisom stanja**
    (`grace:2026-08-20T…`) za istek — obnovi li se pa ponovo istekne, potpis je drugi i
    prozor se javi opet. `sessionStorage` za „nema kredita", dakle jednom po tabu, jer je to
    stanje novčanika koje se menja kupovinom. Nova kolona u `profiles` bi bila migracija
    zbog jednog `boolean`-a, a isto stanje ionako stoji u trajnom baneru.
11. **`/pretraga` u `grace` stanju ne crta onemogućenu formu nego objašnjenje.** Onemogućen
    combobox uz ugašeno dugme uz mrtav prekidač dubine je tri mrtve kontrole i nijedna
    rečenica o tome zašto. Ovo je ionako jedini ekran na kome se troše krediti.

### Popravljeno usput

- **`/pretraga` je klijentu slao samo `credits_balance`.** Prikazano stanje je zbir obe kase
  (0022), a `/api/search` proverava zbir — pa je modal umeo da kaže „nemaš dovoljno" čoveku
  koji ima kupljen paket, dok bi mu server isto skeniranje mirno naplatio. Sada ide zbir.

### Šta je test pokrio

**`packages/shared/test/pristup.ts`** — odluka, nad čistom funkcijom i sa prosleđenim
trenutkom, pa se „istekla juče" i „za 31 dan" proveravaju bez laganja sistemskog sata. Pet
slučajeva iz prompta: `beta_expires_at NULL` → uvek pun pristup, i sa nula kredita · beta
istekla juče → `grace`, za 31 dan → `zakljucan` · otkazana pretplata sa periodom u
budućnosti → pun pristup, ne grace · `credits_topup > 0` bez pretplate → `dopuna`. Uz njih:
granica grace-a je zatvorena (u sekundi isteka je već zaključan) · `past_due` unutar
plaćenog perioda i dalje radi · zakazano otkazivanje (`status active` + `canceled_at`) čita
se isto kao otkazano · `null` uz plaćen plan **nije** neograničena beta · nepoznat plan i
neispravan datum ne ruše kapiju i nikad ne daju pristup.

**`apps/web/test/pristup.ts`** — prevod stanja u odbijenicu (koji status, koja rečenica,
sadrži li tačan datum i `/cenovnik`) i **žice**: statička provera da svaka ruta koja troši
zove `odbijenica()`, a svaka koja čita `odbijenicaCitanja()` — i da nijedna od tri koje
čitaju **ne** koristi onu strožu. Kapija koja postoji a nije pozvana je gora od kapije koje
nema: izgleda kao zaštita. Peti slučaj iz prompta — „grace → izvoz prolazi, skeniranje ne" —
stoji ovde kao jedna provera, jer je to par koji grace period čini smislenim.

### Ostaje na meni

- **R27** (prolaz kroz životni ciklus rukom) sada ima šta da testira. Ceo scenario je u
  `docs/PROVERA-VIZUELNA.md` §7, sa gotovim `update` naredbama — **ne traži ni Paddle, ni
  tunel, ni pravu uplatu.**
- **Registracija i dalje otvara `beta` nalog sa neograničenim rokom.** `create_profile_with_grant`
  postavlja plan `beta` i 50 kredita, a `beta_expires_at` ostaje `NULL` — dakle večan pristup.
  To je namerno ostavljeno: §1.1 kaže da beta plan sme da nastane isključivo iz admin
  konzole, a konzola je **S20**. Do tada je svaka registracija besplatan neograničen nalog.
  **Ovo je jedina stvar iz S19 koja mora da se zatvori pre otvaranja registracije.**
- Prekidač teme i `.num` provere na dve nove strane su u §7 liste vizuelne provere.

### Preneto dalje

- **S20 (admin konzola):** `stanjePristupa()` je gotov i vraća baš ono što traži kolona
  „stanje" i filter po njoj. Uvozi se iz `@sajtoskop/shared`; drugu računicu ne pisati.
  Detalj korisnika ima gotove izvedene datume — `punDo` i `citanjeDo` — i ne treba da ih
  sabira sam. Radnja „otvori beta nalog" treba da postavi `beta_expires_at`; sve ostalo
  kapija već čita.
- **S20 (zatvaranje registracije):** v. „Ostaje na meni" — `create_profile_with_grant` i
  `DEFAULT_PLAN` su mesta na kojima beta nastaje sama.
- **S21 (cenovnik i pretplata):** `/cenovnik#paketi` je usidren na **tri** mesta
  (`/zakljucano`, modal, ekran pretrage u grace stanju). Sekcija sa paketima mora da dobije
  `id="paketi"`, inače ta tri dugmeta vode na vrh strane. Ekran stanja pretplate treba da
  čita `citajPristup()`, ne da zove Paddle.
- **S24 (onboarding):** onboarding ne sme da se pokrene za nalog u `grace` ili zaključanom
  stanju — `pristup.pun` je provera, i stoji na dohvat ruke u svakoj server komponenti.
- **S26 (Sentry):** kapije ne loguju odbijenice. To je namerno — odbijenica je očekivano
  ponašanje, ne greška. Ako ikad zatreba brojanje, mesto je `odbijenica()`, jedna funkcija.


---

## S20 — Admin konzola: beta nalozi ☑

**Isporučeno 21. avgusta 2026.** Izvor: `docs/LANSIRANJE.md` §1.1 (odluka D1) i §1.4/§1.5,
sesija S20. Migracija **`0024_beta_nalozi.sql`**. Naplata i ekran cenovnika nisu dirani.

**Cilj, ispunjen:** beta nalog se otvara **jednim** obrascem, `/admin/korisnici` pokazuje
stanje pristupa i filtrira po njemu — i, što je ispalo najvažnije, **plan `beta` više ne može
da nastane sam**.

### Ovo je bila i sesija u kojoj se zatvara registracija

S19 je ostavio jednu rečenicu u „Ostaje na meni": *„Registracija i dalje otvara `beta` nalog
sa neograničenim rokom… Ovo je jedina stvar iz S19 koja mora da se zatvori pre otvaranja
registracije."* Prompt S20 je to tražio kao tačku 4 („proveri da nijedan drugi put ne može da
ga dodeli"), a provera je pokazala da **dva puta jesu mogla**:

1. **`profiles.plan default 'beta'`** (0001) uz `beta_expires_at IS NULL`, što po §1.5 znači
   NEOGRANIČENO — svaka registracija je bila doživotan besplatan nalog. Uz to i 50 kredita,
   jer je `ensureProfile()` slao `PLANS.beta.monthlyCredits`.
2. **`DEFAULT_PLAN = "beta"`** — pad za nepoznatu vrednost u koloni. Tipfeler u `profiles.plan`
   je davao isti doživotan pristup, i to bez ijednog traga o tome kako.

Oba su zatvorena. Nov nalog od sada dobija plan **`dopuna`** i **nula kredita**, dakle stanje
`zakljucan`, dakle `/zakljucano` → `/cenovnik`. To je ono što §1.1 traži: „Nema besplatnog
plana za javnost."

### Tri sloja koja drže odluku D1

Jedan sloj bi bio dogovor, ne brana. Tri su:

| Sloj | Gde | Šta drži |
|---|---|---|
| spisak planova | `PLAN_OPCIJE`, `planBodySchema` | padajući spisak `beta` ne nudi, telo sa `beta` odbija `400` |
| radnja | `promeniPlan()` | odbija `beta` sa rečenicom, **pre** baze — da poruka ne bude izuzetak iz Postgresa |
| **triger** | `profiles_beta_guard` (0024) | odbija svaki prelazak plana u `beta` mimo `admin_open_beta` — **i kad se aplikacija zaobiđe** |

Triger propušta samo transakciju koja je postavila `set_config('sajtoskop.beta', 'konzola',
true)`, a to piše tačno jedna funkcija u celom projektu. Zastavica je **transakcijska**, pa
ne postoji način da „ostane upaljena" za sledeći zahtev — `pnpm check:sql` to i proverava
golim `update`-om odmah posle otvaranja bete.

Prelazak `beta` → `beta` prolazi bez zastavice: plan se time ne dodeljuje, a bez toga se beta
ne bi mogla ni ugasiti (gašenje je rok u prošlosti, ne promena plana).

### Šta je urađeno

1. **`supabase/migrations/0024_beta_nalozi.sql`**
   - nov razlog u knjizi **`beta_grant`** — i u `check` ograničenju, i u parcijalnom
     idempotentnom indeksu, i **u telu `grant_credits`** (zamka koju 0011 i 0022 imenuju:
     bez trećeg mesta svaki poziv tiho vrati `invalid_reason`). Puni `credits_balance` —
     beta je pretplata koju ne naplaćujem, ne kupljen paket, pa ti krediti **ističu**.
   - `profiles.plan`: `default 'dopuna'` + `profiles_plan_valid` check nad pet vrednosti
   - triger `profiles_beta_guard` + `admin_open_beta(p_user, p_credits, p_expires, p_ref_id)`
   - `create_profile_with_grant`: „created" vs „existing" se više ne izvodi iz postojanja
     `monthly_grant` reda (sa nula kredita ga nikad nema) nego iz `xmax = 0` na `returning`
   - `admin_users_page`: šest novih kolona (obe kase, oba roka, najsvežija pretplata kroz
     `lateral`) i nov parametar `p_ids`
2. **`POST` i `PATCH /api/admin/korisnici/[id]/beta`** — otvaranje naloga i sam rok. Dva
   metoda, jedan resurs; dve radnje u dnevniku (`user.beta_open`, `user.beta_expiry`), obe
   kroz `pripremiRadnju` → `saAuditom`, dakle trag i na uspeh i na pad (pravilo 14).
3. **`otvoriBetaNalog()` i `postaviBetaRok()`** u `lib/admin-radnje.ts`, po obrascu
   `korigujKredite` / `promeniPlan`: RPC nosi brave, ovaj sloj prevodi razlog u status kod i
   u jednu rečenicu.
4. **Obrazac „Otvori beta nalog"** u desnoj koloni detalja — kredita + rok (datum ili
   „neograničeno"), predlog **50 / 30 dana** (odluka P6), i dugme „Samo rok" pored njega.
5. **Kolona „Stanje" i filter po stanju** na `/admin/korisnici`, uz nov `PadajuciFilter`.
   Kolona kredita od sada prikazuje **zbir obe kase**, sa delom iz paketa u zagradi.
6. **Blok „Pristup"** na detalju korisnika: stanje, oba upisana roka, oba **izvedena**
   (`pun pristup do`, `čitanje do`) i stanje pretplate. Blok „Krediti" razbijen na
   „Ukupno / Iz pretplate / Dokupljeni".
7. **`apps/web/test/admin-beta.ts` (38 provera)** i **24 nove provere u `pnpm check:sql`**.

### Odluke koje nisu bile doslovno u promptu

1. **Nov nalog dobija `dopuna`, a ne šesti plan „nema plana".** `dopuna` po §1.3 već znači
   „korisnik bez pretplate", a sa nula kredita ga `stanjePristupa()` čita kao `zakljucan`.
   Čim kupi paket, `credits_topup > 0` ga vraća u pun pristup — **bez ijedne izmene plana**.
   Šesta vrednost bi bila šesta grana u svakoj mapi plan → limiti, i to zbog stanja koje
   traje do prve kupovine.
2. **`beta` je izbačen iz padajućeg spiska planova.** Beta nije plan nego tri stvari
   odjednom. Spisak koji je nudi dozvolio bi pola otvorenog naloga — plan bez roka, dakle
   neograničenu betu. To je ista greška koju je sesija došla da zatvori, samo iz konzole.
3. **Filter po stanju se rešava u TS-u, pa se u SQL šalje spisak ID-jeva** (`p_ids`).
   Alternativa je bila druga implementacija šest stanja u SQL-u — `max` od dva roka, grace
   prozor, `dopuna` koja pretiče grace, `NULL` koji je neograničen samo uz plan `beta`. Ta
   kopija bi se razišla sa TS-om prvog dana kad se pravilo promeni, i razišla bi se **tiho**,
   jer bi obe strane radile. Ovako paginacija ostaje u bazi i ostaje tačna. Granica je 5.000
   naloga, dokumentovana na mestu — red veličine iznad svakog broja iz §1.3.
4. **`admin_open_beta` ne piše svoj red u dnevniku**, za razliku od `admin_adjust_credits`.
   Red piše ruta, kroz `saAuditom` — jedna radnja, jedan red. Da RPC piše svoj, otvaranje
   beta naloga bi ostavljalo dva zapisa o jednoj radnji.
5. **Rok u prošlosti prolazi kroz šemu i kroz RPC bez ijedne provere, ali UI traži potvrdu.**
   Gašenje bete rokom u prošlosti je propisan način (§1.5); pogrešna godina je najčešća
   omaška i posledica joj je da čovek istog trenutka ispadne iz aplikacije. Server ne može da
   razlikuje to dvoje — čovek pred obrascem može. Gornja granica (5 godina unapred) postoji
   iz iste porodice grešaka: `2226` umesto `2026` je neograničena beta upisana kao datum.
6. **`<input type="date">` se prevodi u KRAJ izabranog lokalnog dana.** „Do 21. septembra"
   znači da beta traje ceo 21. septembar. Ponoć na početku tog dana bi bila za jedan dan
   manje nego što u polju piše — nad pristupom, gde se to primeti odmah.
7. **Podrazumevani datum se popunjava u `useEffect`, ne pri renderu.** „Danas" na serveru
   (UTC na Vercelu) i u pregledaču (Beograd) nije isti dan svake večeri, pa bi vrednost polja
   izazvala neslaganje pri hidraciji — na obrascu koji dodeljuje pristup.
8. **`beta_grant` je nov razlog u knjizi, a ne `admin`.** „Koliko je otišlo na betu" je drugo
   pitanje od „koliko je dodeljeno rukom", a izvod mora da kaže odakle su krediti.
9. **`PATCH .../beta` ne traži da nalog bude u beti.** `stanjePristupa()` uzima **kasniji** od
   dva roka, pa je ovo način da pretplatnik dobije dve nedelje viška posle propalog plaćanja,
   bez diranja pretplate i bez dodirivanja Paddle-a. Poruka izričito kaže kad rok nikome
   ništa ne menja.
10. **„Grace" ostaje neprevedeno u konzoli.** Tako se stanje zove u §1.5 i u svakom komentaru
    u kodu, a taj ekran čita samo onaj ko te dokumente i piše. Prevod bi bio drugo ime za istu
    stvar. Korisnik svoje stanje ionako nikad ne vidi kao ime — njemu ide baner sa datumom.

### Popravljeno usput

- **Izvoz korisnika u CSV je pratio ekran.** Komentar uz `izveziKorisnike()` obećava da su
  brojevi u fajlu isti oni sa ekrana; čim je kolona kredita na ekranu postala zbir obe kase,
  fajl sa jednom kolonom je počeo da laže. Sada nosi obe kase odvojeno (`krediti` je i dalje
  samo ona koja ističe), plus `stanje`, `beta_do` i `pun_pristup_do`. Stanje računa **ista**
  `pristupIzReda()` koju zove i lista — izvoz koji bi ga računao sam bio bi treća računica o
  pristupu. Prazan `beta_do` uz plan `beta` piše **`neograniceno`**: u tabeli van aplikacije
  nema ko da objasni razliku između „nema roka" i „nema bete".
- **`clerkClient` je dopisan u `scripts/lib/next-stubs.ts`.** Bez njega se `lib/admin-radnje.ts`
  ne može ni učitati van Next runtime-a, pa nijedna admin radnja nije mogla da dobije test.
  Stub **baca** ako se stvarno pozove: jedina dozvoljena laž u testovima je identitet, ne i
  ponašanje tuđeg servisa.

### Šta je test pokrio

**`apps/web/test/admin-beta.ts`** — šta uopšte može da uđe u rute (šeme, granice, `refId` u
tuđem prostoru imena), da su otvaranje i pomeranje roka **dve** radnje u dnevniku i da oba
metoda idu kroz `saAuditom`. Peta sekcija je razlog zbog kog fajl postoji i namerno je
**statička**: prolazi kroz sav izvor u `apps/*/src` i `packages/*/src` i drži da nijedan fajl
osim `lib/admin-radnje.ts` ne piše `plan: "beta"`, da se `admin_open_beta` zove sa tačno
jednog mesta, da registracija ne uvozi nijedan broj iz beta plana i da webhook i dalje odbija
pokušaj. Regresija koje se stvarno plašim nije „ruta je vratila pogrešan status" nego „neko
je dopisao `plan: 'beta'` u kupon, zato što je tamo zgodno".

**`pnpm check:sql`** — ponašanje trigera nad pravim Postgresom: goli `update` i `insert` ne
mogu da dodele `beta`, zastavica ne curi u sledeću transakciju, `admin_open_beta` postavlja
sve troje odjednom, isti `ref_id` drugi put ne daje drugi paket kredita, `NULL` rok je
neograničeno, plan van spiska pada na `profiles_plan_valid`. Uz to `p_ids` sužavanje i prazan
niz kao „nijedan pogodak", a ne „bez ograničenja".

### Ostaje na meni

- **Postojeći beta nalozi nisu dirani.** Migracija namerno ne postavlja rok nikome ko ga već
  nema: to su moji testni nalozi i ljudi koji su već unutra, a migracija koja ćutke zaključa
  žive korisnike je gora od rupe koju zatvara. **Otvori `/admin/korisnici?stanje=beta`, pogledaj
  ko nosi bedž `NEOGRANIČENO` i postavi rok.** Zbog toga S20 i postoji.
- **Registracija sada vodi na `/zakljucano`.** Naslov te strane glasi „Pristup je istekao", što
  je za nekoga ko se upravo registrovao pogrešna rečenica — telo strane već ima granu za
  „nalog nema ni pretplatu ni betu ni kredite", ali naslov je ne prati. **S24** je sesija koja
  i inače prepravlja prvih 90 sekundi; ovo ide tamo.
- **R27** (prolaz kroz životni ciklus rukom) sada ima i drugu stranu: otvori beta nalog iz
  konzole, ugasi ga rokom u prošlosti, pa ga vrati.

### Preneto dalje

- **S21 (cenovnik i pretplata):** `/krediti` traži isti razbijen prikaz dve kase koji detalj
  korisnika sada ima — „iz pretplate, obnavlja se \<datum\>" i „dokupljeni, ne ističu".
  Tekstovi i podela su u bloku „Krediti" na `/admin/korisnici/[id]`, gotovi za prepis.
- **S24 (onboarding):** nov nalog više nema 50 kredita. Ako onboarding treba da da kredit
  dobrodošlice, razlog u knjizi je **`onboarding`** (već postoji od 0022, `ref_id = user_id`,
  dakle najviše jednom po nalogu) i menja se **jedan broj** —
  `KREDITI_NA_REGISTRACIJI` u `lib/profile.ts`. Plan se ne dira.
- **S26 (Sentry):** `admin_open_beta` baca izuzetak kad `grant_credits` odbije dodelu posle
  upisa plana — namerno, da transakcija ode nazad. To je jedini put u konzoli na kome se
  greška iz baze vidi kao `500`; ako se ikad pojavi u produkciji, znači da se lista razloga u
  `grant_credits` razišla sa pozivaocem.

---

## S21 — Cenovnik sa paketima, stanje pretplate, portal, linkovi ☑

**Isporučeno 23. avgusta 2026.** Izvor: `docs/LANSIRANJE.md` §1.2, §1.3, §1.4 i §1.5, sesija
S21. **Bez migracije** — ništa u ovoj isporuci ne traži novu kolonu, i to je bio jedan od
uslova (v. „Odstupanja", tačka o ceni).

**Cilj, ispunjen:** paket kredita se kupuje sa cenovnika i **bez pretplate**; `/krediti`
pokazuje obe kase odvojeno i objašnjava zašto se jedna resetuje a druga ne; otkazivanje ide
kroz Paddle portal, ne kroz mejl meni.

### Zašto je ovo bila i sesija o jednom broju

Do S21 je proizvod na **četiri mesta** pokazivao samo `credits_balance`, a naplaćivao iz zbira
obe kase. To nije bilo vidljivo dok `credits_topup` nije mogao da bude različit od nule — a
od S18 (webhook) može. Posledica bi bila najgora vrsta greške koju ovaj proizvod ume da
napravi: **korisnik vidi 4 kredita, klikne skeniranje za 3, prođe** — i onda se pita da li je
plaćeno dvaput. Sva četiri mesta su ispravljena u ovoj sesiji (bočna traka, gornja traka na
telefonu, `/krediti`, `/dashboard`); `/pretraga` i `/api/search` su na zbir prešli još u S17,
jer oni odlučuju o naplati.

### Šta je urađeno

- **`POST /api/billing/portal`** — `requireUserId()`, `paddle_customer_id` iz `profiles`, svi
  `sub_` ID-jevi iz `subscriptions`, pa `paddle.customerPortalSessions.create()`. Nazad ide
  **samo** `urls.general.overview`. Nalog bez Paddle kupca dobija **`404`**, ne `403`.
- **`lib/pretplata.ts`** — drugi čitač `subscriptions`, za ekran i portal. Vraća i `price_id`,
  iz kog se izvodi ciklus („mesečno" / „godišnje").
- **`components/portal-dugme.tsx`** — traži link **na klik**, nikad pri renderu: portal sesija
  je jednokratna i vremenski ograničena.
- **`/cenovnik` → sekcija „Paketi kredita"** sa sidrom `#paketi`, ispod tri plana, kao jedan
  panel na `--bg-subtle`. Oba paketa iz `plans.ts`, cene iz **istog** `PricePreview()` poziva.
- **`/krediti` → blok „Pretplata"** iznad izvoda: ime plana, ciklus, rečenica o stanju sa
  datumom, žuto upozorenje u `grace`, obe kase razdvojene i objašnjene, dva izlaza.
- **`sledecaDodelaKredita()`** u `packages/shared/src/plans.ts` — prvi dan narednog meseca po
  **beogradskom** kalendaru, istom po kom `grant_monthly_credits` računa ključ idempotencije.
- **Linkovi ka `/cenovnik`** — stavka „Planovi i cene" u bočnoj traci, poziv na dokupljivanje
  kad stanje padne nisko, i sidro `#paketi` na koje su dva linka iz S19 već pokazivala.
- **`apps/web/test/cenovnik.ts`** — nov test, uvezan u `pnpm --filter web test`.

### Odstupanja od prompta — namerna

- **Cene u evrima na `/krediti` NEMA, iako je prompt tražio „ime plana, cena, sledeća
  naplata".** Tri razloga, svaki dovoljan sam za sebe: katalog namerno ne drži iznose (Paddle
  je jedini izvor — v. zaglavlje `lib/cenovnik.ts`); `PricePreview()` vraća **cenovničku**
  cenu, a beta korisnik ima 33% popust (`BETA2026`, §1.6), pa bi mu na ekranu pisalo €59 nad
  računom od €39,53; a `subscriptions` (0022) ne čuva naplaćen iznos, pa se ne može ni
  pročitati bez migracije koju S21 nema. **Pogrešan iznos o novcu je gori od izostalog
  iznosa**, pa blok piše ono što jeste tačno — plan, ciklus i datum sledeće naplate — i vodi
  na portal, gde iznos i račun ionako žive. Obrazloženje stoji i u zaglavlju
  `components/pretplata-blok.tsx`, da se odluka ne donosi ponovo.
- **`404` se vezuje za `paddle_customer_id`, ne za postojanje pretplate.** Prompt kaže
  „korisnik bez pretplate → 404". Doslovno čitanje bi zaključalo portal kupcu koji je uzeo
  **samo paket kredita** — a njemu portal treba, jer tamo stoji njegov račun. Ko nikad ništa
  nije kupio nema ni Paddle kupca, pa i dalje dobija `404`; ko je kupio bilo šta, ima šta da
  otvori. Zato dugme i menja ime: „Upravljaj pretplatom" kad pretplata postoji, „Računi i
  plaćanja" kad postoji samo kupovina.
- **Paketi u `SVI_PRICE_ID` su već bili.** Prompt traži da se dodaju; S16 ih je tamo stavio
  unapred, baš zbog ove sesije (`ALL_PRICE_IDS` = 6 pretplata + 2 paketa). Provereno testom
  umesto dopisano.
- **Stat kartica „Stanje" na `/krediti` je obrisana.** Prikaz stanja kredita bi posle novog
  bloka postojao **dvaput na istom ekranu**, i to jednom kao zbir a jednom razbijeno. Ostale
  su dve dnevne kartice (skeniranja, CSV). Zbir sada stoji desno od naslova „Krediti", u
  bloku, uz dva polja od kojih je sabran.
- **Prag za „nisko stanje" je relativan pa apsolutan** — `max(3, 10% mesečne dodele)`. Fiksni
  broj bi Advanced nalogu (800 kredita) javio tek kad je već sve stalo, a čisto relativan bi
  nalogu bez plana (`mesecni = 0`) javljao uvek, i onda kad ima 150 kupljenih kredita.
- **Poziv na dokupljivanje je link, ne dugme.** Bočna traka stoji preko **svih** ekrana, pa bi
  primarno dugme u njoj bilo drugo primarno dugme na svakom od njih (§7.1).

### Popravljeno usput

- **`/dashboard` je tvrdio da je svaki nalog beta.** Podnaslov kartice „Plan" bio je zakucan
  string `"beta"` — tačan dok su svi nalozi bili beta, netačan od S16. Sada prati stanje iz
  `stanjePristupa()`.
- **Kartica plana ispisivala je sirovu vrednost kolone.** Nalog bez pretplate dobijao je
  `dopuna` — interno ime stanja, koje korisniku ne znači ništa. Nov `PLAN_IME` /
  `imePlana()` u `lib/ui-tekst.ts` daje „Bez pretplate". Namerno **odvojeno** od
  `STANJE_PRISTUPA`: taj spisak je za admin konzolu i sadrži „Grace" i „Zaključan".
- **Traka napunjenosti u bočnoj traci lagala je nalog bez plana.** `mesecni = 0` je davao 0%
  i nad punim novčanikom kupljenih kredita. Sada se traka ne crta kad mesečne dodele nema, a
  tekst kaže da kupljeni krediti ne ističu.
- **Bezuslovna poruka „Beta je besplatna dok traje" na `/krediti`.** Stajala je svakom
  korisniku, uključujući pretplatnika koji plaća €59. Obrisana.
- **Sidro `#paketi` nije postojalo.** Modal „Ostao si bez kredita" i strana `/zakljucano` su
  od S19 vodili na `/cenovnik#paketi`, dakle na vrh strane. Sada vode na sekciju.

### Šta je test pokrio

**`apps/web/test/cenovnik.ts`** — tri stvari koje `tsc` ne vidi:

1. **Datum sledeće dodele.** Prelazak decembar → januar, 31. januar → 1. februar (ne 31.), i
   zamka vremenske zone: 31.12. u 23.30 UTC je **već januar** u Beogradu, pa je sledeća dodela
   februar. Plus invarijanta koja mora da važi uvek — datum je u budućnosti.
2. **Portal, statički.** Da ruta uzima kupca iz sesije, da **ne čita** ni telo ni query (nema
   `customerId` spolja), da vraća `404` i nigde `403`, i da nazad ide samo URL a ne ceo objekat
   sesije. Regresija koje se plašim nije „pogrešan status" nego „neko je dopisao `customerId` u
   telo zahteva, zato što je tako lakše".
3. **Žice i kopija.** Da sidro `#paketi` postoji, da je i dalje **jedan** `PricePreview()` poziv,
   da obe obavezne rečenice o paketima stoje (ne ističu / nije zamena za plan), da paketi nemaju
   primarno dugme, i da sva četiri mesta koja pokazuju kredite pokazuju **zbir**.

Test čita izvor sa **skinutim komentarima** (`bezKomentara()`): komentari u ovom repozitorijumu
objašnjavaju baš ono što se proverava („zašto 404, a ne 403"), pa bi naivan `includes("403")`
pao na sopstveno objašnjenje. Provera koja pada na komentar uči te da je ignorišeš.

### Ostaje na meni

- **Futer sa linkom ka `/cenovnik` ne postoji** — futera uopšte nema, on nastaje u **S22**.
  To je jedina tačka iz prompta S21 koja nije isporučena, i jedina koja ne može da bude.
  Kad futer stigne, link ide u njega.
- **Portal se ne može isprobati bez `R3`** (Paddle API ključ u `.env`) i bez naloga koji je
  stvarno prošao kroz sandbox checkout — dakle bez `paddle_customer_id` u `profiles`. Do tada
  dugme uredno vraća `404` i to je tačno ponašanje, ne kvar.
- **`podrska@sajtoskop.com`** i dalje stoji u poruci greške na `/cenovnik` (V5) — nije
  provereno da adresa postoji.
- **Prolaz kroz `docs/PROVERA-VIZUELNA.md` §6, §7b i §5** — obe teme, telefon ≤ 390 px.

### Preneto dalje

- **S22 (futer):** link ka `/cenovnik` u futer, uz pravne tekstove. Sekcija paketa je već
  sidro `#paketi`, pa futer sme da linkuje direktno na nju.
- **S24 (landing):** `/cenovnik` sada ima sekciju paketa i sidro; landing sme da vodi na
  `/cenovnik#paketi` za posetioca koji neće pretplatu. Kopija o dve kase je gotova u
  `components/pretplata-blok.tsx` i ne treba je pisati ponovo.
- **S26 (Sentry i sandbox prolaz):** portal ruta je treća koja dodiruje Paddle SDK
  (checkout, webhook, portal). Sve tri padaju na `502` sa porukom bez ključa; sandbox prolaz
  treba da pokrije i otkazivanje kroz portal, pa proveru da `subscription.canceled` stigne
  nazad kao `canceled_at` i da baner „traje do \<datum\>" iskoči sam.
- **Ako se ikad zatraži iznos na `/krediti`:** to je migracija koja u `subscriptions` dodaje
  naplaćen iznos i valutu iz `transaction.completed`, plus grana za popust. Ne PricePreview.

---

## Izmena posle S21 — paket kredita traži plan ili betu ☑

**Doneto i isporučeno 26. avgusta 2026.** Bez migracije. Menja `LANSIRANJE.md` §1.4 i §1.5.

**Šta se promenilo:** paket kredita više nije ulaz u proizvod nego **dopuna postojećem
pristupu**. Kupuju ga `aktivan`, `otkazan` i `beta`; `dopuna`, `grace`, `zakljucan` i gost ne
mogu. S21 je isporučio suprotno („paket se kupuje i bez pretplate; to je podržan slučaj, ne
izuzetak") — to je bila odluka §1.4 i sada je povučena.

### Šta je urađeno

- **`smeDaKupiPaket()` i `STANJA_ZA_PAKET`** u `packages/shared/src/pristup.ts`. Jedno mesto,
  isto za server i za pregledač — dva spiska bi značila dugme koje se vidi a ne radi.
- **`/api/billing/checkout` sprovodi pravilo sa `403`.** Ovo je kapija; ekran je prikaz.
  Telo zahteva se sastavlja u pregledaču, pa bi bez ove grane svako ko pošalje `pri_` paketa
  dobio transakciju. `403`, ne `402`: stanje naloga nije stanje novčanika.
- **Ekran cena i dalje POKAZUJE pakete** onome ko ne sme, sa katancem i jednom rečenicom.
  Sakriti ih značilo bi da posetilac ne zna ni da postoje ni da se otključavaju uz plan — a to
  je razlog više da uzme plan, ne manje.
- **Uklonjen izlaz „Samo dokupi kredite" sa `/zakljucano`.** Zaključan nalog paket ne može da
  kupi, pa bi to dugme vodilo pravo u `403`.
- **Uslovljena tri CTA-a:** modal pristupa, primarno dugme na `/krediti` i poziv na
  dokupljivanje u bočnoj traci. Svaki od njih sada pita `smeDaKupiPaket()` i nudi plan kad
  paket nije opcija.

### Odluke koje nisu bile doslovno u zahtevu

- **Beta SME**, iako beta nalog nema pretplatu. Zahtev je glasio „samo korisnici koji imaju
  pretplatu", a beta bukvalno nije pretplata — ali beta nalozi su prvih dvadeset korisnika i
  §1.4 je paket zvao „jedini put za beta korisnika koji neće pretplatu". Oduzeti im i to
  značilo bi da im je jedini način da plate pun plan, pre nego što su odlučili vredi li.
  **Potvrđeno pitanjem pre pisanja koda.**
- **`smeDaKupiPaket(null)` je `false`** — nepoznato stanje (gost, kvar veze sa bazom) ne sme.
  Ovo je NAMERNO suprotno od `odbijenica()` u `apps/web/src/lib/pristup.ts`, koja kvar veze
  propušta. Razlika ide po tome šta je šteta u svakom smeru: tamo bi zatvaranje značilo da kvar
  baze izgleda kao istekla pretplata korisniku koji je platio, ovde bi otvaranje značilo uzet
  novac mimo pravila. Naplata pada zatvoreno.
- **`dopuna` NE sme**, iako je to stanje sa punim pristupom. Doslovno čitanje zahteva: ko nema
  plan, ne kupuje paket. Posledica je da se iz `dopuna` izlazi samo planom.

### Šta je test pokrio

Prošireno `apps/web/test/cenovnik.ts`: svih šest stanja kroz `stanjePristupa()` pa kroz
`smeDaKupiPaket()` (tri smeju, tri ne), `null` pada zatvoreno, spisak stanja ima tačno tri
člana, checkout ruta stvarno zove funkciju i vraća `403`, `/zakljucano` više ne pominje
`#paketi`, i sva tri CTA fajla pitaju za dozvolu. Uz to provera da stara kopija („Pretplata
nije uslov") više ne postoji — tekst koji obećava suprotno od onoga što ruta radi je obećanje
koje se odbija sa `403`.

### Ostaje na meni

- **Tvoj nalog je trenutno `dopuna`** (150 dokupljenih kredita, bez pretplate), pa po novom
  pravilu **više ne može da kupi paket**. Za dalje testiranje paketa treba ti aktivna
  pretplata ili beta nalog iz konzole.
- **Kopija landinga** ne sme da obeća paket bez pretplate. *(Dopuna 27.8.: landing je napravljen van repoa, pa ovo više nije sesija nego ručna provera teksta na `sajtoskop.com` — v. `LANSIRANJE.md` §1.7.)*
- **`docs/PROVERA-VIZUELNA.md` §7b** ima novu podsekciju „Ko sme da kupi", uključujući
  `fetch` iz konzole koji dokazuje da kapija nije samo kozmetika.

---

## S22 — Pravni tekstovi i futer ☑

**Isporučeno 26. avgusta 2026.** Izvor: `docs/LANSIRANJE.md` sesija S22, `docs/F8-landing.md`
§3, `docs/bezbednost-i-zastita.md` (Sloj 1 — Uslovi korišćenja). **Bez migracije**; ništa u
ovoj isporuci ne dodiruje bazu.

**Cilj, ispunjen:** `/uslovi`, `/privatnost` i `/povracaj` postoje kao javne strane, futer
postoji uopšte (do sada ga nije bilo nigde), a uz dugme za registraciju stoje linkovi na
Uslove i Privatnost. Ono što u tekstu traži stvaran podatak stoji kao **vidljiv marker**, ne
kao izmišljena rečenica.

### Šta je urađeno

- **`components/futer.tsx`** — nova komponenta. Linkovi: Cenovnik, Uslovi korišćenja,
  Politika privatnosti, Politika povraćaja, Kontakt (`mailto:podrska@sajtoskop.com`), plus
  copyright notice sa godinom u `.num`. Montiran na `/`, `/cenovnik`, `/welcome`, `/uslovi`,
  `/privatnost` i `/povracaj`. **Nikad u grupi `(app)`** — obrazloženje stoji u zaglavlju
  fajla: tamo je stalna navigacija bočna traka, a futer bi se pojavljivao ispod tabele
  prospekata i pomerao radnu površinu.
- **`components/pravni-okvir.tsx`** — zajednički okvir tri strane: `PravniOkvir` (zaglavlje,
  jedna kolona teksta na `62ch`, futer), `Odeljak`, `Lista`, `TekstLink`, `Popuniti` i
  `NacrtBaner`. Dno svake strane samo vodi na **druga dva** teksta — spisak je jedan niz, pa
  se ne održava tri puta.
- **`/uslovi`** — 14 odeljaka. Sve obavezne klauzule iz F8 §3: zabrana automatizovanog
  pristupa i reverse engineeringa, zabrana preprodaje i deljenja pristupa, zabrana gradnje
  konkurentskog proizvoda, jedan nalog = jedno lice, pravo na suspenziju, odgovornost
  korisnika za način kontaktiranja. Uz njih i Paddle kao **merchant of record**, pravilo o
  kreditima (pretplata se ne prenosi, paket ne ističe, paket traži plan ili betu) i
  **odeljak 5 o pristupu posle isteka** — 30 dana samo za čitanje i izvoz, pa prestanak, sa
  izričitim „ništa se ne briše".
- **`/privatnost`** — 13 odeljaka po ZZPL-u. Izričito piše da su kontakti firmi **podaci o
  ličnosti preduzetnika** i zašto. Odeljak 6 opisuje **postojeći** put brisanja (Clerk →
  `user.deleted` → kaskada nad `profiles`, pravilo 15), uključujući šta ostaje i zašto
  (revizija, knjigovodstvo, podaci o firmama). Odeljak 7 je za vlasnika firme koja je u bazi
  a nije korisnik. Odeljak 8 nabraja svih sedam obrađivača, a Paddle izdvaja kao
  **samostalnog rukovaoca**, jer kao MoR ne obrađuje po našem nalogu.
- **`/povracaj`** — 9 odeljaka. Odeljak 5 izričito priznaje da **Paddle sme sam da odobri
  povraćaj u roku od 60 dana** i onda kad naša politika kaže drugačije; odeljak 4 objašnjava
  šta biva sa potrošenim kreditima (skidaju se, stanje ide u minus, otključani prospekti
  ostaju otključani); odeljak 6 da povraćaj **ne otkazuje** pretplatu.
- **`components/auth-ekran.tsx`** — rečenica „Otvaranjem naloga prihvataš Uslove korišćenja i
  Politiku privatnosti", **samo na kartici „Registracija"**.

### Odstupanja i odluke

- **Tri strane su statične** (`○` u build izveštaju). Zaglavlje pravne strane namerno **ne
  čita Clerk sesiju** — `/cenovnik` to radi da bi znao kuda vodi dugme, a pravnom tekstu to
  ne treba i pretvorilo bi ga u dinamičnu rutu bez ijednog razloga.
- **`<POPUNITI: …>` je komponenta, ne komentar.** Marker se **vidi na objavljenoj strani**,
  kao žuta kapsula, a na vrhu sve tri strane stoji baner „Ovo je nacrt". Marker sakriven u
  komentaru bi značio stranu koja izgleda gotovo, a nije — a ove strane čita i Paddle
  recenzent u koraku R21. Kad poslednji marker nestane, briše se i `<NacrtBaner />`.
- **Komponente, ne markdown.** Renderovanje markdowna bi značilo ili
  `dangerouslySetInnerHTML` na javnoj strani ili paket više u bundle-u, a tekstovi ionako
  nose linkove ka `/cenovnik` i međusobno.
- **Futer nije montiran na `/zakljucano`.** Prompt nabraja pet mesta i to je namerno: ta
  strana ima jedan izlaz i jedno primarno dugme, a red linkova ispod bi ga razvodnio. Ako
  ikad zatreba, komponenta je već tu.
- **U tekstu nema nijedne izmišljene činjenice.** Sve što nije u kodu ili u odlukama iz
  `LANSIRANJE.md` je marker — uključujući i ono što bi zvučalo bezazleno (rok čuvanja logova,
  regioni obrade, nadležan sud).

### Markeri — 25, spisak je u odgovoru sesije

```bash
grep -rn "<Popuniti>" apps/web/src/app        # svih 25, po fajlovima
```

- **`/uslovi` (8)** — datum objave, pun pravni naziv, adresa, matični broj, PIB, žig, nadležan
  sud, primena propisa o zaštiti potrošača.
- **`/privatnost` (11)** — datum objave, pun pravni naziv, adresa, matični broj, PIB, lice za
  zaštitu podataka, rok čuvanja knjigovodstva (R18), rok čuvanja revizije, rok čuvanja logova,
  regioni obrade (Supabase, Hetzner, Vercel), osnov za prenos van zemlje.
- **`/povracaj` (6)** — datum objave, **rok za zahtev (R17)**, **prag potrošenih kredita
  (R17)**, pravilo za godišnju pretplatu (R17), rok za paket (R17), pravo na odustanak.

### Ostaje na meni

- **R17 nije donet**, pa Politika povraćaja ima strukturu bez brojeva. Kad odluka padne,
  menjaju se **samo markeri**, ne tekst oko njih.
- **R19** — pročitati sva tri teksta i popuniti svih 25 markera. Tek posle toga ima smisla
  **R21** (Paddle KYC), jer oni traže vidljive Uslove i Politiku povraćaja.
- **`podrska@sajtoskop.com` još ne postoji** (R23), a sada stoji na sedam mesta u pravnim
  tekstovima i u futeru.
- **Prolaz kroz `docs/PROVERA-VIZUELNA.md`** za tri nove strane i futer — obe teme, telefon
  ≤ 390 px (deo koraka R28).
- **Rečenica „Beta je besplatna dok traje. 30 kredita mesečno, bez kartice." na `/`** nije
  tačna od S16/S20: nov nalog je `dopuna` sa nula kredita, a beta se otvara samo iz konzole.
  Nije dirana jer je kopija te strane opseg **S24**, ali je greška o novcu i stoji tačno iznad
  novih pravnih linkova.

### Preneto dalje

- **S24 (od 27.8. preokret na `app.` poddomen, ne landing):** landing je napravljen **van
  ovog repozitorijuma** i stoji na `sajtoskop.com`, pa `/` u aplikaciji ostaje ekran za
  prijavu (`docs/LANSIRANJE.md` §1.7). Za futer to znači dve izmene u S24: logo i nova
  stavka „Početna" vode na landing kroz `NEXT_PUBLIC_LANDING_URL`, a ne na `/`. **Pravne
  strane ostaju ovde** i landing ih linkuje — menjaju se zajedno sa kodom, pa bi kopija na
  landingu tiho zastarela.
- **S26 (sandbox prolaz):** korak 9 iz R26 (povraćaj) sada ima i tekst uz sebe — proveri da se
  ponašanje poklapa sa odeljkom 4 Politike povraćaja (krediti se skidaju i kad su potrošeni,
  stanje sme u minus).
- **Ako se ikad promeni put brisanja naloga**, menja se i odeljak 6 Politike privatnosti. To
  je jedino mesto u dokumentaciji proizvoda gde je taj put opisan korisniku.

---

## Izmena posle S22 — dva domena, onboarding kao faza, O1 ☑

**Doneto 27. avgusta 2026.** Bez migracije i bez ijedne izmene koda — ovo je izmena plana i
dokumentacije. Menja `LANSIRANJE.md` §4 (P5), uvodi §1.7 i §1.8.

### Šta se promenilo

**1. Landing je napravljen van repoa.** `sajtoskop.com` je prodajna strana i **ne održava se
ovde**; aplikacija ide na `app.sajtoskop.com`. Odluka **P5** („landing u istoj aplikaciji, `/`
postaje prodajna strana, bez `app.` subdomena") time pada — ne zato što je bila pogrešna, nego
zato što je posao odrađen drugim putem. `/` u aplikaciji **ostaje ekran za prijavu**, a
`/prijava` i `/registracija` ostaju redirekcije.

**2. S23 otpada, S24 se prepisuje.** Kopija landinga se ne piše u ovom repou, pa nema ni
`docs/landing-kopi.md` ni ručnog koraka R20. S24 postaje **preokret na poddomen**: linkovi ka
landingu kroz `NEXT_PUBLIC_LANDING_URL` i `/cenovnik` koji prima nameru sa prodajne strane
(`?plan=&ciklus=`).

**3. Pravne strane ostaju u aplikaciji**, landing ih linkuje (R36). Menjaju se zajedno sa
kodom — grace period, dve kase, put brisanja naloga, ime merchant of record-a — pa bi kopija
na landingu zastarela prvog dana, i to tiho.

**4. Cene na landingu, checkout u aplikaciji.** Link nosi **slug plana, nikad `pri_` ID**:
inače bi prelazak sandbox → produkcija tražio izmenu i na landingu, na mestu gde se greška ne
vidi dok neko ne plati. Iznosi u evrima ostaju duplirani (landing + Paddle katalog) i to ide u
ručnu proveru **R35**.

**5. Onboarding postaje zasebna faza** — `LANSIRANJE.md` §1.8, sesije **S27** i **S28**:
čarobnjak od tri pitanja iz keša, prvi rezultat bez čekanja, vođen prvi prolaz uz element,
traka napretka **u bazi**, prazna stanja koja uče i vodič **na zahtev**. Nula Places poziva u
celom toku.

**6. O1 zatvoreno: prvi prospekt je besplatan.** `grant_credits(+1, 'onboarding')`,
`ref_id = user_id`, upisan u **`credits_topup`** i dodeljen **pri kreiranju profila**.

### Odluke koje nisu bile doslovno u zahtevu

- **Slug umesto `pri_` ID-ja u linku sa landinga.** Izabrana opcija je glasila „landing zna
  price ID-jeve"; to je nepotrebno. Preslikavanje već postoji u `lib/cenovnik.ts` i tamo mu je
  mesto — jedan izvor istine umesto dva koja moraju da se slažu baš u trenutku prelaska na
  produkciju.
- **Vodič postoji, ali samo na zahtev.** F8 §2 zabranjuje ture; zahtev je tražio „pun vodič".
  Zabrana ostaje na snazi za sve što se **pokreće samo** — nema ture koja iskoči, nema
  zatamnjenja, nema brojača „1 od 6". Vodič koji korisnik sam pozove nije ista stvar.
- **Besplatan kredit ide u `credits_topup`, pri kreiranju profila.** ‼️ Ovo je **ispravka
  greške od istog dana**: prvo je zapisano „lenjo, pre prvog otključavanja", jer tako traži
  F8 §2 i jer kredit tada ne može da ode na skeniranje. Provera koda pokazala je da to ne
  može da radi — `stanjePristupa()` pušta unutra samo pretplatu, betu ili
  `credits_topup > 0`, pa je nov nalog **`zakljucan`** i ne stiže ni do jednog dugmeta.
  Uz to `grant_credits` puni `credits_topup` isključivo za razlog `credit_pack`, pa bi
  kredit dodeljen kao `onboarding` završio u `credits_balance` i **ne bi otvorio pristup**.
  Cena ispravke: kredit sme da ode i na skeniranje, dakle **najviše jedan Places poziv po
  registrovanom nalogu** (€0,032) — prijavljeno po pravilu iz `CLAUDE.md`.
- **Traka napretka u bazi, ne u `localStorage`-u.** Skuplje za jednu migraciju, ali čovek koji
  nastavi sa telefona nastavlja gde je stao — i S25 iz iste kolone čita aktivaciju, bez drugog
  merenja.

### Usaglašena dokumentacija

| Fajl | Šta je promenjeno |
|---|---|
| `LANSIRANJE.md` | nove §1.7 i §1.8; P5 nadjačan uz zadržan trag; mapa isporuka (S23 ⊘, S24 prepisan, S27/S28 novi); sesije S23, S24, S27, S28; R20 otpao, R32 prepisan, R33–R38 novi, R37 zatvoren; go/no-go i §9 |
| `F8-landing.md` | tabela „Stanje na 27. avgust" na vrhu; baneri na §1 (beta ponuda je mrtva), §2 (nadjačano §1.8), §3 (isporučeno u S22) i §9 (otpalo sa S23) |
| `00-kontekst.md` | §2 nadjačan (naplata od prvog dana, beta je ručna); §3 dobio „Dva domena"; §6 dobio spisak **nadjačanih tvrdnji u starijim PRD-ovima** |
| `CLAUDE.md` | dva domena umesto jednog; landing nije u ovom repou; slug, ne `pri_` ID |
| `PROVERA-VIZUELNA.md` | nova §7c (pravne strane i futer); ispravljena stara stavka „Pretplata nije uslov" i brzi prolaz |
| `ROADMAP.md`, `REVIZIJA.md` | F8 i landing više nisu „nije rađeno" |

### Ostaje na meni

- **Ručni koraci R33–R38** — DNS za poddomen, Vercel domen i `NEXT_PUBLIC_LANDING_URL`, Clerk
  instanca na `app.`, Paddle `successUrl` i payment link, linkovi sa landinga, provera cena.
  **R38 (DNS) ide prvi** — Clerk i Paddle verifikuju domen koji već mora da odgovara.
- **Starije PRD faze se ne prepravljaju.** Njihove nadjačane tvrdnje su popisane na jednom
  mestu, u `00-kontekst.md` §6 — tamo se i gleda pre nego što se nešto iz F1–F12 primeni po
  inerciji.

---

## S24 — Preokret na `app.` poddomen i veze ka landingu ☑

**Isporučeno 2. septembra 2026.** Izvor: `docs/LANSIRANJE.md` sesija S24 i §1.7. **Bez
migracije**; ova isporuka ne dodiruje ni bazu, ni worker, ni red poslova. Preokret je
mrežni i konfiguracioni, u kodu se menjaju samo **linkovi**.

**Cilj, ispunjen:** aplikacija više ne misli da je sama na domenu. Logo na svakoj javnoj
strani vodi na prodajnu stranu, futer ima stavku „Početna", `/` ima put nazad, a
`/cenovnik` prima nameru sa landinga — pa čovek koji je kliknuo „Uzmi Pro" ne bira ponovo.

### Šta je urađeno

- **`lib/veze.ts`** — nov fajl i **jedino mesto u aplikaciji koje sme da zna domen
  landinga**. `LANDING_URL` iz `NEXT_PUBLIC_LANDING_URL`, uz normalizaciju kose crte na
  kraju (`landing("/cenovnik")` inače daje `//cenovnik`, što pregledač čita kao drugi
  host). Namerno **bez `server-only`**: ovo renderuju i klijentske komponente, a landing URL
  je javan po definiciji.
- **Logo vodi na landing**, ne na `/`: `/cenovnik`, `/welcome`, `/zakljucano`, sve tri
  pravne strane (kroz `components/pravni-okvir.tsx`), futer i `/` (i desktop i telefon).
  Svuda `<a href>`, ne `next/link` — landing je drugi origin i njega se ne prefetch-uje.
- **Futer** dobija stavku **„Početna"** kao jedini link koji izlazi sa poddomena; Cenovnik,
  tri pravna teksta i Kontakt ostaju unutrašnji.
- **`/`** dobija diskretan **„← Nazad na početnu"** ispod forme. Siv, bez akcenta: jedino
  primarno dugme na tom ekranu je u formi.
- **`lib/cenovnik-namera.ts` + `lib/cenovnik-namera-schema.ts`** — oblik namere odvojen od
  njenog čitanja. Razlog je bundle: šemu uvozi Zod, a oblik uvozi klijentski
  `cenovnik-ekran.tsx`; u istom modulu bi ceo Zod ušao u javnu stranu cena.
- **`/cenovnik` prima `?plan=`, `?ciklus=` i `?paket=`.** Ulogovan dobija preselektovan plan
  (akcenat, primarno dugme, bedž „Tvoj izbor") i ciklus na prekidaču. Gost dobija
  `/?nalog=nov&nazad=/cenovnik?plan=…`, pa se posle registracije vraća **na isti izbor**.
- **`test/veze.ts`** — nov test. Grepuje ceo `src/` da domen nije zakucan nigde van
  `lib/veze.ts`, proverava da logo svake javne strane vodi na landing, i vozi nameru kroz
  ~40 slučajeva, uključujući **zatvoren krug**: `putanjaZaPlan()` → `?nazad=` →
  `internaPutanja()` → `citajNameru()` mora da vrati isti izbor.

### Odluke koje nisu bile doslovno u zahtevu

- **`www` oblik kao podrazumevana vrednost, ne goli domen.** Prompt sesije i ručni korak
  **R33** su tražili `https://sajtoskop.com`, ali §1.7 nosi ‼️ napomenu da je kanonski oblik
  `www`. Provereno ponovo pri isporuci: goli domen odgovara **`308`** i preusmerava na
  `www`, pa bi svaki klik iz aplikacije plaćao suvišan skok. **R33 je ispravljen** u
  `LANSIRANJE.md`.
- **Checkout se NE otvara sam iz `?plan=`.** Kriterijum „gotovo kad" glasi „bez ijednog
  ponovnog biranja", što se doslovno čita kao automatski modal. Nije urađeno tako iz dva
  razloga: modal za plaćanje bez klika je UX koji niko nije tražio, a `/api/billing/checkout`
  pravi **Paddle transakciju** — na svako učitavanje strane, uključujući osvežavanje, „nazad"
  iz istorije i svakog bota koji otvori link sa landinga. Namera **preselektuje**; klik
  ostaje čovekov. Obrazloženje stoji i u zaglavlju `cenovnik-ekran.tsx`.
- **Akcenat se pomera sa Pro na izabran plan.** Do S24 je „Najčešći izbor" uvek bio Pro i
  uvek je nosio primarno dugme. Sa `?plan=starter` bi to značilo da čovek koji je izabrao
  Starter gleda ekran na kome je istaknuto nešto drugo. Sada bedž **„Tvoj izbor"** i primarno
  dugme idu na izabran plan, a Pro zadržava svoj bedž bez zelene podloge. §7.1 je i dalje
  poštovan: **jedno primarno dugme po ekranu**.
- **`?paket=` sam doskroluje** do sekcije, i kad u linku nema `#paketi`. Bez toga čovek koji
  je na landingu kliknuo „Dopuna 150" stigne na vrh cenovnika i ne vidi ono zbog čega je
  došao.

### Nađeno usput

- **`/api/cron/utisci-slike` je u komentaru slao `curl` na goli domen.** Posle preokreta je
  to landing, koji tu rutu nema — komanda bi vratila tuđ `404` i izgledala kao pao cron.
  Ispravljeno i u kodu i u ručnom koraku **R29**.
- **`apps/worker/src/lib/user-agent.ts`** nosi `https://sajtoskop.com/bot` u User-Agentu.
  **Namerno nije dirano** — to je stranica na **landingu**, ne u aplikaciji, i pravilo 12
  traži da postoji. Ulazi u ručne korake (v. niže).
- **CSP ne traži nijednu izmenu**, i to je provereno, ne pretpostavljeno: `form-action 'self'`
  važi za slanje formi, a mi landing samo **linkujemo** (navigacija, ne submit);
  `frame-ancestors 'none'` govori ko sme da uokviri nas, a landing nas ne uokviruje;
  `connect-src` bi bio potreban samo da aplikacija **zove** landing, a ne zove ga. `test/csp.ts`
  ostaje netaknut.
- **Nijedan redirect u kodu ne vodi na apsolutan domen** — provereno grepom za
  `redirect("http`, `permanentRedirect` i `next.config` redirekcije. Svi su relativni i
  ostaju tačni na poddomenu.
- **Nijedan mejl šablon ne šalje ljude na goli domen.** `lib/admin-mail.ts` pominje
  `sajtoskop.com` samo kao **tekst potpisa**, ne kao link — i to je tačno, jer je to i jeste
  adresa prodajne strane.

### Ostaje na meni

Sve je **van koda** i ide ovim redom — **R38 prvi**, jer Clerk i Paddle verifikuju domen koji
već mora da odgovara:

| # | Gde | Šta se pokvari ako se zaboravi |
|---|---|---|
| **R38** | DNS zapis za `app.` | Ništa ispod ne može ni da počne — Vercel ne izda sertifikat, Clerk i Paddle ne verifikuju domen. |
| **R33** | Vercel: domen `app.sajtoskop.com` + `NEXT_PUBLIC_LANDING_URL=https://www.sajtoskop.com` | Bez env-a logo vodi na podrazumevani domen (radi, ali se ne poštuje podešavanje). Ako goli domen ostane uperen na Vercel projekat aplikacije, **landing nestaje**. |
| **R32** | Clerk: domen instance na poddomen, sign-in/sign-up ostaju `/`, webhook destination na `app.` URL | Prijava vodi u krug ili u tuđ origin; `user.created` ne stiže, pa **nov nalog nema profil**. |
| **R34** | Paddle: default payment link na `app.sajtoskop.com`, verifikovan i odobren domen | `Checkout.open()` pukne sa „Something went wrong" — naplata ne radi uopšte. `successUrl` **ne traži ništa**: sklapa se iz `window.location.origin`. |
| **R36** | Linkovi sa landinga (gotov prompt u `docs/prompt-landing-veze.md`) | Pravne strane nedostupne sa prodajne strane → **Paddle KYC pada**; CTA bez sluga → cenovnik bez preselekcije, dakle ceo S24 radi u prazno. |
| **R35** | Cene na landingu naspram Paddle kataloga | Iznos na prodajnoj strani se razilazi sa naplaćenim — vidi se tek na računu. |
| — | **Stranica `/bot` na landingu** | `apps/worker/src/lib/user-agent.ts` je linkuje u User-Agentu. `404` tamo je loš izgled prema administratoru sajta koji nas proverava u logovima (pravilo 12). |

**Prompt za landing je već tačan** — `docs/prompt-landing-veze.md` opisuje baš ovaj oblik
linkova (`?plan=`, `?ciklus=`, `?paket=`, `#paketi`) i njegova završna napomena je
ažurirana: preselekcija više nije „radiće se u S24", nego radi.

### Preneto dalje

- **S27/S28 (onboarding):** `lib/veze.ts` je mesto za svaki nov link ka landingu. Domen se
  i dalje ne kuca u JSX — `test/veze.ts` to obara.
- **R28 (puna vizuelna provera):** dodata je sekcija **7d** u `docs/PROVERA-VIZUELNA.md`, sa
  spiskom nepoznatih vrednosti u query-ju koje **moraju** da daju običan cenovnik.
- **Rečenica o besplatnoj beti na `/`** je već ispravljena ranije (commit `09fc9c5`), pa
  zaostatak prenet iz S22 više ne stoji.

---

## S25 — Stripe backend, Paddle uklonjen, plaćen pristup kešu ☑

**Isporučeno 10. septembra 2026.** Izvor: `docs/naplata-stripe.md` (K1 prompt, §15) — **Paddle
uklonjen, v. `docs/naplata-stripe.md`**. Migracija **0025** (`supabase/migrations/0025_stripe.sql`,
doslovno iz §3 uz dve idempotentne popravke ispod). Commit: „S25: Stripe backend, Paddle removed,
paid cache access".

**Cilj, ispunjen u kodu:** Stripe je jedini provajder (hosted Checkout + Customer Portal, webhook
nad `Stripe.Event`); pristup kešu se plaća (D10, `search_access`); povraćaj razlike kad Google da
manje stranica (§14.4); dnevni limit AI varijanti se sprovodi (B1, `claim_ai_rewrite`).

### Šta je urađeno

- **Zavisnosti:** `@paddle/paddle-js` i `@paddle/paddle-node-sdk` uklonjeni; `stripe@22.6.1`
  dodat samo u `apps/web`. Worker nema nijedan Stripe ključ. `apiVersion` pinovana u
  `lib/stripe-server.ts` na **`2026-08-26.dahlia`** (verzija koju SDK nosi; ‼️ v. „Ostaje na meni").
- **Obrisano:** `lib/paddle-server.ts`, `lib/paddle-okruzenje.ts`, `scripts/paddle-doktor.ts`,
  `scripts/paddle-replay.ts`, `docs/naplata-paddle.md`, `docs/naplata-bez-firme.md`,
  `packages/shared/src/billing.ts` (+ izvoz), `test/admin-beta.ts` (→ `test/admin-komp.ts`),
  `package.json` skripte `paddle:*` (→ `stripe:doktor`, nov `scripts/stripe-doktor.ts` koji
  proverava 8 `lookup_key`-eva i kupon naspram `plans.ts`).
- **Baza (0025):** `profiles.stripe_customer_id` (+ unique), `komp_expires_at`, `invite_id`;
  `subscriptions` u Stripe obliku (PK `stripe_subscription_id`, `ciklus`, `lookup_key`,
  `trial_end`, `cancel_at_period_end`, `updated_at = event.created`); razlozi `trial_grant`,
  `komp_grant`, `expire`; RPC-ovi `apply_subscription` (nov potpis, `stale_ignored`),
  `apply_invoice_paid`, `apply_trial_start`, `expire_subscription_credits`, `admin_open_komp`
  (granica 2000), `redeem_invite`, `spend_credit_and_scan` (+ `p_ttl_days`, ishodi
  `cached`/`already_paid`, kolona `cost`), `has_search_access`, `refund_scan(job, pages)`,
  `admin_users_page` sa `komp_expires_at`/`sub_trial_end` i filterom `proba`; tabele
  `search_access` (RLS politika po obrascu `own unlocks` iz 0001), `access_invites`,
  `access_invite_redemptions`, `trial_fingerprints`; triger `profiles_komp_guard`.
- **Shared:** `plans.ts` — `komp` umesto `beta`, 150/450/1200, paketi 75/200 (€19/€49),
  `PLAN_PRICES`, `CREDIT_PACKS.lookupKey`, `ALL_LOOKUP_KEYS`, `kupovinaZaLookupKey`,
  `lookupKeyZaPlan/Paket`, `formatEur`, `GODISNJI_BONUS`, `TRIAL_DAYS = 7`, `TRIAL_CREDITS = 10`,
  `KOMP_DEFAULT_DAYS`, `AI_OUTREACH_DAILY_CAP = 200`; ništa sa `pri_`. `pristup.ts` — sedmo
  stanje **`proba`**, `beta` → `komp`, `PretplataZaPristup.trialEnd/cancelAtPeriodEnd`,
  `ProfilZaPristup.kompExpiresAt`, `STANJA_ZA_PAKET` = aktivan/otkazan/komp/proba. `db.ts` —
  novi tipovi za `search_access`, `access_invites`, `trial_fingerprints`, `redeem_invite`.
- **Web lib:** `env.ts` (`stripeServerEnv`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_COUPON_FIRST_MONTH`, `NEXT_PUBLIC_APP_URL`; `sellerName()` sa fallback „Remati LLC"),
  `stripe-server.ts` (singleton, `sk_live_` samo na `VERCEL_ENV=production`),
  `stripe-katalog.ts` (`lookup_key` → `price_`, keš po procesu), `billing.ts` (§6.1/6.3/6.4 nad
  `Stripe.Event`, oba oblika `invoice`/`subscription` polja, refund u komadima po 500),
  `billing-skladiste.ts` (RPC-ovi iz 0025 + otisak kartice kroz Stripe), `billing-schema.ts`
  (§5.1, `discriminatedUnion`), `veze.ts` (`appUrl()`), `pretplata.ts`, `pristup.ts`,
  admin fajlovi (beta → komp, ruta `/api/admin/korisnici/[id]/komp`), `ui-tekst.ts` (komp, proba,
  novi razlozi u knjizi), `jobs.ts` (`cost`, `hasSearchAccess`), `search-cache.ts`
  (`besplatno()` obrisana → `pokrivaKes()` + `cenaIzKesa()`, `listaKesa` nosi pristupe),
  `search-types.ts` (`ScanKind` + `kes`, `KesStavka.pristup`).
- **Rute:** `checkout` (§5.2 + `imaoProbuRanije()`), `webhook` (§6.2), `portal` (§8),
  `/api/search` (§14.3: `has_search_access` bez `pay`; budžet i dnevni osigurač SAMO kad ima
  Places poziva; `cached` → lista odmah sa `charged: true`), `/api/poruke/ai` (B1: 429 sa
  datumom reseta, `release_ai_rewrite` na pad upisa i na dupli klik).
- **Klijent:** `pretraga-ekran.tsx` (unija `Cena` bez `besplatno`, sa `pristup` i `kes`; modal
  za SVAKO prvo otvaranje, i iz liste keša), `skeniranje-modal.tsx` (razlog `kes`),
  `kes-lista.tsx` (blok „Tvoji pristupi", „u kešu do…"/„plaćeno do…"), `pretraga/page.tsx`,
  `cenovnik-ekran.tsx` (bez SDK-a; `formatEur`; `POST /api/billing/checkout` →
  `location.assign`), `cenovnik.ts` (`Tier.cena`, `Paket.eur`, red „Ako nađemo manje firmi…"),
  `cenovnik-namera*.ts` (`?paket=75|200`), `pretplata-blok.tsx` (iznos iz `plans.ts`, rečenica za
  `proba`/`komp`), `portal-dugme.tsx`, pravne strane i `/welcome` (prodavac je LLC iz
  `NEXT_PUBLIC_SELLER_NAME`, račun mejlom), `admin-radnje.tsx` i admin strane (komp).
- **Worker:** `db-writes.ts` `refundScan(jobId, pagesUsed = 0)`; `scan.ts` vraća razliku kad
  `apiCalls < stranica` (POSLE registra i grane za prazan rezultat — `refund_scan` je idempotentan
  po platiocu, pa bi delimičan povraćaj upisan pre punog pun proglasio duplikatom);
  `rewrite-message.ts` `release_ai_rewrite` na svaki pad; `monthly-grant.ts` samo `ciklus='year'`
  (preskače mesec `subscriptions.created_at`) i `plan='komp'`.
- **CSP:** `*.paddle.com` ispao iz svih pet direktiva; `test/csp.ts` sada traži da svaki host bude
  iz poznatog skupa (Clerk/Supabase/Cloudflare) i da Stripe host NE postoji (redirekcija).
- **Testovi:** `test/naplata.ts` prepisan — fiksture potpisane pravim
  `stripe.webhooks.generateTestHeaderString`, scenariji §12 #1, #2, #3, #8, #9, #10, #12, plus
  ponovljena proba, pogrešan potpis, `komp` iz webhooka, redosled događaja, prolazna greška;
  `test/lazno-skladiste.ts` nov interfejs; `test/pristup.ts` + proba/komp/otkazana proba;
  `test/admin-komp.ts`; `test/dubina.ts` + `cenaIzKesa` (25 firmi → 2, ne 3); `test/cenovnik.ts`
  i `test/veze.ts` (paketi 75/200, bez ID-jeva cena); `scripts/validate-migrations.ts` — Stripe
  RPC-ovi, `stale_ignored`, proba jednom po nalogu, `expire`, `redeem_invite` svi ishodi,
  `search_access` i `refund_scan(job, 2)`.
- **Docs/env:** `.env.example` blok Stripe (§11), `CLAUDE.md` (pravilo 3 sa RPC-ovima iz §3,
  5a sa D10, terminologija komp/proba/pozivnica), `docs/LANSIRANJE.md` linija na vrhu.

### Odstupanja od spec-a — namerna, ne previd

- **0024 dobija `drop function if exists admin_users_page(…9 args)`.** 0025 menja POVRATNI TIP
  te funkcije, pa drugi prolaz `pnpm check:sql` (0024 pa 0025 ponovo) pucao na „cannot change
  return type". Bezopasno u produkciji — 0025 je odmah iza i pravi je iznova.
- **Rename kolona u 0025 pada na `drop` kad nova kolona već postoji.** Drugi prolaz: 0022 ponovo
  doda prazne stare kolone (`add column if not exists`), a `rename` bi pukao na duplikatu.
- **Delimičan povraćaj ide posle registra i posle grane za prazan rezultat**, ne odmah posle
  `collectAndUpsert` kako prompt kaže — razlog gore (idempotencija `refund_scan`).
- **`NaplataSkladiste` ima dve metode više od §6.3:** `planPoPretplati` (rezerva za plan kad
  faktura ne nosi `lookup_key` u metapodacima) i `otisakKartice`/`naplatiProbuOdmah` (jedina dva
  Stripe poziva u obradi, izmešteni iz `billing.ts` da test ostane bez mreže).
- **`opcije.kuponPrvogMeseca`** se prosleđuje u `obradiDogadjaj` iz rute umesto da `billing.ts`
  čita env — isti razlog.
- **`grep -ri paddle … supabase`** nije 0: `0022_naplata.sql` je istorija (ne prepravlja se), a
  0025 mora da imenuje stare kolone da bi ih preimenovala. U `.ts/.tsx/.json`, `.env.example` i
  `CLAUDE.md` je 0; `pri_` u `apps packages` je 0.
- **`apiVersion`** je pinovana na verziju koju SDK nosi (`2026-08-26.dahlia`), ne na onu koju
  panel prikazuje — panel mi nije dostupan iz sesije. Ako se razlikuju, menjaju se
  `STRIPE_API_VERSION`, webhook endpoint i komentar u `.env.example` zajedno.
- **`apply_subscription` upisuje `plan_expires_at` i za `incomplete*`/`unpaid`** — doslovno po §3.
  Checkout pravi pretplatu tek posle uspešne naplate/setup-a, pa `incomplete` ne nastaje kroz
  naš tok; ako ikad nastane ručno u panelu, `current_period_end` bi dao pristup bez naplate.
  Zabeleženo, ne menjano.

### Nije urađeno u ovoj sesiji (traži Stripe nalog / lokalnu bazu)

- **Lokalni prolaz sa `stripe listen`** (§12 scenariji 1, 2 sa test clock-om, 10, 12) i **lokalni
  prolaz D10** (nov nalog, keš, refresh, „Duboko" nad gradom sa <40 firmi) — nisu izvršeni:
  sesija nema Stripe ključeve ni pristup bazi. Isti scenariji su pokriveni fiksturama u
  `test/naplata.ts` (potpis je pravi) i `pnpm check:sql` (search_access, refund razlike), ali
  izlaz `select reason, ref_id, delta from credit_ledger …` treba zalepiti ovde posle ručnog
  prolaza:

  ```
  -- §12 #1 (Pro mesečno, bez probe):
  -- §12 #2 (proba → plaćeno, test clock +8d):
  -- §12 #10 (paket 200):
  -- §12 #12 (prvi mesec gratis):
  -- D10 (keš → search_access, refresh 0 kredita, „Duboko" <40 firmi → refund):
  ```

### Ostaje na meni

| # | Gde | Šta |
|---|---|---|
| R39 | Stripe test mod | katalog iz §2.1 (8 cena sa `lookup_key`, EUR), kupon `Prvi mesec gratis` 100%/once, webhook endpoint sa događajima iz §6.1 i **istom API verzijom** kao `STRIPE_API_VERSION`; `pnpm stripe:doktor` mora da prođe |
| R40 | `.env.local` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (iz `stripe listen`), `STRIPE_COUPON_FIRST_MONTH`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, `NEXT_PUBLIC_SELLER_NAME` |
| R41 | Supabase | pusti 0025 (`beta` → `komp`, `subscriptions` se briše i pravi iznova — prazna je) |
| R42 | Vercel | Preview: test ključevi; Production: live ključevi + `NEXT_PUBLIC_APP_URL=https://app.sajtoskop.com`; **nikad isti `whsec_` u oba** |
| R43 | Stripe podešavanja §2.2 i §8 | Smart Retries 4×/7 dana + „cancel", mejlovi OFF, Customer Portal (bez pauze, `always_invoice` za upgrade) |
| — | ručni prolaz | scenariji iz „Nije urađeno" — zalepiti ledger ovde |

### Preneto dalje

- **K2 (S26):** cenovnik sa bedžom „Prvi mesec €0", proba UI (`pretplata-blok`, baner sa
  „Aktiviraj odmah", `/api/billing/aktiviraj`), `/welcome` čita sesiju, portal tekstovi.
- **K3 (S27):** UI pozivnica (`/admin/pozivnice`, `/pozivnica/[code]`, `/api/pozivnice/prihvati`).
  Baza i `redeem_invite` su gotovi u 0025.
- **P4:** mejlovi na `invoice.payment_failed`, `charge.dispute.created`.

---

## S26 — Stripe cenovnik, portal, proba UI, „Aktiviraj odmah" ☑ (kod) · ☐ (ručni prolaz)

**Isporučeno 11. septembra 2026.** Izvor: `docs/naplata-stripe.md` (K2 prompt, §15; §4, §5.4, §7,
§8). Bez migracije. Commit: „S26: Stripe cenovnik, portal, trial UI, aktiviraj odmah".

**Cilj, ispunjen u kodu:** sve što korisnik vidi o naplati radi nad Stripe-om; proba ima svoj UI i
dugme „Aktiviraj odmah" koje probu pretvara u plaćen plan danas.

### Šta je urađeno

- **`lib/cenovnik.ts`** — `Tier.cena` / `Paket.eur` iz `plans.ts` (od S25), red pogodnosti „Manje firmi
  nego što si tražio? Razliku vraćamo.", `PROBA_RECENICA` iz `TRIAL_DAYS`/`TRIAL_CREDITS` (dan naplate
  izveden kroz nov `redniDan()` u `ui-tekst.ts` — „osmog"), `mesecnoOdGodisnje()` („€24,17", u
  centima, bez `Intl`).
- **`cenovnik-ekran.tsx`** (ceo fajl) — rečenica o probi iznad kartica samo kad je nalog dobija
  (`probaDostupna`) i nikad uz pozivnicu; godišnje „(€24,17 mesečno)"; pozivnica → bedž „Prvi mesec €0" +
  „od drugog meseca €X" (samo mesečni ciklus); 403/409 prikazuju serversku rečenicu, a 409 `kod:
  "ima_plan"` dodaje link na `/krediti`; 401 → registracija sa povratkom; rečenica na dnu iz §4 sa
  `mailto:`.
- **`cenovnik/page.tsx`** — prosleđuje `gratisMesec` (iz `profiles.invite_id`) i `probaDostupna`
  (`nudiProbu()`: gost da, komp/pozivnica ne, inače `!imaoProbuRanije()`; kvar upita → ne obećava).
- **`lib/proba.ts`** (nov) — `imaoProbuRanije()` izmešten iz checkout rute; dele ga ruta i cenovnik.
- **`/api/billing/aktiviraj`** (nova) + **`lib/aktiviraj.ts`** (odluka bez Supabase/Stripe, zbog
  testa) — IP tempo 10/min, `requireUserId`, prazno telo kroz `aktivirajBodySchema =
  strictObject({})`, pretplata iz `subscriptions` po `user_id` + `status = 'trialing'`; otkazana proba
  → 409; pre izmene `subscriptions.retrieve` (dupli klik, kasni webhook, `metadata.user_id` mora da
  se poklapa); `subscriptions.update(id, { trial_end: "now", proration_behavior: "none",
  payment_behavior: "error_if_incomplete" })`; odbijena kartica → 402. Ruta ne dira ni kredite ni
  bazu — to rade webhookovi (`invoice.paid` `subscription_cycle` → 150).
- **`components/aktiviraj-odmah.tsx`** (nov) — sekundarno dugme + modal „Naplaćuje se €X sada, plan
  počinje danas."; dok naplata traje modal se ne zatvara; posle uspeha dva `router.refresh()` (odmah i
  posle 3 s, dok webhook stigne).
- **`pretplata-blok.tsx`** (ceo fajl) — `proba`: naslov „Proba do <datum>", rečenica „Osmog dana kartica
  se naplaćuje €X za <plan> i dobijaš <N> kredita…", „Aktiviraj odmah" pored primarnog „Dokupi
  kredite" (§7.1: primarno ostaje jedno); kasa se u probi zove „Probni". `otkazan` + `trialing`: „Proba
  otkazana, traje do <datum>". `past_due`: upozorenje „Naplata nije prošla. Ažuriraj karticu." +
  `PortalDugme` (umesto grace upozorenja, jer je izlaz kartica, ne nov plan). `komp`: „do <datum>" /
  „neograničeno". Stari komentar o iznosu obrisan.
- **`lib/pretplata.ts`** — `aktivacijaZa(pretplata)` → `{ eur, imePlana, krediti }` iz `plans.ts`;
  `null` van probe ili kad `lookup_key` nije naš (tada nema dugmeta).
- **`(app)/layout.tsx` → `okvir-aplikacije.tsx` → `pristup-baner.tsx`** — `proba` sa NULA kredita:
  „Probni krediti su potrošeni. Aktiviraj plan odmah ili sačekaj <datum>." + „Aktiviraj odmah"
  (mali, sekundarni). Drugi čitač pretplate (`citajPretplatuZaEkran`, `cache()`) zove se SAMO u tom
  slučaju. Otkazana proba u traci: „Proba je otkazana i traje do…".
- **`portal-dugme.tsx`** — tekst bira pozivalac („Upravljaj pretplatom" / „Računi i kartica" /
  „Ažuriraj karticu"); inline `style` sa `var(--danger)` → `text-danger`.
- **`krediti/page.tsx`** — prosleđuje `aktivacija`; `trialEnd`/`cancelAtPeriodEnd`/`eur` već nosi
  `PretplataZaEkran` (S25).
- **`/welcome`** — `?sesija=cs_…` (Zod regex) → `checkout.sessions.retrieve(…, { expand:
  ["subscription"] })` samo za tekst („Starter, mesečno, proba do 18. septembar 2026."), samo vlasniku
  (`client_reference_id === userId`); naslov „Proba je počela" / „Plaćanje je primljeno"; svaki kvar →
  tekst bez detalja. Ništa se ne upisuje.
- **Testovi:** nov `test/aktiviraj.ts` (409 van probe i bez Stripe poziva, aktivna/otkazana/`past_due`,
  pretplata iz baze po sesiji — nikad tuđa, šema odbija `subscriptionId`/`userId`/`null`/niz, 402,
  dupli klik, statičko ožičenje rute i klijenta); `test/cenovnik.ts` sekcije 3c/3d (cene i paketi
  75/200 iz `plans.ts`, `€24,17`/`€49,17`/`€99,17`, rečenica probe izvedena, nema `pri_`/`price_`/
  Paddle/`drzava`, bedž samo mesečno, 409 link, §4 rečenica, kupon samo mesečno, nigde „trial" u
  UI-u, jedno primarno dugme u bloku, traka tek na 0 kredita). `package.json` test skripta.
- **Provere:** `pnpm typecheck` (shared, web, worker, cli), `pnpm --filter @sajtoskop/web lint`,
  `pnpm --filter @sajtoskop/web test` — čisti. Nijedan hex/oklch u izmenjenim komponentama.

### Odstupanja od spec-a — namerna, ne previd

- **‼️ Kupon „prvi mesec gratis" samo uz mesečni ciklus (izmena checkout rute iz K1).** Kupon je 100%
  `duration: once` na PRVU fakturu — uz godišnji plan to je cela godina gratis (Pro €590, Advanced
  €1.190), a pozivnica obećava mesec. Sada `gratisMesec = invite_id !== null && ciklus === "month"`;
  godišnji izbor sa pozivnicom ide običnim putem (proba ako je nalog nije imao), a `invite_id` se briše
  na `checkout.session.completed` kao i pre. Ako je godina gratis bila namerna — jedan red u ruti.
- **`?pozivnica=1` se ne traži.** Checkout kupon primenjuje po `profiles.invite_id` bez obzira na link;
  ekran koji bi čekao parametar pokazao bi punu cenu i probu, a Stripe onda €0 bez probe. Izvor istine
  je `invite_id`, i na ekranu i u ruti.
- **`payment_behavior: "error_if_incomplete"` na aktivaciji** (spec traži samo `trial_end` i
  `proration_behavior`). Sa podrazumevanim `allow_incomplete` odbijena kartica završi probu i ostavi
  pretplatu u `past_due` — čovek izgubi probu klikom na „plati sada". Ovako Stripe odbije ceo update
  (402), proba traje.
- **`subscriptions.retrieve` pre `update`** — jedan Stripe poziv više; bez njega dupli klik posle
  uspešne aktivacije (baza još kaže `trialing`) šalje `trial_end: "now"` aktivnoj pretplati.
- **Rečenica o probi se skriva** nalogu koji je već imao probu, komp nalogu i uz pozivnicu — prompt je
  traži bezuslovno, ali checkout tim nalozima probu ne daje.
- **409 iz checkout-a nosi `kod`** (`ima_plan` / `komp`) — ekran se grana po ugovoru, ne po tekstu
  poruke.
- **`past_due` zamenjuje grace upozorenje u bloku** kad su oba tačna (kartica pala i period istekao):
  izlaz je nova kartica kroz portal, ne nov plan.

### Nije urađeno u ovoj sesiji (traži ključeve i Stripe CLI)

`apps/web/.env.local` u ovoj sesiji nema `STRIPE_*`, `NEXT_PUBLIC_APP_URL` ni `CLERK_SECRET_KEY`, a
`stripe` CLI nije instaliran — preduslov iz prompta („test ključevi u .env.local, stripe listen radi")
nije ispunjen, pa aplikacija nije podignuta. Ručni prolaz ostaje:

- [ ] (a) `/cenovnik` → checkout (4242) → `/welcome` pokazuje „Proba je počela" i „Starter, mesečno,
  proba do …" → `/krediti` pokazuje „Proba do <datum>"
- [ ] (b) potroši 10 kredita → traka „Probni krediti su potrošeni" → „Aktiviraj odmah" → modal → faktura
  odmah → `/krediti` pokazuje 150 i „Pretplata je aktivna" (+ kartica `4000 0000 0000 0341`: 402, proba
  ostaje)
- [ ] (c) portal: otkaži → traka „Proba je otkazana i traje do …" / blok „Proba otkazana, traje do …"
- [ ] (d) obe teme i 390 px na `/cenovnik` (gost, pozivnica, godišnje) i `/krediti` (proba, `past_due`) —
  snimci ovde:

  ```
  -- /cenovnik tamna 390:
  -- /cenovnik svetla 390:
  -- /krediti tamna 390:
  -- /krediti svetla 390:
  ```

### Ostaje na meni

| # | Gde | Šta |
|---|---|---|
| R40 | `.env.local` | i dalje otvoreno iz S25 — bez njega nema ni (a)–(d) |
| R44 | Stripe panel | proveriti da li **godišnji** kupac sa pozivnicom treba da dobije mesec — ako da, drugi kupon (`amount_off` = mesečna cena) umesto 100% `once`; do tada godišnji ide bez kupona |
| — | ručni prolaz | (a)–(d) iznad, snimci u ovaj unos |

### Preneto dalje

- **K3 (S27):** `/pozivnica/[code]` posle prihvatanja sme da vodi na `/cenovnik` bez parametra — bedž
  čita `invite_id`. *(S27: vodi na `/cenovnik?pozivnica=1`; parametar je samo oznaka, bedž i kupon
  idu po `invite_id`.)*

---

## S27 — Pozivnice: komp i prvi mesec gratis ☑ (kod) · ručni prolaz otvoren

**Isporučeno 11. septembra 2026.** Izvor: `docs/naplata-stripe.md` §9, §12 (#11, #12), K3 prompt
(§15). Migracija: **nijedna** — sve iz 0025 je bilo dovoljno. Commit: „S27: pozivnice (komp, prvi
mesec gratis)".

> **Redosled sa S26.** S27 je rađen na grani `s27-pozivnice` paralelno sa S26 (`s26-stripe-ui`),
> obe od S25; spojene u `main` istog dana (S26 fast-forward, pa merge S27). Jedina dodirna tačka je
> bedž „Prvi mesec €0" na cenovniku — S26 ga čita iz `profiles.invite_id`, dakle radi i posle
> redirekcije iz S27 i kad se korisnik na cenovnik vrati kasnije. Kupon je od S26 **samo uz mesečni
> ciklus** (v. S26, odstupanja; R44).

### Šta je urađeno

- **`lib/pozivnice-schema.ts`** (bez `server-only`, deli ga klijent): `pozivnicaPristupBodySchema`
  (`discriminatedUnion` po `kind`; komp: `komp_days` 1–365 ili `null` — izostavljeno ≠ `null`,
  `komp_credits` 0–2000; oba: `code` opciono, `email` opciono, `max_uses` 1–100, `note` ≤ 200),
  `kodSchema` (`upper(trim())` kao u `redeem_invite`), `prihvatiBodySchema` (strictObject — `userId`
  u telu je 400), `ISHOD_POZIVNICE` (rečenice §9.4 za svih 8 razloga), `ishodPrihvatanja()`,
  `porukaKompa()`, `opisPozivnice()`, `stanjePozivnice()`, `linkPozivnice()` (kroz `appUrl()`).
- **`lib/pozivnice-pristup.ts`** (server-only): `generisiKod()` (`SAJT-XXXX-XXXX`,
  `crypto.randomBytes`, azbuka od 32 znaka bez 0/O/1/I), `citajPozivnice()`,
  `napraviPozivnicu()`, `opozoviPozivnicu()`, `citajPozivnicuZaStranu()`, `prihvatiPozivnicu()` →
  `rpc("redeem_invite")`. Sve kroz `adminSupabase()` — obe tabele imaju RLS bez politika.
- **Rute:** `POST /api/admin/pozivnice/pristup`, `DELETE /api/admin/pozivnice/pristup/[id]` (obe
  `pripremiRadnju` → 404 za ne-admina + tempo, pa `saAuditom` → `admin_audit` i na uspeh i na pad);
  `POST /api/pozivnice/prihvati` (5/min po IP, `requireUserId`, `ensureProfile` pre RPC-a da
  svež nalog ne dobije `no_user`).
- **`/admin/pozivnice`:** nova sekcija „Pristupne pozivnice" iznad Clerk pozivnica
  (`components/admin-pozivnice-pristup.tsx`) — obrazac (tip, dana/bez roka, kredita, kod, upotreba,
  mejl, napomena) i tabela (kod + stanje + „za <mejl>" + napomena, tip, rok/krediti, n/m, ko — link
  na detalj korisnika, kad, Kopiraj link, Opozovi), filter Sve/Komp/Prvi mesec.
- **`/pozivnica/[code]`** (van `(app)`): kartica „Pozivnica za <pun pristup N dana i M kredita |
  prvi mesec gratis>"; gost dobija `AuthEkran` (registracija) sa `posle=/pozivnica/<kod>`,
  prijavljen dugme „Prihvati" (`components/pozivnica-prihvati.tsx`) sa mejlom naloga i „Odjavi se".
  Opozvana/istekla/iskorišćena pozivnica se vidi i bez prijave, bez dugmeta. `robots: noindex`.
- **`/dashboard?pozivnica=komp`:** potvrda „Komp pristup do <datum> / bez roka, N kredita."
- **Detalj korisnika:** blok „Pristup" dobija redove „Pozivnica" (kod + opis) i „Iskorišćena"
  (datum + „gratis mesec čeka checkout" / „potrošen u checkout-u"). „Otvori komp" je postojeći
  obrazac iz S20/S25 — nije diran.
- **Tačka 6 (webhook):** proverena, bez izmene — `billing.ts` već zove
  `oznaciPozivnicuIskoriscenom(userId)` na `checkout.session.completed` posle grane
  `mode !== "subscription"`, dakle za pretplatu a ne za paket. Test to sada drži statički.
- **Testovi:** `test/pozivnice.ts` (91 provera; u `pnpm --filter web test`): Zod šema, generator
  (5000 kodova: oblik, bez zabranjenih znakova, bez ponavljanja, svih 32 znaka), prihvati ruta 401
  bez sesije i 400 za šest loših tela, svih 8 ishoda → rečenica i status, statičke provere
  (omotač sa revizijom, payload bez mejla i koda, 5/min, RLS bez politika, checkout + webhook).

### Odstupanja od spec-a — namerna, ne previd

- **Opoziv `prvi_mesec` briše i `profiles.invite_id`** naloga koji su je prihvatili a još nisu
  prošli checkout. Checkout kupon ubacuje bez ikakve provere pozivnice, pa bi opozvana pozivnica
  inače i dalje davala gratis mesec. Komp se opozivom ne oduzima — ko ga je dobio, zadržava ga.
- **Radnje u reviziji su `invite.create` / `invite.revoke`**, iste kao za Clerk pozivnice (tako
  traži K3). Razlikuju se po `payload.tip = "pristupna"`. `payload` nosi id i parametre, **ne mejl
  i ne kod** (kod je pristup; `target_ref` = id je dovoljan trag).
- **„Tost" je `Alert` na kontrolnoj tabli**, ne tost — komponente za tost u projektu nema. Tekst se
  gradi iz profila, i prikazuje se samo ako je nalog stvarno `komp`, pa ručno otkucan query ne tvrdi
  ništa netačno.
- **`already_redeemed`** glasi „Ovaj nalog je već iskoristio jednu pozivnicu." umesto „Već si
  iskoristio pozivnicu." — rečenica ne pretpostavlja rod. Ostale su doslovno iz §9.4 (uz dopunu
  posle tačke gde pomaže: „za drugu adresu. Prijavi se nalogom sa adresom na koju je poslata.").
- **Statusi:** `not_found` 404, `revoked`/`expired` 410, `wrong_email` 403, ostalo 409, `no_user` 503.
- **Gost vidi registraciju, ne prijavu**, na samoj strani pozivnice (isti `AuthEkran` i isti `posle`
  kao `/?nalog=nov&nazad=`). Pozvani skoro nikad nemaju nalog; prijava je jedan klik na prekidaču.
  `internaPutanja()` ovde nije potrebna: putanja se sklapa na serveru iz koda koji je već prošao
  `kodSchema` (`A-Z0-9-`).
- **Ručni kod sme da ima 0/1/O/I** (admin ga bira svesno), 6–32 znaka; obrazac upozorava kad je
  ručni kod bez mejla — takav se da pogoditi.
- **`access_invites.expires_at` nije u obrascu** (nije ni u Zod listi iz prompta) — kolona ostaje
  `null`, pozivnica se gasi opozivom.
- **Clerk sekcija:** dugme „Pošalji pozivnicu" je sada sekundarno (jedno primarno po ekranu), a
  zastarela kopija „Pozovi u betu / profil sa 30 kredita" (netačna od S20) zamenjena je tačnom.

### Provereno

```
pnpm typecheck                → čisto (shared, web, worker, cli)
pnpm --filter web lint        → čisto
pnpm --filter web test        → sve prošlo (uklj. test/pozivnice.ts: 91/91)
pnpm check:sql                → sve prošlo (S25: redeem_invite — svi ishodi)
pnpm check:secrets            → bundle preskočen (nema .next build-a)
```

### Nije urađeno u ovoj sesiji (traži Stripe, bazu i Clerk ključeve)

Sesija nema `.env.local`, pa ni dev server, ni bazu, ni Stripe test mod.

- [ ] **Ručni prolaz §12 #11 (komp)** — admin napravi komp 30d/300 → nov nalog `/pozivnica/KOD` →
  „Prihvati" → drugi nalog istim kodom → „Kod je već iskorišćen."; checkout plana sa komp naloga → 409.
- [ ] **Ručni prolaz §12 #12 (prvi mesec)** — admin `prvi_mesec` → nov nalog → kod → checkout Pro
  (4242) → `invite_id` postavljen pa `null` posle `checkout.session.completed`, `invoice.paid`
  `amount_due = 0` → dodela 450, status `active`, `trial_end null`.
- [ ] **Tri poruke uživo:** isti kod drugi put → „već iskorišćen"; kod za drugi mejl → „za drugu
  adresu"; nalog sa planom → „Već imaš plan." (logika i rečenice pokriveni u `check:sql` i
  `test/pozivnice.ts`, ali ne kroz UI).
- [ ] **Vizuelno:** `/pozivnica/[code]` (gost, prijavljen, opozvana, nepostojeći kod) i
  `/admin/pozivnice` u obe teme i na 390 px.

Ledger izlaz posle ručnog prolaza (`select reason, ref_id, delta from credit_ledger where user_id =
… order by created_at`):

```
-- §12 #11 (komp 30d/300):
-- §12 #12 (prvi mesec gratis, Pro, MESEČNO — godišnji ne dobija kupon od S26):
```

### Ostaje na meni

| # | Gde | Šta |
|---|---|---|
| R45 | `/admin/pozivnice` | **Vladin komp nalog — NIJE napravljen ni poslat u ovoj sesiji** (sesija nema pristup produkciji). Napravi komp pozivnicu vezanu za Vladin mejl, pošalji link ručno, pa ovde upiši datum i kod: `poslato: ____ · kod: ____` |
| — | ručni prolaz | stavke iz „Nije urađeno" iznad, ledger zalepiti ovde |

### Preneto dalje

- **K6 / P4:** mejl korisniku sa pozivnicom (danas admin kopira link ručno).

---

## S28 — Onboarding + kartica prospekta ◐ DELIMIČNO (PRD nedostaje)

**Delimično isporučeno 12. septembra 2026.** Commit: „S28: onboarding + kartica prospekta"
(obim ispod). Migracija: **0026** (`onboarding`).

### ‼️ Zašto delimično — `docs/tok-i-onboarding.md` ne postoji

Zahtev sesije traži da se radi iz `docs/tok-i-onboarding.md` (§0 C1–C6 i O2–O6, §1.8–1.13,
§2.3, §2.5, §4 CEO, §7 CEO), i da tekstovi budu **doslovno** iz njega (§4.2 četiri ekrana
čarobnjaka, §4.3 migracija, §4.5 tačke i traka, §4.7 prazna stanja, §7.8 tekstovi kartice).

**Tog fajla nema** — ni u radnom stablu, ni u `git log --all`, ni kao referenca u ijednom
drugom fajlu (provereno `find`, `grep -rl`, `git log --diff-filter=A`). Sve što o onboardingu
postoji u repozitorijumu je LANSIRANJE §1.8 (D8, O1), a ona je izričito **nadjačana** §4 tog
dokumenta na dva mesta koja menjaju ponašanje (2 kredita umesto 1; prva lista se plaća).

Zato je isporučeno **samo ono što je nedvosmisleno iz samog zahteva sesije** i ne zavisi od
teksta dokumenta. Ostalo nije improvizovano: petnaest komponenti sa izmišljenim srpskim kopijem
koje posle treba prepisati naspram §4/§7 je gore od ničega (CLAUDE.md, „ne improvizuj tiho
zaobilaznicu"; zahtev sesije, „ako nešto iz §4/§7 ne može kako piše — reci tačno šta").

### Šta JE urađeno

- **`supabase/migrations/0026_onboarding.sql`** — idempotentna, `pnpm check:sql` prolazi u oba
  prolaza:
  - `profiles`: `onboarding_steps jsonb not null default '{}'` (+ `check jsonb_typeof = 'object'`),
    `onboarding_done_at`, `onboarding_skipped_at`, `onboarding_hints_seen text[] not null default '{}'`.
    Imena su ista kao u LANSIRANJE §6 (stari S27 prompt). **`onboarding_city/niche/channel` NISU
    dodate** — one su odgovori čarobnjaka, a čarobnjak nije u ovom obimu; oblik i ograničenja su
    u §4.3.
  - `grant_credits`: razlog **`onboarding` sada puni `credits_topup`**, uz `credit_pack`. To nije
    kozmetika — `credits_balance` ne otvara pristup nalogu bez plana, pa bi nov nalog sa kreditima
    dobrodošlice i dalje bio `zakljucan` (§1.5, O1). Telo je inače nepromenjeno iz 0025 (pravilo 3:
    nema nove putanje za kredite).
  - `create_profile_with_grant`: dodela ide sa razlogom **`onboarding`** (bilo `monthly_grant`).
    Idempotencija nepromenjena — `credit_ledger_grant_idem_idx` pokriva `onboarding`.
  - **`onboarding_mark_step(p_user, p_step)`** — četiri koraka (`pretraga`, `otkljucavanje`,
    `poruka`, `pipeline`), objekat `{korak: timestamp}`; idempotentno (`already`, trenutak se ne
    pomera), sva četiri → `onboarding_done_at`, **nepoznat korak i `null` BACAJU** (ključ upisuje
    ruta sa zakucanim stringom; tiho `false` bi bio traka koja se nikad ne završi).
    `security definer`, samo `service_role`.
  - `admin_users_page`: `drop` + `create` sa `onboarding_done_at` i `onboarding_skipped_at`
    (obrazac iz 0025 §7).
- **`ONBOARDING_CREDITS = 2`** u `packages/shared/src/plans.ts` (+ barrel), i
  `lib/profile.ts` → `KREDITI_NA_REGISTRACIJI = ONBOARDING_CREDITS` (bilo `0`).
- **O3 — grace se broji i od registracije.** `ProfilZaPristup.createdAt`; grana 4
  `stanjePristupa()` računa grace nad `kasniji(punDo, createdAt)`. `punDo` u odgovoru ostaje
  plaćeni rok (dakle `null` za nov nalog), menja se samo `citanjeDo`. Tip `grace` zato ima
  `punDo: string | null`, što je nateralo tri UI grane na istinu:
  `/pretraga` prazno stanje, `pristup-baner.tsx` i `pretplata-blok.tsx` sada razlikuju
  „Pristup ti je istekao <datum>." od **„Besplatni krediti su potrošeni."**, a i `odbijenica()`
  u `lib/pristup.ts` ima isti razdvojen uvod. Rečenice **nisu** iz §2.3 (v. „Ostaje").
  Prosleđivanje `created_at`: `lib/pristup.ts`, `lib/admin-korisnici.ts` (tri poziva, uz kolonu
  u `select`-u), `api/billing/checkout/route.ts`. Ko sme da kupi paket se NE menja —
  `STANJA_ZA_PAKET` ne prima ni `grace` ni `zakljucan`.
- **C6 — brisanje naloga otkazuje žive pretplate PRE brisanja profila.**
  Nov `lib/otkazivanje.ts` (server-only): `STATUSI_ZA_OTKAZIVANJE = trialing/active/past_due`,
  `otkaziPretplateNaloga(userId, customerId, klijent?)` — jedan `subscriptions.list({status:"all"})`
  pa filter u kodu, `subscriptions.cancel(id, {prorate:false})` po pretplati,
  `customers.update(metadata: {deleted_user, deleted_at})` **posle** otkazivanja. Baca na svaku
  Stripe grešku. Stripe klijent je ULAZ (`StripeZaOtkazivanje`, tri funkcije) da bi test postojao
  bez mreže — isti obrazac kao `NaplataSkladiste`.
  `lib/profile.ts` → `stripeKupacZaNalog()` (baca na grešku baze: „ne znam da li ima pretplatu"
  nije „nema"). `api/webhooks/clerk/route.ts`: u `user.deleted` prvo kupac → otkazivanje → pa
  `obrisiProfil`; pad → marker se briše, revizija sa `ok:false`, **500** (Svix ponavlja) i profil
  ostaje. `admin_audit.payload` nosi spisak otkazanih i preskočenih pretplata, ništa o kartici.
- **Testovi:**
  - `packages/shared/test/pristup.ts` — O3: nov nalog sa kreditima → `dopuna`; potrošeni → `grace`
    bez `punDo`, `citanjeDo = registracija + GRACE_DAYS`; 29. dan grace, 31. zaključano; star nalog
    sa isteklim planom ostaje zaključan; pretplatniku grace i dalje ide od plaćenog roka.
  - `apps/web/test/clerk-webhook.ts` (nov, u `pnpm --filter web test`) — lažni Stripe: otkazuju se
    tačno tri statusa, `prorate: false`, mrtve pretplate se ne diraju, marker posle otkazivanja,
    pad baca i **ne** upisuje marker; statički: redosled (kupac → otkazivanje → `obrisiProfil`),
    500 u `catch`-u, revizija bez podataka o kartici.
  - `scripts/validate-migrations.ts` — `create_profile_with_grant` daje **2 u `credits_topup`** i
    ne dira `credits_balance` (iznos iz `ONBOARDING_CREDITS`, ne otkucan); `onboarding_mark_step`
    (no_user, nepoznat korak baca, `null` baca, `already` bez pomeranja trenutka, četiri koraka →
    `done_at`, `skipped_at` ostaje `null`, `onboarding_steps` mora biti objekat);
    `admin_users_page` vraća dve nove kolone; `onboarding_mark_step` u spisku prava.
  - **Ispravljene dve zastarele tvrdnje:** invarijanta u `check:sql` je sada
    `sum(delta) = credits_balance + credits_topup` (dve kase, registracija puni dopunu), a
    `test/admin-komp.ts` traži `KREDITI_NA_REGISTRACIJI = ONBOARDING_CREDITS` umesto `= 0`.
    §1.1 time nije prekršen: on zabranjuje besplatan **plan**, ne kredite — nalog ostaje `dopuna`.

### Šta NIJE urađeno — čeka `docs/tok-i-onboarding.md`

Sve ispod traži doslovan tekst ili strukturu iz dokumenta; ništa od toga nije započeto:

- [ ] `packages/shared/src/onboarding.ts` — KORACI (§4.5), tekst tačaka i trake
- [ ] `apps/web/src/lib/onboarding.ts` — `zahtevajOnboarding()` + poziv u pet strana
- [ ] `/pocetak` — čarobnjak (§4.2, četiri ekrana, kombinacije iz `listaKesa()`), `?pozivnica=komp`,
      `?ponovo=1`, prazan keš; **plus kolone `onboarding_city/niche/channel` u 0026**
- [ ] `api/onboarding/{korak,preskoci,hint}` + upis koraka iz `api/search`, `lib/unlock.ts`,
      `api/pipeline`
- [ ] `onboarding-traka.tsx` + `OnboardingProvider`; brisanje bloka „Prvi koraci" sa `/dashboard`
- [ ] `vodjena-tacka.tsx` (§4.5), `vodic.tsx` (§4.8)
- [ ] prazna stanja iz §4.7 (`PraznoStanje` se proširuje, ne dublira)
- [ ] **KARTICA PROSPEKTA (§7)** — `kartica-prospekta.tsx`, pet stanja, tekstovi §7.8 u
      `lib/ui-tekst.ts`, `LeadBase` + `ratingCount/hasEmail/nicheLabel/issueCount`,
      `UnlockResponse.enrichJobId`, ponovni `enrich_full` enqueue, brisanje `lead-tabela.tsx`,
      grid u `pretraga-ekran.tsx` i `moja-lista-ekran.tsx`, polling §7.4, modal §7.3, tab Poziv,
      tost „Kopirano. Označi kao kontaktiran?", 402 tekst; `test/kartica.ts`, `test/unlock.ts`
- [ ] baneri §1.12 / §2.3 (grace sa uzrokom, „Nalog čeka plan") — **rečenice koje su sada u kodu
      su moje, ne iz §2.3**: „Besplatni krediti su potrošeni." na tri mesta + u `odbijenica()`.
      Kad dokument stigne, ovo su prva četiri mesta koja se prepisuju.
- [ ] `/api/pozivnice/prihvati` → `/pocetak?pozivnica=komp`; `/welcome` dugme „Napravi prvu listu"
- [ ] `test/onboarding.ts` (TS strana kataloga koraka) — SQL strana je u `check:sql`

### Provereno

```
pnpm typecheck             → čisto (shared, web, worker, cli)
pnpm check:sql             → Sve prošlo (0026 u oba prolaza; 2 kredita u topup; mark_step)
pnpm test                  → sve prošlo (shared: pristup + smoke; web: 11 fajlova)
pnpm --filter web lint     → čisto
pnpm build                 → čisto
```

### Ostaje na meni

| # | Gde | Šta |
|---|---|---|
| — | `docs/tok-i-onboarding.md` | **Dokument u repozitorijum.** Bez njega ostatak S28 ne može da se radi bez izmišljanja kopija. |
| — | migracija `0026` | Primeniti na Supabase pre deploya (nov nalog do tada dobija 2 kredita u `credits_balance`, što ga NE pušta unutra). |
| — | ručni prolaz | Brisanje naloga iz Clerk-a sa živom test pretplatom → pretplata `canceled` PRE nego što profil nestane (screenshot Stripe eventa ovde). Onboarding prolazi i `api_budget` izlaz nemaju šta da testiraju dok čarobnjaka nema. |
