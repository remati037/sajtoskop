// apps/web/test/stanja-skeniranja.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [0034] Tekstovi stanja skeniranja A–F (`docs/11-tekstovi-stanja-skeniranja.md`).
//
// Zašto test nad tekstom: dva pravila iz tog dokumenta su PONAŠANJE, ne stil, i
// oba su već jednom pukla u proizvodu —
//   · broj posla nikad ne sme u tekst koji korisnik vidi;
//   · nikad zadatak korisniku („javi mi") ni zabrana ponavljanja („ne pokreći").
// Regresija ovde ne ruši build, nego vraća poruku koja od korisnika traži da
// reši našu grešku. Zato je zabrana zapisana kao provera, a ne kao komentar.

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

const { stanjeA, stanjeB, stanjeC, stanjeD, stanjeE, stanjeF } = await import(
  "../src/lib/stanja-skeniranja"
);

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

/** Sve što stanje pokazuje korisniku, u jednom stringu. */
function ceoTekst(s: { naslov: string; telo: string | null; akcija: string | null }): string {
  return [s.naslov, s.telo ?? "", s.akcija ?? ""].join(" ");
}

const svaStanja = [
  stanjeA({ nadjeno: 28, grad: "Brusu", placeno: 2, vraceno: 3 }),
  stanjeA({ nadjeno: 40, grad: "Nišu", placeno: 2, vraceno: 0 }),
  stanjeB({ vraceno: 1 }),
  stanjeC({ nisa: "advokate", grad: "Brusu" }),
  stanjeD({ nisa: "advokate", grad: "Brusu" }),
  stanjeE({ vraceno: 1 }),
  stanjeF(),
];

// ═══════════════════════════════════════════════════════════
// PRAVILA DOKUMENTA — ista za svih šest stanja
// ═══════════════════════════════════════════════════════════

{
  // Pravilo 3: `job_id` nikad u tekst. Nijedna funkcija ga ni ne prima, pa ovo
  // hvata i pokušaj da se broj provuče kroz neki drugi parametar.
  const sumnjivo = /\b(posla|posao|job)\s*#?\d+|#\d+/i;
  check(
    svaStanja.every((s) => !sumnjivo.test(ceoTekst(s))),
    "nijedno stanje ne pominje broj posla",
  );

  // Pravilo 2: nula internih pojmova.
  const interno = /\bkeš|keša|kešu|ref_id|job_id|kombinacij/i;
  check(
    svaStanja.every((s) => !interno.test(ceoTekst(s))),
    "nijedno stanje ne koristi interne pojmove (kes, kombinacija)",
  );

  // Pravila 3 i 4: nikad zadatak korisniku i nikad zabrana ponavljanja.
  const zadatak = /javi mi|prijavi mi|ne pokreći|opet bi se naplatilo|vraćam ti ga/i;
  check(
    svaStanja.every((s) => !zadatak.test(ceoTekst(s))),
    "nijedno stanje ne traži od korisnika da prijavi grešku niti mu zabranjuje ponavljanje",
  );
}

// ═══════════════════════════════════════════════════════════
// STANJA, DOSLOVNO IZ DOKUMENTA
// ═══════════════════════════════════════════════════════════

{
  const a = stanjeA({ nadjeno: 28, grad: "Brusu", placeno: 2, vraceno: 3 });
  check(a.naslov === "Pronađeno 28 firmi u Brusu", `A naslov: ${a.naslov}`);
  check(
    a.telo === "Manji grad od očekivanog — naplaćena su 2 kredita, a 3 smo ti vratila.",
    `A telo: ${a.telo}`,
  );
  check(a.akcija === "Vidi listu", "A akcija je Vidi listu");

  // Bez povraćaja drugi red IZOSTAJE — „nije bilo povraćaja" se ne piše.
  const bez = stanjeA({ nadjeno: 40, grad: "Nišu", placeno: 2, vraceno: 0 });
  check(bez.telo === null, "A bez povraćaja nema drugi red");

  // Slaganje uz broj: 1 kredit, ne „1 kredita".
  const jedan = stanjeA({ nadjeno: 12, grad: "Brusu", placeno: 1, vraceno: 1 });
  check(
    jedan.telo === "Manji grad od očekivanog — naplaćen je 1 kredit, a 1 smo ti vratila.",
    `A za jedan kredit: ${jedan.telo}`,
  );
}

{
  const b = stanjeB({ vraceno: 1 });
  check(b.naslov === "Nešto je zastalo kod nas", `B naslov: ${b.naslov}`);
  check(
    b.telo === "Skeniranje je završeno, ali lista nije stigla do tebe. Vratili smo ti 1 kredit.",
    `B telo: ${b.telo}`,
  );
  check(b.akcija === "Pokušaj ponovo", "B nudi Pokušaj ponovo (ponavljanje je dozvoljeno)");
  check(stanjeB({ vraceno: 3 }).telo?.includes("3 kredita") === true, "B za 3 kredita koristi množinu");
}

{
  const c = stanjeC({ nisa: "advokate", grad: "Brusu" });
  check(c.naslov === "Nema rezultata za advokate u Brusu", `C naslov: ${c.naslov}`);
  check(
    c.telo === "Nismo našli ni jednu firmu koja odgovara. Nije naplaćeno.",
    `C telo: ${c.telo}`,
  );
  check(c.akcija === "Promeni pretragu", "C akcija je Promeni pretragu");
}

{
  const d = stanjeD({ nisa: "advokate", grad: "Brusu" });
  check(d.naslov === "Skeniram advokate u Brusu", `D naslov: ${d.naslov}`);
  check(d.telo?.startsWith("Obično traje 20–40 sekundi.") === true, `D telo: ${d.telo}`);
  check(d.akcija === null, "D nema radnju — skeniranje traje");
  // Dokument je upućivao na „Moje pretrage", ekran koji ne postoji. Stvarno
  // mesto je blok `Tvoji pristupi` na dnu iste strane.
  check(d.telo?.includes("Moje pretrage") === false, "D ne upućuje na nepostojeći ekran");
  check(
    d.telo?.includes("Tvoji pristupi") === true && d.telo.includes("na dnu ove strane"),
    "D upućuje na blok Tvoji pristupi na dnu strane pretrage",
  );
}

{
  const e = stanjeE({ vraceno: 1 });
  check(e.naslov === "Skeniranje nije uspelo", `E naslov: ${e.naslov}`);
  check(
    e.telo === "Vratili smo ti 1 kredit. Ako se ponovi, piši nam na podrska@sajtoskop.com.",
    `E telo: ${e.telo}`,
  );
  check(e.akcija === "Pokušaj ponovo", "E nudi Pokušaj ponovo");
}

{
  const f = stanjeF();
  check(f.naslov === "Ovu listu već imaš", `F naslov: ${f.naslov}`);
  check(f.telo === "Otvaranje ne troši kredite.", `F telo: ${f.telo}`);
  check(f.akcija === "Vidi listu", "F akcija je Vidi listu");
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
