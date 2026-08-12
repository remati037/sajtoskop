// apps/web/src/app/api/feedback/[id]/route.ts
// Dopuna utiska tekstom i tipom (F10 §2).
//
// Utisak je već upisan i mejl je već otišao u prvom koraku — ovo je dodatak, ne
// slanje. Zato zatvaranje modala bez teksta ne gubi ništa i zato ova ruta sme da
// odbije zahtev bez ijedne posledice po korisnika.
//
// Dopuna šalje DRUGI mejl, sa subjectom `↳ dopuna uz utisak #123`. Dupli mejl se
// dešava samo kad korisnik i oceni i napiše — dakle baš u najvrednijem slučaju —
// i drugi nosi pun sadržaj, pa je prvi samo raniji signal.

import { after, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { dopuniUtisak, javiMejlom, mejlDozvoljenZa } from "@/lib/feedback";
import { dopunaBodySchema } from "@/lib/feedback-schema";
import type { ApiError } from "@/lib/search-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number, detalji?: string[]): Response {
  const body: ApiError = detalji ? { greska: poruka, detalji } : { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  const { id } = await params;
  const utisakId = Number(id);

  if (!Number.isInteger(utisakId) || utisakId <= 0) {
    return greska("Neispravan ID utiska.", 400);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return greska("Telo zahteva nije ispravan JSON.", 400);
  }

  const parsed = dopunaBodySchema.safeParse(raw);
  if (!parsed.success) {
    return greska(
      "Neispravna dopuna.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  try {
    // `dopuniUtisak` filtrira i po `user_id` — bez toga je ovo IDOR na tuđ
    // utisak (P0-1). Ruta tu proveru NE ponavlja i ne sme da je zaobiđe.
    const ishod = await dopuniUtisak(userId, utisakId, parsed.data);

    if (!ishod.ok) {
      return ishod.razlog === "kasno"
        ? // Zapis koji sam pročitao u mejlu ne sme da se prepiše sat kasnije.
          greska("Ovaj utisak je stariji od sat vremena i više ne prima dopunu.", 409)
        : // Tuđ i nepostojeći utisak daju isti odgovor — razlika bi rekla koji
          // ID-jevi postoje.
          greska("Taj utisak ne postoji.", 404);
    }

    // Zapis koji je pri nastanku ostao bez mejla ostaje bez njega i sada.
    // Klijent do drugog koraka u tom slučaju ne stiže, ali ruta se ne oslanja
    // na klijenta.
    after(async () => {
      if (await mejlDozvoljenZa(ishod.red)) await javiMejlom(ishod.red, userId, true);
    });

    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/feedback/dopuna]", err);
    return greska("Dopuna trenutno ne radi. Pokušaj ponovo za koji trenutak.", 500);
  }
}
