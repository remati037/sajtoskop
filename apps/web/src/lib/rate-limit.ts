// apps/web/src/lib/rate-limit.ts
// IP rate limit na novčane rute (Faza 1, 1.2; P1 iz docs/bezbednost-i-zastita.md).
//
// Brojač je u bazi (`request_limits` + `claim_request`, migracija 0018):
// fiksni prozor od jednog minuta, 100 zahteva po (IP, ruta). Jedina brana ispod
// per-korisničkih limita kredita — skript sa 50 naloga udara u isti zid koliko
// god naloga imao (nalaz S1 iz revizije).
//
// Pad brojača NE ruši rutu (za razliku od `proveriTempo` u adminu): tamo je
// dnevnik deo ispravnosti i sumnja ide protiv radnje; ovde je brojač čista
// odbrana i gubitak odbrane ne sme da postane gubitak rada.

import "server-only";
import { ipZahteva } from "./admin";
import { adminSupabase } from "./supabase";

/** 100 zahteva u minuti sa jedne adrese. Legitiman rad nikad ne stigne blizu. */
export const IP_TEMPO = 100;

/**
 * Proveri IP tempo za jedan zahtev. Vraća `Response` sa 429 kad je limit
 * probijen, inače `null` — pozivalac ga vraća odmah:
 *
 *   const ogranicen = await proveriIpTempo(req, "unlock");
 *   if (ogranicen) return ogranicen;
 */
export async function proveriIpTempo(
  req: Request,
  ruta: string,
  limit = IP_TEMPO,
): Promise<Response | null> {
  const ip = ipZahteva(req);
  // Lokalno nema proxy headera, pa ni IP-ja — ne blokiraj razvoj.
  if (!ip) return null;

  const { data, error } = await adminSupabase().rpc("claim_request", {
    p_ip: ip,
    p_route: ruta,
    p_limit: limit,
  });

  if (error) {
    console.error(`[rate-limit] ${ruta}: ${error.message}`);
    return null;
  }

  const ishod = ((data ?? []) as { ok: boolean; remaining: number }[])[0];
  if (ishod && !ishod.ok) {
    return Response.json(
      { greska: "Previše zahteva sa ove adrese. Pokušaj ponovo za minut." },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } },
    );
  }

  return null;
}
