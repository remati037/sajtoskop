// apps/web/test/pristup.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S19, S25] Kapija pristupa u WEB sloju. Samu odluku — sedam stanja, datume, grace —
// pokriva `packages/shared/test/pristup.ts` nad čistom funkcijom. Ovde je ono
// što ta funkcija ne vidi:
//
//   1. PREVOD stanja u odbijenicu: koji status kod, koja rečenica, i da li
//      `grace` uopšte pada. Ovo je razlika između „izvoz prolazi" i „izvoz ne
//      prolazi", a to je ceo smisao grace perioda (§1.5).
//   2. ŽICE: da svaka ruta koja troši zaista zove kapiju za trošenje, a svaka
//      koja čita onu za čitanje. Kapija koja postoji a nije pozvana je gora od
//      kapije koje nema — izgleda kao zaštita.
//
// Provera 2 je namerno statička (čita izvor ruta), a ne pokretanje rute:
// `/api/export` bez prave baze ne može da napravi CSV, a regresija koje se
// stvarno plašim nije „ruta je vratila pogrešan status" nego „nova ruta je
// napisana bez kapije".

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  stanjePristupa,
  type PretplataZaPristup,
  type Pristup,
  type ProfilZaPristup,
} from "@sajtoskop/shared";

// Isti resolve hook kao u `ide-odmah.ts`, `dubina.ts` i `naplata.ts`.
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

const { odbijenica, odbijenicaCitanja } = await import("../src/lib/pristup");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

const SADA = Date.parse("2026-08-21T12:00:00.000Z");
const DAN = 24 * 60 * 60 * 1000;
const zaDana = (n: number) => new Date(SADA + n * DAN).toISOString();

function stanje(over: Partial<ProfilZaPristup>, pretplata: PretplataZaPristup | null = null): Pristup {
  return stanjePristupa(
    { plan: "komp", kompExpiresAt: null, planExpiresAt: null, creditsTopup: 0, ...over },
    pretplata,
    SADA,
  );
}

const KOMP = stanje({});
const GRACE = stanje({ kompExpiresAt: zaDana(-1) });
const ZAKLJUCAN = stanje({ kompExpiresAt: zaDana(-40) });
const DOPUNA = stanje({ kompExpiresAt: zaDana(-40), creditsTopup: 25 });
const PROBA = stanje(
  { plan: "starter", planExpiresAt: zaDana(7) },
  { status: "trialing", currentPeriodEnd: zaDana(7), trialEnd: zaDana(7), cancelAtPeriodEnd: false, canceledAt: null },
);
const OTKAZANA_PROBA = stanje(
  { plan: "starter", planExpiresAt: zaDana(5) },
  { status: "trialing", currentPeriodEnd: zaDana(5), trialEnd: zaDana(5), cancelAtPeriodEnd: true, canceledAt: null },
);

check(
  GRACE.stanje === "grace" && ZAKLJUCAN.stanje === "zakljucan" && DOPUNA.stanje === "dopuna",
  "priprema: tri stanja su ono što test misli da jesu",
);
check(
  KOMP.stanje === "komp" && PROBA.stanje === "proba" && OTKAZANA_PROBA.stanje === "otkazan",
  "priprema: komp, proba i otkazana proba (S25)",
);

// ── 1. kapija za trošenje ──────────────────────────────────
console.log("\nodbijenica (pretraga, skeniranje, otključavanje, uvoz, AI)");

check(odbijenica(KOMP, "skeniranje") === null, "komp: skeniranje prolazi");
check(odbijenica(PROBA, "skeniranje") === null, "proba: skeniranje prolazi (pun pristup)");
check(odbijenica(OTKAZANA_PROBA, "otkljucavanje") === null, "otkazana proba: do trial_end sve prolazi");
check(odbijenica(DOPUNA, "skeniranje") === null, "dopuna: skeniranje prolazi");
check(odbijenica(null, "skeniranje") === null, "nepoznato stanje NE zaključava (kvar veze ≠ istek)");

{
  const odgovor = odbijenica(GRACE, "skeniranje");
  check(odgovor !== null, "grace: skeniranje ne prolazi");
  check(odgovor?.status === 403, "grace: status je 403, ne 402 (nije stanje novčanika)");
}

check(odbijenica(GRACE, "pretraga") !== null, "grace: pretraga ne prolazi ni iz keša");
check(odbijenica(GRACE, "otkljucavanje") !== null, "grace: otključavanje ne prolazi");
check(odbijenica(GRACE, "uvoz") !== null, "grace: uvoz (koji otključava) ne prolazi");
check(odbijenica(GRACE, "ai-poruka") !== null, "grace: nova AI varijanta ne prolazi");
check(odbijenica(ZAKLJUCAN, "pretraga") !== null, "zaključan: ništa od toga ne prolazi");

{
  // Odbijenica mora da kaže TAČAN datum i tačan izlaz — inače je to samo „ne
  // možeš", što je razlog za mejl podršci.
  const telo = await odbijenica(GRACE, "skeniranje")!.json();
  const poruka = String(telo.greska);
  check(poruka.includes("/cenovnik"), "odbijenica vodi na /cenovnik");
  check(/\d{4}/.test(poruka), "odbijenica sadrži godinu, dakle konkretan datum");
  check(poruka.includes("Skeniranje"), "odbijenica imenuje radnju koja je odbijena");
}

// ── 2. kapija za čitanje ───────────────────────────────────
console.log("\nodbijenicaCitanja (izvoz, pipeline, poruke)");

check(odbijenicaCitanja(GRACE) === null, "grace: izvoz i pipeline PROLAZE");
check(odbijenicaCitanja(KOMP) === null, "komp: prolazi");
check(odbijenicaCitanja(PROBA) === null, "proba: prolazi");
check(odbijenicaCitanja(DOPUNA) === null, "dopuna: prolazi");
check(odbijenicaCitanja(null) === null, "nepoznato stanje ne zaključava ni čitanje");
check(odbijenicaCitanja(ZAKLJUCAN)?.status === 403, "zaključan: ne prolazi, 403");

// Ovo je par koji čini grace period smislenim, pa stoji kao jedna provera.
check(
  odbijenicaCitanja(GRACE) === null && odbijenica(GRACE, "skeniranje") !== null,
  "grace: izvoz prolazi, skeniranje ne",
);

// ── 3. žice: nijedna ruta bez kapije ───────────────────────
console.log("\nžice u rutama");

const izvor = (ruta: string) =>
  readFileSync(path.join(webSrc, "app/api", ruta, "route.ts"), "utf8");

/** Rute koje TROŠE — moraju da zovu `odbijenica`. */
for (const ruta of ["search", "unlock", "uvoz", "search/kes", "poruke/ai"]) {
  const kod = izvor(ruta);
  check(
    /\bodbijenica\(/.test(kod) && kod.includes("citajPristup"),
    `/api/${ruta} zove kapiju za trošenje`,
  );
}

/** Rute koje ČITAJU — kapija sme da padne samo na zaključanom nalogu. */
for (const ruta of ["export", "pipeline", "poruke"]) {
  const kod = izvor(ruta);
  check(/\bodbijenicaCitanja\(/.test(kod), `/api/${ruta} zove kapiju za čitanje`);
  check(
    !/[^C]\bodbijenica\(/.test(kod.replace(/odbijenicaCitanja\(/g, "")),
    `/api/${ruta} NE koristi kapiju za trošenje (grace mora da prođe)`,
  );
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
