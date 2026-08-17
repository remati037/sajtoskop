// apps/web/src/lib/export.ts
// CSV izvoz otključanih prospekata (F4 §5).
//
// Dve tvrde granice:
//   1. Izvoze se ISKLJUČIVO otključani leadovi. Nikad zaključani, ni u
//      redukovanom obliku — `getMojaLista()` po definiciji vraća samo svoje.
//   2. Dnevni cap se rezerviše u bazi PRE serijalizacije, kroz `claim_export`.
//      Brojanje u TypeScriptu bi značilo da dva paralelna zahteva oba prođu.

import "server-only";
import { planFor, toCsv } from "@sajtoskop/shared";
import type { ExportClaimResult } from "@sajtoskop/shared";
import { getMojaLista, type MojaListaFilter, type MojLead } from "./moja-lista";
import { adminSupabase } from "./supabase";

/**
 * Kolone su iz `pipeline-biznisi` Sheeta, istim redosledom kao CSV koji ispisuje
 * CLI (`apps/cli/src/index.ts`) — da se red lepi bez prepravljanja.
 *
 * [ODSTUPANJE od PRD-a §5] Tri kolone su DODATE na kraj: `mejl`, `grad` i
 * `otkljucano`. Mejl je pola razloga zbog kog se kredit uopšte troši, a u CLI
 * CSV-u ga nema jer je tamo stizao iz zasebnog `mejlovi-*.csv` fajla. Dodate su
 * na kraj, a ne umetnute, baš zato da lepljenje prvih dvanaest kolona u
 * postojeći Sheet radi kao i pre.
 */
const KOLONE = [
  "naziv",
  "telefon",
  "tip_telefona",
  "sajt",
  "status",
  "skor",
  "band",
  "platforma",
  "problemi",
  "adresa",
  "ocena",
  "broj_ocena",
  "mejl",
  "grad",
  "otkljucano",
] as const;

export type ExportResult =
  | {
      ok: true;
      csv: string;
      /** Koliko redova je stvarno izvezeno posle capa. */
      rows: number;
      /** Koliko ih je odsečeno dnevnim capom. `0` znači da je izvezeno sve. */
      truncated: number;
      filename: string;
    }
  | {
      ok: false;
      reason: ExportClaimResult["reason"];
      used: number;
      resetAt: string;
    };

export type ExportInput = {
  userId: string;
  plan: string;
  filter: MojaListaFilter;
  /**
   * Traženi broj redova iz upita. Ovo je ŽELJA, ne dozvola — stvarni broj je
   * `min(želja, dostupno, ostatak dnevnog capa)`. Zato `?limit=99999` ne može
   * da izvuče više od capa (F4 §7).
   */
  limit?: number;
};

export async function exportUnlockedCsv(input: ExportInput): Promise<ExportResult> {
  const cap = planFor(input.plan).exportPerDay;

  // [Faza 3, 3.1] `potpisi: false` — CSV ne prikazuje snimke, pa ne sme ni da
  // potpisuje URL-ove (P1): izvoz 2000 redova = nula Storage poziva.
  const sve = await getMojaLista(input.filter, { potpisi: false });
  const zeljeno = Math.min(input.limit ?? cap, cap, sve.length);

  const claim = await claimExport(input.userId, cap, zeljeno);

  if (!claim.ok) {
    return {
      ok: false,
      reason: claim.reason,
      used: claim.used,
      resetAt: claim.reset_at,
    };
  }

  const redovi = sve.slice(0, claim.allowed);

  return {
    ok: true,
    csv: toCsv([...KOLONE], redovi.map(uCsvRed)),
    rows: redovi.length,
    truncated: sve.length - redovi.length,
    filename: imeFajla(input.filter),
  };
}

/**
 * Rezervacija se traži i za 0 redova — funkcija tada vrati `nothing_to_export`,
 * a ruta iz toga pravi jasnu poruku umesto praznog fajla sa zaglavljem.
 */
async function claimExport(
  userId: string,
  limit: number,
  wanted: number,
): Promise<ExportClaimResult> {
  const { data, error } = await adminSupabase().rpc("claim_export", {
    p_user: userId,
    p_limit: limit,
    p_wanted: wanted,
  });

  if (error) throw new Error(`Provera dnevnog limita izvoza nije uspela: ${error.message}`);

  const row = ((data ?? []) as ExportClaimResult[])[0];
  if (!row) throw new Error("claim_export nije vratio rezultat.");
  return row;
}

function uCsvRed(lead: MojLead): unknown[] {
  return [
    lead.name,
    lead.phone ?? "",
    lead.phoneType ?? "",
    lead.websiteUrl ?? "",
    // Veliko slovo i podvlaka, isto kao u CLI CSV-u i u arhivi scanova.
    (lead.siteStatus ?? "").toUpperCase(),
    lead.uglyScore ?? "",
    lead.uglyBand ?? "",
    lead.platform ?? "",
    lead.signals.join(" | "),
    lead.address ?? "",
    lead.rating ?? "",
    // `user_ratings_total` nije deo `UnlockedLead` — nije u `LeadBusiness`
    // Pick-u, pa ga ni ovde nema. Kolona ostaje prazna da se zaglavlje poklopi
    // sa CLI CSV-om; popunjava se kad broj ocena uđe u javni oblik leada.
    "",
    lead.email ?? "",
    lead.citySlug,
    lead.unlockedAt.slice(0, 10),
  ];
}

/**
 * `sajtoskop-sabac-pvc-stolarija-2026-08-10.csv` (F4 §5).
 *
 * Slugovi, ne labele: `Šabac` u imenu fajla znači da se dijakritika lomi u
 * `Content-Disposition` zaglavlju i da ime na Windowsu izgleda kao smeće.
 */
function imeFajla(filter: MojaListaFilter): string {
  const datum = new Date().toISOString().slice(0, 10);
  return `sajtoskop-${filter.citySlug ?? "sve"}-${filter.nicheSlug ?? "sve"}-${datum}.csv`;
}
