# Sajtoskop

Lead-gen alat: pronalazi biznise u Srbiji sa lošim ili nepostojećim sajtovima
i priprema outreach materijal za web dizajnere, frilensere i agencije.

Domen: sajtoskop.com · Autor: Marko Milenković / Remati · Solo developer.

## Kontekst i planovi

Pre rada na bilo kojoj fazi pročitaj:

- `docs/00-kontekst.md` — proizvod, arhitektura, model podataka, terminologija
- `docs/F{N}-*.md` — PRD za trenutnu fazu; **radi samo iz jednog PRD-a u jednoj sesiji**
- `docs/bezbednost.md` — P0 lista, referenciraj kad faza dodiruje kredite, storage ili renderovanje sajtova
- `docs/DIZAJN-SISTEM.md` — **obavezno pre bilo kakvog UI rada**; v. „Dizajn" niže

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
3. **Krediti se menjaju samo kroz `spend_credit_and_unlock` ili `grant_credits`.** Nikad direktan `UPDATE profiles.credits_balance`.
4. **`unlocks` je PK `(user_id, place_id)`.** Korisnik nikad ne plaća isti lead dvaput.
5. **Skupi enrichment ide isključivo lazy, na unlock.** Screenshot, PageSpeed i Claude poziv nikad u bulk scanu.
6. **Ugly Score živi samo u `packages/shared/src/ugly-score.ts`.** Jedan izvor istine za web, worker i CLI. Ne duplirati logiku, ne „prilagoditi" kopiju.
7. **Playwright i lančani HTTP fetch nikad u Vercel funkciji.** Samo worker.
8. **`user_id` isključivo iz verifikovane Clerk sesije na serveru.** Nikad iz request body-ja, query parametra ni headera.
9. **Zaključana polja ne postoje u API odgovoru.** Server izbacuje `phone`, `email`, `website_url`, `ugly_score`, `ai_issues`, `screenshot` za sve što nije otključano. CSS blur nije bezbednost.
10. **RLS uključen na svakoj tabeli.** `businesses` i `website_audits` imaju `using (false)` — čitanje ide isključivo kroz API rute.
11. **`country_code` u svakoj relevantnoj tabeli od prvog dana.** Region dolazi kasnije, migracija ne.
12. **Crawling:** poštuj `robots.txt`, identifikujući User-Agent, max 1 zahtev/s po domenu.

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
| ugly score | Ugly Score (ne prevodi) |
| band | Solidan / Osrednji / Ružan / Katastrofa |
| kanban kolone | Nekontaktiran / Kontaktiran / Odgovorio / Potpisan / Nezainteresovan |
| credits | krediti |

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
| `--shadow-*` kao imena sirovih promenljivih | `--elev-*`, pa `@theme inline` mapira na `--shadow-*` | `--shadow-*` je Tailwind-ov prostor imena; direktno bi bila kružna referenca. Vrednosti iste. |

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
