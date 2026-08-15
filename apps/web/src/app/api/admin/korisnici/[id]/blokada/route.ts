// apps/web/src/app/api/admin/korisnici/[id]/blokada/route.ts
// Blokada i odblokada kroz Clerk (F12 §3.2, §4).
//
// Radnja se u dnevniku razdvaja na `user.ban` i `user.unban`, a ne na jednu sa
// `blokiran` u payload-u: filter na `/admin/revizija` je po `action`, pa bi
// „ko je blokiran ovog meseca" inače tražilo čitanje payload-a red po red.

import { blokadaBodySchema } from "@/lib/admin-radnje-schema";
import { RADNJE } from "@/lib/admin";
import { postaviBlokadu, pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";

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

  const telo = await procitajTelo(req, blokadaBodySchema);

  // Radnja se zna tek iz tela, a `action` je deo konteksta audita — zato se telo
  // ovde čita pre omotača. Neispravno telo i dalje ostavlja trag, samo pod
  // `user.ban`: pokušaj koji nije rekao ni šta traži je pokušaj blokade dok se
  // ne dokaže suprotno.
  const action = telo.ok && !telo.telo.blokiran ? RADNJE.ODBLOKADA : RADNJE.BLOKADA;

  return saAuditom({ actor, action, target, ip }, async () => {
    if (!telo.ok) return telo.ishod;
    return postaviBlokadu(actor, target, telo.telo.blokiran);
  });
}
