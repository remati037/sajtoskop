// apps/worker/src/jobs/refresh-google.ts
// Osvežava Google polja kojima je istekao TTL od 30 dana (pravilo 1).
//
// Isti Places poziv kao `scan`, ali BEZ zakazivanja audita: `website_audits` je
// naša imovina i nema TTL (00-kontekst §4). Osvežava se samo ono što je
// Googleovo — naziv, adresa, telefon, sajt, ocena.

import { resolveCity, resolveNiche } from "@sajtoskop/shared";
import { recordScan } from "../lib/db-writes";
import type { JobContext, JobResult } from "./types";
import { collectAndUpsert } from "./scan";
import { refreshGooglePayloadSchema } from "./types";

export async function runRefreshGoogle(raw: unknown, ctx: JobContext): Promise<JobResult> {
  const payload = refreshGooglePayloadSchema.parse(raw);
  const city = resolveCity(payload.citySlug);
  const niche = resolveNiche(payload.nicheSlug);

  const { inCity, apiCalls, partial } = await collectAndUpsert(
    city,
    niche,
    { maxResults: payload.maxResults, countryCode: payload.countryCode },
    ctx,
  );

  // Od F9 web ovaj posao više ne upisuje (`enqueueRefresh` je obrisan) — ostaje
  // za ručno pokretanje iz CLI-a. Registar se svejedno osvežava: kad ga ja ručno
  // pokrenem, kombinacija je stvarno osvežena i mora ponovo da bude besplatna.
  await recordScan({
    countryCode: payload.countryCode,
    citySlug: city.slug,
    nicheSlug: niche.slug,
    count: inCity.length,
    jobId: ctx.job.id,
  });

  // Biznis koji se više ne pojavljuje u Text Searchu ostaje sa starim datumom.
  // To je namerno: ne znamo da li je zatvoren ili je samo pao u rangiranju, a
  // izmišljanje svežine bi prekršilo pravilo 1.
  return {
    note:
      `${city.label} · ${niche.label}: osveženo ${inCity.length} biznisa ` +
      `(${apiCalls} API poziva)${partial ? " (parcijalno)" : ""}`,
    ...(partial && { partial }),
  };
}
