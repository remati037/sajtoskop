// apps/web/src/lib/billing-schema.ts
// Granica ka pregledaču za `/api/billing/checkout` (CLAUDE.md: „Zod 4 za sve
// granice").
//
// Telo nosi TAČNO jedno polje i to polje mora da bude iz našeg kataloga. Sve
// ostalo — ko kupuje, koji plan je to, koliko kredita nosi — izvodi server:
// `user_id` iz Clerk sesije (pravilo 8), a plan i krediti iz `plans.ts` po
// `pri_` ID-ju. Klijent ne šalje nijedan od ta tri podatka, pa nijedan ne može
// ni da slaže.

import { ALL_PRICE_IDS } from "@sajtoskop/shared";
import { z } from "zod";

/**
 * Spisak kao `Set` da provera bude O(1) i, važnije, da ne postoji drugi spisak.
 * Katalog je `plans.ts` i samo `plans.ts`.
 */
const DOZVOLJENI = new Set<string>(ALL_PRICE_IDS);

export const checkoutBodySchema = z.object({
  // Oblik se proverava pre pripadnosti da poruka bude korisna: `„pri_" fali` i
  // `nije iz kataloga` su dve različite greške sa dva različita uzroka.
  priceId: z
    .string()
    .startsWith("pri_", { message: "mora biti Paddle price ID (`pri_…`)" })
    .refine((v) => DOZVOLJENI.has(v), { message: "nije iz našeg kataloga" }),
});

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
