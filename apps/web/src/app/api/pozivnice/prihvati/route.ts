// apps/web/src/app/api/pozivnice/prihvati/route.ts
// Korisnik prihvata pristupnu pozivnicu (S27, naplata-stripe.md §9.4).
//
// Redosled je isti kao na `/api/billing/checkout`: tempo pre svega, pa sesija,
// pa telo, pa tek onda baza. Tempo je 5 u minuti po adresi (§9.4) — ruta je
// jedina vrata za pogađanje koda, a ručni kod („VLADA2026") se da pogoditi.
//
// `user_id` je ISKLJUČIVO iz sesije (pravilo 8). Telo je strictObject sa
// jednim poljem, pa `userId` u telu nije ignorisan nego odbijen sa 400.

import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";
import { prihvatiPozivnicu } from "@/lib/pozivnice-pristup";
import { prihvatiBodySchema, type PrihvatiOdgovor } from "@/lib/pozivnice-schema";
import { ensureProfile } from "@/lib/profile";
import { proveriIpTempo } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

/** §9.4: 5 pokušaja u minuti sa jedne adrese. */
const TEMPO = 5;

const greska = (poruka: string, status: number) =>
  NextResponse.json({ greska: poruka }, { status, headers: HEADERS });

export async function POST(req: Request): Promise<Response> {
  const ogranicen = await proveriIpTempo(req, "pozivnica-prihvati", TEMPO);
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
  const parsed = prihvatiBodySchema.safeParse(raw);
  if (!parsed.success) return greska("Kod nije ispravnog oblika.", 400);

  try {
    // Profil mora da postoji pre `redeem_invite` — inače `no_user`. Čovek koji
    // se upravo registrovao sa ove strane stiže ovamo za sekund, a `user.created`
    // webhook ume da kasni (isti razlog kao u checkout ruti). Mejl je tu zbog
    // pozivnice vezane za adresu: `redeem_invite` poredi `profiles.email`.
    const korisnik = await currentUser().catch(() => null);
    await ensureProfile(userId, korisnik?.primaryEmailAddress?.emailAddress ?? null);

    const ishod = await prihvatiPozivnicu(userId, parsed.data.code);
    if (!ishod.ok) return greska(ishod.poruka, ishod.status);

    const body: PrihvatiOdgovor = {
      ok: true,
      kind: ishod.kind,
      poruka: ishod.poruka,
      dalje: ishod.dalje,
    };
    return NextResponse.json(body, { headers: HEADERS });
  } catch (err) {
    console.error("[api/pozivnice/prihvati]", err);
    return greska("Pozivnica trenutno ne može da se prihvati. Pokušaj ponovo za koji minut.", 502);
  }
}
