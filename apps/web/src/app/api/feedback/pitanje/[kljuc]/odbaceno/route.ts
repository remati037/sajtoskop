// apps/web/src/app/api/feedback/pitanje/[kljuc]/odbaceno/route.ts
// „Pitanje je odbačeno" — klik na `✕` (F11 §3.1).
//
// Dva odbacivanja zaredom ućute sistem na 14 dana, treće do kraja bete. Račun je
// u `@sajtoskop/shared/feedback-motor`, upis u `lib/utisci.ts`; ovde je samo
// granica: identitet iz sesije, ključ iz putanje i prema katalogu.
//
// Idempotentno po pitanju: već odbačeno pitanje ne diže streak drugi put. Bez
// toga bi klijent koji dvaput pošalje isti klik korisniku uzeo 14 dana.

import { NextResponse } from "next/server";
import { pitanjeZaKljuc } from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { zabeleziOdbacivanje } from "@/lib/utisci";

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

  if (!pitanje) {
    return NextResponse.json({ greska: "Nepoznato pitanje." }, { status: 400, headers: HEADERS });
  }

  try {
    await zabeleziOdbacivanje(userId, pitanje);
    return new NextResponse(null, { status: 204, headers: HEADERS });
  } catch (err) {
    // Traka je već nestala sa ekrana; korisnik sa ovom greškom nema šta da radi.
    console.error("[api/feedback/pitanje/odbaceno]", err);
    return NextResponse.json({ ok: false }, { status: 500, headers: HEADERS });
  }
}
