// apps/cli/src/harvest-emails.ts
// Vadi mejlove sa sajtova iz scan rezultata. Nula Google poziva.
// Samostalna skripta sa svojim main(), pokreće se preko `pnpm harvest`.
//
// Upotreba:
//   pnpm harvest out/pvc-stolarija-valjevo-2026-08-04.csv
//   pnpm harvest out/*.json
//   pnpm harvest --samo-lead out/autoplac-kraljevo-2026-08-04.csv
//
// Prima .csv (iz --csv) i .json (iz --save). Izlaz je spreman za nalepljivanje
// u tab pipeline-biznisi.

import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { extractEmails } from "@sajtoskop/shared";
import { outPath, userPath, workspaceRoot } from "@sajtoskop/worker/lib";

// ─────────────────────────────────────────────────────────────
// Tipovi
// ─────────────────────────────────────────────────────────────

/**
 * Red iz ranijeg scan izlaza — NIJE `Business` iz @sajtoskop/shared.
 * Sva polja su opciona jer ulaz može biti CSV iz bilo koje starije verzije CLI-ja,
 * i nosi kolone kojih u normalizovanom `Business` obliku nema (band, problemi, grad).
 */
type ScanRow = {
  placeId?: string;
  name: string;
  address?: string;
  phone?: string;
  phoneKind?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  siteStatus?: string; // NEMA SAJT / SAMO DRUŠTVENE / MRTAV / OK
  score?: number;
  band?: string;
  platform?: string;
  problems?: string;
  nisa?: string;
  grad?: string;
};

type Harvested = ScanRow & {
  email: string;
  emailAll: string;
  src: string;
};

// ─────────────────────────────────────────────────────────────
// Ulaz: CSV
// ─────────────────────────────────────────────────────────────

/** Minimalan CSV parser — podržava navodnike, "" escape i zareze u ćelijama. */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, ""); // BOM iz Excel-kompatibilnog izlaza
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === undefined) continue;

    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Aliasi jer se nazivi kolona menjaju kroz verzije CLI-ja. */
const COLS: Record<keyof ScanRow, string[]> = {
  placeId:    ["placeid", "place_id"],
  name:       ["naziv", "name", "ime"],
  address:    ["adresa", "address"],
  phone:      ["telefon", "phone"],
  phoneKind:  ["tip_telefona", "tip_tel", "phonekind"],
  website:    ["sajt", "website", "web"],
  rating:     ["ocena", "rating"],
  reviewCount:["broj_ocena", "ocene", "reviewcount"],
  siteStatus: ["status", "status_sajta", "sitestatus"],
  score:      ["skor", "score", "ugly_score"],
  band:       ["band", "bend"],
  platform:   ["platforma", "platform"],
  problems:   ["problemi", "problem", "problem_recenica"],
  nisa:       ["nisa", "niša"],
  grad:       ["grad", "city"],
};

function indexHeader(header: string[]): Partial<Record<keyof ScanRow, number>> {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/^\uFEFF/, ""));
  const map: Partial<Record<keyof ScanRow, number>> = {};
  for (const [key, aliases] of Object.entries(COLS) as [keyof ScanRow, string[]][]) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[key] = idx;
  }
  return map;
}

function csvToBusinesses(text: string, file: string): ScanRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const header = rows[0];
  if (!header) return [];

  const map = indexHeader(header);
  if (map.name === undefined) {
    throw new Error(
      `${file}: ne prepoznajem kolonu sa nazivom.\n` +
        `  Zaglavlje: ${header.join(", ")}\n` +
        `  Očekujem jednu od: ${COLS.name.join(", ")}`,
    );
  }

  const pick = (r: string[], k: keyof ScanRow): string | undefined => {
    const i = map[k];
    if (i === undefined) return undefined;
    const v = r[i]?.trim();
    return v ? v : undefined;
  };

  return rows.slice(1).map((r) => ({
    placeId:     pick(r, "placeId"),
    name:        pick(r, "name") ?? "(bez naziva)",
    address:     pick(r, "address"),
    phone:       pick(r, "phone"),
    phoneKind:   pick(r, "phoneKind"),
    website:     pick(r, "website"),
    rating:      Number(pick(r, "rating")) || undefined,
    reviewCount: Number(pick(r, "reviewCount")) || undefined,
    siteStatus:  pick(r, "siteStatus"),
    score:       Number(pick(r, "score")) || undefined,
    band:        pick(r, "band"),
    platform:    pick(r, "platform"),
    problems:    pick(r, "problems"),
  }));
}

// ─────────────────────────────────────────────────────────────
// Ulaz: auto-detekcija
// ─────────────────────────────────────────────────────────────

/** Iz "pvc-stolarija-valjevo-2026-08-04.csv" izvuci nišu i grad. */
function parseFileName(file: string): { nisa?: string; grad?: string } {
  const base = path.basename(file).replace(/\.(csv|json)$/i, "");
  const m = base.match(/^(.+)-([a-z0-9-]+)-\d{4}-\d{2}-\d{2}$/i);
  if (!m) return {};
  const parts = (m[1] ?? "").split("-");
  // poslednji segment pre datuma je grad, ostalo je niša
  return { nisa: parts.join("-"), grad: m[2] };
}

function loadFile(file: string): ScanRow[] {
  const raw = fs.readFileSync(file, "utf8");
  const meta = parseFileName(file);

  let items: ScanRow[];
  if (file.toLowerCase().endsWith(".json") || raw.replace(/^\uFEFF/, "").trimStart().startsWith("[")) {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    items = Array.isArray(parsed) ? parsed : (parsed.businesses ?? []);
  } else {
    items = csvToBusinesses(raw, file);
  }

  return items.map((b) => ({ ...meta, ...b }));
}

// ─────────────────────────────────────────────────────────────
// Ekstrakcija mejlova
// ─────────────────────────────────────────────────────────────

// Sama ekstrakcija je od F3 u `@sajtoskop/shared` — istu koristi i `enrich_basic`
// posao u workeru. Ovde ostaje samo obilazak putanja, jer je to mrežni deo.

// ─────────────────────────────────────────────────────────────
// Mreža
// ─────────────────────────────────────────────────────────────

function normUrl(site: string): string {
  const s = site.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

async function fetchHtml(url: string, timeoutMs = 15_000): Promise<string | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "sr,en;q=0.8",
      },
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const PATHS = ["", "/kontakt", "/contact", "/kontakt.html", "/o-nama", "/impressum"];

async function harvestOne(b: ScanRow): Promise<Harvested> {
  const empty = { email: "", emailAll: "" };
  if (!b.website) return { ...b, ...empty, src: "nema-sajt" };

  let base = normUrl(b.website);
  let host: string;
  try { host = new URL(base).hostname; } catch { return { ...b, ...empty, src: "los-url" }; }

  for (const p of PATHS) {
    let html = await fetchHtml(base + p);

    // ako https ne prolazi na prvoj putanji, probaj http jednom
    if (!html && p === "" && base.startsWith("https://")) {
      base = base.replace(/^https:/, "http:");
      html = await fetchHtml(base);
    }
    if (!html) continue;

    const emails = extractEmails(html, host);
    const first = emails[0];
    if (first) {
      return {
        ...b,
        email: first,
        emailAll: emails.slice(0, 3).join(" | "),
        src: p || "/",
      };
    }
  }
  return { ...b, ...empty, src: "nije-nadjen" };
}

// ─────────────────────────────────────────────────────────────
// Izlaz
// ─────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Prva rečenica iz liste problema — ide u cold poruku. */
function firstProblem(problems?: string): string {
  if (!problems) return "";
  return (problems.split(/\s*[|;·]\s*|\s*\n\s*/)[0] ?? "").trim();
}

/** Kanal po tome šta imaš od kontakta. */
function channel(r: Harvested): string {
  if (r.phoneKind === "mobilni") return "viber";
  if (r.email) return "mejl";
  if (r.phone) return "telefon";
  return "bez-kontakta";
}

/** Kvalifikuje li se za outreach ove nedelje. */
function isLead(r: Harvested): boolean {
  // Najpouzdaniji signal je odsustvo sajta — ne zavisi od formulacije statusa.
  if (!r.website) return true;

  const st = (r.siteStatus ?? "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .replace(/ć|č/g, "c");

  if (/nema sajt|bez sajta|mrtav|dead|samo (drustvene|facebook|instagram|fb|ig)/.test(st)) {
    return true;
  }

  // "kritican"/"los" su bendovi iz arhiviranih CSV-ova pre F0;
  // "katastrofa"/"ruzan" su aktuelni. Oba se i dalje čitaju.
  const band = (r.band ?? "").toLowerCase().replace(/[čć]/g, "c");
  if (/kritican|los|katastrofa|ruzan/.test(band)) return true;

  return (r.score ?? 0) >= 45;
}

/** Ključ za dedup kad nema placeId. */
function dedupeKey(b: ScanRow): string {
  if (b.placeId) return `id:${b.placeId}`;
  const site = (b.website ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  if (site) return `web:${site}`;
  const tel = (b.phone ?? "").replace(/\D/g, "");
  if (tel) return `tel:${tel}`;
  return `ime:${b.name.toLowerCase()}|${(b.address ?? "").toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

function usage(): never {
  console.error(`
  Upotreba: pnpm harvest [--samo-lead] <fajl...>

    pnpm harvest out/pvc-stolarija-valjevo-2026-08-04.csv
    pnpm harvest out/*.json
    pnpm harvest --samo-lead out/autoplac-kraljevo-2026-08-04.csv

  Prima .csv (iz --csv) i .json (iz --save).
  --samo-lead   samo redovi bez sajta, mrtvi, samo društvene, ili skor >= 45
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const samoLead = argv.includes("--samo-lead");
  const files = argv.filter((a) => !a.startsWith("-"));

  if (!files.length) usage();

  for (const f of files) {
    if (!fs.existsSync(userPath(f))) {
      console.error(`  Fajl ne postoji: ${userPath(f)}`);
      process.exit(1);
    }
  }

  const seen = new Set<string>();
  const all: ScanRow[] = [];
  for (const f of files) {
    const items = loadFile(userPath(f));
    let added = 0;
    for (const b of items) {
      const k = dedupeKey(b);
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(b);
      added++;
    }
    console.log(`  ${path.basename(f)}: ${items.length} redova, ${added} novih`);
  }

  const withSite = all.filter((b) => b.website).length;
  console.log(`\n  Ukupno jedinstvenih: ${all.length}  ·  sa sajtom: ${withSite}\n`);

  if (!all.length) { console.error("  Nema redova za obradu."); process.exit(1); }

  const limit = pLimit(Number(process.env.HARVEST_CONCURRENCY ?? 3));
  let done = 0;
  const rows = await Promise.all(
    all.map((b) =>
      limit(async () => {
        const r = await harvestOne(b);
        done++;
        process.stdout.write(`\r  ${done}/${all.length}`);
        return r;
      }),
    ),
  );
  process.stdout.write("\n");

  const final = samoLead ? rows.filter(isLead) : rows;

  // ── izlaz spreman za nalepljivanje u pipeline-biznisi ──
  const header = [
    "nisa", "grad", "naziv", "telefon", "tip_telefona", "mejl", "sajt",
    "status_sajta", "ugly_score", "problem_recenica", "kanal",
    "lead", "ocena", "broj_ocena", "platforma", "svi_mejlovi", "izvor_str",
    "datum_slanja", "odgovor", "status", "placeId",
  ];

  const lines = [header.join(",")];
  for (const r of final) {
    lines.push([
      r.nisa ?? "", r.grad ?? "", r.name, r.phone ?? "", r.phoneKind ?? "",
      r.email, r.website ?? "", r.siteStatus ?? "", r.score ?? "",
      firstProblem(r.problems), channel(r), isLead(r) ? "da" : "ne",
      r.rating ?? "", r.reviewCount ?? "", r.platform ?? "",
      r.emailAll, r.src,
      "", "", "", r.placeId ?? "",
    ].map(csvCell).join(","));
  }

  // ime izlaza se izvodi iz ulaza — provenijencija bez razmišljanja o datumu
  const stem = path.basename(files[0] ?? "scan").replace(/\.(csv|json)$/i, "");
  const suffix = files.length > 1 ? `-plus${files.length - 1}` : "";
  const out = outPath(`mejlovi-${stem}${suffix}.csv`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "\uFEFF" + lines.join("\r\n"), "utf8");

  // ── statistika ──
  const hit = rows.filter((r) => r.email).length;
  const leads = rows.filter(isLead).length;
  const pct = withSite ? Math.round((hit / withSite) * 100) : 0;

  const bySrc = new Map<string, number>();
  for (const r of rows) bySrc.set(r.src, (bySrc.get(r.src) ?? 0) + 1);

  const byChannel = new Map<string, number>();
  for (const r of final) byChannel.set(channel(r), (byChannel.get(channel(r)) ?? 0) + 1);

  const statusi = new Map<string, number>();
  for (const r of rows) statusi.set(r.siteStatus ?? "(prazno)", (statusi.get(r.siteStatus ?? "(prazno)") ?? 0) + 1);
  console.log(`\n  Vrednosti u koloni status:`, Object.fromEntries(statusi));

  const leadMail = final.filter((r) => r.email).length;
  console.log(`\n  Mejlova: ${hit} / ${withSite} sa sajtom = ${pct}%  ·  među leadovima: ${leadMail} / ${final.length}`);
  console.log(`  Leadova (bez sajta / mrtav / društvene / skor 45+): ${leads} / ${rows.length}`);
  console.log(`  Gde je nađen:`, Object.fromEntries(bySrc));
  console.log(`  Kanali${samoLead ? " (lead)" : ""}:`, Object.fromEntries(byChannel));
  console.log(`\n  Fajl: ${path.relative(workspaceRoot(), out)}  (${final.length} redova)\n`);
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});