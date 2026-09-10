// scripts/stripe-doktor.ts
// Proveri Stripe katalog naspram `packages/shared/src/plans.ts` (jedini izvor
// cena, naplata-stripe.md §4). Pokretanje: `pnpm stripe:doktor`
//
// Šta proverava:
//   1. da svih 8 `lookup_key` postoji kao AKTIVNA cena, tačno jednom
//   2. da je iznos jednak `plans.ts` (u centima), valuta EUR
//   3. da je ciklus tačan: `month`/`year` na planovima, jednokratno na paketima
//   4. da kupon `STRIPE_COUPON_FIRST_MONTH` postoji, 100%, `once`
//
// Katalog se proverava naspram koda, ne obrnuto: ako se ovde vidi razlika,
// menja se Stripe (nova cena sa `transfer_lookup_key`, §14.8), ne `plans.ts`.
// Radi i nad test i nad live ključem — koji god je u env-u.

import Stripe from "stripe";
import { z } from "zod";
import {
  ALL_LOOKUP_KEYS,
  CREDIT_PACKS,
  kupovinaZaLookupKey,
} from "../packages/shared/src/plans";
import { loadRootEnv } from "../apps/worker/src/lib/env";

loadRootEnv();

const env = z
  .object({
    STRIPE_SECRET_KEY: z.string().regex(/^sk_(test|live)_/),
    STRIPE_COUPON_FIRST_MONTH: z.string().min(1).optional(),
  })
  .safeParse(process.env);

if (!env.success) {
  console.error("STRIPE_SECRET_KEY fali ili nije sk_test_/sk_live_.");
  process.exit(1);
}

const stripe = new Stripe(env.data.STRIPE_SECRET_KEY);
const rezim = env.data.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "LIVE" : "test";

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

async function main(): Promise<void> {
  console.log(`Stripe katalog (${rezim} mod)\n`);

  const { data } = await stripe.prices.list({
    lookup_keys: [...ALL_LOOKUP_KEYS],
    active: true,
    limit: 50,
  });

  for (const key of ALL_LOOKUP_KEYS) {
    const cene = data.filter((p) => p.lookup_key === key);
    const kupovina = kupovinaZaLookupKey(key);
    if (!kupovina) {
      check(false, `${key}: nije u katalogu u plans.ts?!`);
      continue;
    }
    check(cene.length === 1, `${key}: tačno jedna aktivna cena (${cene.length})`);
    const p = cene[0];
    if (!p) continue;

    check(p.currency === "eur", `${key}: valuta EUR (${p.currency})`);
    check(
      p.unit_amount === kupovina.eur * 100,
      `${key}: iznos ${kupovina.eur} € (Stripe ${(p.unit_amount ?? 0) / 100} €)`,
    );
    if (kupovina.kind === "subscription") {
      check(
        p.recurring?.interval === kupovina.ciklus && p.recurring.interval_count === 1,
        `${key}: recurring ${kupovina.ciklus} (Stripe ${p.recurring?.interval ?? "one-time"})`,
      );
    } else {
      check(p.recurring === null, `${key}: jednokratno (paket ${CREDIT_PACKS[kupovina.paket].credits} kredita)`);
    }
  }

  if (env.data.STRIPE_COUPON_FIRST_MONTH) {
    try {
      const c = await stripe.coupons.retrieve(env.data.STRIPE_COUPON_FIRST_MONTH);
      check(c.valid, "kupon prvog meseca postoji i važi");
      check(c.percent_off === 100, `kupon je 100% (${c.percent_off ?? "?"}%)`);
      check(c.duration === "once", `kupon traje jednom (${c.duration})`);
    } catch (err) {
      check(false, `kupon: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log("· STRIPE_COUPON_FIRST_MONTH nije podešen — kupon se ne proverava");
  }

  console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
