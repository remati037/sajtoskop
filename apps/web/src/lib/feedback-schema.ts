// apps/web/src/lib/feedback-schema.ts
// Ugovor tela za `/api/feedback` i `/api/feedback/[id]` (F10 §2, prošireno F11 §5).
//
// Odvojeno od ruta iz istog razloga kao `unlock-schema.ts` i `pipeline-schema.ts`:
// šema se proverava bez podizanja Next-a, a ruta ostaje tanka.
//
// `userId` ovde NE POSTOJI i ne sme da postoji (pravilo 8, P0-1). Isto važi i za
// `plan`, `credits`, `route_label`, a od F11 i za `status`, `severity` i
// `reward_credits` — sve to server čita ili izvodi sam, pa telo koje tvrdi
// `severity: 1` ne menja nijedan upisan bajt.
//
// Bez `import "server-only"`: tipove odgovora uvoze i klijentske komponente.

import { z } from "zod";

/** 1 loše · 2 ok · 3 odlično. Van ovoga zapis ne bi ni nastao. */
export const ocenaSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const tipEnum = z.enum(["bug", "ideja", "pohvala", "drugo"]);

/**
 * Izvor zapisa. `dugme` i `podsetnik` su F10; ostala tri su slojevi iz F11 §1.
 *
 * Kad telo nosi `prompt_key`, izvor se IZVODI iz sloja pitanja u katalogu i ovo
 * polje se zanemaruje — klijent ne sme da odluči da je kampanjski odgovor
 * „incident" i time preskoči cooldown.
 */
export const izvorEnum = z.enum(["dugme", "podsetnik", "pitanje", "kampanja", "incident"]);

/**
 * Dnevnik klijentskih grešaka (F11 odluka 10).
 *
 * Šema je kapija, ne formalnost: telo koje pošalje 500 redova sa stek trejsom i
 * query stringom mora da bude odbijeno, a ne obrezano u tišini. Ruta bez `?` je
 * jedino pravilo koje se ovde stvarno proverava — sve ostalo je granica dužine.
 *
 * Server ovaj dnevnik prima samo uz `kind = 'bug'` i uz incident; svuda drugde
 * ga odbacuje. Provera je u `lib/feedback.ts`, jer zavisi od kataloga.
 */
export const greskaSchema = z.strictObject({
  poruka: z.string().trim().min(1).max(200),
  tip: z.string().trim().max(60),
  ruta: z
    .string()
    .max(200)
    .refine((v) => !v.includes("?") && !v.includes("#"), {
      error: "Ruta ne sme da nosi query string.",
    }),
  vreme: z.iso.datetime(),
});

export const dnevnikSchema = z.array(greskaSchema).max(5);

/**
 * `POST /api/feedback` — nastanak utiska.
 *
 * Dva oblika u istoj šemi, jer je i tabela jedna (F11 odluka 1):
 *   1. ocena sa dugmeta ili iz podsetnika — `rating`, bez `prompt_key`
 *   2. odgovor na pitanje — `prompt_key` + `answers`, obično bez `rating`-a
 *
 * `answers` je ovde `unknown`: pravi oblik zna samo Zod šema IZ kataloga, po
 * ključu (pravilo 16). Proverava je `proveriOdgovor()` u ruti, i nepoznat ključ
 * je 400 — bez toga je `answers` jsonb u koji svako upisuje šta hoće.
 *
 * `route` je putanja, ne naziv ekrana: naziv se izvodi serverski kroz
 * `naslovZaPutanju()`, da bi ostao jedan izvor istine (F10 §2).
 */
export const utisakBodySchema = z
  .object({
    rating: ocenaSchema.optional(),
    prompt_key: z.string().max(64).optional(),
    answers: z.unknown().optional(),
    kind: tipEnum.optional(),
    source: izvorEnum.default("dugme"),
    route: z.string().max(200).optional(),
    // '1440×900', sa znakom množenja U+00D7. Jedino što server ne zna sam.
    viewport: z
      .string()
      .regex(/^\d{2,5}×\d{2,5}$/, { error: "Dimenzije prozora nisu u obliku 1440×900." })
      .optional(),
    errors: dnevnikSchema.optional(),
    /** Putanja u privatnom bucketu `feedback`, iz `POST /api/feedback/slika`. */
    screenshot_path: z.string().max(200).optional(),
  })
  .refine((v) => v.rating !== undefined || v.prompt_key !== undefined, {
    error: "Zapis bez ocene i bez pitanja nema sadržaj.",
  })
  .refine((v) => v.prompt_key !== undefined || v.answers === undefined, {
    error: "Odgovor bez pitanja nema gde da se upiše.",
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
    /**
     * Drugi korak odgovora na pitanje (F11 §2.1): „bi li ga preporučio kolegi",
     * čipovi „šta nije štimalo". Spaja se sa već upisanim `answers` i ponovo
     * proverava šemom IZ kataloga — drugi korak ne sme da zaobiđe kapiju.
     */
    answers: z.unknown().optional(),
    errors: dnevnikSchema.optional(),
    screenshot_path: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      v.kind !== undefined ||
      v.message !== undefined ||
      v.answers !== undefined ||
      v.screenshot_path !== undefined,
    { error: "Dopuna ne nosi ni tekst, ni tip, ni odgovor." },
  );

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
export type UtisakOdgovor = {
  id: number | null;
  dopuna: boolean;
  /**
   * Sme li se uz poruku obećati +1 kredit (F11 §6.7).
   *
   * Računa se na serveru, u trenutku kad zapis nastane — dakle tačno kad panel
   * treba da odluči hoće li uz polje za tekst stajati čip. Klijent ovo ne
   * izračunava i ne sme da izračunava: kvota je stanje baze, ne stanje ekrana.
   *
   * `false` NIKAD ne izlazi kao objašnjenje korisniku. Čipa prosto nema.
   */
  nagrada: boolean;
};

/**
 * Ono što vraća `PATCH /api/feedback/[id]`.
 *
 * `nagrada: true` znači da je dodela kredita prošla kroz sve kapije i da je
 * pozvana u `after()`. Korisnik tada vidi „dodao sam ti 1 kredit"; kad je
 * `false`, vidi običnu potvrdu — bez ijedne reči o kvoti (odluka 6).
 */
export type DopunaOdgovor = { ok: true; nagrada: boolean };

/** Ono što vraća `POST /api/feedback/slika`. Putanja u bucketu, nikad URL. */
export type SlikaOdgovor = { path: string };
