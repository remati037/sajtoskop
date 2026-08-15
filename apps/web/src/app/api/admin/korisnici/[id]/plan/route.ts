// apps/web/src/app/api/admin/korisnici/[id]/plan/route.ts
// Promena plana (F12 §3.2, §4). Vrednost mora da postoji u `PLANS` —
// `admin-radnje-schema.ts` enum gradi iz samog objekta, pa se spisak ne može
// razići sa kodom.

import { planBodySchema } from "@/lib/admin-radnje-schema";
import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, procitajTelo, promeniPlan, saAuditom } from "@/lib/admin-radnje";

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

  return saAuditom({ actor, action: RADNJE.PLAN, target, ip }, async () => {
    const telo = await procitajTelo(req, planBodySchema);
    if (!telo.ok) return telo.ishod;

    return promeniPlan(target, telo.telo.plan);
  });
}
