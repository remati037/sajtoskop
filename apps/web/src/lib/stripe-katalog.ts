// apps/web/src/lib/stripe-katalog.ts
// `lookup_key` → `price_` ID, jedno mesto, keširano po procesu (naplata-stripe.md §4).
//
// ‼️ Nijedan `price_` ID ne ulazi u kod. Test i live nalog imaju RAZLIČITE
//    ID-jeve za istu cenu, a `lookup_key` je isti u oba — pa se ID traži tek u
//    trenutku checkout-a, po ključu iz `plans.ts`. Katalog u `plans.ts` je izvor
//    istine; Stripe se proverava naspram njega (`pnpm stripe:doktor`), ne obrnuto.
//
// Mapa se puni jednim `prices.list` pozivom za svih osam ključeva i drži se
// dok proces živi. Kad ijedan ključ fali, mapa se NE keširа i poziv baca: pola
// kataloga bi značilo dugme koje radi za Starter a puca za Pro, i to bi se
// videlo tek kad neko klikne.

import "server-only";
import { ALL_LOOKUP_KEYS, type LookupKey } from "@sajtoskop/shared";
import { stripe } from "./stripe-server";

let mapa: Map<LookupKey, string> | null = null;

/** `price_` ID za ključ iz kataloga. Baca ako Stripe katalog nije kompletan. */
export async function priceIdZa(key: LookupKey): Promise<string> {
  if (!mapa) {
    const { data } = await stripe().prices.list({
      lookup_keys: [...ALL_LOOKUP_KEYS],
      active: true,
      limit: 20,
    });

    const sledeca = new Map<LookupKey, string>();
    for (const p of data) {
      if (p.lookup_key && (ALL_LOOKUP_KEYS as readonly string[]).includes(p.lookup_key)) {
        sledeca.set(p.lookup_key as LookupKey, p.id);
      }
    }

    const fali = ALL_LOOKUP_KEYS.filter((k) => !sledeca.has(k));
    if (fali.length > 0) {
      throw new Error(`Stripe katalog nema: ${fali.join(", ")}`);
    }
    mapa = sledeca;
  }

  const id = mapa.get(key);
  if (!id) throw new Error(`Stripe katalog nema: ${key}`);
  return id;
}
