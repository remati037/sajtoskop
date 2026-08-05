# F0 — Monorepo i preseljenje CLI koda

**Cilj:** postojeći CLI radi identično iz nove monorepo strukture, a `packages/shared` je
upotrebljiv i iz Nodea i iz browsera.

**Procena:** 2–3 dana · **Preduslov:** koraci 1–6 iz `PRENOS.md` odrađeni ručno

**Ovo nije faza u kojoj se piše nova funkcionalnost.** Ako se pojavi ideja za poboljšanje
Ugly Score-a ili Places klijenta — zapiši je u `docs/ideje.md` i nastavi.

---

## 1. Struktura koju gradiš

```
sajtoskop/
├── package.json              workspace root, samo skripte
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── CLAUDE.md
├── docs/
├── data/scanovi-arhiva/      CSV/JSON iz starih scanova (gitignored)
├── supabase/migrations/      prazno do F1
├── packages/
│   └── shared/
│       ├── package.json      name: @sajtoskop/shared
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts      barrel — jedini javni ulaz
│           ├── ugly-score.ts
│           ├── taxonomy.ts
│           ├── translit.ts
│           ├── queries.ts
│           ├── csv.ts
│           └── types.ts      novo
└── apps/
    ├── cli/
    │   ├── package.json      name: @sajtoskop/cli
    │   └── src/index.ts
    ├── worker/               samo skelet u F0
    └── web/                  prazno do F2
```

---

## 2. Konfiguracija

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Root `package.json`

```json
{
  "name": "sajtoskop",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "scan": "pnpm --filter @sajtoskop/cli scan"
  },
  "engines": { "node": ">=24" }
}
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

**Namerno izostavljeno:** `allowImportingTsExtensions`. Svi importi u novom repou su bez ekstenzije.

### `packages/shared/package.json`

```json
{
  "name": "@sajtoskop/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^4.0.0" }
}
```

Paket se **ne buildira**. Web ga učitava kroz `transpilePackages: ["@sajtoskop/shared"]`
(dodaje se u F2), worker i CLI kroz `tsx`.

---

## 3. Zadaci

- [ ] Workspace konfiguracija iz sekcije 2
- [ ] **Inventar prenetog koda.** Pre bilo kakve izmene izlistaj stvarne eksporte iz `ugly-score.ts`, `taxonomy.ts`, `translit.ts`, `queries.ts`, `csv.ts` i prijavi ih. Barrel se piše prema stvarnom stanju.
- [ ] Ukloni `.ts` ekstenzije iz svih importa u prenetim fajlovima
- [ ] `packages/shared/src/index.ts` — barrel sa eksplicitnim re-eksportima. Bez `export *`.
- [ ] `packages/shared/src/types.ts` — zajednički tipovi koji su do sada bili razbacani po CLI-u:
  - `SiteStatus` (`"ok" | "nema_sajt" | "samo_drustvene" | "mrtav"`)
  - `UglyBand` (`"solidan" | "osrednji" | "ruzan" | "katastrofa"`)
  - `PlaceRecord`, `AuditRecord` — oblik koji će u F1 mapirati na tabele
- [ ] **`taxonomy.ts`: dodaj `countryCode: "RS"` u tip `City` i u sve zapise.** Pravilo 11 iz CLAUDE.md.
- [ ] `apps/cli` — `package.json`, `tsconfig.json`, `bin` ili `scan` skripta, importi prebačeni na `@sajtoskop/shared`
- [ ] `apps/worker` — samo skelet: `package.json`, `tsconfig.json`, `src/index.ts` koji ispisuje „worker skelet" i izlazi. Preneti moduli u `src/lib/` se **ne diraju** u F0 osim uklanjanja `.ts` ekstenzija.
- [ ] `apps/web` — ostaje prazan folder do F2
- [ ] `pnpm typecheck` prolazi u svakom paketu

---

## 4. Poznate zamke

**`api-budget.ts` piše u fajl sistem.** U F0 ostaje kakav jeste — CLI ga koristi lokalno.
Prelazak na Postgres je zadatak F3. Ne dirati sada, ali zabeležiti da modul **ne sme** da završi
u `packages/shared` jer bi ga onda web pokušao da učita.

**`places.ts` čita `process.env.GOOGLE_MAPS_API_KEY` u vrhu modula.** Ako se to izvršava pri
importu a ne pri pozivu, pucaće u okruženjima gde ključ ne postoji. Prebaci čitanje u funkciju.

**`fetch-site.ts` i `harvest-emails.ts` koriste Node-only API-je** (`node:dns`, `undici`, TLS
opcije). Oni pripadaju workeru, nikad shared paketu. Ako ih shared barrel slučajno re-eksportuje,
Next.js build će pući tek u F2 i biće teško povezati uzrok.

**`ugly-score.ts` mora biti čist.** Bez `node:` importa, bez fajl sistema, bez mreže — ulaz je
HTML string i metapodaci, izlaz je skor i signali. Ako trenutno nije takav, izdvoji nečisti deo
u worker.

---

## 5. Gotovo kad

```bash
pnpm typecheck                                    # prolazi svuda
pnpm scan -- --grad=sabac --nisa=pvc-stolarija --mock
```

- Izlaz je **znak po znak identičan** izlazu iz arhiviranog repoa za isti `--mock` ulaz
- Nijedan fajl u `packages/shared/src` ne importuje ništa iz `node:`
- `git log` ima commit „F0: monorepo skelet, CLI radi iz nove strukture"

---

## 6. Ne radi u ovoj fazi

- Ne piši Supabase klijent, migracije ni auth
- Ne diraj logiku Ugly Score-a ni Places klijenta osim mehaničkih izmena importa
- Ne postavljaj Next.js aplikaciju
- Ne piši testove osim jednog smoke testa za `uglyScore()` ako ga nemaš
- Ne uvodi build korak za `packages/shared`

---

## 7. Prompt za sesiju

```
Radimo docs/F0-monorepo.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Kreni od zadatka „Inventar prenetog koda" — izlistaj stvarne eksporte iz svih
fajlova u packages/shared/src i reci mi šta si našao, pre nego što napišeš
index.ts. Takođe mi javi ako neki od tih fajlova importuje bilo šta iz node:.

Ne piši ništa dok mi ne pokažeš inventar.
```
