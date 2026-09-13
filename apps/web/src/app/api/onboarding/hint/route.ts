// apps/web/src/app/api/onboarding/hint/route.ts
// `POST /api/onboarding/hint` — vođena tačka je zatvorena i ne vraća se (§4.5).
//
// Upis ide u `profiles.onboarding_hints_seen`, u bazi a ne u `localStorage`-u:
// tačka viđena na telefonu ne sme da iskoči ponovo na računaru. Jedini put
// kojim viđena tačka sme da se vrati je „Pokaži mi" iz vodiča (§4.8) — i to je
// odluka pregledača, bez ikakvog upisa.
//
// `userId` ISKLJUČIVO iz sesije (pravilo 8).

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { dodajHint } from "@/lib/onboarding";
import { hintBodySchema } from "@/lib/onboarding-schema";
import { proveriIpTempo } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

const greska = (poruka: string, status: number) =>
  NextResponse.json({ greska: poruka }, { status, headers: HEADERS });

export async function POST(req: Request): Promise<Response> {
  const ogranicen = await proveriIpTempo(req, "onboarding-hint");
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

  const parsed = hintBodySchema.safeParse(raw);
  if (!parsed.success) return greska("Nepoznata tačka.", 400);

  try {
    const hintsSeen = await dodajHint(userId, parsed.data.hint);
    return NextResponse.json({ ok: true, hintsSeen }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/onboarding/hint]", err);
    return greska("Tačka trenutno ne može da se zapamti.", 500);
  }
}
