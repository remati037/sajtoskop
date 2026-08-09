// apps/worker/src/lib/paths.ts
// Putanje vezane za koren monorepoa, ne za `process.cwd()`.
//
// Zašto postoji: pnpm postavlja cwd na paket kad pokreneš `pnpm --filter ... scan`,
// a na koren kad pokreneš `pnpm scan`. Bez ovoga bi scan pisao u jedan `out/`,
// a harvest čitao iz drugog.
//
// Do F3 je ovde stajao i `.cache/api-budget.json` — brojač Google poziva. On je
// od F3 u tabeli `api_budget`, jer dva procesa na dve mašine sa dva fajla znače
// dva brojača, a mesečni cap od 900 poziva time prestaje da važi. `cachePath()`
// ostaje kao opšta putanja; ako se `.cache/api-budget.json` još vucara po disku,
// slobodno ga obriši, niko ga više ne čita.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Koren monorepoa — direktorijum u kome je `pnpm-workspace.yaml`. */
export function workspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Ne bi trebalo da se desi; bolje cwd nego bacanje izuzetka usred scana.
  return process.cwd();
}

/** `out/` u korenu — deljeni izlaz scana i harvesta. */
export function outDir(): string {
  return join(workspaceRoot(), "out");
}

/** Fajl u `out/`, npr. `outPath("stomatolog-nis-2026-08-05.csv")`. */
export function outPath(...parts: string[]): string {
  return join(outDir(), ...parts);
}

/** `.cache/` u korenu — stanje Google budžeta. Gitignorovano. */
export function cachePath(...parts: string[]): string {
  return join(workspaceRoot(), ".cache", ...parts);
}

/** Putanja koju je korisnik uneo — uvek u odnosu na cwd, kao svaki CLI alat. */
export function userPath(p: string): string {
  return resolve(p);
}
