// packages/shared/src/types.ts
// Zajednički rečnik tipova za web, worker i CLI.
// Ovaj fajl NE SME da uvozi ništa — ni iz `node:`, ni iz drugih modula paketa.
// Sve vrednosti su usklađene sa kolonama iz F1-baza-auth.md.

// ─────────────────────────────────────────────────────────────
// Osnovne unije
// ─────────────────────────────────────────────────────────────

/**
 * Sloj 0 Ugly Score-a — status sajta.
 * Mapira se 1:1 na `website_audits.site_status`.
 * `nema_sajt`, `samo_drustvene` i `mrtav` su najbolji leadovi i nemaju numerički skor.
 */
export type SiteStatus = "ok" | "nema_sajt" | "samo_drustvene" | "mrtav";

/**
 * Band Ugly Score-a. Mapira se na `website_audits.ugly_band`.
 * Pragovi su isključivo u `ugly-score.ts` — ovde je samo skup dozvoljenih vrednosti.
 */
export type UglyBand = "solidan" | "osrednji" | "ruzan" | "katastrofa";

/** Tip telefona iz prefiksa — određuje kanal outreacha (mobilni → Viber). */
export type PhoneKind = "mobilni" | "fiksni" | "besplatni" | "nepoznat";

/** Platforma na kojoj je sajt napravljen, detektovana iz HTML-a. */
export type Platform =
  | "WordPress" | "Joomla" | "Drupal" | "Wix" | "Squarespace"
  | "Shopify" | "Blogger" | "Weebly" | "custom";

/**
 * Jedan signal iz Ugly Score-a.
 * `points` je težina i NIKAD ne sme da završi u klijentskom bundle-u —
 * server šalje samo `label` za otključane leadove.
 */
export type Signal = {
  key: string;
  points: number;
  /** Rečenica koju doslovno možeš staviti u cold poruku. */
  label: string;
};

// ─────────────────────────────────────────────────────────────
// Google Places → naš oblik
// ─────────────────────────────────────────────────────────────

/**
 * Naš normalizovan oblik biznisa. Ovaj tip ide dalje u ceo proizvod.
 * Sirovi Places oblik (`RawPlace`, `PlacesResponse`) namerno NIJE ovde —
 * živi u workeru, jedinom mestu koje priča sa Googleom.
 */
export type Business = {
  placeId: string;
  name: string;
  address: string;
  phone: string | null;
  phoneKind: PhoneKind | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
};

// ─────────────────────────────────────────────────────────────
// Claude vision analiza (F6)
// ─────────────────────────────────────────────────────────────

/** Ozbiljnost problema. Vrednosti su na srpskom jer izlaze pravo u UI kao bedž. */
export type AiSeverity = "visoka" | "srednja" | "niska";

/**
 * Jedan problem koji je Claude video na screenshotu.
 *
 * Za razliku od `Signal`, ovde nema `points` — AI ne ulazi u Ugly Score. Skor je
 * heuristika sa jednim izvorom istine (`ugly-score.ts`, pravilo 6); AI samo
 * opisuje ono što se vidi, i ceo objekat sme da izađe klijentu.
 */
export type AiIssue = {
  /** Kratak naslov, do nekoliko reči. */
  title: string;
  /** Jedna rečenica na srpskom, latinicom, sa dijakritikom. */
  detail: string;
  /**
   * Proverljiva rečenica u prvom licu — ono što vlasnik vidi kad otvori sajt na
   * telefonu. Jedino polje koje sme da uđe u outreach poruku (F7); `detail` je
   * pisan za korisnika alata i nosi žargon koji u poruci strancu zvuči kao
   * kopiran izveštaj.
   *
   * [PAŽNJA] Polje je obavezno u tipu, ali `ai_issues` je `jsonb` — zapisi
   * nastali pre uvođenja `evidence` ga nemaju, i tip o njima laže. Svaki kod
   * koji ga čita mora da izdrži `undefined` (v. `auditToDokazi`).
   */
  evidence: string;
  severity: AiSeverity;
};

// ─────────────────────────────────────────────────────────────
// Oblici koji se u F1 mapiraju na tabele
// ─────────────────────────────────────────────────────────────

/**
 * Red u tabeli `businesses` — Google podaci, TTL 30 dana.
 * `googleRefreshedAt` se proverava pre svakog serviranja (pravilo 1 iz CLAUDE.md).
 * `placeId` se čuva neograničeno.
 */
export type PlaceRecord = {
  placeId: string;
  countryCode: string;
  citySlug: string;
  nicheSlug: string | null;
  queryText: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  phoneType: PhoneKind | null;
  websiteUrl: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  /** ISO 8601. Stariji od 30 dana se ne servira — zakaži refresh. */
  googleRefreshedAt: string;
  firstSeenAt: string;
};

/**
 * Red u tabeli `website_audits` — ono što smo mi izgenerisali.
 * Čuva se neograničeno, to je imovina proizvoda.
 * `auditLevel`: 1 = HTML heuristika, 2 = +PageSpeed, 3 = +Claude.
 */
export type AuditRecord = {
  id: string;
  placeId: string;
  auditLevel: 1 | 2 | 3;
  siteStatus: SiteStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  uglyScore: number | null;
  uglyBand: UglyBand | null;
  platform: Platform | null;
  signals: Signal[];
  emails: string[] | null;
  screenshotDesktop: string | null;
  screenshotMobile: string | null;
  psiMobileScore: number | null;
  psiLcpMs: number | null;
  aiIssues: AiIssue[] | null;
  aiVerdict: string | null;
  /** `null` znači da AI nije uspeo ili nije ni pozvan — nije isto što i `false`. */
  aiSolidan: boolean | null;
  enrichedAt: string;
};
