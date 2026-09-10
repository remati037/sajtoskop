# Sajtoskop

Lead-gen alat: pronalazi biznise u Srbiji sa lošim ili nepostojećim sajtovima
i priprema outreach materijal za web dizajnere, frilensere i agencije.

**Dva domena:** `sajtoskop.com` je **landing** i **nije u ovom repozitorijumu** —
ne pravi ga i ne prepravljaj ga odavde. `app.sajtoskop.com` je aplikacija iz `apps/web`.
Na landing se pokazuje kroz `NEXT_PUBLIC_LANDING_URL`, nikad zakucanim domenom; landing na
aplikaciju pokazuje slugom plana, **nikad Stripe `price_` ID-jem** (`docs/LANSIRANJE.md` §1.7).
Naplata je **Stripe** (hosted Checkout + Customer Portal, `docs/naplata-stripe.md`); nijedan
Stripe ID (`prod_`, `price_`, `cus_`, kupon) ne ulazi u kod — samo `lookup_key` iz `plans.ts` i env.

Autor: Marko Milenković / Remati · Solo developer.

## Kontekst i planovi

Pre rada na bilo kojoj fazi pročitaj:

- `docs/00-kontekst.md` — proizvod, arhitektura, model podataka, terminologija
- `docs/F{N}-*.md` — PRD za trenutnu fazu; **radi samo iz jednog PRD-a u jednoj sesiji**
- `docs/bezbednost.md` — P0 lista, referenciraj kad faza dodiruje kredite, storage ili renderovanje sajtova
- `docs/DIZAJN-SISTEM.md` — **obavezno pre bilo kakvog UI rada**; v. „Dizajn" niže
- `docs/LANSIRANJE.md` — **plan do lansiranja**: otvorene odluke, sesije S16–S23 sa gotovim
  promptovima, ručni koraci R1–R28 i go/no-go lista. Prvi fajl koji se otvara ako pitanje
  glasi „šta je još ostalo".
- `docs/SESIJE.md` — redosled preostalih isporuka i gotov prompt za svaku sledeću sesiju.
  **Posle svake završene isporuke ovaj fajl se ažurira** (štiklirano gotovo, dopisano šta se
  promenilo u odnosu na PRD).

Ne implementiraj funkcije iz kasnijih faza jer su „usput". Faze su namerno sekvencijalne.

## Stack

```
apps/web        Next.js 15 App Router · TypeScript · Tailwind · shadcn/ui · Clerk · Vercel
apps/worker     Node 24 · tsx · Playwright · Hetzner CX22 · Docker
apps/cli        Node 24 · tsx · commander — postojeći CLI, ostaje živ
packages/shared ugly-score · taxonomy · translit · csv · queries · tipovi
```

Baza: Supabase Postgres + Storage. Auth: Clerk kao third-party provider u Supabase-u.
Red poslova: **Postgres tabela `job_queue`** sa `FOR UPDATE SKIP LOCKED`. Ne Redis, ne BullMQ.

## Jezik

- UI, kopi, generisane poruke, AI izlaz, greške koje korisnik vidi → **srpski, latinica, sa dijakritikom**
- Kod, imena varijabli, komentari, commit poruke, imena tabela i kolona → **engleski**

## Nepregovarljiva pravila

1. **Google polja imaju TTL 30 dana.** Nikad ne serviraj Google podatak stariji od 30 dana — proveri `google_refreshed_at`, pa zakaži refresh. `place_id` se čuva neograničeno.
2. **Svaki Places poziv ima eksplicitan `X-Goog-FieldMask`.** Nikad `*`. Field mask određuje SKU i time ceo troškovni model.
3. **Krediti se menjaju samo kroz `spend_credit_and_unlock`, `spend_credit_and_scan` ili `grant_credits`.** Nikad direktan `UPDATE profiles.credits_balance`. (`grant_monthly_credits` i `refund_scan(job, pages)` su izuzeci objašnjeni u migracijama 0004, 0009 i 0025 — `refund_scan` od S25 vraća i **razliku** kad Google da manje stranica nego što je plaćeno.) Od F11/F12 postoje još dva omotača, oba `security definer` i oba samo za `service_role`: `grant_feedback_credits` (0011) i `admin_adjust_credits` (0012 — **jedini put za negativan iznos**, jer `grant_credits` po definiciji odbija negativan). Od S25 (0025) Stripe webhook ide isključivo kroz `apply_subscription` (stanje, bez kredita), `apply_invoice_paid` (mesečna dodela, ref `in_…`), `apply_trial_start` (10 probnih, jednom po nalogu), `expire_subscription_credits` (pražnjenje na `subscription.deleted`) i `apply_credit_pack` (paket, ref `pi_…`); komp pristup kroz `admin_open_komp` ili `redeem_invite`. `grant_credits` interno validira `reason`; nov razlog znači izmenu i `check` ograničenja i tela funkcije.
4. **`unlocks` je PK `(user_id, place_id)`.** Korisnik nikad ne plaća isti lead dvaput.
5. **Skupi enrichment ide isključivo lazy, na unlock.** Screenshot, PageSpeed i Claude poziv nikad u bulk scanu.
5a. **Nijedan Places poziv iz weba nema besplatan put.** `scan` posao ulazi u red isključivo kroz `spend_credit_and_scan` (F9). Od S25 (D10) **i pristup kešu se plaća**: ista funkcija naplaćuje pristup (`search_access`, 30 dana, do plaćene dubine) — iz svežeg keša bez posla (`cached`, cena = broj stranica koje postoje), inače uz `scan` posao. Besplatno je samo ono što je korisnik već platio (`has_search_access`).
6. **Ugly Score živi samo u `packages/shared/src/ugly-score.ts`.** Jedan izvor istine za web, worker i CLI. Ne duplirati logiku, ne „prilagoditi" kopiju.
7. **Playwright i lančani HTTP fetch nikad u Vercel funkciji.** Samo worker.
8. **`user_id` isključivo iz verifikovane Clerk sesije na serveru.** Nikad iz request body-ja, query parametra ni headera.
9. **Zaključana polja ne postoje u API odgovoru.** Server izbacuje `phone`, `email`, `website_url`, `ugly_score`, `ai_issues`, `screenshot` za sve što nije otključano. CSS blur nije bezbednost.
10. **RLS uključen na svakoj tabeli.** `businesses` i `website_audits` imaju `using (false)` — čitanje ide isključivo kroz API rute.
11. **`country_code` u svakoj relevantnoj tabeli od prvog dana.** Region dolazi kasnije, migracija ne.
12. **Crawling:** poštuj `robots.txt`, identifikujući User-Agent, max 1 zahtev/s po domenu.
13. **Admin se proverava u svakoj ruti i na svakoj strani**, nikad samo u layout-u. Uloga je `profiles.role`, uz `ADMIN_BOOTSTRAP_IDS` kao rezervu iz env-a. Ko nije admin dobija **`404`**, ne `403` — postojanje ekrana se ne otkriva.
14. **Svaka admin mutacija upisuje red u `admin_audit`**, i na uspeh i na pad. `payload` nikad ne sadrži lozinku, token ni ključ.
15. **Brisanje naloga ide kroz Clerk, pa kaskada.** `user.deleted` webhook je jedini put do brisanja profila; `businesses` i `website_audits` ostaju jer nisu korisnikovi podaci.
16. **Pitanje iz kataloga utisaka ne postoji dok nije u `feedback-katalog.ts`.** Ruta odbija nepoznat `prompt_key` sa `400`, a `answers` se validira Zod šemom iz kataloga — nikad generičkim recordom.

## TypeScript konvencije

- ESM svuda, `"type": "module"`
- **Importi bez ekstenzija.** `import { uglyScore } from "./ugly-score"` — ne `./ugly-score.ts`. Next.js bundler ne podnosi `.ts` u importima.
- `packages/shared` eksportuje kroz `src/index.ts` barrel; web ga učitava preko `transpilePackages`
- Zod 4 za sve granice (CLI argumenti, API body, env)
- `strict: true`, bez `any` u novom kodu; ako je neizbežno, `unknown` + narrow

## Komande

```bash
pnpm typecheck                 # tsc --noEmit po paketu
pnpm --filter web dev
pnpm --filter worker dev
pnpm --filter cli scan -- --grad=sabac --nisa=pvc-stolarija --mock
```

`--mock` i `--offline` postoje da se ne troši Google kvota. Koristi ih u razvoju uvek kad je moguće.

## Budžet — nije opciono

Places API: 1.000 poziva mesečno besplatno. Trošak posle toga je stvaran novac iz mog džepa,
a beta korisnici ne plaćaju ništa.

- Dnevni i mesečni brojač u tabeli `api_budget`, dan se računa po `America/Los_Angeles` (Google resetuje kvotu u 09:00 po lokalnom vremenu)
- `consume()` se poziva **pre svakog HTTP zahteva**, uključujući svaku stranicu paginacije
- Na 429 → `markExhausted()`, zaustavi posao, vrati parcijalan rezultat sa `partial: true`
- Pre-flight `assertAvailable(n)` pre svakog scana

Ako predlažeš kod koji povećava broj Places poziva, reci mi to eksplicitno pre nego što ga napišeš.

## Terminologija u UI-u

| Kod | UI |
|---|---|
| lead / business | prospekt |
| unlock | otključaj |
| scan (plaćen Places poziv) | skeniranje — nikad „pretraga", pretraga po kešu je besplatna |
| ugly score | Ugly Score (ne prevodi) |
| band | Solidan / Osrednji / Ružan / Katastrofa |
| kanban kolone | Nekontaktiran / Kontaktiran / Odgovorio / Potpisan / Nezainteresovan |
| credits | krediti |
| feedback | utisak — nikad „feedback" ni „povratna informacija" |
| feedback sa statusom | prijava (ekran „Moje prijave") |
| prompt / survey | pitanje; nikad „anketa" |
| changelog | Beta dnevnik |
| komp (bivša beta) | komp pristup — nikad „beta nalog" |
| trial | proba — nikad „trial" |
| invite (pristupna) | pozivnica |
| admin panel | admin konzola |
| audit log | revizija |

## Radni stil koji mi odgovara

- Kad je fajl prošao kroz više izmena, daj mi **ceo fajl**, ne parcijalni diff
- Pre veće izmene reci u jednoj rečenici šta menjaš i zašto
- Ako nešto u PRD-u ne radi u praksi, reci mi — ne improvizuj tiho zaobilaznicu
- Migracije baze pišem kao numerisane SQL fajlove u `supabase/migrations/`, nikad ručno u konzoli

## Dizajn

**Pre bilo kakvog UI rada pročitaj `docs/DIZAJN-SISTEM.md`.** Boje, fontovi, logo,
radijusi, senke i komponente su fiksni. Ne izmišljaj nove tokene ni nove nijanse zelene.

- **Nijedan hex ni oklch u JSX-u.** Sve ide kroz tokene iz `apps/web/src/app/globals.css`,
  koji su prepis §3.1 dokumenta. Treba ti boja koje nema → prvo se dopisuje u dokument,
  pa u `globals.css`, pa se koristi. Pitaj pre nego što je dodaš.
- **Jedan akcenat, limeta zelena.** Crvena, narandžasta i žuta postoje samo kao semantika
  Ugly Score-a i grešaka, nikad kao dekoracija.
- `--accent` je za **podloge**. Zelena kao tekst ide isključivo kroz `--accent-text` —
  `--accent` na `--bg` pada na kontrastu u svetloj temi.
- **Obe teme se testiraju**, ne samo tamna. `.dark` klasa se dobija skriptom u `<head>`-u.
- **`.num` na svaki broj**, ID, URL i telefon. Tabela sa brojevima koji skaču je pokvarena.
- Font-weight staje na **600**. Ikonice iz `lucide-react`, bez emodžija.
- Jedna senka po elementu, jedno primarno dugme po ekranu, bez ugnježđenih kartica.

### Odstupanja od dokumenta — namerna, ne previd

| Dokument | Kod | Zašto |
|---|---|---|
| `data-theme="dark"` + ključ `sajtoskop-theme` (§7.9) | `.dark` klasa + ključ `sajtoskop-tema` | Mehanički ekvivalentno. Obrazloženje iz dokumenta (deljen izbor sa landing sajtom) ne stoji — `localStorage` je po origin-u, pa `app.` i goli domen ionako ne dele ključ. |
| Tri stanja teme: svetla / sistem / tamna (§7.9) | Dva: **tamna (podrazumevana)** i svetla | Proizvod ima jedan izgled po kome se pamti. „Sistem" je značio da isti korisnik na dva računara vidi dve aplikacije i da pola snimaka ekrana ispadne u svetloj temi bez ijedne odluke. Svetla tema ostaje i dalje se testira. Stara vrednost `sistem` u `localStorage`-u pada na tamnu, bez migracije. |
| `--shadow-*` kao imena sirovih promenljivih | `--elev-*`, pa `@theme inline` mapira na `--shadow-*` | `--shadow-*` je Tailwind-ov prostor imena; direktno bi bila kružna referenca. Vrednosti iste. |
| `--radius-*` kao imena sirovih promenljivih (§3.1) | `--r-sm` / `--r` / `--r-lg` (10 / 14 / 20 px), pa `@theme inline` mapira na `--radius-sm/md/lg/xl/2xl` | Isti razlog kao `--elev-*`: `--radius-*` je Tailwind-ov prostor imena. Postoje i `--radius-sm` (6 px) i `--radius-md` (8 px) kao pravi tokeni — dokument ih nema; `--radius-lg` i naviše su mapirani na `--r-*`. |

### Tokeni dopisani mimo dokumenta

Nema ih u §3.1; dodati su jer ih proizvod stvarno traži. Ako se dokument ikad ažurira,
ovi idu u njega.

- `--bg-hover` — hover na `--bg-subtle` površinama (stavka u bočnoj traci, ghost dugme)
- `--warn-text`, `--warn-wash`, `--warn-ink` — `--warn` kao tekst na beloj podlozi daje
  ~3.4:1, ispod AA
- `--info`, `--info-text`, `--info-wash`, `--info-ink` — skala statusa u pipeline-u traži
  pet razdvojivih boja; dokument plavu ima samo kao `--glow-2`
- `--scrim` — zavesa ispod modala i mobilne fioke; ne može kroz `--bg` jer je u svetloj
  temi bela
