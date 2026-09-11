// apps/web/src/lib/profile.ts
// Čitanje profila i rezervni put za njegovo kreiranje.

import "server-only";
import { ONBOARDING_CREDITS, type ProfileRow, type RpcResult } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";

/**
 * Koliko kredita dobija nov nalog — od S28 `ONBOARDING_CREDITS` (dva).
 *
 * Broj stoji u `packages/shared/src/plans.ts`, ne ovde: čita ga i onboarding
 * (koliko ih je i na šta idu) i `pnpm check:sql` (da RPC dodeli baš toliko), pa
 * bi lokalna konstanta bila treća kopija istog broja.
 *
 * ‼️ Do S20 je ovde stajalo `PLANS.beta.monthlyCredits`, dakle 50 — a
 *    `create_profile_with_grant` je uz to ostavljao `profiles.plan` na tadašnjem
 *    `default 'beta'`. Registracija je time otvarala neograničen beta nalog sa
 *    punim paketom kredita, što odluka D1 (LANSIRANJE §1.1) izričito zabranjuje:
 *    komp se dodeljuje isključivo iz admin konzole ili pozivnicom.
 *
 * Od S20 do S28 je bio nula, pa je nov nalog bio `zakljucan` i išao na
 * `/cenovnik`. Od S28 (O1, `docs/tok-i-onboarding.md` §4) dobija dva kredita u
 * `credits_topup` — i to je jedino što ga pušta unutra do prve poruke bez
 * kartice. Plan se pri tome NE dira: nalog je i dalje `dopuna`.
 */
const KREDITI_NA_REGISTRACIJI = ONBOARDING_CREDITS;

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
    p_credits: KREDITI_NA_REGISTRACIJI,
    p_ref_id: `signup:${userId}`,
  });

  if (error) throw new Error(`Kreiranje profila nije uspelo: ${error.message}`);
}

/** Najmanji razmak između dva upisa `last_seen_at` (F12 §3.1). */
const DOLAZAK_RAZMAK_MS = 60 * 60 * 1000;

/**
 * „Korisnik je bio ovde" — `profiles.last_seen_at` (F12, migracija 0012).
 *
 * Zove se iz `(app)/layout.tsx` kroz `after()`, dakle POSLE odgovora: kolona
 * postoji zbog admin liste i zbog pitanja `zasto-ne-vracas`, a nijedno od to
 * dvoje ne sme da uspori učitavanje strane.
 *
 * Najviše jednom na sat po korisniku, i to na dva mesta odjednom:
 *   1. `prethodni` iz profila koji je layout ionako pročitao — pa se u ogromnoj
 *      većini učitavanja ne šalje nijedan upit;
 *   2. uslov u samom `update`-u — jer dva taba mogu da prođu prvu proveru u
 *      istoj sekundi, a upis je tada nepotreban drugi put.
 *
 * Direktan `update` nad `profiles` je ovde u redu: ne dira `credits_balance`, pa
 * pravilo 3 nije u igri.
 *
 * Ne baca. Promašen upis znači da je „poslednji put" u konzoli sat vremena
 * stariji nego što jeste — to nije razlog da bilo šta padne.
 */
export async function zabeleziDolazak(
  userId: string,
  prethodni: string | null,
): Promise<void> {
  const sada = Date.now();
  if (prethodni && sada - Date.parse(prethodni) < DOLAZAK_RAZMAK_MS) return;

  const prag = new Date(sada - DOLAZAK_RAZMAK_MS).toISOString();

  const { error } = await adminSupabase()
    .from("profiles")
    .update({ last_seen_at: new Date(sada).toISOString() })
    .eq("id", userId)
    .or(`last_seen_at.is.null,last_seen_at.lt.${prag}`);

  if (error) console.error("[profile] upis poslednjeg dolaska:", error.message);
}

/**
 * Stripe kupac vezan za nalog, ili `null` kad nalog nikad nije bio na checkoutu.
 *
 * Postoji zbog brisanja naloga (S28, C6): pre nego što profil nestane, žive
 * pretplate tog kupca moraju da budu otkazane. Čita se admin klijentom jer
 * pozivalac je webhook — tamo Clerk sesije nema.
 *
 * BACA na grešku iz baze, i to je namerno: nepročitan `stripe_customer_id` nije
 * „nalog nema pretplatu", nego „ne znam da li ima". Brisanje naloga koje na to
 * odgovori nastavljanjem je tiho ostavljena naplata.
 */
export async function stripeKupacZaNalog(userId: string): Promise<string | null> {
  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle<{ stripe_customer_id: string | null }>();

  if (error) throw new Error(`Čitanje Stripe kupca nije uspelo: ${error.message}`);

  return data?.stripe_customer_id ?? null;
}

/**
 * Brisanje profila i svega što za njim ide (F12 §4, pravilo 15).
 *
 * Zove ga ISKLJUČIVO webhook `user.deleted`. Clerk je izvor istine za identitet;
 * baza ga prati. Drugi pozivalac bi značio da se nalog može obrisati u bazi a
 * ostati u Clerku — čovek bi se i dalje prijavljivao, samo bez ijednog reda.
 *
 * Kaskadu radi baza, ne ovaj kod: `unlocks`, `credit_ledger`, `job_subscribers`,
 * `feedback` i `feedback_prompts` vise o `profiles` sa `on delete cascade`, a
 * `lead_status` i `outreach_messages` o `unlocks`, dakle tranzitivno.
 *
 * Tri stvari NAMERNO preživljavaju:
 *   - `businesses` i `website_audits` — to nisu korisnikovi podaci nego imovina
 *     proizvoda (00-kontekst §4, F12 §4);
 *   - `searches` — kolona je `on delete set null` (0001), pa red ostaje bez
 *     vlasnika. Udeo keša u pretragama je brojka o sistemu, ne o čoveku, i
 *     depersonalizovan red je i dalje tačan;
 *   - `admin_audit` — `on delete set null` nad akterom, jer dnevnik radnji mora
 *     da nadživi onoga ko ih je izvršio (v. 0012).
 *
 * Idempotentno: brisanje nepostojećeg reda je uspeh, jer Svix ume da ponovi
 * isporuku. `false` znači „nije ga ni bilo", ne „nije uspelo".
 */
export async function obrisiProfil(userId: string): Promise<boolean> {
  const { data, error } = await adminSupabase()
    .from("profiles")
    .delete()
    .eq("id", userId)
    .select("id")
    .returns<{ id: string }[]>();

  if (error) throw new Error(`Brisanje profila nije uspelo: ${error.message}`);

  return (data ?? []).length > 0;
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
    p_credits: KREDITI_NA_REGISTRACIJI,
    p_ref_id: refId,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as RpcResult<string>[];
  return rows[0] ?? { ok: false, reason: "no_result" };
}
