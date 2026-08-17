// apps/web/src/lib/krediti.ts
// Istorija kredita za ekran `/krediti` (F4 §4).
//
// `credit_ledger` je jedini izvor istine za kredite (00-kontekst §4), pa je ovo
// bukvalno izvod iz knjige — bez ijednog izračunavanja sa strane. Ako se prikaz
// ovde ikad razilazi sa balansom u headeru, greška je u bazi, ne u ovom fajlu.

import "server-only";
import { CITIES, NICHES } from "@sajtoskop/shared";
import type { CreditLedgerRow } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";
import { inGrupe } from "./upiti";

const CAP = 200;

export type StavkaKnjige = {
  id: number;
  delta: number;
  reason: CreditLedgerRow["reason"];
  createdAt: string;
  /**
   * Na šta se stavka odnosi: naziv prospekta za `unlock`, „Grad · niša" za
   * `scan` i za povraćaj skeniranja, `null` za dodele.
   */
  lead: string | null;
};

const GRAD_LABEL = new Map(CITIES.map((c) => [c.slug, c.label]));
const NISA_LABEL = new Map(NICHES.map((n) => [n.slug, n.label]));

/** `scan:123` → 123. Sve ostalo je `null`. */
function jobIdIz(refId: string | null): number | null {
  const m = /^scan:(\d+)$/.exec(refId ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Poslednjih 200 stavki, najnovija prva.
 *
 * Ide kroz `userSupabase()`: RLS politika „own ledger" je stvarna brava.
 * Sa admin klijentom bi jedina odbrana bio `where user_id = ...`, a to je baš
 * ono što F4 §7 proverava da NE bude jedini sloj.
 */
export async function getIstorijaKredita(): Promise<StavkaKnjige[]> {
  const { data, error } = await userSupabase()
    .from("credit_ledger")
    .select("id, delta, reason, ref_id, created_at")
    .order("created_at", { ascending: false })
    .limit(CAP)
    .returns<Pick<CreditLedgerRow, "id" | "delta" | "reason" | "ref_id" | "created_at">[]>();

  if (error) throw new Error(`Čitanje istorije kredita nije uspelo: ${error.message}`);

  const stavke = data ?? [];
  if (stavke.length === 0) return [];

  // `ref_id` je `place_id` za otključavanja — sam po sebi je neproziran string i
  // korisniku ne znači ništa. Naziv se dovlači odvojeno, kroz admin klijent, jer
  // `businesses` ima `using (false)`.
  const placeIds = stavke
    .filter((s) => s.reason === "unlock" && s.ref_id)
    .map((s) => s.ref_id as string);

  const nazivi = new Map<string, string>();

  if (placeIds.length > 0) {
    // [Faza 2, 2.2] `.in()` u grupama — spisak ume da bude dugačak (W3).
    for (const deo of inGrupe([...new Set(placeIds)])) {
      const { data: firme, error: bErr } = await adminSupabase()
        .from("businesses")
        .select("place_id, name")
        .in("place_id", deo)
        .returns<{ place_id: string; name: string }[]>();

      // Naziv je ukras; bez njega stavka i dalje ima datum, iznos i razlog.
      if (bErr) console.error(`[krediti] nazivi prospekata: ${bErr.message}`);
      else for (const f of firme ?? []) nazivi.set(f.place_id, f.name);
    }
  }

  // `scan` i njegov povraćaj nose `ref_id = 'scan:<job_id>'` (F9 §2), pa se
  // „Beograd · PVC stolarija" čita iz payload-a posla. Sam `ref_id` korisniku ne
  // znači ništa, a ovo je jedini ekran koji odgovara na „gde mi je otišao kredit".
  const jobIds = [
    ...new Set(stavke.map((s) => jobIdIz(s.ref_id)).filter((id): id is number => id !== null)),
  ];

  const kombinacije = new Map<number, string>();

  if (jobIds.length > 0) {
    // [Faza 2, 2.2] Isti režim kao za place_id-jeve iznad.
    for (const deo of inGrupe(jobIds)) {
      const { data: poslovi, error: jErr } = await adminSupabase()
        .from("job_queue")
        .select("id, payload")
        .in("id", deo)
        .returns<{ id: number; payload: Record<string, unknown> }[]>();

      if (jErr) console.error(`[krediti] kombinacije skeniranja: ${jErr.message}`);
      else {
        for (const p of poslovi ?? []) {
          const grad = typeof p.payload.citySlug === "string" ? p.payload.citySlug : null;
          const nisa = typeof p.payload.nicheSlug === "string" ? p.payload.nicheSlug : null;
          if (!grad || !nisa) continue;
          kombinacije.set(p.id, `${GRAD_LABEL.get(grad) ?? grad} · ${NISA_LABEL.get(nisa) ?? nisa}`);
        }
      }
    }
  }

  return stavke.map((s) => {
    const jobId = jobIdIz(s.ref_id);

    return {
      id: s.id,
      delta: s.delta,
      reason: s.reason,
      createdAt: s.created_at,
      lead:
        s.reason === "unlock" && s.ref_id
          ? (nazivi.get(s.ref_id) ?? "obrisan prospekt")
          : jobId !== null
            ? (kombinacije.get(jobId) ?? "skeniranje")
            : null,
    };
  });
}
