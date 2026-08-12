// apps/worker/src/lib/index.ts
// Node-only moduli: mreža, fajl sistem, Google API. Dostupni kao `@sajtoskop/worker/lib`.
//
// Ovo NIKAD ne sme da uđe u apps/web — Playwright i lančani HTTP fetch ne idu u
// Vercel funkciju (pravilo 7 iz CLAUDE.md). CLI ih koristi jer je i on Node proces.
//
// ── putanje vezane za koren monorepoa ──────────────────────
export { cachePath, outDir, outPath, userPath, workspaceRoot } from "./paths";

// ── Google budžet ──────────────────────────────────────────
// Od F3 stanje živi u tabeli `api_budget`, pa je sve što je dodiruje async i
// zahteva Supabase kredencijale. Čiste vremenske funkcije (budgetDay i dalje)
// ostaju sinhrone i ne traže bazu.
export type { BudgetScope, BudgetState, BudgetStatus } from "./api-budget";
export {
  assertAvailable,
  budgetDay,
  budgetMonth,
  budgetSummary,
  BudgetError,
  clearExhausted,
  consume,
  dailyLimit,
  daysLeftInMonth,
  hoursUntilReset,
  markExhausted,
  monthlyLimit,
  setCalls,
  status,
} from "./api-budget";

// ── Places ─────────────────────────────────────────────────
export type { PlacesResponse, RawPlace, SearchOptions } from "./places";
export { searchText } from "./places";

// ── .env iz korena monorepoa ───────────────────────────────
export { loadRootEnv } from "./env";

// ── Supabase (service_role) ────────────────────────────────
export { supabaseAdmin, supabaseAnon } from "./supabase";

// ── preuzimanje sajtova ────────────────────────────────────
export type { FetchStatus, SiteFetch } from "./fetch-site";
export { fetchAll, fetchSite, UA } from "./fetch-site";

// ── robots.txt i razmak po domenu (pravilo 12) ─────────────
export type { CrawlDecision } from "./robots";
export { CRAWLER_TOKEN, isPathAllowed, mayCrawl, parseRobots, resetRobotsCache } from "./robots";

// ── red poslova ────────────────────────────────────────────
export type { EnqueueInput, EnqueueResult, FailResult, ReapResult } from "./queue";
export {
  claimJob,
  completeJob,
  deferJob,
  enqueueJob,
  enqueueMany,
  failJob,
  reapStuckJobs,
} from "./queue";

// ── SSRF kapija (P0-6) ─────────────────────────────────────
// Jedini put kojim URL sme do Playwrighta ili do lančanog fetch-a.
export type {
  LookupFn,
  SafeTarget,
  SafeUrl,
  SafeUrlOptions,
  UnsafeCode,
  UnsafeKind,
} from "./safe-url";
export {
  checkUrlShape,
  classifyAddress,
  followSafely,
  MAX_REDIRECTS,
  resolveSafeUrl,
  UnsafeUrlError,
} from "./safe-url";

// ── screenshotovi (F5) ─────────────────────────────────────
export type { CaptureResult, Shot, ShotVariant } from "./screenshot";
export {
  captureSite,
  closeBrowser,
  CrawlBlockedError,
  screenshotPath,
  SiteUnreachableError,
} from "./screenshot";

// ── Storage ────────────────────────────────────────────────
export { removeScreenshots, SCREENSHOT_BUCKET, uploadScreenshot } from "./storage";

// ── upisi u bazu ───────────────────────────────────────────
export type { AuditWrite, ExistingAudit, ScreenshotWrite, UpsertBusinessesInput } from "./db-writes";
export {
  AUDIT_TTL_DAYS,
  getAudit,
  getBusinessSite,
  markSiteDead,
  placeIdsNeedingAudit,
  recordScan,
  refundScan,
  saveScreenshots,
  upsertAudit,
  upsertBusinesses,
} from "./db-writes";
