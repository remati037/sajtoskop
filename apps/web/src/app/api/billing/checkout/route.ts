// apps/web/src/app/api/billing/checkout/route.ts
// Server pravi Paddle transakciju, pregledač je samo otvara.
//
// ── zašto uopšte postoji, umesto `Checkout.open({ items })` ─
// Zato što je `custom_data.user_id` jedini put kojim se kupovina vezuje za
// nalog, a taj ID sme da dođe ISKLJUČIVO iz verifikovane Clerk sesije na
// serveru (pravilo 8). Da ga upisuje pregledač, svako bi mogao da plati na tuđi
// nalog — ili, češće i gore, da plati sa druge mejl adrese i ostane bez ičega,
// jer vezivanje po mejlu ne radi (pravilo 2 iz naplata-paddle.md §5.3).
//
// Uz to server ovde zna nešto što pregledač ne sme da zna pouzdano: da li je
// korisnik beta. Zbog toga popust može da se primeni sam, bez kucanja koda.

import { NextResponse } from "next/server";
import { kupovinaZaPriceId, smeDaKupiPaket, stanjePristupa } from "@sajtoskop/shared";
import type { ProfileRow } from "@sajtoskop/shared";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";
import { checkoutBodySchema } from "@/lib/billing-schema";
import { KonfigGreska, paddleBetaDiscountId } from "@/lib/env";
import { paddleServer } from "@/lib/paddle-server";
import { citajPretplatu } from "@/lib/pristup";
import { ensureProfile } from "@/lib/profile";
import { proveriIpTempo } from "@/lib/rate-limit";
import { adminSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Odgovor nosi ID transakcije jednog korisnika — nikad u deljeni keš. */
const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number, detalji?: string[]): Response {
  return NextResponse.json(detalji ? { greska: poruka, detalji } : { greska: poruka }, {
    status,
    headers: HEADERS,
  });
}

export async function POST(req: Request): Promise<Response> {
  // Tempo pre svega, kao na `/api/unlock`: svaki poziv ovamo pravi red u
  // Paddle-u, pa je i besplatan po novcu skup po smeću u tuđoj bazi.
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
  if (!parsed.success) {
    return greska(
      "Nepoznat plan ili paket.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  const { priceId } = parsed.data;
  // Šema je pripadnost katalogu već proverila; ovo je izvođenje, ne provera.
  const kupovina = kupovinaZaPriceId(priceId);
  if (!kupovina) return greska("Nepoznat plan ili paket.", 400);

  try {
    // ── profil MORA da postoji pre nego što novac krene ──────
    // ‼️ Ovo nije udobnost nego uslov ispravnosti naplate, i naučeno je skupo.
    //
    // Webhook vezuje kupovinu za nalog kroz `custom_data.user_id`, ali TEK ako
    // red u `profiles` postoji (`nadjiKorisnika` → `profilPostoji`). Ako ga
    // nema, `transaction.completed` završi kao „transakcija nije vezana ni za
    // jedan profil" — a to je TRAJAN neuspeh: ruta vrati `200`, Paddle ne
    // ponavlja, i novac je naplaćen bez ijednog kredita.
    //
    // Do S21 se to nije moglo desiti: kupovina je počinjala iz aplikacije, a
    // `(app)/layout.tsx` je profil već napravio. S21 je otvorio put koji tu
    // pretpostavku ruši — gost sa `/cenovnik` se registruje i odmah kupuje, a
    // `/cenovnik` je namerno IZVAN grupe `(app)`, pa taj layout nikad nije ni
    // izvršen. Izmereno na pravoj kupovini: webhook je stigao **14 sekundi pre**
    // nego što je red u `profiles` nastao.
    //
    // Zato ovde, a ne u webhooku: webhook ne sme da pravi profile (identitet mu
    // dolazi iz Paddle payload-a, ne iz sesije), a ovo je poslednja tačka na
    // kojoj se zna ko kupuje I još se ništa nije naplatilo. RPC je idempotentan
    // (`credit_ledger_grant_idem_idx`), pa ponovljen poziv ne radi ništa.
    //
    // Baca ako ne uspe — i to je namerno: bolje „plaćanje trenutno ne radi"
    // nego naplata koju niko neće moći da veže za nalog.
    const korisnik = await currentUser().catch(() => null);
    await ensureProfile(userId, korisnik?.primaryEmailAddress?.emailAddress ?? null);

    // `plan` je za popust, `paddle_customer_id` za vezivanje ponovljene
    // kupovine za istog Paddle kupca. Admin klijent jer se čita TUĐ red? Ne —
    // čita se sopstveni, ali `profiles` politika pušta samo `select` kroz
    // korisnički token.
    const { data: profil, error: greskaProfila } = await adminSupabase()
      .from("profiles")
      .select("plan, paddle_customer_id, beta_expires_at, plan_expires_at, credits_topup")
      .eq("id", userId)
      .maybeSingle<
        Pick<
          ProfileRow,
          "plan" | "paddle_customer_id" | "beta_expires_at" | "plan_expires_at" | "credits_topup"
        >
      >();

    if (greskaProfila) throw new Error(`profiles: ${greskaProfila.message}`);

    // ── paket traži postojeći pristup ────────────────────────
    // Odluka od 26.8.: paket kredita je DOPUNA, ne ulaz u proizvod. Sme ga
    // kupiti `aktivan`, `otkazan` i `beta`; ko nema ništa od toga, uzima plan.
    // Spisak stanja živi u `smeDaKupiPaket()` u shared paketu — isti koji čita
    // i ekran cena, jer bi dva spiska značila dugme koje se vidi a ne radi.
    //
    // ‼️ Provera je OVDE, ne samo na ekranu. Ekran cena skriva dugme, ali telo
    //    zahteva se sastavlja u pregledaču: bez ove grane bi svako ko pošalje
    //    `pri_` paketa dobio transakciju bez obzira na stanje naloga. Skriveno
    //    dugme nije kapija, isto kao što CSS blur nije bezbednost (pravilo 9).
    if (kupovina.kind === "pack") {
      const pretplata = await citajPretplatu(userId);
      const pristup = profil
        ? stanjePristupa(
            {
              plan: profil.plan,
              betaExpiresAt: profil.beta_expires_at,
              planExpiresAt: profil.plan_expires_at,
              creditsTopup: profil.credits_topup,
            },
            pretplata,
            Date.now(),
          )
        : null;

      if (!smeDaKupiPaket(pristup)) {
        // `403`, ne `402`: ovo nije stanje novčanika nego stanje naloga —
        // isti razlog iz kog `odbijenica()` u `lib/pristup.ts` bira 403.
        return greska(
          "Paket kredita je dopuna uz aktivan plan ili betu. Uzmi plan na /cenovnik — " +
            "paketi se otključavaju čim plan bude aktivan.",
          403,
        );
      }
    }

    // ── kupon za betu (LANSIRANJE §1.6) ────────────────────
    // Popust je u Paddle-u ograničen na proizvode pretplata i podešen kao
    // jednokratan (`recur: false`), pa PAKETE namerno ne hvata — slanje
    // `discountId` uz paket bi Paddle odbio, ne popustio. Kod `BETA2026` ostaje
    // i dalje kucljiv u checkout-u; oba puta vode do istog popusta.
    const discountId = paddleBetaDiscountId();
    const popust =
      kupovina.kind === "subscription" && profil?.plan === "beta" && discountId
        ? discountId
        : null;

    const transakcija = await paddleServer().transactions.create({
      items: [{ priceId, quantity: 1 }],
      // JEDINI podatak koji nosi identitet. `kind` je uz njega kao ukrštena
      // provera za webhook — odluku tamo donosi katalog, ne ovo polje.
      customData: { user_id: userId, kind: kupovina.kind },
      ...(profil?.paddle_customer_id ? { customerId: profil.paddle_customer_id } : {}),
      ...(popust ? { discountId: popust } : {}),
    });

    return NextResponse.json({ transactionId: transakcija.id }, { headers: HEADERS });
  } catch (err) {
    // Poruka u logu ne sme da nosi ključ. `ApiError` iz SDK-a ga ne prilaže, a
    // sopstveni tekstovi ga nikad ne sklapaju — v. `lib/paddle-server.ts`.
    //
    // ‼️ Nepodešena naplata se razdvaja od pravog kvara i to nije kozmetika.
    //    „Pokušaj ponovo za koji minut" nad praznom env promenljivom je uputstvo
    //    koje ne može da uspe — ni za minut ni za mesec. Razlog stoji u logu sa
    //    imenima promenljivih; korisniku ide `503` i rečenica koja ga vodi na
    //    podršku umesto u petlju osvežavanja.
    if (err instanceof KonfigGreska) {
      console.error("[api/billing/checkout] NAPLATA NIJE PODEŠENA:", err.message);
      return greska(
        "Naplata još nije podešena do kraja. Javi mi se na podrska@sajtoskop.com — " +
          "ovo je moja greška, ne tvoja.",
        503,
      );
    }

    console.error("[api/billing/checkout]", err);
    return greska("Plaćanje trenutno ne radi. Pokušaj ponovo za koji minut.", 502);
  }
}
