// apps/web/src/app/api/admin/korisnici/[id]/route.ts
// Brisanje naloga (F12 §3.2, §4, pravilo 15).
//
// Put je Clerk `users.deleteUser` → webhook `user.deleted` → kaskada iz
// `profiles`. Ruta ne briše nijedan red u bazi sama (osim slučaja iz §6 kad
// naloga u Clerku više nema — v. `obrisiNalog()`).
//
// `potvrda` je mejl koji admin RUČNO otkuca. Server ga poredi sa stvarnim mejlom
// iz Clerka; klijentska provera je udobnost, a ova je brava.
//
// GET-a ovde nema namerno: detalj korisnika je serverska komponenta i čita kroz
// `lib/admin-korisnici.ts` (v. „S3 — šta se razišlo", tačka 3).

import { brisanjeBodySchema } from "@/lib/admin-radnje-schema";
import { RADNJE } from "@/lib/admin";
import { obrisiNalog, pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const target = decodeURIComponent((await params).id);

  return saAuditom({ actor, action: RADNJE.BRISANJE, target, ip }, async () => {
    const telo = await procitajTelo(req, brisanjeBodySchema);
    if (!telo.ok) return telo.ishod;

    return obrisiNalog(actor, target, telo.telo.potvrda);
  });
}
