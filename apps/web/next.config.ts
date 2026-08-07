import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NextConfig } from "next";

// ── jedan .env za ceo monorepo ─────────────────────────────
// Next učitava `.env` iz svog direktorijuma (`apps/web/`), a naš stoji u korenu
// monorepoa — isti fajl koriste i CLI i worker. Bez ovoga `serverEnv()` puca na
// „Nedostaju ili su neispravne env promenljive" iako je `.env` uredno popunjen.
//
// `process.loadEnvFile` je ugrađen u Node i NE pregazi već postojeće promenljive.
// Zato redosled ostaje ispravan: Vercel env > apps/web/.env.local > koren/.env.
function loadRootEnv(): void {
  let dir = process.cwd();

  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const file = join(dir, ".env");
      if (existsSync(file)) process.loadEnvFile(file);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // `@sajtoskop/shared` se objavljuje kao sirovi TypeScript iz `src/` — bez build
  // koraka i bez `dist/`. Next mora sam da ga transpilira (CLAUDE.md, TS konvencije).
  transpilePackages: ["@sajtoskop/shared"],

  // Vercel build ne sme da prođe sa tipskom greškom. Ako ovo ikad postane
  // `ignoreBuildErrors: true`, prestala je da važi cela `strict` politika.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
