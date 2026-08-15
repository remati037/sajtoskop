// apps/web/src/app/api/admin/utisci/[id]/nagrada/route.ts
// +10 kredita za potvrđen bug (F11 §6.7).
//
// ‼️ RAZLIKA KOJA SE LAKO PROMAŠI
// `admin_adjust_credits` (0012) SAM upisuje `admin_audit`, pa ruta za korekciju
// kredita ima `bezAuditaNaUspeh: true`. **`grant_feedback_credits` (0011) to NE
// radi.** Zato ova ruta prolazi kroz `saAuditom()` BEZ te zastavice — inače bi
// bila jedina izmena balansa u projektu bez ijednog traga
// (v. „S3 — šta se razišlo", tačka 6, i „S5", tačka 2).
//
// Telo nema: iznos je konstanta iz PRD-a, a ne odluka po kliku. Dvostruki klik
// ne dodeljuje 20 — idempotencija je u knjizi, po `ref_id = 'fb:<id>'`.

import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, saAuditom } from "@/lib/admin-radnje";
import { nagradiBug, vlasnikUtiska } from "@/lib/admin-utisci-radnje";

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

  return saAuditom({ actor, action: RADNJE.UTISAK_NAGRADA, target, ip }, () => nagradiBug(id));
}
