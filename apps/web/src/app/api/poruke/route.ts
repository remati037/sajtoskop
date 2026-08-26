// apps/web/src/app/api/poruke/route.ts
// GET  — tri gotove poruke za jedan otključan lead (F7 §2)
// POST — korisnik je kopirao poruku: upiši kanal, pomeri lead, sačuvaj tekst
//
// Poruka sadrži telefon, adresu sajta i AI nalaz — sve polja koja pravilo 9
// zaključava. Zato obe metode prvo proveravaju otključanje, i to kroz RLS, pre
// nego što išta pročitaju.
//
// GET, a ne POST za generisanje: generisanje je čitanje bez ijedne izmene i bez
// ijednog spoljnog poziva. AI varijanta („Napiši drugačije") je zaseban ulaz i
// ima svoju rutu, jer ona jedina troši novac.

import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";
import { porukeZaLead, zabeleziKopiranje } from "@/lib/poruke";
import { kontaktBodySchema } from "@/lib/pipeline-schema";
import { citajPristup, odbijenicaCitanja } from "@/lib/pristup";
import type { ApiError } from "@/lib/search-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number, detalji?: string[]): Response {
  const body: ApiError = detalji ? { greska: poruka, detalji } : { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

/**
 * Ime kojim se korisnik potpisuje.
 *
 * Iz Clerk profila, ne iz zahteva: potpis je jedini deo poruke koji tvrdi ko je
 * pošiljalac, i ne sme da dolazi iz tela. Bez imena poruka ide bez potpisa —
 * bolje nego „Dobar dan, zovem se undefined".
 */
async function potpis(): Promise<string | null> {
  const user = await currentUser();
  const ime = user?.firstName?.trim();
  return ime && ime.length > 0 ? ime : null;
}

export async function GET(req: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }
  void userId; // identitet nosi `userSupabase()` kroz RLS, ne parametar upita

  // [S19] Poruke se sklapaju iz podataka koje je korisnik VEĆ platio, bez ijednog
  // spoljnog poziva — dakle čitanje, i u `grace` stanju radi (§1.5). Pada samo
  // zaključan nalog. AI varijanta („Napiši drugačije") je zaseban ulaz i ima
  // strožu kapiju, jer ona jedina košta.
  const odbijenGet = odbijenicaCitanja((await citajPristup()).pristup);
  if (odbijenGet) return odbijenGet;

  const placeId = new URL(req.url).searchParams.get("placeId")?.trim();
  if (!placeId) return greska("Nedostaje ID prospekta.", 400);

  try {
    const ishod = await porukeZaLead(placeId, await potpis());

    if (!ishod.ok) {
      return ishod.razlog === "no_place"
        ? greska("Taj prospekt više ne postoji u bazi.", 404)
        : greska("Taj prospekt nije otključan.", 403);
    }

    // `rezultat.ok === false` NIJE greška rute: generator je svesno odbio da
    // piše (uredan sajt, nema konkretnog nalaza). To je 200 sa obrazloženjem,
    // jer je odgovor tačan i korisnik treba da ga pročita, a ne da vidi grešku.
    return NextResponse.json(
      { naziv: ishod.naziv, ...ishod.rezultat },
      { headers: HEADERS },
    );
  } catch (err) {
    console.error("[api/poruke GET]", err);
    return greska("Generisanje poruka trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  // [S19] „Kopirao sam poruku" pomera karticu u pipeline-u — korisnikov rad, ne
  // kupovina. Ista kapija kao na `/api/pipeline`.
  const odbijenPost = odbijenicaCitanja((await citajPristup()).pristup);
  if (odbijenPost) return odbijenPost;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return greska("Telo zahteva nije ispravan JSON.", 400);
  }

  const parsed = kontaktBodySchema.safeParse(raw);
  if (!parsed.success) {
    return greska(
      "Neispravan zahtev.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  const { placeId, channel, body, source } = parsed.data;

  try {
    const ishod = await zabeleziKopiranje(userId, placeId, channel, body, source);

    if (!ishod.ok) {
      return greska("Taj prospekt nije otključan, pa ne može u pipeline.", 403);
    }

    return NextResponse.json({ ok: true, status: ishod.status }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/poruke POST]", err);
    return greska("Upis kontakta trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}
