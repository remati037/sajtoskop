// apps/web/src/app/api/admin/korisnici/[id]/krediti/route.ts
// Ručna korekcija kredita (F12 §3.2, §4). PRVA ruta pod `/api/admin`.
//
// Jedina radnja u konzoli koja NE upisuje svoj red u dnevnik na uspeh:
// `admin_adjust_credits` (0012) to radi sam, u istoj transakciji sa izmenom
// balansa. Drugi red odavde bi u reviziji izgledao kao druga dodela.
// Pad i dalje piše ova ruta — njega RPC ne vidi, jer se do njega nije ni stiglo.
//
// `refId` dolazi iz tela, ali ga je generisao SERVER pri renderu detalja
// korisnika (v. `noviRefId()`). Zato dupli klik nosi isti ključ i drugi poziv
// izlazi kao „već primenjeno", a ne kao drugih 30 kredita.

import { kreditiBodySchema } from "@/lib/admin-radnje-schema";
import { RADNJE } from "@/lib/admin";
import { korigujKredite, pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const target = decodeURIComponent((await params).id);

  return saAuditom(
    { actor, action: RADNJE.KREDITI, target, ip, bezAuditaNaUspeh: true },
    async () => {
      const telo = await procitajTelo(req, kreditiBodySchema);
      if (!telo.ok) return telo.ishod;

      const { delta, napomena, refId } = telo.telo;
      return korigujKredite(actor, target, delta, napomena, refId);
    },
  );
}
