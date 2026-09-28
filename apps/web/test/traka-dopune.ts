// apps/web/test/traka-dopune.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// Traka „Nemaš plan" za `dopuna` nalog (docs/LOKALNA-BAZA.md §11.1): tri grane
// po izvoru kredita i broj N = credits_topup + greatest(credits_balance, 0).
//
// Dva sloja: čista funkcija (grana i N), pa STVARNO renderovana traka — kvar
// koji je ovo otvorio nije bio u računici nego u zakucanom tekstu („Dobio si 2
// kredita" i kad nalog ima 7).

import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Pristup } from "@sajtoskop/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(path.join(webSrc, specifier.slice(2))).href, context);
    }
    return next(specifier, context);
  },
});

// `tsconfig` ima `jsx: preserve` (Next prevodi sam), pa tsx pada na klasičan
// JSX, koji traži globalni `React`.
(globalThis as Record<string, unknown>).React = React;

const { trakaDopune, granaTrakeDopune, kreditiTrakeDopune } = await import(
  "../src/lib/traka-dopune"
);
const { PristupBaner } = await import("../src/components/pristup-baner");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ── grana ──────────────────────────────────────────────────
console.log("grana");
check(granaTrakeDopune([]) === "onboarding", "bez redova → onboarding");
check(granaTrakeDopune(["onboarding"]) === "onboarding", "samo onboarding → onboarding");
check(granaTrakeDopune(["credit_pack"]) === "paket", "credit_pack → paket");
check(granaTrakeDopune(["admin"]) === "poklon", "admin → poklon");
check(granaTrakeDopune(["feedback"]) === "poklon", "feedback → poklon");
check(granaTrakeDopune(["feedback", "credit_pack"]) === "paket", "paket ima prednost nad poklonom");

// ── N ──────────────────────────────────────────────────────
console.log("\nN");
check(kreditiTrakeDopune({ credits_topup: 2, credits_balance: 0 }) === 2, "2 + 0 = 2");
check(kreditiTrakeDopune({ credits_topup: 7, credits_balance: 3 }) === 10, "7 + 3 = 10");
check(
  kreditiTrakeDopune({ credits_topup: 5, credits_balance: -40 }) === 5,
  "negativan balans ne umanjuje dopunu",
);

// ── renderovana traka ──────────────────────────────────────
console.log("\ntekst");
const dopuna = { stanje: "dopuna" } as unknown as Pristup;
const traka = (razlozi: string[], topup: number, balans: number) =>
  renderToStaticMarkup(
    createElement(PristupBaner, {
      pristup: dopuna,
      trakaDopune: trakaDopune(razlozi, { credits_topup: topup, credits_balance: balans }),
    }),
  )
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");

const onboarding = traka(["onboarding"], 2, 0);
check(onboarding.includes("Dobio si 2 kredita da probaš"), `onboarding: „${onboarding}"`);

const paket = traka(["onboarding", "credit_pack"], 50, 0);
check(paket.includes("Imaš 50 kredita iz paketa."), `paket: „${paket}"`);
check(!/prob/i.test(paket), "paket ne pominje probu ni „probaj”");
check(!paket.includes("Nemaš plan"), "paket ne kaže „Nemaš plan”");

const poklon = traka(["onboarding", "admin"], 7, -3);
check(poklon.includes("Nemaš plan. Imaš 7 kredita."), `poklon: „${poklon}"`);
check(!poklon.includes("Dobio si"), "poklon ne tvrdi „Dobio si 2”");

const jedan = traka(["feedback"], 1, 0);
check(jedan.includes("Imaš 1 kredit."), `poklon, jednina: „${jedan}"`);

const bez = renderToStaticMarkup(createElement(PristupBaner, { pristup: dopuna, trakaDopune: null }));
check(bez === "", "trakaDopune = null → bez trake (greška čitanja knjige)");

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
