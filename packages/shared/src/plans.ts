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

// ── kapovi za ne-Google pozive (F6) ───────────────────────
// Ovi brojači stoje u `api_budget.by_kind` i NE diraju `calls` — v. migraciju
// 0005 i `consume_side_call`. Googleov mesečni prag se njima ne troši.

/**
 * PageSpeed Insights, dnevno. PSI daje 25.000 poziva dnevno uz ključ, pa ovo
 * nije budžet nego zaštita od odbeglog skripta. Duplo od AI capa jer PSI ume da
 * se pusti i na backfillu, a ne košta ništa.
 */
export const PSI_DAILY_CAP = 120;

/**
 * Claude vision analiza, dnevno. Ovo je JEDINI cap iza koga stoji stvaran račun.
 *
 * 60 nije proizvoljno: 20 beta korisnika × 30 kredita mesečno je gornja granica
 * od 600 unlockova mesečno (F6 §3), dakle prosek od 20 dnevno. Trostruko od
 * proseka ostavlja mesta za dan kad se svi jave odjednom, a i dalje drži dnevni
 * trošak u redu veličine jednog evra.
 *
 * Preko capa `enrich_full` PRESKAČE AI korak i ostavlja `audit_level = 2` —
 * lead i dalje ima skor, screenshot i PSI. Posao se ne odlaže i ne pada.
 */
export const AI_DAILY_CAP = 60;

/** Google resetuje kvotu u 09:00 po lokalnom vremenu Kalifornije. */
export const BUDGET_TIMEZONE = "America/Los_Angeles";

/**
 * Krediti se resetuju po domaćem kalendaru, ne po Googleovom.
 *
 * Dnevni brojači (`cache_miss_day`, `export_day`) namerno idu po LA danu — oni
 * štite moju kvotu. Mesečna dodela nema veze sa kvotom: korisniku u Šapcu
 * „prvog u mesecu" znači prvog po njegovom kalendaru.
 */
export const CREDITS_TIMEZONE = "Europe/Belgrade";

/**
 * Mesec u obliku `2026-09`, po domaćem vremenu. Ovo je `ref_id` za mesečnu
 * dodelu, dakle ključ idempotencije — dva poziva sa istim mesecom su jedan.
 */
export function creditMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CREDITS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

/** Pravilo 1 iz CLAUDE.md: Google podatak stariji od ovoga se ne servira. */
export const GOOGLE_TTL_DAYS = 30;
