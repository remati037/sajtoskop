// apps/worker/test/safe-url.ts
// Pokretanje: pnpm --filter @sajtoskop/worker test  (ili `pnpm test` iz korena)
//
// Izuzetak od „testovi samo za ugly-score i spend_credit_and_unlock"
// (00-kontekst §7), iz istog razloga kao `robots.ts`: greška ovde ne pravi
// pogrešan podatak nego otvara Hetznerov metadata endpoint procesu koji
// dobrovoljno otvara stotine nepoznatih sajtova.
//
// Bez ijednog pravog DNS upita i bez ijednog pravog paketa — `lookup` i `fetch`
// se ubrizgavaju. Test koji zavisi od tuđe mreže nije test SSRF zaštite.

import {
  classifyAddress,
  followSafely,
  resolveSafeUrl,
  UnsafeUrlError,
  type FetchFn,
  type LookupFn,
  type UnsafeCode,
  type UnsafeKind,
} from "../src/lib/safe-url";

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

/** Očekuj da poziv padne sa tačno ovim kodom. Prolaz je takođe pad testa. */
async function expectCode(code: UnsafeCode, label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(false, `${label} — PROŠLO, a moralo je da padne sa ${code}`);
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      check(err.code === code, `${label} → ${err.code}${err.range ? ` (${err.range})` : ""}`);
    } else {
      check(false, `${label} — pala pogrešna greška: ${String(err)}`);
    }
  }
}

/** Ista provera, plus podela na „napad" i „sajta nema". */
async function expectKind(
  code: UnsafeCode,
  kind: UnsafeKind,
  label: string,
  fn: () => Promise<unknown>,
) {
  try {
    await fn();
    check(false, `${label} — PROŠLO, a moralo je da padne sa ${code}`);
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      check(
        err.code === code && err.kind === kind,
        `${label} → ${err.code} / ${err.kind} (očekivano ${code} / ${kind})`,
      );
    } else {
      check(false, `${label} — pala pogrešna greška: ${String(err)}`);
    }
  }
}

// ── lažni DNS ──────────────────────────────────────────────

const ZONE: Record<string, string[]> = {
  "primer.rs": ["93.184.216.34"],
  "javni.rs": ["93.184.216.34"],
  "a.rs": ["93.184.216.34"],
  "b.rs": ["93.184.216.35"],
  "c.rs": ["93.184.216.36"],
  "d.rs": ["93.184.216.37"],
  "e.rs": ["93.184.216.38"],
  // Klasika: domen koji se razrešava u loopback. Ime je javno, adresa nije.
  "rebind.rs": ["127.0.0.1"],
  // Cloud metadata sakriven iza pitomog imena.
  "metadata.primer.rs": ["169.254.169.254"],
  // Dva A zapisa, jedan javan i jedan iz interne mreže.
  "dvolicni.rs": ["93.184.216.34", "10.0.0.5"],
  "ipv6.rs": ["2606:2800:220:1:248:1893:25c8:1946"],
};

let lookups: string[] = [];

const lookup: LookupFn = async (hostname) => {
  lookups.push(hostname);
  const found = ZONE[hostname];
  if (!found) throw new Error(`ENOTFOUND ${hostname}`);
  return found.map((address) => ({ address }));
};

// ── lažna mreža ────────────────────────────────────────────

/** URL → 302 na ovo. Sve što nije ovde vraća 200. */
let redirects: Record<string, string> = {};
let requested: string[] = [];

const fetchImpl: FetchFn = async (url) => {
  requested.push(url);
  const to = redirects[url];
  if (to) return new Response(null, { status: 302, headers: { location: to } });
  return new Response(null, { status: 200 });
};

const opts = { lookup, fetchImpl };

// ═══════════════════════════════════════════════════════════
// 1. Oblik URL-a — pada bez ijednog mrežnog poziva
// ═══════════════════════════════════════════════════════════

console.log("\n— oblik URL-a —");

await expectCode("invalid_url", "prazan string", () => resolveSafeUrl("", opts));
await expectCode("bad_scheme", "file:///etc/passwd", () =>
  resolveSafeUrl("file:///etc/passwd", opts),
);
await expectCode("bad_scheme", "gopher://primer.rs/", () =>
  resolveSafeUrl("gopher://primer.rs/", opts),
);
await expectCode("bad_scheme", "javascript: URL", () =>
  resolveSafeUrl("javascript:alert(1)", opts),
);

// ── kredencijali u URL-u ───────────────────────────────────
await expectCode("credentials_in_url", "https://korisnik:lozinka@primer.rs/", () =>
  resolveSafeUrl("https://korisnik:lozinka@primer.rs/", opts),
);
await expectCode("credentials_in_url", "https://korisnik@primer.rs/ (samo ime)", () =>
  resolveSafeUrl("https://korisnik@primer.rs/", opts),
);
await expectCode(
  "credentials_in_url",
  "https://169.254.169.254@primer.rs/ (ime liči na host)",
  () => resolveSafeUrl("https://169.254.169.254@primer.rs/", opts),
);

// ── lokalna imena ──────────────────────────────────────────
await expectCode("local_host", "http://localhost/", () => resolveSafeUrl("http://localhost/", opts));
await expectCode("local_host", "http://server.local/", () =>
  resolveSafeUrl("http://server.local/", opts),
);
await expectCode("local_host", "http://metadata.google.internal/", () =>
  resolveSafeUrl("http://metadata.google.internal/", opts),
);
await expectCode("local_host", "http://localhost./ (sa tačkom na kraju)", () =>
  resolveSafeUrl("http://localhost./", opts),
);
await expectCode("local_host", "http://LOCALHOST:3000/ (velika slova)", () =>
  resolveSafeUrl("http://LOCALHOST:3000/", opts),
);

// ═══════════════════════════════════════════════════════════
// 2. Loopback — mora da padne PRE DNS-a (F5 §6)
// ═══════════════════════════════════════════════════════════

console.log("\n— loopback —");

lookups = [];
await expectCode("blocked_ip", "http://127.0.0.1:8080/", () =>
  resolveSafeUrl("http://127.0.0.1:8080/", opts),
);
check(lookups.length === 0, "127.0.0.1 odbijen bez ijednog DNS upita");

await expectCode("blocked_ip", "http://127.255.255.254/ (ceo 127/8)", () =>
  resolveSafeUrl("http://127.255.255.254/", opts),
);
await expectCode("blocked_ip", "http://[::1]/", () => resolveSafeUrl("http://[::1]/", opts));
await expectCode("blocked_ip", "http://[::ffff:127.0.0.1]/ (IPv4-mapped obilaznica)", () =>
  resolveSafeUrl("http://[::ffff:127.0.0.1]/", opts),
);
await expectCode("blocked_ip", "http://2130706433/ (decimalni 127.0.0.1)", () =>
  resolveSafeUrl("http://2130706433/", opts),
);
await expectCode("blocked_ip", "http://0x7f000001/ (heksadecimalni 127.0.0.1)", () =>
  resolveSafeUrl("http://0x7f000001/", opts),
);

// ═══════════════════════════════════════════════════════════
// 3. Privatni i ostali zabranjeni opsezi
// ═══════════════════════════════════════════════════════════

console.log("\n— privatni opsezi —");

for (const ip of ["10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
  await expectCode("blocked_ip", `http://${ip}/`, () => resolveSafeUrl(`http://${ip}/`, opts));
}

await expectCode("blocked_ip", "http://100.64.0.1/ (carrier-grade NAT)", () =>
  resolveSafeUrl("http://100.64.0.1/", opts),
);
await expectCode("blocked_ip", "http://0.0.0.0/", () => resolveSafeUrl("http://0.0.0.0/", opts));
await expectCode("blocked_ip", "http://255.255.255.255/ (broadcast)", () =>
  resolveSafeUrl("http://255.255.255.255/", opts),
);
await expectCode("blocked_ip", "http://224.0.0.1/ (multicast)", () =>
  resolveSafeUrl("http://224.0.0.1/", opts),
);
await expectCode("blocked_ip", "http://[fd00::1]/ (unique local IPv6)", () =>
  resolveSafeUrl("http://[fd00::1]/", opts),
);
await expectCode("blocked_ip", "http://[fe80::1]/ (link-local IPv6)", () =>
  resolveSafeUrl("http://[fe80::1]/", opts),
);

await expectCode("blocked_ip", "http://192.88.99.1/ (6to4 relay anycast)", () =>
  resolveSafeUrl("http://192.88.99.1/", opts),
);
await expectCode("blocked_ip", "http://198.18.0.1/ (benchmarking)", () =>
  resolveSafeUrl("http://198.18.0.1/", opts),
);

// Opsezi koje blocklist iz PRD-a NE nabraja — hvata ih samo allowlist.
// (`broadcast`, `multicast` i `ipv4Mapped` su gore, uz svoje kategorije.)
await expectCode("blocked_ip", "http://[2002::1]/ (6to4, nije u PRD listi)", () =>
  resolveSafeUrl("http://[2002::1]/", opts),
);
await expectCode("blocked_ip", "http://[2001:0::1]/ (teredo, nije u PRD listi)", () =>
  resolveSafeUrl("http://[2001:0::1]/", opts),
);
await expectCode("blocked_ip", "http://[64:ff9b::1.2.3.4]/ (rfc6052, nije u PRD listi)", () =>
  resolveSafeUrl("http://[64:ff9b::1.2.3.4]/", opts),
);
await expectCode("blocked_ip", "http://[100::1]/ (discard, nije u PRD listi)", () =>
  resolveSafeUrl("http://[100::1]/", opts),
);

// ═══════════════════════════════════════════════════════════
// 4. 169.254.169.254 — cloud metadata
// ═══════════════════════════════════════════════════════════

console.log("\n— 169.254.169.254 —");

await expectCode("blocked_ip", "http://169.254.169.254/ direktno", () =>
  resolveSafeUrl("http://169.254.169.254/", opts),
);
await expectCode(
  "blocked_ip",
  "http://169.254.169.254/latest/meta-data/ (AWS putanja)",
  () => resolveSafeUrl("http://169.254.169.254/latest/meta-data/", opts),
);
await expectCode("blocked_ip", "https://metadata.primer.rs/ (ime → 169.254.169.254)", () =>
  resolveSafeUrl("https://metadata.primer.rs/", opts),
);

check(
  classifyAddress("169.254.169.254").range === "linkLocal",
  "169.254.169.254 je klasifikovan kao linkLocal",
);

// ═══════════════════════════════════════════════════════════
// 5. DNS
// ═══════════════════════════════════════════════════════════

console.log("\n— DNS —");

await expectCode("dns_failed", "https://nepostojeci.rs/", () =>
  resolveSafeUrl("https://nepostojeci.rs/", opts),
);

await expectCode("blocked_ip", "https://rebind.rs/ (javno ime → 127.0.0.1)", () =>
  resolveSafeUrl("https://rebind.rs/", opts),
);

await expectCode(
  "blocked_ip",
  "https://dvolicni.rs/ (dva A zapisa, drugi je 10.0.0.5)",
  () => resolveSafeUrl("https://dvolicni.rs/", opts),
);

const ok = await resolveSafeUrl("https://primer.rs/kontakt", opts);
check(ok.ip === "93.184.216.34", `javni domen prolazi, IP prikucan na ${ok.ip}`);
check(ok.url.href === "https://primer.rs/kontakt", "URL se vraća nepromenjen");

const okV6 = await resolveSafeUrl("https://ipv6.rs/", opts);
check(okV6.ip.startsWith("2606:"), "javni IPv6 prolazi");

// ═══════════════════════════════════════════════════════════
// 6. Lanac redirekcija — svaki hop kroz istu proveru
// ═══════════════════════════════════════════════════════════

console.log("\n— redirekcije —");

// Bez redirekcija: jedan hop, status 200.
redirects = {};
requested = [];
let target = await followSafely("https://primer.rs/", opts);
check(target.hops.length === 1 && target.httpStatus === 200, "bez redirekcije → jedan hop, 200");

// Treći hop vodi na privatnu adresu. Ovo je scenario iz PRD-a §2.
redirects = {
  "https://a.rs/": "https://b.rs/x",
  "https://b.rs/x": "https://c.rs/y",
  "https://c.rs/y": "http://10.1.2.3/interno",
};
requested = [];
await expectCode("blocked_ip", "a.rs → b.rs → c.rs → 10.1.2.3 (treći hop)", () =>
  followSafely("https://a.rs/", opts),
);
check(
  requested.length === 3 && requested[2] === "https://c.rs/y",
  `lanac je stao na trećem hopu, bez zahteva ka privatnoj adresi (${requested.length} zahteva)`,
);

// Isto, ali cilj je metadata endpoint.
redirects = {
  "https://a.rs/": "https://b.rs/x",
  "https://b.rs/x": "http://169.254.169.254/latest/meta-data/",
};
requested = [];
await expectCode("blocked_ip", "a.rs → b.rs → 169.254.169.254", () =>
  followSafely("https://a.rs/", opts),
);
check(
  !requested.some((u) => u.includes("169.254")),
  "nijedan zahtev nije poslat ka metadata endpointu",
);

// Redirekcija na loopback preko imena — rebinding kroz Location.
redirects = { "https://a.rs/": "https://rebind.rs/" };
requested = [];
await expectCode("blocked_ip", "a.rs → rebind.rs (ime → 127.0.0.1)", () =>
  followSafely("https://a.rs/", opts),
);

// Relativan Location mora da se razreši u odnosu na tekući hop.
redirects = { "https://a.rs/staro": "/novo", "https://a.rs/novo": "" };
requested = [];
target = await followSafely("https://a.rs/staro", opts);
check(
  target.url.href === "https://a.rs/novo",
  `relativan Location razrešen u ${target.url.href}`,
);

// Tri redirekcije prolaze, četvrta pada.
redirects = {
  "https://a.rs/": "https://b.rs/",
  "https://b.rs/": "https://c.rs/",
  "https://c.rs/": "https://d.rs/",
};
target = await followSafely("https://a.rs/", opts);
check(
  target.hops.length === 4 && target.url.href === "https://d.rs/",
  `tri redirekcije prolaze (${target.hops.length} hopa)`,
);

redirects = {
  "https://a.rs/": "https://b.rs/",
  "https://b.rs/": "https://c.rs/",
  "https://c.rs/": "https://d.rs/",
  "https://d.rs/": "https://e.rs/",
};
await expectCode("too_many_redirects", "četvrta redirekcija pada", () =>
  followSafely("https://a.rs/", opts),
);

// Mrežna greška nije SSRF greška — vraćamo poslednji proveren cilj.
redirects = {};
const brokenFetch: FetchFn = async () => {
  throw new Error("ECONNREFUSED");
};
target = await followSafely("https://primer.rs/", { lookup, fetchImpl: brokenFetch });
check(
  target.httpStatus === null && target.url.href === "https://primer.rs/",
  "mrtav sajt vraća proveren cilj sa httpStatus === null",
);

// 4xx nije redirekcija — lanac se završava, Playwright slika stranicu greške.
const notFound: FetchFn = async () => new Response(null, { status: 404 });
target = await followSafely("https://primer.rs/", { lookup, fetchImpl: notFound });
check(target.httpStatus === 404, "404 se vraća kao konačan cilj, ne kao greška");

// ═══════════════════════════════════════════════════════════
// 7. Napad ili mrtav sajt — od ovoga zavisi da li posao pada
// ═══════════════════════════════════════════════════════════
//
// `enrich_full` na `kind === "blocked"` odbija posao i ne upisuje ništa, a na
// `kind === "unreachable"` upisuje `site_status = 'mrtav'`. Zamena ta dva znači
// ili crven red poslova za svaki ugašen domen (a njih je 20-58% po niši), ili —
// gore — tiho upisan „mrtav" za URL koji je vodio na metadata endpoint.

console.log("\n— napad vs. mrtav sajt —");

await expectKind("blocked_ip", "blocked", "169.254.169.254 je napad", () =>
  resolveSafeUrl("http://169.254.169.254/", opts),
);
await expectKind("local_host", "blocked", "localhost je napad", () =>
  resolveSafeUrl("http://localhost/", opts),
);
await expectKind("credentials_in_url", "blocked", "kredencijali su napad", () =>
  resolveSafeUrl("https://a:b@primer.rs/", opts),
);
await expectKind("dns_failed", "unreachable", "ugašen domen je mrtav sajt", () =>
  resolveSafeUrl("https://nepostojeci.rs/", opts),
);

redirects = {
  "https://a.rs/": "https://b.rs/",
  "https://b.rs/": "https://c.rs/",
  "https://c.rs/": "https://d.rs/",
  "https://d.rs/": "https://e.rs/",
};
await expectKind("too_many_redirects", "unreachable", "petlja u redirekcijama je mrtav sajt", () =>
  followSafely("https://a.rs/", opts),
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
