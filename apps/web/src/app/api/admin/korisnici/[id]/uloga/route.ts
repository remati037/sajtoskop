// apps/web/src/app/api/admin/korisnici/[id]/uloga/route.ts
// Dodela i skidanje uloge admina (F12 §1, §3.2, §4).
//
// Jedina radnja koja menja ko sme šta, pa je i jedina sa tri brave: ne sebi,
// poslednji admin ostaje, i ponovno prebrojavanje posle upisa. Sve tri su u
// `promeniUlogu()` — ruta ovde ne odlučuje ništa.

import { ulogaBodySchema } from "@/lib/admin-radnje-schema";
import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, procitajTelo, promeniUlogu, saAuditom } from "@/lib/admin-radnje";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const target = decodeURIComponent((await params).id);

  return saAuditom({ actor, action: RADNJE.ULOGA, target, ip }, async () => {
    const telo = await procitajTelo(req, ulogaBodySchema);
    if (!telo.ok) return telo.ishod;

    return promeniUlogu(actor, target, telo.telo.role);
  });
}
