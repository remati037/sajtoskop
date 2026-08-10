// scripts/probe-ai.ts
// Pusti Claude prompt na postojeće screenshotove iz baze i ispiši šta se dobije.
//
//   pnpm probe:ai                      # 3 leada, podrazumevani model
//   pnpm probe:ai -- --broj=5          # pet leada
//   pnpm probe:ai -- --place=ChIJ...   # tačno određen prospekt
//   ANTHROPIC_MODEL=claude-haiku-4-5 pnpm probe:ai    # poređenje modela
//
// ── čemu služi ─────────────────────────────────────────────
// Ovo je kapija pred integraciju iz F6 §2: pre nego što AI korak počne da radi
// na svakom unlocku, na tri stvarna sajta se vidi (a) da li je izlaz upotrebljiv
// na srpskom i (b) koliko poziv stvarno košta. Bez toga se cena procenjuje iz
// glave, a F6 je jedina faza koja troši stvaran novac po zahtevu.
//
// Skripta NE upisuje ništa u bazu. Samo čita screenshotove i ispisuje odgovor.
// Ali TROŠI: svaki lead je jedan Claude poziv i ulazi u dnevni cap (`ai:audit`),
// isto kao da je došao iz workera. Zato tri, a ne sto — PRD §3, doslovno:
// „Nikad 'da probamo na 100 sajtova da vidimo kako izgleda' — probaj na tri."

import { aiModel, analyzeScreenshots, estimateCostUsd } from "../apps/worker/src/lib/ai-audit";
import { loadRootEnv } from "../apps/worker/src/lib/env";
import { dailyCapFor, SIDE_KIND } from "../apps/worker/src/lib/side-budget";
import { SCREENSHOT_BUCKET } from "../apps/worker/src/lib/storage";
import { supabaseAdmin } from "../apps/worker/src/lib/supabase";
import type { AiIssue, Platform, Signal } from "@sajtoskop/shared";

loadRootEnv();

// ── argumenti ──────────────────────────────────────────────

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const brojArg = Math.max(1, Math.min(10, Number(arg("broj") ?? 3)));
/** `--place=a,b,c` — kad hoćeš tačno određene sajtove, a ne tri najgora. */
const samoPlace = (arg("place") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const broj = samoPlace.length > 0 ? samoPlace.length : brojArg;

/**
 * Žargon koji u `evidence` rečenici ne sme da postoji (F6 §2, sekcija evidence).
 *
 * To polje ide pravo u poruku strancu — vlasnik pekare ne zna šta je viewport i
 * ako to pročita, poruka je otpisana. Prompt to traži rečima; ovde se proverava.
 *
 * Granice reči su namerno različite po stavci: `meta` mora da bude cela reč
 * (inače hvata „metalna"), a `optimizovan` sme da ima nastavak („optimizovana").
 */
const ZARGON: { rec: string; re: RegExp }[] = [
  { rec: "viewport", re: /\bviewport/i },
  { rec: "meta", re: /\bmeta\b/i },
  { rec: "responsive", re: /\bresponsive/i },
  { rec: "responzivan", re: /\bresponziv/i },
  { rec: "SSL", re: /\bssl\b/i },
  { rec: "sertifikat", re: /\bsertifikat/i },
  { rec: "optimizovan", re: /\boptimizovan/i },
  { rec: "jQuery", re: /\bjquery/i },
  { rec: "tag", re: /\btag(ov)?\w{0,2}\b/i },
  { rec: "framework", re: /\bframework/i },
  { rec: "CSS", re: /\bcss\b/i },
];

function nadjiZargon(tekst: string): string | null {
  for (const z of ZARGON) if (z.re.test(tekst)) return z.rec;
  return null;
}

// ── boje, taman toliko da se skenira okom ──────────────────

const boja = process.stdout.isTTY;
const c = (kod: string, s: string) => (boja ? `\x1b[${kod}m${s}\x1b[0m` : s);
const naslov = (s: string) => c("1", s);
const prigušeno = (s: string) => c("90", s);

const BEDŽ: Record<AiIssue["severity"], string> = {
  visoka: c("41;97", " VISOKA "),
  srednja: c("43;30", " SREDNJA "),
  niska: c("100;97", " NISKA "),
};

// ── podaci ─────────────────────────────────────────────────

type AuditRed = {
  place_id: string;
  screenshot_desktop: string | null;
  screenshot_mobile: string | null;
  ugly_score: number | null;
  ugly_band: string | null;
  platform: Platform | null;
  signals: Signal[];
  psi_mobile_score: number | null;
};

type BizRed = { place_id: string; name: string; website_url: string | null };

const db = supabaseAdmin();

let upit = db
  .from("website_audits")
  .select(
    "place_id, screenshot_desktop, screenshot_mobile, ugly_score, ugly_band, " +
      "platform, signals, psi_mobile_score",
  )
  .not("screenshot_desktop", "is", null)
  // Najgori prvi: na njima se vidi da li model ume da imenuje problem, a ne
  // samo da prepriča da sajt postoji.
  .order("ugly_score", { ascending: false, nullsFirst: false })
  .limit(broj);

if (samoPlace.length > 0) upit = upit.in("place_id", samoPlace);

const { data: auditi, error: aErr } = await upit.returns<AuditRed[]>();
if (aErr) throw new Error(`Čitanje website_audits nije uspelo: ${aErr.message}`);

const redovi = auditi ?? [];
if (redovi.length === 0) {
  console.log(
    "Nema nijednog audita sa screenshotom.\n" +
      "Otključaj bar jedan prospekt u aplikaciji (ili pusti `pnpm backfill:screenshots -- --pisi`)\n" +
      "pa pokreni ovo ponovo.",
  );
  process.exit(0);
}

const { data: biz, error: bErr } = await db
  .from("businesses")
  .select("place_id, name, website_url")
  .in(
    "place_id",
    redovi.map((r) => r.place_id),
  )
  .returns<BizRed[]>();

if (bErr) throw new Error(`Čitanje businesses nije uspelo: ${bErr.message}`);
const firme = new Map((biz ?? []).map((b) => [b.place_id, b]));

// ── preuzimanje snimaka ────────────────────────────────────

async function skini(path: string | null): Promise<Buffer | null> {
  if (!path) return null;

  const { data, error } = await db.storage.from(SCREENSHOT_BUCKET).download(path);
  if (error || !data) {
    console.log(prigušeno(`   (snimak ${path} se ne skida: ${error?.message ?? "prazno"})`));
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

// ── prolaz ─────────────────────────────────────────────────

const model = aiModel();

console.log(naslov(`\nModel: ${model}`));
console.log(prigušeno(`Dnevni cap za ${SIDE_KIND.ai}: ${dailyCapFor(SIDE_KIND.ai)} poziva`));
console.log(prigušeno(`Prospekata u probi: ${redovi.length}\n`));

let ukupnoUsd = 0;
let ukupnoUlaz = 0;
let ukupnoIzlaz = 0;
let uspelo = 0;

for (const [i, red] of redovi.entries()) {
  const firma = firme.get(red.place_id);
  const ime = firma?.name ?? red.place_id;

  console.log(naslov(`\n${"─".repeat(72)}`));
  console.log(naslov(`${i + 1}. ${ime}`));
  console.log(
    prigušeno(
      `   ${firma?.website_url ?? "(bez sajta)"} · Ugly Score ${red.ugly_score ?? "—"}` +
        ` (${red.ugly_band ?? "—"}) · ${red.platform ?? "nepoznata platforma"}` +
        ` · PSI ${red.psi_mobile_score ?? "—"}`,
    ),
  );

  const [desktop, mobile] = await Promise.all([
    skini(red.screenshot_desktop),
    skini(red.screenshot_mobile),
  ]);

  const shots: { variant: "desktop" | "mobile"; webp: Buffer }[] = [];
  if (desktop) shots.push({ variant: "desktop", webp: desktop });
  if (mobile) shots.push({ variant: "mobile", webp: mobile });

  if (shots.length === 0) {
    console.log("   nijedan snimak nije preuzet, preskačem");
    continue;
  }

  const kb = Math.round(shots.reduce((n, s) => n + s.webp.length, 0) / 1024);
  console.log(
    prigušeno(`   snimci: ${shots.map((s) => s.variant).join(" + ")} (${kb}KB pre smanjenja)`),
  );

  const start = Date.now();
  const rezultat = await analyzeScreenshots({
    shots,
    signals: red.signals ?? [],
    platform: red.platform,
    uglyScore: red.ugly_score,
    psiMobileScore: red.psi_mobile_score,
    // Naziv se NE šalje modelu — služi samo proveri da nije procurio u odgovor.
    businessName: firma?.name,
  });
  const sekundi = ((Date.now() - start) / 1000).toFixed(1);

  if (rezultat.status !== "ok") {
    console.log(`   ${c("31", rezultat.status.toUpperCase())}: ${rezultat.note}`);
    if (rezultat.status === "failed") {
      ukupnoUlaz += rezultat.usage.inputTokens;
      ukupnoIzlaz += rezultat.usage.outputTokens;
      ukupnoUsd += rezultat.usage.costUsd;
    }
    continue;
  }

  uspelo++;
  ukupnoUlaz += rezultat.usage.inputTokens;
  ukupnoIzlaz += rezultat.usage.outputTokens;
  ukupnoUsd += rezultat.usage.costUsd;

  const oboren = rezultat.solidanModel && !rezultat.solidan;
  console.log(
    `\n   ${naslov("solidan:")} ${rezultat.solidan ? c("32", "true") : c("31", "false")}` +
      `   ${naslov("stavki:")} ${rezultat.issues.length}` +
      (oboren
        ? c(
            "33",
            `   ← model je rekao true, oborio Ugly Score ${red.ugly_score} (${red.ugly_band})`,
          )
        : ""),
  );

  console.log("");
  for (const p of rezultat.issues) {
    const dokaz = (p as { evidence?: string }).evidence ?? "(bez evidence)";
    console.log(`   ${BEDŽ[p.severity]} ${naslov(p.title)}`);
    console.log(`           ${p.detail}`);
    console.log(`           ${c("36", `evidence: „${dokaz}"`)}`);
  }

  console.log(`\n   ${naslov("Rečenica za poruku (verdict):")}`);
  console.log(`   „${rezultat.verdict}"`);

  // ── žargon u evidence rečenicama ───────────────────────
  // Ovo NIJE upozorenje nego prekid: `evidence` sa žargonom znači da je prompt
  // pao na svom najvažnijem pravilu, a ta rečenica ide strancu u poruku.
  for (const p of rezultat.issues) {
    const dokaz = (p as { evidence?: string }).evidence;
    if (!dokaz) continue;
    const nadjeno = nadjiZargon(dokaz);
    if (nadjeno) {
      console.log(
        c("41;97", `\n  PREKID: evidence sadrži žargon „${nadjeno}"  `) +
          `\n  Rečenica: „${dokaz}"` +
          `\n  Lead: ${ime} (${red.place_id})` +
          `\n\n  Prompt je pao na pravilu iz sekcije „# evidence".` +
          `\n  Popravi RULES u apps/worker/src/lib/ai-audit.ts pa pusti ponovo.`,
      );
      process.exit(1);
    }
  }

  console.log(
    prigušeno(
      `\n   ${rezultat.usage.inputTokens} ulaznih → ${rezultat.usage.outputTokens} izlaznih tokena` +
        ` · ${rezultat.usage.attempts} poziv${rezultat.usage.attempts === 1 ? "" : "a"}` +
        ` · ${sekundi}s · $${rezultat.usage.costUsd.toFixed(4)}`,
    ),
  );

  // Bez dijakritike izlaz nije upotrebljiv u poruci — provera koju je lakše
  // propustiti okom nego mašinom (CLAUDE.md, sekcija Jezik).
  const svTekst =
    rezultat.issues
      .map((p) => `${p.title} ${p.detail} ${(p as { evidence?: string }).evidence ?? ""}`)
      .join(" ") + rezultat.verdict;
  if (!/[čćšžđČĆŠŽĐ]/.test(svTekst)) {
    console.log(c("33", "   ⚠ nema nijednog dijakritičkog znaka — proveri prompt"));
  }
  if (/[а-яА-Я]/.test(svTekst)) {
    console.log(c("33", "   ⚠ izlaz sadrži ćirilicu, a traži se latinica"));
  }
}

// ── zbir ───────────────────────────────────────────────────

console.log(naslov(`\n${"═".repeat(72)}`));

if (uspelo === 0) {
  console.log("Nijedna analiza nije prošla. Cena ostaje neprocenjena.");
  process.exit(1);
}

const poPozivu = ukupnoUsd / uspelo;

console.log(naslov("Trošak"));
console.log(`  Uspešnih analiza:      ${uspelo}/${redovi.length}`);
console.log(`  Tokeni:                ${ukupnoUlaz} ulaznih, ${ukupnoIzlaz} izlaznih`);
console.log(`  Ukupno:                $${ukupnoUsd.toFixed(4)}`);
console.log(naslov(`  Po pozivu:             $${poPozivu.toFixed(4)}`));

// Gornja granica iz F6 §3: 20 beta korisnika × 30 kredita = 600 unlockova mesečno.
// Tu granicu drži kreditni sistem, ne dobra volja — zato krediti postoje i u beti.
const mesecno = poPozivu * 600;
console.log(
  `  600 unlockova mesečno: $${mesecno.toFixed(2)}` +
    prigušeno(`  (gornja granica koju drži kreditni sistem)`),
);
console.log(
  `  Dnevni cap (${dailyCapFor(SIDE_KIND.ai)}):        $${(poPozivu * dailyCapFor(SIDE_KIND.ai)).toFixed(2)} najviše dnevno`,
);

if (estimateCostUsd(model, 1_000_000, 0) === 0) {
  console.log(
    c(
      "33",
      `\n⚠ Cena za ${model} nije u tabeli (apps/worker/src/lib/ai-audit.ts, PRICES),\n` +
        `  pa su svi iznosi gore nule. Dodaj model u tabelu pa pusti ponovo.`,
    ),
  );
  process.exit(0);
}

console.log(
  prigušeno(
    `\nProcena je po punoj ceni modela (${model}: ` +
      `$${estimateCostUsd(model, 1_000_000, 0).toFixed(2)}/M ulaz, ` +
      `$${estimateCostUsd(model, 0, 1_000_000).toFixed(2)}/M izlaz).` +
      `\nMerodavan je jedino broj u Anthropic konzoli — tamo proveri i da spend limit stoji.`,
  ),
);
