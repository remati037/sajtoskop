// scripts/backfill-screenshots.ts
// Ponovo upiši `enrich_full` za već otključane prospekte koji nemaju screenshot.
//
//   pnpm backfill:screenshots           # pregled, ništa se ne upisuje
//   pnpm backfill:screenshots -- --pisi # stvarno upiši poslove
//
// ── zašto ovo mora da postoji ──────────────────────────────
// `enrich_full` se upisuje isključivo na SVEŽ unlock (`reason === "unlocked"`).
// Ponovljeni klik vraća `already_unlocked` i namerno ne naručuje drugi
// screenshot — inače bi dupli klik koštao dva Playwright pokretanja.
//
// Posledica: lead otključan PRE nego što je `enrich_full` naučio da radi svoj
// posao ostaje zauvek bez snimka, a kroz UI nema načina da se to popravi.
// Isto će se ponoviti kad F6 doda PageSpeed i Claude — svaki lead otključan pre
// toga imaće `audit_level` niži nego što bi mogao.
//
// Skripta ne troši nijedan Google poziv i ne dira kredite: samo upisuje poslove.

import { loadRootEnv } from "../apps/worker/src/lib/env";
import { enqueueJob } from "../apps/worker/src/lib/queue";
import { supabaseAdmin } from "../apps/worker/src/lib/supabase";

loadRootEnv();

const pisi = process.argv.includes("--pisi");
const db = supabaseAdmin();

type UnlockRow = { user_id: string; place_id: string };
type AuditRow = { place_id: string; screenshot_desktop: string | null };
type BizRow = { place_id: string; name: string; website_url: string | null };

const { data: unlocks, error: uErr } = await db
  .from("unlocks")
  .select("user_id, place_id")
  .returns<UnlockRow[]>();

if (uErr) throw new Error(`Čitanje unlocks nije uspelo: ${uErr.message}`);

const svi = unlocks ?? [];
if (svi.length === 0) {
  console.log("Nema nijednog otključanog prospekta.");
  process.exit(0);
}

// Prvi vlasnik po `place_id` — posao ima jednog pretplatnika, a lead je isti za sve.
const vlasnik = new Map<string, string>();
for (const u of svi) if (!vlasnik.has(u.place_id)) vlasnik.set(u.place_id, u.user_id);

const ids = [...vlasnik.keys()];

const [{ data: audits, error: aErr }, { data: biz, error: bErr }] = await Promise.all([
  db
    .from("website_audits")
    .select("place_id, screenshot_desktop")
    .in("place_id", ids)
    .returns<AuditRow[]>(),
  db
    .from("businesses")
    .select("place_id, name, website_url")
    .in("place_id", ids)
    .returns<BizRow[]>(),
]);

if (aErr) throw new Error(`Čitanje website_audits nije uspelo: ${aErr.message}`);
if (bErr) throw new Error(`Čitanje businesses nije uspelo: ${bErr.message}`);

const imaSnimak = new Set((audits ?? []).filter((a) => a.screenshot_desktop).map((a) => a.place_id));
const firmaPoId = new Map((biz ?? []).map((b) => [b.place_id, b]));

const zaUpis: BizRow[] = [];
let preskoceno = 0;

for (const placeId of ids) {
  const firma = firmaPoId.get(placeId);
  // Biznis obrisan iz baze — posao ne bi imao šta da slika.
  if (!firma) continue;

  if (imaSnimak.has(placeId)) {
    preskoceno++;
    continue;
  }
  // Sloj 0: nema sajt. Nema šta da se slika i to nije nedostatak (PRD §5).
  if (!firma.website_url) {
    preskoceno++;
    continue;
  }

  zaUpis.push(firma);
}

console.log(`Otključanih prospekata: ${ids.length}`);
console.log(`Već imaju snimak ili nemaju sajt: ${preskoceno}`);
console.log(`Za ponovni enrich_full: ${zaUpis.length}\n`);

for (const f of zaUpis) console.log(`  ${f.place_id}  ${f.name}  → ${f.website_url}`);

if (zaUpis.length === 0) process.exit(0);

if (!pisi) {
  console.log("\nPregled. Za stvarni upis dodaj --pisi");
  process.exit(0);
}

let novih = 0;
let spojenih = 0;

for (const f of zaUpis) {
  // Isti `dedupeKey` kao u `apps/web/src/lib/jobs.ts` — ako posao za taj lead
  // već čeka u redu, ovaj se pridružuje njemu umesto da pravi drugi.
  const { joined } = await enqueueJob({
    type: "enrich_full",
    payload: { placeId: f.place_id },
    dedupeKey: f.place_id,
    userId: vlasnik.get(f.place_id) ?? null,
  });
  if (joined) spojenih++;
  else novih++;
}

console.log(`\nUpisano ${novih} novih poslova, ${spojenih} pridruženo postojećim.`);
console.log("Worker ih preuzima u sledećem krugu. Prati log.");
