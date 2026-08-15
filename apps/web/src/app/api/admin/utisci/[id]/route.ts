// apps/web/src/app/api/admin/utisci/[id]/route.ts
// Status, oznake i beleška uz prijavu (F11 §5, §6.6).
//
// Kroz `pripremiRadnju()` → `procitajTelo()` → `saAuditom()`, kao i svaka druga
// ruta pod `/api/admin`. Ništa se ovde ne proverava dvaput i ništa se ne upisuje
// mimo tog omotača — i odbijeno telo ostavlja red u dnevniku.
//
// [ODSTUPANJE od F11 §5, namerno] PRD u isti `PATCH` stavlja i `nagrada?`.
// Krediti su izvučeni u zasebnu rutu (`/nagrada`), iz istog razloga iz kog su
// `user.ban` i `user.unban` dve radnje („S4", tačka 7): filter na
// `/admin/revizija` je po `action`, pa bi „kome sam dodelio 10 kredita" inače
// moralo da se čita kroz `payload` svake izmene statusa.

import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";
import { izmeniUtisak, vlasnikUtiska } from "@/lib/admin-utisci-radnje";
import { utisakBodySchema } from "@/lib/admin-utisci-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;
  const id = Number((await params).id);

  if (!Number.isInteger(id) || id <= 0) {
    // Neispravan ID nije ni pokušaj izmene nego pogrešna adresa — u dnevnik ne
    // ide, jer nema ni cilja ni radnje koja bi se zapisala.
    return Response.json(
      { greska: "Neispravan ID prijave." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // `target_user` je vlasnik prijave, jer revizija iz te kolone pravi link na
  // detalj korisnika. Čita se PRE radnje, pa `null` ovde znači „ne zna se" —
  // sama radnja odmah zatim naleti na isti problem i uredno ga prijavi.
  const target = await vlasnikUtiska(id);

  return saAuditom({ actor, action: RADNJE.UTISAK, target, ip }, async () => {
    const telo = await procitajTelo(req, utisakBodySchema);
    if (!telo.ok) return telo.ishod;

    return izmeniUtisak(id, telo.telo);
  });
}
