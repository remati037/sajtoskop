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

/**
 * Clerk domen iz publishable ključa, za CSP.
 *
 * `pk_test_<base64url>` dekoduje se u `<domen>$` — npr. `clerk.sajtoskop.com$`
 * (custom domen) ili `real-boxer-65.clerk.accounts.dev$` (default instanca).
 * Clerk 6 dinamički učitava `clerk-js` sa tog domena (`/npm/@clerk/…`) i zove
 * isti domen kao Frontend API, pa CSP mora da ga dozvoli u `script-src`,
 * `connect-src` i `img-src` — wildcard `*.clerk.accounts.dev` custom domen NE
 * pokriva (to je naš poddomen, ne Clerk-ov).
 *
 * Ako ključ nedostaje ili se ne dekoduje, pada se na spisak koji pokriva i
 * default instancu i custom domen ovog projekta.
 */
function clerkDomains(): string[] {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const b64 = pk.replace(/^pk_(test|live)_/, "");
  try {
    const decoded = Buffer.from(b64, "base64url").toString("utf8").replace(/\$$/, "").trim();
    if (decoded && decoded.includes(".") && !decoded.includes(" ")) return [decoded];
  } catch {
    // padni na podrazumevano ispod
  }
  return ["*.clerk.accounts.dev", "clerk.sajtoskop.com"];
}

const clerk = clerkDomains().map((d) => `https://${d}`).join(" ");
const clerkWss = clerkDomains().map((d) => `wss://${d}`).join(" ");

// ── bezbednosni headeri (Faza 1, 1.1; P1 iz docs/bezbednost-i-zastita.md) ──
// CSP je sastavljen oko onoga što app STVARNO koristi: Clerk (script/connect/img
// — domen se izvlači iz publishable ključa, v. `clerkDomains()`), Supabase
// (connect/img — potpisani URL-ovi slika), blob/data za snimke i avatare, i
// inline temna skripta u <head>-u (zato 'unsafe-inline' u script-src — nonce bi
// tražio middleware i menjao ceo layout).
// `frame-ancestors 'none'` je CSP ekvivalent `X-Frame-Options: DENY`; stoje oba.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${clerk}`,
  // Clerk pravi Web Worker iz blob: URL-a (pollovanje tokena) — bez eksplicitnog
  // worker-src-a bi palo na script-src i bilo blokirano.
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.supabase.co https://img.clerk.com https://*.clerk.accounts.dev ${clerk}`,
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co https://*.clerk.accounts.dev ${clerkWss} https://*.clerk.com ${clerk}`,
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
