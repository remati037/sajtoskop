// apps/web/src/lib/onboarding-schema.ts
// Ugovori tri rute `/api/onboarding/*` i oblik stanja koje ide u pregledač (S30).
//
// Odvojeno od ruta iz istog razloga kao `unlock-schema.ts`: šema se proverava
// bez podizanja Next-a. Bez `server-only` — tipove čita i `OnboardingProvider`.
//
// `userId` ni u jednoj šemi NE POSTOJI (pravilo 8). Sve tri su `strictObject`:
// ovde nepoznat ključ nije šum nego pokušaj da se upiše nešto što ruta ne nudi
// — pre svega korak koji upisuje server (`pretraga`, `otkljucavanje`, `pipeline`).

import { z } from "zod";
import { CITY_SLUGS, HINT_KLJUCEVI, NICHE_SLUGS, ONBOARDING_KANALI } from "@sajtoskop/shared";

/**
 * `POST /api/onboarding/korak`.
 *
 * Od četiri koraka trake klijent sme da prijavi SAMO `poruka` (§4.3): „Kopiraj"
 * nema serverski trag. Ostala tri upisuju rute koje te radnje i rade.
 *
 * Uz to ista ruta prima odgovore čarobnjaka (`grad`, `nisa`, `kanal`) — §1.8:
 * „Svaki korak: `POST /api/onboarding/korak {korak, vrednost}` →
 * `profiles.onboarding_city/niche/channel`". To nisu koraci trake i ne diraju
 * `onboarding_steps`; vrednost se proverava nad istim spiskom kao pretraga.
 */
export const korakBodySchema = z.union([
  z.strictObject({ korak: z.literal("poruka") }),
  z.strictObject({ korak: z.literal("grad"), vrednost: z.enum(CITY_SLUGS) }),
  z.strictObject({ korak: z.literal("nisa"), vrednost: z.enum(NICHE_SLUGS) }),
  z.strictObject({ korak: z.literal("kanal"), vrednost: z.enum(ONBOARDING_KANALI) }),
]);

export type KorakBody = z.infer<typeof korakBodySchema>;

/**
 * `POST /api/onboarding/preskoci`.
 *
 *   carobnjak — „Preskoči" na bilo kom ekranu `/pocetak` (§4.2)
 *   traka     — „Sakrij" u traci napretka (§4.6)
 *
 * Oba upisuju `onboarding_skipped_at` (§4.2, §4.6). `traka` uz to upisuje
 * `TRAKA_SKRIVENA` u `onboarding_hints_seen` — v. komentar uz konstantu.
 */
export const preskociBodySchema = z.strictObject({
  gde: z.enum(["carobnjak", "traka"]),
});

/** `POST /api/onboarding/hint` — tačka je zatvorena i ne vraća se (§4.5). */
export const hintBodySchema = z.strictObject({
  hint: z.enum(HINT_KLJUCEVI as [string, ...string[]]),
});

/** Stanje koje `(app)/layout.tsx` daje `OnboardingProvider`-u — iz profila, nula upita. */
export type OnboardingPocetno = {
  steps: Record<string, string>;
  doneAt: string | null;
  skippedAt: string | null;
  hintsSeen: string[];
  grad: string | null;
  nisa: string | null;
  kanal: string | null;
};

/** Odgovor `POST /api/onboarding/korak` za `poruka`. */
export type KorakOdgovor = {
  onboardingSteps: Record<string, string>;
  onboardingDoneAt: string | null;
};
