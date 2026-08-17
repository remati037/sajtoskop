// apps/web/src/app/api/utisci/stanje/route.ts
// Stanje motora utisaka za klijentsko čitanje (Faza 3, 3.6).
//
// Layout je ranije čitao `citajStanjeMotora` + `citajUslove` PRE prvog bajta —
// prvi bajt je čekao na feedback upite (P4). Sada layout šalje `null`, a
// `UtisciProvider` povlači stanje odavde posle prvog prikaza. Broj upita je
// isti, samo kasnije — stranica se crta bez čekanja.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { citajProfil } from "@/lib/profile";
import { citajStanjeMotora, citajUslove } from "@/lib/utisci";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ greska: "Nisi prijavljen." }, { status: 401 });
  }

  try {
    const { profile } = await citajProfil();
    const [stanje, uslovi] = await Promise.all([
      citajStanjeMotora(userId, profile),
      citajUslove(userId, profile),
    ]);

    return NextResponse.json({ stanje, uslovi });
  } catch (err) {
    console.error("[api/utisci/stanje]", err);
    return NextResponse.json({ greska: "Stanje utisaka nije dostupno." }, { status: 500 });
  }
}
