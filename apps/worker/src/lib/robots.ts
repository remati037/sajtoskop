// apps/worker/src/lib/robots.ts
// Pravilo 12 iz CLAUDE.md: poštuj `robots.txt`, identifikujući User-Agent,
// max 1 zahtev/s po domenu.
//
// Zašto tek sada: do F2 je crawler bio CLI koji sam pokrećem i gledam. Od F3
// radi bez nadzora, sa fiksne Hetzner IP adrese, i obilazi stotine tuđih
// sajtova. Ista IP adresa koja ignoriše robots.txt završi na blacklistama i
// odnese sa sobom i Places ključ vezan za nju.
//
// Namerno mali parser: `Disallow`, `Allow`, `Crawl-delay`, grupe po
// `User-agent`. Bez `Sitemap`, bez wildcard `$` sufiksa preko onog što je
// potrebno. Sajtovi koje gledamo su zapušteni — njihov robots.txt je ili
// prazan, ili generisan iz WordPressa, ili ga nema.

import { setTimeout as sleep } from "node:timers/promises";

/** Token po kome nas sajt prepoznaje. Vodi na stranicu sa objašnjenjem u F8. */
export const CRAWLER_TOKEN = "Sajtoskop";

/** Minimalan razmak između dva zahteva ka ISTOM domenu. */
const MIN_DELAY_MS = 1000;

/** Koliko dugo se odluka za domen pamti u procesu. */
const TTL_MS = 30 * 60 * 1000;

const ROBOTS_TIMEOUT_MS = 5000;

type Rules = {
  /** Prefiksi putanja koje su zabranjene. Prazno = sve je dozvoljeno. */
  disallow: string[];
  /** Prefiksi koji nadjačavaju zabranu (duži prefiks pobeđuje). */
  allow: string[];
  /** `Crawl-delay` u milisekundama, ako ga sajt traži. */
  delayMs: number;
  fetchedAt: number;
};

const cache = new Map<string, Rules>();
const lastHit = new Map<string, number>();

/** Nema robots.txt, ili je nedostupan → sve je dozvoljeno, uz naš minimum. */
const PERMISSIVE: Omit<Rules, "fetchedAt"> = { disallow: [], allow: [], delayMs: MIN_DELAY_MS };

// ── parser ─────────────────────────────────────────────────

/**
 * Vraća pravila za našu grupu.
 *
 * Specifičnija grupa pobeđuje: ako postoji blok za `Sajtoskop`, `*` se ignoriše.
 * To je ponašanje koje standard propisuje i jedini razlog zbog kog ima smisla
 * imati prepoznatljiv token — sajt sme da nam da posebna pravila.
 */
export function parseRobots(text: string): Omit<Rules, "fetchedAt"> {
  const groups = new Map<string, { disallow: string[]; allow: string[]; delayMs: number }>();
  let current: string[] = [];
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Više uzastopnih `User-agent` linija dele isti blok pravila.
      if (!lastWasAgent) current = [];
      current.push(value.toLowerCase());
      for (const agent of current) {
        if (!groups.has(agent)) groups.set(agent, { disallow: [], allow: [], delayMs: 0 });
      }
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (current.length === 0) continue;

    for (const agent of current) {
      const g = groups.get(agent);
      if (!g) continue;

      if (field === "disallow" && value !== "") g.disallow.push(value);
      // `Disallow:` bez vrednosti znači „ništa nije zabranjeno" — namerno se ne upisuje.
      else if (field === "allow" && value !== "") g.allow.push(value);
      else if (field === "crawl-delay") {
        const s = Number(value.replace(",", "."));
        if (Number.isFinite(s) && s > 0) g.delayMs = Math.min(s * 1000, 30_000);
      }
    }
  }

  const mine = groups.get(CRAWLER_TOKEN.toLowerCase()) ?? groups.get("*");
  if (!mine) return PERMISSIVE;

  return {
    disallow: mine.disallow,
    allow: mine.allow,
    delayMs: Math.max(MIN_DELAY_MS, mine.delayMs),
  };
}

/** Da li pravila dozvoljavaju ovu putanju. Duži poklopljen prefiks pobeđuje. */
export function isPathAllowed(rules: Omit<Rules, "fetchedAt">, pathname: string): boolean {
  const match = (patterns: string[]): number => {
    let best = -1;
    for (const p of patterns) {
      // Jedini wildcard koji se u praksi sreće je `*` u sredini; svodimo ga na prefiks.
      const prefix = p.split("*")[0] ?? p;
      if (pathname.startsWith(prefix) && prefix.length > best) best = prefix.length;
    }
    return best;
  };

  const deny = match(rules.disallow);
  if (deny === -1) return true;
  return match(rules.allow) >= deny;
}

// ── mreža ──────────────────────────────────────────────────

async function loadRobots(origin: string, userAgent: string): Promise<Rules> {
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  let rules: Omit<Rules, "fetchedAt"> = PERMISSIVE;

  try {
    const res = await fetch(`${origin}/robots.txt`, {
      redirect: "follow",
      headers: { "User-Agent": userAgent, Accept: "text/plain" },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    });

    if (res.status === 200) {
      const text = (await res.text()).slice(0, 200_000);
      rules = parseRobots(text);
    } else if (res.status === 401 || res.status === 403) {
      // Zaključan robots.txt se po standardu tumači kao „ne diraj ništa".
      rules = { disallow: ["/"], allow: [], delayMs: MIN_DELAY_MS };
    }
    // 404 i 5xx → PERMISSIVE, kao da fajla nema.
  } catch {
    // Timeout ili mrtav domen. `fetchSite` će isti domen svejedno proglasiti
    // mrtvim, pa nema razloga da ga ovde blokiramo.
  }

  const withStamp: Rules = { ...rules, fetchedAt: Date.now() };
  cache.set(origin, withStamp);
  return withStamp;
}

/**
 * Sačekaj da prođe obavezni razmak od prethodnog zahteva ka istom domenu.
 * Zove se i kad je odgovor iz keša — pauza je prema tuđem serveru, ne prema nama.
 */
async function throttle(host: string, delayMs: number): Promise<void> {
  const last = lastHit.get(host) ?? 0;
  const wait = last + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

export type CrawlDecision = { allowed: boolean; reason: string | null };

/**
 * Jedina kapija ka tuđem sajtu iz workera.
 *
 * Proveri `robots.txt`, pa sačeka razmak za taj domen i tek onda vrati
 * `allowed: true`. Pozivalac odmah posle ovoga sme da uradi tačno JEDAN zahtev.
 */
export async function mayCrawl(url: string, userAgent: string): Promise<CrawlDecision> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { allowed: false, reason: "neispravan URL" };
  }

  const rules = await loadRobots(u.origin, userAgent);

  if (!isPathAllowed(rules, u.pathname)) {
    return { allowed: false, reason: "robots.txt zabranjuje ovu putanju" };
  }

  await throttle(u.hostname, rules.delayMs);
  return { allowed: true, reason: null };
}

/** Za testove — stanje živi u modulu koliko i proces. */
export function resetRobotsCache(): void {
  cache.clear();
  lastHit.clear();
}
