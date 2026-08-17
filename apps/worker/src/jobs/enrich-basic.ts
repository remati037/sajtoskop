// apps/worker/src/jobs/enrich-basic.ts
// Sloj 0 i sloj 1 Ugly Score-a: preuzmi sajt, oceni HTML, pokupi mejlove.
// Nula Google poziva — sve što ovaj posao radi je besplatno.
//
// Skup enrichment (screenshot, PageSpeed, Claude) NE ide ovde nego isključivo
// lazy, na unlock (pravilo 5). Ovaj posao se pokreće bulk, po biznisu.

import { extractEmails, scoreSite } from "@sajtoskop/shared";
import { getBusinessSite, inkrementirajAnalizu, upsertAudit } from "../lib/db-writes";
import { fetchSite, UA } from "../lib/fetch-site";
import { mayCrawl } from "../lib/robots";
import type { JobContext, JobResult } from "./types";
import { enrichBasicPayloadSchema } from "./types";

/**
 * Dodatne putanje na kojima domaći sajtovi drže mejl kad ga nema na naslovnoj.
 * Namerno kratka lista: svaka putanja je još jedan zahtev ka istom domenu, a
 * razmak je 1s, pa tri putanje znače tri sekunde po biznisu.
 */
const CONTACT_PATHS = ["/kontakt", "/contact"];

async function fetchContactPage(origin: string, path: string): Promise<string | null> {
  const url = `${origin}${path}`;

  const gate = await mayCrawl(url, UA);
  if (!gate.allowed) return null;

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    return (await res.text()).slice(0, 2_000_000);
  } catch {
    return null;
  }
}

export async function runEnrichBasic(raw: unknown, ctx: JobContext): Promise<JobResult> {
  const { placeId, scanJobId } = enrichBasicPayloadSchema.parse(raw);

  const business = await getBusinessSite(placeId);
  if (!business) {
    // Biznis je u međuvremenu obrisan. Ovo nije greška — nema šta da se ponavlja.
    return { note: `${placeId}: biznisa više nema u bazi, preskačem` };
  }

  const site = await fetchSite(business.website_url);

  if (site.status === "blocked") {
    // Bez audita. Sajt kome nam robots.txt zabranjuje pristup nije ni mrtav ni
    // ružan — o njemu nemamo pravo da tvrdimo ništa (pravilo 12).
    ctx.log(`${business.name}: ${site.error}`);
    return { note: `${business.name}: preskočen zbog robots.txt` };
  }

  const score =
    site.status === "ok" && site.html
      ? scoreSite({
          html: site.html,
          httpsOk: site.httpsOk,
          loadMs: site.loadMs,
          finalUrl: site.finalUrl,
        })
      : null;

  // ── mejlovi ──────────────────────────────────────────────
  let emails: string[] = [];

  if (site.html && site.finalUrl) {
    let host = "";
    let origin = "";
    try {
      const u = new URL(site.finalUrl);
      host = u.hostname;
      origin = u.origin;
    } catch {
      /* finalUrl je uvek iz fetch-a, ali ne oslanjaj se na to */
    }

    emails = extractEmails(site.html, host);

    // Naslovna često nema mejl; /kontakt gotovo uvek ima. Dva dodatna zahteva
    // po biznisu su prihvatljiva jer ne troše Google kvotu.
    if (emails.length === 0 && origin) {
      for (const path of CONTACT_PATHS) {
        const html = await fetchContactPage(origin, path);
        if (!html) continue;
        emails = extractEmails(html, host);
        if (emails.length > 0) break;
      }
    }
  }

  await upsertAudit({ placeId, site, score, emails: emails.slice(0, 3) });

  // [Faza 3, 3.2] Audit je upisan — diži `analyzed` roditeljskog scan posla
  // (kad ga ima; CLI i ručno pokretanje nemaju). Neuspeh se loguje unutra.
  if (scanJobId) await inkrementirajAnalizu(scanJobId);

  const skorText = score ? `skor ${score.score} (${score.band})` : site.status;
  return {
    note: `${business.name}: ${skorText}${emails.length ? `, mejl ${emails[0]}` : ""}`,
  };
}
