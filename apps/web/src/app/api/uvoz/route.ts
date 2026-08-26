// apps/web/src/app/api/uvoz/route.ts
// Uvoz postojećeg pipeline Sheeta iz CSV-a (F7 §4).
//
// Fajl stiže kao `multipart/form-data`, ne kao JSON string: CSV od dve hiljade
// redova u JSON telu se pretvara u escapovan string koji zauzima duplo, a
// `FormData` je i ono što `<input type="file">` prirodno šalje.
//
// `userId` dolazi ISKLJUČIVO iz `requireUserId()`. Iz forme izlaze samo fajl i
// jedna zastavica (pravilo 8, P0-1).

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { citajPristup, odbijenica } from "@/lib/pristup";
import { proveriIpTempo } from "@/lib/rate-limit";
import type { ApiError } from "@/lib/search-types";
import { uveziPipeline } from "@/lib/uvoz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Uvoz ume da otključava, a otključavanje čeka `spend_credit_and_unlock` po
 * redu. Podrazumevanih 10 s Vercel-ovog Hobby plana je premalo za par stotina
 * redova; 60 s je gornja granica tog plana.
 */
export const maxDuration = 60;

/** 2 MB je oko 20.000 redova — daleko iznad `MAX_REDOVA`, a štiti od 100 MB tela. */
const MAX_BYTES = 2 * 1024 * 1024;

const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number): Response {
  const body: ApiError = { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  // IP tempo pre svega (Faza 1, 1.2) — uvoz troši i kredite i bazu.
  const ogranicen = await proveriIpTempo(req, "uvoz");
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  // [S19] Uvoz ume da OTKLJUČAVA redove, dakle troši kredite — ista kapija kao
  // na `/api/unlock`, i pre čitanja fajla od 2 MB.
  const { pristup } = await citajPristup();
  const odbijen = odbijenica(pristup, "uvoz");
  if (odbijen) return odbijen;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return greska("Zahtev nije ispravna forma sa fajlom.", 400);
  }

  const fajl = form.get("csv");
  if (!(fajl instanceof File)) return greska("Nedostaje CSV fajl.", 400);
  if (fajl.size === 0) return greska("Fajl je prazan.", 400);
  if (fajl.size > MAX_BYTES) {
    return greska(`Fajl je veći od ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`, 413);
  }

  // Zastavica se čita strogo: sve što nije doslovno „da" znači ne. Podrazumevano
  // ponašanje ne sme da troši kredite ni kad klijent pošalje nešto neočekivano.
  const trosiKredite = form.get("trosiKredite") === "da";

  try {
    const ishod = await uveziPipeline(userId, await fajl.text(), trosiKredite);

    if (!ishod.ok) return greska(ishod.greska, 400);

    return NextResponse.json(ishod.izvestaj, { headers: HEADERS });
  } catch (err) {
    console.error("[api/uvoz]", err);
    return greska("Uvoz trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}
