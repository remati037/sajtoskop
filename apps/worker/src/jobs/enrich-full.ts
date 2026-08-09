// apps/worker/src/jobs/enrich-full.ts
// Tip posla postoji od F3, sadržaj stiže u F5 i F6.
//
// Zašto prazan handler, a ne izostavljen tip: `job_queue_type_valid` u bazi već
// dozvoljava 'enrich_full', a unlock u F4 upisuje taj posao. Bez handlera bi
// posao pao na „nepoznat tip", potrošio tri pokušaja i završio kao `failed` —
// crveno u redu poslova zbog funkcije koja po planu još ne postoji.
//
// F5: screenshot desktop + mobilni (Playwright)
// F6: PageSpeed mobile score + Claude vision analiza

import type { JobContext, JobResult } from "./types";
import { enrichFullPayloadSchema } from "./types";

export async function runEnrichFull(raw: unknown, _ctx: JobContext): Promise<JobResult> {
  const { placeId } = enrichFullPayloadSchema.parse(raw);
  return { note: `${placeId}: enrich_full je prazan do F5` };
}
