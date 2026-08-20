// apps/cli/src/index.ts
// Postojeći CLI, sada iz monorepoa. Čista logika dolazi iz @sajtoskop/shared,
// mreža i Google budžet iz @sajtoskop/worker/lib.

import Table from "cli-table3";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Business, Niche, ScoreResult } from "@sajtoskop/shared";
import {
  buildScanQueries,
  cenaSkeniranja,
  DUBINA_OPIS,
  DUBINE,
  dubinaZaRezultate,
  foldForSearch,
  maxRezultataZaDubinu,
  PLACES_PAGE_SIZE,
  resolveCity,
  resolveNiche,
  scoreSite,
  slugify,
  stranicaZaRezultate,
  toCsv,
} from "@sajtoskop/shared";
import type { FetchStatus, SiteFetch } from "@sajtoskop/worker/lib";
import {
  BudgetError,
  budgetSummary,
  fetchAll,
  loadRootEnv,
  outPath,
  searchText,
  userPath,
  workspaceRoot,
} from "@sajtoskop/worker/lib";

// Ne `import "dotenv/config"`: on traži `.env` u cwd-u, a pnpm postavlja cwd na
// koren kod `pnpm scan`, a na apps/cli kod `pnpm --filter @sajtoskop/cli scan`.
// Od F3 CLI-u trebaju Supabase kredencijali za brojač poziva, pa bi tiho
// neučitan `.env` značio „budžet nije dostupan" umesto scana.
loadRootEnv();

/** Za ispis: "out/scan.csv" umesto pune apsolutne putanje. */
const rel = (f: string): string => path.relative(workspaceRoot(), f);

const optionsSchema = z.object({
  grad: z.string().min(1),
  nisa: z.string().min(1).optional(),
  /**
   * [S17] Slobodan broj rezultata OSTAJE — ovo je moj alat i CLI ne poznaje
   * kredite (F9 §5). Ali se od S17 NORMALIZUJE kroz `stranicaZaRezultate`, pa
   * `--broj 45` znači tačno 3 stranice, isto koliko bi značilo i u aplikaciji.
   * Bez toga bi CLI i web računali isti scan kao različit broj Places poziva.
   */
  broj: z.coerce.number().int().min(10).max(60),
  mock: z.boolean().default(false),
  offline: z.string().optional(),
  duboko: z.boolean().default(false),
  lang: z.string().default("sr-Latn"),
  save: z.boolean().default(false),
  csv: z.boolean().default(false),
  upit: z.string().optional(),
  dubina: z.enum(DUBINE).optional(),
});

type Row = {
  business: Business;
  site: SiteFetch;
  score: ScoreResult | null;
};

// nema_sajt je najbolji lead, ide na vrh. `blocked` ide na dno jer o njemu
// nemamo mišljenje — robots.txt nam nije dao da pogledamo sajt (pravilo 12).
const STATUS_RANK: Record<FetchStatus, number> = {
  nema_sajt: 0, samo_drustvene: 1, mrtav: 2, ok: 3, blocked: 4,
};

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const r = STATUS_RANK[a.site.status] - STATUS_RANK[b.site.status];
    if (r !== 0) return r;
    return (b.score?.score ?? 0) - (a.score?.score ?? 0);
  });
}

function statusCell(row: Row): string {
  switch (row.site.status) {
    case "nema_sajt": return "NEMA SAJT";
    case "samo_drustvene": return "SAMO DRUŠTVENE";
    case "mrtav": return `MRTAV`;
    case "blocked": return "ROBOTS.TXT";
    case "ok": return row.score ? String(row.score.score) : "—";
  }
}

function issueCell(row: Row): string {
  if (row.site.status === "mrtav") return row.site.error ?? "nedostupan";
  if (row.site.status === "nema_sajt") return "Google nema zapisan sajt";
  if (row.site.status === "samo_drustvene") return "Samo profil na mreži";
  if (row.site.status === "blocked") return row.site.error ?? "crawling zabranjen";
  return row.score?.topIssue ?? "—";
}

function printTable(rows: Row[]): void {
  const table = new Table({
    head: ["#", "Biznis", "Skor", "Problem", "Platforma"],
    colWidths: [4, 34, 16, 40, 12],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  rows.forEach((row, i) => {
    table.push([
      i + 1,
      row.business.name,
      statusCell(row),
      issueCell(row),
      row.site.status === "ok" ? (row.score?.platform ?? "—") : "—",
    ]);
  });

  console.log(table.toString());
}

function summary(rows: Row[]): string {
  const n = (s: FetchStatus) => rows.filter((r) => r.site.status === s).length;
  const ruzni = rows.filter((r) => (r.score?.score ?? 0) >= 45).length;
  const solidni = rows.filter((r) => r.site.status === "ok" && (r.score?.score ?? 0) < 45).length;
  return (
    `${rows.length} biznisa · ${n("nema_sajt")} bez sajta · ${n("samo_drustvene")} samo društvene · ` +
    `${n("mrtav")} nedostupnih\n${ruzni} ružnih (45+) · ${solidni} solidnih`
  );
}

function exportCsv(rows: Row[], file: string): void {
  const csv = toCsv(
    ["naziv", "telefon", "tip_telefona", "sajt", "status", "skor", "band", "platforma", "problemi", "adresa", "ocena", "broj_ocena"],
    rows.map((r) => [
      r.business.name,
      r.business.phone,
      r.business.phoneKind,
      r.business.website,
      r.site.status,
      r.score?.score ?? "",
      r.score?.band ?? "",
      r.score?.platform ?? "",
      r.score ? r.score.signals.map((s) => s.label).join(" | ") : (r.site.error ?? ""),
      r.business.address,
      r.business.rating ?? "",
      r.business.reviewCount ?? "",
    ]),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, csv, "utf8");
}

async function main(): Promise<void> {
  const program = new Command()
    .requiredOption("--grad <slug>", "slug grada, npr. nis")
    .option("--nisa <slug>", "slug niše, npr. stomatolog")
    .option("--broj <n>", "koliko rezultata (10-60; zaokružuje se na stranicu od 20)", "30")
    .option("--dubina <brzo|standardno|duboko>", "ponuda iz aplikacije umesto --broj")
    .option("--mock", "Places iz fixturea, bez API poziva", false)
    .option("--offline <fajl>", "učitaj biznise iz ranijeg out/*.json, nula API poziva")
    .option("--duboko", "cepaj velike gradove po opštinama (skupo!)", false)
    .option("--lang <code>", "languageCode", "sr-Latn")
    .option("--save", "snimi biznise u out/ kao JSON", false)
    .option("--csv", "izvezi rezultat u out/*.csv", false)
    .option("--upit <tekst>", "zameni upit iz taksonomije (za A/B test)");

  // pnpm prosleđuje i sam "--" skripti; commander bi ga shvatio kao kraj opcija
  program.parse(process.argv.filter((a, i) => i < 2 || a !== "--"));
  const opts = optionsSchema.parse(program.opts());

  // Sintetička niša za --upit: isti oblik kao zapis iz taksonomije, bez `any`.
  let niche: Niche;
  if (opts.nisa) {
    niche = resolveNiche(opts.nisa);
  } else if (opts.upit) {
    niche = {
      slug: slugify(opts.upit),
      label: opts.upit,
      query: opts.upit,
      group: "usluge",
      buyingPower: 2,
      badSiteOdds: 2,
    };
  } else {
    console.error("Greška: moraš proslediti --nisa ili --upit");
    process.exit(1);
  }

  const city = resolveCity(opts.grad);

  // [S17] Jedan broj, jedan izvor: `--dubina` je ponuda iz aplikacije, `--broj`
  // je slobodan unos, a oba završe u istom `maxRezultata` zaokruženom na punu
  // stranicu. Ispisuje se i koliko bi to koštalo u aplikaciji — CLI ne naplaćuje
  // ništa, ali je jedini način da se cena proveri bez trošenja kredita.
  const maxRezultata = opts.dubina
    ? maxRezultataZaDubinu(opts.dubina)
    : stranicaZaRezultate(opts.broj) * PLACES_PAGE_SIZE;

  const stamp = new Date().toISOString().slice(0, 10);
  const started = Date.now();

  // ── 1. biznisi ────────────────────────────────────────────

  const usedQuery = opts.upit ?? niche.query;
  const scanSlug = niche.slug;
  console.log(`\nTražim: ${niche.label} · ${city.label}${opts.mock ? "  [MOCK]" : ""}`);
  console.log(`Upit: "${usedQuery} ${city.label}"`);
  console.log(
    `Dubina: ${DUBINA_OPIS[dubinaZaRezultate(maxRezultata)].labela} · ` +
      `do ${maxRezultata} rezultata · ${stranicaZaRezultate(maxRezultata)} ` +
      `${stranicaZaRezultate(maxRezultata) === 1 ? "stranica" : "stranice"} · ` +
      `u aplikaciji ${cenaSkeniranja(maxRezultata)} ` +
      `${cenaSkeniranja(maxRezultata) === 1 ? "kredit" : "kredita"}`,
  );

  let all: Business[] = [];
  let calls = 0;

  if (opts.offline) {
    all = JSON.parse(fs.readFileSync(userPath(opts.offline), "utf8")) as Business[];
    console.log(`\nUčitano iz: ${opts.offline}  [OFFLINE]`);
  } else {
    const queries = opts.upit ? [`${opts.upit} ${city.label}`] : buildScanQueries(niche, city, { deep: opts.duboko });
    if (queries.length > 1 && !opts.mock) {
      console.log(
        `Upozorenje: --duboko pravi ${queries.length} upita ` +
          `(do ${queries.length * stranicaZaRezultate(maxRezultata)} API poziva).`,
      );
    }

    const seen = new Set<string>();
    for (const q of queries) {
      const { businesses, apiCalls } = await searchText(q, {
        maxResults: maxRezultata, languageCode: opts.lang, mock: opts.mock,
      });
      calls += apiCalls;
      for (const b of businesses) {
        if (seen.has(b.placeId)) continue;
        seen.add(b.placeId);
        all.push(b);
      }
      if (all.length >= maxRezultata) break;
    }
    console.log(`Google Places... ${all.length} rezultata (${calls} API poziva)`);

    if (!opts.mock && all.length > 0 && all.length < 8) {
      console.log(
        `\n⚠ Samo ${all.length} rezultata — upit "${usedQuery}" se verovatno poklopio sa nazivom firme.\n` +
        `  Probaj: --upit="<kategorija koju bi čovek ukucao>"\n`,
      );
    }
  }

  // Poređenje po celoj reči: "Šabački Put" više ne prolazi kao Šabac,
  // a firma u prigradskom naselju sa gradom u adresi prolazi.
  const cityRe = new RegExp(`\\b${foldForSearch(city.label).replace(/\s+/g, "\\s+")}\\b`);
  const inCity = all.filter((b) => cityRe.test(foldForSearch(b.address)));
  const offCity = all.filter((b) => !cityRe.test(foldForSearch(b.address)));

  if (offCity.length > 0) {
    console.log(`Van grada, izbačeno ${offCity.length}:`);
    for (const b of offCity) console.log(`   ${b.name.slice(0, 30)} — ${b.address}`);
  }

  const businesses = inCity.slice(0, maxRezultata);

  if (opts.save && !opts.offline) {
    const f = outPath(`${scanSlug}-${city.slug}-${stamp}.json`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(businesses, null, 2), "utf8");
    console.log(`Snimljeno: ${rel(f)}`);
  }

  // ── 2. sajtovi ────────────────────────────────────────────
  process.stdout.write("Analiziram sajtove... ");
  const fetched = await fetchAll(businesses, (d, t) => {
    process.stdout.write(`\rAnaliziram sajtove... ${d}/${t}   `);
  });
  console.log("");

  // ── 3. skor ───────────────────────────────────────────────
  const rows: Row[] = businesses.map((business) => {
    const site = fetched.get(business.placeId)!;
    const score =
      site.status === "ok" && site.html
        ? scoreSite({
            html: site.html,
            httpsOk: site.httpsOk,
            loadMs: site.loadMs,
            finalUrl: site.finalUrl,
          })
        : null;
    return { business, site, score };
  });

  const sorted = sortRows(rows);

  console.log("");
  printTable(sorted);
  console.log(`\n${summary(sorted)}`);

  if (opts.csv) {
    const f = outPath(`${scanSlug}-${city.slug}-${stamp}.csv`);
    exportCsv(sorted, f);
    console.log(`Izvezeno: ${rel(f)}`);
  }

  console.log(`Vreme: ${((Date.now() - started) / 1000).toFixed(1)}s · API pozivi: ${calls}`);

  // `--mock` i `--offline` ne troše kvotu, pa ni ne smeju da traže bazu —
  // inače lokalni razvoj bez Supabase kredencijala prestane da radi.
  if (!opts.offline && !opts.mock) console.log(await budgetSummary());

  if (!opts.save && !opts.csv) {
    console.warn("  ⚠ Bez --save i --csv rezultat se nigde ne upisuje.\n");
  }
}

main().catch((err: unknown) => {
  if (err instanceof BudgetError) {
    console.error(`\n  ⛔ ${err.message}`);
    console.error(`     Potrošeno danas: ${err.state.calls} · ovaj mesec: ${err.state.monthCalls}\n`);
    process.exit(2);
  }

  if (err instanceof z.ZodError) {
    console.error("\nNeispravni argumenti:");
    for (const issue of err.issues) console.error(`  --${issue.path.join(".")}: ${issue.message}`);
    console.error("");
  } else {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exit(1);
});
