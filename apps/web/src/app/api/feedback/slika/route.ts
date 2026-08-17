// apps/web/src/app/api/feedback/slika/route.ts
// Otprema slike uz utisak (F11 §5, §8).
//
// Jedina ruta u aplikaciji koja prima binarni sadržaj iz pregledača, pa je i
// jedina na kojoj lista provera iz F11 §8 stoji doslovno:
//
//   ≤ 2 MB · png/jpeg/webp po MAGIČNIM BAJTOVIMA, ne po `Content-Type`-u ·
//   ime iz `uuid`, korisnikovo se ne koristi · privatan bucket, bez politike ·
//   10 otprema na 24 h · `user_id` iz sesije, nikad iz tela
//
// Odgovor je putanja u bucketu, ne URL. Potpisan URL postoji samo u adminu i
// živi 10 minuta (F11.3) — link koji bi ovde izašao bio bi tajna koja živi
// koliko i tab u kom je otvorena.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import type { SlikaOdgovor } from "@/lib/feedback-schema";
import { proveriIpTempo } from "@/lib/rate-limit";
import type { ApiError } from "@/lib/search-types";
import { otpremiSliku, prepoznajSliku, SLIKA_MAX_BAJTOVA } from "@/lib/slika";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number): Response {
  return NextResponse.json({ greska: poruka } satisfies ApiError, { status, headers: HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  // IP tempo pre svega (Faza 1, 1.2) — slika je i novac (Storage) i disk.
  const ogranicen = await proveriIpTempo(req, "feedback-slika");
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  let polje: FormDataEntryValue | null;
  try {
    const forma = await req.formData();
    polje = forma.get("slika");
  } catch {
    return greska("Telo zahteva nije multipart forma.", 400);
  }

  if (!(polje instanceof File)) {
    return greska("Nema slike u zahtevu.", 400);
  }

  // Prvo veličina, pa tek onda čitanje: `arrayBuffer()` nad 50 MB fajla je 50 MB
  // u memoriji Vercel funkcije, i to pre nego što se sazna da je prevelik.
  if (polje.size > SLIKA_MAX_BAJTOVA) {
    return greska("Slika je prevelika — do 2 MB.", 413);
  }

  const bajtovi = new Uint8Array(await polje.arrayBuffer());

  // Druga provera veličine, nad stvarno pročitanim bajtovima: `File.size` dolazi
  // iz istog tela iz kog i sadržaj.
  if (bajtovi.byteLength > SLIKA_MAX_BAJTOVA) {
    return greska("Slika je prevelika — do 2 MB.", 413);
  }

  const vrsta = prepoznajSliku(bajtovi);
  if (!vrsta) {
    return greska("Slika mora da bude PNG, JPEG ili WEBP.", 415);
  }

  try {
    const ishod = await otpremiSliku(userId, bajtovi, vrsta);

    if (!ishod.ok) {
      return greska(ishod.poruka, ishod.razlog === "limit" ? 429 : 502);
    }

    return NextResponse.json({ path: ishod.path } satisfies SlikaOdgovor, { headers: HEADERS });
  } catch (err) {
    console.error("[api/feedback/slika]", err);
    return greska("Slanje slike trenutno ne radi. Utisak i dalje možeš da pošalješ.", 500);
  }
}
