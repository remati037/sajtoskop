// apps/web/src/lib/proba.ts
// Da li nalog još ima pravo na probu (naplata-stripe.md §5.2, §7.6).
//
// Izmešteno iz checkout rute u S26 jer isto pitanje sada postavlja i ekran cena:
// rečenica „Proba 7 dana, 10 kredita…" iznad kartica je obećanje, a checkout
// drugu probu istom nalogu ne daje. Dva odgovora na isto pitanje bi značila
// cenovnik koji obeća probu i Stripe stranu koja odmah traži pun iznos.

import "server-only";
import { adminSupabase } from "./supabase";

/**
 * Je li nalog ikad imao probu: `trial_grant` u knjizi (jednom po nalogu) ili
 * pretplata sa `trial_end`. Drugu probu isti nalog ne dobija (§5.2, §7.6).
 */
export async function imaoProbuRanije(userId: string): Promise<boolean> {
  const db = adminSupabase();

  const { data: knjiga, error: kErr } = await db
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", "trial_grant")
    .limit(1)
    .returns<{ id: number }[]>();
  if (kErr) throw new Error(`credit_ledger: ${kErr.message}`);
  if ((knjiga ?? []).length > 0) return true;

  const { data: pretplate, error: pErr } = await db
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .not("trial_end", "is", null)
    .limit(1)
    .returns<{ stripe_subscription_id: string }[]>();
  if (pErr) throw new Error(`subscriptions: ${pErr.message}`);
  return (pretplate ?? []).length > 0;
}
