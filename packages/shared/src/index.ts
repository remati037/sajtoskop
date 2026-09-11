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
  AdminAdjustResult,
  AdminAuditRow,
  AccessInviteKind,
  AccessInviteRedemptionRow,
  AccessInviteRow,
  AdminOpenKompResult,
  AdminOverview,
  AdminRole,
  AdminSetRoleResult,
  AdminUserRow,
  AiRewriteClaimReason,
  AiRewriteClaimResult,
  ApiBudgetRow,
  BillingApplyReason,
  BillingApplyResult,
  BillingEventRow,
  BusinessRow,
  ChangelogRow,
  CreditLedgerRow,
  CreditReason,
  ExportClaimReason,
  ExportClaimResult,
  FeedbackCtx,
  FeedbackGrantResult,
  FeedbackKind,
  FeedbackPromptRow,
  FeedbackPromptStatus,
  FeedbackRow,
  FeedbackSource,
  FeedbackStatus,
  GrantReason,
  MonthlyGrantReason,
  MonthlyGrantResult,
  RedeemInviteResult,
  SearchAccessRow,
  SubscriptionStatus,
  TrialFingerprintRow,
  JobQueueRow,
  JobStatus,
  JobType,
  KlijentskaGreska,
  LeadChannel,
  LeadStatusRow,
  LeadStatusRpcReason,
  LeadStatusValue,
  OutreachMessageRow,
  ProfileRow,
  SignedEventRow,
  RpcResult,
  ScanSpendReason,
  ScanSpendResult,
  SearchCacheRow,
  SearchRow,
  SpendReason,
  SubscriptionRow,
  UnlockRow,
  WebsiteAuditRow,
} from "./db";

// ── utisci: katalog pitanja i motor pravila (F11) ──────────
export type {
  CenaOpseg,
  Oblik,
  OdgovorIshod,
  Opcija,
  Pitanje,
  Sloj,
  Uslovi,
} from "./feedback-katalog";
export {
  CENA_OPSEZI,
  KATALOG,
  KRAJ_BETE,
  medijanaCene,
  opisOdgovora,
  PITANJE_KLJUCEVI,
  pitanjeZaKljuc,
  PRAG_CENE_RSD,
  proveriOdgovor,
  vaziPitanje,
} from "./feedback-katalog";

export type {
  MotorStanje,
  MotorTrenutak,
  Odluka,
  Razlog,
  StanjePitanja,
  StatusPitanja,
} from "./feedback-motor";
export {
  MOTOR,
  odluci,
  posleOdbacivanja,
  posleOdgovora,
  poslePrikaza,
  sledecePitanje,
  smeDaSePita,
} from "./feedback-motor";

// ── ugly score ─────────────────────────────────────────────
export type { ScoreInput, ScoreResult } from "./ugly-score";
export { bandForScore, copyrightYear, detectPlatform, scoreSite } from "./ugly-score";

// ── generator outreach poruka (F7) ─────────────────────────
export type {
  ContactChannel,
  MessageChannel,
  OutreachInput,
  OutreachOk,
  OutreachResult,
  OutreachSkip,
  Poruka,
} from "./outreach";
export {
  brojReci,
  domen,
  GRANICE,
  napisiPoruke,
  proveriPoruku,
  repZauzima,
  sastaviVarijantu,
} from "./outreach";

// ── padežni oblici za generator poruka ─────────────────────
export { bezOblika, gradLokativ, nisaAkuzativ } from "./sklonidba";

// ── planovi, paketi, cene (Stripe katalog) i globalni kapovi ─
export type {
  CenaPlana,
  Ciklus,
  Dubina,
  DubinaOpis,
  Kupovina,
  LookupKey,
  PaidPlanId,
  PaketId,
  Plan,
  PlanId,
} from "./plans";
export {
  AI_DAILY_CAP,
  AI_OUTREACH_DAILY_CAP,
  ALL_LOOKUP_KEYS,
  BUDGET_TIMEZONE,
  cenaDubine,
  cenaSkeniranja,
  CREDIT_PACKS,
  CREDITS_TIMEZONE,
  creditMonth,
  DEFAULT_PLAN,
  DUBINA_OPIS,
  DUBINE,
  dubinaIli,
  dubinaZaRezultate,
  formatEur,
  GLOBAL_DAILY_API_CAP,
  GLOBAL_MONTHLY_API_CAP,
  GODISNJI_BONUS,
  GOOGLE_TTL_DAYS,
  GRACE_DAYS,
  KOMP_DEFAULT_DAYS,
  kupovinaZaLookupKey,
  lookupKeyZaPaket,
  lookupKeyZaPlan,
  maxRezultataZaDubinu,
  ONBOARDING_CREDITS,
  PLACES_EUR_PER_CALL,
  PLACES_FREE_CALLS_MONTH,
  PLACES_MAX_PAGES,
  PLACES_MONTHLY_BUDGET_EUR,
  PLACES_PAGE_SIZE,
  PLAN_PRICES,
  PLANS,
  planFor,
  PODRAZUMEVANA_DUBINA,
  PSI_DAILY_CAP,
  sledecaDodelaKredita,
  stranicaZaRezultate,
  TRIAL_CREDITS,
  TRIAL_DAYS,
} from "./plans";

// ── pristup: sedam stanja naloga (LANSIRANJE §1.5, naplata-stripe.md §7) ─
export type {
  Pristup,
  PretplataZaPristup,
  ProfilZaPristup,
  StanjeId,
  StatusPretplate,
} from "./pristup";
export { smeDaKupiPaket, STANJA_ZA_PAKET } from "./pristup";
export { citanjeDoZa, stanjePristupa } from "./pristup";

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
