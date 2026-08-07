// apps/worker/src/lib/env.ts
// Učitavanje `.env` iz korena monorepoa, nezavisno od toga odakle je proces pokrenut.
//
// Zašto ne `import "dotenv/config"`: on traži `.env` u `process.cwd()`. pnpm
// postavlja cwd na koren kad pokreneš `pnpm seed`, a na direktorijum paketa kad
// pokreneš `pnpm --filter @sajtoskop/cli seed`. U drugom slučaju `.env` se tiho
// ne učita i skripta pukne na „nedostaje SUPABASE_SERVICE_ROLE_KEY" iako fajl postoji.
// Isti problem u web aplikaciji rešava `loadRootEnv()` u `apps/web/next.config.ts`.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspaceRoot } from "./paths";

let loaded = false;

/**
 * Učita `<koren>/.env` u `process.env`.
 *
 * `process.loadEnvFile` je ugrađen u Node i NE pregazi već postavljene
 * promenljive — pravi env sa servera uvek pobeđuje fajl.
 */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  const file = join(workspaceRoot(), ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
