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

// Dnevni cap je MEKA granica — zaštita od odbeglog skripta, ne budžet. Googleu
// je nebitna dnevna raspodela, bitan mu je zbir za mesec.
//
// 75 nije proizvoljno: scan povlači do 3 stranice paginacije, dakle do 3 poziva,
// pa 75 znači 25 scanova dnevno. Na 25 (koliko je stajalo do F3) jedan korisnik
// sa beta limitom od 10 cache-miss pretraga dnevno pojede globalni cap pre svog
// ličnog, i drugi korisnik istog dana dobija „limit dostignut".
export const GLOBAL_DAILY_API_CAP = 75;

// TVRDA granica. Ispod Googleovog besplatnog praga od 1.000 poziva mesečno za
// Enterprise SKU (Text Search sa kontakt poljima). Preko toga je stvaran novac.
export const GLOBAL_MONTHLY_API_CAP = 900;

/** Google resetuje kvotu u 09:00 po lokalnom vremenu Kalifornije. */
export const BUDGET_TIMEZONE = "America/Los_Angeles";

/** Pravilo 1 iz CLAUDE.md: Google podatak stariji od ovoga se ne servira. */
export const GOOGLE_TTL_DAYS = 30;
