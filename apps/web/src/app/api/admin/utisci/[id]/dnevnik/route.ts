// apps/web/src/app/api/admin/utisci/[id]/dnevnik/route.ts
// „Poveži sa stavkom dnevnika" (F11 §6.6) — upis u `changelog.from_feedback`.
//
// Zbog te veze ekran `/utisci` iz F11.4 ume da kaže „iz tvog utiska", a to je
// jedina rečenica koja stvarno traži drugi utisak od istog čoveka (§6.5).
//
// Stavke se ovde ne prave: CRUD nad `changelog`-om je `/admin/dnevnik`, dakle
// F11.4. Do tada je spisak ponuđenih stavki po pravilu prazan i panel to kaže
// naglas — prazan padajući meni bez objašnjenja izgleda kao kvar.

import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";
import { veziSaDnevnikom, vlasnikUtiska } from "@/lib/admin-utisci-radnje";
import { dnevnikBodySchema } from "@/lib/admin-utisci-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const id = Number((await params).id);

  if (!Number.isInteger(id) || id <= 0) {
    return Response.json(
      { greska: "Neispravan ID prijave." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const target = await vlasnikUtiska(id);

  return saAuditom({ actor, action: RADNJE.UTISAK_DNEVNIK, target, ip }, async () => {
    const telo = await procitajTelo(req, dnevnikBodySchema);
    if (!telo.ok) return telo.ishod;

    return veziSaDnevnikom(id, telo.telo.stavka);
  });
}
