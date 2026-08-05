// src/csv.ts
// CSV koji se otvara u Excelu na Windowsu bez razbijene dijakritike.

import fs from "node:fs";
import path from "node:path";

/** Excel razbija UTF-8 bez BOM-a — č, ć, š postaju smeće. */
const BOM = "\uFEFF";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Escapovanje po RFC 4180: navodnici se dupliraju, polje se obavija ako sadrži , " ili novi red
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(
  file: string,
  headers: string[],
  rows: unknown[][],
): void {
  const lines = [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // CRLF jer Excel to očekuje
  fs.writeFileSync(file, BOM + lines.join("\r\n") + "\r\n", "utf8");
}