// apps/web/src/app/api/unlock/route.ts
// Jedini ulaz u otključavanje. Jedan lead po zahtevu — bez batch endpointa,
// nikad (F4 §1).
//
// Ruta je namerno tanka: uzmi identitet iz sesije, proveri telo, pozovi
// `unlockLead`, prevedi ishod u status kod i srpsku poruku. Sve što je logika
// je u `lib/unlock.ts`, a sve što je trka je u SQL funkciji. Ako ova datoteka
// ikad poraste — nešto je sišlo sa svog sprata.
//
// `userId` dolazi ISKLJUČIVO iz `requireUserId()` (pravilo 8 i P0-1). Telo se
// čita tek posle toga i iz njega izlazi samo `placeId`.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import type { ApiError, UnlockResponse } from "@/lib/search-types";
import { unlockLead } from "@/lib/unlock";
import { unlockBodySchema } from "@/lib/unlock-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Odgovor zavisi od toga ko pita i šta je otključao — nikad u deljeni keš. */
const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number, detalji?: string[]): Response {
  const body: ApiError = detalji ? { greska: poruka, detalji } : { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(req: Request): Promise<Response> {
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

  const parsed = unlockBodySchema.safeParse(raw);
  if (!parsed.success) {
    return greska(
      "Neispravan zahtev za otključavanje.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  try {
    const outcome = await unlockLead(userId, parsed.data.placeId);

    if (!outcome.ok) {
      switch (outcome.reason) {
        case "insufficient_credits":
          // 402 Payment Required. Beta ne naplaćuje, ali kredit je i dalje ono
          // čega je ponestalo — klijent po statusu zna da ponudi „vidi kredite",
          // a ne „pokušaj ponovo".
          return greska(
            "Nemaš dovoljno kredita. Beta plan dobija 30 kredita prvog u mesecu.",
            402,
          );

        case "no_place":
          return greska("Taj prospekt više ne postoji u bazi.", 404);

        case "no_user":
          // Isti tekst kao u `/api/search`: sesija postoji, profil još nije
          // stigao kroz Clerk webhook.
          return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
      }
    }

    const body: UnlockResponse = {
      lead: outcome.lead,
      creditsLeft: outcome.creditsLeft,
      alreadyUnlocked: outcome.reason === "already_unlocked",
    };

    return NextResponse.json(body, { headers: HEADERS });
  } catch (err) {
    console.error("[api/unlock]", err);
    return greska("Otključavanje trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}
