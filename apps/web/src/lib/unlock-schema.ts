// apps/web/src/lib/unlock-schema.ts
// Ugovor tela `POST /api/unlock`. Odvojen od rute iz istog razloga kao
// `search-schema.ts`: da može da se proveri bez podizanja Next-a.

import { z } from "zod";

/**
 * `z.object`, a NE `z.strictObject` — namerno, i ovo je jedina razlika u odnosu
 * na `searchBodySchema`.
 *
 * Zod 4 podrazumevano ODBACUJE nepoznate ključeve iz izlaza. Time telo
 * `{ placeId, userId: "user_tudji" }` prolazi šemu, a `userId` iz njega nigde ne
 * postoji — ne kao promenljiva, ne kao polje, ni slučajno. To je tačno ponašanje
 * koje traži F4 §7: pokušaj se ignoriše, koristi se sesija.
 *
 * Sa `strictObject` bi isti zahtev vratio 400 i izgledao „bezbednije", ali bi
 * napadaču rekao da server uopšte gleda to polje, a legitimnog klijenta koji
 * pošalje ključ viška srušio na kraju plaćenog toka. Kod pretrage je strogost
 * bila opravdana jer nepoznat ključ (`limit`, `pageSize`) tamo znači pokušaj
 * bulk endpointa; ovde bulk ne postoji — otključava se jedan po jedan.
 */
export const unlockBodySchema = z.object({
  // Places `place_id` je neproziran string. Bez `enum` allowlist-a kao kod
  // gradova — zato ide isključivo u parametrizovan RPC poziv, nikad u sklopljen
  // upit. Gornja granica je zaštita od tela od megabajt teksta, ne validacija.
  placeId: z.string().min(1, { error: "Nedostaje ID prospekta." }).max(255),
  /**
   * [S30, §7.5] „Pokušaj ponovo" nad otključanim prospektom bez AI analize —
   * naruči nov `enrich_full`. Bez ovoga ista ruta samo vraća pun lead (posle
   * `done`, §7.4) i ne naručuje ništa. Kredit se ni u jednom slučaju ne skida
   * drugi put: prospekt je već otključan (`already_unlocked`).
   */
  ponovi: z.boolean().optional(),
});

export type UnlockBody = z.infer<typeof unlockBodySchema>;
