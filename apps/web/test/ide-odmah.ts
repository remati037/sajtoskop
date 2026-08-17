// apps/web/test/ide-odmah.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [Faza 7, 7.2] `ideOdmah` odlučuje koji utisak ide na mejl ODMAH (bug, ocena 1,
// incident) a koji čeka digest u 21:00. Posle izmene 1.5 (kind/source za utiske
// van pitanja se izvode na serveru — bug i incident postoje samo u katalogu)
// ova grana je jedino mesto na kome se zna da li je zapis „gorući"; test čuva
// da se tri okidača ne raziđu sa rutom.

import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { FeedbackRow } from "@sajtoskop/shared";

// Isti resolve hook kao `scripts/lib/route-harness.ts`: zameni module koji
// postoje samo u Next runtime-u i preslikaj `@/` alias. Ostatak grafa
// (`feedback.ts` → supabase, mejl, šeme) se učitava stvarno — bez mreže.
const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");
const stubs = pathToFileURL(path.resolve(here, "../../../scripts/lib/next-stubs.ts")).href;

registerHooks({
  resolve(specifier, context, next) {
    if (["server-only", "next/navigation", "@clerk/nextjs/server"].includes(specifier)) {
      return { url: stubs, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(path.join(webSrc, specifier.slice(2))).href, context);
    }
    return next(specifier, context);
  },
});

const { ideOdmah } = await import("../src/lib/feedback");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

/** Minimalan red uz koji se menja samo ono što test proverava. */
function red(po: Partial<Pick<FeedbackRow, "kind" | "rating" | "source">>): FeedbackRow {
  return {
    id: 1,
    user_id: "u1",
    country_code: "RS",
    rating: 3,
    kind: null,
    message: null,
    source: "dugme",
    route: null,
    route_label: null,
    ctx: { plan: "beta", credits: 1, unlocks: 0, ua: "", viewport: "" },
    emailed_at: null,
    email_error: null,
    created_at: "",
    updated_at: "",
    prompt_key: null,
    answers: {},
    status: "novo",
    severity: null,
    tags: [],
    admin_note: null,
    resolved_at: null,
    notified_at: null,
    seen_at: null,
    screenshot_path: null,
    reward_credits: 0,
    user_note: null,
    notify_attempts: 0,
    ...po,
  };
}

check(ideOdmah(red({ kind: "bug" })) === true, "bug ide odmah");
check(ideOdmah(red({ rating: 1 })) === true, "ocena 1 ide odmah");
check(ideOdmah(red({ source: "incident" })) === true, "incident ide odmah");
check(ideOdmah(red({})) === false, "običan utisak čeka digest");
check(ideOdmah(red({ kind: "ideja", rating: 2, source: "dugme" })) === false, "ideja sa ocenom 2 čeka");
check(ideOdmah(red({ kind: "pohvala", rating: 3 })) === false, "pohvala čeka");

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
