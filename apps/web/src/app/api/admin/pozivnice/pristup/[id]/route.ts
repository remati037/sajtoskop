// apps/web/src/app/api/admin/pozivnice/pristup/[id]/route.ts
// Opoziv pristupne pozivnice (S27, naplata-stripe.md §9.3).
//
// `DELETE` po HTTP značenju — resurs prestaje da važi — ali red u bazi ostaje
// sa `revoked_at`: na njega pokazuju iskorišćenja i knjiga kredita
// (`invite:<id>`). V. `opozoviPozivnicu()`.
//
// Isti omotač kao svaka admin mutacija: 404 za ne-admina (pravilo 13), red u
// `admin_audit` i na uspeh i na pad (pravilo 14), `payload` sa id-jem, bez mejla.

import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, saAuditom } from "@/lib/admin-radnje";
import { opozoviPozivnicu } from "@/lib/pozivnice-pristup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const id = decodeURIComponent((await params).id);

  return saAuditom(
    { actor, action: RADNJE.POZIVNICA_OPOZIV, target: null, ip, payload: { tip: "pristupna", invite_id: id } },
    async () => opozoviPozivnicu(id),
  );
}
