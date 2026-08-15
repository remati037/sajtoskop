// apps/web/src/app/api/admin/dnevnik/[id]/route.ts
// Izmena i brisanje stavke Beta dnevnika (F11.4 §6.5).
//
// Isti omotač kao i svaka druga ruta pod `/api/admin`: `pripremiRadnju()` →
// `procitajTelo()` → `saAuditom()`. Neispravan ID nije pokušaj radnje nego
// pogrešna adresa — u dnevnik ne ide, jer nema ni cilja ni radnje.

import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";
import { stavkaBodySchema } from "@/lib/admin-radnje-schema";
import { izmeniStavku, obrisiStavku } from "@/lib/dnevnik";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function neispravanId(): Response {
  return Response.json(
    { greska: "Neispravan ID stavke." },
    { status: 400, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return neispravanId();

  return saAuditom(
    { actor, action: RADNJE.DNEVNIK_IZMENA, target: null, ip },
    async () => {
      const telo = await procitajTelo(req, stavkaBodySchema);
      if (!telo.ok) return telo.ishod;

      return izmeniStavku(id, telo.telo);
    },
  );
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return neispravanId();

  return saAuditom(
    { actor, action: RADNJE.DNEVNIK_BRISANJE, target: null, ip },
    () => obrisiStavku(id),
  );
}
