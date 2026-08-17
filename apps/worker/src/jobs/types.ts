// apps/worker/src/jobs/types.ts
// Ugovor između petlje workera i pojedinačnog posla.
//
// Payload dolazi iz baze kao `jsonb` koji je neko drugi upisao — u slučaju
// `scan` posla to je web, dakle drugi proces i drugi deploy. Zod je zato
// obavezan, isto kao na svakoj drugoj granici (CLAUDE.md, TypeScript konvencije).

import { z } from "zod";
import { CITY_SLUGS, NICHE_SLUGS } from "@sajtoskop/shared";
import type { JobQueueRow, JobType } from "@sajtoskop/shared";

// ── payload šeme ───────────────────────────────────────────

export const scanPayloadSchema = z.strictObject({
  citySlug: z.enum(CITY_SLUGS),
  nicheSlug: z.enum(NICHE_SLUGS),
  userId: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/).default("RS"),
  /** Koliko rezultata tražimo. Gornja granica je Places-ova, ne naša. */
  maxResults: z.number().int().min(10).max(60).default(30),
});

export const enrichBasicPayloadSchema = z.strictObject({
  placeId: z.string().min(1),
  /**
   * [Faza 3, 3.2] ID scan posla koji je naručio ovaj audit — za napredak
   * (`analyzed` na redu posla). CLI i ručno pokretanje ga nemaju.
   */
  scanJobId: z.number().int().optional(),
});

/**
 * [ODSTUPANJE od PRD-a §2] PRD traži `{ placeId[] }`, dakle Place Details poziv
 * po biznisu. To je 1 SKU poziv po place_id — osvežavanje jedne zastarele
 * kombinacije od 30 biznisa košta 30 poziva, 40% dnevnog capa, i pokrenulo bi se
 * samo zato što je neko otvorio staru listu.
 *
 * Isti podatak stiže kroz ponovljen Text Search za taj grad i nišu: 3 poziva
 * umesto 30. Cena je što biznis koji je ispao iz Googleovog rangiranja ostaje
 * zastareo — ali biznis koji se više ne pojavljuje u pretrazi ionako nije lead.
 */
export const refreshGooglePayloadSchema = z.strictObject({
  citySlug: z.enum(CITY_SLUGS),
  nicheSlug: z.enum(NICHE_SLUGS),
  countryCode: z.string().regex(/^[A-Z]{2}$/).default("RS"),
  maxResults: z.number().int().min(10).max(60).default(60),
});

export const enrichFullPayloadSchema = z.strictObject({
  placeId: z.string().min(1),
});

/**
 * Mesec je i ključ idempotencije (`ref_id` u `credit_ledger`), pa oblik mora da
 * bude tačan: `2026-09`. Slobodan string bi značio da `2026-9` i `2026-09` budu
 * dva različita meseca i da neko dobije kredite dvaput.
 */
export const monthlyGrantPayloadSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/, { error: "Mesec mora biti u obliku 2026-09." }),
});

/**
 * „Napiši drugačije" (F7 §2, migracija 0008).
 *
 * `userId` je ovde deo payload-a, a ne pretplatnika, jer posao piše u
 * `outreach_messages` gde je vlasnik reda obavezan. Posao ga svejedno proverava
 * nad tabelom `unlocks` pre nego što išta uradi — red poslova je `jsonb`, ne
 * poziv funkcije, i ne sme da se veruje da je upisan iz proverene rute.
 *
 * `senderName` se prosleđuje, a ne čita iz baze: ime je u Clerku, koji worker
 * nema. Bez njega bi AI varijanta stigla bez potpisa, a šablon sa njim — i
 * korisnik bi tu razliku video kao kvar.
 */
export const rewritePayloadSchema = z.strictObject({
  userId: z.string().min(1),
  placeId: z.string().min(1),
  channel: z.enum(["mejl", "viber", "instagram"]),
  senderName: z.string().max(80).nullable().default(null),
});

export type RewritePayload = z.infer<typeof rewritePayloadSchema>;

export type ScanPayload = z.infer<typeof scanPayloadSchema>;
export type EnrichBasicPayload = z.infer<typeof enrichBasicPayloadSchema>;
export type RefreshGooglePayload = z.infer<typeof refreshGooglePayloadSchema>;
export type EnrichFullPayload = z.infer<typeof enrichFullPayloadSchema>;
export type MonthlyGrantPayload = z.infer<typeof monthlyGrantPayloadSchema>;

// ── kontekst i rezultat ────────────────────────────────────

export type JobContext = {
  job: JobQueueRow;
  /** Prefiksiran ispis, da se u logu vidi koji posao je šta uradio. */
  log: (message: string) => void;
};

export type JobResult = {
  /** Jedna rečenica za log. Ne upisuje se u bazu. */
  note: string;
  /** Posao je uradio deo i to je u redu — budžet je pukao usred rada. */
  partial?: boolean;
};

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<JobResult>;

export type JobRegistry = Record<JobType, JobHandler>;
