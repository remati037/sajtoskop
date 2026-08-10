// apps/worker/src/lib/storage.ts
// Supabase Storage iz workera. Samo upis — čitanje ide kroz potpisan URL koji
// pravi web u `toPublicLead`.
//
// Bucket `screenshots` je PRIVATAN (0001_init.sql §5) i takav ostaje. Nema
// „privremeno javnog za testiranje" (F5 §7). Jedini način da klijent vidi sliku
// je potpisan URL sa rokom od 15 minuta, izdat tek posle provere otključanja.

import { supabaseAdmin } from "./supabase";

export const SCREENSHOT_BUCKET = "screenshots";

/**
 * Otpremi jedan webp. `upsert: false` je namerno — imena su nasumična, pa
 * konflikt ne postoji, a ako se ipak desi, to je znak da nešto nije u redu sa
 * generatorom imena i bolje je da pukne nego da tiho pregazi tuđu sliku.
 */
export async function uploadScreenshot(path: string, webp: Buffer): Promise<void> {
  const { error } = await supabaseAdmin()
    .storage.from(SCREENSHOT_BUCKET)
    .upload(path, webp, {
      contentType: "image/webp",
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw new Error(`Otpremanje screenshota nije uspelo: ${error.message}`);
}

/**
 * Obriši stare putanje posle uspešnog upisa novih.
 *
 * Nikad ne baca: sirotan u bucketu je trošak od 200KB, a pala grana posla zbog
 * brisanja fajla koji više ne treba nikom je gora šteta od tog trošenja.
 */
export async function removeScreenshots(paths: (string | null)[]): Promise<void> {
  const clean = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (clean.length === 0) return;

  await supabaseAdmin()
    .storage.from(SCREENSHOT_BUCKET)
    .remove(clean)
    .catch(() => {});
}
