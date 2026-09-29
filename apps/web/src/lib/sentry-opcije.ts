// apps/web/src/lib/sentry-opcije.ts
// Podešavanje serverskog Sentry-ja (checklista 2.1). Čita ga SAMO
// `src/instrumentation.ts`, i u Node i u edge runtime-u (middleware).
//
// ── zašto samo server ───────────────────────────────────────
// Klijentski SDK je namerno odbijen (F11 §13, `lib/dnevnik-gresaka.ts`): 30 kB u
// bundle-u i tuđ nalog koji vidi ekrane sa kontakt podacima. Zato ovde NEMA
// `instrumentation-client.ts`, NEMA `withSentryConfig` u `next.config.ts` i
// NEMA izmene CSP-a — događaje šalje server, pregledač ne zna da Sentry postoji.
// `pnpm check:secrets` pada ako se Sentry ipak pojavi u `.next/static`.
//
// ── zašto nije u `lib/env.ts` ───────────────────────────────
// `env.ts` je `server-only`, a `instrumentation.ts` se ne izvršava u React
// serverskom sloju, pa bi ga `server-only` oborio. DSN je ovde jedina
// promenljiva i nije tajna koju treba validirati: bez nje se ništa ne šalje.
//
// Ne sme da uvozi ništa sa `node:*` — isti modul učitava i edge runtime.

import { ocistiSentryDogadjaj, sentryPrikupljanje } from "@sajtoskop/shared";

/** `null` = Sentry isključen. Prazan string je isto što i nepodešen. */
export function sentryDsn(): string | null {
  const dsn = process.env.SENTRY_DSN?.trim();
  return dsn ? dsn : null;
}

export function sentryOpcije(dsn: string) {
  return {
    dsn,
    // Vercel razlikuje `production` i `preview`; lokalni `next start` pada na
    // NODE_ENV. Isti DSN za oba okruženja, filtrira se u Sentry-ju.
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Samo greške. Tracing bi slao spanove sa URL-ovima i SQL-om, trošio
    // besplatnu kvotu i nije ono zbog čega je Sentry ovde (pad webhooka).
    tracesSampleRate: 0,
    // Tela, kolačići, query string, zaglavlja van uske liste i promenljive
    // okvira se ni ne skupljaju — `beforeSend` je druga linija, ne jedina.
    dataCollection: sentryPrikupljanje(),
    beforeSend: ocistiSentryDogadjaj,
    beforeSendTransaction: ocistiSentryDogadjaj,
  };
}
