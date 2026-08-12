// apps/web/src/lib/budzet.ts
// Pre-flight provera Places budžeta, pre naplate skeniranja (F9 §3).
//
// Web NE troši budžet i ne sme da ga troši — `consume_api_call` zove isključivo
// worker, pred svaki HTTP zahtev. Ovde se samo GLEDA stanje, i to iz jednog
// razloga: da korisnik ne plati kredit za posao koji će satima čekati kvotu.
//
// CLAUDE.md traži `assertAvailable(n)` pre svakog scana. Ovo je ta provera na
// strani weba; tvrda brana ostaje u workeru.

import "server-only";
import { GLOBAL_DAILY_API_CAP, GLOBAL_MONTHLY_API_CAP } from "@sajtoskop/shared";
import { adminSupabase } from "./supabase";

/** Jedan scan je do 3 stranice paginacije, dakle do 3 poziva. */
export const POZIVA_PO_SCANU = 3;

export type BudzetStanje = {
  dostupno: boolean;
  danOstatak: number;
  mesecOstatak: number;
};

export async function budzetZaScan(): Promise<BudzetStanje> {
  const { data, error } = await adminSupabase().rpc("api_budget_status", {
    p_daily_cap: GLOBAL_DAILY_API_CAP,
    p_monthly_cap: GLOBAL_MONTHLY_API_CAP,
  });

  if (error) throw new Error(`Čitanje budžeta nije uspelo: ${error.message}`);

  const row = ((data ?? []) as { day_remaining: number; month_remaining: number }[])[0];

  // Bez odgovora se NE naplaćuje. Propuštena pretraga je neprijatnost, skinut
  // kredit za posao koji ne može da se izvrši je greška koju korisnik pamti.
  if (!row) return { dostupno: false, danOstatak: 0, mesecOstatak: 0 };

  return {
    dostupno: row.day_remaining >= POZIVA_PO_SCANU && row.month_remaining >= POZIVA_PO_SCANU,
    danOstatak: row.day_remaining,
    mesecOstatak: row.month_remaining,
  };
}
