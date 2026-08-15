// apps/web/src/lib/admin-pregled.ts
// Pregled sistema sa `/admin` (F12 §3.4).
//
// Šest kartica, jedan poziv `admin_overview` (migracija 0013) i nijedan spoljni
// servis. Clerka ovde nema namerno: pregled je ekran koji se otvara da bi se
// videlo da li nešto gori, pa ne sme da zavisi od trećeg servisa da bi se
// iscrtao.
//
// ── kad je crveno ────────────────────────────────────────────
// Tačno dve stvari, i to je cela lista (§3.4): budžet preko 80 % i posao koji
// čeka duže od 30 minuta. Sve ostalo je neutralno — konzola koja stalno svetli
// crveno je konzola koja se ne gleda, i tada ni ove dve boje ne znače ništa.

import "server-only";
import {
  GLOBAL_DAILY_API_CAP,
  GLOBAL_MONTHLY_API_CAP,
  medijanaCene,
  type AdminOverview,
} from "@sajtoskop/shared";
import { adminSupabase } from "./supabase";

/** Preko ovoga budžet pali `--danger`. */
export const PRAG_BUDZETA = 0.8;

/** Posao koji je toliko čekao znači da worker verovatno ne radi. */
export const PRAG_CEKANJA_SEC = 30 * 60;

export type Pregled = AdminOverview & {
  /** Medijana iz `medijanaCene()` — sredine opsega su u katalogu, ne ovde. */
  medijana: number | null;
  /** Koliko je odgovora ušlo u medijanu. Ispod 12 ona nije dokaz nego signal. */
  medijanaUzorak: number;
};

export async function citajPregled(): Promise<Pregled> {
  const { data, error } = await adminSupabase().rpc("admin_overview", {
    p_daily_cap: GLOBAL_DAILY_API_CAP,
    p_monthly_cap: GLOBAL_MONTHLY_API_CAP,
  });

  if (error) throw new Error(`Čitanje pregleda nije uspelo: ${error.message}`);

  const p = data as AdminOverview | null;
  if (!p) throw new Error("admin_overview nije vratio rezultat.");

  const odgovori = p.utisci.cena_odgovori ?? [];

  return { ...p, medijana: medijanaCene(odgovori), medijanaUzorak: odgovori.length };
}

/** Udeo iskorišćenog budžeta, po danu i po mesecu — veći od ta dva odlučuje. */
export function udeoBudzeta(b: AdminOverview["budzet"]): number {
  const dan = b.dan_cap > 0 ? b.dan_poziva / b.dan_cap : 0;
  const mesec = b.mesec_cap > 0 ? b.mesec_poziva / b.mesec_cap : 0;
  return Math.max(dan, mesec);
}

export function budzetKriticno(b: AdminOverview["budzet"]): boolean {
  return b.iscrpljen || udeoBudzeta(b) > PRAG_BUDZETA;
}

export function poslovKriticno(p: AdminOverview["poslovi"]): boolean {
  return p.najstariji_sec > PRAG_CEKANJA_SEC;
}

/** „za 12 min", „za 3 h" — koliko posao već čeka. */
export function trajanje(sekundi: number): string {
  if (sekundi < 60) return `${sekundi} s`;
  if (sekundi < 3600) return `${Math.round(sekundi / 60)} min`;
  if (sekundi < 86_400) return `${Math.round(sekundi / 3600)} h`;
  return `${Math.round(sekundi / 86_400)} d`;
}
