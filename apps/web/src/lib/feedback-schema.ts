// apps/web/src/lib/feedback-schema.ts
// Ugovor tela za `/api/feedback` i `/api/feedback/[id]` (F10 §2).
//
// Odvojeno od ruta iz istog razloga kao `unlock-schema.ts` i `pipeline-schema.ts`:
// šema se proverava bez podizanja Next-a, a ruta ostaje tanka.
//
// `userId` ovde NE POSTOJI i ne sme da postoji (pravilo 8, P0-1). Isto važi i za
// `plan`, `credits` i `route_label` — sve to server čita ili izvodi sam, pa telo
// koje tvrdi `plan: "pro"` ne menja nijedan upisan bajt.
//
// Bez `import "server-only"`: tipove odgovora uvozi i `utisak-dugme.tsx`.

import { z } from "zod";

/** 1 loše · 2 ok · 3 odlično. Van ovoga zapis ne bi ni nastao. */
export const ocenaSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const tipEnum = z.enum(["bug", "ideja", "pohvala", "drugo"]);

/**
 * `POST /api/feedback` — nastanak utiska. Zove se na klik na ocenu, bez potvrde.
 *
 * `route` je putanja, ne naziv ekrana: naziv se izvodi serverski kroz
 * `naslovZaPutanju()`, da bi ostao jedan izvor istine (F10 §2).
 */
export const utisakBodySchema = z.object({
  rating: ocenaSchema,
  source: z.enum(["dugme", "podsetnik"]).default("dugme"),
  route: z.string().max(200).optional(),
  // '1440×900', sa znakom množenja U+00D7. Jedino što server ne zna sam.
  viewport: z
    .string()
    .regex(/^\d{2,5}×\d{2,5}$/, { error: "Dimenzije prozora nisu u obliku 1440×900." })
    .optional(),
});

/**
 * `PATCH /api/feedback/[id]` — dopuna tekstom i tipom.
 *
 * Bar jedno polje mora da postoji. Telo bez ijednog je zahtev koji ništa ne
 * traži, a tiho vraćen 200 na takav zahtev je najgori mogući odgovor — klijent
 * misli da je sačuvao.
 */
export const dopunaBodySchema = z
  .object({
    kind: tipEnum.optional(),
    message: z
      .string()
      .trim()
      .min(1, { error: "Poruka je prazna." })
      .max(2000, { error: "Poruka je duža od 2000 karaktera." })
      .optional(),
  })
  .refine((v) => v.kind !== undefined || v.message !== undefined, {
    error: "Dopuna ne nosi ni tekst ni tip.",
  });

export type UtisakBody = z.infer<typeof utisakBodySchema>;
export type DopunaBody = z.infer<typeof dopunaBodySchema>;

/**
 * Ono što vraća `POST /api/feedback`.
 *
 * `id: null` znači da je korisnik probio tvrd plafon od 50 zapisa u 24h i da
 * ništa nije upisano (F10 §5).
 *
 * `dopuna: false` znači da je ovo utisak preko dnevnog limita za mejl: red
 * postoji, ali drugi korak se preskače i korisnik vidi samo „Hvala. Zabeleženo."
 * (F10 §6, red „11. utisak u danu"). Klijent ni u jednom od ta dva slučaja ne
 * saznaje da je udario u limit — poruka „dosta si mi rekao" je u beti najgori
 * mogući odgovor (odluka 6).
 */
export type UtisakOdgovor = { id: number | null; dopuna: boolean };
