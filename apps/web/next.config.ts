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

// ── bezbednosni headeri (Faza 1, 1.1; P1 iz docs/bezbednost-i-zastita.md) ──
// CSP je sastavljen oko onoga što app STVARNO koristi: Clerk (connect/img),
// Supabase (connect/img — potpisani URL-ovi slika), blob/data za snimke i
// avatare, i inline temna skripta u <head>-u (zato 'unsafe-inline' u
// script-src — nonce bi tražio middleware i menjao ceo layout).
// `frame-ancestors 'none'` je CSP ekvivalent `X-Frame-Options: DENY`; stoje oba.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://img.clerk.com https://*.clerk.accounts.dev",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.clerk.accounts.dev wss://*.clerk.accounts.dev https://*.clerk.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // HSTS: godinu dana + poddomeni. `preload` je bezopasan i ako domen nije
  // prijavljen u preload listu — header se poštuje od prve posete.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // `@sajtoskop/shared` se objavljuje kao sirovi TypeScript iz `src/` — bez build
  // koraka i bez `dist/`. Next mora sam da ga transpilira (CLAUDE.md, TS konvencije).
  transpilePackages: ["@sajtoskop/shared"],

  // Vercel build ne sme da prođe sa tipskom greškom. Ako ovo ikad postane
  // `ignoreBuildErrors: true`, prestala je da važi cela `strict` politika.
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        // Sve rute, uključujući API. Static asseti imaju svoje cache headere;
        // ovde se dodaje samo bezbednosni sloj.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
