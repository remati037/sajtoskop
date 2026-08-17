// apps/worker/src/lib/places.ts
// Google Places API (New) — Text Search klijent. Živi u workeru jer je jedini
// koji priča sa Googleom; web ga ne vidi.

import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Business } from "@sajtoskop/shared";
import { cirToLat, phoneType } from "@sajtoskop/shared";
import {
  assertAvailable,
  BudgetError,
  consume,
  markExhausted,
  nextDayReset,
} from "./api-budget";

// ── Googleov žični oblik ───────────────────────────────────
// Namerno NIJE u @sajtoskop/shared: to je Googleov format odgovora, a ne naš
// model podataka. Naš normalizovan oblik je `Business`.

/** Sirovi oblik koji vraća Places API — samo polja iz naše field maske. */
export type RawPlace = {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
};

export type PlacesResponse = {
  places?: RawPlace[];
  nextPageToken?: string;
};

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "nextPageToken",
].join(",");

const PAGE_SIZE = 20;      // maksimum koji API dozvoljava
const MAX_PAGES = 3;       // 3 × 20 = 60, tvrda granica Text Searcha
const PAGE_DELAY_MS = 2000;

export type SearchOptions = {
  maxResults?: number;
  languageCode?: string;
  mock?: boolean;
  mockFile?: string;
};

// ── normalizacija ──────────────────────────────────────────

/** Za deduplikaciju i kasnije poređenje: bez protokola, bez www, bez / na kraju. */
function normalizeWebsite(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = u.pathname.replace(/\/+$/, "");
    return host + pathname;
  } catch {
    return null;
  }
}

function toBusiness(p: RawPlace): Business {
  const phone = p.nationalPhoneNumber?.trim() || null;
  return {
    placeId: p.id,
    name: cirToLat(p.displayName?.text ?? "(bez naziva)"),
    address: cirToLat(p.formattedAddress ?? ""),
    phone,
    phoneKind: phone ? phoneType(phone) : null,
    website: normalizeWebsite(p.websiteUri),
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
  };
}

// ── mrežni sloj ────────────────────────────────────────────

function explainError(status: number, body: string): string {
  const hint =
    status === 400 ? "najverovatnije field maska ili neispravan pageToken"
    : status === 403 ? "restrikcija ključa ili API nije uključen u projektu"
    : status >= 500 ? "greška na Googleovoj strani, probaj ponovo za minut"
    : "nepoznat uzrok";
  return `Places API ${status} — ${hint}\n${body.slice(0, 500)}`;
}

/**
 * Koliko će stranica ovaj scan realno povući.
 * Koristi se za pre-flight proveru budžeta, da scan ne pukne na pola.
 */
function pagesNeeded(maxResults: number): number {
  return Math.min(MAX_PAGES, Math.max(1, Math.ceil(maxResults / PAGE_SIZE)));
}

async function fetchPage(
  textQuery: string,
  languageCode: string,
  pageToken?: string,
): Promise<PlacesResponse> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY nije postavljen u .env");

  // VAŽNO: kod paginacije svi parametri osim pageToken/pageSize
  // moraju biti identični prvom zahtevu, inače INVALID_ARGUMENT.
  const body: Record<string, unknown> = {
    textQuery,
    languageCode,
    regionCode: "RS",
    pageSize: PAGE_SIZE,
  };
  if (pageToken) body["pageToken"] = pageToken;

  // Rezerviši poziv PRE fetcha. Neuspeli pozivi se takođe broje u Googleovu
  // kvotu, a ako proces pukne posle fetcha, poziv je plaćen — bolje ga
  // izbrojati unapred nego ga izgubiti iz evidencije.
  //
  // Od F3 je ovo upis u bazu, ne u fajl: jedan atomičan inkrement koji vide i
  // worker i CLI. Ako baza nije dostupna, ovo baca i fetch se ne dogodi.
  await consume("places:searchText");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 429) {
    // Google je rekao da je kvota gotova. Zaključaj dan da sledeći scan
    // ne troši vreme na pozive koji sigurno padaju.
    const state = await markExhausted();
    // [Faza 0, 0.1] `retryAfter` = ponoć sledećeg LA dana. Bez njega worker
    // ne zna kad da pokuša ponovo i scan izgubi sva tri pokušaja (K1).
    throw new BudgetError(
      "Places API 429 RESOURCE_EXHAUSTED — Googleova kvota je potrošena. " +
        "Reset je u 09:00 po lokalnom vremenu.",
      state,
      "exhausted",
      nextDayReset(),
    );
  }

  if (!res.ok) {
    throw new Error(explainError(res.status, await res.text()));
  }

  return (await res.json()) as PlacesResponse;
}

/** Fixture se razrešava u odnosu na ovaj modul, ne na cwd — da `--mock` daje
 *  isti izlaz bez obzira odakle je pokrenut (root, apps/cli, apps/worker). */
const DEFAULT_MOCK_FILE = fileURLToPath(
  new URL("../fixtures/text-search-nis-stomatolog.json", import.meta.url),
);

function loadMock(file: string): PlacesResponse {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) throw new Error(`Fixture ne postoji: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as PlacesResponse;
}

// ── javni API ──────────────────────────────────────────────

export async function searchText(
  textQuery: string,
  opts: SearchOptions = {},
): Promise<{ businesses: Business[]; apiCalls: number; partial?: boolean }> {
  const maxResults = opts.maxResults ?? 30;
  const languageCode = opts.languageCode ?? "sr-Latn";

  if (opts.mock) {
    const data = loadMock(opts.mockFile ?? DEFAULT_MOCK_FILE);
    const raw = data.places ?? [];
    return { businesses: raw.slice(0, maxResults).map(toBusiness), apiCalls: 0 };
  }

  // Pre-flight: proveri budžet za CEO scan pre prvog poziva.
  // Bolje pući odmah nego posle prve stranice sa 20 nepotpuno prikupljenih firmi.
  await assertAvailable(pagesNeeded(maxResults), `scan "${textQuery}" (${maxResults} rez.)`);

  const seen = new Set<string>();
  const out: Business[] = [];
  let apiCalls = 0;
  let partial = false;
  let token: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAGE_DELAY_MS);

    let data: PlacesResponse;
    try {
      data = await fetchPage(textQuery, languageCode, token);
    } catch (err) {
      // Ako je budžet pukao usred scana, a nešto smo već prikupili —
      // vrati to umesto da baciš sve. Prva stranica bez rezultata je i dalje greška.
      if (err instanceof BudgetError && out.length > 0) {
        console.warn(`\n  ⚠ ${err.message}`);
        console.warn(`  ⚠ Vraćam ${out.length} rezultata prikupljenih do sada.\n`);
        partial = true;
        break;
      }
      throw err;
    }

    apiCalls++;

    for (const p of data.places ?? []) {
      if (!p.id || seen.has(p.id)) continue;   // dedup po place_id
      seen.add(p.id);
      out.push(toBusiness(p));
    }

    if (out.length >= maxResults) break;
    if (!data.nextPageToken) break;
    token = data.nextPageToken;
  }

  return { businesses: out.slice(0, maxResults), apiCalls, ...(partial && { partial }) };
}