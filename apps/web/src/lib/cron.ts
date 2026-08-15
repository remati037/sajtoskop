// apps/web/src/lib/cron.ts
// Ulazna kapija za rute pod `/api/cron` (F11 §8, poslednji red).
//
// Cron ruta NIJE admin ruta. Nema sesiju, nema aktera i ne prolazi kroz
// `pripremiRadnju()` — ono što je tamo `requireAdminRoute()`, ovde je tajna iz
// env-a. Sve ostalo ostaje isto: radnja koja menja podatke ostavlja red u
// `admin_audit`, sa `actor_id = null` (isto kao kaskada iz webhooka).
//
// ── zašto poređenje otporno na vreme ─────────────────────────
// `a === b` nad stringovima staje na prvom različitom bajtu. Razlika u trajanju
// je mikrosekundna i preko mreže se davi u šumu — ali merenje sa dovoljno
// ponavljanja je poznat napad, a cena odbrane je jedan `timingSafeEqual`.
//
// Poredi se HEŠ, ne sama vrednost: `timingSafeEqual` baca kad su duljine
// različite, pa bi golo poređenje odalo dužinu tajne. Heš je uvek 32 bajta.
//
// ── zašto GET i POST ─────────────────────────────────────────
// F11 §5 crta rute kao `POST`. Vercel Cron poziva **`GET`** i ne ume drugačije.
// Obe metode idu kroz isti posao: `GET` je ono što stvarno okida raspored, a
// `POST` ostaje za ručno pokretanje iz terminala.

import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ipZahteva, originZahteva, upisiAudit, type AdminRadnja } from "./admin";
import { cronSecret } from "./env";

/**
 * Odgovor za sve što nije cron: `404` sa praznim telom.
 *
 * Isto kao `odgovorNeAdmin()`, i iz istog razloga (F12 odluka 3) — ruta koja na
 * pogrešnu tajnu vrati `401` potvrđuje da postoji i da tajna postoji. Ova ne
 * potvrđuje ništa.
 */
export function odgovorNeCron(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function hes(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/**
 * Nosi li zahtev ispravnu tajnu.
 *
 * Dva mesta na kojima se traži: `Authorization: Bearer <tajna>` (tako je šalje
 * Vercel Cron) i `x-cron-secret` (jednostavnije za `curl` iz terminala). Više
 * nema — tajna u query stringu bi završila u svakom logu i u istoriji komandi.
 *
 * Bez podešene tajne prolaza nema. Cron koji u razvoju radi bez ijedne prepreke
 * je cron koji jednom ode u produkciju sa istom tom prazninom.
 */
export function jeCron(req: Request): boolean {
  const tajna = cronSecret();
  if (!tajna) return false;

  const zaglavlje = req.headers.get("authorization");
  const nosilac = zaglavlje?.startsWith("Bearer ") ? zaglavlje.slice(7).trim() : null;
  const ponudjena = nosilac ?? req.headers.get("x-cron-secret")?.trim() ?? null;
  if (!ponudjena) return false;

  return timingSafeEqual(hes(ponudjena), hes(tajna));
}

// ═══════════════════════════════════════════════════════════
// ZAJEDNIČKI OMOTAČ (pravilo 14, i za rutu bez sesije)
// ═══════════════════════════════════════════════════════════

export type CronIshod = {
  /** Telo odgovora — ono što vidim kad rutu pozovem rukom. */
  telo: Record<string, unknown>;
  /**
   * Šta ide u `admin_audit`. `null` znači da posao NIJE ništa promenio, pa nema
   * šta ni da se upiše: cron koji svakog dana zapiše „nije bilo posla" zatrpa
   * reviziju i time pojede jedini razlog zbog kog se ona čita.
   */
  audit: Record<string, unknown> | null;
};

/**
 * Tajna, posao, trag — istim redom u sve tri cron rute.
 *
 * Ovo je `saAuditom()` za rute bez sesije. Razlika je samo u tome ko je akter:
 * `actor_id` je `null`, jer cron nije čovek. Ista vrednost stoji i uz kaskadu iz
 * webhooka, i čita se isto — „promena koja nije došla iz konzole".
 *
 * Izuzetak iz posla je `500` i red u dnevniku sa `ok = false`. Cron koji tiho
 * padne je cron za koji se sazna tek kad neko primeti da mejl nije stigao —
 * a to je obično nedelju dana kasnije.
 */
export async function saCronAuditom(
  req: Request,
  action: AdminRadnja,
  posao: (osnova: string) => Promise<CronIshod>,
): Promise<Response> {
  if (!jeCron(req)) return odgovorNeCron();

  const zaglavlja = { "Cache-Control": "private, no-store" };
  const ip = ipZahteva(req);

  try {
    const ishod = await posao(originZahteva(req));

    if (ishod.audit) {
      await upisiAudit({ actor: null, action, payload: ishod.audit, ok: true, ip });
    }

    return NextResponse.json({ ok: true, ...ishod.telo }, { headers: zaglavlja });
  } catch (err) {
    const poruka = err instanceof Error ? err.message : String(err);
    console.error(`[cron] ${action}:`, err);

    await upisiAudit({ actor: null, action, ok: false, error: poruka, ip });

    return NextResponse.json(
      { ok: false, greska: "Posao nije prošao. Detalj je u logu servera." },
      { status: 500, headers: zaglavlja },
    );
  }
}
