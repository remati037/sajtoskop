// apps/web/src/lib/krediti.ts
// Istorija kredita za ekran `/krediti` (F4 §4).
//
// `credit_ledger` je jedini izvor istine za kredite (00-kontekst §4), pa je ovo
// bukvalno izvod iz knjige — bez ijednog izračunavanja sa strane. Ako se prikaz
// ovde ikad razilazi sa balansom u headeru, greška je u bazi, ne u ovom fajlu.

import "server-only";
import type { CreditLedgerRow } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";

const CAP = 200;

export type StavkaKnjige = {
  id: number;
  delta: number;
  reason: CreditLedgerRow["reason"];
  createdAt: string;
  /** Naziv prospekta za `unlock` stavke; `null` za dodele. */
  lead: string | null;
};

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
    const { data: firme, error: bErr } = await adminSupabase()
      .from("businesses")
      .select("place_id, name")
      .in("place_id", [...new Set(placeIds)])
      .returns<{ place_id: string; name: string }[]>();

    // Naziv je ukras; bez njega stavka i dalje ima datum, iznos i razlog.
    if (bErr) console.error(`[krediti] nazivi prospekata: ${bErr.message}`);
    else for (const f of firme ?? []) nazivi.set(f.place_id, f.name);
  }

  return stavke.map((s) => ({
    id: s.id,
    delta: s.delta,
    reason: s.reason,
    createdAt: s.created_at,
    lead: s.reason === "unlock" && s.ref_id ? (nazivi.get(s.ref_id) ?? "obrisan prospekt") : null,
  }));
}
