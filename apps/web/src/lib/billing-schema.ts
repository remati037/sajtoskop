// apps/web/src/lib/billing-schema.ts
// Granica ka pregledaču za `/api/billing/checkout` (CLAUDE.md: „Zod 4 za sve
// granice"; naplata-stripe.md §5.1).
//
// Telo nosi ŠTA se kupuje slugom iz kataloga — plan i ciklus, ili paket. Sve
// ostalo izvodi server: `user_id` iz Clerk sesije (pravilo 8), `lookup_key` iz
// `plans.ts`, `price_` ID iz Stripe-a po tom ključu. Klijent ne šalje ni
// `lookup_key` ni `price_`, pa nijedan ne može ni da slaže.

import { z } from "zod";

export const checkoutBodySchema = z.discriminatedUnion("vrsta", [
  z.strictObject({
    vrsta: z.literal("plan"),
    plan: z.enum(["starter", "pro", "advanced"]),
    ciklus: z.enum(["month", "year"]),
  }),
  z.strictObject({
    vrsta: z.literal("paket"),
    paket: z.enum(["dopuna-75", "dopuna-200"]),
  }),
]);

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

/**
 * `/api/billing/aktiviraj` (S26, §7.4): telo je PRAZNO, i to je cela šema.
 *
 * `strictObject({})` ne služi da nešto primi nego da odbije: `{ subscriptionId }`
 * ili `{ userId }` iz pregledača pada sa `400` umesto da bude tiho ignorisan.
 * Tiho ignorisano polje je poziv da ga neko sutra „iskoristi" (pravilo 8).
 */
export const aktivirajBodySchema = z.strictObject({});
