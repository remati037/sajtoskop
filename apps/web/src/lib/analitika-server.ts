// apps/web/src/lib/analitika-server.ts
// Serverska polovina analitike (PostHog): imenovani događaji iz ruta.
//
// ── zašto sa servera ────────────────────────────────────────
// Ruta jedina zna da je radnja USPELA (kredit skinut, uplata legla), `user_id`
// joj dolazi iz verifikovane sesije ili potpisanog webhooka (pravilo 8), a
// blokator reklama do nje ne dopire. Klijent šalje samo preglede strana.
//
// ── zašto `fetch`, a ne `posthog-node` ──────────────────────
// SDK skuplja događaje u red i šalje ih kasnije, a Vercel funkcija se zamrzne
// čim odgovor ode — red bi morao ručno da se prazni u svakoj ruti. Jedan POST
// kroz `after()` radi isto bez zavisnosti i bez stanja u procesu.
//
// ── šta ovo NIKAD ne radi ───────────────────────────────────
// Ne baca i ne usporava odgovor. Analitika je nuspojava radnje koja je već
// prošla; njen pad ne sme da se vidi ni kao greška ni kao čekanje.

import "server-only";
import { after } from "next/server";
import { jeAdmin, jeBootstrapAdmin } from "./admin";
import type { Dogadjaj, Svojstva } from "./analitika-zajednicko";
import { analitikaKljuc } from "./env";

/** EU region. Isti host stoji u `next.config.ts` (proxy `/ingest`). */
const HOST = "https://eu.i.posthog.com";

async function posalji(
  userId: string,
  dogadjaj: string,
  svojstva: Record<string, unknown>,
  admin: boolean | undefined,
  vreme: string,
): Promise<void> {
  const kljuc = analitikaKljuc();
  if (!kljuc) return;

  // Admin se ne meri. Kad pozivalac ulogu nije već pročitao, čita se ovde —
  // posle odgovora, pa upit ne košta korisnika ništa.
  if (jeBootstrapAdmin(userId) || (admin ?? (await jeAdmin(userId)))) return;

  const odgovor = await fetch(`${HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: kljuc,
      event: dogadjaj,
      distinct_id: userId,
      timestamp: vreme,
      properties: {
        ...svojstva,
        $lib: "sajtoskop-server",
        // Zahtev polazi sa Vercel-a; bez ovoga bi svaki korisnik bio u Dablinu.
        $geoip_disable: true,
      },
    }),
    signal: AbortSignal.timeout(3000),
  });
  if (!odgovor.ok) throw new Error(`PostHog ${odgovor.status}`);
}

/**
 * Zabeleži događaj za nalog. Vraća odmah; slanje ide posle odgovora.
 *
 * `admin` prosledi ruta koja je profil već pročitala (`jeAdminIzProfila`) —
 * tada nema dodatnog upita.
 */
export function zabeleziDogadjaj<D extends Dogadjaj>(
  userId: string,
  dogadjaj: D,
  svojstva: Svojstva[D],
  opcije: { admin?: boolean } = {},
): void {
  const vreme = new Date().toISOString();
  const posao = () =>
    posalji(userId, dogadjaj, svojstva, opcije.admin, vreme).catch((err) => {
      console.error(`[analitika] ${dogadjaj}:`, err instanceof Error ? err.message : err);
    });

  try {
    after(posao);
  } catch {
    // Van zahteva (test, skripta) `after()` baca — tada bez odlaganja.
    void posao();
  }
}
