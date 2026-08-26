// apps/web/src/app/api/admin/korisnici/[id]/beta/route.ts
// Beta nalozi (S20, LANSIRANJE §1.1 i §1.5). Dva metoda, jer su dve radnje:
//
//   POST   „Otvori beta nalog" — plan `beta` + krediti + rok, u JEDNOJ
//          transakciji i sa JEDNIM redom u dnevniku
//   PATCH  samo rok — produženje, ili gašenje bete rokom u prošlosti
//
// ── zašto dva metoda, a ne dve rute ─────────────────────────
// Isti resurs (beta status jednog naloga) i isti trag u reviziji po `target`.
// Dve putanje bi značile i dva mesta na koja se dopisuje sledeća provera nad
// istim podatkom — a razlika između njih je tačno ono što HTTP metod već nosi:
// `POST` uspostavlja stanje, `PATCH` menja jedno polje.
//
// Ruta je tanka kao i sve ostale pod `/api/admin`: provera, telo, poziv u
// `lib/admin-radnje.ts`, prevod ishoda. Odluka D1 („beta samo odavde") se NE
// brani ovde nego u tri sloja ispod — spisku planova, `promeniPlan()` i trigeru
// iz migracije 0024.

import { betaNalogBodySchema, betaRokBodySchema } from "@/lib/admin-radnje-schema";
import { RADNJE } from "@/lib/admin";
import {
  otvoriBetaNalog,
  postaviBetaRok,
  pripremiRadnju,
  procitajTelo,
  saAuditom,
} from "@/lib/admin-radnje";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** „Otvori beta nalog": plan, rok i krediti odjednom. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const target = decodeURIComponent((await params).id);

  return saAuditom({ actor, action: RADNJE.BETA, target, ip }, async () => {
    const telo = await procitajTelo(req, betaNalogBodySchema);
    if (!telo.ok) return telo.ishod;

    return otvoriBetaNalog(target, telo.telo.krediti, telo.telo.do, telo.telo.refId);
  });
}

/**
 * Samo rok. `{ do: null }` je NEOGRANIČENO, `{ do: <ISO u prošlosti> }` gasi
 * betu — oba su legitimna i oba ostavljaju red u dnevniku.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const target = decodeURIComponent((await params).id);

  return saAuditom({ actor, action: RADNJE.BETA_ROK, target, ip }, async () => {
    const telo = await procitajTelo(req, betaRokBodySchema);
    if (!telo.ok) return telo.ishod;

    return postaviBetaRok(target, telo.telo.do);
  });
}
