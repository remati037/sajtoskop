// apps/web/src/app/api/billing/portal/route.ts
// Jednokratan link ka Paddle-ovom portalu kupca (S21).
//
// ── šta ostaje kod Paddle-a i zašto ─────────────────────────
// Otkazivanje, izmena kartice, adresa za račun i preuzimanje faktura. To je
// pola razloga zbog kog se merchant of record uopšte koristi: Paddle je
// prodavac od koga kupac kupuje, pa su i račun i PDV i otkazivanje njegova
// obaveza. Sopstveni ekran za otkazivanje bi značio da ja držim kopiju stanja
// koje nije moje, i da se ta kopija razilazi svaki put kad neko otkaže iz mejla
// koji mu je Paddle poslao.
//
// Ovde zato nema nijedne odluke o naplati — samo autentikacija, provera
// vlasništva i jedan poziv koji vrati URL.
//
// ── zašto 404, a ne 403 ─────────────────────────────────────
// Isti razlog kao za admin konzolu (pravilo 13): korisnik bez ijedne kupovine
// ne treba da sazna da portal uopšte postoji, a i ne bi imao šta u njemu da
// radi. `403` bi bio poruka „ovo postoji, ali ne za tebe" — poziv na
// pogađanje. Ruta ovde ne krije tuđ resurs nego odsustvo sopstvenog.
//
// ── granica koja se ne prelazi ──────────────────────────────
// ‼️ Telo zahteva se NE čita. Nema `customerId`, nema `subscriptionId`, nema
//    ničega što bi klijent mogao da pošalje: kupac se izvodi iz Clerk sesije
//    (pravilo 8), a portal link je ključ ka tuđim podacima o naplati. Ruta koja
//    prima `customerId` je ruta koja ga pre ili kasnije prihvati.

import { NextResponse } from "next/server";
import type { ProfileRow } from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { paddleServer } from "@/lib/paddle-server";
import { citajIdPretplata } from "@/lib/pretplata";
import { proveriIpTempo } from "@/lib/rate-limit";
import { adminSupabase } from "@/lib/supabase";

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
  // Svaki poziv ovamo pravi sesiju u Paddle-u. Besplatna je po novcu, ali nije
  // po smeću u tuđoj bazi — isti razlog kao na `/api/billing/checkout`.
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
      .select("paddle_customer_id")
      .eq("id", userId)
      .maybeSingle<Pick<ProfileRow, "paddle_customer_id">>();

    if (greskaProfila) throw new Error(`profiles: ${greskaProfila.message}`);

    const customerId = profil?.paddle_customer_id ?? null;

    // Nalog koji nikad ništa nije kupio nema Paddle kupca. Prazan string bi
    // Paddle vratio kao `400` sa porukom koja ne znači ništa ni meni ni
    // korisniku — pa se odsustvo hvata ovde, eksplicitno.
    if (!customerId) return greska("Nema šta da se otvori.", 404);

    // Svi `sub_` ID-jevi, ne samo najsveži: Paddle za svaki vrati zaseban skup
    // dubokih linkova. Prazan niz je uredan ulaz — kupac koji je uzeo samo
    // paket kredita nema pretplatu, ali ima račune, i portal mu ih pokazuje.
    const idjevi = await citajIdPretplata(userId);

    const sesija = await paddleServer().customerPortalSessions.create(customerId, idjevi);

    // NAZAD IDE SAMO URL. Ceo objekat nosi `customerId`, ID sesije i tabelu
    // dubokih linkova — ništa od toga pregledaču ne treba za jednu redirekciju,
    // a `customerId` u odgovoru je podatak koji nikad nije morao da izađe.
    return NextResponse.json({ url: sesija.urls.general.overview }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/billing/portal]", err);
    return greska("Portal trenutno ne radi. Pokušaj ponovo za koji minut.", 502);
  }
}
