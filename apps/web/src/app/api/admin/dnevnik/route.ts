// apps/web/src/app/api/admin/dnevnik/route.ts
// Nova stavka Beta dnevnika (F11.4 §6.5).
//
// Kroz `pripremiRadnju()` → `procitajTelo()` → `saAuditom()`, kao i svaka
// druga ruta pod `/api/admin` (pravilo 13 i 14). `target_user` je prazan —
// stavka nije vezana za nalog; `ref` je `dnevnik:<id>`.

import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";
import { stavkaBodySchema } from "@/lib/admin-radnje-schema";
import { napraviStavku } from "@/lib/dnevnik";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;

  return saAuditom({ actor, action: RADNJE.DNEVNIK, target: null, ip }, async () => {
    const telo = await procitajTelo(req, stavkaBodySchema);
    if (!telo.ok) return telo.ishod;

    return napraviStavku(telo.telo);
  });
}
