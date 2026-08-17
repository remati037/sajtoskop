// apps/web/src/lib/upiti.ts
// Sitni alati za upite — bez ijedne odluke o podacima.

/**
 * [Faza 2, 2.2] Podeli spisak ID-jeva na grupe za `.in()`.
 *
 * PostgREST serijalizuje `.in()` u jedan URL; 1200–2000 vrednosti daju URL od
 * 30–50 KB koji gateway ume da odbije ili okrpi, tiho gubeći rezultate (W3).
 * Grupe od ~200 su dovoljno male da URL ostane ispod granice, a dovoljno
 * velike da broj poziva ostane mali.
 */
export function inGrupe<T>(items: T[], velicina = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += velicina) out.push(items.slice(i, i + velicina));
  return out;
}
