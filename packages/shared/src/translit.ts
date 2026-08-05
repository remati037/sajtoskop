// src/shared/translit.ts
// Srpska ćirilica → latinica. Deterministički, bez zavisnosti.

import { pathToFileURL } from "node:url";

const LOWER: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž",
  з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n",
  њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u",
  ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š",
};

// Velika slova izvodimo iz malih: "љ" → "Lj", "а" → "A"
const UPPER: Record<string, string> = {};
for (const [cyr, lat] of Object.entries(LOWER)) {
  UPPER[cyr.toUpperCase()] = lat.charAt(0).toUpperCase() + lat.slice(1);
}

export function cirToLat(input: string): string {
  if (!input) return input;

  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    const lower = LOWER[ch];
    if (lower) {
      out += lower;
      continue;
    }

    const upper = UPPER[ch];
    if (upper) {
      // Digraf (Lj, Nj, Dž): ako je i sledeće slovo veliko → ceo digraf veliki
      if (upper.length === 2) {
        const next = input[i + 1];
        const nextIsUpperCyr = next !== undefined && next in UPPER;
        out += nextIsUpperCyr ? upper.toUpperCase() : upper;
      } else {
        out += upper;
      }
      continue;
    }

    out += ch; // latinica, brojevi, interpunkcija — netaknuto
  }

  return out;
}

/**
 * Za poređenje, pretragu i deduplikaciju: mala slova, bez dijakritike.
 * Nikad za prikaz korisniku.
 * Srpske zamene idu PRE normalize("NFD") — "đ" nije slovo + akcenat,
 * pa ga NFD ne razlaže i mora ručno.
 */
export function foldForSearch(input: string): string {
  return cirToLat(input)
    .toLowerCase()
    .replaceAll("đ", "dj")
    .replaceAll("ž", "z")
    .replaceAll("ć", "c")
    .replaceAll("č", "c")
    .replaceAll("š", "s")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ── samotest: pnpm exec tsx src/shared/translit.ts ──────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cases: [string, string][] = [
    ["Страхињића Бана, Ниш", "Strahinjića Bana, Niš"],
    ["Vizantijski bulevar 22/4, Niš", "Vizantijski bulevar 22/4, Niš"],
    ["ЉУБИША", "LJUBIŠA"],
    ["Ђорђе Џаџић", "Đorđe Džadžić"],
    ["Стоматолошка ординација Њега", "Stomatološka ordinacija Njega"],
  ];

  let fail = 0;
  for (const [input, expected] of cases) {
    const got = cirToLat(input);
    const ok = got === expected;
    if (!ok) fail++;
    console.log(`${ok ? "✓" : "✗"}  ${input}\n   → ${got}${ok ? "" : `\n   očekivano: ${expected}`}`);
  }

  const folds: [string, string][] = [
    ["Dental Studio Lalić", "dental studio lalic"],
    ["Milošević", "milosevic"],
    ["Ђорђе", "djordje"],
  ];
  for (const [input, expected] of folds) {
    const got = foldForSearch(input);
    const ok = got === expected;
    if (!ok) fail++;
    console.log(`${ok ? "✓" : "✗"}  fold: ${input} → ${got}${ok ? "" : `  očekivano: ${expected}`}`);
  }

  console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
}

/** "web dizajn agencija" → "web-dizajn-agencija" */
export function slugify(s: string): string {
  return foldForSearch(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}