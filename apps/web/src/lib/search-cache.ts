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
  /**
   * Skenirana i mlađa od 30 dana. To je NUŽAN, ali od S17 ne i dovoljan uslov
   * da pretraga bude besplatna — v. `besplatno()`.
   */
  fresh: boolean;
  total: number;
  noSite: number;
  /** [Faza 6, 6.4] Budžet je stao usred scana — rezultat nije potpun (B5). */
  partial: boolean;
  /**
   * [S17] Koliko je stranica povukao poslednji scan (1–3), 0 za nikad skeniranu.
   * Ovo je druga polovina uslova pogotka: 20 redova nije 60.
   */
  pages: number;
};

/**
 * Da li je zahtev za `trazenoStranica` nad ovim stanjem BESPLATAN.
 *
 * Jedno mesto za ceo uslov, jer se u ruti proverava tri puta (pre besplatnog
 * puta, pre cene, i posle naplate kad se odlučuje da li se keš uopšte prikazuje).
 * Dva uslova, oba nužna:
 *
 *   svežina  — pravilo 1, Google podatak stariji od 30 dana se ne servira
 *   obim     — S17, keširane 1 stranica ne pokriva zahtev za 3
 */
export function besplatno(stanje: StanjeKesa, trazenoStranica: number): boolean {
  return stanje.fresh && stanje.pages >= trazenoStranica;
}

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

  // [Faza 6, 6.4 · S17] Ni `partial` ni `pages` ne menjaju oblik RPC funkcije
  // (0009 i 0020 ih ponovo kreiraju u check:sql, pa im povratni tip mora da
  // ostane isti), nego se čitaju direktno iz tabele — jednim upitom, za oba.
  //
  // ‼️ Razlika je u tome šta se sme progutati: `partial` je oznaka na ekranu i
  //    njegov pad ne sme da obori pretragu. `pages` je POLOVINA USLOVA NAPLATE,
  //    pa se njegov pad NE guta — tiho `pages: 0` bi svaku pretragu proglasilo
  //    plaćenom, a tiho `pages: 3` bi dublji zahtev nad plitkim kešom pustio
  //    besplatno. Zato jedan upit koji sme da baci, i `fresh` kao brana: dok god
  //    kombinacija nije sveža, dubina ionako ne odlučuje ništa.
  let partial = false;
  let pages = 0;

  if (row.fresh) {
    const { data: p, error: pErr } = await adminSupabase()
      .from("search_cache")
      .select("partial, pages")
      .eq("country_code", COUNTRY)
      .eq("city_slug", city)
      .eq("niche_slug", niche)
      .maybeSingle<{ partial: boolean; pages: number }>();

    if (pErr) throw new Error(`Čitanje dubine keša nije uspelo: ${pErr.message}`);

    partial = p?.partial ?? false;
    pages = p?.pages ?? 0;
  }

  return {
    scannedAt: row.scanned_at,
    fresh: row.fresh,
    total: row.total,
    noSite: row.no_site,
    partial,
    pages,
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

  // [Faza 6, 6.4 · S17] `partial` i `pages` u JEDNOM upitu (oblik overview
  // funkcije se ne dira — 0009 i 0020 je ponovo kreiraju u check:sql).
  //
  // Ovde se pad SME progutati, za razliku od `stanjeKesa`: ova lista ništa ne
  // naplaćuje. Bez dubine red prikazuje najplići mogući obim (1 stranica), pa
  // je najgori ishod da lista potceni kombinaciju — a naplatu ionako odlučuje
  // `stanjeKesa`, gde pad baca.
  const dodatno = new Map<string, { partial: boolean; pages: number }>();
  try {
    const { data: p } = await adminSupabase()
      .from("search_cache")
      .select("city_slug, niche_slug, partial, pages")
      .eq("country_code", COUNTRY)
      .returns<{ city_slug: string; niche_slug: string; partial: boolean; pages: number }[]>();
    for (const r of p ?? []) {
      dodatno.set(`${r.city_slug}:${r.niche_slug}`, { partial: r.partial, pages: r.pages });
    }
  } catch {
    // ukras — ne ruši listu
  }

  return rows.map((r) => {
    const d = dodatno.get(`${r.city_slug}:${r.niche_slug}`);
    return {
      city: r.city_slug,
      niche: r.niche_slug,
      total: r.total,
      noSite: r.no_site,
      scannedAt: r.scanned_at,
      expiresAt: istekKesa(r.scanned_at),
      fresh: r.fresh,
      mine: r.mine,
      empty: r.total === 0,
      partial: d?.partial ?? false,
      pages: d?.pages ?? 1,
    };
  });
}
