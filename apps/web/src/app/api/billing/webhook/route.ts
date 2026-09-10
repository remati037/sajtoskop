// apps/web/src/app/api/billing/webhook/route.ts
// Stripe → baza. Drugi (i poslednji) endpoint koji piše u bazu bez Clerk sesije.
//
// Kao i kod Clerk webhooka, VERIFIKACIJA POTPISA JE JEDINA AUTENTIKACIJA koju
// ovaj URL ima — i to je razlog zašto `STRIPE_WEBHOOK_SECRET` u `lib/env.ts`
// baca umesto da padne na `null`: neverifikovan webhook je javni endpoint koji
// deli kredite. Verifikuje se UVEK, i u test modu.
//
// ── tri stvari koje ruši i najmanja nepažnja ────────────────
// 1. SIROVO TELO. `await req.text()`, nikad `req.json()`. Potpis je HMAC nad
//    tačnim bajtovima koje je Stripe poslao; `JSON.parse` pa `JSON.stringify`
//    promeni razmake i redosled ključeva i potpis više ne važi.
// 2. RUNTIME `nodejs`. SDK računa HMAC preko `node:crypto`.
// 3. ODGOVOR UNUTAR 10 SEKUNDI. Stripe ponavlja neuspele isporuke do 3 dana.
//    Ceo posao ovde su tri upita (plus jedan Stripe poziv za otisak kartice).
//
// ── zašto se posao NE radi posle odgovora ───────────────────
// „Vrati 200 pa radi" bi značilo da pad obrade niko ne vidi: Stripe bi zapamtio
// uspeh, ponavljanja ne bi bilo, a korisnik bi imao naplaćenu karticu bez
// kredita. Idempotencija to čini bezbednim: `event_id` je gruba brana, `ref_id`
// (`in_…`, `pi_…`, `trial:<user>`, `expire:<sub>`) fina.

import type Stripe from "stripe";
import { obradiDogadjaj } from "@/lib/billing";
import { supabaseSkladiste } from "@/lib/billing-skladiste";
import { stripeServerEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const potpis = req.headers.get("stripe-signature");
  if (!potpis) return new Response("Nedostaje potpis.", { status: 401 });

  const sirovoTelo = await req.text(); // HMAC nad tačnim bajtovima

  let dogadjaj: Stripe.Event;
  let kupon: string | null = null;
  try {
    const env = stripeServerEnv();
    kupon = env.STRIPE_COUPON_FIRST_MONTH;
    dogadjaj = stripe().webhooks.constructEvent(sirovoTelo, potpis, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // 401, ne 400: ovo nije loše sastavljen zahtev nego zahtev koji nije dokazao
    // ko je. U log ide poruka izuzetka, nikad telo i nikad tajna.
    console.error(
      "[stripe-webhook] potpis nije prošao:",
      err instanceof Error ? err.message : String(err),
    );
    return new Response("Neispravan potpis.", { status: 401 });
  }

  const skladiste = supabaseSkladiste();

  // ── gruba brana idempotencije ─────────────────────────────
  // Upis PRE obrade. Konflikt znači da je taj `event_id` već stigao, dakle
  // ponovljena isporuka posle izgubljenog 200 — 200 i stani.
  let upisan: boolean;
  try {
    upisan = await skladiste.upisiDogadjaj({
      eventId: dogadjaj.id,
      eventType: dogadjaj.type,
      occurredAt: new Date(dogadjaj.created * 1000).toISOString(),
    });
  } catch (err) {
    // Bez knjige nema bezbedne deduplikacije. Padni zatvoreno: 500, pa Stripe
    // pokušava ponovo. Dupla isporuka je manja šteta od tiho izgubljene dodele.
    console.error("[stripe-webhook] billing_events nije dostupan:", err);
    return new Response("Deduplikacija nije dostupna.", { status: 500 });
  }
  if (!upisan) {
    console.log(`[stripe-webhook] duplikat ${dogadjaj.type} ${dogadjaj.id}`);
    return Response.json({ ok: true, duplikat: true });
  }

  try {
    const ishod = await obradiDogadjaj(dogadjaj, skladiste, { kuponPrvogMeseca: kupon });
    if (!ishod.ok) {
      // TRAJAN neuspeh: događaj ostaje upisan, odgovor je 200. Ponavljanje ne bi
      // promenilo ishod, a Stripe bi ga vrteo tri dana.
      console.error(`[stripe-webhook] ${dogadjaj.type} ${dogadjaj.id} → ${ishod.radnja}: ${ishod.greska}`);
      return Response.json({ ok: false, radnja: ishod.radnja });
    }
    console.log(`[stripe-webhook] ${dogadjaj.type} ${dogadjaj.id} → ${ishod.radnja}`);
    return Response.json({ ok: true, radnja: ishod.radnja });
  } catch (err) {
    // PROLAZAN neuspeh: skladište je bacilo. Marker se povlači da bi sledeći
    // pokušaj uopšte stigao do obrade, pa 500 — Stripe ponavlja.
    console.error("[stripe-webhook] obrada nije uspela:", err);
    await skladiste.obrisiDogadjaj(dogadjaj.id);
    return new Response("Obrada nije uspela.", { status: 500 });
  }
}
