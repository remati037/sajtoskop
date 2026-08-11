// apps/web/src/lib/pipeline.ts
// Kanban: čitanje i menjanje statusa otključanih prospekata (F7 §3).
//
// „Samo otključani leadovi ulaze u pipeline" ovde nije provera nego posledica:
// `lead_status` ima složen strani ključ na `unlocks(user_id, place_id)`, pa red
// za neotključan lead ne može ni da nastane (migracija 0007). Kod ispod se
// oslanja na to i ne ponavlja proveru u TypeScriptu.
//
// Pipeline se čita iz `getMojaLista()`, iste funkcije koju koristi ekran „Moja
// lista". Bez toga bi postojala dva puta do istog skupa leadova i dva mesta na
// kojima se zaboravi novo polje.

import "server-only";
import type { LeadStatusRow, LeadStatusValue } from "@sajtoskop/shared";
import { getMojaLista } from "./moja-lista";
import type { PipelineKartica } from "./pipeline-tipovi";
import { adminSupabase, userSupabase } from "./supabase";

/**
 * Sve kartice korisnika.
 *
 * Lead bez reda u `lead_status` je `nekontaktiran` — podrazumevana vrednost se
 * ne materijalizuje pri otključavanju. Razlog: otključavanje je kreditna
 * operacija u `spend_credit_and_unlock` i nema šta da zna o kanbanu. Red nastaje
 * pri prvom pomeranju kartice, a do tada je odsustvo reda tačna informacija.
 */
export async function getPipeline(): Promise<PipelineKartica[]> {
  const [leads, statusi] = await Promise.all([getMojaLista(), citajStatuse()]);
  const poMestu = new Map(statusi.map((s) => [s.place_id, s]));

  return leads.map((l) => {
    const s = poMestu.get(l.placeId);
    return {
      ...l,
      status: s?.status ?? "nekontaktiran",
      note: s?.note ?? null,
      channel: s?.channel ?? null,
      contactedAt: s?.contacted_at ?? null,
    };
  });
}

/** Kroz RLS politiku „own rows" — ista brava kao kod `unlocks`. */
async function citajStatuse(): Promise<LeadStatusRow[]> {
  const { data, error } = await userSupabase()
    .from("lead_status")
    .select("user_id, place_id, status, note, channel, contacted_at, updated_at")
    .returns<LeadStatusRow[]>();

  if (error) throw new Error(`Čitanje statusa nije uspelo: ${error.message}`);
  return data ?? [];
}

export type PipelineIshod =
  | { ok: true }
  | { ok: false; razlog: "not_unlocked" | "invalid_status" };

/** Prevlačenje kartice. Korisnikova odluka je konačna i ide u oba smera. */
export async function promeniStatus(
  userId: string,
  placeId: string,
  status: LeadStatusValue,
): Promise<PipelineIshod> {
  const { data, error } = await adminSupabase().rpc("set_lead_status", {
    p_user: userId,
    p_place: placeId,
    p_status: status,
    p_channel: null,
  });

  if (error) throw new Error(`Promena statusa nije uspela: ${error.message}`);

  const red = ((data ?? []) as { ok: boolean; reason: string }[])[0];
  if (red?.ok) return { ok: true };

  return {
    ok: false,
    razlog: red?.reason === "invalid_status" ? "invalid_status" : "not_unlocked",
  };
}

/** Beleška po leadu. Prazan tekst briše belešku (v. `set_lead_note` u 0007). */
export async function sacuvajBelesku(
  userId: string,
  placeId: string,
  note: string,
): Promise<PipelineIshod> {
  const { data, error } = await adminSupabase().rpc("set_lead_note", {
    p_user: userId,
    p_place: placeId,
    p_note: note,
  });

  if (error) throw new Error(`Upis beleške nije uspeo: ${error.message}`);

  const red = ((data ?? []) as { ok: boolean; reason: string }[])[0];
  return red?.ok ? { ok: true } : { ok: false, razlog: "not_unlocked" };
}
