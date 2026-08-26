// apps/web/src/app/api/billing/webhook/route.ts
// Paddle → baza. Drugi (i poslednji) endpoint koji piše u bazu bez Clerk sesije.
//
// Kao i kod Clerk webhooka, VERIFIKACIJA POTPISA JE JEDINA AUTENTIKACIJA koju
// ovaj URL ima — i to je razlog zašto `PADDLE_WEBHOOK_SECRET` u `lib/env.ts`
// baca umesto da padne na `null`: neverifikovan webhook je javni endpoint koji
// deli kredite. Verifikuje se UVEK, i u sandboxu.
//
// ── tri stvari koje ruši i najmanja nepažnja ────────────────
// 1. SIROVO TELO. `await req.text()`, nikad `req.json()`. Potpis je HMAC nad
//    tačnim bajtovima koje je Paddle poslao; `JSON.parse` pa `JSON.stringify`
//    promeni razmake i redosled ključeva i potpis više ne važi.
// 2. RUNTIME `nodejs`. SDK računa HMAC preko `node:crypto`.
// 3. ODGOVOR UNUTAR 5 SEKUNDI. Sandbox ponavlja 3× kroz 15 minuta, produkcija
//    60× kroz 3 dana. Ceo posao ovde su dva do tri upita.
//
// ── zašto se posao NE radi posle odgovora ───────────────────
// „Vrati 200 pa radi" bi značilo da pad obrade niko ne vidi: Paddle bi zapamtio
// uspeh, ponavljanja ne bi bilo, a korisnik bi imao naplaćenu karticu bez
// kredita. Posao je dovoljno kratak da stane u budžet, pa je bolje da prolazan
// pad dobije 500 i sledeći pokušaj. Idempotencija to čini bezbednim: `event_id`
// je gruba brana, `ref_id` (Paddle transaction ID) fina.

import { obradiDogadjaj } from "@/lib/billing";
import { supabaseSkladiste } from "@/lib/billing-skladiste";
import { paddleServerEnv } from "@/lib/env";
import { paddleServer } from "@/lib/paddle-server";
import type { EventEntity } from "@paddle/paddle-node-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const potpis = req.headers.get("paddle-signature");
  if (!potpis) return new Response("Nedostaje potpis.", { status: 401 });

  const sirovoTelo = await req.text();

  let dogadjaj: EventEntity;
  try {
    const { PADDLE_WEBHOOK_SECRET } = paddleServerEnv();
    dogadjaj = await paddleServer().webhooks.unmarshal(
      sirovoTelo,
      PADDLE_WEBHOOK_SECRET,
      potpis,
    );
  } catch (err) {
    // 401, ne 400: ovo nije loše sastavljen zahtev nego zahtev koji nije dokazao
    // ko je. Paddle ne ponavlja na 4xx, a i ne treba — potpis se neće popraviti.
    // U log ide poruka izuzetka, nikad telo i nikad tajna.
    console.error(
      "[paddle-webhook] potpis nije prošao:",
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
      eventId: dogadjaj.eventId,
      eventType: dogadjaj.eventType,
      occurredAt: dogadjaj.occurredAt ?? null,
    });
  } catch (err) {
    // Bez knjige nema bezbedne deduplikacije. Padni zatvoreno: 500, pa Paddle
    // pokušava ponovo. Dupla isporuka je manja šteta od tiho izgubljene dodele.
    console.error("[paddle-webhook] billing_events nije dostupan:", err);
    return new Response("Deduplikacija nije dostupna.", { status: 500 });
  }

  if (!upisan) {
    console.log(`[paddle-webhook] duplikat ${dogadjaj.eventType} ${dogadjaj.eventId}`);
    return Response.json({ ok: true, duplikat: true });
  }

  try {
    const ishod = await obradiDogadjaj(dogadjaj, skladiste);

    if (!ishod.ok) {
      // TRAJAN neuspeh: događaj ostaje upisan, odgovor je 200. Ponavljanje ne bi
      // promenilo ishod, a Paddle bi ga vrteo tri dana.
      console.error(
        `[paddle-webhook] ${dogadjaj.eventType} ${dogadjaj.eventId} → ${ishod.radnja}: ${ishod.greska}`,
      );
      return Response.json({ ok: false, radnja: ishod.radnja });
    }

    console.log(`[paddle-webhook] ${dogadjaj.eventType} ${dogadjaj.eventId} → ${ishod.radnja}`);
    return Response.json({ ok: true, radnja: ishod.radnja });
  } catch (err) {
    // PROLAZAN neuspeh: skladište je baclo. Marker se povlači da bi sledeći
    // pokušaj uopšte stigao do obrade, pa 500.
    console.error("[paddle-webhook] obrada nije uspela:", err);
    await skladiste.obrisiDogadjaj(dogadjaj.eventId);
    return new Response("Obrada nije uspela.", { status: 500 });
  }
}
