// apps/worker/src/lib/index.ts
// Node-only moduli: mreža, fajl sistem, Google API. Dostupni kao `@sajtoskop/worker/lib`.
//
// Ovo NIKAD ne sme da uđe u apps/web — Playwright i lančani HTTP fetch ne idu u
// Vercel funkciju (pravilo 7 iz CLAUDE.md). CLI ih koristi jer je i on Node proces.
//
// ── putanje vezane za koren monorepoa ──────────────────────
export { cachePath, outDir, outPath, userPath, workspaceRoot } from "./paths";

// ── Google budžet ──────────────────────────────────────────
export type { BudgetState, BudgetStatus } from "./api-budget";
export {
  assertAvailable,
  budgetDay,
  budgetMonth,
  budgetSummary,
  BudgetError,
  consume,
  dailyLimit,
  daysLeftInMonth,
  hoursUntilReset,
  markExhausted,
  monthlyLimit,
  reset,
  setCalls,
  setMonthCalls,
  status,
} from "./api-budget";

// ── Places ─────────────────────────────────────────────────
export type { PlacesResponse, RawPlace, SearchOptions } from "./places";
export { searchText } from "./places";

// ── preuzimanje sajtova ────────────────────────────────────
export type { SiteFetch } from "./fetch-site";
export { fetchAll, fetchSite } from "./fetch-site";
