// apps/web/src/app/api/feedback/[id]/route.ts
// Dopuna utiska tekstom i tipom (F10 §2).
//
// Utisak je već upisan i mejl je već otišao u prvom koraku — ovo je dodatak, ne
// slanje. Zato zatvaranje modala bez teksta ne gubi ništa i zato ova ruta sme da
// odbije zahtev bez ijedne posledice po korisnika.
//
// Dopuna šalje DRUGI mejl, sa subjectom `↳ dopuna uz utisak #123`. Dupli mejl se
// dešava samo kad korisnik i oceni i napiše — dakle baš u najvrednijem slučaju —
// i drugi nosi pun sadržaj, pa je prvi samo raniji signal.

import { after, NextResponse } from "next/server";
import { originZahteva } from "@/lib/admin";
import { requireUserId } from "@/lib/auth";
import {
  dopuniUtisak,
  ideOdmah,
  javiMejlom,
  mejlDozvoljenZa,
  nagradaDostupna,
  nagradiZaPoruku,
  porukaZasluzujeNagradu,
} from "@/lib/feedback";
import { dopunaBodySchema, type DopunaOdgovor } from "@/lib/feedback-schema";
import type { ApiError } from "@/lib/search-types";
import { mojaPutanja } from "@/lib/slika";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number, detalji?: string[]): Response {
  const body: ApiError = detalji ? { greska: poruka, detalji } : { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  const { id } = await params;
  const utisakId = Number(id);

  if (!Number.isInteger(utisakId) || utisakId <= 0) {
    return greska("Neispravan ID utiska.", 400);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return greska("Telo zahteva nije ispravan JSON.", 400);
  }

  const parsed = dopunaBodySchema.safeParse(raw);
  if (!parsed.success) {
    return greska(
      "Neispravna dopuna.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  const { screenshot_path } = parsed.data;
  if (screenshot_path !== undefined && !mojaPutanja(userId, screenshot_path)) {
    return greska("Ta slika nije tvoja.", 403);
  }

  try {
    // `dopuniUtisak` filtrira i po `user_id` — bez toga je ovo IDOR na tuđ
    // utisak (P0-1). Ruta tu proveru NE ponavlja i ne sme da je zaobiđe.
    const ishod = await dopuniUtisak(userId, utisakId, parsed.data);

    if (!ishod.ok) {
      if (ishod.razlog === "odgovor") {
        // Drugi korak odgovora ne prolazi šemu iz kataloga (pravilo 16).
        return greska("Odgovor ne odgovara pitanju.", 400, ishod.detalji);
      }

      return ishod.razlog === "kasno"
        ? // Zapis koji sam pročitao u mejlu ne sme da se prepiše sat kasnije.
          greska("Ovaj utisak je stariji od sat vremena i više ne prima dopunu.", 409)
        : // Tuđ i nepostojeći utisak daju isti odgovor — razlika bi rekla koji
          // ID-jevi postoje.
          greska("Taj utisak ne postoji.", 404);
    }

    // ── nagrada: +1 kredit za utisak sa porukom (F11 §6.7) ───
    // Kapije se proveravaju PRE odgovora, jer korisnik u istoj potvrdi treba da
    // sazna šta se desilo; sama dodela ide u `after()`, jer je kredit posledica
    // upisanog utiska a ne uslov za njega. Prozor između to dvoje je jedan
    // zahtev, a `grant_feedback_credits` je idempotentan po `fb:<id>` — u
    // najgorem slučaju se dvaput pokuša isto, nikad se dvaput ne dodeli.
    const nagrada = porukaZasluzujeNagradu(ishod.red) && (await nagradaDostupna(userId));

    // Zapis koji je pri nastanku ostao bez mejla ostaje bez njega i sada.
    // Klijent do drugog koraka u tom slučaju ne stiže, ali ruta se ne oslanja
    // na klijenta.
    // Od F11.3 i drugi mejl poštuje podelu na instant i digest (F11 odluka 11).
    // Tip se bira baš u ovom koraku, pa se tek ovde zna da li je zapis bug —
    // utisak sa dugmeta koji je u drugom koraku označen kao „Bug" ide odmah, a
    // ideja sa istog dugmeta čeka 21:00.
    //
    // `dopuna` je `false` kad prvi mejl nikad nije otišao: subject „↳ dopuna uz
    // utisak #123" pretpostavlja da u inboksu postoji nešto uz šta je ovo dopuna.
    const prviIsao = ishod.red.emailed_at !== null;
    const konzola = originZahteva(req);

    after(async () => {
      if (nagrada) await nagradiZaPoruku(userId, ishod.red);
      if (!ideOdmah(ishod.red)) return;
      if (await mejlDozvoljenZa(ishod.red)) {
        await javiMejlom(ishod.red, userId, prviIsao, konzola);
      }
    });

    return NextResponse.json({ ok: true, nagrada } satisfies DopunaOdgovor, { headers: HEADERS });
  } catch (err) {
    console.error("[api/feedback/dopuna]", err);
    return greska("Dopuna trenutno ne radi. Pokušaj ponovo za koji trenutak.", 500);
  }
}
