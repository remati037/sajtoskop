// apps/web/src/lib/stripe-server.ts
// Serverski Stripe klijent. Jedno mesto na kome `STRIPE_SECRET_KEY` uopšte
// postoji u procesu.
//
// `import "server-only"` je ovde iz istog razloga kao u `lib/supabase.ts`: jedan
// slučajan import iz „use client" komponente i tajni ključ ide u bundle svakog
// posetioca. Klijentske strane NEMA: hosted Checkout i Customer Portal su
// redirekcije na Stripe-ov domen, pregledač ne učitava nijedan Stripe skript i
// ne postoji nijedna `NEXT_PUBLIC_STRIPE_*` promenljiva (naplata-stripe.md §1.1).
//
// ── zašto je `apiVersion` PINOVANA i ne dira se ─────────────
// Oblik `invoice` i `subscription` objekata se menjao tokom 2025 (npr.
// `current_period_end` je prešao sa pretplate na stavku, `invoice.subscription`
// u `invoice.parent.subscription_details`). Webhook čita OBA oblika (§6.3), ali
// verzija ovde mora da bude ISTA kao ona na webhook endpointu u Stripe panelu —
// inače potpis prolazi, a polja koja obrada traži ne postoje. Verzija stoji i u
// `.env.example`; menja se na oba mesta zajedno, i nikad usput.

import "server-only";
import Stripe from "stripe";
import { KonfigGreska, stripeServerEnv } from "./env";
import { LANDING_URL } from "./veze";

/**
 * Verzija Stripe API-ja koju ovaj kod razume.
 *
 * ‼️ Mora da se poklapa sa verzijom webhook endpointa u Stripe panelu i sa
 *    podrazumevanom verzijom naloga (naplata-stripe.md §1.3, §2.2). SDK 22.6
 *    je izdat uz ovu verziju; ako panel prikazuje drugu, menjaju se OVAJ red,
 *    endpoint i `.env.example` — zajedno.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" satisfies Stripe.LatestApiVersion;

let klijent: Stripe | null = null;

/**
 * Stripe SDK, podignut jednom po procesu.
 *
 * Baca kad env nije podešen — i kad se `sk_live_` ključ nađe VAN produkcije.
 * Ta ukrštena provera nije kozmetika: preview deploy sa live ključem ne pukne
 * sam od sebe, nego napravi PRAVU naplatu prave kartice sa test strane.
 * Obrnuto (`sk_test_` u produkciji) ne pravi štetu, samo ne naplaćuje — i vidi
 * se odmah, pa se ne brani ovde.
 */
export function stripe(): Stripe {
  if (klijent) return klijent;

  const { STRIPE_SECRET_KEY } = stripeServerEnv();

  if (STRIPE_SECRET_KEY.startsWith("sk_live_") && process.env.VERCEL_ENV !== "production") {
    // Poruka nosi PREFIKS i ime okruženja, ne ključ. Ovaj tekst završi u logu.
    throw new KonfigGreska(
      "STRIPE_SECRET_KEY je `sk_live_`, a VERCEL_ENV nije `production` — live ključ sme " +
        "isključivo na produkcijskom deployu.",
    );
  }

  klijent = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    // SDK sam ponavlja mrežne greške; dva pokušaja su dovoljna za checkout i
    // portal, a webhook ruta ionako ne zove mrežu osim za otisak kartice.
    maxNetworkRetries: 2,
    // Domen ide kroz `lib/veze.ts`, nikad zakucan (S24; `test/veze.ts` to obara).
    appInfo: { name: "Sajtoskop", url: LANDING_URL },
  });
  return klijent;
}
