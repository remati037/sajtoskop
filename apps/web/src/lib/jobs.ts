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
import { planFor } from "@sajtoskop/shared";
import type { JobStatus, JobType, ScanSpendReason, ScanSpendResult } from "@sajtoskop/shared";
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

/**
 * Skini kredit i upiši `scan` posao — atomično, u jednoj SQL transakciji (F9 §2).
 *
 * Ovo je JEDINI put kojim `scan` posao ulazi u red iz weba. Nekadašnja
 * `enqueueScan` je obrisana namerno: dok je postojala, postojao je i besplatan
 * ulaz u Places kvotu koji se lako pozove „samo za ovaj slučaj".
 *
 * `charged: false` uz `ok: true` znači dupli klik — posao je isti i već plaćen.
 */
export type ScanCharge = {
  ok: boolean;
  reason: ScanSpendReason;
  jobId: number | null;
  joined: boolean;
  charged: boolean;
  creditsLeft: number;
};

export async function spendCreditAndScan(args: {
  userId: string;
  countryCode: string;
  city: string;
  niche: string;
}): Promise<ScanCharge> {
  const { data, error } = await adminSupabase().rpc("spend_credit_and_scan", {
    p_user: args.userId,
    p_country: args.countryCode,
    p_city: args.city,
    p_niche: args.niche,
  });

  if (error) throw new Error(`Naplata skeniranja nije uspela: ${error.message}`);

  const row = ((data ?? []) as ScanSpendResult[])[0];
  if (!row) throw new Error("spend_credit_and_scan nije vratio rezultat.");

  return {
    ok: row.ok,
    reason: row.reason,
    jobId: row.job_id,
    joined: row.joined,
    charged: row.charged,
    creditsLeft: row.credits_left,
  };
}

/**
 * ID živog `scan` posla za ovu kombinaciju koji je OVAJ korisnik već platio.
 *
 * Postoji zbog jedne konkretne rupe: dok scan traje, kombinacija još nije u
 * registru keša, pa bi svako osvežavanje liste u toku čekanja opet naletelo na
 * naplatu — čoveku koji je maločas platio. Sa ovim, on gleda kako mu se lista
 * puni, besplatno, jer je posao njegov.
 *
 * Provera je „platio", ne „pretplaćen": pretplata se dobija i bez naplate
 * (`already_paid` grana), a plaćanje ostavlja trag u knjizi i to je trag koji
 * ne laže.
 */
export async function zivPlacenPosao(args: {
  userId: string;
  countryCode: string;
  city: string;
  niche: string;
}): Promise<number | null> {
  const db = adminSupabase();

  const { data: jobs, error: jErr } = await db
    .from("job_queue")
    .select("id")
    .eq("type", "scan")
    .eq("dedupe_key", scanKey(args.countryCode, args.city, args.niche))
    .in("status", ["pending", "running"])
    .order("id", { ascending: true })
    .limit(1)
    .returns<{ id: number }[]>();

  if (jErr) throw new Error(`Provera živog posla nije uspela: ${jErr.message}`);

  const jobId = (jobs ?? [])[0]?.id;
  if (jobId === undefined) return null;

  const { data: paid, error: pErr } = await db
    .from("credit_ledger")
    .select("id")
    .eq("user_id", args.userId)
    .eq("reason", "scan")
    .eq("ref_id", `scan:${jobId}`)
    .limit(1)
    .returns<{ id: number }[]>();

  if (pErr) throw new Error(`Provera plaćenog posla nije uspela: ${pErr.message}`);

  return (paid ?? []).length > 0 ? jobId : null;
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

/**
 * „Napiši drugačije" — AI varijanta poruke (F7 §2, migracija 0008).
 *
 * Ide kroz red poslova, a ne pozivom iz ove funkcije, jer se Anthropic zove
 * isključivo iz workera (00-kontekst §3). Cena je pollovanje `/api/job/:id`;
 * dobit je da sve što troši pare ima jedno mesto, jedan retry i jedan brojač.
 *
 * `dedupeKey` nosi i kanal i korisnika: dva klika na isto dugme u istoj sekundi
 * dele jedan poziv, a ista poruka za Viber i za mejl su dva različita posla.
 */
export async function enqueueRewrite(args: {
  userId: string;
  placeId: string;
  channel: "mejl" | "viber" | "instagram";
  senderName: string | null;
}): Promise<EnqueuedJob> {
  return enqueue({
    type: "rewrite_message",
    payload: {
      userId: args.userId,
      placeId: args.placeId,
      channel: args.channel,
      senderName: args.senderName,
    },
    dedupeKey: `${args.userId}:${args.placeId}:${args.channel}`,
    userId: args.userId,
  });
}

// ── [OBRISANO U F9] besplatno osvežavanje u pozadini ───────
//
// Ovde je do F9 stajao `enqueueRefresh`: svaka pretraga nad kešom starijim od 30
// dana upisivala je `refresh_google` posao o mom trošku, bez ijednog platioca.
//
// Od F9 zastareo keš se ne servira, a osvežavanje je ono što korisnik plati 1
// kreditom kroz `spendCreditAndScan`. Dve logike se ne mogu držati istovremeno:
// dok je automatsko osvežavanje živo, ono popravi keš pre nego što iko plati, pa
// naplata za „starije od 30 dana" nikad ne bi ni proradila.
//
// Tip posla `refresh_google` i njegov handler u workeru ostaju — koriste se za
// ručno pokretanje iz CLI-a. Web ih više ne upisuje.

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

/**
 * [Faza 3, 3.2] `null` znači „ne postoji ili nije tvoj" — namerno se ne razlikuje.
 *
 * JEDAN upit: `get_job_for_user` RPC proverava pretplatu i vraća red zajedno sa
 * `found`/`analyzed` koje je worker upisao (P3). Stara verzija je radila četiri
 * upita po pollingu (pretplata + posao + dva za napredak).
 *
 * `userId` mora da dođe od pozivaoca iz verifikovane sesije (pravilo 8) — RPC
 * ne čita sesiju sam.
 */
export async function getJobForUser(userId: string, jobId: number): Promise<JobView | null> {
  const { data, error } = await adminSupabase().rpc("get_job_for_user", {
    p_job_id: jobId,
    p_user: userId,
  });

  if (error) throw new Error(`Čitanje posla nije uspelo: ${error.message}`);

  const row = ((data ?? []) as {
    id: number;
    type: JobType;
    status: JobStatus;
    attempts: number;
    max_attempts: number;
    created_at: string;
    finished_at: string | null;
    last_error: string | null;
    found: number | null;
    analyzed: number | null;
  }[])[0];

  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    // `last_error` je tehnička poruka i stoji i posle uspešnog ponavljanja.
    // Korisniku se pokazuje samo kad je posao stvarno odustao.
    error: row.status === "failed" ? row.last_error : null,
    // Napredak upisuje worker — poslovi koji nisu scan nemaju `found`/`analyzed`.
    progress:
      row.found === null && row.analyzed === null
        ? null
        : { found: row.found ?? 0, analyzed: row.analyzed ?? 0 },
  };
}
