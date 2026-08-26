// apps/web/test/csp.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// Bezbednosni headeri, mereni nad STVARNO sastavljenim CSP-om.
//
// ── zašto ovaj fajl postoji ─────────────────────────────────
// CSP je jedina stvar u projektu koja se kvari TIHO i u pregledaču. Kad neki
// host fali, ništa ne padne na serveru, ništa ne uđe u log i `pnpm build`
// prolazi — a korisnik dobije poruku koja ga usmerava na pogrešan uzrok.
// Dva takva kvara su se već desila:
//
//   1. Paddle overlay je ostajao PRAZAN jer je `frame-src` padao na
//      `default-src 'self'`. Paddle.js pri tome ne javlja nikakvu grešku.
//   2. Registracija je padala na „neuspelo sigurnosno proveravanje" jer
//      `challenges.cloudflare.com` (Clerk bot-zaštita, Cloudflare Turnstile)
//      nije bio ni u `script-src` ni u `frame-src`. Poruka zvuči kao da je
//      server odbio nalog, a u stvari se widget nikad nije učitao.
//
// Test NE grepuje izvor nego zove `nextConfig.headers()` i parsira vrednost —
// dakle proverava ono što pregledač stvarno dobije, uključujući hostove koji se
// sklapaju iz publishable ključa u trenutku izvršavanja.

import config from "../next.config";

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

const headers = await config.headers!();
const csp = headers[0]?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

check(csp.length > 0, "Content-Security-Policy header postoji");

/** Direktiva → njeni izvori. Sve što nije nabrojano pada na `default-src`. */
const direktive = new Map<string, string[]>(
  csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [ime, ...izvori] = d.split(/\s+/);
      return [ime!, izvori] as [string, string[]];
    }),
);

const ima = (direktiva: string, izvor: string) =>
  (direktive.get(direktiva) ?? []).includes(izvor);

// ── Clerk: prijava, registracija i bot-zaštita ─────────────
console.log("\nClerk");

// Frontend API domen se izvlači iz publishable ključa, pa se ne poredi doslovno
// — proverava se da direktiva uopšte nosi neki Clerk host.
for (const d of ["script-src", "connect-src"]) {
  check(
    (direktive.get(d) ?? []).some((s) => s.includes("clerk")),
    `${d} nosi Clerk Frontend API`,
  );
}

check(ima("img-src", "https://img.clerk.com"), "img-src nosi img.clerk.com (avatari)");
// Clerk pravi Web Worker iz blob: URL-a za pollovanje tokena.
check(ima("worker-src", "blob:"), "worker-src dozvoljava blob: (Clerk token worker)");

// Bot-zaštita. OBA hosta u OBE direktive — Turnstile je skripta koja pravi
// iframe, pa jedna direktiva bez druge daje isti kvar kao nijedna.
for (const d of ["script-src", "frame-src"]) {
  check(ima(d, "https://challenges.cloudflare.com"), `${d} nosi challenges.cloudflare.com`);
  check(ima(d, "https://*.protect.clerk.com"), `${d} nosi *.protect.clerk.com`);
}

// ‼️ `:*` je obavezan i nije tipfeler: ovi hostovi se serviraju i van porta 443,
//    a izvor bez porta po CSP specifikaciji poklapa SAMO podrazumevani port.
//    `https://*.clerk.com` iznad ih po imenu pokriva, ali ne i po portu.
check(
  ima("connect-src", "https://*.protect.clerk.com:*"),
  "connect-src nosi *.protect.clerk.com:* (sa portom!)",
);

// ── Paddle: cene i checkout overlay ────────────────────────
console.log("\nPaddle");

for (const d of ["script-src", "connect-src", "frame-src", "style-src"]) {
  check(ima(d, "https://*.paddle.com"), `${d} nosi *.paddle.com`);
}

// ── P0-4: `unsafe-eval` nikad u produkciji ─────────────────
console.log("\nprodukcijski režim");

// Test se pokreće bez `NODE_ENV=production`, pa se ovde proverava USLOV, a ne
// zatečena vrednost: `unsafe-eval` sme da postoji samo kad je NODE_ENV
// `development`. Vercel gradi produkcijski, dakle na sajt ne stiže.
const jeDev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === undefined;
check(
  jeDev || !ima("script-src", "'unsafe-eval'"),
  "unsafe-eval ne postoji van razvoja (P0-4)",
);

check(ima("frame-ancestors", "'none'"), "frame-ancestors 'none' — niko nas ne uokviruje");
check(ima("object-src", "'none'"), "object-src 'none'");
check(ima("base-uri", "'self'"), "base-uri 'self'");
check(ima("form-action", "'self'"), "form-action 'self'");
check((direktive.get("default-src") ?? []).join(" ") === "'self'", "default-src je samo 'self'");

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
