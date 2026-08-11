// apps/web/src/app/api/pipeline/route.ts
// Prevlačenje kartice i beleška po leadu (F7 §3).
//
// Ruta je tanka kao `/api/unlock`: identitet iz sesije, provera tela, poziv u
// `lib/pipeline.ts`, prevod ishoda u status kod i srpsku poruku.
//
// `userId` dolazi ISKLJUČIVO iz `requireUserId()`. Iz tela izlaze samo
// `placeId`, `status` i `note` — nikad vlasnik reda (pravilo 8, P0-1).

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { promeniStatus, sacuvajBelesku } from "@/lib/pipeline";
import { pipelineBodySchema } from "@/lib/pipeline-schema";
import type { ApiError } from "@/lib/search-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number, detalji?: string[]): Response {
  const body: ApiError = detalji ? { greska: poruka, detalji } : { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function PATCH(req: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return greska("Telo zahteva nije ispravan JSON.", 400);
  }

  const parsed = pipelineBodySchema.safeParse(raw);
  if (!parsed.success) {
    return greska(
      "Neispravan zahtev.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  const { placeId, status, note } = parsed.data;

  try {
    // Redosled je bitan kad stignu oba: status je ono što korisnik vidi kao
    // rezultat prevlačenja, pa ide prvi. Ako beleška padne posle njega, kartica
    // je bar na pravom mestu.
    if (status !== undefined) {
      const ishod = await promeniStatus(userId, placeId, status);
      if (!ishod.ok) return odbijeno(ishod.razlog);
    }

    if (note !== undefined) {
      const ishod = await sacuvajBelesku(userId, placeId, note);
      if (!ishod.ok) return odbijeno(ishod.razlog);
    }

    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/pipeline]", err);
    return greska("Izmena trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}

/**
 * `not_unlocked` je 403, ne 404.
 *
 * Lead postoji i korisnik zna da postoji — video ga je u pretrazi. Ono što mu
 * fali je otključanje, i to je tačno ono što poruka kaže. 404 bi ga poslao da
 * traži grešku u ID-u.
 */
function odbijeno(razlog: "not_unlocked" | "invalid_status"): Response {
  return razlog === "invalid_status"
    ? greska("Nepoznata kolona kanbana.", 400)
    : greska("Taj prospekt nije otključan, pa ne može u pipeline.", 403);
}
