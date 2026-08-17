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
//
// [Faza 1, 1.3] Povrh toga stoji `webhook_events` (migracija 0018): marker po
// `event_id` se upisuje PRE obrade, pa svaki budući handler dobija zaštitu od
// Svix retry-ja bez ijedne izmene (nalaz S2). Kad obrada padne, marker se
// briše da bi retry mogao ponovo da pokuša.

import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { WebhookEvent } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";
import { RADNJE, upisiAudit } from "@/lib/admin";
import { createProfileFromWebhook, obrisiProfil } from "@/lib/profile";
import { webhookSecret } from "@/lib/env";
import { adminSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

const PROVIDER = "clerk";

/** Clerk šalje sve adrese; nama treba primarna. */
function primaryEmail(data: WebhookEvent["data"]): string | null {
  if (!("email_addresses" in data)) return null;
  const primaryId = "primary_email_address_id" in data ? data.primary_email_address_id : null;
  const list = data.email_addresses ?? [];
  const primary = list.find((e) => e.id === primaryId) ?? list[0];
  return primary?.email_address ?? null;
}

/**
 * [Faza 1, 1.3] Povuci marker „obrađeno". Zove se samo kad obrada padne —
 * bez ovoga bi Svix retry udario u marker i preskočio događaj koji se nikad
 * nije obradio. Brisanje nepostojećeg reda je uspeh.
 */
async function obrisiMarker(eventId: string): Promise<void> {
  const { error } = await adminSupabase()
    .from("webhook_events")
    .delete()
    .eq("provider", PROVIDER)
    .eq("event_id", eventId);

  if (error) console.error("[clerk-webhook] brisanje markera:", error.message);
}

export async function POST(req: NextRequest): Promise<Response> {
  // [Faza 1, 1.3] Svix šalje `id` (ID događaja) na vrhu tela; Clerkov tip ga
  // ne nosi. Čita se iz sirovog tela PRE verifikacije — a verifikacija traži
  // tačno taj sirovi string, pa se za nju zahtev rekonstruiše.
  let eventId: string | null = null;
  let verifikacijaReq: NextRequest = req;
  try {
    const raw = await req.text();
    const telo = JSON.parse(raw) as { id?: unknown };
    eventId = typeof telo.id === "string" ? telo.id : null;
    verifikacijaReq = new NextRequest(req.url, {
      method: "POST",
      headers: req.headers,
      body: raw,
    });
  } catch (err) {
    console.error("[clerk-webhook] telo se ne parsira:", err);
    return new Response("Neispravno telo.", { status: 400 });
  }

  let event: WebhookEvent;

  try {
    event = await verifyWebhook(verifikacijaReq, { signingSecret: webhookSecret() });
  } catch (err) {
    console.error("[clerk-webhook] potpis nije prošao:", err);
    return new Response("Neispravan potpis.", { status: 400 });
  }

  if (!eventId) return new Response("Događaj bez ID-ja.", { status: 400 });

  // ── marker pre obrade (Faza 1, 1.3) ───────────────────────
  // Insert pre obrade, na konflikt preskoči. Konflikt znači da je ovaj
  // `event_id` već stigao (Svix retry posle izgubljenog 200) — ništa se ne
  // ponavlja, ni danas ni za bilo koji budući handler.
  const { data: marker, error: greskaMarkera } = await adminSupabase()
    .from("webhook_events")
    .insert({ provider: PROVIDER, event_id: eventId })
    .select("event_id")
    .maybeSingle<{ event_id: string }>();

  if (greskaMarkera) {
    // Bez tabele se ne može bezbedno deduplikovati. Padni zatvoreno: Svix
    // ponavlja dok migracija 0018 ne stigne, a dupla isporuka je manja šteta
    // od tiho izgubljenog događaja (krediti su ionako idempotentni po ref_id).
    console.error("[clerk-webhook] webhook_events nije dostupan:", greskaMarkera.message);
    return new Response("Deduplikacija nije dostupna.", { status: 500 });
  }

  if (!marker) {
    console.log(`[clerk-webhook] duplikat ${event.type} ${eventId} — preskočeno`);
    return Response.json({ ok: true, duplicate: true });
  }

  // ── brisanje naloga (F12 §4, pravilo 15) ──────────────────
  // Do F12 ovog grananja nije bilo, pa je brisanje iz Clerk konzole ostavljalo
  // profil zauvek. Clerk je izvor istine za identitet; baza ga prati.
  //
  // Ovo je JEDINI put do brisanja profila — i onaj iz admin konzole ide ovuda,
  // preko `users.deleteUser`. Zato ovde nema provere prava: potpis je već
  // proveren, a Clerk ne šalje `user.deleted` za nalog koji nije obrisan.
  if (event.type === "user.deleted") {
    const obrisanId = event.data.id;
    if (!obrisanId) return new Response("Događaj bez korisničkog ID-ja.", { status: 400 });

    try {
      const postojao = await obrisiProfil(obrisanId);
      console.log(`[clerk-webhook] user.deleted ${obrisanId} → ${postojao ? "obrisan" : "nije ga bilo"}`);

      // Trag ostaje i kad brisanje nije krenulo iz konzole — `actor_id` je tada
      // `null` i u reviziji se čita kao „obrisano izvan konzole". Bez ovog reda
      // je brisanje iz Clerk konzole jedina izmena nad bazom bez ijednog zapisa.
      await upisiAudit({
        actor: null,
        action: RADNJE.KASKADA,
        target: obrisanId,
        payload: { postojao },
        ok: true,
      });

      return Response.json({ ok: true, obrisan: postojao });
    } catch (err) {
      console.error("[clerk-webhook] kaskada nije uspela:", err);
      await obrisiMarker(eventId);

      await upisiAudit({
        actor: null,
        action: RADNJE.KASKADA,
        target: obrisanId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });

      // 500 namerno — Svix pokušava ponovo, a brisanje nepostojećeg reda je
      // ionako uspeh, pa ponavljanje ne može da napravi štetu.
      return new Response("Brisanje nije uspelo.", { status: 500 });
    }
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
    await obrisiMarker(eventId);
    // 500 namerno — hoću da Svix pokuša ponovo.
    return new Response("Upis nije uspeo.", { status: 500 });
  }
}
