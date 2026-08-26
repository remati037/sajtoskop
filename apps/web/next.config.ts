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

/**
 * Clerk-ova bot-zaštita pri registraciji.
 *
 * ── kako se kvar vidi ───────────────────────────────────────
 * „Registracija neuspešna zbog neuspelog sigurnosnog proveravanja." Poruka
 * zvuči kao da je server odbio nalog; u stvari se u pregledaču nikad nije
 * učitao Cloudflare Turnstile widget koji Clerk traži pre `signUp.create()`.
 * Prijava radi normalno — captcha stoji samo na registraciji, pa se greška
 * javlja tačno na jednom ekranu i deluje kao problem sa Clerk nalogom.
 *
 * ── zašto CSP ──────────────────────────────────────────────
 * `challenges.cloudflare.com` nije Clerk-ov domen, pa ga `clerkDomains()` ne
 * izvlači iz publishable ključa — a `default-src 'self'` obara i skriptu i
 * iframe. Kvar je zato bio tu od prvog dana ovog CSP-a i NIJE posledica nijedne
 * naplatne sesije; otkriven je tek kad je neko prošao kroz SVEŽU registraciju,
 * što je do sada bilo retko — postojeći nalog se samo prijavljuje, a prijava
 * captchu ne traži.
 *
 * ── šta tačno traži (Clerk CSP docs) ────────────────────────
 *   script-src   challenges.cloudflare.com   učitava Turnstile
 *                *.protect.clerk.com         Clerk-ova zaštita od zloupotrebe
 *   frame-src    oba ista                    widget je iframe
 *   connect-src  *.protect.clerk.com:*       ‼️ `:*` je OBAVEZAN — ti hostovi
 *                                            se serviraju i van porta 443, a
 *                                            izvor bez porta po CSP specifikaciji
 *                                            poklapa SAMO podrazumevani port.
 */
const clerkCaptcha = "https://challenges.cloudflare.com https://*.protect.clerk.com";

/**
 * Paddle (naplata, F-naplata) — jedan wildcard umesto šest imena hostova.
 *
 * Ovo je spisak koji je STVARNO izmeren, ne prepisan iz dokumentacije (Paddle
 * je ne objavljuje). Snimljen sa `/cenovnik` dok su cene bile učitane i dok je
 * checkout overlay bio otvoren:
 *
 *   cdn.paddle.com                        script      paddle.js, uvek sa golog cdn-a
 *   sandbox-cdn.paddle.com                stylesheet  stil overlay-a
 *   sandbox-api.paddle.com                fetch       PricePreview
 *   sandbox-checkout-service.paddle.com   xhr         sesija checkout-a
 *   sandbox-buy.paddle.com                frame, img  sam overlay
 *
 * Zašto `*.paddle.com`, a ne pet imena:
 *   1. Svaki host ima svog `sandbox-` blizanca, pa bi spisak bio deset imena od
 *      kojih polovina ne radi ništa u datom okruženju.
 *   2. Prelazak na produkciju bi tražio izmenu CSP-a uz izmenu tokena — a to je
 *      tačno ona izmena koja se zaboravi i otkrije se kao „checkout ne radi".
 *   3. Paddle ume da doda host (Apple Pay, Retain) bez najave.
 *
 * Ovo NIJE širenje poverenja na treću stranu preko potrebe: `*.paddle.com` je
 * domen jednog dobavljača kome ionako predajemo ceo tok plaćanja.
 *
 * Fontovi, `localizecdn` i Sentry koji se vide u snimku mreže NE idu ovde —
 * njih učitava Paddle-ov dokument unutar iframe-a, pa važi NJIHOV CSP, ne naš.
 */
const paddle = "https://*.paddle.com";

/**
 * `'unsafe-eval'` SAMO u razvoju. U produkciji ga nema i ne sme da ga bude.
 *
 * ── šta se dešavalo ─────────────────────────────────────────
 * `next dev` pakuje module kroz `eval()` (webpack `eval-source-map`). Bez
 * `'unsafe-eval'` pregledač obori TAJ eval, pa React nikad ne hidrira — a to se
 * ne vidi kao pad nego kao mrtva stranica: HTML je tu, izgleda ispravno, ali
 * nijedno dugme ne radi. Prekidač teme na `/` se klikne i ništa se ne promeni.
 *
 * Zatečeno stanje, ne posledica naplate: `/` nema nijednu Paddle liniju i
 * ponaša se isto. Otkriveno je tek uz cenovnik jer je to prvi ekran kome
 * hidratacija TREBA da bi uopšte prikazao sadržaj (cene stižu iz `fetch`-a),
 * dok su ostali ekrani serverski i izgledaju ispravno i mrtvi.
 *
 * ── zašto je bezbedno ───────────────────────────────────────
 * Uslov je `NODE_ENV`, koji Next postavlja sam: `development` za `next dev`,
 * `production` za `next build`/`next start`. Vercel gradi produkcijski, pa ovo
 * na sajt ne stiže. Provera iz P0-4 (grep za `unsafe-eval` u produkcijskom
 * headeru) i dalje prolazi — v. test ispod.
 */
const dev = process.env.NODE_ENV === "development";
const unsafeEval = dev ? " 'unsafe-eval'" : "";

// ── bezbednosni headeri (Faza 1, 1.1; P1 iz docs/bezbednost-i-zastita.md) ──
// CSP je sastavljen oko onoga što app STVARNO koristi: Clerk (script/connect/img
// — domen se izvlači iz publishable ključa, v. `clerkDomains()`), Supabase
// (connect/img — potpisani URL-ovi slika), blob/data za snimke i avatare, i
// inline temna skripta u <head>-u (zato 'unsafe-inline' u script-src — nonce bi
// tražio middleware i menjao ceo layout).
// `frame-ancestors 'none'` je CSP ekvivalent `X-Frame-Options: DENY`; stoje oba.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${unsafeEval} ${clerk} ${clerkCaptcha} ${paddle}`,
  // Clerk pravi Web Worker iz blob: URL-a (pollovanje tokena) — bez eksplicitnog
  // worker-src-a bi palo na script-src i bilo blokirano.
  "worker-src 'self' blob:",
  `style-src 'self' 'unsafe-inline' ${paddle}`,
  `img-src 'self' data: blob: https://*.supabase.co https://img.clerk.com https://*.clerk.accounts.dev ${clerk} ${paddle}`,
  "font-src 'self' data:",
  // `https://*.protect.clerk.com:*` stoji ODVOJENO od `https://*.clerk.com`
  // iznad, iako ga po imenu pokriva: izvor bez porta poklapa samo 443, a ovi
  // hostovi se serviraju i na drugim portovima. Bez `:*` captcha tiho padne.
  `connect-src 'self' https://*.supabase.co https://*.clerk.accounts.dev ${clerkWss} https://*.clerk.com https://*.protect.clerk.com:* ${clerk} ${paddle}`,
  // Checkout overlay je iframe ka `sandbox-buy.paddle.com` / `buy.paddle.com`.
  // Bez ovoga direktiva pada na `default-src 'self'` i modal ostane prazan —
  // Paddle.js pri tome NE javlja grešku, samo se ništa ne pojavi.
  // Uz Paddle overlay ovde je i Turnstile widget — on je iframe ka
  // `challenges.cloudflare.com`, pa bez njega registracija pada na
  // „neuspelo sigurnosno proveravanje".
  `frame-src 'self' ${clerkCaptcha} ${paddle}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Ostaje `'none'`: mi ne uokvirujemo nikoga i niko ne sme da uokviri nas.
  // Ovo ne dira Paddle — `frame-ancestors` govori ko sme da uokviri NAŠU stranu,
  // a `frame-src` koga MI smemo da uokvirimo. Paddle overlay je ovo drugo.
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
