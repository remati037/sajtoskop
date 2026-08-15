// apps/web/src/app/api/admin/korisnici/[id]/limit/route.ts
// Reset dnevnog cache-miss brojača (F12 §3.2, §4).
//
// Bez tela: radnja nema nijedan parametar. Prazno telo se ne čita i ne
// proverava — `POST` bez sadržaja je ovde ceo ugovor.
//
// Ovo ne dodaje nijedan Places poziv: brojač je korisnikova dnevna kvota za
// skeniranja koja promašuju keš, a globalni cap iz `plans.ts` stoji iznad njega
// i ovom rutom se ne pomera.

import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, resetujLimit, saAuditom } from "@/lib/admin-radnje";

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

  return saAuditom({ actor, action: RADNJE.LIMIT, target, ip }, () => resetujLimit(target));
}
