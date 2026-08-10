// apps/worker/src/lib/db-writes.ts
// Upisi u `businesses` i `website_audits` iz workera. Oba idu kroz service_role
// jer obe tabele imaju RLS `using (false)` (pravilo 10).
//
// Podela vlasništva iz 00-kontekst §4 se ovde vidi doslovno: `businesses` su
// Googleovi podaci sa TTL-om 30 dana i sme ih pregaziti svaki nov scan;
// `website_audits` je ono što sam ja izgenerisao i pregazi se samo naniže —
// audit sa `audit_level > 1` (screenshot, PSI, AI iz F5/F6) nikad se ne ruši
// osnovnim HTML auditom.

import type { Business, ScoreResult, SiteStatus } from "@sajtoskop/shared";
import type { SiteFetch } from "./fetch-site";
import { supabaseAdmin } from "./supabase";

/** Koliko dugo osnovni audit važi pre nego što ga vredi ponoviti. */
export const AUDIT_TTL_DAYS = 30;

const CHUNK = 500;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── businesses ─────────────────────────────────────────────

export type UpsertBusinessesInput = {
  businesses: Business[];
  citySlug: string;
  nicheSlug: string;
  queryText: string;
  countryCode: string;
};

/**
 * Upiši ono što je Google upravo vratio.
 *
 * `first_seen_at` se namerno ne šalje: PostgREST na konfliktu menja samo kolone
 * koje su u telu, pa datum prvog viđenja preživi svaki naredni scan. To je
 * jedini podatak u ovoj tabeli koji nije Googleov.
 */
export async function upsertBusinesses(input: UpsertBusinessesInput): Promise<number> {
  if (input.businesses.length === 0) return 0;

  const now = new Date().toISOString();
  const rows = input.businesses.map((b) => ({
    place_id: b.placeId,
    country_code: input.countryCode,
    city_slug: input.citySlug,
    niche_slug: input.nicheSlug,
    query_text: input.queryText,
    name: b.name,
    address: b.address || null,
    phone: b.phone,
    phone_type: b.phoneKind,
    website_url: b.website,
    rating: b.rating,
    user_ratings_total: b.reviewCount,
    google_refreshed_at: now,
  }));

  for (const part of chunks(rows, CHUNK)) {
    const { error } = await supabaseAdmin()
      .from("businesses")
      .upsert(part, { onConflict: "place_id" });
    if (error) throw new Error(`Upis businesses nije uspeo: ${error.message}`);
  }

  return rows.length;
}

// ── website_audits ─────────────────────────────────────────

/**
 * `place_id`-jevi kojima treba osnovni audit: nemaju nijedan, ili im je stariji
 * od `AUDIT_TTL_DAYS`. Obogaćeni auditi (`audit_level > 1`) se ne diraju — njih
 * osvežava F5/F6, ne ovaj posao.
 */
export async function placeIdsNeedingAudit(placeIds: string[]): Promise<string[]> {
  if (placeIds.length === 0) return [];

  const cutoff = new Date(Date.now() - AUDIT_TTL_DAYS * 86_400_000).toISOString();
  const fresh = new Set<string>();

  for (const part of chunks(placeIds, CHUNK)) {
    const { data, error } = await supabaseAdmin()
      .from("website_audits")
      .select("place_id, audit_level, enriched_at")
      .in("place_id", part)
      .returns<{ place_id: string; audit_level: number; enriched_at: string }[]>();

    if (error) throw new Error(`Čitanje website_audits nije uspelo: ${error.message}`);

    for (const row of data ?? []) {
      if (row.audit_level > 1 || row.enriched_at > cutoff) fresh.add(row.place_id);
    }
  }

  return placeIds.filter((id) => !fresh.has(id));
}

export type AuditWrite = {
  placeId: string;
  site: SiteFetch;
  score: ScoreResult | null;
  emails: string[];
};

/**
 * Upiši rezultat osnovnog audita.
 *
 * `blocked` se ovde nikad ne pojavljuje — pozivalac takav biznis preskače, jer
 * sajt kome nam `robots.txt` zabranjuje pristup nema status koji bismo smeli da
 * tvrdimo. Zato tip ovde traži `SiteStatus`, ne `FetchStatus`.
 */
export async function upsertAudit(write: AuditWrite): Promise<void> {
  if (write.site.status === "blocked") {
    throw new Error(`upsertAudit pozvan za blokiran sajt: ${write.placeId}`);
  }

  const status: SiteStatus = write.site.status;
  const scored = status === "ok" ? write.score : null;

  const { error } = await supabaseAdmin().from("website_audits").upsert(
    {
      place_id: write.placeId,
      audit_level: 1,
      site_status: status,
      http_status: write.site.httpStatus,
      final_url: write.site.finalUrl,
      // Sloj 0 nema numerički skor po definiciji Ugly Score-a, a i baza to
      // odbija kroz `website_audits_score_only_when_ok`.
      ugly_score: scored?.score ?? null,
      ugly_band: scored?.band ?? null,
      platform: scored?.platform ?? null,
      signals: scored?.signals ?? [],
      emails: write.emails.length > 0 ? write.emails : null,
      enriched_at: new Date().toISOString(),
    },
    { onConflict: "place_id" },
  );

  if (error) throw new Error(`Upis website_audits nije uspeo: ${error.message}`);
}

/** Sajt jednog biznisa, za `enrich_basic`. */
export async function getBusinessSite(
  placeId: string,
): Promise<{ website_url: string | null; name: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from("businesses")
    .select("website_url, name")
    .eq("place_id", placeId)
    .maybeSingle<{ website_url: string | null; name: string }>();

  if (error) throw new Error(`Čitanje biznisa nije uspelo: ${error.message}`);
  return data;
}

// ── screenshotovi (F5) ─────────────────────────────────────

export type ExistingAudit = {
  audit_level: number;
  site_status: SiteStatus;
  screenshot_desktop: string | null;
  screenshot_mobile: string | null;
};

/** Zatečen audit, pre nego što ga `enrich_full` obogati. */
export async function getAudit(placeId: string): Promise<ExistingAudit | null> {
  const { data, error } = await supabaseAdmin()
    .from("website_audits")
    .select("audit_level, site_status, screenshot_desktop, screenshot_mobile")
    .eq("place_id", placeId)
    .maybeSingle<ExistingAudit>();

  if (error) throw new Error(`Čitanje audita nije uspelo: ${error.message}`);
  return data;
}

export type ScreenshotWrite = {
  placeId: string;
  /** Putanje u bucketu, ne URL-ovi. Potpis pravi web, u trenutku čitanja. */
  desktopPath: string | null;
  mobilePath: string | null;
  finalUrl: string;
  httpStatus: number | null;
  /** Zatečen red, ako postoji — određuje da li se `audit_level` diže. */
  existing: ExistingAudit | null;
};

/**
 * Upiši putanje screenshotova.
 *
 * `audit_level` ide na 2. Šema ga komentariše kao „2 = +PSI", a PSI stiže tek u
 * F6 — nivo ovde znači „enrich_full je prošao", što je jedina stvar zbog koje
 * ga `placeIdsNeedingAudit` i gleda: da bulk `enrich_basic` ne pregazi skup
 * enrichment. F6 diže na 3 i time se lestvica poravna.
 *
 * Sajt bez zatečenog audita se upisuje kao `ok`: upravo smo ga otvorili u
 * pregledaču, dakle živ je.
 */
export async function saveScreenshots(write: ScreenshotWrite): Promise<void> {
  const row: Record<string, unknown> = {
    place_id: write.placeId,
    audit_level: Math.max(write.existing?.audit_level ?? 1, 2),
    site_status: write.existing?.site_status ?? "ok",
    final_url: write.finalUrl,
    http_status: write.httpStatus,
    enriched_at: new Date().toISOString(),
  };

  // Neuspela varijanta ne sme da obriše onu koja je ranije uspela.
  if (write.desktopPath) row.screenshot_desktop = write.desktopPath;
  if (write.mobilePath) row.screenshot_mobile = write.mobilePath;

  const { error } = await supabaseAdmin()
    .from("website_audits")
    .upsert(row, { onConflict: "place_id" });

  if (error) throw new Error(`Upis screenshotova nije uspeo: ${error.message}`);
}

/**
 * Sajt se ne otvara ni u pregledaču ni običnim zahtevom → `mrtav` (PRD §5).
 *
 * [ODSTUPANJE od PRD-a §5] PRD kaže „timeout, DNS greška, TLS greška →
 * site_status = 'mrtav'" bez uslova. Ovde se status menja samo ako zatečeni
 * audit NIJE `ok` sa skorom, ili ako je i naš običan `fetch` pao. Razlog:
 * pola zapuštenih sajtova stoji iza WAF-a koji pušta `curl` a odbija headless
 * Chromium. Bez ovog uslova bi svaki takav sajt izgubio ispravan Ugly Score i
 * pao u „mrtav" na osnovu toga što nas je blokirao bot filter.
 *
 * `ugly_score` i pratioci se moraju nulirati zajedno sa statusom —
 * `website_audits_score_only_when_ok` inače odbija red.
 */
export async function markSiteDead(placeId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("website_audits")
    .upsert(
      {
        place_id: placeId,
        audit_level: 1,
        site_status: "mrtav" satisfies SiteStatus,
        ugly_score: null,
        ugly_band: null,
        platform: null,
        enriched_at: new Date().toISOString(),
      },
      { onConflict: "place_id" },
    );

  if (error) throw new Error(`Upis statusa 'mrtav' nije uspeo: ${error.message}`);
}
