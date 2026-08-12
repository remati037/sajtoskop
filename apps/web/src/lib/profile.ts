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
 *
 * [PROMENA] Do sada je greška iz baze ovde bacana. Posledica je bila da jedan
 * pokvaren token obori `AppLayout`, dakle SVE strane, i to Next-ovim crvenim
 * ekranom umesto ijednom rečenicom na srpskom. A ceo ostatak koda je već pisan
 * za `null`: svaka strana ima granu koja tada prikazuje `VezaGreska`.
 *
 * Zato greška više ne izlazi kao izuzetak nego kao `null` + poruka, a pozivalac
 * bira šta sa njom. `getOwnProfile()` zadržava stari, kratak oblik.
 */
export type ProfilIshod = {
  profile: ProfileRow | null;
  /** Tehnička poruka iz baze. `null` kad greške nije bilo. */
  greska: string | null;
};

export async function citajProfil(): Promise<ProfilIshod> {
  const { data, error } = await userSupabase()
    .from("profiles")
    .select("*")
    .maybeSingle<ProfileRow>();

  if (error) {
    // Ovo se ne guta: u logu servera stoji ceo objekat, u UI-ju rečenica.
    console.error("[profile] čitanje profila nije uspelo:", error);
    return { profile: null, greska: error.message };
  }

  return { profile: data, greska: null };
}

export async function getOwnProfile(): Promise<ProfileRow | null> {
  return (await citajProfil()).profile;
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
