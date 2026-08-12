// apps/web/src/app/api/feedback/route.ts
// Nastanak utiska (F10 §2). Zove se na klik na ocenu — nema potvrde, nema
// koraka pre njega.
//
// Redosled je cela odluka 3 iz PRD-a: prvo upis, pa tek onda mejl. Obrnuto bi
// značilo da jedan pad Resend-a briše utisak. Zato je mejl u `after()` i njegov
// ishod ne dodiruje odgovor korisniku — 200 je 200 i kad mejl padne, jer je
// utisak upisan i korisnik sa tom greškom nema šta da radi.
//
// `userId` dolazi ISKLJUČIVO iz `requireUserId()`. Iz tela izlaze ocena, izvor,
// putanja i dimenzije prozora — nikad plan, krediti ni naziv ekrana (pravilo 8).

import { after, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { javiMejlom, upisiIshodMejla, zabeleziUtisak, MEJL_DNEVNI_LIMIT } from "@/lib/feedback";
import { utisakBodySchema, type UtisakOdgovor } from "@/lib/feedback-schema";
import type { ApiError } from "@/lib/search-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const parsed = utisakBodySchema.safeParse(raw);
  if (!parsed.success) {
    return greska(
      "Neispravan utisak.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  const { rating, source, route, viewport } = parsed.data;

  try {
    const ishod = await zabeleziUtisak(userId, {
      rating,
      source,
      route: route ?? null,
      viewport: viewport ?? null,
      // UA iz headera, ne iz tela: telo koje šalje lažan UA ne menja zapis.
      ua: req.headers.get("user-agent") ?? "",
    });

    if (ishod.ishod === "no_user") {
      // Utisak bez profila ne može da postoji zbog stranog ključa. Redak i
      // prolazan slučaj: Clerk webhook nije stigao pre prvog klika.
      return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
    }

    if (ishod.ishod === "plafon") {
      // Tvrd plafon je zaštita tabele, ne poruka korisniku (F10 §5). On i dalje
      // vidi „Hvala. Zabeleženo." — samo bez zapisa koji bi mogao da dopuni.
      return NextResponse.json({ id: null, dopuna: false } satisfies UtisakOdgovor, {
        headers: HEADERS,
      });
    }

    const { red, posaljiMejl } = ishod;

    // Preko dnevnog limita mejl izostaje, ali razlog stoji u bazi umesto u logu
    // koji niko ne čita (odluka 6).
    after(() =>
      posaljiMejl
        ? javiMejlom(red, userId, false)
        : upisiIshodMejla(red.id, {
            ok: false,
            greska: `preko dnevnog limita od ${MEJL_DNEVNI_LIMIT} mejlova`,
          }),
    );

    // Utisak preko dnevnog limita za mejl ne ide u drugi korak: tekst koji niko
    // ne bi pročitao ne traži se (F10 §6). Korisnik toga nije svestan.
    return NextResponse.json({ id: red.id, dopuna: posaljiMejl } satisfies UtisakOdgovor, {
      headers: HEADERS,
    });
  } catch (err) {
    console.error("[api/feedback]", err);
    return greska("Slanje utiska trenutno ne radi. Pokušaj ponovo za koji trenutak.", 500);
  }
}
