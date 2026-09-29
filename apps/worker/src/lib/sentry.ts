// apps/worker/src/lib/sentry.ts
// Sentry za worker (checklista 2.1): konačan pad posla i poslovi koje žetva
// proglasi palim.
//
// Neuhvaćene greške procesa prijavljuju podrazumevane integracije SDK-a
// (`onUncaughtException`, `onUnhandledRejection`), i to BEZ gašenja procesa:
// kad postoji naš handler u `index.ts`, Sentry ga poštuje
// (`exitEvenIfOtherHandlersAreRegistered: false`). Ručna prijava tamo bi
// svaki takav događaj poslala dvaput.
//
// Bez `SENTRY_DSN` Sentry se ne podiže i sve funkcije ovde su no-op — lokalni
// razvoj i `--mock` ne šalju ništa, i to nije greška.
//
// `beforeSend` je isti kao na webu (`ocistiSentryDogadjaj` iz shared paketa):
// poruka greške iz `fetch-site` ili `screenshot` nosi URL sajta prospekta, a
// breadcrumb iz `console.log`-a ume da nosi i telefon. `payload` posla se NE
// šalje — u njemu stoje `place_id` i sajt; ID posla je dovoljan da se red nađe
// u `job_queue`.

import * as Sentry from "@sentry/node";
import { ocistiSentryDogadjaj, sentryPrikupljanje } from "@sajtoskop/shared";
import type { JobQueueRow } from "@sajtoskop/shared";

let ukljucen = false;

/** Poziva se jednom, posle `loadRootEnv()`. Vraća da li je Sentry podignut. */
export function pokreniSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    // Samo greške — isti razlog kao na webu (`lib/sentry-opcije.ts`).
    tracesSampleRate: 0,
    // Isto kao na webu: ništa od tela, kolačića ni promenljivih okvira.
    dataCollection: sentryPrikupljanje(),
    beforeSend: ocistiSentryDogadjaj,
    beforeSendTransaction: ocistiSentryDogadjaj,
  });

  ukljucen = true;
  return true;
}

type PosaoZaPrijavu = Pick<JobQueueRow, "id" | "type" | "attempts" | "max_attempts">;

/** Posao je pao i više se neće ponavljati (`fail_job` je vratio `final`). */
export function prijaviKonacanPad(err: unknown, posao: PosaoZaPrijavu, vraceno: number | null): void {
  if (!ukljucen) return;
  Sentry.captureException(err, {
    tags: { oblast: "worker", tip_posla: posao.type },
    extra: {
      posao: posao.id,
      pokusaji: `${posao.attempts}/${posao.max_attempts}`,
      ...(vraceno !== null ? { vraceno_kredita: vraceno } : {}),
    },
  });
}

/**
 * `reap_stuck_jobs` je obesio poslove koji su se zaglavili i iscrpeli pokušaje.
 * Nijedan radnik ih nije video da padaju, pa nema ni izuzetka — samo broj.
 */
export function prijaviZetvu(odustalo: number): void {
  if (!ukljucen || odustalo <= 0) return;
  Sentry.captureMessage(`žetva: ${odustalo} zaglavljenih poslova palo konačno`, {
    level: "error",
    tags: { oblast: "worker", faza: "zetva" },
    extra: { odustalo },
  });
}

/** `main()` je pao pre ili posle petlje — proces izlazi sa 1. */
export function prijaviPadStarta(err: unknown): void {
  if (!ukljucen) return;
  Sentry.captureException(err, { level: "fatal", tags: { oblast: "worker", faza: "start" } });
}

/** Pre izlaska iz procesa: pošalji ono što čeka u redu, najviše 2 s. */
export async function isprazniSentry(): Promise<void> {
  if (!ukljucen) return;
  await Sentry.close(2000);
}
