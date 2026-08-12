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

import type { AiIssue, PhoneKind, Platform, Signal, SiteStatus, UglyBand } from "./types";

export type ProfileRow = {
  id: string;
  email: string | null;
  plan: string;
  credits_balance: number;
  cache_miss_day: string | null;
  cache_miss_count: number;
  /** Dnevni cap na CSV export (F4 §5). Isti LA dan kao `cache_miss_day`. */
  export_day: string | null;
  export_count: number;
  /**
   * Kad je korisniku prikazan podsetnik za utisak (F10, migracija 0010).
   * `null` znači „još nije viđen". Stoji u bazi, a ne u `localStorage`-u, da
   * isti čovek na drugom računaru ne bi dobio isti prozor iznova.
   */
  feedback_prompted_at: string | null;
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
  /** Largest Contentful Paint u ms. Dodato u 0005. */
  psi_lcp_ms: number | null;
  ai_issues: AiIssue[] | null;
  ai_verdict: string | null;
  /**
   * Model je ocenio sajt kao uredan. Dodato u 0006.
   * `null` ≠ `false`: null znači da AI nije uspeo ili nije ni pozvan.
   */
  ai_solidan: boolean | null;
  enriched_at: string;
};

export type UnlockRow = {
  user_id: string;
  place_id: string;
  created_at: string;
};

/** `scan` je od F9: plaćeno skeniranje kombinacije koje nema u kešu (0009). */
export type CreditReason = "unlock" | "scan" | "monthly_grant" | "admin" | "refund";

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

/**
 * Registar keširanih kombinacija (F9, migracija 0009). Jedini izvor istine o
 * tome da li pretraga košta: `last_scanned_at` mlađi od `GOOGLE_TTL_DAYS` znači
 * besplatno, sve ostalo znači 1 kredit.
 */
export type SearchCacheRow = {
  country_code: string;
  city_slug: string;
  niche_slug: string;
  last_scanned_at: string;
  last_results_count: number;
  scan_count: number;
  last_job_id: number | null;
  created_at: string;
};

export type JobType =
  | "scan"
  | "enrich_basic"
  | "enrich_full"
  | "refresh_google"
  | "monthly_grant"
  /** F7 §2: „Napiši drugačije" — AI varijanta outreach poruke (0008). */
  | "rewrite_message";
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

// ── F7: kanban, poruke, događaj „potpisan" (0007) ──────────

/** Tačno ovih pet, redom kojim stoje kolone u kanbanu. */
export type LeadStatusValue =
  | "nekontaktiran"
  | "kontaktiran"
  | "odgovorio"
  | "potpisan"
  | "nezainteresovan";

/** Kanal kontakta. Širi od `MessageChannel` — `poziv` nema generisanu poruku. */
export type LeadChannel = "mejl" | "viber" | "instagram" | "poziv";

export type LeadStatusRow = {
  user_id: string;
  place_id: string;
  status: LeadStatusValue;
  note: string | null;
  channel: LeadChannel | null;
  /** Datum PRVOG kontakta. `null` tačno kad je status `nekontaktiran` (0007). */
  contacted_at: string | null;
  updated_at: string;
};

export type OutreachMessageRow = {
  id: string;
  user_id: string;
  place_id: string;
  channel: "mejl" | "viber" | "instagram";
  body: string;
  source: "sablon" | "ai";
  created_at: string;
};

/**
 * Snimak atributa leada u trenutku potpisivanja (F7 §3).
 * Vrednosti su prepisane, ne referencirane — `businesses` ima TTL 30 dana.
 */
export type SignedEventRow = {
  id: number;
  user_id: string;
  place_id: string;
  country_code: string;
  city_slug: string | null;
  niche_slug: string | null;
  site_status: SiteStatus | null;
  ugly_band: UglyBand | null;
  ugly_score: number | null;
  platform: Platform | null;
  channel: LeadChannel | null;
  created_at: string;
};

// ── F10: utisci (0010) ─────────────────────────────────────

export type FeedbackKind = "bug" | "ideja" | "pohvala" | "drugo";

/** Odakle je utisak došao: plutajuće dugme ili automatski podsetnik. */
export type FeedbackSource = "dugme" | "podsetnik";

/**
 * Dijagnostika uz utisak. Namerno `jsonb`, a ne kolone: čita se očima u mejlu, a
 * sadržaj se u beti menja brže od šeme (F10 §1).
 *
 * Sve osim `viewport` skuplja server. Telo zahteva koje tvrdi `plan: "pro"` se
 * ignoriše (pravilo 8).
 */
export type FeedbackCtx = {
  plan: string;
  credits: number;
  unlocks: number;
  /** User-Agent, iz headera — nikad iz tela. */
  ua: string;
  /** `'1440×900'`. Jedino što server ne zna, pa stiže sa klijenta. */
  viewport: string;
};

export type FeedbackRow = {
  id: number;
  user_id: string;
  country_code: string;
  /** 1 loše · 2 ok · 3 odlično. `not null` — klik na ocenu je jedini obavezan korak. */
  rating: 1 | 2 | 3;
  kind: FeedbackKind | null;
  message: string | null;
  source: FeedbackSource;
  route: string | null;
  route_label: string | null;
  /** Ruta je jedini pisac ovog polja i uvek upisuje pun objekat. */
  ctx: FeedbackCtx;
  emailed_at: string | null;
  email_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiBudgetRow = {
  day: string;   // LA dan, YYYY-MM-DD
  month: string; // LA mesec, YYYY-MM
  calls: number;
  exhausted_at: string | null;
  /** Raspodela poziva po SKU-u, npr. `{ "places:searchText": 12 }` (0002). */
  by_kind: Record<string, number>;
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

export type MonthlyGrantReason =
  | "granted"
  | "already_granted"
  | "invalid_amount"
  | "missing_ref_id"
  | "no_user";

export type ExportClaimReason = "claimed" | "limit_reached" | "nothing_to_export" | "no_user";

/** `spend_credit_and_scan` iz 0009 (F9). */
export type ScanSpendReason = "charged" | "already_paid" | "insufficient_credits" | "no_user";

/** `set_lead_status` / `mark_contacted` / `set_lead_note` iz 0007. */
export type LeadStatusRpcReason =
  | "updated"
  | "contacted"
  | "saved"
  | "invalid_status"
  | "invalid_channel"
  | "not_unlocked";

export type RpcResult<R extends string> = { ok: boolean; reason: R };

/** `grant_monthly_credits` uz `ok`/`reason` vraća i upisanu razliku. */
export type MonthlyGrantResult = RpcResult<MonthlyGrantReason> & { delta: number };

/**
 * `spend_credit_and_scan` vraća i posao i stanje novčanika — ruta iz jednog
 * poziva zna šta da javi korisniku, bez naknadnog čitanja profila.
 *
 * `charged: false` uz `ok: true` je dupli klik: posao postoji i plaćen je, samo
 * ne sada. Klijent tada ne sme da javi „skinut je kredit".
 */
export type ScanSpendResult = RpcResult<ScanSpendReason> & {
  job_id: number | null;
  joined: boolean;
  charged: boolean;
  credits_left: number;
};

/** `claim_export` vraća KOLIKO redova je odobreno, ne samo da li sme. */
export type ExportClaimResult = RpcResult<ExportClaimReason> & {
  allowed: number;
  used: number;
  reset_at: string;
};
