// apps/web/src/lib/sentry.ts
// Eksplicitna prijava greške iz rute koja je grešku sama uhvatila (checklista 2.1).
//
// Webhookovi, `/api/search` i `/api/unlock` hvataju svaki izuzetak i vraćaju
// uređen 500 sa srpskom porukom — tačno kako treba za korisnika i za Stripe/Svix
// ponavljanje, ali zato `onRequestError` u `instrumentation.ts` nikad ne vidi
// pad. Ova funkcija je taj most.
//
// Šta NE ide ovde: telo zahteva, mejl, `event.data` iz webhooka. `beforeSend`
// ih ionako briše, ali ono što se ne pošalje ne mora ni da se briše.
// `dodatno` nosi samo ID-jeve i imena (Stripe `evt_…`, tip posla, radnju).
//
// Bez `SENTRY_DSN` Sentry nije podignut i ovo je no-op.

import "server-only";
import * as Sentry from "@sentry/nextjs";

export type OblastGreske =
  | "api/billing/webhook"
  | "api/webhooks/clerk"
  | "api/search"
  | "api/unlock";

type Dodatno = Record<string, string | number | boolean | null | undefined>;

export function prijaviGresku(
  greska: unknown,
  oblast: OblastGreske,
  opcije: { korisnik?: string; dodatno?: Dodatno } = {},
): void {
  try {
    Sentry.captureException(greska, {
      tags: { oblast },
      ...(opcije.korisnik ? { user: { id: opcije.korisnik } } : {}),
      ...(opcije.dodatno ? { extra: opcije.dodatno } : {}),
    });
  } catch {
    // Prijava greške ne sme da obori odgovor na grešku.
  }
}

/**
 * Za neuspeh koji NIJE izuzetak — npr. trajno odbijen Stripe događaj koji ruta
 * potvrđuje sa 200 da ga Stripe ne bi vrteo tri dana. Bez ovoga bi takav
 * događaj ostao samo u Vercel logu.
 */
export function prijaviPoruku(
  poruka: string,
  oblast: OblastGreske,
  opcije: { korisnik?: string; dodatno?: Dodatno } = {},
): void {
  try {
    Sentry.captureMessage(poruka, {
      level: "error",
      tags: { oblast },
      ...(opcije.korisnik ? { user: { id: opcije.korisnik } } : {}),
      ...(opcije.dodatno ? { extra: opcije.dodatno } : {}),
    });
  } catch {
    // v. iznad
  }
}
