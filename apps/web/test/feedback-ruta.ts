// apps/web/test/feedback-ruta.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S29] Ugovor tela `POST /api/feedback` — pravilo 8 kao test, ne kao komentar.
//
// Dve tvrdnje, obe o istoj stvari: iz pregledača sme da stigne ono što server
// ne zna, i ništa više.
//
//   1. Polja koja opisuju NALOG (`plan`, `credits`, `stanje`, `severity`,
//      `status`, `reward_credits`) u telu ne postoje. Šema ih odbija — ne
//      ignoriše ih tiho, jer bi tiho ignorisanje značilo da klijent misli da je
//      nešto poslao.
//   2. `ctx_kljuc` prima SAMO identifikatore (`placeId`, `jobId`, `korak`).
//      Status posla, poruku greške i stanje naloga čita `zabelezi_utisak` iz
//      baze (migracija 0027), pa ih telo ni ne nudi.
//
// Ovo je test ŠEME, ne mreže: ugovor tela je jedino mesto na kom se rupa vidi
// pre nego što nešto uđe u `ctx` jsonb.

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

const { utisakBodySchema, ctxKljucSchema, korakEnum } = await import("../src/lib/feedback-schema");
const { proveriOdgovor } = await import("@sajtoskop/shared");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

/** Najmanje telo koje uopšte prolazi — sve ostalo se dodaje na njega. */
const OSNOVA = { rating: 3 as const, source: "dugme" as const, route: "/pretraga" };

// ── 1. telo ne sme da opisuje nalog ────────────────────────

console.log("telo: šta server NE prima");

check(utisakBodySchema.safeParse(OSNOVA).success, "minimalno telo prolazi");

// Ova polja se IGNORIŠU, ne odbijaju — i to je namerno.
//
// Odbijanje bi značilo `400` za zahtev koji je inače ispravan, dakle izgubljen
// utisak zbog polja koje ionako ne bi ništa promenilo. Zod `object` (ne
// `strictObject`) ih zato skida na granici: ono što izađe iz šeme je jedino što
// ruta uopšte vidi, a ruta iz toga destrukturira poimenično. Dve brane, i
// nijedna ne košta korisnika ništa.
//
// Za `answers` važi obrnuto pravilo (`strictObject` u katalogu), jer tamo
// nepoznat ključ znači da se pitanje razišlo sa šemom — to nije šum nego kvar.
for (const [polje, vrednost] of [
  ["plan", "pro"],
  ["credits", 999],
  ["credits_balance", 999],
  ["stanje", "aktivan"],
  ["severity", 1],
  ["status", "reseno"],
  ["reward_credits", 10],
  ["route_label", "Pretraga"],
  ["user_id", "user_tudji"],
  ["ua", "lazan"],
] as const) {
  const ishod = utisakBodySchema.safeParse({ ...OSNOVA, [polje]: vrednost });
  check(
    ishod.success && !(polje in ishod.data),
    `\`${polje}\` iz tela se IGNORIŠE — ne izlazi iz šeme`,
  );
}

// Zahtev je i dalje ispravan: ignorisanje ne sme da se pretvori u `400`.
const saPlanom = utisakBodySchema.safeParse({ ...OSNOVA, plan: "pro", credits: 42 });
check(saPlanom.success, "telo sa `plan` i dalje prolazi — utisak se ne gubi zbog viška polja");
check(
  saPlanom.success && Object.keys(saPlanom.data).sort().join(",") === "rating,route,source",
  "iz šeme izlaze SAMO polja iz ugovora",
);

const cisto = utisakBodySchema.safeParse(OSNOVA);
check(
  cisto.success && !("plan" in cisto.data) && !("stanje" in cisto.data),
  "ono što prođe ne nosi nijedno polje o nalogu",
);

// ── 2. ctx_kljuc: samo identifikatori ──────────────────────

console.log("\nctx_kljuc: samo identifikatori");

check(
  ctxKljucSchema.safeParse({ placeId: "ChIJ_abc", jobId: "412", korak: "kartica" }).success,
  "placeId + jobId + korak prolaze",
);
check(ctxKljucSchema.safeParse({}).success, "prazan kontekst prolazi — prijava bez njega postoji");

for (const polje of ["stanje", "plan", "greska", "status", "job_status", "credits"]) {
  check(
    !ctxKljucSchema.safeParse({ korak: "kartica", [polje]: "bilo šta" }).success,
    `\`ctx_kljuc.${polje}\` pada — čita se sa servera, ne iz tela`,
  );
}

check(!ctxKljucSchema.safeParse({ jobId: 412 }).success, "jobId kao broj pada — očekuje se cifra u stringu");
check(!ctxKljucSchema.safeParse({ jobId: "a12" }).success, "jobId koji nije broj pada");
check(!ctxKljucSchema.safeParse({ jobId: "" }).success, "prazan jobId pada");
check(
  !ctxKljucSchema.safeParse({ korak: "izmisljen" }).success,
  "nepoznat korak pada — spisak je zatvoren, kao i katalog pitanja",
);
check(
  korakEnum.options.length === 6 &&
    ["kartica", "skeniranje", "unlock", "pretraga", "welcome", "pretplata"].every((k) =>
      (korakEnum.options as readonly string[]).includes(k),
    ),
  `šest mesta sa kojih se greška prijavljuje (${korakEnum.options.join(" · ")})`,
);

// Kontekst putuje uz POST, jer se `ctx` gradi u trenutku upisa reda.
const saKontekstom = utisakBodySchema.safeParse({
  ...OSNOVA,
  ctx_kljuc: { placeId: "ChIJ_abc", korak: "unlock" },
});
check(saKontekstom.success, "telo sa `ctx_kljuc` prolazi");
check(
  saKontekstom.success && saKontekstom.data.ctx_kljuc?.placeId === "ChIJ_abc",
  "identifikator stiže do rute nepromenjen",
);

// ── 3. odgovor na pitanje i dalje ide kroz katalog ─────────
// Ista kapija koju S29 nije smela da olabavi dok je dodavala `ctx_kljuc`.

console.log("\npitanje: katalog je i dalje jedina kapija");

check(
  !utisakBodySchema.safeParse({ source: "dugme", route: "/pretraga" }).success,
  "zapis bez ocene i bez pitanja nema sadržaj",
);
check(
  !utisakBodySchema.safeParse({ ...OSNOVA, answers: { odgovor: "jeste" } }).success,
  "odgovor bez pitanja nema gde da se upiše",
);
check(!proveriOdgovor("nps-7", { ocena: 11 }).ok, "ruta bi odbila ocenu van skale");
check(
  !proveriOdgovor("fali", { tekst: "nema niše", route: "/pretraga" }).ok,
  "ruta bi odbila `route` u odgovoru — nju čita server",
);

// `bug` i `incident` postoje samo u katalogu: telo bez `prompt_key` ne sme da
// ih izazove (Faza 1, 1.5). Kapija je u RUTI (`IZVOR_BEZ_PITANJA`), ne u šemi —
// jer zavisi od toga ima li `prompt_key`, a to šema ne zna. S29 na tome ništa
// ne menja: panel „Prijavi grešku" tip `bug` šalje tek u dopuni, kad zapis već
// postoji, pa `ctx_kljuc` ne otvara nov put do instant mejla.
check(
  utisakBodySchema.safeParse({ ...OSNOVA, source: "incident" }).success,
  "šema pušta `source: incident` — odbija ga ruta, i to je i dalje tako",
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
