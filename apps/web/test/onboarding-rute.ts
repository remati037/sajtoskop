// apps/web/test/onboarding-rute.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S30] Web strana onboardinga (tok-i-onboarding §1.8, §4.3). Tri sloja:
//
//   1. ŠEME: `/api/onboarding/korak` prima SAMO `poruka` od koraka trake —
//      `pretraga`, `otkljucavanje` i `pipeline` upisuju rute koje te radnje
//      rade. Sve tri šeme su `strictObject`.
//   2. RUTE bez sesije: 401 pre tela i pre baze (pravilo 8).
//   3. ŽICE (statički): kapija čarobnjaka je u pet strana ODMAH posle
//      `zahtevajCitanje()` i NIJE u layout-u; koraci se upisuju iz ruta koje ih
//      rade; blok „Prvi koraci" je obrisan sa `/dashboard`.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

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

const sesija = ((globalThis as Record<string, unknown>).__sajtoskopSession ??= {
  current: null,
}) as { current: string | null };

const S = await import("../src/lib/onboarding-schema");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ── 1. šeme ────────────────────────────────────────────────
console.log("šema: POST /api/onboarding/korak");

check(S.korakBodySchema.safeParse({ korak: "poruka" }).success, "{korak: poruka} prolazi");
for (const k of ["pretraga", "otkljucavanje", "pipeline"]) {
  check(!S.korakBodySchema.safeParse({ korak: k }).success, `{korak: ${k}} ODBIJEN — upisuje ga server`);
}
check(!S.korakBodySchema.safeParse({ korak: "poruka", userId: "user_tudji" }).success, "poruka + userId odbijen (strictObject)");
check(!S.korakBodySchema.safeParse({ korak: "poruka", vrednost: "x" }).success, "poruka + vrednost odbijen");
check(S.korakBodySchema.safeParse({ korak: "grad", vrednost: "sabac" }).success, "grad iz taksonomije prolazi");
check(!S.korakBodySchema.safeParse({ korak: "grad", vrednost: "gotham" }).success, "nepoznat grad odbijen");
check(S.korakBodySchema.safeParse({ korak: "nisa", vrednost: "pvc-stolarija" }).success, "niša iz taksonomije prolazi");
check(!S.korakBodySchema.safeParse({ korak: "nisa", vrednost: "kotlarnica" }).success, "nepoznata niša odbijena");
check(S.korakBodySchema.safeParse({ korak: "kanal", vrednost: "instagram" }).success, "kanal instagram prolazi");
check(!S.korakBodySchema.safeParse({ korak: "kanal", vrednost: "poziv" }).success, "kanal poziv odbijen (0028)");
check(!S.korakBodySchema.safeParse({ korak: "grad" }).success, "grad bez vrednosti odbijen");

console.log("\nšema: preskoci i hint");
check(S.preskociBodySchema.safeParse({ gde: "carobnjak" }).success, "preskoci carobnjak");
check(S.preskociBodySchema.safeParse({ gde: "traka" }).success, "preskoci traka");
check(!S.preskociBodySchema.safeParse({}).success, "preskoci bez `gde` odbijen");
check(!S.preskociBodySchema.safeParse({ gde: "traka", done: true }).success, "preskoci sa viškom odbijen");
for (const h of ["nema-sajt", "otkljucaj", "poruka", "pipeline"]) {
  check(S.hintBodySchema.safeParse({ hint: h }).success, `hint ${h} prolazi`);
}
check(!S.hintBodySchema.safeParse({ hint: "traka" }).success, "hint `traka` odbijen — to ide kroz preskoci");
check(!S.hintBodySchema.safeParse({ hint: "izmisljen" }).success, "nepoznat hint odbijen");

// ── 2. rute bez sesije ─────────────────────────────────────
console.log("\nrute bez sesije");
sesija.current = null;
for (const ime of ["korak", "preskoci", "hint"]) {
  const { POST } = await import(`../src/app/api/onboarding/${ime}/route`);
  const res: Response = await POST(
    new Request(`http://localhost/api/onboarding/${ime}`, { method: "POST", body: "{}" }),
  );
  check(res.status === 401, `/api/onboarding/${ime} bez sesije → 401 (${res.status})`);
}

// ── 3. žice ────────────────────────────────────────────────
console.log("\nžice");
const src = (f: string) => readFileSync(path.join(webSrc, f), "utf8");

for (const ime of ["korak", "preskoci", "hint"]) {
  const kod = src(`app/api/onboarding/${ime}/route.ts`);
  check(kod.includes("requireUserId()") && kod.includes("proveriIpTempo("), `/api/onboarding/${ime}: sesija + tempo`);
  check(!/req\.json\(\)[\s\S]*userId\s*=/.test(kod.replace(/requireUserId\(\)/g, "")), `/api/onboarding/${ime}: userId nije iz tela`);
}
check(/z\.strictObject/.test(src("lib/onboarding-schema.ts")) && !/z\.object\(/.test(src("lib/onboarding-schema.ts")), "sve tri šeme su strictObject");

for (const strana of ["pretraga", "lista", "pipeline", "dashboard", "krediti"]) {
  const kod = src(`app/(app)/${strana}/page.tsx`);
  const citanje = kod.indexOf("zahtevajCitanje()");
  const kapija = kod.indexOf("zahtevajOnboarding(");
  check(citanje > 0 && kapija > citanje, `/${strana}: zahtevajOnboarding posle zahtevajCitanje`);
}
check(!src("app/(app)/layout.tsx").includes("zahtevajOnboarding("), "layout NE zove kapiju čarobnjaka (§1.8)");
check(!src("app/(app)/dashboard/page.tsx").includes("Prvi koraci</h2>"), "blok „Prvi koraci“ je obrisan sa /dashboard (§4.6)");

check(/oznaciAkoTreba\([^)]*"pretraga"\)/.test(src("app/api/search/route.ts")), "/api/search upisuje korak pretraga");
check(/oznaciKorak\(userId, "otkljucavanje"\)/.test(src("lib/unlock.ts")), "lib/unlock.ts upisuje korak otkljucavanje");
check(/oznaciAkoTreba\([^)]*"pipeline"\)/.test(src("app/api/pipeline/route.ts")), "/api/pipeline upisuje korak pipeline");
check(src("lib/pozivnice-schema.ts").includes('komp: "/pocetak?pozivnica=komp"'), "komp pozivnica vodi u čarobnjak (§1.13)");
check(src("app/welcome/page.tsx").includes('href="/pocetak">Napravi prvu listu'), "/welcome primarno dugme vodi u čarobnjak");

{
  const kod = src("components/pocetak-ekran.tsx");
  check(kod.includes('dubina: "brzo"'), "ekran 4 traži dubinu brzo");
  check(/pretraga\(false\)[\s\S]*pretraga\(true\)/.test(kod), "ekran 4 prvo proverava cenu BEZ naplate, pa plaća");
  check(kod.includes("&dubina=brzo"), "redirekcija nosi dubina=brzo (plaćena je jedna stranica)");
}
{
  const kod = src("app/pocetak/page.tsx");
  check(kod.includes("s.fresh"), "/pocetak nudi samo sveže kombinacije");
  check(!/enqueue|spendCreditAndScan|spend_credit_and_scan/.test(kod), "/pocetak ne upisuje posao i ne naplaćuje");
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
