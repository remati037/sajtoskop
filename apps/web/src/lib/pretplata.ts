// apps/web/src/lib/pretplata.ts
// Čitanje `subscriptions` za EKRAN i za PORTAL (S21).
//
// ── zašto je odvojeno od `lib/pristup.ts` ───────────────────
// `citajPretplatu()` tamo vraća namerno osiromašen oblik — tačno tri polja koja
// `stanjePristupa()` sme da vidi (`PretplataZaPristup` u shared paketu). To je
// dobro i ostaje tako: kapiju pristupa ne zanima koji je `lookup_key` kupljen ni
// kako se pretplata zove kod Stripe-a, a svako polje koje bi joj se dodalo
// postalo bi polje po kome neko sme da zaključa.
//
// Ekranu stanja pretplate, međutim, trebaju baš ta polja: `ciklus` („mesečno"
// ili „godišnje"), `lookup_key` (iz njega cenovnik zna iznos) i
// `stripe_subscription_id` (za „Aktiviraj odmah", K2). Zato drugi čitač, a ne
// šire polje u kapiji.
//
// ── zašto admin klijent ─────────────────────────────────────
// `subscriptions` ima `enable`/`force row level security` BEZ IJEDNE POLITIKE
// (migracija 0022 §3), pa korisnički klijent uvek vraća prazno. Identitet i
// dalje dolazi iz verifikovane Clerk sesije: `userId` stiže kao argument iz
// `requireSession()` / `requireUserId()`, nikad iz tela zahteva (pravilo 8).

import "server-only";
import { cache } from "react";
import { kupovinaZaLookupKey, type Ciklus, type SubscriptionRow } from "@sajtoskop/shared";
import { adminSupabase } from "./supabase";

/** Ono što ekran i portal traže od pretplate. Više od kapije, manje od cele tabele. */
export type PretplataZaEkran = {
  subscriptionId: string;
  status: SubscriptionRow["status"];
  plan: SubscriptionRow["plan"];
  lookupKey: string | null;
  /**
   * Iz kolone `ciklus` koju upisuje webhook; kad je prazna (pretplata sa cenom
   * koju katalog ne poznaje), izvodi se iz `lookup_key` kroz katalog. `null` =
   * ni jedno ni drugo (ručno napravljena pretplata u Stripe panelu).
   */
  ciklus: Ciklus | null;
  /** Iznos u evrima iz `plans.ts` po `lookup_key`; `null` kad ključ nije naš. */
  eur: number | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
};

const KOLONE =
  "stripe_subscription_id, status, plan, ciklus, lookup_key, current_period_end, trial_end, cancel_at_period_end, canceled_at";

type Red = Pick<
  SubscriptionRow,
  | "stripe_subscription_id"
  | "status"
  | "plan"
  | "ciklus"
  | "lookup_key"
  | "current_period_end"
  | "trial_end"
  | "cancel_at_period_end"
  | "canceled_at"
>;

function uEkran(r: Red): PretplataZaEkran {
  const kupovina = kupovinaZaLookupKey(r.lookup_key);
  return {
    subscriptionId: r.stripe_subscription_id,
    status: r.status,
    plan: r.plan,
    lookupKey: r.lookup_key,
    ciklus: r.ciklus ?? (kupovina?.kind === "subscription" ? kupovina.ciklus : null),
    eur: kupovina?.kind === "subscription" ? kupovina.eur : null,
    currentPeriodEnd: r.current_period_end,
    trialEnd: r.trial_end,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    canceledAt: r.canceled_at,
  };
}

/**
 * Najsvežija pretplata korisnika, ili `null` ako je nikad nije ni bilo.
 *
 * Isti redosled i isti indeks kao `citajPretplatu()` u `lib/pristup.ts`
 * (`subscriptions (user_id, current_period_end desc)`): više redova postoji kad
 * je korisnik menjao plan, a merodavan je onaj koji traje najduže. Dva čitača
 * moraju da biraju ISTI red — inače baner kaže jedno, a ekran drugo.
 *
 * Ne baca. Pad ovog upita znači blok bez podataka o pretplati, ne pad strane
 * kredita: izvod iz knjige je i dalje ono zbog čega je čovek došao.
 */
export const citajPretplatuZaEkran = cache(
  async (userId: string): Promise<PretplataZaEkran | null> => {
    const { data, error } = await adminSupabase()
      .from("subscriptions")
      .select(KOLONE)
      .eq("user_id", userId)
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<Red>();

    if (error) {
      console.error("[pretplata] čitanje za ekran nije uspelo:", error.message);
      return null;
    }

    return data ? uEkran(data) : null;
  },
);
