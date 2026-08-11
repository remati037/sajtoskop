// apps/web/src/lib/pipeline-schema.ts
// Ugovori tela za `/api/pipeline` i `/api/poruke` (F7).
//
// Odvojeno od ruta iz istog razloga kao `unlock-schema.ts`: šema se proverava
// bez podizanja Next-a, a ruta ostaje tanka.
//
// `userId` ni u jednoj od ovih šema NE POSTOJI i ne sme da postoji — dolazi
// isključivo iz `requireUserId()` (pravilo 8, P0-1).

import { z } from "zod";

/** Places `place_id` je neproziran string; gornja granica je zaštita, ne validacija. */
const placeId = z.string().min(1, { error: "Nedostaje ID prospekta." }).max(255);

/**
 * Tačno pet statusa iz F7 §1. `z.enum` ovde nije kozmetika: vrednost ide u RPC
 * koji je i sam ograničen CHECK-om, ali odbijanje na granici daje korisniku
 * poruku na srpskom umesto Postgres greške u 500-ci.
 */
export const statusEnum = z.enum([
  "nekontaktiran",
  "kontaktiran",
  "odgovorio",
  "potpisan",
  "nezainteresovan",
]);

/** Kanali koji imaju tekst poruke. `poziv` se dodaje tek u `kontaktSchema`. */
export const kanalEnum = z.enum(["mejl", "viber", "instagram"]);

/**
 * `PATCH /api/pipeline` — prevlačenje kartice ili izmena beleške.
 *
 * Oba polja su opciona, ali bar jedno mora da postoji: telo bez ijednog je
 * zahtev koji ništa ne traži, i tiho vraćen 200 na takav zahtev je najgori
 * mogući odgovor — klijent misli da je sačuvao.
 */
export const pipelineBodySchema = z
  .object({
    placeId,
    status: statusEnum.optional(),
    // `.max` je gornja granica veličine tela, ne pravilo o sadržaju. Prazan
    // string je dozvoljen i znači „obriši belešku".
    note: z.string().max(4000, { error: "Beleška je predugačka." }).optional(),
  })
  .refine((v) => v.status !== undefined || v.note !== undefined, {
    error: "Zahtev ne menja ni status ni belešku.",
  });

/**
 * `POST /api/poruke` — korisnik je kopirao poruku.
 *
 * `body` stiže sa klijenta iako ga server ume sam da izgeneriše. Razlog je AI
 * varijanta: tekst koji je korisnik zaista kopirao ne mora da bude šablon, a
 * `outreach_messages` je istorija poslatog, ne ponovljivo izračunavanje.
 * Ono što se NIKAD ne uzima iz tela je `user_id` i pitanje da li je lead otključan.
 */
export const kontaktBodySchema = z.object({
  placeId,
  channel: z.union([kanalEnum, z.literal("poziv")]),
  body: z.string().max(4000, { error: "Poruka je predugačka." }).default(""),
  source: z.enum(["sablon", "ai"]).default("sablon"),
});

export type PipelineBody = z.infer<typeof pipelineBodySchema>;
export type KontaktBody = z.infer<typeof kontaktBodySchema>;
