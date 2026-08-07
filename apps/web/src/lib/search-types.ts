// apps/web/src/lib/search-types.ts
// Ugovor između `/api/search` i UI-ja. Namerno BEZ `import "server-only"` —
// ovaj fajl uvoze i klijentske komponente, pa ne sme da povuče Supabase klijent
// ni bilo šta iz `src/lib/supabase.ts`.
//
// Ovde su samo tipovi i konstante. Funkcija koja pravi `PublicLead` je u
// `public-lead.ts` i ona jeste `server-only`.

import type { PhoneKind, Platform, SiteStatus, UglyBand } from "@sajtoskop/shared";

// Hard cap, bez `limit` parametra iz klijenta (PRD §2: nema bulk endpointa).
export const PAGE_SIZE = 30;
export const MAX_PAGE = 20;

/** Ono što svako sme da vidi. Dovoljno da lead bude prepoznatljiv i primamljiv. */
export type LeadBase = {
  placeId: string;
  name: string;
  citySlug: string;
  address: string | null;
  /** Namerno `boolean`, a ne URL — „ima sajt" je javno, adresa sajta nije. */
  hasWebsite: boolean;
  phoneType: PhoneKind | null;
  rating: number | null;
  siteStatus: SiteStatus | null;
  uglyBand: UglyBand | null;
  platform: Platform | null;
};

export type LockedLead = LeadBase & { isUnlocked: false };

export type UnlockedLead = LeadBase & {
  isUnlocked: true;
  phone: string | null;
  websiteUrl: string | null;
  email: string | null;
  uglyScore: number | null;
  /**
   * Samo tekst signala. `Signal.points` je težina Ugly Score-a i nikad ne izlazi
   * sa servera — skor se reklamira kao brend, ne kao tabela (00-kontekst, §5).
   */
  signals: string[];
  aiIssues: string[] | null;
  // `screenshot` namerno ne postoji u F2: nema screenshotova do F5. Kad stigne,
  // dolazi kao potpisan URL sa rokom od 15 minuta.
};

/**
 * Diskriminisana unija, ne `null` polja: zaključan lead te ključeve NEMA, pa ih
 * ni JSON nema. `lead.phone` se ne kompajlira dok ne suziš na `isUnlocked === true`.
 */
export type PublicLead = LockedLead | UnlockedLead;

export type SearchFilters = {
  onlyNoSite: boolean;
  onlySocial: boolean;
  onlyDead: boolean;
  minScore?: number;
};

export type SearchSummary = {
  noSite: number;
  social: number;
  dead: number;
  ugly: number;
  ok: number;
};

export type SearchResponse = {
  status: "cache" | "not_scanned";
  freshness: { refreshedAt: string; stale: boolean } | null;
  total: number;
  page: number;
  pageSize: number;
  results: PublicLead[];
  summary: SearchSummary;
};

/** Oblik greške koji rute vraćaju. Poruka je na srpskom i ide direktno korisniku. */
export type ApiError = { greska: string; detalji?: string[] };
