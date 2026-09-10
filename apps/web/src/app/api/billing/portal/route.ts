// apps/web/src/app/api/billing/portal/route.ts
// Jednokratan link ka Stripe Customer Portalu (naplata-stripe.md §8).
//
// ── šta ostaje kod Stripe-a i zašto ─────────────────────────
// Otkazivanje (na kraj perioda), izmena kartice, promena plana i preuzimanje
// računa. Sopstveni ekran za otkazivanje bi značio da ja držim kopiju stanja
// koje nije moje, i da se ta kopija razilazi svaki put kad neko otkaže iz mejla.
// Podešavanja portala (bez pauze, bez promene količine) su u panelu — §8.
//
// Ovde zato nema nijedne odluke o naplati — samo autentikacija, provera
// vlasništva i jedan poziv koji vrati URL.
//
// ── zašto 404, a ne 403 ─────────────────────────────────────
// Isti razlog kao za admin konzolu (pravilo 13): korisnik bez ijedne kupovine
// ne treba da sazna da portal uopšte postoji, a i ne bi imao šta u njemu da
// radi. Ruta ovde ne krije tuđ resurs nego odsustvo sopstvenog.
//
// ── granica koja se ne prelazi ──────────────────────────────
// ‼️ Telo zahteva se NE čita. Nema `customerId`, nema `subscriptionId`, nema
//    ničega što bi klijent mogao da pošalje: kupac se izvodi iz Clerk sesije
//    (pravilo 8), a portal link je ključ ka tuđim podacima o naplati. Ruta koja
//    prima `customerId` je ruta koja ga pre ili kasnije prihvati.

import { NextResponse } from "next/server";
import type { ProfileRow } from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { KonfigGreska } from "@/lib/env";
import { stripe } from "@/lib/stripe-server";
import { proveriIpTempo } from "@/lib/rate-limit";
import { adminSupabase } from "@/lib/supabase";
import { appUrl } from "@/lib/veze";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Odgovor nosi jednokratan link ka tuđim podacima o naplati. Nikad u deljeni
 * keš — i nikad ni u sopstveni: link je jednokratan i vremenski ograničen, pa
 * je keširan link isto što i pokvaren link.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number): Response {
  return NextResponse.json({ greska: poruka }, { status, headers: HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  // Svaki poziv ovamo pravi sesiju u Stripe-u — isti razlog kao na checkout-u.
  const ogranicen = await proveriIpTempo(req, "billing-portal");
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  try {
    // Admin klijent jer se čita i profil koji Clerk webhook možda još nije
    // stigao da napravi; identitet je i dalje iz sesije, ne iz zahteva.
    const { data: profil, error: greskaProfila } = await adminSupabase()
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle<Pick<ProfileRow, "stripe_customer_id">>();

    if (greskaProfila) throw new Error(`profiles: ${greskaProfila.message}`);

    const customerId = profil?.stripe_customer_id ?? null;

    // Nalog koji nikad nije ušao u checkout nema Stripe kupca. Odsustvo se
    // hvata ovde, eksplicitno — Stripe bi na prazan string vratio `400` sa
    // porukom koja ne znači ništa ni meni ni korisniku.
    if (!customerId) return greska("Nema šta da se otvori.", 404);

    const sesija = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: appUrl("/krediti"),
    });

    // NAZAD IDE SAMO URL. Ceo objekat nosi `customer` i ID sesije — ništa od
    // toga pregledaču ne treba za jednu redirekciju.
    return NextResponse.json({ url: sesija.url }, { headers: HEADERS });
  } catch (err) {
    // Isto razdvajanje kao u checkout ruti: nepodešeno nije isto što i pokvareno.
    if (err instanceof KonfigGreska) {
      console.error("[api/billing/portal] NAPLATA NIJE PODEŠENA:", err.message);
      return greska(
        "Naplata još nije podešena do kraja. Javi mi se na podrska@sajtoskop.com — " +
          "ovo je moja greška, ne tvoja.",
        503,
      );
    }

    console.error("[api/billing/portal]", err);
    return greska("Portal trenutno ne radi. Pokušaj ponovo za koji minut.", 502);
  }
}
