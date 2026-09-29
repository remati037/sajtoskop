// apps/web/test/kanarinci.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// Oznaka kanarinca ne sme da stigne do klijenta (checklista 2.5, migracija 0036).
//
// Kanarinac radi samo dok izgleda kao pravi prospekt. Zato je oznaka u tabeli
// `canaries`, koju piše i čita isključivo `scripts/kanarinci.ts`. Nijedna ruta,
// server komponenta ni deljeni tip je ne dodiruje. Kad bi je iko u webu pročitao,
// ma i samo za admin bedž, sledeći korak bi bio `isCanary` u nekom odgovoru.
// Ovaj test to hvata pre tog koraka.
//
// Sken obuhvata i `lib/public-lead.ts`, pa pokriva i liste kolona koje hrane
// `PublicLead` i CSV (`LEAD_BUSINESS_COLUMNS`, `LEAD_AUDIT_COLUMNS`). Fajl se ne
// uvozi jer nosi `server-only`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

const koren = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ZNAK = /canar|kanarin/i;

function fajlovi(dir: string): string[] {
  return readdirSync(dir).flatMap((ime) => {
    const puno = path.join(dir, ime);
    if (statSync(puno).isDirectory()) return fajlovi(puno);
    return /\.(ts|tsx|js|mjs|sql)$/.test(ime) ? [puno] : [];
  });
}

for (const dir of ["apps/web/src", "packages/shared/src"]) {
  const pogodci = fajlovi(path.join(koren, dir)).filter((f) => ZNAK.test(readFileSync(f, "utf8")));
  check(
    pogodci.length === 0,
    `${dir}: nijedan fajl ne pominje kanarince` +
      (pogodci.length > 0 ? ` — ${pogodci.map((f) => path.relative(koren, f)).join(", ")}` : ""),
  );
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
