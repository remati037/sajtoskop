// apps/web/src/app/api/webhooks/clerk/route.ts
// Clerk → profiles. Ovo je JEDINI endpoint koji piše u bazu bez Clerk sesije.
//
// Zato je verifikacija potpisa jedina autentikacija koju ima. Bez nje je ovo
// javni upis u bazu: bilo ko bi POST-om napravio proizvoljan broj profila,
// svaki sa 30 kredita (F1, sekcija 6).
//
// Svix ponavlja isporuku na svaki non-2xx odgovor i na timeout. Zato:
//   - uspeh i „već obrađeno" → 200, da se ne vrti u krug
//   - greška baze → 500, da Svix pokuša ponovo
//   - loš potpis → 400, bez ponavljanja
// Dupla isporuka ne može da dodeli kredite dvaput — `create_profile_with_grant`
// je idempotentna preko `p_ref_id`.

import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { WebhookEvent } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { createProfileFromWebhook } from "@/lib/profile";
import { webhookSecret } from "@/lib/env";

export const runtime = "nodejs";

/** Clerk šalje sve adrese; nama treba primarna. */
function primaryEmail(data: WebhookEvent["data"]): string | null {
  if (!("email_addresses" in data)) return null;
  const primaryId = "primary_email_address_id" in data ? data.primary_email_address_id : null;
  const list = data.email_addresses ?? [];
  const primary = list.find((e) => e.id === primaryId) ?? list[0];
  return primary?.email_address ?? null;
}

export async function POST(req: NextRequest): Promise<Response> {
  let event: WebhookEvent;

  try {
    event = await verifyWebhook(req, { signingSecret: webhookSecret() });
  } catch (err) {
    console.error("[clerk-webhook] potpis nije prošao:", err);
    return new Response("Neispravan potpis.", { status: 400 });
  }

  if (event.type !== "user.created" && event.type !== "user.updated") {
    // Ostali tipovi nas u F1 ne zanimaju, ali moraju da dobiju 200 —
    // inače ih Svix ponavlja dok ne odustane.
    return Response.json({ ignored: event.type });
  }

  const userId = event.data.id;
  if (!userId) return new Response("Događaj bez korisničkog ID-ja.", { status: 400 });

  // Ref id vezan za korisnika, ne za događaj: Clerk ume da pošalje `user.created`
  // sa novim event ID-jem posle svog internog retryja. Vezivanje za event ID bi
  // u tom slučaju dodelilo kredite drugi put.
  const refId = `signup:${userId}`;

  try {
    const result = await createProfileFromWebhook(userId, primaryEmail(event.data), refId);
    console.log(`[clerk-webhook] ${event.type} ${userId} → ${result.reason}`);
    return Response.json({ ok: true, reason: result.reason });
  } catch (err) {
    console.error("[clerk-webhook] upis u bazu nije uspeo:", err);
    // 500 namerno — hoću da Svix pokuša ponovo.
    return new Response("Upis nije uspeo.", { status: 500 });
  }
}
