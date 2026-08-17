// apps/web/src/lib/search-cache.ts
// Registar keširanih kombinacija (F9, migracija 0009).
//
// Ovaj fajl je jedini koji odgovara na pitanje „da li ova pretraga košta". I
// ruta i strana i lista čitaju odavde, kroz iste dve RPC funkcije — da se
// prikazana cena i naplaćena cena ne bi mogle razići.
//
// Sve ide kroz `adminSupabase()`: `search_cache` ima RLS `using (false)`, isto
// kao `businesses`. Ovde to nije ni ograničenje — u odgovoru nema nijednog
// podatka o firmi, samo brojevi i datumi.

import "server-only";
import { GOOGLE_TTL_DAYS } from "@sajtoskop/shared";
import { adminSupabase } from "./supabase";
import type { KesStavka } from "./search-types";

export const COUNTRY = "RS";

/** Kad keš skeniran u `scannedAt` prestaje da bude besplatan. */
export function istekKesa(scannedAt: string): string {
  return new Date(new Date(scannedAt).getTime() + GOOGLE_TTL_DAYS * 86_400_000).toISOString();
}

export type StanjeKesa = {
  /** `null` znači da kombinacija nikad nije skenirana. */
  scannedAt: string | null;
  /** Skenirana i mlađa od 30 dana — dakle besplatna. */
  fresh: boolean;
  total: number;
  noSite: number;
  /** [Faza 6, 6.4] Budžet je stao usred scana — rezultat nije potpun (B5). */
  partial: boolean;
};

/**
 * Stanje jedne kombinacije. Vraća red uvek, i za nikad skeniranu.
 *
 * Razlika između `scannedAt === null` i „ima datum ali `fresh` je `false`" je
 * ono što UI-ju daje tekst: prvo je „nije u kešu", drugo je „stariji od 30 dana".
 */
export async function stanjeKesa(city: string, niche: string): Promise<StanjeKesa> {
  const { data, error } = await adminSupabase().rpc("search_cache_state", {
    p_country: COUNTRY,
    p_city: city,
    p_niche: niche,
    p_ttl_days: GOOGLE_TTL_DAYS,
  });

  if (error) throw new Error(`Čitanje registra keša nije uspelo: ${error.message}`);

  const row = ((data ?? []) as {
    scanned_at: string | null;
    fresh: boolean;
    total: number;
    no_site: number;
  }[])[0];

  // Funkcija po ugovoru uvek vraća tačno jedan red. Ako ga nema, nešto je krupno
  // pošlo naopako — a tiho „nije u kešu" bi značilo naplatu bez razloga.
  if (!row) throw new Error("search_cache_state nije vratio rezultat.");

  // [Faza 6, 6.4] `partial` ne menja oblik RPC funkcije (0009 je ponovo
  // kreira u check:sql), pa se čita direktno iz tabele — jedan upit manje bitan
  // od samog stanja, a ne sme da obori pretragu ako padne.
  let partial = false;
  try {
    const { data: p } = await adminSupabase()
      .from("search_cache")
      .select("partial")
      .eq("country_code", COUNTRY)
      .eq("city_slug", city)
      .eq("niche_slug", niche)
      .maybeSingle<{ partial: boolean }>();
    partial = p?.partial ?? false;
  } catch {
    // Bez zastavice kombinacija izgleda kao potpuna — bolje nego da padne ceo
    // `/api/search` zbog ukrasa.
  }

  return {
    scannedAt: row.scanned_at,
    fresh: row.fresh,
    total: row.total,
    noSite: row.no_site,
    partial,
  };
}

/**
 * Ceo registar za stranu Pretraga.
 *
 * Vraća i istekle kombinacije, sa `fresh: false`. Lista „Besplatne pretrage" ih
 * ne prikazuje — ona mora da bude istinita — ali traka cene iznad nje bez njih
 * ne ume da razlikuje „nikad skenirano" od „starije od 30 dana".
 */
export async function listaKesa(userId: string): Promise<KesStavka[]> {
  const { data, error } = await adminSupabase().rpc("search_cache_overview", {
    p_user: userId,
    p_country: COUNTRY,
    p_ttl_days: GOOGLE_TTL_DAYS,
  });

  if (error) throw new Error(`Čitanje liste keša nije uspelo: ${error.message}`);

  const rows = (data ?? []) as {
    city_slug: string;
    niche_slug: string;
    total: number;
    no_site: number;
    scanned_at: string;
    fresh: boolean;
    mine: boolean;
  }[];

  // [Faza 6, 6.4] Zastavice parcijalnosti u JEDNOM upitu (oblik overview
  // funkcije se ne dira — 0009 je ponovo kreira u check:sql). Pad se guta:
  // bez oznake kombinacija izgleda potpuna, a lista ostaje.
  const parcijalne = new Set<string>();
  try {
    const { data: p } = await adminSupabase()
      .from("search_cache")
      .select("city_slug, niche_slug, partial")
      .eq("partial", true)
      .returns<{ city_slug: string; niche_slug: string }[]>();
    for (const r of p ?? []) parcijalne.add(`${r.city_slug}:${r.niche_slug}`);
  } catch {
    // ukras — ne ruši listu
  }

  return rows.map((r) => ({
    city: r.city_slug,
    niche: r.niche_slug,
    total: r.total,
    noSite: r.no_site,
    scannedAt: r.scanned_at,
    expiresAt: istekKesa(r.scanned_at),
    fresh: r.fresh,
    mine: r.mine,
    empty: r.total === 0,
    partial: parcijalne.has(`${r.city_slug}:${r.niche_slug}`),
  }));
}
