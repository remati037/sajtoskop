// apps/web/src/lib/billing-skladiste.ts
// `NaplataSkladiste` nad pravom bazom (i nad Stripe-om, za metode koje traže
// mrežu). Jedina implementacija koja postoji u produkciji — druga je mapa
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
import type {
  IshodPovracaja,
  NaplataSkladiste,
  NaplataSpora,
  OtisakPretplate,
  RpcIshod,
  StavkaDodele,
  StripeRefund,
} from "./billing";
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

    async ceneStavki(priceIds) {
      // Stavka fakture na `dahlia` nosi samo `price_…` ID; `lookup_key` i
      // `recurring` su na ceni. Pad NIJE tih: bez cene nema odluke o kreditima,
      // pa skladište baca, ruta vraća 500 i Stripe ponavlja.
      const cene = await Promise.all(priceIds.map((id) => stripe().prices.retrieve(id)));
      return new Map(
        cene.map((c) => [c.id, { lookupKey: c.lookup_key ?? null, recurring: c.recurring !== null }]),
      );
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
        p_cancel_at: a.cancelAt,
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
      // Jedini Stripe poziv u obradi webhooka koji sme da padne tiho: otisak je
      // zaštita od farmi proba, ne deo ispravnosti naplate.
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

    async naplata(chargeId): Promise<NaplataSpora | null> {
      // Spor ne nosi kupca. `resource_missing` je trajno stanje (tuđa ili
      // obrisana naplata) → `null`; sve ostalo baca, ruta vraća 500 i Stripe ponavlja.
      try {
        const ch = await stripe().charges.retrieve(chargeId);
        return {
          customerId: typeof ch.customer === "string" ? ch.customer : (ch.customer?.id ?? null),
          paymentIntentId:
            typeof ch.payment_intent === "string" ? ch.payment_intent : (ch.payment_intent?.id ?? null),
        };
      } catch (err) {
        if ((err as { code?: unknown }).code === "resource_missing") return null;
        throw err;
      }
    },

    async faktureZaPlacanje(paymentIntentId) {
      // Na `dahlia` naplata nema `invoice`; veza plaćanje → faktura je
      // `InvoicePayment`. Pad NIJE tih: bez fakture povraćaj pretplate ne bi
      // skinuo ništa, a to je tiha greška u novčanoj putanji.
      const { data } = await stripe().invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: paymentIntentId },
        limit: 10,
      });
      return data.flatMap((p) => {
        const inv = p.invoice;
        if (typeof inv === "string") return [inv];
        return inv?.id ? [inv.id] : [];
      });
    },

    async refundiNaplate(chargeId): Promise<StripeRefund[]> {
      // Deterministički izvor `re_…` ID-jeva: `charge.refunds` u webhook telu ume
      // da bude skraćen ili neekspandovan. Pad NIJE tih — bez refund ID-ja nema
      // ključa idempotencije, pa ruta vraća 500 i Stripe ponavlja.
      const { data } = await stripe().refunds.list({ charge: chargeId, limit: 100 });
      return data.map((r) => ({ id: r.id, amount: r.amount, created: r.created, status: r.status }));
    },

    async dodeleZaTransakciju(userId, refIds): Promise<StavkaDodele[]> {
      if (refIds.length === 0) return [];
      const { data, error } = await db
        .from("credit_ledger")
        .select("reason, delta")
        .eq("user_id", userId)
        .in("ref_id", refIds)
        .in("reason", ["monthly_grant", "subscription_grant", "credit_pack"])
        .returns<{ reason: string; delta: number }[]>();

      if (error) throw new Error(`credit_ledger: ${error.message}`);
      return (data ?? []).map((r) => ({ reason: r.reason, delta: r.delta }));
    },

    async primeniPovracaj(a): Promise<IshodPovracaja> {
      const { data, error } = await db.rpc("apply_refund", {
        p_user: a.userId,
        p_ref_id: a.refId,
        p_amount: a.iznos,
        p_kasa: a.kasa,
        p_details: a.details,
      });
      if (error) throw new Error(`apply_refund: ${error.message}`);
      // `delta` je negativan (ili 0 za `na_podu`); obrada broji skinuto pozitivno.
      const red = (Array.isArray(data) ? data[0] : null) as
        | { ok?: unknown; reason?: string; delta?: number }
        | null;
      if (!red || typeof red.ok !== "boolean") return { ok: false, reason: "prazan odgovor", skinuto: 0 };
      return { ok: red.ok, reason: red.reason ?? "", skinuto: -(red.delta ?? 0) };
    },
  };
}
