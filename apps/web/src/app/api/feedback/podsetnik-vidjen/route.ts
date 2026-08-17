// apps/web/src/app/api/feedback/podsetnik-vidjen/route.ts
// „Podsetnik je prikazan" (F10 §2).
//
// Zove se kad se prozor POJAVI, ne kad se odgovori: korisnik koji ga je zatvorio
// ne sme da ga vidi ponovo. Prazno telo — jedini podatak koji ovoj ruti treba je
// identitet, a on dolazi iz sesije.
//
// Statička putanja ide ispred `[id]` u Next-ovom rasporedu ruta, pa
// `podsetnik-vidjen` nikad ne završi kao ID utiska.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { oznaciPodsetnikVidjen } from "@/lib/feedback";
import { proveriIpTempo } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(req: Request): Promise<Response> {
  // IP tempo pre svega (Faza 1, 1.2).
  const ogranicen = await proveriIpTempo(req, "feedback-podsetnik");
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ greska: "Nisi prijavljen." }, { status: 401, headers: HEADERS });
  }

  try {
    await oznaciPodsetnikVidjen(userId);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (err) {
    // Ovo je jedini poziv u fazi čiji pad korisnik ne vidi i ne treba da vidi:
    // podsetnik je već na ekranu, a najgore što se dešava je da se pojavi još
    // jednom sledeći put.
    console.error("[api/feedback/podsetnik-vidjen]", err);
    return NextResponse.json({ ok: false }, { status: 500, headers: HEADERS });
  }
}
