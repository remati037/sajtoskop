// apps/web/src/lib/billing-skladiste.ts
// `NaplataSkladiste` nad pravom bazom. Jedina implementacija koja postoji u
// produkciji — druga je mapa u memoriji, u `apps/web/test/lazno-skladiste.ts`.
//
// ── zašto je ovo zaseban fajl, a ne dno `billing.ts` ────────
// Da bi test mogao da ga zameni BEZ ijedne zaobilaznice u produkcijskom kodu.
// Testovi ovog repozitorijuma module menjaju `registerHooks` resolve hookom
// (isti obrazac kao `scripts/lib/next-stubs.ts`), a hook radi po specifikatoru —
// dakle po fajlu. Alternativa bi bila prekidač tipa „ako je test, uzmi lažni
// klijent" u samoj naplati, i to je tačno ono što `route-harness.ts` odbija:
// vrata u novčanoj putanji koja postoje samo zbog testa.
//
// Sve ide kroz `adminSupabase()`: `billing_events` i `subscriptions` imaju RLS
// bez ijedne politike (0022), a `profiles` se ovde čita bez ijedne sesije —
// identitet je došao iz potpisanog Paddle payload-a, ne iz pregledača.

import "server-only";
import type { NaplataSkladiste, RpcIshod } from "./billing";
import { adminSupabase } from "./supabase";

/** Prvi red iz `returns table (...)` RPC-a, ili uredan pad. */
function prviRed(data: unknown, fallback: string): RpcIshod {
  const red = (Array.isArray(data) ? data[0] : null) as Partial<RpcIshod> | null;
  if (!red || typeof red.ok !== "boolean") return { ok: false, reason: fallback, granted: 0 };
  return { ok: red.ok, reason: red.reason ?? "", granted: red.granted ?? 0 };
}

export function supabaseSkladiste(): NaplataSkladiste {
  const db = adminSupabase();

  return {
    async upisiDogadjaj({ eventId, eventType, occurredAt }) {
      // `on conflict do nothing` kroz `ignoreDuplicates` — vraćeni red postoji
      // samo kad je upis stvarno prošao, pa je njegovo odsustvo TAČAN test za
      // duplikat. Bez `select()` bi odgovor bio prazan i u jednom i u drugom
      // slučaju, pa bi se svaka ponovljena isporuka obradila iznova.
      const { data, error } = await db
        .from("billing_events")
        .upsert(
          { event_id: eventId, event_type: eventType, occurred_at: occurredAt },
          { onConflict: "event_id", ignoreDuplicates: true },
        )
        .select("event_id")
        .maybeSingle<{ event_id: string }>();

      if (error) throw new Error(`billing_events: ${error.message}`);
      return data !== null;
    },

    async obrisiDogadjaj(eventId) {
      const { error } = await db.from("billing_events").delete().eq("event_id", eventId);
      if (error) console.error("[paddle-webhook] brisanje markera:", error.message);
    },

    async profilPostoji(userId) {
      const { data, error } = await db
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle<{ id: string }>();
      if (error) throw new Error(`profiles: ${error.message}`);
      return data !== null;
    },

    async korisnikPoPretplati(subscriptionId) {
      const { data, error } = await db
        .from("subscriptions")
        .select("user_id")
        .eq("paddle_subscription_id", subscriptionId)
        .maybeSingle<{ user_id: string }>();
      if (error) throw new Error(`subscriptions: ${error.message}`);
      return data?.user_id ?? null;
    },

    async korisnikPoKupcu(customerId) {
      const { data, error } = await db
        .from("profiles")
        .select("id")
        .eq("paddle_customer_id", customerId)
        .maybeSingle<{ id: string }>();
      if (error) throw new Error(`profiles(paddle_customer_id): ${error.message}`);
      return data?.id ?? null;
    },

    async primeniPretplatu(a) {
      const { data, error } = await db.rpc("apply_subscription", {
        p_user: a.userId,
        p_subscription_id: a.subscriptionId,
        p_customer_id: a.customerId,
        p_status: a.status,
        p_price_id: a.priceId,
        p_plan: a.plan,
        p_period_end: a.periodEnd,
        p_credits: a.credits,
        p_txn_id: a.txnId,
        p_country: null,
        p_canceled_at: a.canceledAt,
      });
      if (error) throw new Error(`apply_subscription: ${error.message}`);
      return prviRed(data, "prazan odgovor");
    },

    async primeniPaket(a) {
      const { data, error } = await db.rpc("apply_credit_pack", {
        p_user: a.userId,
        p_credits: a.credits,
        p_txn_id: a.txnId,
        p_customer_id: a.customerId,
      });
      if (error) throw new Error(`apply_credit_pack: ${error.message}`);
      return prviRed(data, "prazan odgovor");
    },

    async dodeljenoZaTransakciju(userId, txnId) {
      const { data, error } = await db
        .from("credit_ledger")
        .select("delta")
        .eq("user_id", userId)
        .eq("ref_id", txnId)
        .in("reason", ["subscription_grant", "credit_pack"])
        .returns<{ delta: number }[]>();

      if (error) throw new Error(`credit_ledger: ${error.message}`);
      return (data ?? []).reduce((zbir, r) => zbir + r.delta, 0);
    },

    async korigujKredite(a) {
      // `p_actor` je NULL, ne neki izmišljen ID: `admin_audit.actor_id` je strani
      // ključ ka `profiles`, pa bi „paddle-webhook" srušio upis. Isti obrazac
      // koristi i Clerk webhook za kaskadno brisanje — u reviziji se `null`
      // aktor čita kao „nije iz konzole", što je ovde tačno.
      const { data, error } = await db.rpc("admin_adjust_credits", {
        p_actor: null,
        p_user: a.userId,
        p_delta: a.delta,
        p_note: a.note,
        p_ref_id: a.refId,
        p_kind: "povracaj",
      });
      if (error) throw new Error(`admin_adjust_credits: ${error.message}`);
      // Ova funkcija vraća `balance` umesto `granted`; `prviRed` će za `granted`
      // dati 0 i to je tačno — povraćaj ne dodeljuje ništa.
      return prviRed(data, "prazan odgovor");
    },
  };
}
