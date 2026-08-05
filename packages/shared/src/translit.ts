// packages/shared/src/translit.ts
// Srpska ćirilica → latinica. Deterministički, bez zavisnosti, bez `node:`.

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
    if (ch === undefined) continue;

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

/** "web dizajn agencija" → "web-dizajn-agencija" */
export function slugify(s: string): string {
  return foldForSearch(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
