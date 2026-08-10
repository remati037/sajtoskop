// scripts/rescore-audits.ts
// Ponovo izračunaj Ugly Score za audite koji nose lažan signal iz krnjeg `<head>`-a.
//
//   pnpm rescore                 # pregled, ništa se ne upisuje
//   pnpm rescore -- --pisi       # stvarno upiši nove skorove
//   pnpm rescore -- --sve        # svi `ok` auditi, ne samo oni sa no_viewport
//
// ── zašto ovo postoji ──────────────────────────────────────
// Do popravke u `packages/shared/src/ugly-score.ts` funkcija `head()` je tražila
// `<head>` regexom sa granicom od 20.000 znakova. Sajt sa dužim `<head>`-om je
// padao na prvih 20.000 znakova dokumenta, pa je sve iza toga bilo nevidljivo —
// i heuristika je upisivala `no_viewport` (30 poena) sajtu koji jeste prilagođen
// telefonu. Na matildabig.rs je to dalo skor 46 („ružan") umesto 12 („solidan").
//
// Skorovi upisani pre popravke ostaju pogrešni dok se ne preračunaju. Kod je
// popravljen, podaci nisu — a korisnik gleda podatke.
//
// ── zašto ne `enrich_basic` ────────────────────────────────
// Naizgled je dovoljno ponovo pustiti taj posao. Ali `upsertAudit` upisuje
// `audit_level: 1` bez uslova, pa bi svaki lead sa screenshotom, PSI-jem ili AI
// analizom (nivo 2 ili 3) bio oboren na 1. Podaci bi ostali u redu, ali bi
// `placeIdsNeedingAudit` posle toga smatrao da ih treba ponovo obogatiti — i
// platio bi drugi Playwright i drugi Claude poziv.
//
// Zato ova skripta dira ISKLJUČIVO četiri kolone skora i ništa drugo.
//
// Ne troši nijedan Google poziv i ne dira kredite. Poštuje robots.txt i razmak
// od 1s po domenu, jer ide kroz isti `fetchSite` kao i worker (pravilo 12).

// Relativno, ne kroz `@sajtoskop/shared`: koren monorepoa nema taj paket među
// zavisnostima, pa se ime razrešava samo unutar `apps/*`. Ostale skripte ga
// uvoze kao `import type`, što nestaje pri prevodu — ovde treba prava funkcija.
import { scoreSite } from "../packages/shared/src/index";
import type { Signal } from "../packages/shared/src/index";
import { loadRootEnv } from "../apps/worker/src/lib/env";
import { fetchSite } from "../apps/worker/src/lib/fetch-site";
import { supabaseAdmin } from "../apps/worker/src/lib/supabase";

loadRootEnv();

const pisi = process.argv.includes("--pisi");
const sve = process.argv.includes("--sve");

const db = supabaseAdmin();

type AuditRed = {
  place_id: string;
  site_status: string;
  audit_level: number;
  ugly_score: number | null;
  ugly_band: string | null;
  signals: Signal[];
};

type BizRed = { place_id: string; name: string; website_url: string | null };

const { data: auditi, error: aErr } = await db
  .from("website_audits")
  .select("place_id, site_status, audit_level, ugly_score, ugly_band, signals")
  .eq("site_status", "ok")
  .returns<AuditRed[]>();

if (aErr) throw new Error(`Čitanje website_audits nije uspelo: ${aErr.message}`);

// Bez `--sve`: samo oni koji nose `no_viewport`. To je otisak krnjeg `<head>`-a —
// sajt sa dugačkim `<head>`-om ga uvek dobije. Neki ga imaju s razlogom; njih
// preračun ostavlja nepromenjenim, pa je filter samo ušteda na zahtevima.
const kandidati = (auditi ?? []).filter(
  (r) => sve || (r.signals ?? []).some((s) => s.key === "no_viewport"),
);

if (kandidati.length === 0) {
  console.log("Nema kandidata za preračun.");
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

console.log(`Kandidata za preračun: ${kandidati.length}${pisi ? "" : "  (pregled)"}\n`);

let promenjeno = 0;
let isto = 0;
let neuspelo = 0;

for (const red of kandidati) {
  const firma = firme.get(red.place_id);
  if (!firma?.website_url) {
    neuspelo++;
    continue;
  }

  const site = await fetchSite(firma.website_url);

  if (site.status !== "ok" || !site.html) {
    // Sajt se u međuvremenu ugasio ili nas robots.txt odbija. Status NE diramo —
    // ova skripta preračunava skor, ne utvrđuje da li je sajt živ.
    console.log(`  ~ ${firma.name.padEnd(28).slice(0, 28)} ${site.status}, preskačem`);
    neuspelo++;
    continue;
  }

  const nov = scoreSite({
    html: site.html,
    httpsOk: site.httpsOk,
    loadMs: site.loadMs,
    finalUrl: site.finalUrl,
  });

  if (nov.score === red.ugly_score && nov.band === red.ugly_band) {
    isto++;
    continue;
  }

  promenjeno++;
  const strelica = nov.score < (red.ugly_score ?? 0) ? "↓" : "↑";
  console.log(
    `  ${strelica} ${firma.name.padEnd(28).slice(0, 28)} ` +
      `${String(red.ugly_score).padStart(3)} (${red.ugly_band}) → ` +
      `${String(nov.score).padStart(3)} (${nov.band})` +
      (red.audit_level > 1 ? `   [nivo ${red.audit_level}, ne diram]` : ""),
  );

  if (!pisi) continue;

  // ISKLJUČIVO kolone skora. `audit_level`, screenshotovi, PSI i AI ostaju.
  const { error } = await db
    .from("website_audits")
    .update({
      ugly_score: nov.score,
      ugly_band: nov.band,
      platform: nov.platform,
      signals: nov.signals,
    })
    .eq("place_id", red.place_id);

  if (error) throw new Error(`Upis za ${red.place_id} nije uspeo: ${error.message}`);
}

console.log(
  `\nPromenjeno: ${promenjeno} · nepromenjeno: ${isto} · nedostupno: ${neuspelo}`,
);

if (!pisi && promenjeno > 0) {
  console.log("\nPregled. Za stvarni upis dodaj --pisi");
}
