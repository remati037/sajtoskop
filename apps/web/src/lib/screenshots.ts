// apps/web/src/lib/screenshots.ts
// Potpisivanje URL-ova za screenshotove iz privatnog bucketa (F5 §4, P0-3).
//
// Bucket `screenshots` je privatan i takav ostaje. Klijent nikad ne dobija
// putanju u bucketu nego potpisan URL koji ističe za 15 minuta — i to samo za
// lead koji je taj korisnik otključao. Provera „da li je otključan" NIJE ovde:
// ona je u `toPublicLead`, koji je jedini pozivalac ovog modula i koji putanju
// zaključanog leada nikad ni ne prosledi.
//
// Zašto grupno potpisivanje: strana pretrage ima do 30 leadova × 2 snimka. Sa
// `createSignedUrl` po fajlu to je 60 HTTP poziva ka Supabase-u po prikazu.
// `createSignedUrls` je jedan.

import "server-only";
import { adminSupabase } from "./supabase";

const BUCKET = "screenshots";

/** Rok potpisa. PRD §4 i „Gotovo kad": posle 15 minuta link mora da prestane da radi. */
export const SCREENSHOT_TTL_SECONDS = 15 * 60;

/**
 * Putanja u bucketu → potpisan URL.
 *
 * Ne baca. Screenshot je dokaz uz lead, ne sam lead: ako Storage zakaže,
 * korisnik treba da vidi telefon i mejl koje je platio, a ne stranicu greške.
 * Neuspeh se loguje i lead izlazi bez snimka, kao da ga još nema.
 */
export async function signScreenshots(paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (unique.length === 0) return new Map();

  const { data, error } = await adminSupabase()
    .storage.from(BUCKET)
    .createSignedUrls(unique, SCREENSHOT_TTL_SECONDS);

  if (error) {
    console.error(`[screenshots] potpisivanje nije uspelo: ${error.message}`);
    return new Map();
  }

  const out = new Map<string, string>();
  for (const row of data ?? []) {
    // Supabase vraća `error` po fajlu — jedan obrisan snimak ne ruši ostale.
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}
