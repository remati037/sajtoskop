// apps/web/src/app/api/cron/utisci-izvestaj/route.ts
// Nedeljni izveštaj, ponedeljak u 09:00 (F11 §7 i §10).
//
// Funnel po pitanju, medijana cene, otvoreni bugovi, prosek do odgovora i spisak
// onih koji ćute. Sve brojke iz `admin_overview` — istog poziva koji puni
// `/admin` i `/admin/utisci`, da izveštaj i ekran ne bi tvrdili dve stvari.
//
// Ovaj posao NE MENJA nijedan red. Trag svejedno ostavlja, i to je jedini razlog
// zbog kog je ovde izuzetak od pravila „audit samo za izmene": bez njega je
// izveštaj koji nikad nije stigao nerazlučiv od izveštaja koji je stigao pa se
// izgubio u spamu.

import { RADNJE } from "@/lib/admin";
import { saCronAuditom } from "@/lib/cron";
import { posaljiNedeljniIzvestaj } from "@/lib/utisci-izvestaj";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function pokreni(req: Request): Promise<Response> {
  return saCronAuditom(req, RADNJE.CRON_IZVESTAJ, async (osnova) => {
    const ishod = await posaljiNedeljniIzvestaj(osnova);

    return {
      telo: { poslat: ishod.ok, razlog: ishod.razlog },
      audit: { poslat: ishod.ok, ...(ishod.razlog ? { razlog: ishod.razlog } : {}) },
    };
  });
}

export async function GET(req: Request): Promise<Response> {
  return pokreni(req);
}

export async function POST(req: Request): Promise<Response> {
  return pokreni(req);
}
