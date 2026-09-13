// apps/web/src/app/api/onboarding/preskoci/route.ts
// `POST /api/onboarding/preskoci` — „Preskoči" u čarobnjaku (§4.2) i „Sakrij"
// u traci napretka (§4.6).
//
// Bez potvrde i bez modala (§4.2): čovek koji zna šta hoće ne sme da bude
// zarobljen. Koraci se i posle ovoga beleže — preskočen je prikaz, ne rad.
//
// `userId` ISKLJUČIVO iz sesije (pravilo 8).

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { preskoci } from "@/lib/onboarding";
import { preskociBodySchema } from "@/lib/onboarding-schema";
import { proveriIpTempo } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

const greska = (poruka: string, status: number) =>
  NextResponse.json({ greska: poruka }, { status, headers: HEADERS });

export async function POST(req: Request): Promise<Response> {
  const ogranicen = await proveriIpTempo(req, "onboarding-preskoci");
  if (ogranicen) return ogranicen;

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

  const parsed = preskociBodySchema.safeParse(raw);
  if (!parsed.success) return greska("Neispravan zahtev.", 400);

  try {
    await preskoci(userId, parsed.data.gde);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/onboarding/preskoci]", err);
    return greska("Trenutno ne mogu da sačuvam izbor. Pokušaj ponovo.", 500);
  }
}
