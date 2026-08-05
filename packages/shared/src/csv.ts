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
