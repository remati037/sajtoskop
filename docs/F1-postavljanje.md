# F1 — postavljanje (ručni koraci)

Kod je napisan i proveren. Ovo je lista onoga što se ne može automatizovati:
nalozi, ključevi i klikanje po konzolama. Redosled je bitan.

---

## 1. Supabase projekat

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Region: **Central EU (Frankfurt)** — `eu-central-1`. Ne menjaj posle.
3. Sačuvaj lozinku baze u menadžer lozinki. Prikazuje se jednom.
4. **Project Settings → API**, prepiši u `.env`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public>
SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
```

> `service_role` zaobilazi RLS. Nikad sa `NEXT_PUBLIC_` prefiksom, nikad u
> `"use client"` fajlu, nikad u poruci na Slacku. `pnpm check:secrets` to proverava.

**Jedan `.env`, u korenu monorepoa.** Ne pravi `apps/web/.env`. Next po pravilu čita
`.env` iz svog direktorijuma, pa ga `next.config.ts` izričito učitava iz korena;
CLI i worker isto, kroz `loadRootEnv()`. Redosled prvenstva ostaje normalan:
env sa servera (Vercel, Hetzner) > `apps/web/.env.local` > koren `.env`.

> Kad menjaš `.env`, **restartuj dev server**. Next učitava env jednom, pri podizanju.

---

## 2. Migracija

Prvo lokalno, bez mreže — pokreće celu migraciju u Postgresu koji radi u WASM-u:

```bash
pnpm check:sql
```

Zatim na pravi projekat. **Preporučeno** (ostaje istorija, ne traži Docker):

```bash
supabase link --project-ref <ref>
supabase db push
```

Ako `link` pravi problem, alternativa je Dashboard → **SQL Editor** → nalepi ceo
`supabase/migrations/0001_init.sql` → Run. Radi isto, ali Supabase onda ne zna da
je migracija primenjena, pa sledeći `db push` pokušava da je ponovi. (Migracija je
idempotentna, pa i to prolazi — ali istorija ti je razbijena.)

**Provera:** Dashboard → **Storage** → mora da postoji bucket `screenshots` i mora
da bude **privatan**. Migracija ga pravi; ako ga nema, napravi ga ručno kao privatan.

---

## 3. Clerk aplikacija

1. [dashboard.clerk.com](https://dashboard.clerk.com) → **Create application**
2. Uključi **Email** i **Google**. Ostalo isključi.
3. **API Keys** → prepiši u `.env`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Srpska lokalizacija je već podešena u kodu (`srRS` u `apps/web/src/app/layout.tsx`),
kao i putanje `/prijava` i `/registracija`. Ne treba ništa u konzoli.

---

## 4. Clerk kao auth provider u Supabase-u

**Ovo je korak koji čini da RLS uopšte radi.** Bez njega `auth.jwt() ->> 'sub'`
u politikama je `null`, dashboard pokazuje žuto upozorenje umesto kredita.

1. **Clerk Dashboard → Configure → Integrations → Supabase** → **Activate**
2. Clerk ti da svoj domen (oblika `<nesto>.clerk.accounts.dev`). Prepiši ga.
3. **Supabase Dashboard → Authentication → Sign In / Providers → Third-Party Auth**
   → **Add provider** → **Clerk** → nalepi domen → Save.

> Ovo je novi, nativni put. **Ne** pravi JWT template u Clerku — taj način je
> deprecated od aprila 2025. i traži deljenje Supabase JWT tajne.
>
> Ako ovo iz bilo kog razloga ne proradi — **javi mi pre nego što zaobiđeš**.
> Varijanta u kojoj web koristi `service_role` za korisničke upite uklanja RLS
> kao zaštitni sloj i to je tvoja odluka, ne moja.

---

## 5. Clerk webhook

1. **Clerk Dashboard → Configure → Webhooks → Add Endpoint**
2. URL: `https://<tvoja-vercel-domena>/api/webhooks/clerk`
3. Events: **`user.created`** i **`user.updated`**
4. **Signing Secret** (počinje sa `whsec_`) → `.env`:

```
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
```

Lokalno webhook ne stiže do `localhost` bez tunela. Ne moraš da ga podešavaš odmah:
dashboard ima rezervni put koji napravi profil pri prvoj poseti, i idempotentan je
sa webhookom (ne može da dodeli 30 kredita dvaput). Kad budeš hteo da testiraš pravi
webhook lokalno: `ngrok http 3000` i stavi tu adresu kao endpoint.

---

## 6. Seed i provere

```bash
pnpm install
pnpm seed --dry     # izveštaj, baza se ne dira
pnpm seed           # upis
pnpm check:f1       # provere iz „Gotovo kad"
```

`pnpm seed --dry` trenutno daje **288 biznisa, 100 bez funkcionalnog sajta (35%)**.
Te brojke idu na landing u F8.

`pnpm check:f1` pravi privremen profil, pokreće 20 paralelnih otključavanja sa
jednim kreditom i briše profil za sobom.

---

## 7. Pokretanje

```bash
pnpm dev            # http://localhost:3000
```

Napravi nalog na `/registracija`, pa proveri da `/dashboard` pokazuje **30 kredita**.
Ako pokazuje žuto upozorenje umesto brojki — korak 4 nije dovršen.

### Ako dobiješ HTTP 431

„Request Header Fields Too Large" — pregledač šalje više kolačića nego što Node
prima (podrazumevano 16 KB). Nije greška u kodu.

Kolačići se pamte po **hostu**, ne po portu, pa `localhost` deli jednu gomilu sa
svakim projektom koji si ikad pokrenuo na toj adresi. Clerk dev instanca uz to
dodaje nekoliko krupnih JWT-ova (`__session`, `__client_uat`, `__clerk_db_jwt`).

Dev skripta zato diže limit na 64 KB (`NODE_OPTIONS=--max-http-header-size=65536`
u `apps/web/package.json`). To važi **samo za `next dev`** — produkcija na Vercelu
ima svoje limite i ovo je ne dodiruje.

Ako i to ne pomogne, obriši kolačiće za `localhost`:
Chrome → DevTools (`⌥⌘I`) → **Application** → Storage → Cookies → `http://localhost:3000`
→ desni klik → **Clear**. Posle toga se prijavi ponovo.

---

## 8. Vercel

**Project Settings → General:**

| Podešavanje | Vrednost |
|---|---|
| **Root Directory** | `apps/web` |
| **Include source files outside of the Root Directory** | uključeno |
| Framework Preset | Next.js (dolazi iz `apps/web/vercel.json`) |
| Build / Install / Output | ostavi podrazumevano |

Oba prva reda su obavezna i oba ume da promakne:

- Bez **Root Directory** Vercel gleda koren monorepoa, tamo nema `next` u
  `package.json`, pa pada na „Other" preset i traži `public/` direktorijum.
  Greška glasi: *No Output Directory named "public" found after the Build completed.*
- Bez **Include source files outside of the Root Directory** build ne vidi
  `packages/shared` ni `pnpm-workspace.yaml`, pa `pnpm install` puca na
  nerazrešen `workspace:*`.

Ako je projekat već jednom napravljen sa „Other" presetom, promena Root Directory-ja
ne resetuje uvek preset — zato `apps/web/vercel.json` izričito postavlja
`"framework": "nextjs"`, što je jače od vrednosti iz konzole.

Env promenljive (Production i Preview):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
CLERK_WEBHOOK_SIGNING_SECRET
```

Google, PageSpeed i Anthropic ključevi **ne idu na Vercel** — oni žive na workeru
(pravilo 7: Playwright i lančani fetch nikad u Vercel funkciji).

---

## 9. Šta namerno nije urađeno u F1

- Pretraga i lista prospekata → F2
- Worker i red poslova → F3
- Google Cloud quota limit ispod besplatnog praga → postaviće se u F3, kad prvi
  put krene pravi Places saobraćaj iz aplikacije
- shadcn/ui komponente → F8, kad postoji dizajn
- Mesečno obnavljanje kredita (cron) → F4, uz naplatu
