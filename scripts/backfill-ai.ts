// scripts/backfill-ai.ts
// Popuni PSI i Claude analizu za već otključane prospekte koji imaju snimak.
//
//   pnpm backfill:ai                 # pregled, ništa se ne upisuje i ništa ne košta
//   pnpm backfill:ai -- --pisi       # stvarno pozovi PSI i Claude, pa upiši
//   pnpm backfill:ai -- --pisi --sve # i one koji nisu otključani (v. upozorenje)
//
// ── zašto ovo postoji ──────────────────────────────────────
// `enrich_full` radi ceo lanac: screenshot → PSI → AI. Ali lead otključan pre
// nego što je F6 postojao ima snimak i stoji na `audit_level = 2` — a
// `backfill-screenshots.ts` ga preskače baš zato što snimak IMA.
//
// Posledica: prospekt koji je korisnik platio nikad ne dobije analizu, i kroz UI
// nema načina da se to popravi. Ovo je taj put.
//
// Ponovno slikanje se namerno NE radi: snimci već postoje u bucketu, a drugi
// Playwright prolaz je najskuplji deo lanca i ničemu ne služi.
//
// ── šta ovo košta ──────────────────────────────────────────
// Jedan Claude poziv po prospektu (~$0.015) i jedan PSI poziv (besplatan, ali
// ulazi u dnevni cap). Oba prolaze kroz `consume_side_call`, isto kao iz workera.
// Bez `--pisi` se ne troši ništa.

import { loadRootEnv } from "../apps/worker/src/lib/env";
import { analyzeScreenshots } from "../apps/worker/src/lib/ai-audit";
import { savePsi, saveAiAnalysis } from "../apps/worker/src/lib/db-writes";
import { pageSpeedMobile } from "../apps/worker/src/lib/pagespeed";
import { SCREENSHOT_BUCKET } from "../apps/worker/src/lib/storage";
import { supabaseAdmin } from "../apps/worker/src/lib/supabase";
import type { Platform, Signal } from "../packages/shared/src/index";

loadRootEnv();

const pisi = process.argv.includes("--pisi");
const sve = process.argv.includes("--sve");

const db = supabaseAdmin();

type AuditRed = {
  place_id: string;
  audit_level: number;
  ugly_score: number | null;
  ugly_band: string | null;
  platform: Platform | null;
  signals: Signal[];
  psi_mobile_score: number | null;
  screenshot_desktop: string | null;
  screenshot_mobile: string | null;
  final_url: string | null;
};

type BizRed = { place_id: string; name: string; website_url: string | null };

// Kandidati: imaju snimak, a nisu na nivou 3 (dakle bez AI analize).
const { data: auditi, error: aErr } = await db
  .from("website_audits")
  .select(
    "place_id, audit_level, ugly_score, ugly_band, platform, signals, " +
      "psi_mobile_score, screenshot_desktop, screenshot_mobile, final_url",
  )
  .not("screenshot_desktop", "is", null)
  .lt("audit_level", 3)
  .returns<AuditRed[]>();

if (aErr) throw new Error(`Čitanje website_audits nije uspelo: ${aErr.message}`);

let kandidati = auditi ?? [];

// Pravilo 5: skup enrichment ide na unlock. Bez `--sve` se poštuje i ovde —
// analiza se dopunjava samo onima za koje je kredit već naplaćen.
if (!sve) {
  const { data: otkljucani, error: uErr } = await db
    .from("unlocks")
    .select("place_id")
    .returns<{ place_id: string }[]>();

  if (uErr) throw new Error(`Čitanje unlocks nije uspelo: ${uErr.message}`);
  const skup = new Set((otkljucani ?? []).map((u) => u.place_id));
  kandidati = kandidati.filter((r) => skup.has(r.place_id));
}

if (kandidati.length === 0) {
  console.log(
    "Nema kandidata: svaki prospekt sa snimkom je ili već na nivou 3 ili nije otključan.\n" +
      "Sa `--sve` obuhvata i neotključane.",
  );
  process.exit(0);
}

const { data: biz, error: bErr } = await db
  .from("businesses")
  .select("place_id, name, website_url")
  .in(
    "place_id",
    kandidati.map((r) => r.place_id),
  )
  .returns<BizRed[]>();

if (bErr) throw new Error(`Čitanje businesses nije uspelo: ${bErr.message}`);
const firme = new Map((biz ?? []).map((b) => [b.place_id, b]));

console.log(`Prospekata za dopunu: ${kandidati.length}${pisi ? "" : "  (pregled — ništa se ne troši)"}\n`);

for (const red of kandidati) {
  const firma = firme.get(red.place_id);
  console.log(`  ${firma?.name ?? red.place_id}  ·  nivo ${red.audit_level}  ·  skor ${red.ugly_score ?? "—"}`);
}

if (!pisi) {
  console.log("\nZa stvarni poziv dodaj --pisi");
  process.exit(0);
}

async function skini(path: string | null): Promise<Buffer | null> {
  if (!path) return null;
  const { data, error } = await db.storage.from(SCREENSHOT_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

console.log("");
let uspelo = 0;
let palo = 0;
let ukupnoUsd = 0;

for (const red of kandidati) {
  const firma = firme.get(red.place_id);
  const ime = firma?.name ?? red.place_id;

  // ── PSI ─────────────────────────────────────────────────
  let psiScore = red.psi_mobile_score;
  const url = red.final_url ?? firma?.website_url;

  if (url && psiScore === null) {
    const psi = await pageSpeedMobile(url);
    if (psi.status === "ok") {
      await savePsi(red.place_id, psi);
      psiScore = psi.score;
      console.log(`  ${ime}: PSI ${psi.score ?? "—"}/100`);
    } else {
      console.log(`  ${ime}: PSI preskočen — ${psi.note}`);
    }
  }

  // ── AI ──────────────────────────────────────────────────
  const [desktop, mobile] = await Promise.all([
    skini(red.screenshot_desktop),
    skini(red.screenshot_mobile),
  ]);

  const shots: { variant: "desktop" | "mobile"; webp: Buffer }[] = [];
  if (desktop) shots.push({ variant: "desktop", webp: desktop });
  if (mobile) shots.push({ variant: "mobile", webp: mobile });

  if (shots.length === 0) {
    console.log(`  ${ime}: snimci se ne skidaju iz bucketa, preskačem`);
    palo++;
    continue;
  }

  const ai = await analyzeScreenshots({
    shots,
    signals: red.signals ?? [],
    platform: red.platform,
    uglyScore: red.ugly_score,
    psiMobileScore: psiScore,
    businessName: firma?.name,
  });

  if (ai.status !== "ok") {
    console.log(`  ${ime}: AI ${ai.status} — ${ai.note}`);
    palo++;
    continue;
  }

  await saveAiAnalysis(red.place_id, {
    issues: ai.issues,
    verdict: ai.verdict,
    solidan: ai.solidan,
  });

  uspelo++;
  ukupnoUsd += ai.usage.costUsd;
  console.log(
    `  ${ime}: ${ai.issues.length} stavki${ai.solidan ? " (sajt uredan)" : ""}` +
      ` · $${ai.usage.costUsd.toFixed(4)} · nivo 3 ✓`,
  );
}

console.log(`\nDopunjeno: ${uspelo} · palo: ${palo} · ukupno $${ukupnoUsd.toFixed(4)}`);
