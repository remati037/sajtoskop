// apps/web/src/lib/search-types.ts
// Ugovor između `/api/search` i UI-ja. Namerno BEZ `import "server-only"` —
// ovaj fajl uvoze i klijentske komponente, pa ne sme da povuče Supabase klijent
// ni bilo šta iz `src/lib/supabase.ts`.
//
// Ovde su samo tipovi i konstante. Funkcija koja pravi `PublicLead` je u
// `public-lead.ts` i ona jeste `server-only`.

import type { AiIssue, PhoneKind, Platform, SiteStatus, UglyBand } from "@sajtoskop/shared";

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

/**
 * Potpisani URL-ovi sa rokom od 15 minuta, ne putanje u bucketu (F5 §4).
 * Bilo koje polje ume da bude `null` — sajt koji se ne otvara nema snimak, a
 * varijanta ume i da otpadne ako je pojela rok od 30 sekundi za ceo posao.
 */
export type LeadScreenshot = {
  desktop: string | null;
  mobile: string | null;
};

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
  /** Mobilni PageSpeed skor, 0–100. `null` kad PSI nije uspeo (F6 §1). */
  psiMobileScore: number | null;
  /** Largest Contentful Paint u ms — „sajt ti se otvara 8 sekundi". */
  psiLcpMs: number | null;
  /**
   * 3–5 problema koje je Claude video na snimcima (F6 §2). `null` znači da AI
   * korak nije prošao — UI tada pada na `signals`, ne na prazno mesto (F6 §4).
   */
  aiIssues: AiIssue[] | null;
  /** Jedna rečenica bez žargona, spremna za kopiranje u poruku vlasniku. */
  aiVerdict: string | null;
  /**
   * Potpisani URL-ovi, rok 15 minuta. `null` kad snimka nema — sajt bez sajta,
   * mrtav domen, ili lead otključan pre F5 kome `enrich_full` još nije stigao.
   * UI na `null` prikazuje poruku, ne prazan okvir.
   */
  screenshot: LeadScreenshot | null;
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

/**
 * `queued` postoji od F3: kombinacija koje nema u kešu više ne završava sa
 * „nije skenirano" nego pokreće posao. `not_scanned` ostaje samo za slučaj kad
 * je posao odbijen — tada uz njega stoji i `greska` iz `ApiError`.
 */
export type SearchStatus = "cache" | "not_scanned" | "queued";

export type SearchResponse = {
  status: SearchStatus;
  freshness: { refreshedAt: string; stale: boolean } | null;
  total: number;
  page: number;
  pageSize: number;
  results: PublicLead[];
  summary: SearchSummary;
  /** Samo uz `status: "queued"`. `joined` znači da posao već radi za nekog drugog. */
  job?: { id: number; joined: boolean };
};

/** Ono što vraća `GET /api/job/:id`. Klijent po ovome crta stanje pretrage. */
export type JobStatusResponse = {
  id: number;
  status: "pending" | "running" | "done" | "failed";
  /** Koliko je biznisa nađeno i koliko ih je analizirano. `null` dok se ne zna. */
  progress: { found: number; analyzed: number } | null;
  /** Popunjeno samo kad je posao konačno odustao. */
  greska: string | null;
};

/** Ono što vraća `POST /api/unlock`. */
export type UnlockResponse = {
  /** Uvek otključan — zaključan lead nema šta da traži u odgovoru ove rute. */
  lead: UnlockedLead;
  /** Stanje posle skidanja. Header ga koristi bez novog zahteva. */
  creditsLeft: number;
  /** `true` znači da je lead već bio otključan i da kredit NIJE skinut. */
  alreadyUnlocked: boolean;
};

/** Oblik greške koji rute vraćaju. Poruka je na srpskom i ide direktno korisniku. */
export type ApiError = { greska: string; detalji?: string[] };
