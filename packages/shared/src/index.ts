// packages/shared/src/index.ts
// Jedini javni ulaz u @sajtoskop/shared. Eksplicitni re-eksporti, bez `export *` —
// da se odmah vidi šta je javna površina i da ništa ne iscuri slučajno.
//
// PRAVILO: nijedan fajl dohvaćen odavde ne sme da uvozi `node:*`, da otvara mrežu
// ni da dodiruje fajl sistem. Ovaj paket učitava i Next.js kroz `transpilePackages`.
// Places klijent, fetch-site, harvest i api-budget žive u apps/worker i ovde ih nema.

// ── tipovi ─────────────────────────────────────────────────
export type {
  AiIssue,
  AiSeverity,
  AuditRecord,
  Business,
  PhoneKind,
  PlaceRecord,
  Platform,
  Signal,
  SiteStatus,
  UglyBand,
} from "./types";

// ── oblik redova u bazi (snake_case, granica sa Supabase-om) ─
export type {
  ApiBudgetRow,
  BusinessRow,
  CreditLedgerRow,
  CreditReason,
  ExportClaimReason,
  ExportClaimResult,
  GrantReason,
  MonthlyGrantReason,
  MonthlyGrantResult,
  JobQueueRow,
  JobStatus,
  JobType,
  ProfileRow,
  RpcResult,
  SearchRow,
  SpendReason,
  UnlockRow,
  WebsiteAuditRow,
} from "./db";

// ── ugly score ─────────────────────────────────────────────
export type { ScoreInput, ScoreResult } from "./ugly-score";
export { bandForScore, copyrightYear, detectPlatform, scoreSite } from "./ugly-score";

// ── planovi i globalni kapovi ──────────────────────────────
export type { Plan, PlanId } from "./plans";
export {
  AI_DAILY_CAP,
  BUDGET_TIMEZONE,
  CREDITS_TIMEZONE,
  creditMonth,
  DEFAULT_PLAN,
  GLOBAL_DAILY_API_CAP,
  GLOBAL_MONTHLY_API_CAP,
  GOOGLE_TTL_DAYS,
  PLANS,
  planFor,
  PSI_DAILY_CAP,
} from "./plans";

// ── naplata: interfejs bez implementacije (F4 §6) ──────────
export type { BillingProvider } from "./billing";
export { billingProvider, FreeBetaProvider, NotImplementedError } from "./billing";

// ── taksonomija: niše i gradovi ────────────────────────────
export type { City, Niche, NicheGroup } from "./taxonomy";
export {
  buildQueries,
  CITIES,
  CITY_SLUGS,
  nichePriority,
  NICHE_SLUGS,
  NICHES,
  phoneType,
  SEED_NICHES,
  sweepPlan,
  VALIDATED_NICHES,
} from "./taxonomy";

// ── upiti ──────────────────────────────────────────────────
export { buildScanQueries, resolveCity, resolveNiche } from "./queries";

// ── mejlovi (čista ekstrakcija, mrežu radi pozivalac) ──────
export { extractEmails } from "./emails";

// ── transliteracija ────────────────────────────────────────
export { cirToLat, foldForSearch, slugify } from "./translit";

// ── csv (samo (de)serijalizacija, upis radi pozivalac) ─────
export { CSV_BOM, fromCsv, toCsv } from "./csv";
