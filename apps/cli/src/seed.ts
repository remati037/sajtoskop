// apps/cli/src/seed.ts
// Puni bazu postojećim scanovima iz `data/scanovi-arhiva/`.
//
//   pnpm seed --dry     # samo parsiranje i izveštaj, bez baze
//   pnpm seed           # upis kroz service_role
//
// Ovo je razlog zbog kog aplikacija na prvi dan ne izgleda prazno (F1, sekcija 7).
//
// Skripta je idempotentna i BEZBEDNA ZA PONOVNO POKRETANJE:
//   - biznis čiji je `google_refreshed_at` noviji od datuma scana se ne dira
//     (F3 refresh ne sme da se vrati unazad)
//   - audit sa `audit_level > 1` se ne dira (screenshot, PSI i AI iz F5/F6
//     ne smeju da se pregaze podacima iz avgusta)

import { Command } from "commander";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRootEnv, supabaseAdmin, workspaceRoot } from "@sajtoskop/worker/lib";
import { CITIES } from "@sajtoskop/shared";

// Pre svega ostalog — `.env` živi u korenu monorepoa, a cwd zavisi od toga
// da li si pokrenuo `pnpm seed` ili `pnpm --filter @sajtoskop/cli seed`.
loadRootEnv();
import type { ArchiveReport, AuditInsert, SeedRecord } from "./lib/archive";
import { readArchive } from "./lib/archive";

const CHUNK = 500;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function cityLabel(slug: string): string {
  return CITIES.find((c) => c.slug === slug)?.label ?? slug;
}

// ── izveštaj ───────────────────────────────────────────────

function printReport(report: ArchiveReport, records: SeedRecord[]): void {
  const byCity = new Map<string, number>();
  const byNiche = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byBand = new Map<string, number>();

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const r of records) {
    bump(byCity, r.business.city_slug);
    bump(byNiche, r.business.niche_slug ?? "(bez niše)");
    bump(byStatus, r.audit.site_status);
    if (r.audit.ugly_band) bump(byBand, r.audit.ugly_band);
  }

  const desc = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
  const total = records.length;
  const nonOk = total - (byStatus.get("ok") ?? 0);

  console.log(`\n── Izveštaj ───────────────────────────────────────`);
  console.log(`Fajlova pročitano: ${report.files.length}`);
  console.log(`Biznisa: ${total}`);
  console.log(`Bez funkcionalnog sajta: ${nonOk} (${total ? Math.round((nonOk / total) * 100) : 0}%)`);

  console.log(`\nPo gradovima:`);
  for (const [slug, n] of desc(byCity)) console.log(`  ${cityLabel(slug).padEnd(22)} ${n}`);

  console.log(`\nPo nišama:`);
  for (const [slug, n] of desc(byNiche)) console.log(`  ${slug.padEnd(22)} ${n}`);

  console.log(`\nPo statusu sajta:`);
  for (const [s, n] of desc(byStatus)) console.log(`  ${s.padEnd(22)} ${n}`);

  console.log(`\nPo bendu (samo sajtovi koji rade):`);
  for (const [s, n] of desc(byBand)) console.log(`  ${s.padEnd(22)} ${n}`);

  console.log(`\nMejlova spojeno: ${report.emailsAttached}`);

  if (report.duplicates.length) {
    console.log(`\nDuplikata po place_id: ${report.duplicates.length} (zadržan noviji scan)`);
  }

  if (report.skipped.length) {
    console.log(`\nPreskočeno redova: ${report.skipped.length}`);
    const byReason = new Map<string, number>();
    for (const s of report.skipped) bump(byReason, s.reason);
    for (const [reason, n] of desc(byReason)) console.log(`  ${reason}: ${n}`);
  }

  if (report.bandMismatches.length) {
    console.log(`\n⚠ Band iz CSV-a se razlikuje od izvedenog iz skora: ${report.bandMismatches.length}`);
    for (const m of report.bandMismatches.slice(0, 5)) {
      console.log(`  ${m.placeId}  skor ${m.score}: CSV "${m.csv}" → upisano "${m.derived}"`);
    }
  }

  if (report.unknownNiches.length) {
    const bySlug = new Map<string, string[]>();
    for (const u of report.unknownNiches) bySlug.set(u.slug, [...(bySlug.get(u.slug) ?? []), u.file]);
    console.log(`\n⚠ Niše kojih nema u taksonomiji (podatak bi bio nevidljiv u aplikaciji):`);
    for (const [slug, files] of bySlug) console.log(`  ${slug.padEnd(22)} ${files.join(", ")}`);
  }

  for (const w of report.warnings) console.log(`\n⚠ ${w}`);

  // Ove brojke idu na landing u F8 — otuda ovaj blok.
  console.log(`\nZa landing (F8): ${total} biznisa · ${nonOk} bez funkcionalnog sajta`);
}

// ── upis ───────────────────────────────────────────────────

/** place_id → google_refreshed_at, za sve što je već u bazi. */
async function existingBusinesses(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await db
      .from("businesses")
      .select("place_id, google_refreshed_at")
      .in("place_id", part);
    if (error) throw new Error(`Čitanje businesses nije uspelo: ${error.message}`);
    for (const row of (data ?? []) as { place_id: string; google_refreshed_at: string }[]) {
      found.set(row.place_id, row.google_refreshed_at);
    }
  }
  return found;
}

/** place_id → audit_level, za sve što je već u bazi. */
async function existingAudits(db: SupabaseClient, ids: string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await db
      .from("website_audits")
      .select("place_id, audit_level")
      .in("place_id", part);
    if (error) throw new Error(`Čitanje website_audits nije uspelo: ${error.message}`);
    for (const row of (data ?? []) as { place_id: string; audit_level: number }[]) {
      found.set(row.place_id, row.audit_level);
    }
  }
  return found;
}

async function write(db: SupabaseClient, records: SeedRecord[]): Promise<void> {
  const ids = records.map((r) => r.business.place_id);

  const already = await existingBusinesses(db, ids);
  const businesses = records
    .filter((r) => {
      const current = already.get(r.business.place_id);
      // Ako je neko već osvežio Google podatke posle ovog scana, ne vraćaj unazad.
      return !current || current <= r.business.google_refreshed_at;
    })
    .map((r) => r.business);

  const skippedFresh = records.length - businesses.length;
  if (skippedFresh > 0) {
    console.log(`  ${skippedFresh} biznisa preskočeno — u bazi su svežiji Google podaci`);
  }

  for (const part of chunks(businesses, CHUNK)) {
    const { error } = await db.from("businesses").upsert(part, { onConflict: "place_id" });
    if (error) throw new Error(`Upis businesses nije uspeo: ${error.message}`);
  }
  console.log(`  businesses: ${businesses.length} upisano`);

  // Audit tek posle biznisa — FK na businesses(place_id).
  const levels = await existingAudits(db, ids);
  const audits: AuditInsert[] = records
    .filter((r) => (levels.get(r.audit.place_id) ?? 1) <= 1)
    .map((r) => r.audit);

  const skippedEnriched = records.length - audits.length;
  if (skippedEnriched > 0) {
    console.log(`  ${skippedEnriched} audita preskočeno — već obogaćeni (audit_level > 1)`);
  }

  for (const part of chunks(audits, CHUNK)) {
    const { error } = await db.from("website_audits").upsert(part, { onConflict: "place_id" });
    if (error) throw new Error(`Upis website_audits nije uspeo: ${error.message}`);
  }
  console.log(`  website_audits: ${audits.length} upisano`);
}

// ── main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const program = new Command()
    .option("--dry", "samo parsiraj i prikaži izveštaj, ne diraj bazu", false)
    .option("--dir <putanja>", "direktorijum sa arhivom", "data/scanovi-arhiva");

  program.parse(process.argv.filter((a, i) => i < 2 || a !== "--"));
  const opts = program.opts<{ dry: boolean; dir: string }>();

  const dir = path.isAbsolute(opts.dir) ? opts.dir : path.join(workspaceRoot(), opts.dir);
  console.log(`Čitam arhivu: ${dir}`);

  const report = readArchive(dir);
  printReport(report, report.records);

  if (report.records.length === 0) {
    console.log(`\nNema šta da se upiše.`);
    return;
  }

  if (opts.dry) {
    console.log(`\n[--dry] Baza nije dirana.`);
    return;
  }

  // Upis pod nišom koje nema u `NICHES` je podatak koji niko nikad neće videti:
  // `/api/search` prima samo slugove iz taksonomije (F2 §2). Bolje je da seed
  // stane nego da baza tiho naraste za redove kojih u aplikaciji nema.
  if (report.unknownNiches.length > 0) {
    const slugovi = [...new Set(report.unknownNiches.map((u) => u.slug))];
    throw new Error(
      `Seed zaustavljen: ${slugovi.length} niša iz arhive ne postoji u taksonomiji ` +
        `(${slugovi.join(", ")}).\n` +
        `Ti redovi bi ušli u bazu, ali ih pretraga nikad ne bi vratila.\n\n` +
        `Reši ovako:\n` +
        `  a) dodaj nišu u packages/shared/src/taxonomy.ts, ili\n` +
        `  b) izmesti te fajlove iz arhive i pokreni seed nad direktorijumom bez njih\n` +
        `     (pnpm seed --dir putanja/do/direktorijuma).\n\n` +
        `Fajlovi: ${report.unknownNiches.map((u) => u.file).join(", ")}`,
    );
  }

  console.log(`\nUpisujem...`);
  await write(supabaseAdmin(), report.records);
  console.log(`\nGotovo.`);
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
