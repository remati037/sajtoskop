// apps/web/src/app/api/onboarding/korak/route.ts
// `POST /api/onboarding/korak` — dve vrste upisa, jedna ruta (S30, §1.8, §4.3).
//
//   {korak: "poruka"}                    — „Kopiraj" na kartici: jedini korak
//                                          trake koji prijavljuje pregledač,
//                                          jer kopiranje nema serverski trag
//   {korak: "grad"|"nisa"|"kanal", vrednost} — odgovor sa ekrana čarobnjaka
//
// `pretraga`, `otkljucavanje` i `pipeline` ovde NE PROLAZE — šema je
// `strictObject` sa literalima, pa telo `{korak: "pipeline"}` dobija 400. Te
// korake upisuju rute koje te radnje i rade (`/api/search`, `lib/unlock.ts`,
// `/api/pipeline`), inače bi traka napretka bila ono što pregledač tvrdi.
//
// `userId` ISKLJUČIVO iz sesije (pravilo 8).

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { oznaciKorak, upisiIzbor } from "@/lib/onboarding";
import { korakBodySchema, type KorakOdgovor } from "@/lib/onboarding-schema";
import { citajPristup, odbijenicaCitanja } from "@/lib/pristup";
import { proveriIpTempo } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

const greska = (poruka: string, status: number) =>
  NextResponse.json({ greska: poruka }, { status, headers: HEADERS });

export async function POST(req: Request): Promise<Response> {
  const ogranicen = await proveriIpTempo(req, "onboarding-korak");
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  // Čitanje svog rada — prolazi i u grace-u, pada samo zaključan nalog.
  const odbijen = odbijenicaCitanja((await citajPristup()).pristup);
  if (odbijen) return odbijen;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return greska("Telo zahteva nije ispravan JSON.", 400);
  }

  const parsed = korakBodySchema.safeParse(raw);
  if (!parsed.success) return greska("Neispravan korak.", 400);

  const telo = parsed.data;

  try {
    if (telo.korak === "poruka") {
      const ishod = await oznaciKorak(userId, "poruka");
      if (!ishod) return greska("Korak trenutno ne može da se upiše.", 500);

      const body: KorakOdgovor = { onboardingSteps: ishod.steps, onboardingDoneAt: ishod.doneAt };
      return NextResponse.json(body, { headers: HEADERS });
    }

    await upisiIzbor(userId, telo.korak, telo.vrednost);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/onboarding/korak]", err);
    return greska("Izbor trenutno ne može da se sačuva. Pokušaj ponovo.", 500);
  }
}
