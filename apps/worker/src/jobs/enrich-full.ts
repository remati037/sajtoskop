// apps/worker/src/jobs/enrich-full.ts
// Skup enrichment, isključivo lazy — posao se kreira na unlock i nikad u bulk
// scanu (pravilo 5). Jedan `enrich_full` = jedan lead za kog je korisnik platio kredit.
//
// F5: screenshot desktop + mobilni (Playwright)
// F6: PageSpeed mobile score + Claude vision analiza
//
// ── redosled i ko sme da padne ─────────────────────────────
//   1. screenshot   — bez njega nema ni AI koraka; njegov neuspeh je ishod posla
//   2. PageSpeed    — sme da padne, `psi_mobile_score` ostaje null (PRD §1)
//   3. Claude       — sme da padne ili da bude preskočen zbog capa (PRD §3)
//
// Posle koraka 1 nijedan izuzetak ne izlazi iz posla. Korisnik je platio kredit
// za kontakt i vizuelni dokaz; skor i AI su dodatak, a pala grana bi ovde značila
// ponovno slikanje istog sajta pri sledećem pokušaju — i drugi Playwright poziv.
//
// Ishodi po PRD-u §5 — sajt koji se ne otvara je dobar lead, ne greška:
//
//   sajt se otvorio          → dva webp-a u bucket, putanje u website_audits
//   4xx / 5xx                → screenshot stranice greške (to posetilac i vidi)
//   timeout / DNS / TLS      → site_status = 'mrtav', bez screenshota
//   blokiran SSRF-om         → ništa upisano, razlog u `last_error` posla
//   robots.txt zabranjuje    → ništa upisano, tiho preskočeno (pravilo 12)
//
// Nijedan od ovih ishoda ne vraća kredit. Korisnik je platio kontakt podatke,
// a njih ima i kad sajt ne radi — u tom slučaju su čak i vredniji.

import { analyzeScreenshots } from "../lib/ai-audit";
import {
  getAudit,
  markSiteDead,
  saveAiAnalysis,
  savePsi,
  saveScreenshots,
} from "../lib/db-writes";
import { getBusinessSite } from "../lib/db-writes";
import { pageSpeedMobile } from "../lib/pagespeed";
import { UnsafeUrlError } from "../lib/safe-url";
import {
  captureSite,
  CrawlBlockedError,
  screenshotPath,
  SiteUnreachableError,
  type ShotVariant,
} from "../lib/screenshot";
import { removeScreenshots, uploadScreenshot } from "../lib/storage";
import type { JobContext, JobResult } from "./types";
import { enrichFullPayloadSchema } from "./types";

export async function runEnrichFull(raw: unknown, ctx: JobContext): Promise<JobResult> {
  const { placeId } = enrichFullPayloadSchema.parse(raw);

  const business = await getBusinessSite(placeId);
  if (!business) {
    // Biznis je u međuvremenu obrisan. Ponavljanje ne bi pomoglo.
    return { note: `${placeId}: biznisa više nema u bazi, preskačem` };
  }

  if (!business.website_url) {
    // `nema_sajt` je Sloj 0 i najbolji mogući lead. Nema šta da se slika.
    return { note: `${business.name}: nema sajt, nema šta da se slika` };
  }

  const existing = await getAudit(placeId);

  // ── slikanje ─────────────────────────────────────────────
  let captured: Awaited<ReturnType<typeof captureSite>>;

  try {
    captured = await captureSite(business.website_url);
  } catch (err) {
    if (err instanceof UnsafeUrlError && err.kind === "blocked") {
      // Ne upisujemo NIŠTA. URL koji vodi na privatnu adresu nije podatak o
      // sajtu nego pokušaj da nas neko iskoristi — pa i kad je slučajan.
      ctx.log(`${business.name}: SSRF blokada — ${err.message}`);
      throw new Error(`SSRF: ${err.code} (${err.url})`);
    }

    if (err instanceof CrawlBlockedError) {
      ctx.log(`${business.name}: ${err.message}`);
      return { note: `${business.name}: preskočen zbog robots.txt` };
    }

    // `UnsafeUrlError` sa `kind === "unreachable"` je ugašen domen ili petlja u
    // redirekcijama — isti ishod kao pregledač koji ne uspeva da otvori sajt.
    if (err instanceof SiteUnreachableError || err instanceof UnsafeUrlError) {
      // Zatečen `ok` sa skorom se ne obara — obrazloženje je u `markSiteDead`.
      if (existing && existing.site_status === "ok") {
        ctx.log(`${business.name}: pregledač ne uspeva da otvori sajt, status ostaje 'ok'`);
        return { note: `${business.name}: sajt se ne otvara u pregledaču, bez screenshota` };
      }

      await markSiteDead(placeId);
      return { note: `${business.name}: sajt se ne otvara → mrtav` };
    }

    throw err;
  }

  // ── otpremanje ───────────────────────────────────────────
  const paths: Partial<Record<ShotVariant, string>> = {};

  for (const shot of captured.shots) {
    const path = screenshotPath(placeId, shot.variant);
    await uploadScreenshot(path, shot.webp);
    paths[shot.variant] = path;
  }

  await saveScreenshots({
    placeId,
    desktopPath: paths.desktop ?? null,
    mobilePath: paths.mobile ?? null,
    finalUrl: captured.finalUrl,
    httpStatus: captured.httpStatus,
    existing,
  });

  // Tek posle uspešnog upisa u bazu. Obrnut redosled bi na pao upis ostavio
  // audit koji pokazuje na fajl kog više nema.
  await removeScreenshots([
    paths.desktop ? existing?.screenshot_desktop ?? null : null,
    paths.mobile ? existing?.screenshot_mobile ?? null : null,
  ]);

  const kb = Math.round(captured.shots.reduce((n, s) => n + s.webp.length, 0) / 1024);
  const which = captured.shots.map((s) => s.variant).join(" + ");

  // ── PageSpeed (F6 §1) ────────────────────────────────────
  // Od ove tačke nijedan korak ne sme da obori posao: screenshotovi su upisani,
  // korisnik je dobio ono za šta je platio kredit. Skor i AI su dodatak.

  let psiScore: number | null = null;

  try {
    const psi = await pageSpeedMobile(captured.finalUrl);

    if (psi.status === "ok") {
      await savePsi(placeId, psi);
      psiScore = psi.score;
      ctx.log(
        `${business.name}: PSI ${psi.score ?? "—"}/100` +
          (psi.lcpMs === null ? "" : `, LCP ${(psi.lcpMs / 1000).toFixed(1)}s`),
      );
    } else {
      ctx.log(`${business.name}: PSI preskočen — ${psi.note}`);
    }
  } catch (err) {
    // Ovde stiže samo nedostupna baza (budžet ili upis). Sam PSI ne baca.
    ctx.log(`${business.name}: PSI korak pukao — ${message(err)}`);
  }

  // ── Claude analiza (F6 §2) ───────────────────────────────

  let aiNote = "bez AI";

  try {
    const ai = await analyzeScreenshots({
      shots: captured.shots,
      signals: existing?.signals ?? [],
      platform: existing?.platform ?? null,
      uglyScore: existing?.ugly_score ?? null,
      psiMobileScore: psiScore,
    });

    if (ai.status === "ok") {
      await saveAiAnalysis(placeId, {
        issues: ai.issues,
        verdict: ai.verdict,
        solidan: ai.solidan,
      });
      aiNote =
        `AI ${ai.issues.length} stavki` +
        (ai.solidan ? " (sajt uredan)" : "") +
        `, $${ai.usage.costUsd.toFixed(4)}`;
      ctx.log(
        `${business.name}: ${aiNote} ` +
          `(${ai.usage.inputTokens}→${ai.usage.outputTokens} tokena, ` +
          `${ai.usage.attempts} poziv${ai.usage.attempts === 1 ? "" : "a"})`,
      );
    } else {
      aiNote = ai.status === "capped" ? "AI preskočen (cap)" : "AI pao";
      ctx.log(`${business.name}: ${aiNote} — ${ai.note}`);
    }
  } catch (err) {
    // Nema API ključa ili baza nije dostupna. Lead ostaje na audit_level 2.
    ctx.log(`${business.name}: AI korak pukao — ${message(err)}`);
  }

  return { note: `${business.name}: ${which} (${kb}KB) · ${aiNote}` };
}

function message(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n")[0] ?? err.name) : String(err);
}
