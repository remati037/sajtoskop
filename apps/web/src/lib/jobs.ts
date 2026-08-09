// apps/web/src/lib/jobs.ts
// Web strana reda poslova: upis `scan` posla i čitanje njegovog statusa.
//
// Web NIKAD ne izvršava posao — samo ga upisuje i čeka. Playwright i lančani
// HTTP fetch ne idu u Vercel funkciju (pravilo 7), a Places poziv ide isključivo
// iz workera (00-kontekst §3).
//
// Provera dnevnog cache-miss limita je OVDE, pre upisa posla (PRD §4). Worker o
// njoj ne zna ništa — on izvršava ono što u redu zatekne.

import "server-only";
import { GOOGLE_TTL_DAYS, planFor } from "@sajtoskop/shared";
import type { JobStatus, JobType } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";

// ── dnevni cache-miss limit ────────────────────────────────

export type CacheMissClaim = {
  ok: boolean;
  reason: "claimed" | "limit_reached" | "no_user";
  used: number;
  remaining: number;
  /** Kad se brojač resetuje. LA ponoć, ista ona po kojoj Google resetuje kvotu. */
  resetAt: string;
};

export async function claimCacheMiss(userId: string, plan: string): Promise<CacheMissClaim> {
  const limit = planFor(plan).cacheMissPerDay;

  const { data, error } = await adminSupabase().rpc("claim_cache_miss", {
    p_user: userId,
    p_limit: limit,
  });

  if (error) throw new Error(`Provera dnevnog limita nije uspela: ${error.message}`);

  const rows = (data ?? []) as {
    ok: boolean;
    reason: CacheMissClaim["reason"];
    used: number;
    remaining: number;
    reset_at: string;
  }[];

  const row = rows[0];
  if (!row) throw new Error("claim_cache_miss nije vratio rezultat.");

  return {
    ok: row.ok,
    reason: row.reason,
    used: row.used,
    remaining: row.remaining,
    resetAt: row.reset_at,
  };
}

/** Vrati rezervaciju ako upis posla posle nje pukne. */
export async function releaseCacheMiss(userId: string): Promise<void> {
  const { error } = await adminSupabase().rpc("release_cache_miss", { p_user: userId });
  // Neuspeh ovde ne sme da pregazi originalnu grešku — samo se zabeleži.
  if (error) console.error(`[jobs] release_cache_miss: ${error.message}`);
}

// ── upis posla ─────────────────────────────────────────────

export type EnqueuedJob = { jobId: number; joined: boolean };

async function enqueue(args: {
  type: JobType;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  userId: string | null;
}): Promise<EnqueuedJob> {
  const { data, error } = await adminSupabase().rpc("enqueue_job", {
    p_type: args.type,
    p_payload: args.payload,
    p_dedupe_key: args.dedupeKey,
    p_user: args.userId,
    p_run_after: new Date().toISOString(),
  });

  if (error) throw new Error(`Upis posla nije uspeo: ${error.message}`);

  const rows = (data ?? []) as { job_id: number; joined: boolean }[];
  const row = rows[0];
  if (!row) throw new Error("enqueue_job nije vratio ID posla.");

  return { jobId: row.job_id, joined: row.joined };
}

/** Ključ po kome dva korisnika sa istom pretragom dele jedan posao. */
function scanKey(countryCode: string, city: string, niche: string): string {
  return `${countryCode}:${city}:${niche}`;
}

export async function enqueueScan(args: {
  userId: string;
  countryCode: string;
  city: string;
  niche: string;
}): Promise<EnqueuedJob> {
  return enqueue({
    type: "scan",
    payload: {
      citySlug: args.city,
      nicheSlug: args.niche,
      userId: args.userId,
      countryCode: args.countryCode,
    },
    dedupeKey: scanKey(args.countryCode, args.city, args.niche),
    userId: args.userId,
  });
}

/**
 * Skup enrichment posle otključavanja (F4 §1). Handler je prazan do F5 — ovde
 * se posao svejedno upisuje, da red poslova od početka ima stvaran zapis o tome
 * šta je naručeno.
 *
 * `dedupeKey` je `place_id`: dva korisnika koja u istoj minuti otključaju isti
 * lead dele jedan posao. Od F5 to nije uredno nego budžetski — jedan posao je
 * dva Playwright screenshota, jedan PageSpeed i jedan Claude poziv.
 *
 * Korisnik se upisuje kao pretplatnik, pa `GET /api/job/:id` sme da mu vrati
 * status — u F5 iz toga izlazi „screenshot se pravi".
 */
export async function enqueueEnrichFull(args: {
  userId: string;
  placeId: string;
}): Promise<EnqueuedJob> {
  return enqueue({
    type: "enrich_full",
    payload: { placeId: args.placeId },
    dedupeKey: args.placeId,
    userId: args.userId,
  });
}

/** Koliko dugo posle osvežavanja se isto ne pokušava ponovo. */
const REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Da li je isti refresh već pokušan skoro.
 *
 * Bez ovoga postoji tih curak budžeta: kombinacija koju Places više ne vraća
 * ostaje zauvek zastarela, pa bi SVAKA pretraga te liste upisivala nov refresh
 * od 3 API poziva. Dedup ključ tu ne pomaže jer prethodni posao je već završio.
 */
async function refreshedRecently(dedupeKey: string): Promise<boolean> {
  const since = new Date(Date.now() - REFRESH_COOLDOWN_MS).toISOString();

  const { data, error } = await adminSupabase()
    .from("job_queue")
    .select("id")
    .eq("type", "refresh_google")
    .eq("dedupe_key", dedupeKey)
    .gte("created_at", since)
    .limit(1)
    .returns<{ id: number }[]>();

  if (error) {
    // Ne znamo → ne trošimo. Propušten refresh je jeftiniji od nekontrolisanog.
    console.error(`[jobs] provera refresh cooldown-a: ${error.message}`);
    return true;
  }

  return (data ?? []).length > 0;
}

/**
 * Osvežavanje Google podataka starijih od 30 dana (pravilo 1).
 *
 * Bez pretplatnika: korisnik ovo ne čeka — zastareli rezultati mu se prikazuju
 * odmah, a osveženje stigne do sledeće pretrage (PRD §5). Zato i ne troši
 * njegov dnevni cache-miss limit; on nije tražio nov scan.
 */
export async function enqueueRefresh(args: {
  countryCode: string;
  city: string;
  niche: string;
}): Promise<void> {
  try {
    if (await refreshedRecently(scanKey(args.countryCode, args.city, args.niche))) return;

    await enqueue({
      type: "refresh_google",
      payload: {
        citySlug: args.city,
        nicheSlug: args.niche,
        countryCode: args.countryCode,
      },
      dedupeKey: scanKey(args.countryCode, args.city, args.niche),
      userId: null,
    });
  } catch (err) {
    // Pretraga ne sme da padne zato što osvežavanje u pozadini nije upisano.
    console.error(`[jobs] refresh_google nije upisan: ${err instanceof Error ? err.message : err}`);
  }
}

// ── čitanje statusa ────────────────────────────────────────

export type JobProgress = {
  /** Koliko je biznisa scan našao za tu kombinaciju. */
  found: number;
  /** Koliko ih je već analizirano (ima red u `website_audits`). */
  analyzed: number;
};

export type JobView = {
  id: number;
  type: JobType;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  finishedAt: string | null;
  /** Poruka na srpskom, samo kad je posao konačno pao. */
  error: string | null;
  progress: JobProgress | null;
};

/**
 * Da li ulogovani korisnik sme da vidi ovaj posao.
 *
 * Namerno kroz `userSupabase()`: politika „own subscriptions" je stvarna brava.
 * Sa admin klijentom bi jedina odbrana bio `where user_id = ...` koji se
 * zaboravi u prvoj izmeni ove funkcije.
 */
async function isSubscribed(jobId: number): Promise<boolean> {
  const { data, error } = await userSupabase()
    .from("job_subscribers")
    .select("job_id")
    .eq("job_id", jobId)
    .maybeSingle<{ job_id: number }>();

  if (error) throw new Error(`Provera pretplate nije uspela: ${error.message}`);
  return data !== null;
}

/** Koliko je od nađenih biznisa već analizirano. Za traku napretka. */
async function scanProgress(
  countryCode: string,
  city: string,
  niche: string,
): Promise<JobProgress> {
  const db = adminSupabase();

  const { data, error } = await db
    .from("businesses")
    .select("place_id")
    .eq("country_code", countryCode)
    .eq("city_slug", city)
    .eq("niche_slug", niche)
    .returns<{ place_id: string }[]>();

  if (error) throw new Error(`Čitanje napretka nije uspelo: ${error.message}`);

  const ids = (data ?? []).map((r) => r.place_id);
  if (ids.length === 0) return { found: 0, analyzed: 0 };

  const { count, error: aErr } = await db
    .from("website_audits")
    .select("place_id", { count: "exact", head: true })
    .in("place_id", ids);

  if (aErr) throw new Error(`Čitanje napretka nije uspelo: ${aErr.message}`);

  return { found: ids.length, analyzed: count ?? 0 };
}

/** `null` znači „ne postoji ili nije tvoj" — namerno se ne razlikuje. */
export async function getJobForUser(jobId: number): Promise<JobView | null> {
  if (!(await isSubscribed(jobId))) return null;

  const { data, error } = await adminSupabase()
    .from("job_queue")
    .select("id, type, payload, status, attempts, max_attempts, created_at, finished_at, last_error")
    .eq("id", jobId)
    .maybeSingle<{
      id: number;
      type: JobType;
      payload: Record<string, unknown>;
      status: JobStatus;
      attempts: number;
      max_attempts: number;
      created_at: string;
      finished_at: string | null;
      last_error: string | null;
    }>();

  if (error) throw new Error(`Čitanje posla nije uspelo: ${error.message}`);
  if (!data) return null;

  let progress: JobProgress | null = null;
  const city = typeof data.payload.citySlug === "string" ? data.payload.citySlug : null;
  const niche = typeof data.payload.nicheSlug === "string" ? data.payload.nicheSlug : null;
  const country = typeof data.payload.countryCode === "string" ? data.payload.countryCode : "RS";

  if (city && niche) progress = await scanProgress(country, city, niche);

  return {
    id: data.id,
    type: data.type,
    status: data.status,
    attempts: data.attempts,
    maxAttempts: data.max_attempts,
    createdAt: data.created_at,
    finishedAt: data.finished_at,
    // `last_error` je tehnička poruka i stoji i posle uspešnog ponavljanja.
    // Korisniku se pokazuje samo kad je posao stvarno odustao.
    error: data.status === "failed" ? data.last_error : null,
    progress,
  };
}

/** Prag posle kog se Google podatak smatra zastarelim. Isti kao u `search.ts`. */
export const STALE_AFTER_MS = GOOGLE_TTL_DAYS * 24 * 60 * 60 * 1000;
