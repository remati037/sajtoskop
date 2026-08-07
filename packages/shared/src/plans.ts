// packages/shared/src/plans.ts
// Konfiguracija planova i globalnih kapova. Čist podatak, bez zavisnosti.
//
// Jedan plan sada je namerno (docs/00-kontekst.md, sekcija 2). Ostali planovi se
// dodaju tek kad postoji naplata — do tada bi bili mrtav kod koji se raziđe sa stvarnošću.

export type PlanId = "beta";

export type Plan = {
  /** Krediti koji se dodeljuju na registraciju i svakog meseca. Bez rollovera. */
  monthlyCredits: number;
  /** Koliko pretraga koje NISU u kešu korisnik sme dnevno. Keš je neograničen. */
  cacheMissPerDay: number;
  /** Koliko redova dnevno sme da izveze u CSV. */
  exportPerDay: number;
};

export const PLANS: Record<PlanId, Plan> = {
  beta: { monthlyCredits: 30, cacheMissPerDay: 10, exportPerDay: 100 },
};

export const DEFAULT_PLAN: PlanId = "beta";

/** Nepoznat plan iz baze ne sme da sruši rutu — padni na beta. */
export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id ?? DEFAULT_PLAN) as PlanId] ?? PLANS.beta;
}

// ── globalni kapovi, nezavisni od korisnika ────────────────
// Ovo je tvrdi stop u kodu, ne preporuka. Places daje 1.000 poziva mesečno
// besplatno; sve preko toga je stvaran novac (CLAUDE.md, sekcija Budžet).

export const GLOBAL_DAILY_API_CAP = 25;    // ispod Google dnevne kvote
export const GLOBAL_MONTHLY_API_CAP = 900; // ispod 1000 free tier

/** Google resetuje kvotu u 09:00 po lokalnom vremenu Kalifornije. */
export const BUDGET_TIMEZONE = "America/Los_Angeles";

/** Pravilo 1 iz CLAUDE.md: Google podatak stariji od ovoga se ne servira. */
export const GOOGLE_TTL_DAYS = 30;
