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
//   1. Checkout overlay nekadašnjeg provajdera je ostajao PRAZAN jer je
//      `frame-src` padao na `default-src 'self'` — bez ijedne greške.
//   2. Registracija je padala na „neuspelo sigurnosno proveravanje" jer
//      `challenges.cloudflare.com` (Clerk bot-zaštita, Cloudflare Turnstile)
//      nije bio ni u `script-src` ni u `frame-src`. Poruka zvuči kao da je
//      server odbio nalog, a u stvari se widget nikad nije učitao.
//
// Test NE grepuje izvor nego zove `nextConfig.headers()` i parsira vrednost —
// dakle proverava ono što pregledač stvarno dobije, uključujući hostove koji se
// sklapaju iz publishable ključa u trenutku izvršavanja.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

// ── Supabase: origin iz env-a, ne wildcard ─────────────────
// Do lokalne baze (docs/LOKALNA-BAZA.md §11.1) je stajao zakucan
// `https://*.supabase.co`: lokalni `http://127.0.0.1:54321` je pregledač tiho
// odbijao, a na produkciji je wildcard dozvoljavao svaki tuđi projekat.
console.log("\nSupabase");

const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
for (const d of ["img-src", "connect-src"]) {
  check(ima(d, supabaseOrigin), `${d} nosi ${supabaseOrigin} (iz NEXT_PUBLIC_SUPABASE_URL)`);
}
check(!csp.includes("*.supabase.co"), "nijedna direktiva ne nosi *.supabase.co wildcard");

// Bez env-a (ili sa neispravnim) sastavljanje CSP-a mora da padne sa porukom
// koja imenuje promenljivu — nikad tihi fallback. Zasebni proces, jer se
// `next.config` evaluira jednom po procesu. Prazan string, a ne `undefined`:
// `loadRootEnv()` bi inače dopunio vrednost iz korenskog `.env`-a.
const konfig = fileURLToPath(new URL("../next.config.ts", import.meta.url));
for (const [opis, vrednost] of [
  ["prazan", ""],
  ["nije URL", "nije-url"],
  ["nije http(s)", "ftp://127.0.0.1:54321"],
] as const) {
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(konfig)})`], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: vrednost },
    encoding: "utf8",
  });
  check(
    r.status !== 0 && r.stderr.includes("NEXT_PUBLIC_SUPABASE_URL"),
    `NEXT_PUBLIC_SUPABASE_URL ${opis} → config pada sa porukom koja imenuje promenljivu`,
  );
}

// ── naplata (S25): Stripe je redirekcija, CSP ga ne dodiruje ─
// Hosted Checkout i Portal žive na Stripe-ovom domenu; naš dokument ne učitava
// ništa njihovo. Host prethodnog provajdera ne sme da se vrati ni u jednu
// direktivu — to bi bilo poverenje ka dobavljaču koga više nema.
console.log("\nnaplata");

// Svaki host mora da bude iz poznatog skupa (Clerk, Supabase origin iz env-a,
// Cloudflare Turnstile) ili ključna reč CSP-a — bilo šta drugo je tuđ domen koji se
// vratio kroz zaboravljen import ili stari deploy.
const POZNAT = /^'[^']*'$|^(data|blob):$|clerk|cloudflare/;
for (const [d, izvori] of direktive) {
  const tudji = izvori.filter((s) => !POZNAT.test(s) && s !== supabaseOrigin);
  check(tudji.length === 0, `${d} nosi samo poznate hostove${tudji.length ? ` (tuđi: ${tudji.join(" ")})` : ""}`);
}
check(!csp.includes("stripe"), "CSP ne nosi nijedan Stripe host — checkout je redirekcija");

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
