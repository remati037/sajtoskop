// apps/web/src/lib/onboarding.ts
// Serverska strana onboardinga (S30, tok-i-onboarding §1.8, §4).
//
// Tri stvari:
//   1. kapija čarobnjaka za stranice (`zahtevajOnboarding`),
//   2. upis koraka iz ruta koje te radnje rade (`oznaciAkoTreba`),
//   3. sitna čitanja koja traže i baner i kartica („ima li kupljen paket",
//      „prvi je besplatan").
//
// Sama odluka (ko ide u čarobnjak, kad traka stoji) je čista funkcija u
// `@sajtoskop/shared/onboarding`. Ovde je samo baza i preusmeravanje.
//
// ── pravilo 3 ───────────────────────────────────────────────
// Ovaj fajl NE DIRA kredite. Direktni `update profiles` ispod pišu isključivo
// kolone `onboarding_*`, koje nisu novac.

import "server-only";
import { redirect } from "next/navigation";
import {
  TRAKA_SKRIVENA,
  trebaCarobnjak,
  type KorakKljuc,
  type Pristup,
  type ProfileRow,
} from "@sajtoskop/shared";
import type { OnboardingPocetno } from "./onboarding-schema";
import { adminSupabase } from "./supabase";

export const PUTANJA_POCETAK = "/pocetak";

// ═══════════════════════════════════════════════════════════
// KAPIJA ZA STRANICE
// ═══════════════════════════════════════════════════════════

/**
 * Druga linija svake strane u `(app)` — ODMAH posle `zahtevajCitanje()` (§1.8).
 *
 * NE u layout-u: layout se ne izvršava ponovo pri klijentskoj navigaciji, isti
 * razlog kao kapija pristupa. Nepoznato stanje (`profile`/`pristup` = `null`,
 * kvar veze) ne preusmerava — strana tada prikazuje `VezaGreska`, a čarobnjak
 * bez profila ionako ne bi imao šta da pročita.
 */
export function zahtevajOnboarding(profile: ProfileRow | null, pristup: Pristup | null): void {
  if (!profile || !pristup) return;

  if (
    trebaCarobnjak({
      pun: pristup.pun,
      doneAt: profile.onboarding_done_at,
      skippedAt: profile.onboarding_skipped_at,
      steps: profile.onboarding_steps,
    })
  ) {
    redirect(PUTANJA_POCETAK);
  }
}

/** Stanje za `OnboardingProvider`, iz profila koji je layout ionako pročitao. */
export function onboardingIzProfila(profile: ProfileRow | null): OnboardingPocetno | null {
  if (!profile) return null;
  return {
    steps: profile.onboarding_steps ?? {},
    doneAt: profile.onboarding_done_at,
    skippedAt: profile.onboarding_skipped_at,
    hintsSeen: profile.onboarding_hints_seen ?? [],
    grad: profile.onboarding_city ?? null,
    nisa: profile.onboarding_niche ?? null,
    kanal: profile.onboarding_channel ?? null,
  };
}

// ═══════════════════════════════════════════════════════════
// KORACI
// ═══════════════════════════════════════════════════════════

export type IshodKoraka = { steps: Record<string, string>; doneAt: string | null };

/**
 * `onboarding_mark_step` — jedini put upisa koraka (0026).
 *
 * Ne baca: korak trake je nuspojava radnje koja je već uspela (lista je plaćena,
 * prospekt otključan). Pad upisa koraka ne sme da obori odgovor te radnje —
 * korisnik bi video grešku za nešto što je prošlo i platio ga.
 */
export async function oznaciKorak(userId: string, korak: KorakKljuc): Promise<IshodKoraka | null> {
  try {
    const { data, error } = await adminSupabase().rpc("onboarding_mark_step", {
      p_user: userId,
      p_step: korak,
    });
    if (error) {
      console.error(`[onboarding] korak ${korak}: ${error.message}`);
      return null;
    }
    const red = ((data ?? []) as {
      ok: boolean;
      steps: Record<string, string> | null;
      done_at: string | null;
    }[])[0];
    if (!red?.ok || !red.steps) return null;
    return { steps: red.steps, doneAt: red.done_at };
  } catch (err) {
    console.error(`[onboarding] korak ${korak}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Upiši korak SAMO ako ga profil još nema. Vraća nove korake, ili `undefined`
 * kad upisa nije bilo (već postoji, ili je pao).
 *
 * `postojeci` je `profile.onboarding_steps` koji je ruta ionako pročitala kroz
 * kapiju pristupa — pa ogromna većina zahteva (svaki posle prvog) ne šalje
 * nijedan dodatan poziv.
 */
export async function oznaciAkoTreba(
  userId: string,
  postojeci: Record<string, string> | null | undefined,
  korak: KorakKljuc,
): Promise<Record<string, string> | undefined> {
  if (postojeci && postojeci[korak]) return undefined;
  return (await oznaciKorak(userId, korak))?.steps;
}

// ═══════════════════════════════════════════════════════════
// ODGOVORI ČAROBNJAKA, PRESKAKANJE, TAČKE
// ═══════════════════════════════════════════════════════════

const KOLONA_IZBORA = {
  grad: "onboarding_city",
  nisa: "onboarding_niche",
  kanal: "onboarding_channel",
} as const;

/** Odgovor sa jednog ekrana čarobnjaka (0028). Vrednost je već prošla Zod šemu. */
export async function upisiIzbor(
  userId: string,
  polje: keyof typeof KOLONA_IZBORA,
  vrednost: string,
): Promise<void> {
  const { error } = await adminSupabase()
    .from("profiles")
    .update({ [KOLONA_IZBORA[polje]]: vrednost })
    .eq("id", userId);
  if (error) throw new Error(`Upis izbora nije uspeo: ${error.message}`);
}

/** Tekuće viđene tačke — čitanje pa upis; dva taba u istoj sekundi daju isti skup. */
async function citajHintove(userId: string): Promise<string[]> {
  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("onboarding_hints_seen")
    .eq("id", userId)
    .maybeSingle<{ onboarding_hints_seen: string[] | null }>();
  if (error) throw new Error(`Čitanje tačaka nije uspelo: ${error.message}`);
  return data?.onboarding_hints_seen ?? [];
}

/** Tačka je zatvorena i ne vraća se (§4.5). Idempotentno. */
export async function dodajHint(userId: string, hint: string): Promise<string[]> {
  const vidjene = await citajHintove(userId);
  if (vidjene.includes(hint)) return vidjene;

  const sledece = [...vidjene, hint];
  const { error } = await adminSupabase()
    .from("profiles")
    .update({ onboarding_hints_seen: sledece })
    .eq("id", userId);
  if (error) throw new Error(`Upis tačke nije uspeo: ${error.message}`);
  return sledece;
}

/**
 * „Preskoči" (§4.2) ili „Sakrij" (§4.6).
 *
 * `onboarding_skipped_at` se postavlja JEDNOM — drugi klik ne pomera datum, jer
 * je to podatak za merenje (§4.9: koliko je preskočilo, i kad).
 */
export async function preskoci(userId: string, gde: "carobnjak" | "traka"): Promise<void> {
  const { error } = await adminSupabase()
    .from("profiles")
    .update({ onboarding_skipped_at: new Date().toISOString() })
    .eq("id", userId)
    .is("onboarding_skipped_at", null);
  if (error) throw new Error(`Upis preskakanja nije uspeo: ${error.message}`);

  if (gde === "traka") await dodajHint(userId, TRAKA_SKRIVENA);
}

// ═══════════════════════════════════════════════════════════
// PAKET I PRVO OTKLJUČAVANJE
// ═══════════════════════════════════════════════════════════

/**
 * Ima li nalog ijedan kupljen paket kredita (`credit_ledger.reason = credit_pack`).
 *
 * Na grešku vraća `true` — konzervativno za oba pozivaoca: baner „Nemaš plan"
 * (§1.12) se tada ne pojavljuje, a „prvi je besplatan" (§4.4) se ne obećava.
 * Lažno obećanje besplatnog je gore od propuštenog.
 */
export async function imaKupljenPaket(userId: string): Promise<boolean> {
  const { data, error } = await adminSupabase()
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", "credit_pack")
    .limit(1)
    .returns<{ id: number }[]>();
  if (error) {
    console.error("[onboarding] provera paketa:", error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

/** Ima li nalog ijedan red u `unlocks`. Na grešku `true`, iz istog razloga. */
async function imaOtkljucan(userId: string): Promise<boolean> {
  const { count, error } = await adminSupabase()
    .from("unlocks")
    .select("place_id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) {
    console.error("[onboarding] provera otključanih:", error.message);
    return true;
  }
  return (count ?? 0) > 0;
}

/**
 * „Otključaj · prvi je besplatan" (§4.4):
 * `credits_topup ≥ 1 && unlocks = 0 && nema credit_pack reda`, i samo uz pun pristup.
 *
 * Server šalje, klijent ne računa. Dva upita idu SAMO za nalog sa kreditima u
 * kasi koja ne ističe — dakle za nov nalog i za kupca paketa, ne za svakoga.
 */
export async function prviJeBesplatan(
  userId: string,
  profile: ProfileRow | null,
  pristup: Pristup | null,
): Promise<boolean> {
  if (!profile || !pristup?.pun || profile.credits_topup < 1) return false;
  const [paket, otkljucan] = await Promise.all([imaKupljenPaket(userId), imaOtkljucan(userId)]);
  return !paket && !otkljucan;
}
