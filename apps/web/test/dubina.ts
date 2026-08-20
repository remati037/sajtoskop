// apps/web/test/dubina.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S17] Cena skeniranja je 1 kredit po stranici rezultata (LANSIRANJE §1.2).
// Naplatu proverava `pnpm check:sql` nad pravom migracijom; ovaj test pokriva
// ono što je u WEB sloju i što SQL ne vidi:
//
//   1. `besplatno()` — pogodak u kešu je uslovan i po svežini I po obimu.
//      Ovo je zamka 1 iz §1.2: keš dubine 1 za zahtev dubine 3 NIJE pogodak.
//   2. `searchBodySchema` — telo bez `dubina` pada na „Standardno", a klijent
//      ne sme da provuče slobodan broj rezultata pored ponude.
//   3. Ista formula cene u shared paketu koju SQL prelazi nezavisno.
//
// Zašto uopšte odvojeno od `check:sql`: te tri stvari odlučuju da li se do
// naplate uopšte STIGLO. Migracija koja tačno naplaćuje ne pomaže ako ruta
// besplatan put proglasi plaćenim (ili obrnuto) pre nego što je pozove.

import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  cenaDubine,
  cenaSkeniranja,
  DUBINA_OPIS,
  DUBINE,
  dubinaIli,
  dubinaZaRezultate,
  maxRezultataZaDubinu,
  PODRAZUMEVANA_DUBINA,
  stranicaZaRezultate,
} from "@sajtoskop/shared";

// Isti resolve hook kao u `ide-odmah.ts`: zameni module koji postoje samo u
// Next runtime-u i preslikaj `@/` alias. `search-cache.ts` je `server-only` i
// uvozi Supabase klijent — sam uvoz ne otvara nijednu vezu, a `besplatno()` je
// čista funkcija nad već pročitanim stanjem.
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

const { besplatno } = await import("../src/lib/search-cache");
const { searchBodySchema } = await import("../src/lib/search-schema");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

/** Stanje registra keša, sa razumnim podrazumevanim vrednostima za test. */
function stanje(over: { fresh: boolean; pages: number }) {
  return {
    scannedAt: "2026-08-01T00:00:00.000Z",
    total: 20,
    noSite: 5,
    partial: false,
    ...over,
  };
}

// ── 1. cena je izvedena iz broja stranica ──────────────────
console.log("\ncena po stranici");

check(
  cenaSkeniranja(20) === 1 && cenaSkeniranja(40) === 2 && cenaSkeniranja(60) === 3,
  "20 / 40 / 60 rezultata → 1 / 2 / 3 kredita",
);
check(
  DUBINE.every((d) => cenaDubine(d) === stranicaZaRezultate(maxRezultataZaDubinu(d))),
  "cena ponude je BROJ STRANICA te ponude, ne zaseban broj",
);
check(
  DUBINE.every((d) => maxRezultataZaDubinu(d) % 20 === 0),
  "svaka ponuda je pun umnožak stranice — plaćeno i skenirano su isti broj poziva",
);
check(
  DUBINE.every((d) => dubinaZaRezultate(maxRezultataZaDubinu(d)) === d),
  "dubinaZaRezultate je inverz maxRezultataZaDubinu",
);
check(
  dubinaZaRezultate(30) === "standardno",
  "zatečen payload sa maxResults: 30 (pre S17) čita se kao Standardno",
);
check(
  stranicaZaRezultate(0) === 1 && stranicaZaRezultate(-5) === 1,
  "nula i minus rezultata ne daju besplatno skeniranje",
);
check(
  stranicaZaRezultate(1000) === 3 && stranicaZaRezultate(Number.NaN) === 1,
  "vrednost van opsega i NaN se odsecaju na 1–3",
);
check(
  dubinaIli("izmisljeno") === PODRAZUMEVANA_DUBINA && dubinaIli("duboko") === "duboko",
  "nepoznata vrednost iz URL-a pada na podrazumevanu",
);
check(
  PODRAZUMEVANA_DUBINA === "standardno" && cenaDubine(PODRAZUMEVANA_DUBINA) === 2,
  `podrazumevano je „Standardno" i košta 2 kredita (koliko je i do S17 bilo skeniranje)`,
);

// ── 2. pogodak u kešu je uslovan i po dubini ───────────────
console.log("\npogodak u kešu");

check(
  besplatno(stanje({ fresh: true, pages: 1 }), 1),
  "keš dubine 1, zahtev dubine 1 → besplatno",
);
check(
  besplatno(stanje({ fresh: true, pages: 3 }), 1),
  "keš dubine 3, zahtev dubine 1 → besplatno",
);
check(
  besplatno(stanje({ fresh: true, pages: 3 }), 3),
  "keš dubine 3, zahtev dubine 3 → besplatno",
);
check(
  !besplatno(stanje({ fresh: true, pages: 1 }), 3),
  "keš dubine 1, zahtev dubine 3 → NIJE pogodak (20 redova nije 60)",
);
check(
  !besplatno(stanje({ fresh: true, pages: 2 }), 3),
  "keš dubine 2, zahtev dubine 3 → NIJE pogodak",
);
check(
  !besplatno(stanje({ fresh: false, pages: 3 }), 1),
  "istekao keš se ne servira ni kad je dublji od traženog (pravilo 1)",
);
check(
  !besplatno(stanje({ fresh: false, pages: 0 }), 1),
  "nikad skenirana kombinacija nije pogodak",
);
check(
  DUBINE.every((d) => besplatno(stanje({ fresh: true, pages: 3 }), cenaDubine(d))),
  "pun scan (3 stranice) pokriva SVE tri ponude",
);

// ── 3. ugovor tela zahteva ─────────────────────────────────
console.log("\ntelo POST /api/search");

const bezDubine = searchBodySchema.safeParse({ city: "nis", niche: "stomatolog" });
check(
  bezDubine.success && bezDubine.data.dubina === PODRAZUMEVANA_DUBINA,
  `telo bez „dubina" pada na „Standardno", ne na najskuplju ponudu`,
);
check(
  bezDubine.success && bezDubine.data.pay === false && bezDubine.data.force === false,
  "telo bez `pay` i dalje ne može da skine kredit",
);

const svakaDubina = DUBINE.every(
  (d) => searchBodySchema.safeParse({ city: "nis", niche: "stomatolog", dubina: d }).success,
);
check(svakaDubina, "sve tri ponude prolaze šemu");

check(
  !searchBodySchema.safeParse({ city: "nis", niche: "stomatolog", dubina: "najdublje" }).success,
  "nepoznata dubina u telu je 400, ne tiho podrazumevana",
);
check(
  !searchBodySchema.safeParse({ city: "nis", niche: "stomatolog", maxResults: 60 }).success,
  "klijent ne može da provuče `maxResults` pored ponude (strictObject)",
);
check(
  !searchBodySchema.safeParse({ city: "nis", niche: "stomatolog", dubina: 3 }).success,
  "broj umesto ponude je 400 — cena se ne uzima iz sirovog broja",
);

// ── 4. ono što UI ispisuje ─────────────────────────────────
console.log("\noznake na ekranu");

check(
  DUBINA_OPIS.brzo.labela === "Brzo" &&
    DUBINA_OPIS.standardno.labela === "Standardno" &&
    DUBINA_OPIS.duboko.labela === "Duboko",
  "nazivi ponuda se poklapaju sa tabelom iz LANSIRANJE §1.2",
);
check(
  DUBINA_OPIS.brzo.maxResults === 20 &&
    DUBINA_OPIS.standardno.maxResults === 40 &&
    DUBINA_OPIS.duboko.maxResults === 60,
  "brojevi prospekata se poklapaju sa tabelom (20 / 40 / 60)",
);
check(
  DUBINE.length === 3 && DUBINE[0] === "brzo" && DUBINE[2] === "duboko",
  "redosled u prekidaču ide od najjeftinije ka najskupljoj",
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
