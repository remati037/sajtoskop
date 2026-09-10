// apps/web/src/lib/billing-skladiste.ts
// `NaplataSkladiste` nad pravom bazom (i nad Stripe-om, za dve metode koje
// traže mrežu). Jedina implementacija koja postoji u produkciji — druga je mapa
// u memoriji, u `apps/web/test/lazno-skladiste.ts`.
//
// ── zašto je ovo zaseban fajl, a ne dno `billing.ts` ────────
// Da bi test mogao da ga zameni BEZ ijedne zaobilaznice u produkcijskom kodu.
// Testovi ovog repozitorijuma module menjaju `registerHooks` resolve hookom
// (isti obrazac kao `scripts/lib/next-stubs.ts`), a hook radi po specifikatoru —
// dakle po fajlu. Alternativa bi bila prekidač tipa „ako je test, uzmi lažni
// klijent" u samoj naplati, i to je tačno ono što `route-harness.ts` odbija:
// vrata u novčanoj putanji koja postoje samo zbog testa.
//
// Sve ide kroz `adminSupabase()`: `billing_events`, `subscriptions` i
// `trial_fingerprints` imaju RLS bez ijedne politike (0022, 0025), a `profiles`
// se ovde čita bez ijedne sesije — identitet je došao iz potpisanog Stripe
// payload-a, ne iz pregledača.

import "server-only";
import type { PaidPlanId } from "@sajtoskop/shared";
import type { NaplataSkladiste, OtisakPretplate, RpcIshod } from "./billing";
import { stripe } from "./stripe-server";
import { adminSupabase } from "./supabase";

/** Prvi red iz `returns table (...)` RPC-a, ili uredan pad. */
function prviRed(data: unknown, fallback: string): RpcIshod {
  const red = (Array.isArray(data) ? data[0] : null) as
    | { ok?: unknown; reason?: string; granted?: number; delta?: number }
    | null;
  if (!red || typeof red.ok !== "boolean") return { ok: false, reason: fallback, granted: 0 };
  return { ok: red.ok, reason: red.reason ?? "", granted: red.granted ?? red.delta ?? 0 };
}

const PLACENI: readonly string[] = ["starter", "pro", "advanced"];

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
      if (error) console.error("[stripe-webhook] brisanje markera:", error.message);
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
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle<{ user_id: string }>();
      if (error) throw new Error(`subscriptions: ${error.message}`);
      return data?.user_id ?? null;
    },

    async korisnikPoKupcu(customerId) {
      const { data, error } = await db
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle<{ id: string }>();
      if (error) throw new Error(`profiles(stripe_customer_id): ${error.message}`);
      return data?.id ?? null;
    },

    async planPoPretplati(subscriptionId) {
      const { data, error } = await db
        .from("subscriptions")
        .select("plan")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle<{ plan: string | null }>();
      if (error) throw new Error(`subscriptions(plan): ${error.message}`);
      return data?.plan && PLACENI.includes(data.plan) ? (data.plan as PaidPlanId) : null;
    },

    async primeniPretplatu(a) {
      const { data, error } = await db.rpc("apply_subscription", {
        p_user: a.userId,
        p_subscription_id: a.subscriptionId,
        p_customer_id: a.customerId,
        p_status: a.status,
        p_plan: a.plan,
        p_ciklus: a.ciklus,
        p_lookup_key: a.lookupKey,
        p_period_end: a.periodEnd,
        p_trial_end: a.trialEnd,
        p_cancel_at_end: a.cancelAtPeriodEnd,
        p_canceled_at: a.canceledAt,
        p_event_created: a.eventCreated,
        p_country: null,
      });
      if (error) throw new Error(`apply_subscription: ${error.message}`);
      return prviRed(data, "prazan odgovor");
    },

    async primeniFakturu(a) {
      const { data, error } = await db.rpc("apply_invoice_paid", {
        p_user: a.userId,
        p_invoice_id: a.invoiceId,
        p_target: a.target,
      });
      if (error) throw new Error(`apply_invoice_paid: ${error.message}`);
      return prviRed(data, "prazan odgovor");
    },

    async pocniProbu(a) {
      const { data, error } = await db.rpc("apply_trial_start", {
        p_user: a.userId,
        p_subscription_id: a.subscriptionId,
        p_credits: a.credits,
      });
      if (error) throw new Error(`apply_trial_start: ${error.message}`);
      return prviRed(data, "prazan odgovor");
    },

    async istekniPretplatu(a) {
      const { data, error } = await db.rpc("expire_subscription_credits", {
        p_user: a.userId,
        p_subscription_id: a.subscriptionId,
      });
      if (error) throw new Error(`expire_subscription_credits: ${error.message}`);
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

    async oznaciPozivnicuIskoriscenom(userId) {
      const { error } = await db.from("profiles").update({ invite_id: null }).eq("id", userId);
      if (error) throw new Error(`profiles(invite_id): ${error.message}`);
    },

    async zapamtiOtisak({ fingerprint, userId }) {
      // Upis prolazi samo prvi put; na konfliktu se čita ko je prvi.
      const { data, error } = await db
        .from("trial_fingerprints")
        .upsert({ fingerprint, user_id: userId }, { onConflict: "fingerprint", ignoreDuplicates: true })
        .select("user_id")
        .maybeSingle<{ user_id: string }>();
      if (error) throw new Error(`trial_fingerprints: ${error.message}`);
      if (data) return "nov";

      const { data: prvi, error: e2 } = await db
        .from("trial_fingerprints")
        .select("user_id")
        .eq("fingerprint", fingerprint)
        .maybeSingle<{ user_id: string }>();
      if (e2) throw new Error(`trial_fingerprints(read): ${e2.message}`);
      return prvi && prvi.user_id !== userId ? "vidjen" : "nov";
    },

    async otisakKartice(subscriptionId): Promise<OtisakPretplate | null> {
      // Jedini Stripe poziv u obradi webhooka, i jedini koji sme da padne tiho:
      // otisak je zaštita od farmi proba, ne deo ispravnosti naplate.
      try {
        const sub = await stripe().subscriptions.retrieve(subscriptionId, {
          expand: ["default_payment_method"],
        });
        const pm = sub.default_payment_method;
        const fingerprint =
          pm && typeof pm !== "string" ? (pm.card?.fingerprint ?? null) : null;
        return { fingerprint, uProbi: sub.status === "trialing" };
      } catch (err) {
        console.error("[stripe-webhook] otisak kartice nije pročitan:", err);
        return null;
      }
    },

    async naplatiProbuOdmah(subscriptionId) {
      await stripe().subscriptions.update(subscriptionId, {
        trial_end: "now",
        proration_behavior: "none",
      });
    },

    async dodeljenoZaTransakciju(userId, refIds) {
      if (refIds.length === 0) return 0;
      const { data, error } = await db
        .from("credit_ledger")
        .select("delta")
        .eq("user_id", userId)
        .in("ref_id", refIds)
        .in("reason", ["monthly_grant", "subscription_grant", "credit_pack"])
        .returns<{ delta: number }[]>();

      if (error) throw new Error(`credit_ledger: ${error.message}`);
      return (data ?? []).reduce((zbir, r) => zbir + r.delta, 0);
    },

    async korigujKredite(a) {
      // `p_actor` je NULL, ne neki izmišljen ID: `admin_audit.actor_id` je strani
      // ključ ka `profiles`, pa bi „stripe-webhook" srušio upis. Isti obrazac
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
