// apps/web/src/app/api/feedback/pitanje/[kljuc]/prikazano/route.ts
// „Pitanje je prikazano" (F11 §3.2).
//
// Upisuje se PRI PRIKAZU, ne pri odgovoru — isto pravilo koje F10 već koristi za
// podsetnik. Korisnik koji je pitanje video i ignorisao ga ne sme da ga vidi
// ponovo.
//
// Prazno telo: jedini podaci koji ovoj ruti trebaju su identitet (iz sesije,
// pravilo 8) i ključ (iz putanje, proveren prema katalogu — pravilo 16).
//
// 409 je stvarno stanje, ne greška: drugi tab je isto pitanje već upisao, pa
// ovaj ne prikazuje ništa (F11 §9).

import { NextResponse } from "next/server";
import { pitanjeZaKljuc, vaziPitanje } from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { zabeleziPrikaz } from "@/lib/utisci";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ kljuc: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ greska: "Nisi prijavljen." }, { status: 401, headers: HEADERS });
  }

  const { kljuc } = await params;
  const pitanje = pitanjeZaKljuc(kljuc);

  // Ključ koji ne postoji u katalogu ne postoji ni za bazu (pravilo 16).
  if (!pitanje) {
    return NextResponse.json({ greska: "Nepoznato pitanje." }, { status: 400, headers: HEADERS });
  }

  // Rok iz kataloga (`do:`) važi i ovde, ne samo u motoru: tab koji je ostao
  // otvoren preko kraja bete ne sme da upiše prikaz pitanja koje više ne postoji.
  if (!vaziPitanje(pitanje, Date.now())) {
    return NextResponse.json(
      { greska: "To pitanje više nije aktivno." },
      { status: 410, headers: HEADERS },
    );
  }

  try {
    const ishod = await zabeleziPrikaz(userId, pitanje);

    if (ishod === "vec_prikazano") {
      return new NextResponse(null, { status: 409, headers: HEADERS });
    }

    return new NextResponse(null, { status: 204, headers: HEADERS });
  } catch (err) {
    console.error("[api/feedback/pitanje/prikazano]", err);
    return NextResponse.json({ ok: false }, { status: 500, headers: HEADERS });
  }
}
