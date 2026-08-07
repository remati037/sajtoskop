// apps/cli/src/lib/archive.ts
// Čitanje starih scanova iz `data/scanovi-arhiva/` i mapiranje na oblik tabela.
//
// Odvojeno od `seed.ts` da bi se parsiranje moglo pokrenuti bez baze
// (`pnpm seed --dry`). Ovde nema nijednog mrežnog poziva.
//
// ── Oblik arhive ───────────────────────────────────────────
// Svaki scan ima dva fajla sa istim imenom:
//   `{nisa}-{grad}-{YYYY-MM-DD}.json`  — biznisi (Google podaci), bez audita
//   `{nisa}-{grad}-{YYYY-MM-DD}.csv`   — audit (status, skor, band, problemi), BEZ place_id
//
// place_id postoji samo u JSON-u, audit samo u CSV-u. Spajaju se po paru
// (naziv, adresa) — provereno je da je taj par jedinstven u svakom fajlu i da se
// skupovi poklapaju 1:1. Spajanje po samom nazivu ne valja: u scanovima web
// agencija ista firma se pojavljuje pod istim imenom više puta.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { BusinessRow, PhoneKind, Platform, Signal, SiteStatus, UglyBand } from "@sajtoskop/shared";
import { bandForScore, CITIES, fromCsv, NICHES, phoneType } from "@sajtoskop/shared";

// ── tipovi ─────────────────────────────────────────────────

/** Red za `website_audits` bez kolona koje generiše baza. */
export type AuditInsert = {
  place_id: string;
  audit_level: 1;
  site_status: SiteStatus;
  http_status: number | null;
  final_url: string | null;
  ugly_score: number | null;
  ugly_band: UglyBand | null;
  platform: Platform | null;
  signals: Signal[];
  emails: string[] | null;
  enriched_at: string;
};

export type SeedRecord = {
  business: BusinessRow;
  audit: AuditInsert;
  /** Datum scana — koristi se za odlučivanje kod duplikata. */
  scanDate: string;
};

export type ArchiveReport = {
  records: SeedRecord[];
  /** Fajlovi koji su pročitani, sa brojem redova. */
  files: { file: string; rows: number }[];
  /** Redovi preskočeni jer nemaju place_id ili nemaju par u JSON-u. */
  skipped: { file: string; reason: string; name: string }[];
  /** Isti place_id u više scanova — zadržan je najnoviji. */
  duplicates: { placeId: string; kept: string; dropped: string }[];
  /** Band iz starog CSV-a se razlikuje od banda izvedenog iz skora. */
  bandMismatches: { placeId: string; csv: string; derived: string; score: number }[];
  /** Koliko je biznisa dobilo mejlove iz `mejlovi-*.csv`. */
  emailsAttached: number;
  warnings: string[];
};

// ── mapiranje starih vrednosti ─────────────────────────────
// CSV-ovi iz jula/avgusta 2026 nose vrednosti iz starije verzije CLI-a:
// velika slova i drugi nazivi bendova. Novi CLI već piše aktuelne vrednosti,
// pa mapa podnosi oba oblika.

const SITE_STATUS: Record<string, SiteStatus> = {
  ZIV: "ok",                          // stari naziv
  ok: "ok",
  NEMA_SAJT: "nema_sajt",
  nema_sajt: "nema_sajt",
  SAMO_DRUSTVENE: "samo_drustvene",
  samo_drustvene: "samo_drustvene",
  MRTAV: "mrtav",
  mrtav: "mrtav",
};

const BAND: Record<string, UglyBand> = {
  solidan: "solidan",
  osrednji: "osrednji",
  los: "ruzan",                       // stari naziv
  ruzan: "ruzan",
  kritican: "katastrofa",             // stari naziv
  katastrofa: "katastrofa",
};

const PLATFORMS = new Set<string>([
  "WordPress", "Joomla", "Drupal", "Wix", "Squarespace",
  "Shopify", "Blogger", "Weebly", "custom",
]);

/**
 * Labela signala → ključ. Labele su stabilne i dolaze doslovno iz `ugly-score.ts`,
 * pa je poklapanje po prefiksu pouzdano.
 *
 * VAŽNO: težine (`points`) se NE rekonstruišu — stari CSV ih nikad nije ni
 * zapisao, a duplirati tabelu težina ovde bi prekršilo pravilo 6 (Ugly Score
 * živi na jednom mestu) i uvuklo težine u još jedan fajl. Zato seedovani signali
 * nose `points: 0`. Numerički skor NIJE izgubljen — on je u koloni `ugly_score`.
 * Pun signal sa težinama vraća se prvim `enrich_basic` poslom u F3.
 */
const SIGNAL_KEYS: [RegExp, string][] = [
  [/^Sajt nije prilagođen telefonu/, "no_viewport"],
  [/^Nema HTTPS/, "no_https"],
  [/^Copyright \d+ — nije diran/, "copyright_ancient"],
  [/^Copyright \d+ — nije ažuriran/, "copyright_old"],
  [/^Napravljen tabelama/, "table_layout"],
  [/^Na sajtu se tekst pomera/, "marquee"],
  [/^Koristi HTML tagove izbačene/, "legacy_tags"],
  [/^Napravljen frejmovima/, "frames"],
  [/^Sadrži Flash/, "flash"],
  [/^jQuery \d/, "jquery_old"],
  [/^Nema naslov stranice/, "no_title"],
  [/^Nema meta opis/, "no_description"],
  [/^Nema favicon/, "no_favicon"],
  [/^Bez Open Graph/, "no_og"],
  [/^Skoro prazna stranica/, "thin"],
];

function signalKey(label: string): string {
  for (const [re, key] of SIGNAL_KEYS) {
    if (re.test(label)) return key;
  }
  // "Učitavanje 6.2s" — prag od 5s razdvaja `slow` od `very_slow` u ugly-score.ts
  const load = /^Učitavanje ([\d.]+)s/.exec(label);
  if (load) return Number(load[1]) > 5 ? "very_slow" : "slow";

  return "unknown";
}

// ── parsiranje imena fajla ─────────────────────────────────

const CITY_SLUGS = [...CITIES.map((c) => c.slug)].sort((a, b) => b.length - a.length);

/**
 * `pvc-stolarija-sabac-2026-08-03` → niša `pvc-stolarija`, grad `sabac`.
 *
 * I niše i gradovi imaju crticu u slugu (`novi-sad`, `pvc-stolarija`), pa se
 * granica ne može pogoditi splitovanjem. Traži se najduži poznat slug grada
 * koji stoji na kraju — zato je lista sortirana po dužini opadajuće.
 */
export function parseScanName(base: string): { nicheSlug: string; citySlug: string; scanDate: string } | null {
  const m = /^(.+)-(\d{4}-\d{2}-\d{2})$/.exec(base);
  if (!m) return null;

  const rest = m[1]!;
  const scanDate = m[2]!;

  for (const city of CITY_SLUGS) {
    if (rest === city) return { nicheSlug: "", citySlug: city, scanDate };
    if (rest.endsWith(`-${city}`)) {
      return { nicheSlug: rest.slice(0, -(city.length + 1)), citySlug: city, scanDate };
    }
  }
  return null;
}

/** Upit kojim je scan pokrenut — iz taksonomije ako niša postoji, inače iz sluga. */
function queryTextFor(nicheSlug: string, citySlug: string): string {
  const city = CITIES.find((c) => c.slug === citySlug);
  const niche = NICHES.find((n) => n.slug === nicheSlug);
  const cityLabel = city?.label ?? citySlug;
  const nicheQuery = niche?.query ?? nicheSlug.replaceAll("-", " ");
  return `${nicheQuery} ${cityLabel}`.trim();
}

// ── validacija JSON-a ──────────────────────────────────────

const businessSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  phoneKind: z.string().nullable().default(null),
  website: z.string().nullable().default(null),
  rating: z.number().nullable().default(null),
  reviewCount: z.number().int().nullable().default(null),
});

// ── čitanje ────────────────────────────────────────────────

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "HTTP 403" → 403. Ostalo ("timeout 15s", "domen ne postoji") nema status kod. */
function httpStatusFrom(problem: string): number | null {
  const m = /^HTTP (\d{3})$/.exec(problem.trim());
  return m ? Number(m[1]) : null;
}

/**
 * `mejlovi-*.csv` su odvojen izlaz `harvest-emails` komande. Samo neki od njih
 * nose `placeId` — one bez njega je nemoguće pouzdano spojiti i preskaču se.
 */
function readEmails(dir: string, warnings: string[]): Map<string, string[]> {
  const byPlace = new Map<string, string[]>();

  for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("mejlovi-") && f.endsWith(".csv"))) {
    const rows = fromCsv(fs.readFileSync(path.join(dir, file), "utf8"));
    let withId = 0;

    for (const row of rows) {
      const placeId = (row["placeId"] ?? "").trim();
      if (!placeId) continue;
      withId++;

      const raw = row["svi_mejlovi"] ?? row["mejl"] ?? "";
      const emails = raw.split("|").map((e) => e.trim().toLowerCase()).filter(Boolean);
      if (emails.length === 0) continue;

      const existing = byPlace.get(placeId) ?? [];
      byPlace.set(placeId, [...new Set([...existing, ...emails])]);
    }

    if (withId === 0) {
      warnings.push(`${file}: nijedan red nema placeId — mejlovi iz ovog fajla se ne mogu spojiti, preskočen`);
    }
  }

  return byPlace;
}

export function readArchive(dir: string): ArchiveReport {
  const report: ArchiveReport = {
    records: [], files: [], skipped: [], duplicates: [],
    bandMismatches: [], emailsAttached: 0, warnings: [],
  };

  if (!fs.existsSync(dir)) {
    report.warnings.push(`Direktorijum ne postoji: ${dir}`);
    return report;
  }

  const emailsByPlace = readEmails(dir, report.warnings);
  const byPlaceId = new Map<string, SeedRecord>();

  const jsonFiles = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("mejlovi-"))
    .sort();

  for (const jsonFile of jsonFiles) {
    const base = jsonFile.slice(0, -5);
    const csvFile = `${base}.csv`;
    const csvPath = path.join(dir, csvFile);

    const parsed = parseScanName(base);
    if (!parsed) {
      report.warnings.push(`${jsonFile}: ime ne odgovara obrascu {nisa}-{grad}-{YYYY-MM-DD}, preskočen`);
      continue;
    }
    if (!fs.existsSync(csvPath)) {
      report.warnings.push(`${jsonFile}: nema pratećeg ${csvFile}, preskočen (audit se ne može rekonstruisati)`);
      continue;
    }

    const { nicheSlug, citySlug, scanDate } = parsed;
    // Scan je odrađen tokom dana; ponoć u UTC je dovoljno precizno za TTL od 30 dana.
    const scanAt = `${scanDate}T12:00:00.000Z`;

    const rawJson: unknown = JSON.parse(fs.readFileSync(path.join(dir, jsonFile), "utf8"));
    const businesses = z.array(businessSchema).parse(rawJson);
    const csvRows = fromCsv(fs.readFileSync(csvPath, "utf8"));

    // Spoj po (naziv, adresa) — jedini par koji je jedinstven u oba fajla.
    const auditByKey = new Map<string, Record<string, string>>();
    for (const row of csvRows) {
      auditByKey.set(`${row["naziv"] ?? ""} ${row["adresa"] ?? ""}`, row);
    }

    let rows = 0;

    for (const b of businesses) {
      if (!b.placeId) {
        report.skipped.push({ file: jsonFile, reason: "nema place_id", name: b.name });
        continue;
      }

      const csv = auditByKey.get(`${b.name} ${b.address ?? ""}`);
      if (!csv) {
        report.skipped.push({ file: jsonFile, reason: "nema par u CSV-u", name: b.name });
        continue;
      }

      const status = SITE_STATUS[csv["status"] ?? ""];
      if (!status) {
        report.skipped.push({ file: jsonFile, reason: `nepoznat status "${csv["status"]}"`, name: b.name });
        continue;
      }

      const score = status === "ok" ? num(csv["skor"]) : null;
      const problems = (csv["problemi"] ?? "").trim();

      // Band se izvodi iz skora, ne čita iz CSV-a: pragovi žive u ugly-score.ts
      // i to je jedini izvor istine. CSV vrednost se koristi samo za proveru.
      let band: UglyBand | null = null;
      if (score !== null) {
        band = bandForScore(score);
        const fromCsvBand = BAND[csv["band"] ?? ""];
        if (fromCsvBand && fromCsvBand !== band) {
          report.bandMismatches.push({ placeId: b.placeId, csv: fromCsvBand, derived: band, score });
        }
      }

      const signals: Signal[] =
        status === "ok" && problems
          ? problems.split(" | ").filter(Boolean).map((label) => ({ key: signalKey(label), points: 0, label }))
          : [];

      const platformRaw = (csv["platforma"] ?? "").trim();
      const platform = PLATFORMS.has(platformRaw) ? (platformRaw as Platform) : null;

      const phone = b.phone?.trim() || null;
      const emails = emailsByPlace.get(b.placeId) ?? null;
      if (emails) report.emailsAttached++;

      const record: SeedRecord = {
        scanDate,
        business: {
          place_id: b.placeId,
          country_code: "RS",
          city_slug: citySlug,
          niche_slug: nicheSlug || null,
          query_text: queryTextFor(nicheSlug, citySlug),
          name: b.name,
          address: b.address,
          phone,
          // Računa se iz prefiksa, ne uzima iz JSON-a — jedna funkcija, jedan rezultat.
          phone_type: phone ? (phoneType(phone) as PhoneKind) : null,
          website_url: b.website,
          rating: b.rating,
          user_ratings_total: b.reviewCount,
          // KRITIČNO: stvarni datum scana, ne now(). Google TTL je 30 dana i
          // aplikacija ne sme da servira podatak koji je po ToS-u istekao.
          google_refreshed_at: scanAt,
          first_seen_at: scanAt,
        },
        audit: {
          place_id: b.placeId,
          audit_level: 1,
          site_status: status,
          http_status: status === "ok" ? null : httpStatusFrom(problems),
          final_url: null,
          ugly_score: score,
          ugly_band: band,
          platform,
          signals,
          emails,
          enriched_at: scanAt,
        },
      };

      // Isti biznis ume da se pojavi u dva scana (npr. `izrada-sajtova-beograd`
      // i `web-dizajn-agencija-beograd`). Zadrži noviji.
      const existing = byPlaceId.get(b.placeId);
      if (existing) {
        const keepNew = record.scanDate > existing.scanDate;
        report.duplicates.push({
          placeId: b.placeId,
          kept: keepNew ? jsonFile : "raniji scan",
          dropped: keepNew ? "raniji scan" : jsonFile,
        });
        if (!keepNew) continue;
      }

      byPlaceId.set(b.placeId, record);
      rows++;
    }

    report.files.push({ file: base, rows });
  }

  report.records = [...byPlaceId.values()];
  return report;
}
