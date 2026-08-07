// packages/shared/src/db.ts
// Oblik redova u bazi — snake_case, 1:1 sa supabase/migrations/0001_init.sql.
//
// Zašto postoji: supabase-js bez generika vraća `any`, a `any` je zabranjen u
// novom kodu. Ovo je ručno pisan minimum umesto generisanih tipova, jer
// generator zahteva pokrenut Supabase i uvodi build korak koji nam ne treba.
//
// PRAVILO: kad menjaš migraciju, menjaš i ovaj fajl. Ako se raziđu, `tsc` to
// neće uhvatiti — baza ne proverava TypeScript.
//
// Camel-case oblici (`PlaceRecord`, `AuditRecord`) su u `types.ts` i koriste se
// u domenskoj logici. Ovi ovde se koriste na granici sa bazom.

import type { PhoneKind, Platform, Signal, SiteStatus, UglyBand } from "./types";

export type ProfileRow = {
  id: string;
  email: string | null;
  plan: string;
  credits_balance: number;
  cache_miss_day: string | null;
  cache_miss_count: number;
  created_at: string;
};

export type BusinessRow = {
  place_id: string;
  country_code: string;
  city_slug: string;
  niche_slug: string | null;
  query_text: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  phone_type: PhoneKind | null;
  website_url: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  google_refreshed_at: string;
  first_seen_at: string;
};

export type WebsiteAuditRow = {
  id: string;
  place_id: string;
  audit_level: 1 | 2 | 3;
  site_status: SiteStatus;
  http_status: number | null;
  final_url: string | null;
  ugly_score: number | null;
  ugly_band: UglyBand | null;
  platform: Platform | null;
  signals: Signal[];
  emails: string[] | null;
  screenshot_desktop: string | null;
  screenshot_mobile: string | null;
  psi_mobile_score: number | null;
  ai_issues: string[] | null;
  ai_verdict: string | null;
  enriched_at: string;
};

export type UnlockRow = {
  user_id: string;
  place_id: string;
  created_at: string;
};

export type CreditReason = "unlock" | "monthly_grant" | "admin" | "refund";

export type CreditLedgerRow = {
  id: number;
  user_id: string;
  delta: number;
  reason: CreditReason;
  ref_id: string | null;
  created_at: string;
};

export type SearchRow = {
  id: number;
  user_id: string | null;
  country_code: string;
  city_slug: string;
  niche_slug: string | null;
  query_text: string | null;
  source: "cache" | "api";
  results_count: number | null;
  api_calls: number;
  created_at: string;
};

export type JobType = "scan" | "enrich_basic" | "enrich_full" | "refresh_google";
export type JobStatus = "pending" | "running" | "done" | "failed";

export type JobQueueRow = {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type ApiBudgetRow = {
  day: string;
  month: string;
  calls: number;
  exhausted_at: string | null;
};

// ── povratne vrednosti RPC funkcija ────────────────────────
// Sve tri vraćaju `table (ok boolean, reason text)`, pa supabase-js vraća niz
// od tačno jednog reda.

export type SpendReason =
  | "unlocked"
  | "already_unlocked"
  | "insufficient_credits"
  | "no_user"
  | "no_place";

export type GrantReason =
  | "granted"
  | "already_granted"
  | "invalid_amount"
  | "invalid_reason"
  | "no_user";

export type RpcResult<R extends string> = { ok: boolean; reason: R };
