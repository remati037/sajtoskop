// packages/shared/test/smoke.ts
// Jedini test u F0. Pokretanje: pnpm test  (ili: pnpm --filter @sajtoskop/shared test)
//
// Ovde su preseljeni samotestovi koji su ranije stajali na dnu ugly-score.ts i
// translit.ts. Morali su da odu iz src/ jer su uvozili `node:url` — a nijedan fajl
// u packages/shared/src ne sme da dodirne `node:` (F0, sekcija 5).

import type { UglyBand } from "../src/index";
import { cirToLat, foldForSearch, scoreSite } from "../src/index";

let fail = 0;

function check(ok: boolean, line: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
}

// ── ugly score ─────────────────────────────────────────────

const year = new Date().getFullYear();

const modern = `<html><head><meta name="viewport" content="width=device-width">
  <title>Ordinacija</title><meta name="description" content="x">
  <meta property="og:title" content="x"><link rel="icon" href="/f.ico">
  </head><body>${"tekst ".repeat(500)}<p>&copy; ${year}</p></body></html>`;

const meh = `<html><head><title>Ordinacija</title></head>
  <body>${"tekst ".repeat(500)}<p>&copy; ${year - 4}</p></body></html>`;

const ancient = `<html><head><title>Ordinacija</title></head><body>
  <table><tr><td><table><tr><td><table><tr><td>
  <font size="2">Dobrodosli</font></td></tr></table></td></tr></table></td></tr></table>
  <center><font color="red">Akcija</font></center><marquee>Novo!</marquee>
  <script src="/js/jquery-1.7.2.min.js"></script>
  ${"tekst ".repeat(400)}<center>&copy; 2011</center></body></html>`;

// jedan <center> u modernom sajtu ne sme da upali legacy_tags
const modernWithOneCenter = modern.replace("</body>", "<center>Radno vreme</center></body>");

const cases: [string, string, UglyBand][] = [
  ["moderan", modern, "solidan"],
  ["moderan +center", modernWithOneCenter, "solidan"],
  ["osrednji", meh, "ruzan"],
  ["iz 2011", ancient, "katastrofa"],
];

console.log("ugly score");
for (const [name, html, expected] of cases) {
  const r = scoreSite({ html, httpsOk: true, loadMs: 800, finalUrl: null });
  const ok = r.band === expected;
  check(ok, `${name.padEnd(16)} skor ${String(r.score).padStart(3)} · ${r.band} · ${r.platform}`);
  console.log(`   ${r.signals.map((s) => `${s.key}(${s.points})`).join(" ") || "—"}`);
  if (!ok) console.log(`   očekivano: ${expected}`);
}

// ── transliteracija ────────────────────────────────────────

console.log("\ntransliteracija");
const translits: [string, string][] = [
  ["Страхињића Бана, Ниш", "Strahinjića Bana, Niš"],
  ["Vizantijski bulevar 22/4, Niš", "Vizantijski bulevar 22/4, Niš"],
  ["ЉУБИША", "LJUBIŠA"],
  ["Ђорђе Џаџић", "Đorđe Džadžić"],
  ["Стоматолошка ординација Њега", "Stomatološka ordinacija Njega"],
];
for (const [input, expected] of translits) {
  const got = cirToLat(input);
  check(got === expected, `${input} → ${got}${got === expected ? "" : `  očekivano: ${expected}`}`);
}

const folds: [string, string][] = [
  ["Dental Studio Lalić", "dental studio lalic"],
  ["Milošević", "milosevic"],
  ["Ђорђе", "djordje"],
];
for (const [input, expected] of folds) {
  const got = foldForSearch(input);
  check(got === expected, `fold: ${input} → ${got}${got === expected ? "" : `  očekivano: ${expected}`}`);
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
