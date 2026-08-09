// apps/web/src/lib/search.ts
// Pretraga isključivo nad kešom. U F2 nema nijednog Google poziva — promašaj
// keša vraća `not_scanned`, a job u red ulazi tek u F3.
//
// Čitanje ide kroz `adminSupabase()` jer `businesses` i `website_audits` imaju
// `using (false)` (pravilo 10). To je dozvoljeno samo zato što svaki red pre
// izlaska prolazi kroz `toPublicLead()`, a `userId` dolazi iz Clerk sesije.

import "server-only";
import { GOOGLE_TTL_DAYS } from "@sajtoskop/shared";
import type { SiteStatus } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";
import {
  LEAD_AUDIT_COLUMNS,
  LEAD_BUSINESS_COLUMNS,
  toPublicLead,
  type LeadAudit,
  type LeadBusiness,
} from "./public-lead";
import { PAGE_SIZE, type SearchFilters, type SearchResponse, type SearchSummary } from "./search-types";

/**
 * Koliko redova uopšte povlačimo iz baze za jedan (grad, niša) ključ.
 * Sortiranje po `site_status` pa `ugly_score` ne može u PostgREST-u jer se
 * kriterijum nalazi u drugoj tabeli, pa se sortira i sabira ovde. Zato postoji
 * cap: `MAX_PAGE * PAGE_SIZE` = 600 redova je sve što se ikako može adresirati,
 * 1200 je duplo od toga. Places vraća max ~60 rezultata po upitu, pa se ovo u
 * praksi dodiruje samo za deep sweep velikog grada (F3).
 */
const FETCH_CAP = 1200;

// Pretraga uzima kolone za `toPublicLead` plus dve svoje: `google_refreshed_at`
// za svežinu i `place_id` za spajanje audita sa biznisom.
const BUSINESS_COLUMNS = `${LEAD_BUSINESS_COLUMNS}, google_refreshed_at`;

const AUDIT_COLUMNS = `place_id, ${LEAD_AUDIT_COLUMNS}`;

type BusinessQueryRow = LeadBusiness & { google_refreshed_at: string };
type AuditQueryRow = LeadAudit & { place_id: string };

export type SearchInput = {
  userId: string;
  city: string;
  niche: string;
  filters: SearchFilters;
  page: number;
  countryCode?: string;
};

// Redosled po kvalitetu leada, ne po abecedi (PRD §4).
const STATUS_RANK: Record<SiteStatus, number> = {
  nema_sajt: 0,
  mrtav: 1,
  samo_drustvene: 2,
  ok: 3,
};

// Biznis bez reda u `website_audits` još nije analiziran — ide na dno.
const UNAUDITED_RANK = 4;

const EMPTY_SUMMARY: SearchSummary = { noSite: 0, social: 0, dead: 0, ugly: 0, ok: 0 };

export async function searchCachedLeads(input: SearchInput): Promise<SearchResponse> {
  const countryCode = input.countryCode ?? "RS";
  const db = adminSupabase();

  const { data: businesses, error: bErr } = await db
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("country_code", countryCode)
    .eq("city_slug", input.city)
    .eq("niche_slug", input.niche)
    .order("place_id", { ascending: true })
    .limit(FETCH_CAP)
    .returns<BusinessQueryRow[]>();

  if (bErr) throw new Error(`Čitanje biznisa nije uspelo: ${bErr.message}`);

  const rows = businesses ?? [];

  if (rows.length === FETCH_CAP) {
    // Ne ćuti o odsečenom rezultatu — `total` i `summary` bi bili tiho pogrešni.
    console.warn(
      `[search] ${input.city}/${input.niche}: dostignut FETCH_CAP=${FETCH_CAP}, sumar je nepotpun.`,
    );
  }

  if (rows.length === 0) {
    await logSearch({ userId: input.userId, countryCode, city: input.city, niche: input.niche, count: 0 });
    return {
      status: "not_scanned",
      freshness: null,
      total: 0,
      page: input.page,
      pageSize: PAGE_SIZE,
      results: [],
      summary: EMPTY_SUMMARY,
    };
  }

  const { data: audits, error: aErr } = await db
    .from("website_audits")
    .select(AUDIT_COLUMNS)
    .in("place_id", rows.map((r) => r.place_id))
    .returns<AuditQueryRow[]>();

  if (aErr) throw new Error(`Čitanje audita nije uspelo: ${aErr.message}`);

  const auditByPlace = new Map<string, LeadAudit>((audits ?? []).map((a) => [a.place_id, a]));

  // Svežina se računa nad celim ključem, pre filtera — filter ne menja starost podataka.
  const newest = rows.reduce(
    (max, r) => (r.google_refreshed_at > max ? r.google_refreshed_at : max),
    rows[0]!.google_refreshed_at,
  );

  const paired = rows.map((b) => ({ b, a: auditByPlace.get(b.place_id) ?? null }));
  const filtered = paired.filter(({ a }) => matchesFilters(a, input.filters));
  filtered.sort(compareLeads);

  const start = (input.page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  // Unlock status se traži samo za redove koji stvarno izlaze — najviše 30 id-jeva.
  const unlocked = await getUnlockedPlaceIds(pageRows.map(({ b }) => b.place_id));

  await logSearch({
    userId: input.userId,
    countryCode,
    city: input.city,
    niche: input.niche,
    count: filtered.length,
  });

  return {
    status: "cache",
    freshness: { refreshedAt: newest, stale: isStale(newest) },
    total: filtered.length,
    page: input.page,
    pageSize: PAGE_SIZE,
    results: pageRows.map(({ b, a }) => toPublicLead(b, a, unlocked.has(b.place_id))),
    summary: summarize(filtered),
  };
}

// ── filteri ────────────────────────────────────────────────
// Tri statusna toggle-a se sabiraju kao ILI (uključi i bez sajta i mrtve), a
// `minScore` se primenjuje kao I nad tim. Redovi bez numeričkog skora
// (`nema_sajt`, `mrtav`, `samo_drustvene`) ispadaju čim se `minScore` postavi —
// po definiciji Ugly Score-a oni skor nemaju.
function matchesFilters(a: LeadAudit | null, f: SearchFilters): boolean {
  const wanted: SiteStatus[] = [];
  if (f.onlyNoSite) wanted.push("nema_sajt");
  if (f.onlySocial) wanted.push("samo_drustvene");
  if (f.onlyDead) wanted.push("mrtav");

  if (wanted.length > 0 && (!a || !wanted.includes(a.site_status))) return false;

  if (f.minScore !== undefined) {
    if (a?.ugly_score == null || a.ugly_score < f.minScore) return false;
  }

  return true;
}

// ── sortiranje ─────────────────────────────────────────────
function rankOf(a: LeadAudit | null): number {
  return a ? STATUS_RANK[a.site_status] : UNAUDITED_RANK;
}

function compareLeads(
  x: { b: LeadBusiness; a: LeadAudit | null },
  y: { b: LeadBusiness; a: LeadAudit | null },
): number {
  const byStatus = rankOf(x.a) - rankOf(y.a);
  if (byStatus !== 0) return byStatus;

  const byScore = (y.a?.ugly_score ?? -1) - (x.a?.ugly_score ?? -1);
  if (byScore !== 0) return byScore;

  // Stabilan rasplet, da ista pretraga uvek daje isti redosled stranica.
  return x.b.name.localeCompare(y.b.name, "sr-Latn-RS");
}

// ── sumar ──────────────────────────────────────────────────
// Ista rečenica koju CLI ispisuje. Prag „ružnog" ne stoji ovde kao broj — čita se
// iz `ugly_band`, koji je izračunat u `packages/shared/src/ugly-score.ts` (pravilo 6).
// Biznis bez audita ne ulazi ni u jednu kategoriju, pa zbir ume da bude manji od
// `total`; u praksi se ne dešava jer seed i worker upisuju audit uz svaki biznis.
function summarize(rows: { a: LeadAudit | null }[]): SearchSummary {
  const s = { ...EMPTY_SUMMARY };

  for (const { a } of rows) {
    if (!a) continue;
    switch (a.site_status) {
      case "nema_sajt":
        s.noSite++;
        break;
      case "samo_drustvene":
        s.social++;
        break;
      case "mrtav":
        s.dead++;
        break;
      case "ok":
        if (a.ugly_band === "ruzan" || a.ugly_band === "katastrofa") s.ugly++;
        else s.ok++;
        break;
    }
  }

  return s;
}

// ── svežina ────────────────────────────────────────────────
function isStale(iso: string): boolean {
  const ageMs = Date.now() - new Date(iso).getTime();
  return ageMs > GOOGLE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

// ── otključavanja ──────────────────────────────────────────
/**
 * Namerno kroz `userSupabase()`: RLS politika „own unlocks" je drugi sloj koji
 * garantuje da se ne mogu pročitati tuđa otključavanja. Sa admin klijentom bi
 * jedina odbrana bio `where user_id = ...` koji se lako zaboravi.
 */
async function getUnlockedPlaceIds(placeIds: string[]): Promise<Set<string>> {
  if (placeIds.length === 0) return new Set();

  const { data, error } = await userSupabase()
    .from("unlocks")
    .select("place_id")
    .in("place_id", placeIds)
    .returns<{ place_id: string }[]>();

  if (error) throw new Error(`Čitanje otključavanja nije uspelo: ${error.message}`);
  return new Set((data ?? []).map((r) => r.place_id));
}

// ── istorija pretraga ──────────────────────────────────────
/**
 * `searches` ima samo `select` politiku, pa upis ide kroz admin klijent —
 * `user_id` je iz verifikovane sesije, nikad iz tela zahteva (pravilo 8).
 * U F2 je uvek `source: 'cache'` i `api_calls: 0`; u F3 se dodaje `'api'`.
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
}): Promise<void> {
  const { error } = await adminSupabase().from("searches").insert({
    user_id: args.userId,
    country_code: args.countryCode,
    city_slug: args.city,
    niche_slug: args.niche,
    source: "cache",
    results_count: args.count,
    api_calls: 0,
  });

  if (error) console.error(`[search] upis u searches nije uspeo: ${error.message}`);
}
