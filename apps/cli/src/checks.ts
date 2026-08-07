// apps/cli/src/checks.ts
// Provere iz „Gotovo kad" (F1, sekcija 9). Pokretanje: `pnpm check:f1`
//
// Ovo nije unit test — priča sa pravom bazom, jer se baš to i proverava:
// RLS politike i zaključavanje reda u Postgresu ne postoje u TypeScriptu i ne
// mogu se mockovati. Race condition se dokazuje pokretanjem, ne pretpostavkom.
//
// Skripta pravi privremen profil, radi nad njim i briše ga na kraju
// (`on delete cascade` počisti unlocks i credit_ledger).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RpcResult, SpendReason } from "@sajtoskop/shared";
import { PLANS } from "@sajtoskop/shared";
import { loadRootEnv, supabaseAdmin, supabaseAnon } from "@sajtoskop/worker/lib";

loadRootEnv();

let failed = 0;

function check(ok: boolean, line: string, detail?: string): void {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
  if (detail) console.log(`   ${detail}`);
}

function rpcRows<R extends string>(data: unknown): RpcResult<R>[] {
  return (data ?? []) as RpcResult<R>[];
}

// ── 1. RLS: anon ne sme da vidi deljene tabele ─────────────

async function checkRls(anon: SupabaseClient): Promise<void> {
  console.log("\nRLS — anon ključ");

  for (const table of ["businesses", "website_audits", "job_queue", "api_budget"]) {
    const { data, error } = await anon.from(table).select("*").limit(5);
    const rows = data?.length ?? 0;
    // Ispravan ishod je prazan rezultat (politika `using (false)`) ili greška.
    // Neispravan je bilo koji vraćen red.
    check(rows === 0, `${table.padEnd(16)} anon vidi ${rows} redova`, error ? `(${error.message})` : undefined);
  }

  for (const table of ["profiles", "unlocks", "credit_ledger", "searches"]) {
    const { data } = await anon.from(table).select("*").limit(5);
    const rows = data?.length ?? 0;
    check(rows === 0, `${table.padEnd(16)} anon vidi ${rows} redova (nema sesiju → nema svojih redova)`);
  }
}

// ── 2. Funkcije nisu izvršive anon ključem ─────────────────

async function checkFunctionGrants(anon: SupabaseClient): Promise<void> {
  console.log("\nPrava nad funkcijama — anon ključ");

  const { error } = await anon.rpc("spend_credit_and_unlock", {
    p_user: "user_bilo_koji",
    p_place: "bilo_koji",
  });

  check(
    error !== null,
    "spend_credit_and_unlock nije izvršiva anon ključem",
    error ? `(${error.message})` : "PROPUST: anon je uspeo da pozove funkciju za tuđeg korisnika",
  );
}

// ── 3. Race condition: 20 paralelnih unlockova sa 1 kreditom ──

async function checkUnlockRace(db: SupabaseClient): Promise<void> {
  console.log("\nKrediti — 20 paralelnih otključavanja sa 1 kreditom");

  const testUser = `user_f1check_${Date.now()}`;

  const { data: places, error: placesErr } = await db
    .from("businesses")
    .select("place_id")
    .limit(20);

  if (placesErr) throw new Error(`Čitanje businesses nije uspelo: ${placesErr.message}`);

  const placeIds = ((places ?? []) as { place_id: string }[]).map((p) => p.place_id);
  if (placeIds.length < 2) {
    check(false, `u bazi ima ${placeIds.length} biznisa — pokreni prvo \`pnpm seed\``);
    return;
  }
  if (placeIds.length < 20) {
    console.log(`   (u bazi ima ${placeIds.length} biznisa, test radi sa toliko)`);
  }

  try {
    const { error: createErr } = await db.rpc("create_profile_with_grant", {
      p_user: testUser, p_email: null, p_credits: 1, p_ref_id: `test:${testUser}`,
    });
    if (createErr) throw new Error(`Pravljenje test profila nije uspelo: ${createErr.message}`);

    // Svih 20 kreće istovremeno — bez `for await`, inače nema trke.
    const results = await Promise.all(
      placeIds.map((placeId) =>
        db.rpc("spend_credit_and_unlock", { p_user: testUser, p_place: placeId })
          .then((r) => {
            if (r.error) return "rpc_error";
            return rpcRows<SpendReason>(r.data)[0]?.reason ?? "no_result";
          }),
      ),
    );

    const unlocked = results.filter((r) => r === "unlocked").length;
    const denied = results.filter((r) => r === "insufficient_credits").length;

    check(unlocked === 1, `tačno jedan 'unlocked'  (dobijeno: ${unlocked})`);
    check(
      denied === placeIds.length - 1,
      `ostali odbijeni sa 'insufficient_credits'  (dobijeno: ${denied}/${placeIds.length - 1})`,
    );

    const { data: profile } = await db
      .from("profiles").select("credits_balance").eq("id", testUser).single();
    const balance = (profile as { credits_balance: number } | null)?.credits_balance ?? -1;
    check(balance === 0, `stanje kredita je 0  (dobijeno: ${balance})`);

    const { count: unlockCount } = await db
      .from("unlocks").select("*", { count: "exact", head: true }).eq("user_id", testUser);
    check(unlockCount === 1, `tačno jedan red u unlocks  (dobijeno: ${unlockCount})`);

    const { count: ledgerCount } = await db
      .from("credit_ledger").select("*", { count: "exact", head: true })
      .eq("user_id", testUser).eq("reason", "unlock");
    check(ledgerCount === 1, `tačno jedan 'unlock' u credit_ledger  (dobijeno: ${ledgerCount})`);

    // Ponovljeno otključavanje istog lead-a je besplatno (pravilo 4).
    const firstUnlocked = placeIds.find((_, i) => results[i] === "unlocked");
    if (firstUnlocked) {
      const { data } = await db.rpc("spend_credit_and_unlock", {
        p_user: testUser, p_place: firstUnlocked,
      });
      const reason = rpcRows<SpendReason>(data)[0]?.reason;
      check(reason === "already_unlocked", `isti lead drugi put → 'already_unlocked'  (dobijeno: ${reason})`);
    }

    // Idempotencija dodele — Svix ume da isporuči isti webhook dvaput.
    console.log("\nKrediti — idempotentna dodela");
    const ref = `test-grant:${testUser}`;
    await db.rpc("grant_credits", { p_user: testUser, p_amount: 30, p_reason: "monthly_grant", p_ref_id: ref });
    const { data: second } = await db.rpc("grant_credits", {
      p_user: testUser, p_amount: 30, p_reason: "monthly_grant", p_ref_id: ref,
    });
    const secondReason = rpcRows(second)[0]?.reason;
    check(secondReason === "already_granted", `ista dodela drugi put → 'already_granted'  (dobijeno: ${secondReason})`);

    const { data: after } = await db
      .from("profiles").select("credits_balance").eq("id", testUser).single();
    const afterBalance = (after as { credits_balance: number } | null)?.credits_balance ?? -1;
    check(afterBalance === 30, `dodato tačno 30, ne 60  (dobijeno: ${afterBalance})`);
  } finally {
    await db.from("profiles").delete().eq("id", testUser);
  }
}

// ── 4. Sadržaj baze ────────────────────────────────────────

async function checkSeed(db: SupabaseClient): Promise<void> {
  console.log("\nSadržaj baze");

  const { count: businesses } = await db
    .from("businesses").select("*", { count: "exact", head: true });
  check((businesses ?? 0) > 0, `businesses: ${businesses ?? 0}`);

  const { count: audits } = await db
    .from("website_audits").select("*", { count: "exact", head: true });
  check((audits ?? 0) > 0, `website_audits: ${audits ?? 0}`);

  const { count: bad } = await db
    .from("website_audits").select("*", { count: "exact", head: true })
    .neq("site_status", "ok");
  check((bad ?? 0) > 0, `website_audits bez funkcionalnog sajta: ${bad ?? 0}`);

  // Pravilo 1: ništa se ne servira starije od 30 dana. Ovo je samo upozorenje —
  // seedovani podaci hoće da isteknu, refresh job dolazi u F3.
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { count: stale } = await db
    .from("businesses").select("*", { count: "exact", head: true })
    .lt("google_refreshed_at", cutoff);
  if ((stale ?? 0) > 0) {
    console.log(`   ⚠ ${stale} biznisa ima Google podatke starije od 30 dana — ne smeju se servirati (pravilo 1)`);
  }

  console.log(`   plan beta: ${PLANS.beta.monthlyCredits} kredita, ${PLANS.beta.cacheMissPerDay} pretraga van keša dnevno`);
}

// ── main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const anon = supabaseAnon();

  await checkRls(anon);
  await checkFunctionGrants(anon);
  await checkSeed(db);
  await checkUnlockRace(db);

  console.log(failed === 0 ? "\nSve prošlo." : `\n${failed} provera palo.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
