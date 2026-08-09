// apps/worker/src/jobs/scan.ts
// Places Text Search → upsert `businesses` → `enrich_basic` po biznisu koji
// nema svež audit. Jedini posao u sistemu koji troši Google kvotu.
//
// ── koliko ovo košta ───────────────────────────────────────
// Jedan upit je do 3 Places poziva (3 stranice × 20 rezultata). Podrazumevano
// je JEDAN upit po scanu, dakle najviše 3 poziva.
//
// `SCAN_DEEP=1` cepa veliki grad po opštinama iz taksonomije. Beograd ima 15
// opština → 45 poziva, što je 60% dnevnog capa i 5% mesečnog za jednu pretragu
// jednog korisnika. Zato deep ima svoj tvrd limit (`SCAN_MAX_QUERIES`) i nije u
// payloadu — web ga ne može poslati ni greškom, postoji samo za ručno pokretanje.

import type { Business, City, Niche } from "@sajtoskop/shared";
import {
  buildQueries,
  buildScanQueries,
  foldForSearch,
  resolveCity,
  resolveNiche,
} from "@sajtoskop/shared";
import { BudgetError } from "../lib/api-budget";
import { placeIdsNeedingAudit, upsertBusinesses } from "../lib/db-writes";
import { searchText } from "../lib/places";
import { enqueueMany } from "../lib/queue";
import type { JobContext, JobResult } from "./types";
import { scanPayloadSchema } from "./types";

/** Tvrd limit na broj upita po scanu. Svaki upit je do 3 Places poziva. */
const SCAN_MAX_QUERIES = Number(process.env.SCAN_MAX_QUERIES ?? 5);

/**
 * Firma iz susednog mesta koju je Google ubacio u rezultat nije lead za ovaj
 * grad. Poređenje je po celoj reči: „Šabački put" u Beogradu ne prolazi kao
 * Šabac, a firma u prigradskom naselju sa gradom u adresi prolazi.
 */
function filterToCity(businesses: Business[], cityLabel: string): {
  inCity: Business[];
  dropped: number;
} {
  const re = new RegExp(`\\b${foldForSearch(cityLabel).replace(/\s+/g, "\\s+")}\\b`);
  const inCity = businesses.filter((b) => re.test(foldForSearch(b.address)));
  return { inCity, dropped: businesses.length - inCity.length };
}

export type CollectResult = {
  inCity: Business[];
  apiCalls: number;
  partial: boolean;
  queryText: string;
};

/**
 * Zajednički deo `scan` i `refresh_google`: povuci iz Placesa, odbaci firme van
 * grada, upiši u `businesses`. Ono što ih razlikuje je šta se radi POSLE ovoga.
 */
export async function collectAndUpsert(
  city: City,
  niche: Niche,
  opts: { maxResults: number; countryCode: string },
  ctx: JobContext,
): Promise<CollectResult> {
  const deep = process.env.SCAN_DEEP === "1";
  const all = deep ? buildQueries(niche, city) : buildScanQueries(niche, city);
  const queries = all.slice(0, SCAN_MAX_QUERIES);

  if (queries.length < all.length) {
    ctx.log(
      `upita ${all.length} → skraćeno na ${queries.length} (SCAN_MAX_QUERIES). ` +
        `Izostavljeno: ${all.slice(SCAN_MAX_QUERIES).join(", ")}`,
    );
  }

  const seen = new Set<string>();
  const found: Business[] = [];
  let apiCalls = 0;
  let partial = false;

  for (const query of queries) {
    let batch: Awaited<ReturnType<typeof searchText>>;
    try {
      batch = await searchText(query, {
        maxResults: opts.maxResults,
        languageCode: "sr-Latn",
      });
    } catch (err) {
      // Budžet je pukao usred posla. Ako je nešto već prikupljeno, upisuje se —
      // bacanje prikupljenih podataka je bacanje već potrošenog novca (PRD §3).
      if (err instanceof BudgetError && found.length > 0) {
        ctx.log(`budžet stao usred scana: ${err.message}`);
        partial = true;
        break;
      }
      throw err;
    }

    apiCalls += batch.apiCalls;
    if (batch.partial) partial = true;

    for (const b of batch.businesses) {
      if (seen.has(b.placeId)) continue;
      seen.add(b.placeId);
      found.push(b);
    }

    if (found.length >= opts.maxResults && !deep) break;
  }

  const { inCity, dropped } = filterToCity(found, city.label);
  if (dropped > 0) ctx.log(`van grada, izbačeno ${dropped}`);

  const queryText = queries[0] ?? niche.query;

  if (inCity.length > 0) {
    await upsertBusinesses({
      businesses: inCity,
      citySlug: city.slug,
      nicheSlug: niche.slug,
      queryText,
      countryCode: opts.countryCode,
    });
  }

  return { inCity, apiCalls, partial, queryText };
}

export async function runScan(raw: unknown, ctx: JobContext): Promise<JobResult> {
  const payload = scanPayloadSchema.parse(raw);
  const city = resolveCity(payload.citySlug);
  const niche = resolveNiche(payload.nicheSlug);

  const { inCity, apiCalls, partial } = await collectAndUpsert(
    city,
    niche,
    { maxResults: payload.maxResults, countryCode: payload.countryCode },
    ctx,
  );

  if (inCity.length === 0) {
    return {
      note: `${city.label} · ${niche.label}: nijedan rezultat (${apiCalls} API poziva)`,
      ...(partial && { partial }),
    };
  }

  // Audit se namerno NE radi ovde: `scan` mora da završi za sekunde da bi lista
  // bila vidljiva. Preuzimanje sajtova je 1 zahtev/s po domenu i traje minutima.
  const needAudit = await placeIdsNeedingAudit(inCity.map((b) => b.placeId));
  const created = await enqueueMany(
    needAudit.map((placeId) => ({
      type: "enrich_basic" as const,
      payload: { placeId },
      dedupeKey: placeId,
    })),
  );

  return {
    note:
      `${city.label} · ${niche.label}: ${inCity.length} biznisa, ` +
      `${created} za analizu, ${apiCalls} API poziva${partial ? " (parcijalno)" : ""}`,
    ...(partial && { partial }),
  };
}
