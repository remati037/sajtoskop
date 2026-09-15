/**
 * scripts/stripe-seed.ts — pravi/poravnava Stripe katalog iz `plans.ts`.
 *
 *   pnpm stripe:seed --samo-provera     ništa ne menja, prijavi razlike
 *   pnpm stripe:seed                    napravi/poravnaj (test ključ)
 *   STRIPE_SECRET_KEY=sk_live_… pnpm stripe:seed --live
 *
 * Idempotentno: proizvodi i kupon imaju fiksne ID-jeve, cene se traže po
 * `lookup_key`. Pokretanje dvaput ne pravi duplikate. Iznosi dolaze isključivo
 * iz packages/shared/src/plans.ts — Stripe se poravnava po kodu, nikad obrnuto.
 *
 * Ako se cena promeni u plans.ts: nova Stripe cena preuzima `lookup_key`
 * (transfer_lookup_key), stara se arhivira. Kod se ne dira.
 */

import Stripe from "stripe";
// Relativno, kao u stripe-doktor.ts: root nema `@sajtoskop/shared` u zavisnostima.
import {
  CREDIT_PACKS,
  PLAN_PRICES,
  type Ciklus,
  type PaidPlanId,
} from "../packages/shared/src/plans";
import { loadRootEnv } from "../apps/worker/src/lib/env";

loadRootEnv();

// ── argumenti ────────────────────────────────────────────────
const args = process.argv.slice(2);
const samoProvera = args.includes("--samo-provera");
const dozvoliLive = args.includes("--live");

const kljuc = process.env.STRIPE_SECRET_KEY;
if (!kljuc) padni("STRIPE_SECRET_KEY nije postavljen.");
if (kljuc.startsWith("sk_live_") && !dozvoliLive) {
  padni("Ovo je LIVE ključ. Dodaj --live ako to baš hoćeš.");
}
if (!/^sk_(test|live)_/.test(kljuc)) padni("Ključ ne počinje sa sk_test_ / sk_live_.");

const stripe = new Stripe(kljuc, {
  // Pinovano isto kao u apps/web/src/lib/stripe-server.ts. Ako je prazno,
  // koristi se podrazumevana verzija SDK-a.
  ...(process.env.STRIPE_API_VERSION
    ? { apiVersion: process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion }
    : {}),
});

// ── katalog ──────────────────────────────────────────────────
const PROIZVOD_PLANA: Record<PaidPlanId, { id: string; name: string }> = {
  starter: { id: "sajtoskop_starter", name: "Sajtoskop Starter" },
  pro: { id: "sajtoskop_pro", name: "Sajtoskop Pro" },
  advanced: { id: "sajtoskop_advanced", name: "Sajtoskop Advanced" },
};

const PROIZVOD_PAKETA: Record<string, { id: string; name: string }> = {
  "dopuna-75": { id: "sajtoskop_dopuna_75", name: "Sajtoskop Dopuna 75" },
  "dopuna-200": { id: "sajtoskop_dopuna_200", name: "Sajtoskop Dopuna 200" },
};

const KUPON_ID = "sajtoskop_prvi_mesec";

type Ishod = "ok" | "napravljeno" | "zamenjeno" | "RAZLIKA";
const izvestaj: { šta: string; ishod: Ishod; detalj: string }[] = [];

// ── helperi ──────────────────────────────────────────────────
function padni(poruka: string): never {
  console.error(`✖ ${poruka}`);
  process.exit(1);
}

function jeNemaGa(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "resource_missing"
  );
}

async function osiguraProizvod(
  id: string,
  name: string,
  metadata: Record<string, string>,
): Promise<string> {
  try {
    const p = await stripe.products.retrieve(id);
    if (!p.active && !samoProvera) await stripe.products.update(id, { active: true });
    izvestaj.push({ šta: `product ${id}`, ishod: p.active ? "ok" : "zamenjeno", detalj: p.name });
    return p.id;
  } catch (err) {
    if (!jeNemaGa(err)) throw err;
    if (samoProvera) {
      izvestaj.push({ šta: `product ${id}`, ishod: "RAZLIKA", detalj: "ne postoji" });
      return id;
    }
    const p = await stripe.products.create({ id, name, metadata });
    izvestaj.push({ šta: `product ${id}`, ishod: "napravljeno", detalj: name });
    return p.id;
  }
}

async function osiguraCenu(opts: {
  lookupKey: string;
  product: string;
  eur: number;
  interval?: Ciklus;
  metadata?: Record<string, string>;
}): Promise<void> {
  const { lookupKey, product, eur, interval, metadata } = opts;
  const centi = Math.round(eur * 100);

  const lista = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const postojeca = lista.data[0];

  const telo: Stripe.PriceCreateParams = {
    currency: "eur",
    unit_amount: centi,
    product,
    lookup_key: lookupKey,
    tax_behavior: "unspecified",
    ...(interval ? { recurring: { interval } } : {}),
    ...(metadata ? { metadata } : {}),
  };

  if (!postojeca) {
    if (samoProvera) {
      izvestaj.push({ šta: `price ${lookupKey}`, ishod: "RAZLIKA", detalj: "ne postoji" });
      return;
    }
    const c = await stripe.prices.create(telo);
    izvestaj.push({ šta: `price ${lookupKey}`, ishod: "napravljeno", detalj: `${eur} EUR · ${c.id}` });
    return;
  }

  const isti =
    postojeca.unit_amount === centi &&
    postojeca.currency === "eur" &&
    (postojeca.recurring?.interval ?? null) === (interval ?? null) &&
    postojeca.product === product;

  if (isti) {
    izvestaj.push({ šta: `price ${lookupKey}`, ishod: "ok", detalj: `${eur} EUR · ${postojeca.id}` });
    return;
  }

  const staro = `${(postojeca.unit_amount ?? 0) / 100} ${postojeca.currency.toUpperCase()}${
    postojeca.recurring ? `/${postojeca.recurring.interval}` : " (jednokratno)"
  }`;

  if (samoProvera) {
    izvestaj.push({ šta: `price ${lookupKey}`, ishod: "RAZLIKA", detalj: `Stripe ${staro} ≠ kod ${eur} EUR` });
    return;
  }

  const nova = await stripe.prices.create({ ...telo, transfer_lookup_key: true });
  await stripe.prices.update(postojeca.id, { active: false });
  izvestaj.push({
    šta: `price ${lookupKey}`,
    ishod: "zamenjeno",
    detalj: `${staro} → ${eur} EUR · nova ${nova.id}, arhivirana ${postojeca.id}`,
  });
}

async function osigurajKupon(): Promise<void> {
  try {
    const k = await stripe.coupons.retrieve(KUPON_ID);
    const isti = k.percent_off === 100 && k.duration === "once" && k.valid;
    izvestaj.push({
      šta: `coupon ${KUPON_ID}`,
      ishod: isti ? "ok" : "RAZLIKA",
      detalj: isti ? "100% · once" : "postoji ali nije 100%/once — obriši ga u panelu i pusti ponovo",
    });
  } catch (err) {
    if (!jeNemaGa(err)) throw err;
    if (samoProvera) {
      izvestaj.push({ šta: `coupon ${KUPON_ID}`, ishod: "RAZLIKA", detalj: "ne postoji" });
      return;
    }
    await stripe.coupons.create({
      id: KUPON_ID,
      name: "Prvi mesec gratis",
      percent_off: 100,
      duration: "once",
    });
    izvestaj.push({ šta: `coupon ${KUPON_ID}`, ishod: "napravljeno", detalj: "100% · once" });
  }
}

// ── glavni tok ───────────────────────────────────────────────
async function glavno(): Promise<void> {
  const rezim = kljuc!.startsWith("sk_live_") ? "LIVE" : "test";
  console.log(`Stripe katalog · režim: ${rezim}${samoProvera ? " · samo provera" : ""}\n`);

  for (const plan of Object.keys(PLAN_PRICES) as PaidPlanId[]) {
    const { id, name } = PROIZVOD_PLANA[plan];
    const product = await osiguraProizvod(id, name, { plan });
    for (const ciklus of ["month", "year"] as const) {
      const cena = PLAN_PRICES[plan][ciklus];
      await osiguraCenu({
        lookupKey: cena.lookupKey,
        product,
        eur: cena.eur,
        interval: ciklus,
        metadata: { plan, ciklus },
      });
    }
  }

  for (const [paket, p] of Object.entries(CREDIT_PACKS)) {
    const { id, name } = PROIZVOD_PAKETA[paket]!;
    const product = await osiguraProizvod(id, name, { paket, credits: String(p.credits) });
    await osiguraCenu({
      lookupKey: p.lookupKey,
      product,
      eur: p.eur,
      metadata: { paket, credits: String(p.credits) },
    });
  }

  await osigurajKupon();

  const sirina = Math.max(...izvestaj.map((r) => r.šta.length));
  for (const r of izvestaj) {
    const znak = r.ishod === "ok" ? "·" : r.ishod === "RAZLIKA" ? "✖" : "+";
    console.log(`${znak} ${r.šta.padEnd(sirina)}  ${r.ishod.padEnd(12)} ${r.detalj}`);
  }

  const razlike = izvestaj.filter((r) => r.ishod === "RAZLIKA").length;
  console.log("");
  if (razlike > 0) {
    console.error(`✖ ${razlike} razlika. ${samoProvera ? "Pusti bez --samo-provera." : "Pogledaj gore."}`);
    process.exit(1);
  }
  console.log(`✓ Katalog je poravnat sa plans.ts. Kupon: ${KUPON_ID}`);
}

glavno().catch((err) => {
  console.error(err);
  process.exit(1);
});