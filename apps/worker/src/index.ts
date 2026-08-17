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
import { refundScan } from "./lib/db-writes";
import { loadRootEnv } from "./lib/env";
import { claimJob, completeJob, deferJob, enqueueJob, failJob, reapStuckJobs } from "./lib/queue";
import { closeBrowser } from "./lib/screenshot";
import { supabaseAdmin } from "./lib/supabase";
import { HANDLERS } from "./jobs";
import type { JobContext, JobResult } from "./jobs";

loadRootEnv();

const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3));

/** Koliko se čeka kad je red prazan. Kraće bi bilo trošenje Supabase zahteva. */
const IDLE_MS = Number(process.env.WORKER_IDLE_MS ?? 2000);

/** Posao stariji od ovoga u statusu `running` smatra se zaglavljenim (PRD §1). */
const STUCK_MINUTES = Number(process.env.WORKER_STUCK_MINUTES ?? 15);
const REAP_EVERY_MS = 5 * 60 * 1000;

/** Na koliko se proverava da li tekući mesec ima dodelu kredita (F4 §2). */
const SCHEDULE_EVERY_MS = 60 * 60 * 1000;

/**
 * Koliko se čeka pre nego što se PALA mesečna dodela pokuša ponovo.
 *
 * Bez ovoga bi pao posao zauvek blokirao mesec — a sa nulom bi raspoređivač
 * pravio nov posao svakog sata dok god uzrok pada traje. Šest sati znači najviše
 * četiri crvena reda dnevno i oporavak u istom danu kad se uzrok otkloni.
 */
const RETRY_AFTER_FAILURE_MS = 6 * 60 * 60 * 1000;

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

  let result: JobResult;
  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new Error(`Nepoznat tip posla: ${job.type}`);

    result = await handler(job.payload, ctx);
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
      // Konačan pad plaćenog skeniranja znači da je korisnik dao kredit ni za
      // šta (F9 §2). Odloženi posao (`defer_job` iznad) nije pad i ne vraća se —
      // on će se izvršiti čim Googleova kvota stigne.
      if (job.type === "scan") {
        const vraceno = await refundScan(job.id);
        if (vraceno > 0) log(`[${slot}] ${label} vraćeno ${vraceno} kredita`);
      }

      log(`[${slot}] ${label} PAO konačno — ${message}`);
    } else {
      log(`[${slot}] ${label} pao, sledeći pokušaj ${nextRun?.toISOString()} — ${message}`);
    }
    return true;
  }

  // [Faza 0, 0.2] Završetak je VAN try-ja: kad je posao gotov, greška u
  // `complete_job` ne sme da uđe u catch iznad. Inače bi mrežna greška posle
  // uspešnog rada pozvala `fail_job` — posao bi se ponovio (novi
  // Places/Playwright pozivi) ili pao i refundovao uspešan scan. Baza je sada i
  // sama zaštićena (migracija 0017): `complete_job` diže status na `done` samo
  // nad `running`, a `fail_job`/`defer_job` ne diraju ništa što nije `running` —
  // pa ni dvostruki poziv ne menja ishod.
  try {
    await completeJob(job.id);
  } catch (err) {
    // Ako je zahtev stvarno izgubljen (nije samo odgovor), posao ostaje
    // `running` i prva sledeća žetva ga vraća u red — isto kao kad proces
    // pogine usred posla.
    log(
      `[${slot}] ${label} complete_job nije uspeo: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  log(`[${slot}] ${label} gotovo za ${secs}s — ${result.note}`);
  return true;
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

/**
 * Povraćaj za pala skeniranja koja nisu prošla kroz `runOne`.
 *
 * `reap_stuck_jobs` ume da posao proglasi palim bez ijednog radnika (proces
 * ubijen usred scana, iscrpljeni pokušaji nad zaglavljenim poslom). Tada nema ko
 * da pozove `refundScan`, pa bi kredit ostao potrošen na posao koji niko nikad
 * nije video. Zato ova metla ide kroz sve `scan` poslove koji su pali u
 * poslednja 24 sata; `refund_scan` je idempotentan, pa je ponovni prolaz jeftin.
 */
async function refundFailedScans(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin()
    .from("job_queue")
    .select("id")
    .eq("type", "scan")
    .eq("status", "failed")
    .gte("created_at", since)
    .returns<{ id: number }[]>();

  if (error) throw new Error(`Čitanje palih scanova nije uspelo: ${error.message}`);

  for (const job of data ?? []) {
    const vraceno = await refundScan(job.id);
    if (vraceno > 0) log(`povraćaj za pao scan #${job.id}: ${vraceno} kredita`);
  }
}

async function reaperLoop(): Promise<void> {
  while (running) {
    try {
      const { requeued, failed } = await reapStuckJobs(STUCK_MINUTES);
      if (requeued > 0 || failed > 0) {
        log(`žetva: ${requeued} vraćeno u red, ${failed} odustalo`);
      }

      await refundFailedScans();
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
 * Provera ne može da gleda samo žive poslove — `dedupe_key` u 0003 važi dok
 * posao traje, pa bi se posle `done` isti mesec upisivao svakog sata. Ali ne sme
 * ni da gleda sve statuse redom:
 *
 * [NAUČENO NA SVOJOJ KOŽI] Prva verzija je blokirala na posao BILO kog statusa.
 * Kad je posao pao — a pao je, jer je worker na Hetzneru vrteo kod od pre F4 i
 * nije poznavao tip `monthly_grant` — mesec je ostao zauvek „pokriven" poslom
 * koji nikad nije dodelio nijedan kredit. Tiho, bez ijedne poruke.
 *
 * Zato: `pending`, `running` i `done` blokiraju, a `failed` blokira samo šest
 * sati. Dodela je idempotentna (`ref_id` je mesec), pa je ponovni pokušaj
 * bezopasan, a jedini ishod koji se ne popravlja sam jeste onaj koji niko ne vidi.
 */
async function ensureMonthlyGrant(): Promise<void> {
  const month = creditMonth();

  const { data, error } = await supabaseAdmin()
    .from("job_queue")
    .select("id, status, created_at")
    .eq("type", "monthly_grant")
    .eq("dedupe_key", month)
    .order("id", { ascending: false })
    .limit(1)
    .returns<{ id: number; status: string; created_at: string }[]>();

  if (error) throw new Error(`Provera mesečne dodele nije uspela: ${error.message}`);

  const poslednji = (data ?? [])[0];

  if (poslednji) {
    if (poslednji.status !== "failed") return;

    const odPada = Date.now() - new Date(poslednji.created_at).getTime();
    if (odPada < RETRY_AFTER_FAILURE_MS) return;

    log(`mesečna dodela za ${month} je pala (posao #${poslednji.id}) — pokušavam ponovo`);
  }

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

// [Faza 0, 0.5] Neuhvaćena greška ne sme da ubije proces usred posla (V7).
// Node po podrazumevanoj vrednosti gasi proces na neuhvaćeno odbijanje promise-a;
// ovde se greška loguje i petlja nastavlja. Svaki posao je ionako u svom
// try/catch-u, a `main()` na vrhu hvata greške starta — ovde stižu samo one
// koje niko nije predvideo, i za njih je bolje da ostanu u logu nego da
// Docker restartuje kontejner dok scan radi.
process.on("unhandledRejection", (reason: unknown) => {
  log(
    `neuhvaćeno odbijanje: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`,
  );
});
process.on("uncaughtException", (err: Error) => {
  log(`neuhvaćen izuzetak: ${err.stack ?? err.message}`);
});

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

  // Chromium ne umire sa Node procesom — bez ovoga `docker compose down` ostavi
  // zombi renderere koji drže memoriju do sledećeg restarta hosta.
  await closeBrowser();

  log("worker stao");
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
