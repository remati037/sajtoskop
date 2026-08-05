// src/fetch-site.ts
// Preuzimanje HTML-a sa nepoznatih sajtova. Ništa ne analizira — samo donosi.

import pLimit from "p-limit";
import type { Business } from "./shared/types.ts";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;      // 2MB, dovoljno za svaki legitiman HTML
const CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 Sajtoskop/0.1";
const UA_PLAIN = UA.replace(" Sajtoskop/0.1", "");

const SOCIAL_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "linktr.ee",
  "linkedin.com", "tiktok.com", "youtube.com", "x.com", "twitter.com",
  "wa.me", "beacons.ai", "carrd.co",
];

/** Greške posle kojih ima smisla probati http:// umesto https:// */
const TLS_FAILURES = ["SSL", "sertifikat", "veza prekinuta", "server odbija vezu"];

export type SiteStatus = "NEMA_SAJT" | "SAMO_DRUSTVENE" | "MRTAV" | "ZIV";

export type SiteFetch = {
  status: SiteStatus;
  url: string | null;
  finalUrl: string | null;
  httpStatus: number | null;
  httpsOk: boolean;
  loadMs: number | null;
  html: string | null;
  error: string | null;
};

// ── pomoćne ────────────────────────────────────────────────

function isSocial(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}

function empty(status: SiteStatus, url: string | null, error: string | null = null): SiteFetch {
  return {
    status, url, finalUrl: null, httpStatus: null,
    httpsOk: false, loadMs: null, html: null, error,
  };
}

/** Node umotava pravi uzrok u err.cause — bez ovoga je svaka greška "fetch failed". */
function describeFailure(err: unknown): string {
  const codes: string[] = [];
  let cur: unknown = err;

  for (let i = 0; i < 5 && cur instanceof Error; i++) {
    const code = (cur as Error & { code?: string }).code;
    if (code) codes.push(code);
    cur = (cur as Error & { cause?: unknown }).cause;
  }

  const code = codes[0] ?? "";
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("timeout") || msg.includes("aborted") || code === "UND_ERR_CONNECT_TIMEOUT")
    return "timeout 15s";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "domen ne postoji";
  if (code === "ECONNREFUSED") return "server odbija vezu";
  if (code === "ECONNRESET") return "veza prekinuta";
  if (code === "CERT_HAS_EXPIRED") return "istekao SSL sertifikat";
  if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN")
    return "self-signed sertifikat";
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return "sertifikat na pogrešan domen";
  if (code.startsWith("ERR_SSL") || code.startsWith("ERR_TLS")) return `SSL greška (${code})`;

  return codes.length ? codes.join(" → ") : msg.slice(0, 120);
}

async function doFetch(href: string, ua: string = UA): Promise<Response> {
  return await fetch(href, {
    redirect: "follow",
    headers: {
      "User-Agent": ua,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "sr-RS,sr;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Čita telo uz tvrdo ograničenje veličine — ne uvlači 40MB u memoriju. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const capped = Math.min(total, MAX_BYTES);
  const buf = new Uint8Array(capped);
  let offset = 0;
  for (const c of chunks) {
    if (offset >= capped) break;
    const take = Math.min(c.length, capped - offset);
    buf.set(c.subarray(0, take), offset);
    offset += take;
  }

  // Većina zapuštenih srpskih sajtova je UTF-8; windows-1250 rešavamo ako se pojavi
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// ── glavna ─────────────────────────────────────────────────

export async function fetchSite(rawUrl: string | null): Promise<SiteFetch> {
  if (!rawUrl) return empty("NEMA_SAJT", null);

  // Business.website je normalizovan (bez protokola), pa ga vraćamo u pun URL
  const candidate = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return empty("MRTAV", rawUrl, "neispravan URL");
  }

  if (isSocial(u.hostname)) {
    return { ...empty("SAMO_DRUSTVENE", rawUrl), finalUrl: u.href };
  }

  const started = Date.now();
  let res: Response;

  // 1) prvi pokušaj, uz fallback na http:// ako TLS pukne
  try {
    res = await doFetch(u.href);
  } catch (err: unknown) {
    const reason = describeFailure(err);

    if (u.protocol === "https:" && TLS_FAILURES.some((t) => reason.includes(t))) {
      try {
        const plain = new URL(u.href);
        plain.protocol = "http:";
        res = await doFetch(plain.href);
      } catch {
        return { ...empty("MRTAV", rawUrl, reason), loadMs: Date.now() - started };
      }
    } else {
      return { ...empty("MRTAV", rawUrl, reason), loadMs: Date.now() - started };
    }
  }

  // 2) neki WAF-ovi odbijaju nepoznat token u User-Agentu
  if (res.status === 403 || res.status === 406) {
    try {
      res = await doFetch(u.href, UA_PLAIN);
    } catch {
      // ostavljamo prvi odgovor, obradiće ga provera ispod
    }
  }

  const finalUrl = res.url || u.href;

  let finalHost: string;
  try {
    finalHost = new URL(finalUrl).hostname;
  } catch {
    finalHost = u.hostname;
  }

  // 3) sajt koji preusmerava na Facebook NIJE mrtav — to je vredan lead
  if (isSocial(finalHost)) {
    return {
      ...empty("SAMO_DRUSTVENE", rawUrl),
      finalUrl,
      httpStatus: res.status,
      loadMs: Date.now() - started,
    };
  }

  if (!res.ok) {
    return {
      ...empty("MRTAV", rawUrl, `HTTP ${res.status}`),
      finalUrl,
      httpStatus: res.status,
      loadMs: Date.now() - started,
    };
  }

  let html: string;
  try {
    html = await readCapped(res);
  } catch (err: unknown) {
    return {
      ...empty("MRTAV", rawUrl, `prekinuto čitanje: ${describeFailure(err)}`),
      finalUrl,
      httpStatus: res.status,
      loadMs: Date.now() - started,
    };
  }

  return {
    status: "ZIV",
    url: rawUrl,
    finalUrl,
    httpStatus: res.status,
    httpsOk: finalUrl.startsWith("https://"),
    loadMs: Date.now() - started,
    html,
    error: null,
  };
}

/** Preuzima sve sajtove iz liste, max 3 paralelno. */
export async function fetchAll(
  businesses: Business[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, SiteFetch>> {
  const limit = pLimit(CONCURRENCY);
  const out = new Map<string, SiteFetch>();
  let done = 0;

  await Promise.all(
    businesses.map((b) =>
      limit(async () => {
        const result = await fetchSite(b.website);
        out.set(b.placeId, result);
        done++;
        onProgress?.(done, businesses.length);
      }),
    ),
  );

  return out;
}