# Naplata — Stripe, tehnički spec

> Napisano 10. septembra 2026 kao spec za prelazak sa Paddle-a na Stripe; isporučeno u
> sesijama **S25–S27**, dopunjeno popravkama `0029`–`0034` (v. `docs/dnevnik-isporuka.md`).
> Ovo je i dalje referenca za to **kako naplata radi**: katalog (§2), checkout (§5), webhook
> (§6), proba (§7), portal (§8), pozivnice (§9), mesečna dodela (§10), env (§11), plan
> testova (§12) i ekonomija kredita (§14). Kad se kod i ovaj dokument razilaze, merodavan je
> kod, a razlika se ispravlja ovde.
>
> Odluke D1–D13 i A1–A8 pominjane u tekstu donete su van repoa, pre pisanja spec-a, i ne
> otvaraju se ponovo. Pominjani `LANSIRANJE.md`, `SESIJE.md` i `PROVERA-VIZUELNA.md` obrisani
> su 16. 9. 2026 — zamenjuju ih `docs/lansiranje-checklista.md`, `docs/dnevnik-isporuka.md` i
> `docs/plan-testiranja.md`.

## 0. Tri stvari u postojećem kodu koje menjaju plan

Navedeno pre svega jer utiče na svaku sekciju ispod. Nije improvizovano oko njih — svaka je rešena u jednoj tačno određenoj sekciji.

| # | Šta je nađeno | Gde | Posledica | Rešeno u |
|---|---|---|---|---|
| B1 | **`claim_ai_rewrite` / `release_ai_rewrite` (0022 §9) niko ne zove.** `apps/web/src/app/api/poruke/ai/route.ts` proverava samo `odbijenica()` i `jeOtkljucan()`, pa pušta `enqueueRewrite`. `aiRewritePerDay` sa cenovnika (5/20/60) ne postoji u praksi; jedini stop je globalni `AI_OUTREACH_DAILY_CAP = 40` u workeru, i on je manji od Advanced obećanja (60). | `api/poruke/ai/route.ts`, `plans.ts` | Obećanje na cenovniku nije sprovedeno; „nijedna akcija ispod cene koštanja" ne važi za AI varijantu | §14, K1 |
| B2 | **Worker `monthly_grant` POSTAVLJA `credits_balance` SVIM profilima po `profiles.plan`** (`grant_monthly_credits`, `p_target = planFor(plan).monthlyCredits`). Sa Stripe probom je `profiles.plan = 'starter'` već od dana 0 (pretplata postoji, status `trialing`). Korisnik koji uđe u probu 28. u mesecu dobija 1. u mesecu **100 kredita umesto 10**, pre prve naplate. Isti posao briše i `komp` balans na 0 ako `PLANS.komp.monthlyCredits` nije podešen. | `apps/worker/src/jobs/monthly-grant.ts`, `0004` | Proba curi kredite | §10 |
| B3 | **`stanjePristupa()` ne razlikuje `trialing` od `active`** — `PretplataZaPristup.status` ga nosi, ali odluka gleda samo `canceled`/`canceledAt`. Unija stanja je zatvorena („drugog nema i ne sme da nastane"). Proba mora da ima svoj baner, svoje dugme „Aktiviraj odmah" i svoj tekst na `/krediti`. | `packages/shared/src/pristup.ts` | Nema gde da se prikaže proba | §7 |
| B4 | **Besplatan put kroz keš je ugrađen na tri sloja**, ne u jednu granu: `besplatno()` u `lib/search-cache.ts`, grana `if (uKesu && !(pay && force))` u ruti, i klijentska unija `Cena` sa `vrsta: "besplatno"` u `components/pretraga-ekran.tsx` (koja odlučuje da li se `pay: true` uopšte šalje). Uz to `kes-lista.tsx` i `pretraga/page.tsx` pišu „besplatno do…". D10 zato nije brisanje jedne grane nego novi mehanizam **pristupa** (§14.3). | `search-cache.ts`, `api/search/route.ts`, `pretraga-ekran.tsx`, `kes-lista.tsx` | D10 traži novu tabelu i novi RPC | §3, §14.3, K1 |
| B5 | **`refund_scan` vraća SVE ili ništa** (poziva se samo za `inCity.length === 0` i za neupisan registar). Pravilo „manje rezultata → razlika" traži delimičan povraćaj, a worker već zna tačan broj stvarno napravljenih Places poziva (`apiCalls` u `collectAndUpsert`). | `0023`, `apps/worker/src/jobs/scan.ts` | Refund razlike ne postoji | §3, §14.4 |
| B6 | **`cenovnik-ekran.tsx` ne zna nijedan iznos** — sve cifre dolaze iz `Paddle.PricePreview()`. `plans.ts` namerno nema cene. Sa Stripe hosted Checkout-om nema `PricePreview`, pa ekran bez cena u kodu ostaje prazan. | `cenovnik-ekran.tsx`, `cenovnik.ts`, `plans.ts` | Cene moraju u `plans.ts` | §4 |
| B7 | **`billing_events.event_id`, `subscriptions.paddle_subscription_id` (PK), `profiles.paddle_customer_id`, `SubscriptionRow`/`ProfileRow` u `db.ts`, `admin_users_page` (vraća `beta_expires_at`), `profiles_beta_guard` triger, `admin_open_beta`** — sve nosi Paddle/beta imena u bazi i tipovima. `pnpm check:sql` pušta migraciju dvaput, pa `rename column` mora kroz `do $$ … if exists $$`. | `0022`, `0024`, `db.ts` | Migracija 0025 je veća nego što prompt opisuje | §3 |
| B8 | **`test/naplata.ts` i `test/lazno-skladiste.ts` verifikuju pravi Paddle HMAC** (`paddle.webhooks.unmarshal`). Sa Stripe-om je to `stripe.webhooks.constructEvent` nad `whsec_` — test se prepisuje, ne prepravlja. | `apps/web/test/` | K1 mora da prepiše test | §12, K1 |

Ništa od ovoga ne sprečava plan; sve staje u K1–K3. Ali bez B2 i B4 prvi kupac bi dobio ili kredite koje nije platio, ili skeniranje koje nije platio.

---

## 1. Šta se briše i šta ga zamenjuje

### 1.1 Fajlovi

| Briše se | Zamena |
|---|---|
| `apps/web/src/lib/paddle-server.ts` | `apps/web/src/lib/stripe-server.ts` — jedan `new Stripe(STRIPE_SECRET_KEY, { apiVersion })`, `server-only` |
| `apps/web/src/lib/paddle-okruzenje.ts` | **nema zamene.** Hosted Checkout je redirekcija; pregledač ne učitava nijedan Stripe skript i nema `NEXT_PUBLIC_STRIPE_*` |
| `scripts/paddle-doktor.ts`, `scripts/paddle-replay.ts` + `package.json` skripte `paddle:doktor`, `paddle:replay` | `scripts/stripe-doktor.ts` (proveri da svih 8 `lookup_key` postoji i da su iznosi jednaki `plans.ts`) + `stripe:doktor` skripta. Replay = `stripe events resend evt_…` iz Stripe CLI-ja, nema našeg fajla |
| `docs/naplata-paddle.md` | `docs/naplata-stripe.md` = ovaj dokument, kopiran u repo |
| `docs/naplata-bez-firme.md` | briše se (LLC postoji) |
| `apps/web/test/naplata.ts`, `apps/web/test/lazno-skladiste.ts` | prepisani nad Stripe događajima (§12) |
| `apps/web/test/admin-beta.ts` | `apps/web/test/pozivnice.ts` |

### 1.2 Kod koji se menja u mestu (ne briše)

| Fajl | Šta ide |
|---|---|
| `packages/shared/src/plans.ts` | `PLAN_PRICE_IDS`, `CREDIT_PACKS.priceId`, `ALL_PRICE_IDS`, `planForPriceId`, `creditsForPriceId`, `kupovinaZaPriceId`, `PLAN_BY_PRICE_ID`, `CIKLUS_BY_PRICE_ID`, `PAKET_BY_PRICE_ID`, ceo komentar „PADDLE KATALOG"; `PlanId` gubi `beta`, dobija `komp`; `BETA_DEFAULT_DAYS` → `KOMP_DEFAULT_DAYS` |
| `packages/shared/src/pristup.ts` | stanje `beta` → `komp`; dodaje se `proba`; `STANJA_ZA_PAKET` |
| `packages/shared/src/db.ts` | `ProfileRow.paddle_customer_id` → `stripe_customer_id`; `beta_expires_at` → `komp_expires_at`; `SubscriptionRow` novi oblik; `AdminOpenBetaResult` → `AdminOpenKompResult`; `AdminUserRow` kolone |
| `packages/shared/src/index.ts` | re-exporti |
| `packages/shared/src/billing.ts` | `FreeBetaProvider` i `NotImplementedError` — brišu se; `BillingProvider` interfejs ostaje prazan izvoz koji niko ne zove → **obriši ceo fajl**, `index.ts` prestaje da ga izvozi |
| `apps/web/src/lib/env.ts` | `paddleServerSchema`, `paddleDiscountSchema`, `paddleServerEnv()`, `paddleBetaDiscountId()` → `stripeServerSchema`, `stripeServerEnv()` |
| `apps/web/src/lib/billing.ts` | tip ulaza `EventEntity` → `Stripe.Event`; grane po tipovima iz §6 |
| `apps/web/src/lib/billing-skladiste.ts` | kolone i RPC potpisi iz §3 |
| `apps/web/src/lib/billing-schema.ts` | telo bez `pri_`; §5 |
| `apps/web/src/lib/pretplata.ts`, `apps/web/src/lib/pristup.ts` | kolone |
| `apps/web/src/lib/cenovnik.ts`, `cenovnik-namera.ts` | `Tier.priceId` ispada; cene iz `plans.ts` |
| `apps/web/src/components/cenovnik-ekran.tsx` | bez `@paddle/paddle-js`, bez `PricePreview`, bez overlay-a; dugme = `POST /api/billing/checkout` → `window.location.assign(url)` |
| `apps/web/src/components/pretplata-blok.tsx`, `portal-dugme.tsx` | tekstovi bez „Paddle", plus blok probe |
| `apps/web/src/app/api/billing/{checkout,webhook,portal}/route.ts` | §5, §6, §8 |
| `apps/web/src/app/{welcome,povracaj,uslovi,privatnost,cenovnik}/page.tsx`, `components/{futer,pravni-okvir}.tsx`, `app/page.tsx` | svaka rečenica sa „Paddle" / „merchant of record" / „račun i PDV stižu od njih" → prodavac je LLC (A4), račun stiže od Stripe-a u ime LLC-a |
| `apps/web/src/app/(admin)/admin/korisnici/[id]/page.tsx`, `lib/admin-radnje.ts`, `lib/admin-radnje-schema.ts`, `components/admin-radnje.tsx` | obrazac „Otvori beta nalog" → „Otvori komp"; PATCH `/beta` → `/komp` |
| `apps/web/next.config.ts` | CSP: `https://*.paddle.com` iz `script-src`, `style-src`, `img-src`, `connect-src`, `frame-src` — sve ispada. Stripe hosted Checkout i Portal su **na drugom domenu**, naš CSP ih ne dodiruje. Ostaje samo `form-action 'self' https://checkout.stripe.com https://billing.stripe.com` ako se ikad koristi `<form action>`; naš kod radi `fetch` + `location.assign`, pa **ni to ne treba** |
| `apps/web/src/middleware.ts` | komentar `/api/billing/webhook … Paddle` → Stripe |
| `apps/web/src/app/api/search/route.ts`, `lib/search-cache.ts`, `lib/jobs.ts`, `components/pretraga-ekran.tsx`, `components/kes-lista.tsx`, `app/(app)/pretraga/page.tsx` | D10 — §14.3 |
| `apps/worker/src/jobs/scan.ts`, `apps/worker/src/lib/db-writes.ts` | delimičan refund — §14.4 |
| `apps/worker/src/jobs/monthly-grant.ts` | samo godišnje pretplate i komp — §10 |
| `.env.example` | blok „Paddle" (linije 118–160) → blok „Stripe" iz §11 |
| `CLAUDE.md` | reč „Paddle" u sekciji naplate → Stripe; pravilo 3 dobija nove RPC-ove iz §3 |
| `docs/00-kontekst.md`, `docs/LANSIRANJE.md`, `docs/SESIJE.md`, `docs/MEJLOVI-PLAN.md`, `docs/F8-landing.md`, `docs/PROVERA-VIZUELNA.md`, `docs/prompt-landing-veze.md`, `docs/LANSIRANJE-PITANJA.md` | ne prepravljaju se (PRD istorija). `SESIJE.md` dobija unos S25 sa rečenicom „Paddle uklonjen, v. docs/naplata-stripe.md". `LANSIRANJE.md` dobija jednu liniju na vrhu: „§1.1, §1.6 i sve o Paddle-u i beti zamenjuje docs/naplata-stripe.md" |

### 1.3 Zavisnosti

```
pnpm --filter @sajtoskop/web remove @paddle/paddle-js @paddle/paddle-node-sdk
pnpm --filter @sajtoskop/web add stripe
```

`stripe` (Node SDK, v18+). Pinovati `apiVersion` u `stripe-server.ts` na verziju koju panel prikazuje pri prvom ključu i **ne dirati je** — oblik `invoice` i `subscription` objekata se menjao u 2025 (v. §6.4).

### 1.4 Baza (0025) — sažetak, pun SQL u §3

| Briše se | Zamena |
|---|---|
| `profiles.paddle_customer_id` | `profiles.stripe_customer_id` |
| `profiles.beta_expires_at` | `profiles.komp_expires_at` |
| `profiles.plan` vrednost `'beta'` | `'komp'` |
| `subscriptions.paddle_subscription_id` PK, `paddle_customer_id` | `stripe_subscription_id` PK, `stripe_customer_id`, plus `ciklus`, `trial_end`, `cancel_at_period_end` |
| `profiles_beta_guard`, `profiles_beta_samo_iz_konzole()` | `profiles_komp_guard`, `profiles_komp_samo_iz_konzole()` |
| `admin_open_beta` | `admin_open_komp` |
| `credit_ledger.reason = 'beta_grant'` | ostaje u `check` zbog istorijskih redova; nov razlog `komp_grant`, `trial_grant`, `expire` |
| `apply_subscription(... p_customer_id ...)` sa Paddle semantikom | nov potpis, §3 |
| — | `search_access`, `access_invites`, `trial_fingerprints` |

### 1.5 Env

Ispadaju: `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_BETA_DISCOUNT_ID`. Ulaze: v. §11.

### 1.6 Paddle panel

Ništa se ne radi; sandbox nalog se ostavlja neaktivan. Nema ni jedne žive pretplate, pa nema migracije kupaca.

---

## 2. Stripe katalog

Sve se pravi u **test modu** prvo, pa se isti spisak ponovi u live modu. `lookup_key` je isti u oba; **ID-jevi (`prod_`, `price_`) su različiti i zato nikad ne idu u kod**.

### 2.1 Proizvodi i cene

| Product (`name`) | Price `lookup_key` | Iznos | `recurring` | `tax_behavior` |
|---|---|---|---|---|
| Sajtoskop Starter | `starter_month` | €29,00 | `interval: month` | `unspecified` |
| Sajtoskop Starter | `starter_year` | €290,00 | `interval: year` | `unspecified` |
| Sajtoskop Pro | `pro_month` | €59,00 | `month` | |
| Sajtoskop Pro | `pro_year` | €590,00 | `year` | |
| Sajtoskop Advanced | `advanced_month` | €119,00 | `month` | |
| Sajtoskop Advanced | `advanced_year` | €1.190,00 | `year` | |
| Sajtoskop Dopuna 75 | `pack_75` | €19,00 | one-time | |
| Sajtoskop Dopuna 200 | `pack_200` | €49,00 | one-time | |

Brojevi kredita u paketima su iz §14.6 (75/200 umesto 50/150). Ako se §14.6 ne prihvati, ključevi su `pack_50` / `pack_150` — sve ostalo ostaje isto.

`product.metadata.plan = starter|pro|advanced` i `price.metadata.credits = 75|200` na paketima — **samo za čitljivost u panelu**. Kod ih ne čita; kod čita `lookup_key` (§4).

Valuta: **EUR na svemu**, bez `currency_options`. Stripe Tax se ne uključuje (D1). `tax_behavior: unspecified` je podrazumevano i dovoljno.

### 2.2 Podešavanja na nalogu

| Gde | Vrednost |
|---|---|
| Settings → Business → Public details → Statement descriptor | `SAJTOSKOP` (A4). Shortened descriptor: `SAJTOSKOP` |
| Settings → Business → Public details → Support email / URL | `podrska@sajtoskop.com`, `https://www.sajtoskop.com/kontakt` |
| Settings → Checkout and Payment Links → Branding | logo, akcenat `#adee2e` na tamnoj, ikonica |
| Settings → Subscriptions and emails → **Manage failed payments**: Smart Retries ON, 4 pokušaja kroz 7 dana; „If all retries fail → cancel subscription". **Send emails: OFF** za sve (mejlove šaljemo mi, P4) |
| Settings → Subscriptions and emails → **Trials**: „Send reminder 3 days before trial ends" OFF (isti razlog); „Cancel subscription if no payment method at trial end" — nebitno, kartica je obavezna |
| Customer Portal | §8 |
| Coupon | §9.2 |
| Webhook endpoint | `https://app.sajtoskop.com/api/billing/webhook`, događaji iz §6.1, API verzija = pinovana |
| Radar | podrazumevana pravila + „Block if card fingerprint used on more than 2 customers in 24h" (jeftina zaštita od farmi proba) |

### 2.3 Proba

Proba se **ne podešava na ceni** (Stripe „free trial days" na Price ne postoji kao stalan atribut u novom Dashboardu). Proba se šalje u svakom Checkout Session-u iz koda:

```ts
subscription_data: {
  trial_period_days: TRIAL_DAYS,           // 7, iz plans.ts
  trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
  metadata: { user_id, plan, ciklus },
},
payment_method_collection: "always",
```

`payment_method_collection: "always"` je ono što D2 traži: kartica pre probe. Pozivnica „prvi mesec gratis" **ne šalje** `trial_period_days` (§9).

---

## 3. Migracija `0025_stripe.sql`

Pun SQL je u `supabase/migrations/0025_stripe.sql` (ovde je ranije stajala kopija, koja se
razišla sa fajlom već 14. 9.). Šta migracija radi, po delovima fajla:

1. **`profiles`:** `paddle_customer_id` → `stripe_customer_id` (unique), `beta_expires_at` →
   `komp_expires_at`, nova `invite_id`; plan `beta` → `komp` (ograničenje plana se briše pre
   izmene i vraća posle).
2. **`subscriptions`** u Stripe obliku: PK `stripe_subscription_id`, `stripe_customer_id`,
   `ciklus`, `lookup_key`, `trial_end`, `cancel_at_period_end`, `updated_at = event.created`.
3. **Razlozi u knjizi:** `trial_grant`, `komp_grant`, `expire` — i u `check` i u telu
   `grant_credits` (pravilo 3).
4. **Primena pretplate:** `apply_subscription` (odbija zastareo događaj, `stale_ignored`),
   `apply_invoice_paid` (SET na `target`, ref `in_…`), `apply_trial_start` (jednom po nalogu),
   `expire_subscription_credits`.
5. **Komp:** triger `profiles_komp_guard`, `admin_open_komp` (gornja granica 2000 kredita),
   `access_invites`, `access_invite_redemptions`, `redeem_invite`.
6. **Pristup kešu se plaća (D10):** `search_access` (RLS po obrascu `unlocks`),
   `spend_credit_and_scan` sa ishodima `cached` / `already_paid` i kolonom `cost`,
   `has_search_access`, `refund_scan(job, pages)` za delimičan povraćaj.
7. **Admin lista:** `admin_users_page` sa `komp_expires_at` i `sub_trial_end`, filter `proba`.
8. **Ponovljena proba:** `trial_fingerprints`.
9. **Prava:** sve nove funkcije samo za `service_role`.

Kasnije izmene istih funkcija: `0029` (admin bez kredita), `0030` (`balance_after`, pod),
`0031` (`cancel_at`), `0032`–`0033` (`apply_refund`), `0034` (`scan_refund`,
`fail_scan_and_refund`).

---

## 4. `plans.ts` kao izvor istine za cene

Stripe hosted Checkout prikazuje iznos na svojoj strani; **naš cenovnik ga mora prikazati pre toga**, i on ga čita odavde. Stripe katalog se **proverava** naspram ovog fajla (`stripe:doktor`), ne obrnuto.

```ts
// packages/shared/src/plans.ts — sekcija koja ZAMENJUJE „PADDLE KATALOG"

export type Ciklus = "month" | "year";
export type PlanId = "komp" | "dopuna" | "starter" | "pro" | "advanced";
export type PaidPlanId = "starter" | "pro" | "advanced";

export const PLANS: Record<PlanId, Plan> = {
  // komp = pun pristup bez Stripe-a; limiti Advanced (A3). monthlyCredits je
  // ono što worker POSTAVLJA prvog u mesecu dok komp traje (§10).
  komp:     { monthlyCredits: 300, cacheMissPerDay: 120, exportPerDay: 10000, aiRewritePerDay: 60 },
  dopuna:   { monthlyCredits:   0, cacheMissPerDay:  30, exportPerDay:   500, aiRewritePerDay:  5 },
  starter:  { monthlyCredits: 150, cacheMissPerDay:  30, exportPerDay:   500, aiRewritePerDay:  5 },
  pro:      { monthlyCredits: 450, cacheMissPerDay:  60, exportPerDay:  2000, aiRewritePerDay: 20 },
  advanced: { monthlyCredits: 1200, cacheMissPerDay: 120, exportPerDay: 10000, aiRewritePerDay: 60 },
};
export const DEFAULT_PLAN: PlanId = "dopuna";
export const GRACE_DAYS = 30;
export const KOMP_DEFAULT_DAYS = 30;

// ── proba (D2) ──────────────────────────────────────────────
export const TRIAL_DAYS = 7;
export const TRIAL_CREDITS = 10;

// ── cene: JEDINI izvor. Stripe se proverava naspram ovoga. ──
/** `lookup_key` je stabilan preko test/live; `price_` ID nikad ne ulazi u kod. */
export type LookupKey =
  | `${PaidPlanId}_${Ciklus}`
  | `pack_${number}`;

export type CenaPlana = { eur: number; lookupKey: LookupKey };

export const PLAN_PRICES: Record<PaidPlanId, Record<Ciklus, CenaPlana>> = {
  starter:  { month: { eur: 29,  lookupKey: "starter_month"  }, year: { eur: 290,  lookupKey: "starter_year"  } },
  pro:      { month: { eur: 59,  lookupKey: "pro_month"      }, year: { eur: 590,  lookupKey: "pro_year"      } },
  advanced: { month: { eur: 119, lookupKey: "advanced_month" }, year: { eur: 1190, lookupKey: "advanced_year" } },
};

export type PaketId = "dopuna-75" | "dopuna-200";
export const CREDIT_PACKS: Record<PaketId, { credits: number; eur: number; lookupKey: LookupKey }> = {
  "dopuna-75":  { credits:  75, eur: 19, lookupKey: "pack_75"  },
  "dopuna-200": { credits: 200, eur: 49, lookupKey: "pack_200" },
};

export const ALL_LOOKUP_KEYS: readonly LookupKey[] = [
  ...Object.values(PLAN_PRICES).flatMap((c) => [c.month.lookupKey, c.year.lookupKey]),
  ...Object.values(CREDIT_PACKS).map((p) => p.lookupKey),
];

export type Kupovina =
  | { kind: "subscription"; plan: PaidPlanId; ciklus: Ciklus; credits: number; eur: number; lookupKey: LookupKey }
  | { kind: "pack"; paket: PaketId; credits: number; eur: number; lookupKey: LookupKey };

const BY_LOOKUP: Readonly<Record<string, Kupovina>> = Object.fromEntries([
  ...(Object.entries(PLAN_PRICES) as [PaidPlanId, Record<Ciklus, CenaPlana>][]).flatMap(([plan, c]) =>
    (["month", "year"] as const).map((ciklus) => [
      c[ciklus].lookupKey,
      { kind: "subscription", plan, ciklus, credits: PLANS[plan].monthlyCredits, eur: c[ciklus].eur, lookupKey: c[ciklus].lookupKey },
    ]),
  ),
  ...(Object.entries(CREDIT_PACKS) as [PaketId, (typeof CREDIT_PACKS)[PaketId]][]).map(([paket, p]) => [
    p.lookupKey,
    { kind: "pack", paket, credits: p.credits, eur: p.eur, lookupKey: p.lookupKey },
  ]),
]);

/** `lookup_key` → šta se dobija. `null` = nije naš katalog → odbij. */
export function kupovinaZaLookupKey(key: string | null | undefined): Kupovina | null {
  return key ? BY_LOOKUP[key] ?? null : null;
}

/** Plan + ciklus → `lookup_key`. Ovo šalje checkout ruta u `prices.list`. */
export function lookupKeyZaPlan(plan: PaidPlanId, ciklus: Ciklus): LookupKey {
  return PLAN_PRICES[plan][ciklus].lookupKey;
}
export function lookupKeyZaPaket(paket: PaketId): LookupKey {
  return CREDIT_PACKS[paket].lookupKey;
}

/** „€29", „€1.190" — ručno, bez Intl, zbog hydration-a (isti razlog kao `broj()` u cenovnik.ts). */
export function formatEur(n: number): string {
  return "€" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
export const GODISNJI_BONUS = "2 meseca gratis";
```

Šta ispada iz `plans.ts`: `PLAN_PRICE_IDS`, `ALL_PRICE_IDS`, `planForPriceId`, `creditsForPriceId`, `kupovinaZaPriceId`, `BETA_DEFAULT_DAYS`, `PLANS.beta`. Sve ostalo (budžet, dubine, `creditMonth`, `sledecaDodelaKredita`) ostaje.

`lookup_key → price_id` na serveru (jedno mesto, keširano po procesu):

```ts
// apps/web/src/lib/stripe-katalog.ts
import "server-only";
import { ALL_LOOKUP_KEYS, type LookupKey } from "@sajtoskop/shared";
import { stripe } from "./stripe-server";

let mapa: Map<LookupKey, string> | null = null;

export async function priceIdZa(key: LookupKey): Promise<string> {
  if (!mapa) {
    const { data } = await stripe().prices.list({
      lookup_keys: [...ALL_LOOKUP_KEYS], active: true, limit: 20,
    });
    mapa = new Map(data.map((p) => [p.lookup_key as LookupKey, p.id]));
    const fali = ALL_LOOKUP_KEYS.filter((k) => !mapa!.has(k));
    if (fali.length) { mapa = null; throw new Error(`Stripe katalog nema: ${fali.join(", ")}`); }
  }
  return mapa.get(key)!;
}
```

`cenovnik.ts`: `Tier.priceId` → `Tier.cena: Record<Ciklus, CenaPlana>` iz `PLAN_PRICES`; `Paket.priceId` ispada, `Paket.eur` ulazi. `pogodnosti()` red „Pretraga po kešu, neograničeno" se **briše** (D10) i zamenjuje sa „Ako nađemo manje firmi nego što si tražio, razliku vraćamo".

`cenovnik-ekran.tsx`: nema `initializePaddle`, `PricePreview`, `Checkout.open`. Cifra je `formatEur(tier.cena[ciklus].eur)` + sufiks. Klik:

```ts
const r = await fetch("/api/billing/checkout", { method: "POST", headers: {...}, body: JSON.stringify(telo) });
if (r.status === 401) { window.location.href = naRegistraciju(nazad); return; }
const { url } = await r.json();
window.location.assign(url);
```

Rečenica na dnu ekrana: „Cene su u evrima, bez PDV-a. Prodavac je [ime LLC-a], SAD; račun stiže mejlom posle svake naplate. Plaćanje preko firme uz fakturu — javi se na podrska@sajtoskop.com." (D5, A4).

---

## 5. Checkout ruta

`POST /api/billing/checkout` → `{ url }`. Pregledač radi `location.assign(url)`. Nema klijentskog SDK-a.

### 5.1 Telo

```ts
// apps/web/src/lib/billing-schema.ts
import { z } from "zod";
export const checkoutBodySchema = z.discriminatedUnion("vrsta", [
  z.object({ vrsta: z.literal("plan"), plan: z.enum(["starter", "pro", "advanced"]), ciklus: z.enum(["month", "year"]) }),
  z.object({ vrsta: z.literal("paket"), paket: z.enum(["dopuna-75", "dopuna-200"]) }),
]);
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
```

Klijent ne šalje ni `lookup_key` ni `price_`. Server izvodi oboje iz `plans.ts`.

### 5.2 Ruta

```ts
// apps/web/src/app/api/billing/checkout/route.ts
import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import {
  CREDIT_PACKS, kupovinaZaLookupKey, lookupKeyZaPaket, lookupKeyZaPlan,
  smeDaKupiPaket, stanjePristupa, TRIAL_DAYS, type ProfileRow,
} from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { checkoutBodySchema } from "@/lib/billing-schema";
import { KonfigGreska, stripeServerEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe-server";
import { priceIdZa } from "@/lib/stripe-katalog";
import { citajPretplatu } from "@/lib/pristup";
import { ensureProfile } from "@/lib/profile";
import { proveriIpTempo } from "@/lib/rate-limit";
import { adminSupabase } from "@/lib/supabase";
import { appUrl } from "@/lib/veze";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };
const greska = (poruka: string, status: number) =>
  NextResponse.json({ greska: poruka }, { status, headers: HEADERS });

export async function POST(req: Request): Promise<Response> {
  const ogranicen = await proveriIpTempo(req, "billing-checkout");
  if (ogranicen) return ogranicen;

  let userId: string;
  try { userId = await requireUserId(); } catch { return greska("Nisi prijavljen.", 401); }

  let raw: unknown;
  try { raw = await req.json(); } catch { return greska("Telo zahteva nije ispravan JSON.", 400); }
  const parsed = checkoutBodySchema.safeParse(raw);
  if (!parsed.success) return greska("Nepoznat plan ili paket.", 400);
  const telo = parsed.data;

  try {
    // Profil MORA da postoji pre novca — isti razlog i isti komentar kao u
    // Paddle verziji (webhook stiže pre reda u `profiles`).
    const korisnik = await currentUser().catch(() => null);
    const email = korisnik?.primaryEmailAddress?.emailAddress ?? null;
    await ensureProfile(userId, email);

    const { data: profil, error } = await adminSupabase()
      .from("profiles")
      .select("plan, stripe_customer_id, komp_expires_at, plan_expires_at, credits_topup, invite_id")
      .eq("id", userId)
      .maybeSingle<Pick<ProfileRow, "plan" | "stripe_customer_id" | "komp_expires_at" | "plan_expires_at" | "credits_topup" | "invite_id">>();
    if (error) throw new Error(`profiles: ${error.message}`);
    if (!profil) throw new Error("profil nije nastao");

    const pretplata = await citajPretplatu(userId);
    const pristup = stanjePristupa(
      { plan: profil.plan, kompExpiresAt: profil.komp_expires_at, planExpiresAt: profil.plan_expires_at, creditsTopup: profil.credits_topup },
      pretplata, Date.now(),
    );

    const { STRIPE_COUPON_FIRST_MONTH } = stripeServerEnv();
    const s = stripe();

    // Jedan Stripe customer po nalogu. Pravi se ovde, ne u Checkout-u, da bi
    // `customer` bio poznat pre webhooka i da bi portal radio i za paket.
    let customerId = profil.stripe_customer_id;
    if (!customerId) {
      const c = await s.customers.create({ email: email ?? undefined, metadata: { user_id: userId } });
      customerId = c.id;
      await adminSupabase().from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId);
    }

    const success = appUrl("/welcome?sesija={CHECKOUT_SESSION_ID}");
    const cancel  = appUrl(telo.vrsta === "plan"
      ? `/cenovnik?plan=${telo.plan}&ciklus=${telo.ciklus === "year" ? "godisnje" : "mesecno"}`
      : "/cenovnik#paketi");

    if (telo.vrsta === "paket") {
      if (!smeDaKupiPaket(pristup)) {
        return greska("Paket kredita je dopuna uz aktivan plan. Uzmi plan na /cenovnik — paketi se otključavaju čim plan bude aktivan.", 403);
      }
      const key = lookupKeyZaPaket(telo.paket);
      const sesija = await s.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        client_reference_id: userId,                         // Clerk user id
        line_items: [{ price: await priceIdZa(key), quantity: 1 }],
        metadata: { user_id: userId, kind: "pack", paket: telo.paket, credits: String(CREDIT_PACKS[telo.paket].credits) },
        payment_intent_data: { metadata: { user_id: userId, kind: "pack", lookup_key: key } },
        success_url: success, cancel_url: cancel,
        locale: "auto", allow_promotion_codes: false,
      });
      return NextResponse.json({ url: sesija.url }, { headers: HEADERS });
    }

    // ── pretplata ────────────────────────────────────────────
    // Ko već ima živu pretplatu, ne pravi drugu — promena plana ide kroz portal.
    if (pretplata && ["trialing", "active", "past_due"].includes(pretplata.status)) {
      return greska("Već imaš plan. Promena plana ide kroz „Upravljaj pretplatom" na /krediti.", 409);
    }
    // Komp ne kupuje plan dok komp traje.
    if (pristup.stanje === "komp") {
      return greska("Imaš komp pristup — plan ti sada ne treba. Kad istekne, ovde ćeš moći da ga uzmeš.", 409);
    }

    const key = lookupKeyZaPlan(telo.plan, telo.ciklus);
    const kupovina = kupovinaZaLookupKey(key);
    if (!kupovina || kupovina.kind !== "subscription") return greska("Nepoznat plan.", 400);

    // Pozivnica „prvi mesec gratis": bez probe, 100% kupon na prvi period (§9).
    // Inače: proba 7 dana, kartica obavezna, ako je nalog nikad nije imao.
    const gratisMesec = profil.invite_id !== null;
    const imaoProbu = await imaoProbuRanije(userId);   // credit_ledger reason='trial_grant' ili subscriptions.trial_end not null
    const meta = { user_id: userId, kind: "subscription", plan: telo.plan, ciklus: telo.ciklus, lookup_key: key,
                   ...(gratisMesec ? { invite_id: String(profil.invite_id) } : {}) };

    const sesija = await s.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: await priceIdZa(key), quantity: 1 }],
      payment_method_collection: "always",
      subscription_data: {
        metadata: meta,
        ...(!gratisMesec && !imaoProbu
          ? { trial_period_days: TRIAL_DAYS,
              trial_settings: { end_behavior: { missing_payment_method: "cancel" } } }
          : {}),
      },
      ...(gratisMesec ? { discounts: [{ coupon: STRIPE_COUPON_FIRST_MONTH }] } : { allow_promotion_codes: false }),
      metadata: meta,
      success_url: success, cancel_url: cancel,
      locale: "auto",
      // Kupac iz Srbije uglavnom nema PIB polje; ne tražimo ni adresu.
      billing_address_collection: "auto",
    });

    return NextResponse.json({ url: sesija.url }, { headers: HEADERS });
  } catch (err) {
    if (err instanceof KonfigGreska) {
      console.error("[api/billing/checkout] NAPLATA NIJE PODEŠENA:", err.message);
      return greska("Naplata još nije podešena do kraja. Javi mi se na podrska@sajtoskop.com — ovo je moja greška, ne tvoja.", 503);
    }
    console.error("[api/billing/checkout]", err);
    return greska("Plaćanje trenutno ne radi. Pokušaj ponovo za koji minut.", 502);
  }
}
```

`appUrl()` — helper u `lib/veze.ts` koji lepi `NEXT_PUBLIC_APP_URL` (već postoji za `/cenovnik` linkove; ako ne, dodaj). Nikad `window.location.origin` — ruta je serverska.

### 5.3 Namera sa landinga

Ne menja se: `/cenovnik?plan=pro&ciklus=godisnje` → `citajNameru()` → `CenovnikEkran namera={…}` → dugme preselektovano. Klik šalje `{ vrsta: "plan", plan, ciklus }`. Gost ide na `/?nalog=nov&nazad=/cenovnik?plan=pro&ciklus=godisnje` i posle registracije se vraća sa istom namerom. `?paket=75` / `?paket=200` (brojevi iz §14.6). Landing nikad ne zna `lookup_key`, samo slug — to je već tako.

### 5.4 `/welcome`

`?sesija=cs_…` se koristi **samo** za jedan `stripe.checkout.sessions.retrieve` da ekran napiše „Starter, mesečno, proba do 17.9." dok webhook ne stigne. Ne piše ništa u bazu. Tekst: „Hvala. Račun stiže mejlom posle svake naplate. Plan se aktivira za koji sekund — ako ga ne vidiš na /krediti, osveži stranu."

---

## 6. Webhook

### 6.1 Događaji koje endpoint prima (tačno ovi, u Stripe panelu)

| Stripe događaj | Interni događaj (`billing.ts`) | Šta radi |
|---|---|---|
| `checkout.session.completed` | `PACK_PAID` (mode=payment) / `ništa` (mode=subscription) | Paket: `apply_credit_pack(ref = payment_intent)`. Pretplata: samo označi pozivnicu iskorišćenom (`profiles.invite_id = null`) — pretplatu i kredite donose događaji ispod |
| `customer.subscription.created` | `SUB_STATE` + `TRIAL_STARTED` ako je `status = trialing` | `apply_subscription` + `apply_trial_start(10)` |
| `customer.subscription.updated` | `SUB_STATE` | `apply_subscription` |
| `customer.subscription.deleted` | `SUB_STATE` + `SUB_ENDED` | `apply_subscription(status=canceled)` + `expire_subscription_credits` |
| `invoice.paid` | `PERIOD_PAID` | `apply_invoice_paid(target = plan.monthlyCredits, ref = in_…)` — **samo** `billing_reason in (subscription_create, subscription_cycle, subscription_update)` i `amount_due >= 0`; mesečni ciklus, ili prva faktura godišnjeg |
| `invoice.payment_failed` | `PAYMENT_FAILED` | ništa u kreditima; `apply_subscription` će stići kao `updated` sa `past_due`. Loguje se; mejl je P4 |
| `charge.refunded` | `REFUNDED` | fakture tog plaćanja: `charge.invoice` ako postoji, inače `invoicePayments.list` po `payment_intent` (na `dahlia` ni naplata ni `PaymentIntent` nemaju `invoice`), pa redovi knjige po `in_…` / `pi_…` (`dodeleZaTransakciju`). Skida se **suma njihovih `delta`** (`dodeljenoZaTransakciju`, 0032) — nikad `monthlyCredits`, nikad `balance_after`; bez redova ili sa sumom ≤ 0 → `preskočeno`, 200. Od 0033 je jedinica posla **refund**, ne naplata: `refunds.list({ charge })` (lista na naplati ume da bude skraćena), pa se svaki `re_…` primenjuje sa svojim iznosom, `floor(dodeljeno × refund.amount / charge.amount)`, pod ključem `povracaj:<re_…>`. Kumulativni `amount_refunded` se ne koristi. Kroz `apply_refund`: jedan red po refundu, srazmera i traženo/skinuto u `credit_ledger.details`; paket iz dopune (ostatak kao dug u balansu, uz `admin_audit` red `refund_preliv`), pretplata iz balansa, pod −1000 |
| `charge.dispute.created` | `DISPUTED` | samo log + mejl adminu (P4). Krediti se ne diraju dok Stripe ne odluči |
| `charge.dispute.closed` | `DISPUTE_CLOSED` | samo `status = lost`: `charges.retrieve` (spor ne nosi kupca), pa isto kao pun refund, ref `spor:<dp_…>`. Ostali statusi: log |

Sve ostalo → `preskočeno:<tip>`, 200.

### 6.2 Ruta

```ts
// apps/web/src/app/api/billing/webhook/route.ts
import type Stripe from "stripe";
import { obradiDogadjaj } from "@/lib/billing";
import { supabaseSkladiste } from "@/lib/billing-skladiste";
import { stripeServerEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const potpis = req.headers.get("stripe-signature");
  if (!potpis) return new Response("Nedostaje potpis.", { status: 401 });
  const sirovoTelo = await req.text();               // HMAC nad tačnim bajtovima

  let dogadjaj: Stripe.Event;
  try {
    dogadjaj = stripe().webhooks.constructEvent(sirovoTelo, potpis, stripeServerEnv().STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] potpis nije prošao:", err instanceof Error ? err.message : String(err));
    return new Response("Neispravan potpis.", { status: 401 });
  }

  const skladiste = supabaseSkladiste();
  let upisan: boolean;
  try {
    upisan = await skladiste.upisiDogadjaj({
      eventId: dogadjaj.id, eventType: dogadjaj.type,
      occurredAt: new Date(dogadjaj.created * 1000).toISOString(),
    });
  } catch (err) {
    console.error("[stripe-webhook] billing_events nije dostupan:", err);
    return new Response("Deduplikacija nije dostupna.", { status: 500 });
  }
  if (!upisan) return Response.json({ ok: true, duplikat: true });

  try {
    const ishod = await obradiDogadjaj(dogadjaj, skladiste);
    if (!ishod.ok) {
      console.error(`[stripe-webhook] ${dogadjaj.type} ${dogadjaj.id} → ${ishod.radnja}: ${ishod.greska}`);
      return Response.json({ ok: false, radnja: ishod.radnja });   // trajan neuspeh: 200
    }
    return Response.json({ ok: true, radnja: ishod.radnja });
  } catch (err) {
    console.error("[stripe-webhook] obrada nije uspela:", err);
    await skladiste.obrisiDogadjaj(dogadjaj.id);                    // prolazan: 500, Stripe ponavlja
    return new Response("Obrada nije uspela.", { status: 500 });
  }
}
```

Stripe ponavlja neuspele isporuke do 3 dana. Odgovor mora unutar 10 s — ovde su tri upita.

### 6.3 `billing.ts` — grane

Interfejs `NaplataSkladiste` dobija: `primeniPretplatu(ArgPretplata)`, `primeniFakturu({userId, invoiceId, target})`, `pocniProbu({userId, subscriptionId, credits})`, `istekniPretplatu({userId, subscriptionId})`, `oznaciPozivnicuIskoriscenom(userId)`, `korisnikPoKupcu(customerId)`, `korisnikPoPretplati(subId)`, `zapamtiOtisak({fingerprint, userId}) → 'nov' | 'vidjen'`. Ostalo ostaje.

Kako se nalazi korisnik (redosled, bez mejla — pravilo 2):

1. `subscription.metadata.user_id` / `session.client_reference_id` / `session.metadata.user_id` / `payment_intent.metadata.user_id` — naš checkout ih uvek upisuje i Stripe ih prepisuje na sve buduće događaje te pretplate.
2. `subscriptions.stripe_subscription_id` u našoj tabeli.
3. `profiles.stripe_customer_id` — poslednja mreža; radi za sve jer customer nastaje u našoj ruti pre sesije.

Za `invoice.*`: `invoice.parent.subscription_details.subscription` (API 2025-03-31+) ili `invoice.subscription` (stariji) → pa koraci 2–3. Napiši helper `subIdIzFakture(inv)` koji proba oba.

`customer.subscription.*` → `ArgPretplata`:

```ts
const item = sub.items.data[0];
const lookupKey = item?.price.lookup_key ?? null;
const kupovina = kupovinaZaLookupKey(lookupKey);
const periodEnd = (item as { current_period_end?: number })?.current_period_end   // 2025-03-31+
  ?? (sub as { current_period_end?: number }).current_period_end ?? null;          // stariji
await s.primeniPretplatu({
  userId, subscriptionId: sub.id, customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
  status: sub.status, plan: kupovina?.kind === "subscription" ? kupovina.plan : null,
  ciklus: kupovina?.kind === "subscription" ? kupovina.ciklus : null, lookupKey,
  periodEnd: iso(periodEnd), trialEnd: iso(sub.trial_end),
  cancelAtPeriodEnd: sub.cancel_at_period_end, canceledAt: iso(sub.canceled_at),
  eventCreated: iso(dogadjaj.created),
});
```

`invoice.paid`:

```ts
if (!["subscription_create", "subscription_cycle", "subscription_update"].includes(inv.billing_reason ?? "")) return { ok: true, radnja: "faktura bez dodele" };
// Proba: prva faktura je 0 €, billing_reason = subscription_create — NE dodeljuje plan kredite;
// proba ima svojih 10 iz TRIAL_STARTED. Dodela plana stiže osmog dana kao subscription_cycle.
if (inv.billing_reason === "subscription_create" && inv.amount_due === 0 && !gratisMesec(inv)) return { ok: true, radnja: "proba počela, bez dodele" };
const plan = await planIzFakture(inv, s);   // stavke fakture → cena → lookup_key → kupovinaZaLookupKey
if (!plan) return { ok: true, radnja: "preskočeno:faktura van kataloga" };   // + console.warn
await s.primeniFakturu({ userId, invoiceId: inv.id, target: PLANS[plan].monthlyCredits });
```

`target` se računa **isključivo iz stavki same fakture** — nikad iz `profiles.plan`, `subscriptions.plan`
ni metapodataka pretplate. Kod downgrade-a na kraju perioda Stripe pravi subscription schedule, pa
`invoice.paid` (`subscription_cycle`, već po novoj ceni) i `customer.subscription.updated` (novi
`lookup_key`) stižu van reda; ako faktura stigne prva, ogledalo još drži stari plan i korisnik bi
platio Starter a dobio Pro kredite. Metapodaci su snimak iz checkout-a i portal ih ne menja.

- Na `2026-08-26.dahlia` stavka **nema `price`** — nosi `pricing.price_details.price` kao goli
  `price_…` ID (webhook ne proširuje). `lookup_key` i `recurring` se čitaju sa cene
  (`prices.retrieve`, `NaplataSkladiste.ceneStavki`); pad tog poziva je 500 i Stripe ponavlja.
- Uzima se stavka sa **ponavljajućom cenom iz našeg kataloga**. Proracija (upgrade) daje stavke
  obe cene — negativnu za neiskorišćen stari plan i pozitivnu za novi — pa se prvo traži redovna
  stavka (`parent.subscription_item_details.proration = false`), a ako je nema, pozitivna
  proraciona. Dva različita plana na istom nivou → `preskočeno`.
- `subscription_schedule.*` se ne prima; `preskočeno` je ispravno ponašanje za njih.

`gratisMesec(inv)` = `inv.discount?.coupon?.id === STRIPE_COUPON_FIRST_MONTH` ili `inv.total_discount_amounts.length > 0` — gratis mesec ima `amount_due = 0` ali **jeste** plaćen period i dobija kredite.

### 6.4 Redosled i idempotencija

- **Gruba brana**: `billing_events.event_id = evt_…`, pre obrade (postojeće).
- **Fina brana**: `credit_ledger` ref: `in_…` za mesečnu dodelu, `pi_…` za paket, `trial:<user>` za probu, `expire:<sub>` za pražnjenje. Dupla isporuka bilo kog događaja ne dodeljuje dvaput ni kad gruba brana zakaže.
- **Van reda**: Stripe ne garantuje redosled. Tipičan slučaj: `customer.subscription.created` stigne pre `checkout.session.completed`, ili `subscription.updated` (trialing→active) pre `invoice.paid`. Rešenja: (1) korisnik se nalazi iz metapodataka koje NOSI SVAKI događaj, pa nijedan ne zavisi od prethodnog; (2) `apply_subscription` odbija događaj sa `event.created` starijim od poslednjeg primenjenog (`stale_ignored`); (3) `invoice.paid` ne zavisi od reda u `subscriptions` — traži korisnika i preko `customer`, a plan (`target`) čita sa stavke fakture, nikad iz `profiles.plan` (§6.3; downgrade kroz schedule šalje fakturu po novoj ceni pre `subscription.updated`); (4) `checkout.session.completed` za pretplatu ne radi ništa novčano.
- **`expire_subscription_credits` samo na `deleted`**, nikad na `updated` sa `canceled` — Stripe šalje `deleted` tačno jednom, na kraju perioda.

---

## 7. Proba

### 7.1 Stanje `proba` u `stanjePristupa()`

`StanjeId` postaje: `"komp" | "proba" | "aktivan" | "otkazan" | "dopuna" | "grace" | "zakljucan"`. Sedmo stanje — svesno odstupanje od komentara „šest stanja". `beta` → `komp` 1:1 (isti mehanizam, ime iz D4). `proba`:

```ts
// unutar grane 2 („pun pristup po datumu"), pre `otkazana`:
if (pretplata?.status === "trialing") {
  return { stanje: "proba", pun: true, cita: true, planLimita: plan, punDo, citanjeDo,
           probaDo: pretplata.trialEnd ?? punDo };
}
```

`PretplataZaPristup` dobija `trialEnd: string | null` i `cancelAtPeriodEnd: boolean`. `otkazan` = `status === "canceled" || cancelAtPeriodEnd || cancelAt !== null` (od 0031; `canceledAt` se ne čita — Stripe ga postavlja već pri zakazivanju otkaza). Proba koju je korisnik otkazao pre isteka (`cancel_at_period_end = true`, status i dalje `trialing`) → `otkazan` sa `punDo = trial_end`. `ProfilZaPristup.betaExpiresAt` → `kompExpiresAt`.

`past_due` (kartica pala): ostaje `aktivan` dok `plan_expires_at` nije prošao — Stripe drži `current_period_end` na starom datumu, pa posle ~7 dana Smart Retries-a prelazi u `grace` prirodno. `unpaid`/`incomplete*`: kao da pretplate nema.

### 7.2 Dan 0

Checkout → `customer.subscription.created` (`trialing`, `trial_end = +7d`, `current_period_end = +7d`) → `apply_subscription` (`profiles.plan = starter`, `plan_expires_at = +7d`) + `apply_trial_start(10)` (`credits_balance = 10`, ref `trial:<user>`). `invoice.paid` stiže sa `amount_due = 0`, `subscription_create` → bez dodele (§6.3).

### 7.3 Dan 8

Stripe naplaćuje. `invoice.paid` (`subscription_cycle`) → `apply_invoice_paid(target = 150)` → balans **postavljen** na 150 (A1: nema rollovera; ako je od 10 ostalo 4, sada je 150, ne 154). `subscription.updated` → `active`, `current_period_end = +30d`.

### 7.4 „Aktiviraj odmah"

`POST /api/billing/aktiviraj` (nova ruta, K2): `stripe.subscriptions.update(subId, { trial_end: "now", proration_behavior: "none" })`. Stripe odmah izdaje fakturu za pun period i naplaćuje; dalje isto kao dan 8 (A2). Dugme se vidi samo u stanju `proba` (na `/krediti` i u banneru kad `credits_balance + credits_topup === 0`). Ruta uzima `subId` iz `subscriptions` po `userId`, nikad iz tela.

### 7.5 Kartica pala osmog dana

`invoice.payment_failed` → log. Stripe Smart Retries (§2.2) pokušava 4× kroz 7 dana; `subscription.updated` stiže sa `past_due`. Pristup: `plan_expires_at` je ostao dan 8 → `stanjePristupa` daje `grace` (čita, ne troši) — što je tačno ono što treba: nije platio. Posle poslednjeg neuspeha Stripe otkazuje (podešeno u §2.2) → `subscription.deleted` → `expire_subscription_credits` (nema šta, već je potrošio probu ili ostatak probe se briše). Mejlovi: P4.

### 7.6 Ponovljena proba

`checkout.session.completed` (subscription) → `stripe.paymentMethods.retrieve(setup_intent → payment_method)` → `card.fingerprint` → `zapamtiOtisak()`. Ako je `vidjen` sa drugim `user_id` → `subscriptions.update(sub, { trial_end: "now" })`: proba se odmah pretvara u naplatu. Uz to `imaoProbuRanije()` u checkout ruti ne daje drugu probu istom nalogu. Jeftino, jedna tabela.

---

## 8. Customer Portal

Settings → Billing → Customer portal, jedna konfiguracija (podrazumevana):

| Sekcija | Podešavanje |
|---|---|
| Invoice history | ON |
| Customer information | email ON, billing address OFF, phone OFF, tax ID OFF |
| Payment methods | ON (update) |
| Cancel subscriptions | ON; mode **at end of billing period**; reason collection ON (jeftin feedback) |
| Pause | **OFF** (A-lista: bez pauziranja) |
| Update subscriptions (switch plans) | ON; proizvodi: sva tri plana, oba ciklusa; proration **`always_invoice`** za upgrade, downgrade na kraj perioda (`schedule_at_period_end`) |
| Update quantities | OFF |
| Business information | headline „Sajtoskop", link na `/uslovi`, `/privatnost`, `/povracaj` na `app.sajtoskop.com` |
| Default redirect | `https://app.sajtoskop.com/krediti` |

Ruta `POST /api/billing/portal` → `stripe.billingPortal.sessions.create({ customer, return_url: appUrl("/krediti") })` → `{ url }`. `customer` iz `profiles.stripe_customer_id` po sesiji (kao do sada). 404 bez kupca.

Promena plana kroz portal → `subscription.updated` sa novim `lookup_key` → `apply_subscription` menja `profiles.plan`; **krediti se ne diraju** dok ne stigne `invoice.paid` (upgrade → odmah, sa proracijom → `subscription_update` → dodela novog plana; downgrade → sledeći ciklus). Portal sme: otkaz, kartica, računi, promena plana. Ne sme: pauza, promena količine, kupon.

---

## 9. Pozivnice

### 9.1 Dva tipa

| | `komp` | `prvi_mesec` |
|---|---|---|
| Stripe | nema customer-a, nema pretplate | normalan checkout, kupon 100% `duration: once`, kartica obavezna, bez probe |
| Šta dobija | `plan = komp`, `komp_expires_at` (NULL = neograničeno), krediti iz pozivnice, mesečno `PLANS.komp.monthlyCredits` (§10) | prvi period €0, `invoice.paid` puni kredite plana, od 2. meseca normalna naplata |
| Ko | Vlada, prijatelji, partneri (A3) | ljudi sa videa, prvih 20 |
| Limiti | Advanced | po planu |

### 9.2 Stripe kupon

Panel → Product catalog → Coupons: `percent_off: 100`, `duration: once`, name `Prvi mesec gratis`, **bez** promotion code-a (kod se ne kuca u Checkout-u, ubacuje ga server). ID kupona → `STRIPE_COUPON_FIRST_MONTH`. Isti kupon u test i live (ID različit).

### 9.3 Admin

`/admin/pozivnice` već postoji za Clerk mejl pozivnice (F12). Nova sekcija na istoj strani: „Pristupne pozivnice" — obrazac: tip, kod (auto `SAJT-XXXX-XXXX`, ili ručno), mejl (opciono), za komp: dana (prazno = neograničeno) i kredita, max upotreba, napomena. Tabela: kod, tip, ko je iskoristio, kad, dugme Opozovi. Ruta `POST /api/admin/pozivnice/pristup` + `DELETE …/[id]`, obe upisuju `admin_audit` (pravilo 14). Kopiraj link: `https://app.sajtoskop.com/pozivnica/SAJT-XXXX-XXXX`.

### 9.4 Korisnik prihvata

`/pozivnica/[code]` (javna strana, `(app)` grupa NE): ako nije prijavljen → Clerk registracija sa `?nazad=/pozivnica/<code>`. Prijavljen → dugme „Prihvati" → `POST /api/pozivnice/prihvati { code }` → `redeem_invite(userId, code)`. Ishod:
- `komp` → redirect `/dashboard` sa tostom „Komp pristup do <datum> / neograničeno, <N> kredita."
- `prvi_mesec` → redirect `/cenovnik?pozivnica=1` — kartice pokazuju „Prvi mesec: €0" preko cene, dugme vodi u checkout sa kuponom (§5.2 čita `profiles.invite_id`). `checkout.session.completed` → `invite_id = null`.
- greške: `not_found` „Kod ne postoji.", `used_up` „Kod je već iskorišćen.", `expired`, `wrong_email` „Pozivnica je za drugu adresu.", `already_redeemed` „Već si iskoristio pozivnicu.", `has_subscription` „Već imaš plan."

Kod se poredi `upper(trim())`, rate limit 5/min po IP.

---

## 10. Mesečna dodela kredita — preporuka

**Mesečni planovi: `invoice.paid`. Godišnji planovi i komp: worker, sužen.** Ne jedno ili drugo, jer:

- `invoice.paid` je jedini trenutak kad se ZNA da je mesec plaćen. Dodela na kalendar (worker) daje kredite i onome kome je kartica pala 3. u mesecu. Za mesečne planove je zato webhook tačniji i briše B2 (proba više ne dobija 100 prvog u mesecu, jer worker mesečne pretplate uopšte ne gleda).
- Godišnji plan Stripe fakturiše jednom godišnje, a krediti stižu mesečno. Nema Stripe događaja za „11 puta između". Worker ostaje za njih — ali čita `subscriptions` (status `active`, `ciklus = 'year'`, `current_period_end > now()`), ne `profiles.plan`. Ref ostaje `YYYY-MM` (Beograd). Prvi mesec godišnjeg plana dodeljuje `invoice.paid` (`subscription_create`), a worker preskače mesec u kome je `created_at` pretplate (inače bi dvaput u istom mesecu).
- Komp: worker, `plan = 'komp' and (komp_expires_at is null or > now())`, target `PLANS.komp.monthlyCredits`.
- Sve ostalo (`dopuna`, `trialing`, `past_due`, `canceled`): worker **ne dira**. Pražnjenje na kraju pretplate radi `expire_subscription_credits` (§3.4).

`monthly-grant.ts` posle izmene: upit nad `subscriptions join profiles` umesto nad `profiles`; dve grane (year, komp); ostalo isto.

---

## 11. Env varijable

| Ime | Gde | Test | Live | Baca ako fali? |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | Vercel (web), lokalno | `sk_test_…` | `sk_live_…` | da (`stripeServerSchema`, regex `^sk_(test\|live)_`) |
| `STRIPE_WEBHOOK_SECRET` | Vercel (web), lokalno (iz `stripe listen`) | `whsec_…` | `whsec_…` | da |
| `STRIPE_COUPON_FIRST_MONTH` | Vercel (web) | ID iz test moda | ID iz live moda | da |
| `NEXT_PUBLIC_APP_URL` | Vercel (web), lokalno | `http://localhost:3000` | `https://app.sajtoskop.com` | da (success/cancel URL) |
| `PLACES_MONTHLY_BUDGET_EUR` | worker + web (postoji) | | | ne |

Worker **nema nijedan Stripe ključ** — ne zove Stripe. Nema `NEXT_PUBLIC_STRIPE_*`. Vercel: Preview okruženje dobija test ključeve, Production live; **nikad isti webhook secret u oba** (svaki endpoint u Stripe panelu ima svoj). Lokalno: `stripe listen --forward-to localhost:3000/api/billing/webhook` daje `whsec_` za `.env.local`.

`env.ts`:

```ts
const stripeServerSchema = z.object({
  STRIPE_SECRET_KEY: z.string().regex(/^sk_(test|live)_/, { message: "sk_test_ ili sk_live_" }),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_/),
  STRIPE_COUPON_FIRST_MONTH: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url(),
});
export function stripeServerEnv() { const p = stripeServerSchema.safeParse(process.env); if (!p.success) fail(p.error); return p.data; }
```

`stripe-server.ts` uz to proverava: `sk_live_` sme samo kad `VERCEL_ENV === "production"` — obrnuto ne puca nego naplaćuje pravu karticu sa preview deploya.

---

## 12. Plan testiranja (Stripe test mod)

Preduslovi: `stripe listen` uključen, test ključevi u `.env.local`, kartice `4242 4242 4242 4242` (prolazi), `4000 0000 0000 0341` (prolazi na setup, pada na naplati), `4000 0000 0000 9995` (pada odmah). Vreme se pomera Stripe **test clock**-om (Dashboard → Developers → Test clocks): kupac napravljen pod satom, sat se pomera 8 dana napred.

| # | Scenario | Koraci | Očekivano u bazi posle |
|---|---|---|---|
| 1 | Kupovina Pro mesečno, bez probe (nalog koji je već imao probu) | checkout 4242 | `subscriptions`: status `active`, plan `pro`, ciklus `month`, `current_period_end ≈ +30d`; `profiles.plan = pro`, `plan_expires_at = period_end`, `stripe_customer_id` popunjen; `credit_ledger`: `monthly_grant` ref `in_…` delta do 450; `billing_events` ima `checkout.session.completed`, `subscription.created`, `invoice.paid` |
| 2 | Proba → plaćeno | nov nalog, Starter, test clock +8d | dan 0: `status trialing`, `trial_end +7d`, ledger `trial_grant` +10 ref `trial:<user>`, balans 10, NEMA `monthly_grant`; posle sata: `invoice.paid` `subscription_cycle`, ledger `monthly_grant` ref `in_…`, balans **150** (ne 160), status `active`, `plan_expires_at +30d` |
| 3 | Proba otkazana pre kraja | dan 3 portal → otkaži | `cancel_at = trial_end` (dahlia; `cancel_at_period_end` izveden = true), status `trialing`; `stanjePristupa` = `otkazan`, `punDo = trial_end`; sat +8d → `subscription.deleted`, `expire` ledger −ostatak, balans 0, status `canceled`, stanje `grace` |
| 4 | Kartica pala osmog dana | proba sa `…0341`, sat +8d, pa +8d | dan 8: `invoice.payment_failed` u `billing_events`, status `past_due`, `plan_expires_at` = dan 8 → `grace`; posle retry-a: `deleted`, balans 0 |
| 5 | Upgrade Starter → Pro (portal) | portal → switch | `subscription.updated` lookup `pro_month`, `profiles.plan = pro`; `invoice.paid` `subscription_update` → `monthly_grant` ref nova `in_`, balans 450 |
| 6 | Downgrade Pro → Starter | portal → switch | plan se menja tek na `period_end` (schedule); do tada `profiles.plan = pro`; na obnovi `invoice.paid` → balans 150 |
| 7 | Otkaz pa reaktivacija u istom periodu | portal otkaži, pa „renew" | `cancel_at` postavljen → `null`, izvedeni `cancel_at_period_end` true → false; stanje `otkazan` → `aktivan`; nula novih ledger redova |
| 8 | Refund naplate pretplate (i proracione) | Dashboard → refund `ch_` | `charge.refunded` → `invoicePayments` nađe `in_` → `apply_refund` −(suma `delta` redova pod `in_`): **jedan** red `povracaj`, ref `povracaj:<ch_…>`, bez `admin_audit`. Pro 450 + upgrade na Advanced (+750) pa refund → −750, balans 450. Resend istog događaja → `duplikat`; bez markera → `already_applied`, nula novih redova. Dva delimična refunda iste naplate (2 × 50%) → **dva** reda, svaki sa svojim `re_…` i svojim iznosom. Balans može u minus do −1000 |
| 9 | Dupli webhook | `stripe events resend evt_<invoice.paid>` | drugi put: `billing_events` konflikt → `{duplikat:true}`, ledger nepromenjen. Pa obriši red iz `billing_events` i resend: `grant_monthly_credits` vraća `already_granted`, balans isti |
| 10 | Paket 200 | aktivan nalog, checkout paket | `checkout.session.completed` mode payment → ledger `credit_pack` +200 ref `pi_…`, `credits_topup = 200`, `credits_balance` netaknut; nalog bez plana → checkout vraća 403 |
| 11 | Komp pozivnica | admin napravi `komp` 30d/300, nov nalog `/pozivnica/KOD` | `profiles.plan = komp`, `komp_expires_at +30d`, ledger `komp_grant` +300 ref `invite:<id>`, `access_invite_redemptions` red, `used_count = 1`; drugi nalog istim kodom → `used_up`; `stanjePristupa` = `komp`; checkout plana → 409 |
| 12 | Prvi mesec gratis | admin `prvi_mesec`, nov nalog, kod, pa checkout Pro | `profiles.invite_id` postavljen; sesija ima `discounts`; `invoice.paid` `amount_due = 0`, `subscription_create`, `total_discount_amounts > 0` → **dodela 450** (za razliku od probe); status `active` (ne trialing), `trial_end null`; `invite_id = null` posle `checkout.session.completed`; sat +30d → normalna naplata €59 |

Plus dva koja nisu naplata ali su D10/B5: (13) pretraga iz keša skida kredit i pravi `search_access`; ista pretraga drugi put = `already_paid`, 0 kredita; (14) „Duboko" nad gradom sa 25 firmi: worker `apiCalls = 2` → `refund_scan(job, 2)` vraća 1, `search_access.pages = 2`.

Test fajl `apps/web/test/naplata.ts`: događaji 1, 2, 3, 8, 9, 10, 12 kao JSON fiksture potpisane pravim `stripe.webhooks.generateTestHeaderString({ payload, secret })` — potpis se NE lažira, isto kao pre.

---

## 14. Ekonomija kredita

### 14.1 Stvaran trošak po akciji

| Akcija | Sastav | Trošak | Napomena |
|---|---|---|---|
| Places poziv (1 stranica) | Text Search Enterprise $35/1.000 | **€0,032** | prvih 1.000/mes besplatno |
| Skeniranje iz keša | 0 poziva | **€0,000** | Supabase upit |
| Otključavanje | screenshot (Hetzner CX22 ≈ €4/mes, fiksno) + PSI (besplatno, 25k/dan) + Claude Sonnet 5 vision: 2 smanjene slike ≈ 2×1.200 tok + prompt ≈ 900 + evidence ≈ 400 ulaz ≈ **3.700 × $3/M = $0,011**; izlaz ≈ 600 × $15/M = $0,009 | **≈ €0,019** + amortizacija ≈ €0,005 na 800 unlockova/mes → **€0,024** | Haiku 4.5 bi bio ≈ €0,006; Opus ≈ €0,05. Ostaje Sonnet |
| AI varijanta poruke | Sonnet: ≈ 700 ulaz + 200 izlaz | **≈ €0,0045** | |
| Stripe naknada | 2,9% + $0,30 + 1,5% (strana kartica, US nalog) + 1% (EUR→USD) ≈ **5,4% + €0,28** | Starter €1,85 (6,4%) · Pro €3,47 (5,9%) · Advanced €6,71 (5,6%) · paket €19: €1,31 · €49: €2,93 | proveri u panelu posle prvog live prolaza — ovo je javna tarifa, ne ugovorena |

### 14.2 Cena u kreditima — odluka

| Akcija | Kredita | Trošak/kredit | Pokriće |
|---|---|---|---|
| Skeniranje Brzo / Standardno / Duboko | **1 / 2 / 3**, uvek, i iz keša (D10) | €0,032 / €0 | — |
| Otključavanje | **1** (D11) | €0,024 | — |
| AI varijanta poruke | **0 kredita, dnevni limit 5 / 20 / 60** (postojeći `aiRewritePerDay`) | €0,0045 | Advanced najgori: 60×30×€0,0045 = **€8,1/mes** = 6,8% cene |

**Zašto AI varijanta ostaje na limitu, ne kreditu:** kredit vredi €0,15–0,29 a poziv košta pola centa — kredit bi bio 40× precenjen i ubio bi jedinu funkciju koja pravi naviku. Limit već postoji u `plans.ts` i u SQL-u (`claim_ai_rewrite`), samo ga niko ne zove (B1). **K1 ga vezuje**: `POST /api/poruke/ai` zove `claim_ai_rewrite(userId, PLANS[planLimita].aiRewritePerDay)` pre `enqueueRewrite`, vraća 429 sa `reset_at`; worker `rewrite-message` na pad poziva `release_ai_rewrite`. Globalni `AI_OUTREACH_DAILY_CAP` se diže sa 40 na **200** da ne bude ispod ponude (60 × 3 Advanced korisnika). Najgori slučaj je u tabeli ispod uračunat.

### 14.3 D10 — kako se plaća pristup kešu (spec za K1)

Pojam **pristup** (§3.6): plaćeno pravo da se lista (grad, niša) gleda do N stranica, 30 dana, ili kraće ako Google podatak istekne ranije.

Ruta `POST /api/search`:
1. `pay: false` → `has_search_access(user, RS, city, niche, stranica)`. `true` → `searchCachedLeads` kao do sada (paginacija, filteri, osvežavanje — sve besplatno unutar pristupa). `false` → `needs_scan` sa `cost` (iz keša: `min(stranica, ceil(total/20))`; inače `stranica`), `kind` (`kes` / `prvo` / `plice` / `osvezavanje`), `creditsLeft`.
2. `pay: true` → `budzetZaScan` **samo ako keš nije svež** (iz keša nema Places poziva) → `claimCacheMiss` isto (osigurač je za Places) → `spend_credit_and_scan` (§3.6). `cached` → odmah `searchCachedLeads`, `status: "cache"`, `charged: true`, `cost`. `charged` → kao do sada, `queued`. `already_paid` → kao do sada.
3. `force` ostaje: nad svežim kešom sa plaćenim pristupom „Skeniraj ponovo" ide u live scan i plaća ponovo.

`besplatno()` iz `search-cache.ts` se **briše**; `stanjeKesa` ostaje (UI treba svežina i broj firmi za tekst „u kešu, 47 firmi, 1 kredit").

Klijent `pretraga-ekran.tsx`: unija `Cena` gubi `vrsta: "besplatno"`; dobija `vrsta: "pristup"` (plaćeno, `cost: 0`) i `vrsta: "kes"` (svež, `cost: n`, tekst „Iz keša · n kredita · odmah"). Potvrda cene u modalu za **svako** prvo otvaranje kombinacije. `kes-lista.tsx` i `pretraga/page.tsx`: „besplatno do…" → „u kešu do …", opis „Sve što je u kešu stiže odmah, po istoj ceni". `/pretraga` lista „Moji pristupi" (iz `search_access` kroz RLS) sa rokom.

### 14.4 „Manje nego traženo → razlika nazad" (spec za K1)

Worker `scan.ts` posle `collectAndUpsert`: `if (apiCalls < stranica) await refundScan(ctx.job.id, apiCalls)`. `apiCalls` je tačan broj napravljenih Places poziva — Google prestaje da vraća `nextPageToken` kad nema više rezultata, pa je razlika tačno ono što nije koštalo. Postojeći pozivi `refundScan(job)` (prazno, neupisan registar) ostaju sa `0` = sve. `db-writes.ts`: `refundScan(jobId, pagesUsed = 0)`. Iz keša: cena je već `ceil(total/20)`, nema šta da se vrati. Na landingu i cenovniku rečenica: „Ako nađemo manje firmi nego što si tražio, razliku vraćamo."

### 14.5 Poređenje sa Ugly Site Scraperom

USS: $29/59/119 → 250/500/1.000 kredita; 1 kredit = 1 firma sa kontaktom, screenshotom i AI skorom, svaka nađena firma se naplati. Sajtoskop: 1 kredit = 20 firmi sa statusom sajta, telefonom, tipom telefona i Ugly Score slojem 1 (skeniranje), ili 1 firma sa screenshotom, PSI, Claude analizom i gotovom porukom na srpskom (otključavanje). Puna obrada jedne firme u Sajtoskopu = 1 unlock + 1/20 scana ≈ **1,05 kredita**.

| | USS Starter | Sajtoskop Starter 100 | Sajtoskop Starter **150** |
|---|---|---|---|
| Kredita | 250 | 100 | 150 |
| Punih prospekata max | 250 | ~95 | ~140 |
| €/pun prospekt | ≈ €0,11 | €0,31 | €0,21 |
| Firmi koje *vidiš* za tu cenu | 250 | 2.000 (100 brzih skeniranja) | 3.000 |

Na papiru USS daje 2,5× više „obrađenih firmi" po evru. Ali USS naplaćuje svaku firmu koju nađe, i one koje ne bi kontaktirao; Sajtoskop naplaćuje pregled 20 firmi za 1 kredit, pa otključavanje samo onih koje vrede. Korisnik koji otključava 1 od 4 viđene firme troši u Sajtoskopu ≈ 1,25 kredita po firmi koju hoće, a u USS-u 4 kredita (jer su sve 4 naplaćene). Poređenje po „firmi koju hoću" je onda Sajtoskop €0,26 vs USS €0,46. To je argument za landing i pitch (P3, P6), ne izgovor za tanak Starter.

### 14.6 Preporuka konačnih brojeva (5 rečenica)

**Starter 150 / Pro 450 / Advanced 1.200 kredita mesečno; paketi 75 za €19 i 200 za €49.** Trošak po kreditu je u najgorem slučaju €0,032, pa i 50% više kredita drži marginu iznad 60% na svakom planu (tabela ispod), a poređenje sa USS-om po kreditu sa 100 kredita ne izdrži ni uz najbolje objašnjenje — 2,5× je broj koji čovek vidi pre nego što pročita razliku. Cena po kreditu postaje Starter €0,193 · Pro €0,131 · Advanced €0,099, paketi €0,253 / €0,245 (i dalje +31% / +27% nad Starterom, dakle dopuna, ne zamena). Places budžet mora da prati: jedan Advanced u najgorem režimu je 1.200 od 2.875 poziva, pa `PLACES_MONTHLY_BUDGET_EUR` ide na **€100** (≈ 4.100 poziva) pre nego što se otvori peti pretplatnik, a keš ovaj rizik u praksi seče na trećinu. Landing i cenovnik se ionako prepisuju u P3/K7, pa je ovo jedini trenutak kad promena brojeva ne košta ništa.

### 14.7 Marža po planu

Normalan korisnik: 60% kredita na otključavanje (€0,024), 40% na skeniranje od čega pola iz keša (€0,016 prosek); AI varijante 20% limita. Najgori: svi krediti na duboka skeniranja van keša + pun AI limit svaki dan.

| Plan | Cena | Krediti | Normalan trošak | Stripe | **Marža normalno** | Najgori trošak (krediti + AI) | **Marža najgore** |
|---|---|---|---|---|---|---|---|
| Starter | €29 | 150 | 150×(0,6×0,024+0,4×0,016)=€3,12 + AI 30×€0,0045=€0,14 → €3,26 | €1,85 | **82%** | €4,80 + €0,68 = €5,48 | **75%** |
| Pro | €59 | 450 | €9,36 + €0,54 → €9,90 | €3,47 | **77%** | €14,40 + €2,70 = €17,10 | **65%** |
| Advanced | €119 | 1.200 | €24,96 + €1,62 → €26,58 | €6,71 | **72%** | €38,40 + €8,10 = €46,50 | **55%** |
| Paket 75 | €19 | 75 | €1,56 | €1,31 | 85% | €2,40 | 80% |
| Paket 200 | €49 | 200 | €4,16 | €2,93 | 86% | €6,40 | 81% |
| Proba | €0 | 10 | €0,21 | €0 | — | €0,32 | — |

Nijedna akcija ni u najgorem slučaju ne ide u minus. Advanced najgori 55% je najtanji red i to je svesno: taj korisnik je i najskuplji za Google budžet — nedeljna rutina gleda baš njega.

### 14.8 Šta se menja ako se brojevi promene

- `plans.ts`: `PLANS.*.monthlyCredits`, `CREDIT_PACKS`, `PLAN_PRICES.eur` — jedino mesto.
- Stripe: iznos na `price` se **ne menja** (Stripe cene su nepromenljive) — pravi se nova cena sa istim `lookup_key` i `transfer_lookup_key: true`, stara se arhivira. Postojeći pretplatnici ostaju na staroj ceni dok ih ne prebaciš.
- SQL: nijedan RPC ne zna broj kredita plana — `apply_invoice_paid` prima `p_target` iz koda. Jedino `admin_open_komp` ima gornju granicu 2000 (podignuta sa 500).
- Povraćaj novca ide kroz `apply_refund` (0032) — jedan red, bez granice od 500; skida tačno ono što je naplata upisala.
- Cenovnik, landing (`content.ts`), FAQ, OG slika, mejlovi: tekst.


---

## 15. Promptovi za Claude Code

Promptovi K1–K3 izvršeni su u S25–S27 i obrisani odavde 16. 9. 2026 (u git istoriji ovog
fajla). Šta je isporučeno i gde se razišlo sa spec-om: `docs/dnevnik-isporuka.md`.
