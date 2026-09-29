// apps/web/src/instrumentation.ts
// Next.js hook koji se izvršava jednom po serverskom procesu (Node i edge).
// Jedino mesto na kome se Sentry podiže — v. `lib/sentry-opcije.ts` za to
// zašto samo na serveru.
//
// `onRequestError` hvata greške koje ISPADNU iz server komponenti, route
// handlera, server akcija i middleware-a. Rute koje grešku same uhvate i vrate
// 500 (webhookovi, `/api/search`, `/api/unlock`) je prijavljuju eksplicitno
// kroz `prijaviGresku()` iz `lib/sentry.ts` — do ovog hooka ona nikad ne stigne.

import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";
import { sentryDsn, sentryOpcije } from "./lib/sentry-opcije";

export function register(): void {
  const dsn = sentryDsn();
  // Bez DSN-a Sentry se ne podiže, pa `captureException` svuda ostaje tih
  // no-op. To je uredno stanje (lokalni razvoj, CI), ne greška.
  if (!dsn) return;

  Sentry.init(sentryOpcije(dsn));
}

export const onRequestError: Instrumentation.onRequestError = (...args) => {
  Sentry.captureRequestError(...args);
};
