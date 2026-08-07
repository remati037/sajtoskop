// packages/shared/src/csv.ts
// CSV koji se otvara u Excelu na Windowsu bez razbijene dijakritike.
//
// Ovde je SAMO serijalizacija — čista, bez `node:fs`, da bi je i browser mogao
// da koristi za download u F4. Upis na disk radi onaj ko ima fajl sistem
// (CLI, worker), ne ovaj paket.

/** Excel razbija UTF-8 bez BOM-a — č, ć, š postaju smeće. */
export const CSV_BOM = "\uFEFF";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Escapovanje po RFC 4180: navodnici se dupliraju, polje se obavija ako sadrži , " ili novi red
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Ceo CSV kao string — sa BOM-om i CRLF krajevima redova, jer Excel to očekuje.
 * Upisuje se doslovno, bez dodatne obrade.
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))];
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Inverzna operacija: CSV string → niz redova po nazivu kolone.
 *
 * Puni RFC 4180: navodnici, duplirani navodnici unutar polja, zarezi i novi
 * redovi u poljima. Podnosi i CRLF i LF, i vodeći BOM.
 * Ne pogađa tipove — sve je string, konverziju radi pozivalac.
 *
 * Postoji zbog seeda: stari CSV scanovi su jedini zapis Ugly Score-a za biznise
 * skenirane pre nego što je baza postojala.
 */
export function fromCsv(text: string): Record<string, string>[] {
  const src = text.startsWith(CSV_BOM) ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" → jedan navodnik
        else quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }

    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Prazan red (npr. novi red na kraju fajla) se ne broji kao zapis.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }

  const headers = rows.shift();
  if (!headers) return [];

  return rows.map((cells) => {
    const out: Record<string, string> = {};
    headers.forEach((h, i) => { out[h] = cells[i] ?? ""; });
    return out;
  });
}
