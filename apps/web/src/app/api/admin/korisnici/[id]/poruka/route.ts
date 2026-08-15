// apps/web/src/app/api/admin/korisnici/[id]/poruka/route.ts
// Pojedinačna poruka korisniku (F12 §3.2).
//
// Jedina ruta pod `/api/admin` sa DVA brojača. Onaj od 120 mutacija na sat
// (`pripremiRadnju`) čuva konzolu od skripta; ovaj od 20 na dan čuva tuđe
// inbokse. F12 §9 kaže da masovnog slanja nema — dvadeset pisama dnevno je već
// iznad svega što u beti od desetina ljudi ima smisla, a bez ovog brojača bi
// gornja granica bila 120 na sat, dakle skoro tri hiljade na dan.
//
// Odbijanje po tempu ne piše red u dnevnik, isto kao i kod onog od 120/h: nije
// bilo mutacije, bilo je zaustavljanje pred njom.

import { PORUKA_NA_DAN, proveriDnevniTempo, RADNJE } from "@/lib/admin";
import { porukaBodySchema } from "@/lib/admin-radnje-schema";
import { greska, posaljiPoruku, pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;

  const dnevni = await proveriDnevniTempo(actor, RADNJE.PORUKA, PORUKA_NA_DAN, "poruka");
  if (!dnevni.ok) return greska(dnevni.poruka, dnevni.status);

  const target = decodeURIComponent((await params).id);

  return saAuditom({ actor, action: RADNJE.PORUKA, target, ip }, async () => {
    const telo = await procitajTelo(req, porukaBodySchema);
    if (!telo.ok) return telo.ishod;

    return posaljiPoruku(target, telo.telo.naslov, telo.telo.poruka);
  });
}
