# Postavljanje servisa od nule — Supabase, Clerk, Vercel

Ručni koraci koji se ne mogu automatizovati: nalozi, ključevi i klikanje po konzolama, za
novo okruženje (nova produkcija, odvojena dev baza). Redosled je bitan. Worker na Hetzneru:
`docs/worker-hetzner.md`. Stripe: `docs/naplata-stripe.md` §2, §8, §11 i
`docs/lansiranje-checklista.md` sekcija 6. Spisak svih env promenljivih: `.env.example`.

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

Zatim na pravi projekat, **sve migracije redom** (idempotentne su). Connection string:
Dashboard → **Connect → Session pooler**.

```bash
read -s DB_URL && export DB_URL
for f in supabase/migrations/*.sql; do echo "$f"; psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" || break; done
```

Poslednji ispisan fajl mora da bude najnovija migracija, bez greške. Za pojedinačnu novu
migraciju isto radi Dashboard → **SQL Editor** → nalepi fajl → Run.

**Provera:** Dashboard → **Storage** → bucket `screenshots` postoji i **privatan** je
(pravi ga migracija). Bucket **`feedback`** napravi ručno: New bucket, Public = off, bez
ijedne politike — bez njega `POST /api/feedback/slika` vraća `502`.

---

## 3. Clerk aplikacija

1. [dashboard.clerk.com](https://dashboard.clerk.com) → **Create application**
2. Uključi **Email** i **Google**. Ostalo isključi.
3. **API Keys** → prepiši u `.env`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Srpska lokalizacija je već podešena u kodu (`srRS` u `apps/web/src/app/layout.tsx`).
Forma za prijavu i registraciju je na `/`; `/prijava` i `/registracija` su redirekcije.
Za **produkcijsku** instancu: domen `app.sajtoskop.com`, i sopstveni Google OAuth klijent
(v. `docs/lansiranje-checklista.md` 1.10) — Clerkovi deljeni kredencijali rade samo u
development instanci.

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
3. Events: **`user.created`**, **`user.updated`** i **`user.deleted`** (bez poslednjeg brisanje
   naloga u Clerku ne briše profil ni ne otkazuje Stripe pretplatu — pravilo 15)
4. **Signing Secret** (počinje sa `whsec_`) → `.env`:

```
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
```

Lokalno webhook ne stiže do `localhost` bez tunela. Ne moraš da ga podešavaš odmah:
aplikacija ima rezervni put koji napravi profil pri prvoj poseti, i idempotentan je
sa webhookom (ne može da dodeli kredite dobrodošlice dvaput). Kad budeš hteo da testiraš pravi
webhook lokalno: `ngrok http 3000` i stavi tu adresu kao endpoint.

---

## 6. Seed i provere

```bash
pnpm install
pnpm seed --dry     # izveštaj, baza se ne dira
pnpm seed           # upis
pnpm check:f1       # provere iz „Gotovo kad"
```

`pnpm seed --dry` daje izveštaj o arhivi skeniranja (u avgustu 2026: 172 firme, 52% bez
funkcionalnog sajta).

> Seed odbija scan čije niše nema u `packages/shared/src/taxonomy.ts` —
> takav red uđe u bazu, ali ga `/api/search` nikad ne vrati, jer prima samo
> slugove iz taksonomije. Scanovi `izrada-sajtova` i `web-dizajn-agencija`
> (istraživanje konkurencije, 116 biznisa) zato stoje u
> `data/scanovi-arhiva/van-taksonomije/` i ne učestvuju u seedu. U bazi su i
> dalje, od prvog seeda — otuda razlika između 288 redova u bazi i 172 iz arhive.

`pnpm check:f1` pravi privremen profil, pokreće 20 paralelnih otključavanja sa
jednim kreditom i briše profil za sobom.

---

## 7. Pokretanje

```bash
pnpm dev            # http://localhost:3000
```

Napravi nalog na `/`, pa proveri da te aplikacija vodi na čarobnjak `/pocetak` i da nalog
ima **2 kredita** (dobrodošlica, `ONBOARDING_CREDITS`). Ako umesto brojki stoji žuto
upozorenje — korak 4 nije dovršen.

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

Env promenljive: tabela u `docs/lansiranje-checklista.md`, stavka 1.1 (Supabase, Clerk,
Stripe, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_LANDING_URL`, `CRON_SECRET`, Resend,
`PLACES_MONTHLY_BUDGET_EUR`…).

Google, PageSpeed i Anthropic ključevi **ne idu na Vercel** — oni žive na workeru
(pravilo 7: Playwright i lančani fetch nikad u Vercel funkciji).
