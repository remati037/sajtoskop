// packages/shared/src/queries.ts
import type { City, Niche } from "./taxonomy";
import { CITIES, NICHES, buildQueries } from "./taxonomy";

function listSlugs(items: { slug: string }[]): string {
  return items.map((i) => i.slug).sort().join(", ");
}

export function resolveNiche(slug: string): Niche {
  const found = NICHES.find((n) => n.slug === slug);
  if (!found) {
    throw new Error(`Nepoznata niša: "${slug}"\n\nDostupne:\n${listSlugs(NICHES)}`);
  }
  return found;
}

export function resolveCity(slug: string): City {
  const found = CITIES.find((c) => c.slug === slug);
  if (!found) {
    throw new Error(`Nepoznat grad: "${slug}"\n\nDostupni:\n${listSlugs(CITIES)}`);
  }
  return found;
}

/**
 * Podrazumevano JEDAN upit po scanu — jedan upit je do 3 API poziva.
 * Cepanje po opštinama (`deep`) je za velike gradove i troši 5-15× više.
 * Ne uključuj ga dok ne budeš imao razlog.
 */
export function buildScanQueries(
  niche: Niche,
  city: City,
  opts: { deep?: boolean } = {},
): string[] {
  if (opts.deep) return buildQueries(niche, city);
  return [`${niche.query} ${city.label}`];
}