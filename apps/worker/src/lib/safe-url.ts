// apps/worker/src/lib/safe-url.ts
// SSRF kapija. Jedini put kojim URL sme da stigne do Playwrighta ili do lančanog
// fetch-a (bezbednost P0-6, F5 §2).
//
// U F5 URL-ovi dolaze iz Googlea pa je rizik nizak. Polje „unesi URL svog sajta
// za analizu" dolazi neizbežno i tada je ovo jedina stvar između korisničkog
// stringa i Chromiuma koji radi na istoj mašini kao Places ključ.
//
// ── odstupanje od PRD-a §2: allowlist umesto blocklista ────
// PRD nabraja `BLOCKED_RANGES` i pušta sve ostalo. Ta lista propušta osam
// opsega koje `ipaddr.js` imenuje posebno, a nijedan nije u njoj: `broadcast`
// (255.255.255.255), `multicast` (224/4), `ipv4Mapped` (`::ffff:127.0.0.1` —
// klasičan obilazak provere loopbacka), `6to4` (2002::/16), `teredo`
// (2001::/32), `rfc6052`, `rfc6145` i `discard` (100::/64). Prva tri se koriste
// u stvarnim SSRF pokušajima.
//
// Zato je uslov obrnut: prolazi samo `unicast`, sve ostalo pada. Opseg koji
// `ipaddr.js` doda sutra time je automatski zabranjen, a ne automatski dozvoljen.
//
// Node-only. Nikad u apps/web (pravilo 7).

import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { UA } from "./user-agent";

/** Max broj skokova kroz koje pratimo redirekciju. PRD §2. */
export const MAX_REDIRECTS = 3;

const HOP_TIMEOUT_MS = 10_000;

/**
 * Imena koja nikad ne puštamo do DNS-a. `.internal` hvata i
 * `metadata.google.internal`, `.home.arpa` je standardno ime kućne mreže.
 */
const LOCAL_HOST_RE =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.intranet|.*\.home\.arpa|.*\.lan)$/i;

// ── greška ─────────────────────────────────────────────────

export type UnsafeCode =
  | "invalid_url"
  | "bad_scheme"
  | "credentials_in_url"
  | "local_host"
  | "dns_failed"
  | "blocked_ip"
  | "too_many_redirects";

const MESSAGES: Record<UnsafeCode, string> = {
  invalid_url: "neispravan URL",
  bad_scheme: "dozvoljeni su samo http i https",
  credentials_in_url: "URL sadrži korisničko ime ili lozinku",
  local_host: "ime hosta pokazuje na lokalnu mrežu",
  dns_failed: "domen se ne razrešava",
  blocked_ip: "adresa je u zabranjenom opsegu",
  too_many_redirects: `više od ${MAX_REDIRECTS} redirekcija`,
};

/**
 * Zašto je pozivaocu bitna razlika:
 *
 * - `blocked` — URL pokušava da nas odvede tamo gde ne smemo. Posao se odbija,
 *   ništa se ne upisuje, razlog ide u `last_error`.
 * - `unreachable` — sa URL-om nije ništa sumnjivo, sajta prosto nema. To je
 *   `mrtav`, dakle najbolji mogući lead, i nikad nije razlog za pad posla.
 *
 * Bez ove podele svaki ugašen domen — a njih je u ovoj bazi 20-58% po niši —
 * izgleda kao SSRF pokušaj.
 */
export type UnsafeKind = "blocked" | "unreachable";

const KINDS: Record<UnsafeCode, UnsafeKind> = {
  // String koji `new URL()` ne razume nije pokušaj da nas negde odvede nego
  // pokvareno polje `website_url`. Ishod je `mrtav`, ne pao posao.
  invalid_url: "unreachable",
  bad_scheme: "blocked",
  credentials_in_url: "blocked",
  local_host: "blocked",
  blocked_ip: "blocked",
  // Domen se ne razrešava: ugašen sajt, ne napad.
  dns_failed: "unreachable",
  // Petlja u redirekcijama. Svaki hop je bio proveren i čist — sajt je pokvaren.
  too_many_redirects: "unreachable",
};

export class UnsafeUrlError extends Error {
  readonly code: UnsafeCode;
  readonly kind: UnsafeKind;
  /** URL na kom je provera pukla — kod lanca redirekcija to je hop, ne polazni URL. */
  readonly url: string;
  /** Opseg koji je `ipaddr.js` prijavio, samo za `blocked_ip`. */
  readonly range: string | null;

  constructor(code: UnsafeCode, url: string, range: string | null = null) {
    const detail = range ? `${MESSAGES[code]} (${range})` : MESSAGES[code];
    super(`${detail}: ${url}`);
    this.name = "UnsafeUrlError";
    this.code = code;
    this.kind = KINDS[code];
    this.url = url;
    this.range = range;
  }
}

// ── ubrizgavanje za testove ────────────────────────────────

export type LookupFn = (hostname: string) => Promise<readonly { address: string }[]>;
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type SafeUrlOptions = {
  /** Podrazumevano `dns.lookup` sa `all: true`. */
  lookup?: LookupFn;
  /** Podrazumevano globalni `fetch`. */
  fetchImpl?: FetchFn;
  maxRedirects?: number;
  timeoutMs?: number;
  userAgent?: string;
};

const defaultLookup: LookupFn = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

// ── provera oblika, bez mreže ──────────────────────────────

/**
 * `businesses.website_url` je normalizovan BEZ protokola — Google vraća
 * `autodavid.rs/kontakt`, ne `https://autodavid.rs/kontakt`. Bez ovoga svaki
 * takav red padne na „neispravan URL" još pre nego što se bilo šta proveri.
 *
 * URL koji već ima šemu se ne dira ni kad je šema loša: `file:///etc/passwd`
 * mora da stigne do `checkUrlShape` i da padne kao `bad_scheme`, a ne da se
 * pretvori u nešto neprepoznatljivo.
 */
export function toHttpUrl(raw: string): string {
  const t = raw.trim();
  if (t === "") return t;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  // Protokol-relativan `//primer.rs` se sreće u `<link>` tagovima.
  if (t.startsWith("//")) return `https:${t}`;
  return `https://${t}`;
}

/** `[::1]` → `::1`, `primer.rs.` → `primer.rs`, sve malim slovima. */
function hostnameOf(u: URL): string {
  let h = u.hostname.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

/**
 * Sve što se može zaključiti bez ijednog paketa na mreži.
 *
 * Zasebno je izvezeno jer `page.route` u Playwrightu pušta stotine podzahteva u
 * sekundi — sinhrona provera odbija očigledno loše pre nego što se uopšte uđe u
 * DNS. `resolveSafeUrl` je i dalje jedina potpuna provera.
 *
 * Obfuskovane IPv4 adrese (`http://0x7f000001/`, `http://2130706433/`) ne
 * proveravamo posebno: `new URL()` ih po WHATWG standardu normalizuje u
 * `127.0.0.1` još pre nego što ih vidimo.
 */
export function checkUrlShape(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid_url", raw);
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeUrlError("bad_scheme", raw);
  }
  if (u.username !== "" || u.password !== "") {
    throw new UnsafeUrlError("credentials_in_url", raw);
  }

  const host = hostnameOf(u);
  if (host === "") throw new UnsafeUrlError("invalid_url", raw);
  if (LOCAL_HOST_RE.test(host)) throw new UnsafeUrlError("local_host", raw);

  return u;
}

/**
 * Da li je IP adresa javna. Prolazi isključivo `unicast` — obrazloženje na vrhu
 * fajla. Neparsivna adresa pada, jer je „ne znam šta je ovo" u ovom kontekstu
 * isto što i „ne sme".
 */
export function classifyAddress(address: string): { allowed: boolean; range: string } {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(address);
  } catch {
    return { allowed: false, range: "unparsable" };
  }

  const range = addr.range();
  return { allowed: range === "unicast", range };
}

// ── provera sa DNS-om ──────────────────────────────────────

export type SafeUrl = {
  url: URL;
  /** Razrešena adresa. Nju koristi pozivalac, ne hostname — DNS rebinding. */
  ip: string;
};

/**
 * Puna provera jednog URL-a: oblik, pa razrešenje imena, pa opseg adrese.
 *
 * Razrešavaju se SVE adrese hosta, ne prva. Domen sa dva A zapisa — jedan javan,
 * jedan `10.0.0.5` — inače prolazi svaki drugi put, u zavisnosti od toga šta
 * resolver tog trenutka vrati prvo. Ako je ijedna adreza zabranjena, pada ceo host.
 */
export async function resolveSafeUrl(raw: string, opts: SafeUrlOptions = {}): Promise<SafeUrl> {
  const url = checkUrlShape(raw);
  const host = hostnameOf(url);

  // Host koji je već IP adresa ne ide u DNS. Zahtev iz F5 §6: `http://127.0.0.1:8080`
  // mora da bude odbijen pre DNS-a.
  if (ipaddr.isValid(host)) {
    const verdict = classifyAddress(host);
    if (!verdict.allowed) throw new UnsafeUrlError("blocked_ip", raw, verdict.range);
    return { url, ip: host };
  }

  const lookup = opts.lookup ?? defaultLookup;

  let addresses: readonly { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new UnsafeUrlError("dns_failed", raw);
  }

  if (addresses.length === 0) throw new UnsafeUrlError("dns_failed", raw);

  for (const { address } of addresses) {
    const verdict = classifyAddress(address);
    if (!verdict.allowed) throw new UnsafeUrlError("blocked_ip", raw, verdict.range);
  }

  return { url, ip: addresses[0]!.address };
}

// ── lanac redirekcija ──────────────────────────────────────

export type SafeTarget = SafeUrl & {
  /** Svi URL-ovi kroz koje se prošlo, uključujući polazni i konačni. */
  hops: string[];
  /** HTTP status poslednjeg odgovora. `null` ako hop nije uspeo da se otvori. */
  httpStatus: number | null;
};

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Prati redirekcije ručno i provuče SVAKI hop kroz `resolveSafeUrl`.
 *
 * Ovo je razlog zbog kog `redirect: "follow"` ovde ne postoji: sajt vrati `302`
 * na `http://169.254.169.254/`, `fetch` ga posluša, i Hetznerov metadata
 * endpoint je otvoren. Ugrađeno praćenje redirekcija ne zna za našu proveru.
 *
 * Telo se nikad ne čita — zanima nas samo `Location`. Cena je jedan dodatan
 * zahtev po hopu ka tuđem serveru, pre nego što Playwright otvori isti URL.
 *
 * Mrežna greška NIJE SSRF greška: vraćamo poslednji proveren cilj i puštamo
 * Playwright da pokuša. Sajt koji nama ne odgovara često odgovori pregledaču,
 * a i kad ne odgovori — to je `mrtav`, dakle dobar lead, ne greška.
 */
export async function followSafely(raw: string, opts: SafeUrlOptions = {}): Promise<SafeTarget> {
  const doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? HOP_TIMEOUT_MS;
  const userAgent = opts.userAgent ?? UA;

  const hops: string[] = [];
  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safe = await resolveSafeUrl(current, opts);
    hops.push(safe.url.href);

    let res: Response;
    try {
      res = await doFetch(safe.url.href, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "sr-RS,sr;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ...safe, hops, httpStatus: null };
    }

    // Telo nam ne treba ni u jednom slučaju; bez ovoga veza visi do GC-a.
    await res.body?.cancel().catch(() => {});

    const location = res.headers.get("location");
    if (!REDIRECT_CODES.has(res.status) || !location) {
      return { ...safe, hops, httpStatus: res.status };
    }

    // Relativan `Location` je čest i sasvim legitiman.
    let next: string;
    try {
      next = new URL(location, safe.url).href;
    } catch {
      throw new UnsafeUrlError("invalid_url", location);
    }

    current = next;
  }

  throw new UnsafeUrlError("too_many_redirects", hops[hops.length - 1] ?? raw);
}
