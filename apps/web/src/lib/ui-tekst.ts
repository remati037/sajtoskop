// apps/web/src/lib/ui-tekst.ts
// Srpski tekst za UI — latinica, sa dijakritikom (CLAUDE.md, sekcija Jezik).
// Bez `server-only`: ovo uvoze i klijentske komponente.
//
// Terminologija je iz tabele u CLAUDE.md: lead → prospekt, unlock → otključaj,
// band → Solidan / Osrednji / Ružan / Katastrofa, Ugly Score se ne prevodi.

import type { NicheGroup, SiteStatus, UglyBand } from "@sajtoskop/shared";
import type { SearchSummary } from "./search-types";

export const STATUS_LABEL: Record<SiteStatus, string> = {
  nema_sajt: "NEMA SAJT",
  mrtav: "MRTAV DOMEN",
  samo_drustvene: "SAMO DRUŠTVENE",
  ok: "IMA SAJT",
};

export const BAND_LABEL: Record<UglyBand, string> = {
  solidan: "Solidan",
  osrednji: "Osrednji",
  ruzan: "Ružan",
  katastrofa: "Katastrofa",
};

export const GROUP_LABEL: Record<NicheGroup, string> = {
  zdravstvo: "Zdravstvo",
  lepota: "Lepota",
  fitnes: "Fitnes",
  auto: "Auto",
  majstori: "Majstori i građevina",
  ugostiteljstvo: "Ugostiteljstvo",
  usluge: "Profesionalne usluge",
  trgovina: "Trgovina",
  obrazovanje: "Obrazovanje",
  turizam: "Turizam",
};

export const PHONE_LABEL: Record<string, string> = {
  mobilni: "Mobilni",
  fiksni: "Fiksni",
  besplatni: "Besplatni",
  nepoznat: "Nepoznat",
};

/**
 * Ista rečenica koju CLI ispisuje posle scana, samo sa `prospekata` umesto
 * `biznisa`. Prag „ružnog" ne stoji ovde kao broj — server ga računa iz
 * `ugly_band`, dakle iz `packages/shared/src/ugly-score.ts`.
 */
export function summaryLine(total: number, s: SearchSummary): string {
  return [
    `${total} ${plural(total, "prospekt", "prospekta", "prospekata")}`,
    `${s.noSite} bez sajta`,
    `${s.social} samo društvene`,
    `${s.dead} nedostupnih`,
    `${s.ugly} ružnih`,
    `${s.ok} solidnih`,
  ].join(" · ");
}

/** Srpski ima tri oblika množine: 1 prospekt, 2-4 prospekta, 5+ prospekata. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatDatum(iso: string): string {
  return new Date(iso).toLocaleDateString("sr-Latn-RS", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
