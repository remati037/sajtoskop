// apps/web/src/app/api/billing/aktiviraj/route.ts
// „Aktiviraj odmah": proba se završava danas i Stripe odmah naplaćuje pun
// period (naplata-stripe.md §7.4, S26). Dalje je sve isto kao osmog dana —
// `invoice.paid` (`subscription_cycle`) postavlja kredite na plan, a
// `subscription.updated` prebacuje status na `active`. Ova ruta NE dira ni
// kredite ni bazu: izvor istine su webhookovi, isto kao posle checkout-a.
//
// ── granica koja se ne prelazi ──────────────────────────────
// ‼️ Telo je prazno (`aktivirajBodySchema` = `strictObject({})`). Pretplata se
//    nalazi u `subscriptions` po `user_id` iz Clerk sesije (pravilo 8), nikad
//    po ID-ju iz zahteva — v. `lib/aktiviraj.ts`.
//
// ── zašto `payment_behavior: "error_if_incomplete"` ─────────
// Spec (§7.4) traži samo `trial_end: "now"` i `proration_behavior: "none"`. Uz
// podrazumevano `allow_incomplete` odbijena kartica NE obara poziv: Stripe
// završi probu, faktura ostane otvorena, a pretplata pređe u `past_due` — čovek
// koji je kliknuo „plati sada" izgubi probu koju je imao do osmog dana. Ovako
// Stripe odbije ceo update sa `402`, proba traje dalje, a korisnik dobije
// rečenicu da promeni karticu.

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { aktivirajProbu, type IshodStripea, type PretplataZaAktivaciju } from "@/lib/aktiviraj";
import { requireUserId } from "@/lib/auth";
import { aktivirajBodySchema } from "@/lib/billing-schema";
import { KonfigGreska } from "@/lib/env";
import { proveriIpTempo } from "@/lib/rate-limit";
import { stripe } from "@/lib/stripe-server";
import { adminSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

const greska = (poruka: string, status: number, kod?: string) =>
  NextResponse.json({ greska: poruka, ...(kod ? { kod } : {}) }, { status, headers: HEADERS });

/**
 * Tempo niži od podrazumevanog (100): legitiman korisnik ovo klikne jednom u
 * životu naloga, a svaki poziv je jedan Stripe zahtev nad pravom karticom.
 */
const TEMPO_AKTIVACIJE = 10;

type Red = { stripe_subscription_id: string; status: string; cancel_at_period_end: boolean };

/** Proba iz NAŠE tabele. Admin klijent: `subscriptions` nema politika (0022 §3). */
async function citajProbu(userId: string): Promise<PretplataZaAktivaciju | null> {
  const { data, error } = await adminSupabase()
    .from("subscriptions")
    .select("stripe_subscription_id, status, cancel_at_period_end")
    .eq("user_id", userId)
    .eq("status", "trialing")
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<Red>();
  if (error) throw new Error(`subscriptions: ${error.message}`);
  return data
    ? {
        subscriptionId: data.stripe_subscription_id,
        status: data.status,
        cancelAtPeriodEnd: data.cancel_at_period_end,
      }
    : null;
}

/**
 * Stripe strana. Stanje se čita iz Stripe-a PRE izmene: naš red kasni za
 * webhookom, pa dupli klik (ili drugi tab) posle uspešne aktivacije još vidi
 * `trialing` u bazi — a Stripe već zna da je pretplata aktivna.
 */
function zavrsiProbuZa(userId: string) {
  return async (subscriptionId: string): Promise<IshodStripea> => {
    const s = stripe();
    const sub = await s.subscriptions.retrieve(subscriptionId);

    // Pojas i tregeri: red je nađen po `user_id`, ali pretplata nosi i svoj
    // `metadata.user_id` iz checkout-a. Neslaganje znači pokvaren red u bazi,
    // i tada se ne naplaćuje ništa.
    const vlasnik = sub.metadata?.user_id;
    if (sub.status !== "trialing" || (vlasnik && vlasnik !== userId)) return "nije_u_probi";

    try {
      await s.subscriptions.update(subscriptionId, {
        trial_end: "now",
        proration_behavior: "none",
        payment_behavior: "error_if_incomplete",
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) return "kartica_odbijena";
      throw err;
    }
    return "ok";
  };
}

export async function POST(req: Request): Promise<Response> {
  const ogranicen = await proveriIpTempo(req, "billing-aktiviraj", TEMPO_AKTIVACIJE);
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  // Prazno telo je ispravno telo. Sve ostalo ide kroz šemu, koja ga odbija.
  let raw: unknown = {};
  const tekst = await req.text().catch(() => "");
  if (tekst.trim() !== "") {
    try {
      raw = JSON.parse(tekst);
    } catch {
      return greska("Telo zahteva nije ispravan JSON.", 400);
    }
  }
  if (!aktivirajBodySchema.safeParse(raw).success) {
    return greska("Ova radnja ne prima podatke — pretplata se nalazi po tvom nalogu.", 400);
  }

  try {
    const ishod = await aktivirajProbu(userId, {
      citajProbu,
      zavrsiProbu: zavrsiProbuZa(userId),
    });
    if (!ishod.ok) return greska(ishod.poruka, ishod.status, ishod.kod);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (err) {
    if (err instanceof KonfigGreska) {
      console.error("[api/billing/aktiviraj] NAPLATA NIJE PODEŠENA:", err.message);
      return greska(
        "Naplata još nije podešena do kraja. Javi mi se na podrska@sajtoskop.com — ovo je moja greška, ne tvoja.",
        503,
      );
    }
    console.error("[api/billing/aktiviraj]", err);
    return greska("Aktivacija trenutno ne radi. Pokušaj ponovo za koji minut.", 502);
  }
}
