// apps/web/src/lib/admin-utisci-schema.ts
// Ugovor tela za rute pod `/api/admin/utisci/[id]` (F11 §5).
//
// Odvojeno od ruta iz istog razloga kao `admin-radnje-schema.ts`: šema se
// proverava bez podizanja Next-a, a ruta ostaje tanka. Bez `server-only`, jer
// klijentski panel uvozi granice (dužina beleške, spisak statusa) da bi ista
// pravila važila i pre slanja.
//
// ── čega ovde NEMA ───────────────────────────────────────────
// `user_id`, `rating`, `kind`, `severity`, `prompt_key`, `answers`,
// `reward_credits`, `resolved_at`. Sve to je ili korisnikov podatak ili ga
// server izvodi (F11 §5). Konzola sme da menja tačno četiri stvari: status,
// oznake, belešku i vezu sa dnevnikom — a krediti idu svojom rutom, jer su svoja
// radnja u reviziji.

import { z } from "zod";
import type { FeedbackSource, FeedbackStatus } from "@sajtoskop/shared";

/**
 * Labele za prikaz. Stoje uz šemu, a ne uz čitanje iz baze, zato što ih dele
 * serverski ekran, klijentski panel i digest — a `lib/admin-utisci.ts` je
 * `server-only`, pa ih odande klijent ne može uzeti.
 *
 * `u_radu` je kolona, „U radu" je ono što se čita. Prevod postoji na jednom
 * mestu ili se raziđe na tri.
 */
export const STATUS_UTISKA: Record<FeedbackStatus, string> = {
  novo: "Novo",
  priznato: "Priznato",
  u_radu: "U radu",
  reseno: "Rešeno",
  odbijeno: "Odbijeno",
  duplikat: "Duplikat",
};

/** Sloj je `feedback.source` (F11 odluka 1: četiri sloja, jedna tabela). */
export const SLOJ_UTISKA: Record<FeedbackSource, string> = {
  dugme: "Dugme",
  podsetnik: "Podsetnik",
  pitanje: "Pitanje",
  kampanja: "Kampanja",
  incident: "Incident",
};

/** Svih šest statusa iz `feedback_status_valid` (0011). */
export const STATUSI: readonly FeedbackStatus[] = [
  "novo",
  "priznato",
  "u_radu",
  "reseno",
  "odbijeno",
  "duplikat",
];

/** Najviše oznaka po prijavi. Osam je već previše za nešto što se čita očima. */
export const MAX_OZNAKA = 8;

/** Duža beleška nije beleška nego prepiska — za nju postoji mejl korisniku. */
export const MAX_BELESKA = 2000;

/**
 * Oznaka je jedna reč ili dve, bez interpunkcije.
 *
 * Slobodan unos je namerno (nema tabele oznaka, kao što nema ni tabele pitanja —
 * F11 odluka 2), ali oblik mora da bude uzak: `tags` je `text[]` koji ulazi u
 * filtere i u izveštaj, a spisak u kom stoje i „pretraga" i „Pretraga!!!" je
 * spisak koji ništa ne grupiše.
 */
const oznakaSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, { error: "Oznaka je prekratka." })
  .max(24, { error: "Oznaka je duža od 24 znaka." })
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, {
    error: "Oznaka sme da nosi samo slova, cifre, razmak, crticu i donju crtu.",
  });

/**
 * Status, oznake, beleška i obrazloženje — sve opciono, ali bar jedno obavezno.
 *
 * Prazan `PATCH` bi upisao red u reviziju za izmenu koje nije bilo, a dnevnik u
 * kom stoje radnje bez posledice je dnevnik koji se prestaje čitati.
 *
 * `user_note` je OBRAZLOŽENJE ZA KORISNIKA (F11.4 §6.4): ide u „Moje prijave" i
 * u mejl „rešeno". Namerno je svoja kolona, a ne `admin_note` — ta je radna
 * beleška i sme da sadrži interne stvari koje korisnik ne sme da vidi.
 */
export const utisakBodySchema = z
  .strictObject({
    status: z.enum(STATUSI as [FeedbackStatus, ...FeedbackStatus[]], {
      error: "Nepoznat status.",
    }).optional(),
    tags: z
      .array(oznakaSchema)
      .max(MAX_OZNAKA, { error: `Najviše ${MAX_OZNAKA} oznaka po prijavi.` })
      .optional(),
    // `null` briše belešku; izostavljeno polje je ne dira. Ta razlika postoji
    // zato što panel šalje samo ono što je admin stvarno menjao.
    admin_note: z
      .string()
      .trim()
      .max(MAX_BELESKA, { error: `Beleška je duža od ${MAX_BELESKA} znakova.` })
      .nullable()
      .optional(),
    // Isti ugovor kao `admin_note`: `null` briše, izostavljeno ne dira.
    user_note: z
      .string()
      .trim()
      .max(MAX_BELESKA, { error: `Obrazloženje je duže od ${MAX_BELESKA} znakova.` })
      .nullable()
      .optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.tags !== undefined ||
      v.admin_note !== undefined ||
      v.user_note !== undefined,
    { error: "Nema šta da se promeni." },
  );

/**
 * Vezivanje prijave sa stavkom Beta dnevnika (§6.6).
 *
 * `null` skida vezu. Stavke se ovde ne prave — CRUD nad `changelog`-om je F11.4
 * (`/admin/dnevnik`), pa je do tada ovo spisak koji ume da bude prazan, i ekran
 * to kaže naglas umesto da ponudi prazan padajući meni bez objašnjenja.
 */
export const dnevnikBodySchema = z.strictObject({
  stavka: z
    .number()
    .int({ error: "ID stavke mora da bude ceo broj." })
    .positive({ error: "ID stavke mora da bude pozitivan." })
    .nullable(),
});

export type UtisakPatchBody = z.infer<typeof utisakBodySchema>;
export type DnevnikBody = z.infer<typeof dnevnikBodySchema>;

/**
 * Nagrada za potvrđen bug (F11 §6.7).
 *
 * Iznos je konstanta, ne polje u telu: „+10 za potvrđen bug" je pravilo
 * proizvoda, a ne odluka koja se donosi po kliku. Ista vrednost je i gornja
 * granica u `grant_feedback_credits` (0011), pa telo koje bi tražilo više ionako
 * ne bi prošlo.
 */
export const NAGRADA_ZA_BUG = 10;
