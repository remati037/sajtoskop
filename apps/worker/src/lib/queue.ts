// apps/worker/src/lib/queue.ts
// Tanak omotač oko RPC funkcija iz migracije 0003. Bez ijedne odluke — ceo
// protokol reda (skip locked, backoff, žetva zaglavljenih) je u SQL-u, jer se
// nad deljenim stanjem „pročitaj pa upiši" iz TS-a ne može uraditi bezbedno.

import type { JobQueueRow, JobType } from "@sajtoskop/shared";
import { supabaseAdmin } from "./supabase";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? []) as T[];
}

// ── upis ───────────────────────────────────────────────────

export type EnqueueInput = {
  type: JobType;
  payload: Record<string, unknown>;
  /** Isti ključ dok posao živi → nov posao se ne pravi (štedi Places pozive). */
  dedupeKey?: string | null;
  /** Ko čeka rezultat. Bez ovoga posao nema pretplatnika i niko ga ne polluje. */
  userId?: string | null;
  runAfter?: Date | null;
};

export type EnqueueResult = { jobId: number; joined: boolean };

export async function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  const rows = await rpc<{ job_id: number; joined: boolean }>("enqueue_job", {
    p_type: input.type,
    p_payload: input.payload,
    p_dedupe_key: input.dedupeKey ?? null,
    p_user: input.userId ?? null,
    p_run_after: (input.runAfter ?? new Date()).toISOString(),
  });

  const row = rows[0];
  if (!row) throw new Error("enqueue_job nije vratio ID posla.");
  return { jobId: row.job_id, joined: row.joined };
}

/** Više poslova odjednom, redom. Vraća koliko ih je stvarno novih. */
export async function enqueueMany(inputs: EnqueueInput[]): Promise<number> {
  let created = 0;
  for (const input of inputs) {
    const { joined } = await enqueueJob(input);
    if (!joined) created++;
  }
  return created;
}

// ── preuzimanje i završetak ────────────────────────────────

/** Sledeći posao, ili `null` ako red trenutno nema šta da ponudi. */
export async function claimJob(): Promise<JobQueueRow | null> {
  const rows = await rpc<JobQueueRow>("claim_job", {});
  return rows[0] ?? null;
}

export async function completeJob(id: number): Promise<void> {
  await rpc("complete_job", { p_id: id });
}

export type FailResult = { final: boolean; nextRun: Date | null };

export async function failJob(id: number, error: string): Promise<FailResult> {
  const rows = await rpc<{ final: boolean; next_run: string | null }>("fail_job", {
    p_id: id,
    p_error: error,
  });
  const row = rows[0];
  return {
    final: row?.final ?? true,
    nextRun: row?.next_run ? new Date(row.next_run) : null,
  };
}

/** Odlaganje bez trošenja pokušaja — za budžet, ne za greške. */
export async function deferJob(id: number, runAfter: Date, note: string): Promise<void> {
  await rpc("defer_job", {
    p_id: id,
    p_run_after: runAfter.toISOString(),
    p_note: note,
  });
}

export type ReapResult = { requeued: number; failed: number };

export async function reapStuckJobs(minutes = 15): Promise<ReapResult> {
  const rows = await rpc<ReapResult>("reap_stuck_jobs", { p_minutes: minutes });
  return rows[0] ?? { requeued: 0, failed: 0 };
}
