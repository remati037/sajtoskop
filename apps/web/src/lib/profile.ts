// apps/web/src/lib/profile.ts
// Čitanje profila i rezervni put za njegovo kreiranje.

import "server-only";
import type { ProfileRow, RpcResult } from "@sajtoskop/shared";
import { PLANS } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";

/**
 * Profil ulogovanog korisnika, kroz RLS.
 *
 * Namerno ide preko `userSupabase()`, a ne preko admin klijenta: ako Clerk↔Supabase
 * integracija nije ispravno podešena, ovo vrati `null` i to se odmah vidi.
 * Sa admin klijentom bi radilo i kad je integracija u kvaru — a onda bi se RLS
 * kao zaštitni sloj tiho izgubio i to bi izašlo na videlo tek u produkciji.
 */
export async function getOwnProfile(): Promise<ProfileRow | null> {
  const { data, error } = await userSupabase()
    .from("profiles")
    .select("*")
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(`Čitanje profila nije uspelo: ${error.message}`);
  return data;
}

/**
 * Rezervni put za kreiranje profila.
 *
 * Glavni put je Clerk webhook `user.created`. Ali webhook ne stiže do localhost-a
 * bez tunela, a i u produkciji ume da otkaže. Bez ovoga bi korisnik u tom slučaju
 * gledao dashboard bez profila i bez kredita, bez ijedne poruke o grešci.
 *
 * Bezbedno je: `userId` dolazi iz verifikovane sesije, a `create_profile_with_grant`
 * je idempotentna (dodela je zaključana `credit_ledger_grant_idem_idx` indeksom),
 * pa dupli poziv sa webhookom ne može da dodeli kredite dvaput.
 */
export async function ensureProfile(userId: string, email: string | null): Promise<void> {
  const { error } = await adminSupabase().rpc("create_profile_with_grant", {
    p_user: userId,
    p_email: email,
    p_credits: PLANS.beta.monthlyCredits,
    p_ref_id: `signup:${userId}`,
  });

  if (error) throw new Error(`Kreiranje profila nije uspelo: ${error.message}`);
}

/** Isti RPC, ali iz webhooka — tamo nam treba i ishod. */
export async function createProfileFromWebhook(
  userId: string,
  email: string | null,
  refId: string,
): Promise<RpcResult<string>> {
  const { data, error } = await adminSupabase().rpc("create_profile_with_grant", {
    p_user: userId,
    p_email: email,
    p_credits: PLANS.beta.monthlyCredits,
    p_ref_id: refId,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as RpcResult<string>[];
  return rows[0] ?? { ok: false, reason: "no_result" };
}
