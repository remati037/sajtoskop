// apps/web/src/app/api/billing/checkout/route.ts
// Server pravi Stripe Checkout Session, pregledač je samo otvara (`location.assign`).
//
// ── zašto uopšte postoji, umesto klijentskog SDK-a ──────────
// Zato što su `client_reference_id` i `metadata.user_id` jedini put kojim se
// kupovina vezuje za nalog, a taj ID sme da dođe ISKLJUČIVO iz verifikovane
// Clerk sesije na serveru (pravilo 8). Da ga upisuje pregledač, svako bi mogao
// da plati na tuđi nalog — ili, češće i gore, da plati sa druge mejl adrese i
// ostane bez ičega, jer vezivanje po mejlu ne radi (naplata-stripe.md §6.3).
//
// Uz to server ovde zna nešto što pregledač ne sme da zna pouzdano: ima li
// nalog živu pretplatu, komp, ili pozivnicu „prvi mesec gratis".

import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import {
  CREDIT_PACKS,
  kupovinaZaLookupKey,
  lookupKeyZaPaket,
  lookupKeyZaPlan,
  smeDaKupiPaket,
  stanjePristupa,
  TRIAL_DAYS,
  type ProfileRow,
} from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { checkoutBodySchema } from "@/lib/billing-schema";
import { KonfigGreska, stripeServerEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe-server";
import { priceIdZa } from "@/lib/stripe-katalog";
import { citajPretplatu } from "@/lib/pristup";
import { ensureProfile } from "@/lib/profile";
import { proveriIpTempo } from "@/lib/rate-limit";
import { adminSupabase } from "@/lib/supabase";
import { appUrl } from "@/lib/veze";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Odgovor nosi jednokratan URL sesije jednog korisnika — nikad u deljeni keš. */
const HEADERS = { "Cache-Control": "private, no-store" };

const greska = (poruka: string, status: number) =>
  NextResponse.json({ greska: poruka }, { status, headers: HEADERS });

type Profil = Pick<
  ProfileRow,
  "plan" | "stripe_customer_id" | "komp_expires_at" | "plan_expires_at" | "credits_topup" | "invite_id"
>;

/**
 * Je li nalog ikad imao probu: `trial_grant` u knjizi (jednom po nalogu) ili
 * pretplata sa `trial_end`. Drugu probu isti nalog ne dobija (§5.2, §7.6).
 */
async function imaoProbuRanije(userId: string): Promise<boolean> {
  const db = adminSupabase();

  const { data: knjiga, error: kErr } = await db
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", "trial_grant")
    .limit(1)
    .returns<{ id: number }[]>();
  if (kErr) throw new Error(`credit_ledger: ${kErr.message}`);
  if ((knjiga ?? []).length > 0) return true;

  const { data: pretplate, error: pErr } = await db
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .not("trial_end", "is", null)
    .limit(1)
    .returns<{ stripe_subscription_id: string }[]>();
  if (pErr) throw new Error(`subscriptions: ${pErr.message}`);
  return (pretplate ?? []).length > 0;
}

export async function POST(req: Request): Promise<Response> {
  // Tempo pre svega, kao na `/api/unlock`: svaki poziv ovamo pravi sesiju u
  // Stripe-u, pa je i besplatan po novcu skup po smeću u tuđoj bazi.
  const ogranicen = await proveriIpTempo(req, "billing-checkout");
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    // Gost nema `user_id`, pa nema ni čime da se poveže kupovina. Ekran cena ga
    // zato šalje na registraciju sa povratkom ovamo — v. `cenovnik-ekran.tsx`.
    return greska("Nisi prijavljen.", 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return greska("Telo zahteva nije ispravan JSON.", 400);
  }
  const parsed = checkoutBodySchema.safeParse(raw);
  if (!parsed.success) return greska("Nepoznat plan ili paket.", 400);
  const telo = parsed.data;

  try {
    // ── profil MORA da postoji pre nego što novac krene ──────
    // ‼️ Webhook vezuje kupovinu za nalog kroz `metadata.user_id`, ali TEK ako
    //    red u `profiles` postoji (`nadjiKorisnika` → `profilPostoji`). Ako ga
    //    nema, događaj završi kao TRAJAN neuspeh (200, bez ponavljanja) i novac
    //    je naplaćen bez ijednog kredita. Izmereno kod prethodnog provajdera: webhook je
    //    stigao 14 sekundi PRE reda u `profiles`, jer je gost sa `/cenovnik`
    //    (izvan `(app)` grupe) registrovao nalog i odmah kupio. RPC je
    //    idempotentan, pa ponovljen poziv ne radi ništa.
    const korisnik = await currentUser().catch(() => null);
    const email = korisnik?.primaryEmailAddress?.emailAddress ?? null;
    await ensureProfile(userId, email);

    const { data: profil, error } = await adminSupabase()
      .from("profiles")
      .select("plan, stripe_customer_id, komp_expires_at, plan_expires_at, credits_topup, invite_id")
      .eq("id", userId)
      .maybeSingle<Profil>();
    if (error) throw new Error(`profiles: ${error.message}`);
    if (!profil) throw new Error("profil nije nastao");

    const pretplata = await citajPretplatu(userId);
    const pristup = stanjePristupa(
      {
        plan: profil.plan,
        kompExpiresAt: profil.komp_expires_at,
        planExpiresAt: profil.plan_expires_at,
        creditsTopup: profil.credits_topup,
      },
      pretplata,
      Date.now(),
    );

    const { STRIPE_COUPON_FIRST_MONTH } = stripeServerEnv();
    const s = stripe();

    // Jedan Stripe customer po nalogu. Pravi se ovde, ne u Checkout-u, da bi
    // `customer` bio poznat pre webhooka i da bi portal radio i za paket.
    let customerId = profil.stripe_customer_id;
    if (!customerId) {
      const c = await s.customers.create({
        email: email ?? undefined,
        metadata: { user_id: userId },
      });
      customerId = c.id;
      const { error: upisErr } = await adminSupabase()
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
      if (upisErr) throw new Error(`profiles(stripe_customer_id): ${upisErr.message}`);
    }

    const success = appUrl("/welcome?sesija={CHECKOUT_SESSION_ID}");
    const cancel = appUrl(
      telo.vrsta === "plan"
        ? `/cenovnik?plan=${telo.plan}&ciklus=${telo.ciklus === "year" ? "godisnje" : "mesecno"}`
        : "/cenovnik#paketi",
    );

    if (telo.vrsta === "paket") {
      // ── paket traži postojeći pristup ──────────────────────
      // Odluka od 26.8.: paket kredita je DOPUNA, ne ulaz u proizvod. Spisak
      // stanja živi u `smeDaKupiPaket()` u shared paketu — isti koji čita i
      // ekran cena. ‼️ Provera je OVDE, ne samo na ekranu: skriveno dugme nije
      // kapija (pravilo 9).
      if (!smeDaKupiPaket(pristup)) {
        return greska(
          "Paket kredita je dopuna uz aktivan plan. Uzmi plan na /cenovnik — paketi se otključavaju čim plan bude aktivan.",
          403,
        );
      }
      const key = lookupKeyZaPaket(telo.paket);
      const sesija = await s.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        // Clerk user id — jedini podatak koji nosi identitet.
        client_reference_id: userId,
        line_items: [{ price: await priceIdZa(key), quantity: 1 }],
        metadata: {
          user_id: userId,
          kind: "pack",
          paket: telo.paket,
          credits: String(CREDIT_PACKS[telo.paket].credits),
        },
        payment_intent_data: { metadata: { user_id: userId, kind: "pack", lookup_key: key } },
        success_url: success,
        cancel_url: cancel,
        locale: "auto",
        allow_promotion_codes: false,
      });
      return NextResponse.json({ url: sesija.url }, { headers: HEADERS });
    }

    // ── pretplata ────────────────────────────────────────────
    // Ko već ima živu pretplatu, ne pravi drugu — promena plana ide kroz portal.
    if (pretplata && ["trialing", "active", "past_due"].includes(pretplata.status)) {
      return greska(`Već imaš plan. Promena plana ide kroz „Upravljaj pretplatom" na /krediti.`, 409);
    }
    // Komp ne kupuje plan dok komp traje.
    if (pristup.stanje === "komp") {
      return greska(
        "Imaš komp pristup — plan ti sada ne treba. Kad istekne, ovde ćeš moći da ga uzmeš.",
        409,
      );
    }

    const key = lookupKeyZaPlan(telo.plan, telo.ciklus);
    const kupovina = kupovinaZaLookupKey(key);
    if (!kupovina || kupovina.kind !== "subscription") return greska("Nepoznat plan.", 400);

    // Pozivnica „prvi mesec gratis": bez probe, 100% kupon na prvi period (§9).
    // Inače: proba 7 dana, kartica obavezna, ako je nalog nikad nije imao.
    const gratisMesec = profil.invite_id !== null;
    const imaoProbu = await imaoProbuRanije(userId);
    const meta = {
      user_id: userId,
      kind: "subscription",
      plan: telo.plan,
      ciklus: telo.ciklus,
      lookup_key: key,
      ...(gratisMesec ? { invite_id: String(profil.invite_id) } : {}),
    };

    const sesija = await s.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: await priceIdZa(key), quantity: 1 }],
      // D2: kartica PRE probe.
      payment_method_collection: "always",
      subscription_data: {
        metadata: meta,
        ...(!gratisMesec && !imaoProbu
          ? {
              trial_period_days: TRIAL_DAYS,
              trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
            }
          : {}),
      },
      ...(gratisMesec
        ? { discounts: [{ coupon: STRIPE_COUPON_FIRST_MONTH }] }
        : { allow_promotion_codes: false }),
      metadata: meta,
      success_url: success,
      cancel_url: cancel,
      locale: "auto",
      // Kupac iz Srbije uglavnom nema PIB polje; ne tražimo ni adresu.
      billing_address_collection: "auto",
    });

    return NextResponse.json({ url: sesija.url }, { headers: HEADERS });
  } catch (err) {
    // ‼️ Nepodešena naplata se razdvaja od pravog kvara i to nije kozmetika.
    //    „Pokušaj ponovo za koji minut" nad praznom env promenljivom je uputstvo
    //    koje ne može da uspe. Razlog stoji u logu sa imenima promenljivih;
    //    korisniku ide `503` i rečenica koja ga vodi na podršku.
    if (err instanceof KonfigGreska) {
      console.error("[api/billing/checkout] NAPLATA NIJE PODEŠENA:", err.message);
      return greska(
        "Naplata još nije podešena do kraja. Javi mi se na podrska@sajtoskop.com — ovo je moja greška, ne tvoja.",
        503,
      );
    }
    console.error("[api/billing/checkout]", err);
    return greska("Plaćanje trenutno ne radi. Pokušaj ponovo za koji minut.", 502);
  }
}
