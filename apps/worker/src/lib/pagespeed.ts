// apps/worker/src/lib/pagespeed.ts
// PageSpeed Insights, korak 2 posla `enrich_full` (F6 §1).
//
// ── zašto samo mobilni ─────────────────────────────────────
// Desktop skor je nezanimljiv. Argument prema vlasniku firme nije „tvoj sajt ima
// 34 poena" nego „tvoj sajt se na telefonu otvara osam sekundi", a to je mobilni
// skor i LCP. Desktop poziv bi bio drugi trošak za podatak koji ne ide u poruku.
//
// ── zašto bez retryja ──────────────────────────────────────
// PSI je spor i redovno pukne — Lighthouse zapravo otvara sajt na Googleovoj
// mašini, pa zapušten sajt koji nas zanima ume da ga obori. To NIJE razlog da
// posao propadne: korisnik je platio kredit za kontakt i screenshot, a skor je
// dodatak. Jedan pokušaj, 30 sekundi, na neuspeh `psi_mobile_score = null`.
//
// Node-only, isključivo u workeru (pravilo 7).

import { z } from "zod";
import { capMessage, consumeSide, SIDE_KIND } from "./side-budget";

/** PRD §1: jedan pokušaj, 30 sekundi. Lighthouse na tuđem sajtu ume i duže. */
const TIMEOUT_MS = 30_000;

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/**
 * Odgovor je i uz `category=performance` par stotina kilobajta JSON-a. Zod ovde
 * odbacuje sve što nije ovih par polja — ceo Lighthouse izveštaj se namerno
 * baca (PRD §1: „to su megabajti po sajtu").
 *
 * Sve je opciono jer Lighthouse ume da vrati izveštaj bez skora (`runtimeError`)
 * za sajt koji nije uspeo da učita — a to je za nas i dalje validan ishod.
 */
const psiResponseSchema = z.object({
  lighthouseResult: z
    .object({
      categories: z
        .object({
          performance: z.object({ score: z.number().nullable() }).optional(),
        })
        .optional(),
      audits: z
        .object({
          "largest-contentful-paint": z.object({ numericValue: z.number() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

export type PsiOutcome =
  | { status: "ok"; score: number | null; lcpMs: number | null }
  /** Dnevni cap dostignut. Nije greška — korak se preskače. */
  | { status: "capped"; note: string }
  /** PSI je pukao, istekao ili vratio besmislicu. Lead ostaje bez skora. */
  | { status: "failed"; note: string };

function short(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? err.name;
  return String(err);
}

/**
 * Mobilni performance skor i LCP za jedan sajt.
 *
 * `url` mora već da bude prošao SSRF proveru — `enrich_full` prosleđuje
 * `finalUrl` iz `captureSite`, dakle adresu koju je pregledač stvarno otvorio.
 * PSI je doduše Googleov fetch, ne naš, ali privatna adresa ovde ne bi bila
 * ništa drugo nego traćenje poziva.
 */
export async function pageSpeedMobile(url: string): Promise<PsiOutcome> {
  const budget = await consumeSide(SIDE_KIND.psi);
  if (!budget.ok) {
    return { status: "capped", note: capMessage(SIDE_KIND.psi, budget) };
  }

  const params = new URLSearchParams({
    url,
    strategy: "mobile",
    category: "performance",
  });

  // Ključ je opcion: bez njega PSI radi, ali sa kvotom koja se deli po IP-u i
  // pukne posle nekoliko poziva. Na Hetzneru to znači „radi u testu, ne radi
  // u produkciji", pa nedostatak ključa ide u log, a ne u tišinu.
  const key = process.env.PSI_API_KEY?.trim();
  if (key) params.set("key", key);

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (err) {
    return {
      status: "failed",
      note: `PSI nije odgovorio (${short(err)})${key ? "" : " · PSI_API_KEY nije postavljen"}`,
    };
  }

  if (!res.ok) {
    // 429 ovde je Googleova kvota za PSI, a NE Places 429 — `markExhausted()`
    // se namerno ne zove, jer bi zaključao Places dan zbog tuđe kvote.
    return {
      status: "failed",
      note: `PSI HTTP ${res.status}${key ? "" : " · PSI_API_KEY nije postavljen"}`,
    };
  }

  let parsed: z.infer<typeof psiResponseSchema>;
  try {
    parsed = psiResponseSchema.parse(await res.json());
  } catch (err) {
    return { status: "failed", note: `PSI odgovor nije u očekivanom obliku (${short(err)})` };
  }

  const raw = parsed.lighthouseResult?.categories?.performance?.score ?? null;
  const lcp = parsed.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue ?? null;

  return {
    status: "ok",
    // Lighthouse daje 0–1, baza čuva 0–100 (`website_audits_psi_range`).
    score: raw === null ? null : Math.max(0, Math.min(100, Math.round(raw * 100))),
    lcpMs: lcp === null ? null : Math.max(0, Math.round(lcp)),
  };
}
