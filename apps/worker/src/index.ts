// apps/worker/src/index.ts
// Petlja workera. Nema nijedan otvoren port — sam vuče posao iz `job_queue`
// preko `for update skip locked` (00-kontekst §3).
//
// Pokretanje:  pnpm --filter worker dev   (tsx watch)
//              pnpm --filter worker start (jednokratno, ovo ide u Docker)
//
// ── šta se dešava kad se proces ubije usred posla ──────────
// Ništa dramatično. Posao ostaje `running` sa `locked_at` u prošlosti, i prvi
// sledeći `reap_stuck_jobs` (svakih 5 minuta) ga vrati u `pending`. Zato nema
// ni potrebe za čišćenjem pri gašenju — samo se ne uzima nov posao.

import { setTimeout as sleep } from "node:timers/promises";
import { creditMonth } from "@sajtoskop/shared";
import { BudgetError } from "./lib/api-budget";
import { loadRootEnv } from "./lib/env";
import { claimJob, completeJob, deferJob, enqueueJob, failJob, reapStuckJobs } from "./lib/queue";
import { supabaseAdmin } from "./lib/supabase";
import { HANDLERS } from "./jobs";
import type { JobContext } from "./jobs";

loadRootEnv();

const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3));

/** Koliko se čeka kad je red prazan. Kraće bi bilo trošenje Supabase zahteva. */
const IDLE_MS = Number(process.env.WORKER_IDLE_MS ?? 2000);

/** Posao stariji od ovoga u statusu `running` smatra se zaglavljenim (PRD §1). */
const STUCK_MINUTES = Number(process.env.WORKER_STUCK_MINUTES ?? 15);
const REAP_EVERY_MS = 5 * 60 * 1000;

/** Na koliko se proverava da li tekući mesec ima dodelu kredita (F4 §2). */
const SCHEDULE_EVERY_MS = 60 * 60 * 1000;

let running = true;

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(message: string): void {
  console.log(`${stamp()}  ${message}`);
}

// ── jedan posao ────────────────────────────────────────────

async function runOne(slot: number): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;

  const label = `#${job.id} ${job.type}`;
  const ctx: JobContext = {
    job,
    log: (m) => log(`  [${slot}] ${label}  ${m}`),
  };

  const started = Date.now();
  log(`[${slot}] ${label} start (pokušaj ${job.attempts}/${job.max_attempts})`);

  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new Error(`Nepoznat tip posla: ${job.type}`);

    const result = await handler(job.payload, ctx);
    await completeJob(job.id);

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    log(`[${slot}] ${label} gotovo za ${secs}s — ${result.note}`);
    return true;
  } catch (err) {
    // Budžet nije greška nego čekanje. `defer_job` vraća `attempts` unazad, pa
    // mesečni cap ne pojede sva tri pokušaja pre nego što kvota uopšte stigne.
    if (err instanceof BudgetError && err.retryAfter) {
      await deferJob(job.id, err.retryAfter, err.message);
      log(
        `[${slot}] ${label} odloženo do ${err.retryAfter.toISOString()} — ${err.message}`,
      );
      return true;
    }

    const message = err instanceof Error ? err.message : String(err);
    const { final, nextRun } = await failJob(job.id, message);

    if (final) {
      log(`[${slot}] ${label} PAO konačno — ${message}`);
    } else {
      log(`[${slot}] ${label} pao, sledeći pokušaj ${nextRun?.toISOString()} — ${message}`);
    }
    return true;
  }
}

/**
 * Jedan radnik. Uzima poslove dok ih ima; kad red presuši, spava `IDLE_MS`.
 *
 * Greška ovde znači da ni sam red nije dostupan (Supabase pao). Tada se čeka
 * duže i pokušava ponovo — proces se ne gasi, jer bi ga Docker samo restartovao.
 */
async function workerLoop(slot: number): Promise<void> {
  while (running) {
    try {
      const didWork = await runOne(slot);
      if (!didWork) await sleep(IDLE_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[${slot}] red poslova nedostupan: ${message}`);
      await sleep(IDLE_MS * 5);
    }
  }
  log(`[${slot}] radnik stao`);
}

// ── žetva zaglavljenih ─────────────────────────────────────

async function reaperLoop(): Promise<void> {
  while (running) {
    try {
      const { requeued, failed } = await reapStuckJobs(STUCK_MINUTES);
      if (requeued > 0 || failed > 0) {
        log(`žetva: ${requeued} vraćeno u red, ${failed} odustalo`);
      }
    } catch (err) {
      log(`žetva nije uspela: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Sitni koraci umesto jednog dugog čekanja, da SIGTERM ne čeka 5 minuta.
    for (let waited = 0; waited < REAP_EVERY_MS && running; waited += 1000) {
      await sleep(1000);
    }
  }
}

// ── mesečna dodela kredita ─────────────────────────────────

/**
 * Upiši `monthly_grant` posao ako ga tekući mesec još nema.
 *
 * [ODSTUPANJE od PRD-a §2] PRD kaže „pokreće ga worker prvog u mesecu". Uslov
 * ovde nije datum nego odsustvo posla za taj mesec. Razlika je bitna kad worker
 * prvog u mesecu ne radi — deploy, restart Hetznera, pao kontejner: uz proveru
 * datuma korisnici bi ostali bez kredita ceo mesec i to bi se videlo tek po
 * prijavama. Ovako prvi sledeći start nadoknadi propušteno.
 *
 * Provera gleda poslove SVIH statusa, ne samo žive — `dedupe_key` u 0003 važi
 * samo dok posao traje, pa bi se posle `done` isti mesec upisivao svakog sata.
 */
async function ensureMonthlyGrant(): Promise<void> {
  const month = creditMonth();

  const { data, error } = await supabaseAdmin()
    .from("job_queue")
    .select("id")
    .eq("type", "monthly_grant")
    .eq("dedupe_key", month)
    .limit(1)
    .returns<{ id: number }[]>();

  if (error) throw new Error(`Provera mesečne dodele nije uspela: ${error.message}`);
  if ((data ?? []).length > 0) return;

  const { jobId } = await enqueueJob({
    type: "monthly_grant",
    payload: { month },
    dedupeKey: month,
    userId: null,
  });

  log(`mesečna dodela za ${month} upisana kao posao #${jobId}`);
}

async function schedulerLoop(): Promise<void> {
  while (running) {
    try {
      await ensureMonthlyGrant();
    } catch (err) {
      log(`raspoređivanje nije uspelo: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (let waited = 0; waited < SCHEDULE_EVERY_MS && running; waited += 1000) {
      await sleep(1000);
    }
  }
}

// ── gašenje ────────────────────────────────────────────────

function shutdown(signal: string): void {
  if (!running) return;
  running = false;
  log(`${signal} — završavam tekuće poslove, ne uzimam nove`);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── start ──────────────────────────────────────────────────

async function main(): Promise<void> {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[name]) throw new Error(`Nedostaje env promenljiva ${name}.`);
  }

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    // Ne rušimo se: `enrich_basic` i `refresh_google` bez Placesa i dalje rade,
    // a `scan` će pasti sa jasnom porukom na prvom pokušaju.
    log("UPOZORENJE: GOOGLE_MAPS_API_KEY nije postavljen — scan poslovi će padati.");
  }

  log(`worker start · ${CONCURRENCY} radnika · žetva na ${STUCK_MINUTES} min`);

  await Promise.all([
    ...Array.from({ length: CONCURRENCY }, (_, i) => workerLoop(i + 1)),
    reaperLoop(),
    schedulerLoop(),
  ]);

  log("worker stao");
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
