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

export type ScanPayload = z.infer<typeof scanPayloadSchema>;
export type EnrichBasicPayload = z.infer<typeof enrichBasicPayloadSchema>;
export type RefreshGooglePayload = z.infer<typeof refreshGooglePayloadSchema>;
export type EnrichFullPayload = z.infer<typeof enrichFullPayloadSchema>;

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
