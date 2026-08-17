// apps/web/src/lib/search.ts
// Pretraga isključivo nad kešom. Nijedan Google poziv ne kreće odavde — posao u
// red upisuje ruta, i to tek pošto naplati (F9).
//
// Ova funkcija se poziva SAMO kad je pretraga besplatna: keš svež, ili posao
// koji je taj korisnik već platio u toku. Odluka o tome je u ruti, ne ovde —
// odluka o naplati i čitanje podataka namerno nisu u istom fajlu.
//
// Čitanje ide kroz `adminSupabase()` jer `businesses` i `website_audits` imaju
// `using (false)` (pravilo 10). To je dozvoljeno samo zato što svaki red pre
// izlaska prolazi kroz `toPublicLead()`, a `userId` dolazi iz Clerk sesije.

import "server-only";
import { GOOGLE_TTL_DAYS } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";
import { istekKesa } from "./search-cache";
import { screenshotPathsOf, toPublicLead, type LeadAudit, type LeadBusiness } from "./public-lead";
import { signScreenshots } from "./screenshots";
import { PAGE_SIZE, type SearchFilters, type SearchResponse, type SearchSummary } from "./search-types";
import { inGrupe } from "./upiti";

export type SearchInput = {
  userId: string;
  city: string;
  niche: string;
  filters: SearchFilters;
  page: number;
  countryCode?: string;
  /**
   * Kad je kombinacija poslednji put skenirana, iz registra keša (F9). Ne računa
   * se ovde iz `google_refreshed_at`: isti `place_id` ume da dođe iz dve niše,
   * pa bi tuđ scan tiho produžio besplatan rok ovoj kombinaciji.
   */
  scannedAt?: string | null;
  /** Šta se upisuje u `searches.source`. Plaćeni put je `api`. */
  source?: "cache" | "api";
};

const EMPTY_SUMMARY: SearchSummary = { noSite: 0, social: 0, dead: 0, ugly: 0, ok: 0 };

export async function searchCachedLeads(input: SearchInput): Promise<SearchResponse> {
  const countryCode = input.countryCode ?? "RS";
  const source = input.source ?? "cache";
  const freshness = input.scannedAt
    ? { scannedAt: input.scannedAt, expiresAt: istekKesa(input.scannedAt) }
    : null;
  const db = adminSupabase();

  // [Faza 3, 3.4] Filter, sort i limit su u SQL-u (`search_listing`, migracija
  // 0020): umesto 1200 biznisa + audita u dva upita i JS sortiranja na svakom
  // pollingu, stiže samo tražena stranica zajedno sa agregatima (P2). Sort je
  // isti kao u TS-u — status, pa skor, pa ime.
  const { data, error } = await db.rpc("search_listing", {
    p_country: countryCode,
    p_city: input.city,
    p_niche: input.niche,
    p_only_no_site: input.filters.onlyNoSite ?? false,
    p_only_social: input.filters.onlySocial ?? false,
    p_only_dead: input.filters.onlyDead ?? false,
    p_min_score: input.filters.minScore ?? null,
    p_page: input.page,
    p_page_size: PAGE_SIZE,
    // [Faza 6, 6.1] Per-red TTL (pravilo 1): kombinacija može da bude sveža a
    // neki njeni redovi stari — oni se ne serviraju (odluka b iz REVIZIJA B1).
    p_ttl_days: GOOGLE_TTL_DAYS,
  });

  if (error) throw new Error(`Čitanje pretrage nije uspelo: ${error.message}`);

  const rows = (data ?? []) as ListingRow[];
  const total = rows[0]?.total ?? 0;

  if (rows.length === 0) {
    // Prazno više ne znači „nije skenirano" (to je od F9 odluka rute, iz
    // registra keša). Ovde znači tačno ono što piše: keš za ovu kombinaciju
    // trenutno nema nijedan red — ili je scan u toku, ili Google nema ništa.
    await logSearch({
      userId: input.userId,
      countryCode,
      city: input.city,
      niche: input.niche,
      count: 0,
      source,
    });

    return {
      status: "cache",
      freshness,
      total: 0,
      page: input.page,
      pageSize: PAGE_SIZE,
      results: [],
      summary: EMPTY_SUMMARY,
    };
  }

  const pageRows = rows.map((r) => ({
    b: uBiznis(r),
    a: r.site_status === null ? null : uAudit(r),
  }));

  // Unlock status se traži samo za redove koji stvarno izlaze — najviše 30 id-jeva.
  const unlocked = await getUnlockedPlaceIds(pageRows.map(({ b }) => b.place_id));

  // Potpisuju se ISKLJUČIVO putanje otključanih redova. Potpisan URL za
  // zaključan lead je isto što i procureo telefon (P0-3).
  const signed = await signScreenshots(
    pageRows
      .filter(({ b }) => unlocked.has(b.place_id))
      .flatMap(({ a }) => screenshotPathsOf(a)),
  );

  await logSearch({
    userId: input.userId,
    countryCode,
    city: input.city,
    niche: input.niche,
    count: total,
    source,
  });

  return {
    status: "cache",
    freshness,
    total,
    page: input.page,
    pageSize: PAGE_SIZE,
    results: pageRows.map(({ b, a }) => toPublicLead(b, a, unlocked.has(b.place_id), signed)),
    summary: {
      noSite: rows[0]!.no_site,
      social: rows[0]!.social,
      dead: rows[0]!.dead,
      ugly: rows[0]!.ugly,
      ok: rows[0]!.ok,
    },
  };
}

// ── oblik reda iz `search_listing` (migracija 0020) ────────
// Kolone su namerno iste kao `LEAD_BUSINESS_COLUMNS`/`LEAD_AUDIT_COLUMNS`, da
// `toPublicLead` ostane jedina kapija — samo što sada sve stiže u jednom upitu.
type ListingRow = LeadBusiness &
  LeadAudit & {
    google_refreshed_at: string;
    total: number;
    no_site: number;
    social: number;
    dead: number;
    ugly: number;
    ok: number;
  };

function uBiznis(r: ListingRow): LeadBusiness {
  return {
    place_id: r.place_id,
    name: r.name,
    city_slug: r.city_slug,
    niche_slug: r.niche_slug,
    address: r.address,
    phone: r.phone,
    phone_type: r.phone_type,
    website_url: r.website_url,
    rating: r.rating,
    user_ratings_total: r.user_ratings_total,
  };
}

function uAudit(r: ListingRow): LeadAudit {
  return {
    site_status: r.site_status,
    ugly_band: r.ugly_band,
    platform: r.platform,
    ugly_score: r.ugly_score,
    signals: r.signals,
    emails: r.emails,
    psi_mobile_score: r.psi_mobile_score,
    psi_lcp_ms: r.psi_lcp_ms,
    ai_issues: r.ai_issues,
    ai_verdict: r.ai_verdict,
    ai_solidan: r.ai_solidan,
    screenshot_desktop: r.screenshot_desktop,
    screenshot_mobile: r.screenshot_mobile,
  };
}

// ── otključavanja ──────────────────────────────────────────
/**
 * Namerno kroz `userSupabase()`: RLS politika „own unlocks" je drugi sloj koji
 * garantuje da se ne mogu pročitati tuđa otključavanja. Sa admin klijentom bi
 * jedina odbrana bio `where user_id = ...` koji se lako zaboravi.
 *
 * [SVESNO ODSTUPANJE] Pokvarena Clerk↔Supabase veza i ovde vraća prazno umesto
 * greške, pa bi svi leadovi izgledali zaključano. `/lista`, `/krediti` i izvoz
 * na to reaguju glasno (v. `components/veza-greska.tsx`), a pretraga ne — iz dva
 * razloga:
 *
 *   1. Novac je bezbedan. Klik na „Otključaj" ide u `spend_credit_and_unlock`,
 *      koji `unlocks` čita kroz `service_role` bez RLS-a i uredno vrati
 *      `already_unlocked`. Korisnik ne može dvaput da plati isti lead.
 *   2. Provera bi tražila dodatno čitanje profila na SVAKOJ pretrazi, a prazan
 *      rezultat je ovde uobičajeno stanje — većina korisnika na većini strana
 *      nema ništa otključano.
 *
 * Dakle: šteta je zabuna, ne gubitak. Ako se ikad pojavi prijava „piše da nemam
 * otključano, a imam" — uzrok je ovde, a potvrda je na `/lista`.
 */
async function getUnlockedPlaceIds(placeIds: string[]): Promise<Set<string>> {
  if (placeIds.length === 0) return new Set();

  // [Faza 2, 2.2] Do 30 id-jeva po stranici — grupe su tu za svaki slučaj.
  const nadjeno = new Set<string>();
  for (const deo of inGrupe(placeIds)) {
    const { data, error } = await userSupabase()
      .from("unlocks")
      .select("place_id")
      .in("place_id", deo)
      .returns<{ place_id: string }[]>();

    if (error) throw new Error(`Čitanje otključavanja nije uspelo: ${error.message}`);
    for (const r of data ?? []) nadjeno.add(r.place_id);
  }
  return nadjeno;
}

// ── istorija pretraga ──────────────────────────────────────
/**
 * `searches` ima samo `select` politiku, pa upis ide kroz admin klijent —
 * `user_id` je iz verifikovane sesije, nikad iz tela zahteva (pravilo 8).
 *
 * `source` je `'api'` na plaćenom putu, `'cache'` inače. `api_calls` ostaje 0 i
 * na plaćenom putu: pozive broji worker kroz `api_budget`, ovde bi bili nagađanje.
 *
 * Od F9 ova tabela nosi i drugi posao: iz nje se računa `mine` u listi
 * besplatnih pretraga, dakle „ovo si već tražio".
 *
 * Neuspeh upisa ne ruši pretragu: istorija je korisna, ali nije razlog da
 * korisnik ostane bez rezultata.
 */
async function logSearch(args: {
  userId: string;
  countryCode: string;
  city: string;
  niche: string;
  count: number;
  source: "cache" | "api";
}): Promise<void> {
  const { error } = await adminSupabase().from("searches").insert({
    user_id: args.userId,
    country_code: args.countryCode,
    city_slug: args.city,
    niche_slug: args.niche,
    source: args.source,
    results_count: args.count,
    api_calls: 0,
  });

  if (error) console.error(`[search] upis u searches nije uspeo: ${error.message}`);
}
