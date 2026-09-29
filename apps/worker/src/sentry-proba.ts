// apps/worker/src/sentry-proba.ts
// Probna greška za Sentry (checklista 2.1, korak 4).
//
//   pnpm sentry:proba                          # DSN iz korenskog .env (worker)
//   SENTRY_DSN=<dsn web projekta> pnpm sentry:proba   # isti put, drugi projekat
//
// Šalje JEDAN događaj kroz isti `pokreniSentry()` / `prijaviKonacanPad()` koji
// koristi petlja workera. Poruka namerno nosi izmišljen mejl, telefon i sajt
// prospekta: u Sentry-ju moraš da vidiš `[mejl]`, `[telefon]` i `[url]`, a ne
// njih. Ako vidiš original, `beforeSend` nije na mestu — ne puštaj DSN u
// produkciju dok se to ne reši.
//
// Ne dodiruje bazu ni red poslova.

import { loadRootEnv } from "./lib/env";
import { isprazniSentry, pokreniSentry, prijaviKonacanPad } from "./lib/sentry";

loadRootEnv();

if (!pokreniSentry()) {
  console.error("SENTRY_DSN nije postavljen — nemam kuda da pošaljem probu.");
  process.exit(1);
}

const greska = new Error(
  "Sentry proba: fetch https://www.proba-prospekt.rs/kontakt pao, " +
    "vlasnik proba@primer-firme.rs, tel +381 64 000 1234",
);

prijaviKonacanPad(greska, { id: 0, type: "enrich_full", attempts: 1, max_attempts: 1 }, null);
await isprazniSentry();

console.log("Poslato. U Sentry-ju traži „Sentry proba\" — mejl, telefon i sajt moraju biti redigovani.");
