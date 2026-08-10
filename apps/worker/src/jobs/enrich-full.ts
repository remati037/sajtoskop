// apps/worker/src/jobs/enrich-full.ts
// Skup enrichment, isključivo lazy — posao se kreira na unlock i nikad u bulk
// scanu (pravilo 5). Jedan `enrich_full` = jedan lead za kog je korisnik platio kredit.
//
// F5: screenshot desktop + mobilni (Playwright)
// F6: PageSpeed mobile score + Claude vision analiza
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

import { getAudit, markSiteDead, saveScreenshots } from "../lib/db-writes";
import { getBusinessSite } from "../lib/db-writes";
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

  return { note: `${business.name}: ${which} (${kb}KB)` };
}
