// apps/web/test/naplata.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S25] Stripe webhook. Ovo je novčana putanja i test to prati doslovno:
//
//   · POTPIS SE NE LAŽIRA. Telo se potpisuje pravim
//     `stripe.webhooks.generateTestHeaderString({ payload, secret })` — isti
//     HMAC koji Stripe šalje — i verifikuje pravi `constructEvent` nad `whsec_`.
//     Test sa preskočenom verifikacijom ne bi dokazao ništa o jedinoj
//     autentikaciji koju taj endpoint ima.
//   · BAZA JESTE LAŽNA. `NaplataSkladiste` je zamenjen mapom u memoriji. Trke
//     nad kreditima proverava `pnpm check:f4` nad pravom bazom, a atomsku
//     naplatu `pnpm check:sql` nad pravom migracijom; ovde se proverava ono što
//     nijedno od to dvoje ne vidi — ODLUKA koja se donese pre nego što se do
//     baze uopšte stigne.
//
// Scenariji iz naplata-stripe.md §12, kao fiksture: 1 (kupovina bez probe),
// 2 (proba → plaćeno), 3 (proba otkazana), 8 (refund), 9 (dupli webhook),
// 10 (paket), 12 (prvi mesec gratis). Plus: pogrešan potpis, nema korisnika,
// `komp` iz webhooka, redosled događaja, plan sa fakture (downgrade kroz
// schedule, proracija, faktura van kataloga), prolazna greška, povraćaj skida
// ceo mesec fakture i staje na podu (0030), izgubljen spor.

import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import Stripe from "stripe";
import { CREDIT_PACKS, ONBOARDING_CREDITS, PLAN_PRICES, PLANS, TRIAL_CREDITS } from "@sajtoskop/shared";

// Isti resolve hook kao u `ide-odmah.ts` i `dubina.ts`.
const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");
const stubs = pathToFileURL(path.resolve(here, "../../../scripts/lib/next-stubs.ts")).href;

const laznoSkladiste = pathToFileURL(path.resolve(here, "lazno-skladiste.ts")).href;

registerHooks({
  resolve(specifier, context, next) {
    if (["server-only", "next/navigation", "@clerk/nextjs/server"].includes(specifier)) {
      return { url: stubs, shortCircuit: true };
    }
    // Ruta ovim dobija mapu u memoriji umesto Supabase-a. Zamena je po FAJLU, ne
    // po zastavici u kodu — v. zaglavlje `lib/billing-skladiste.ts`.
    if (specifier === "@/lib/billing-skladiste" || specifier === "./billing-skladiste") {
      return { url: laznoSkladiste, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(path.join(webSrc, specifier.slice(2))).href, context);
    }
    return next(specifier, context);
  },
});

const { KORISNIK, cenaId, napraviLazno, postavi } = await import("./lazno-skladiste");
type NaplataSkladiste = import("../src/lib/billing").NaplataSkladiste;

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ═══════════════════════════════════════════════════════════
// PRAVI POTPIS, PRAVA RUTA
// ═══════════════════════════════════════════════════════════

// Obe vrednosti su IZMIŠLJENE i moraju to i da ostanu. Prefiksi su jedini deo
// koji nešto znači: `stripeServerEnv()` traži `sk_test_` i `whsec_`. Ostatak je
// namerno niz nula koji ne liči ni na jedan pravi ključ.
//
// `gitleaks:allow` je tu jer skener meri entropiju, a ne poreklo. Oznaka stoji
// SAMO na ove dve linije.
const TAJNA = "whsec_test_00000000000000000000000000000000"; // gitleaks:allow
const API_KLJUC = "sk_test_00000000000000000000000000000000"; // gitleaks:allow
const KUPON = "PRVI_MESEC_TEST";

process.env.STRIPE_SECRET_KEY = API_KLJUC;
process.env.STRIPE_WEBHOOK_SECRET = TAJNA;
process.env.STRIPE_COUPON_FIRST_MONTH = KUPON;
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

// Isti SDK kao ruta, samo za potpisivanje. Mrežu ne dodiruje.
const stripe = new Stripe(API_KLJUC);

// Uvoz rute ide POSLE postavljanja env-a i posle resolve hooka.
const ruta = await import("../src/app/api/billing/webhook/route");

/** Jedan potpisan zahtev ka pravoj ruti, nad zadatim lažnim skladištem. */
async function posalji(
  telo: unknown,
  skladiste: NaplataSkladiste,
  opcije: { tajna?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  postavi(skladiste);
  const sirovo = JSON.stringify(telo);
  const potpis = stripe.webhooks.generateTestHeaderString({
    payload: sirovo,
    secret: opcije.tajna ?? TAJNA,
  });
  const res = await ruta.POST(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": potpis },
      body: sirovo,
    }),
  );
  const tekst = await res.text();
  postavi(null);

  let body: Record<string, unknown> = {};
  try {
    body = tekst ? (JSON.parse(tekst) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

// ═══════════════════════════════════════════════════════════
// FIKSTURE — oblik Stripe API 2026 (dahlia): `current_period_end` na stavci,
// `invoice.parent.subscription_details`
// ═══════════════════════════════════════════════════════════

const T0 = 1_757_500_000; // 2026-09-10, unix sekunde
const DAN = 86_400;

function dogadjaj(id: string, type: string, object: Record<string, unknown>, created = T0) {
  return {
    id,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created,
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  };
}

function pretplata(o: {
  id?: string;
  status: string;
  lookupKey: string;
  periodEnd?: number;
  trialEnd?: number | null;
  cancelAtEnd?: boolean;
  canceledAt?: number | null;
  metadata?: Record<string, string> | null;
}) {
  return {
    id: o.id ?? "sub_test_1",
    object: "subscription",
    customer: "cus_test_1",
    status: o.status,
    cancel_at_period_end: o.cancelAtEnd ?? false,
    canceled_at: o.canceledAt ?? null,
    trial_end: o.trialEnd ?? null,
    metadata: o.metadata === undefined ? { user_id: KORISNIK, kind: "subscription" } : o.metadata,
    items: {
      object: "list",
      data: [
        {
          id: "si_test_1",
          object: "subscription_item",
          current_period_end: o.periodEnd ?? T0 + 30 * DAN,
          price: { id: "price_test", object: "price", lookup_key: o.lookupKey },
        },
      ],
    },
  };
}

/**
 * Stavka fakture u obliku `dahlia`: nema `price`, samo `pricing.price_details.price`
 * kao goli ID. `lookup_key` obrada dobija tek kroz `ceneStavki`.
 */
function linija(o: { lookupKey: string; iznos: number; proracija?: boolean }) {
  return {
    id: `il_test_${o.lookupKey}_${o.iznos}`,
    object: "line_item",
    amount: o.iznos,
    parent: {
      type: "subscription_item_details",
      subscription_item_details: { subscription: "sub_test_1", subscription_item: "si_test_1", proration: o.proracija ?? false },
      invoice_item_details: null,
    },
    pricing: { type: "price_details", price_details: { price: cenaId(o.lookupKey), product: "prod_test" }, unit_amount_decimal: null },
  };
}

function faktura(o: {
  id: string;
  billingReason: string;
  amountDue: number;
  subId?: string;
  discount?: boolean;
  metadata?: Record<string, string> | null;
  /** Cena na stavci — ONO što faktura plaća. Podrazumevano Pro mesečno. */
  lookupKey?: string;
  linije?: ReturnType<typeof linija>[];
}) {
  return {
    id: o.id,
    object: "invoice",
    customer: "cus_test_1",
    billing_reason: o.billingReason,
    amount_due: o.amountDue,
    total_discount_amounts: o.discount ? [{ amount: 5900, discount: "di_test" }] : [],
    discounts: o.discount ? ["di_test"] : [],
    parent: {
      type: "subscription_details",
      subscription_details: {
        subscription: o.subId ?? "sub_test_1",
        metadata: o.metadata === undefined ? { user_id: KORISNIK, plan: "pro", lookup_key: PLAN_PRICES.pro.month.lookupKey } : o.metadata,
      },
    },
    lines: {
      object: "list",
      has_more: false,
      data: o.linije ?? [linija({ lookupKey: o.lookupKey ?? PLAN_PRICES.pro.month.lookupKey, iznos: o.amountDue })],
    },
  };
}

function sesija(o: {
  mode: "payment" | "subscription";
  paket?: string;
  paymentIntent?: string;
  subId?: string;
}) {
  return {
    id: "cs_test_1",
    object: "checkout.session",
    mode: o.mode,
    customer: "cus_test_1",
    client_reference_id: KORISNIK,
    payment_intent: o.paymentIntent ?? null,
    subscription: o.subId ?? null,
    metadata:
      o.mode === "payment"
        ? { user_id: KORISNIK, kind: "pack", paket: o.paket ?? "dopuna-200" }
        : { user_id: KORISNIK, kind: "subscription" },
  };
}

// ═══════════════════════════════════════════════════════════
// 1. KUPOVINA PRO MESEČNO, BEZ PROBE (§12 #1)
// ═══════════════════════════════════════════════════════════
// Stripe redosled je proizvoljan; ovde: created → invoice.paid → checkout.

{
  const s = napraviLazno();
  const r1 = await posalji(
    dogadjaj("evt_1_sub", "customer.subscription.created", pretplata({ status: "active", lookupKey: PLAN_PRICES.pro.month.lookupKey })),
    s.skladiste,
  );
  check(r1.status === 200 && r1.body.ok === true, "1: subscription.created → 200 ok");
  check(s.pretplate.get("sub_test_1")?.status === "active", "1: ogledalo: active");
  check(s.pretplate.get("sub_test_1")?.plan === "pro" && s.pretplate.get("sub_test_1")?.ciklus === "month", "1: plan pro, ciklus month iz lookup_key");
  check(s.profil.plan === "pro" && s.profil.planExpiresAt !== null, "1: profiles.plan = pro, plan_expires_at postavljen");
  check(s.knjiga.length === 0, "1: subscription.created NE dodeljuje kredite");

  const r2 = await posalji(
    dogadjaj("evt_1_inv", "invoice.paid", faktura({ id: "in_1", billingReason: "subscription_create", amountDue: 5900 })),
    s.skladiste,
  );
  check(r2.body.ok === true, "1: invoice.paid → ok");
  check(
    s.profil.balance === PLANS.pro.monthlyCredits && s.knjiga[0]?.reason === "monthly_grant" && s.knjiga[0]?.refId === "in_1",
    `1: monthly_grant ref in_1, balans ${PLANS.pro.monthlyCredits}`,
  );

  const r3 = await posalji(
    dogadjaj("evt_1_cs", "checkout.session.completed", sesija({ mode: "subscription", subId: "sub_test_1" })),
    s.skladiste,
  );
  check(r3.body.ok === true && s.knjiga.length === 1, "1: checkout.session.completed (subscription) ne dodeljuje ništa");
}

// ═══════════════════════════════════════════════════════════
// 2. PROBA → PLAĆENO (§12 #2)
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  await posalji(
    dogadjaj(
      "evt_2_sub",
      "customer.subscription.created",
      pretplata({ status: "trialing", lookupKey: PLAN_PRICES.starter.month.lookupKey, periodEnd: T0 + 7 * DAN, trialEnd: T0 + 7 * DAN }),
    ),
    s.skladiste,
  );
  check(s.pretplate.get("sub_test_1")?.status === "trialing", "2: dan 0 — status trialing");
  check(s.pretplate.get("sub_test_1")?.trialEnd !== null, "2: trial_end upisan");
  check(
    s.profil.balance === TRIAL_CREDITS && s.knjiga[0]?.reason === "trial_grant" && s.knjiga[0]?.refId === `trial:${KORISNIK}`,
    `2: trial_grant +${TRIAL_CREDITS}, ref trial:<user>`,
  );

  // Prva faktura: 0 €, subscription_create → NEMA dodele (proba ima svojih 10).
  await posalji(
    dogadjaj("evt_2_inv0", "invoice.paid", faktura({ id: "in_2a", billingReason: "subscription_create", amountDue: 0 })),
    s.skladiste,
  );
  check(!s.knjiga.some((r) => r.reason === "monthly_grant"), "2: faktura od 0 € na probi NE dodeljuje plan kredite");

  // Korisnik potroši 6 od 10.
  s.profil.balance = 4;

  // Dan 8: naplata prošla → invoice.paid subscription_cycle → balans POSTAVLJEN na 150.
  await posalji(
    dogadjaj(
      "evt_2_inv1",
      "invoice.paid",
      faktura({ id: "in_2b", billingReason: "subscription_cycle", amountDue: 2900, lookupKey: PLAN_PRICES.starter.month.lookupKey, metadata: { user_id: KORISNIK, plan: "starter", lookup_key: PLAN_PRICES.starter.month.lookupKey } }),
      T0 + 8 * DAN,
    ),
    s.skladiste,
  );
  check(s.profil.balance === PLANS.starter.monthlyCredits, `2: dan 8 — balans ${PLANS.starter.monthlyCredits}, ne ${PLANS.starter.monthlyCredits + 4} (bez rollovera)`);
  check(s.knjiga.some((r) => r.reason === "monthly_grant" && r.refId === "in_2b"), "2: monthly_grant ref in_…");

  await posalji(
    dogadjaj(
      "evt_2_upd",
      "customer.subscription.updated",
      pretplata({ status: "active", lookupKey: PLAN_PRICES.starter.month.lookupKey, periodEnd: T0 + 38 * DAN, trialEnd: T0 + 7 * DAN }),
      T0 + 8 * DAN,
    ),
    s.skladiste,
  );
  check(s.pretplate.get("sub_test_1")?.status === "active", "2: subscription.updated → active");

  // Druga pretplata istog naloga posle otkaza → nema druge probe.
  await posalji(
    dogadjaj("evt_2_sub2", "customer.subscription.created", pretplata({ id: "sub_test_2", status: "trialing", lookupKey: PLAN_PRICES.starter.month.lookupKey, trialEnd: T0 + 60 * DAN }), T0 + 50 * DAN),
    s.skladiste,
  );
  check(s.knjiga.filter((r) => r.reason === "trial_grant").length === 1, "2: druga pretplata istog naloga NE donosi drugih 10");
}

// ═══════════════════════════════════════════════════════════
// 3. PROBA OTKAZANA PRE KRAJA (§12 #3)
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  await posalji(
    dogadjaj("evt_3_sub", "customer.subscription.created", pretplata({ status: "trialing", lookupKey: PLAN_PRICES.starter.month.lookupKey, trialEnd: T0 + 7 * DAN, periodEnd: T0 + 7 * DAN })),
    s.skladiste,
  );
  await posalji(
    dogadjaj("evt_3_upd", "customer.subscription.updated", pretplata({ status: "trialing", lookupKey: PLAN_PRICES.starter.month.lookupKey, trialEnd: T0 + 7 * DAN, periodEnd: T0 + 7 * DAN, cancelAtEnd: true, canceledAt: T0 + 3 * DAN }), T0 + 3 * DAN),
    s.skladiste,
  );
  const p = s.pretplate.get("sub_test_1");
  check(p?.cancelAtPeriodEnd === true && p.status === "trialing", "3: cancel_at_period_end = true, status ostaje trialing");
  check(s.profil.balance === TRIAL_CREDITS, "3: otkaz ne dira probne kredite");

  // Sat +8d: deleted → expire ledger −ostatak, balans 0.
  s.profil.balance = 7;
  await posalji(
    dogadjaj("evt_3_del", "customer.subscription.deleted", pretplata({ status: "canceled", lookupKey: PLAN_PRICES.starter.month.lookupKey, trialEnd: T0 + 7 * DAN, periodEnd: T0 + 7 * DAN, canceledAt: T0 + 7 * DAN }), T0 + 8 * DAN),
    s.skladiste,
  );
  check(s.pretplate.get("sub_test_1")?.status === "canceled", "3: deleted → canceled");
  check(s.profil.balance === 0 && s.knjiga.some((r) => r.reason === "expire" && r.delta === -7 && r.refId === "expire:sub_test_1"), "3: expire −7, balans 0");

  // Ponovljen `deleted` ne prazni dvaput (ni u minus).
  s.profil.balance = 3;
  await posalji(
    dogadjaj("evt_3_del2", "customer.subscription.deleted", pretplata({ status: "canceled", lookupKey: PLAN_PRICES.starter.month.lookupKey, canceledAt: T0 + 7 * DAN }), T0 + 8 * DAN + 1),
    s.skladiste,
  );
  check(s.profil.balance === 3, "3: drugi deleted za istu pretplatu → already_applied, balans netaknut");
}

// ═══════════════════════════════════════════════════════════
// 8. REFUND PUNE MESEČNE NAPLATE (§12 #8)
// ═══════════════════════════════════════════════════════════

/** `charge.refunded` u obliku `dahlia`: bez `invoice`, faktura ide preko `payment_intent`. */
function povracenaNaplata(o: { id: string; pi: string; iznos: number; refunded?: boolean }) {
  return {
    id: o.id,
    object: "charge",
    customer: "cus_test_1",
    amount: o.iznos,
    amount_refunded: o.refunded === false ? 1000 : o.iznos,
    refunded: o.refunded ?? true,
    payment_intent: o.pi,
  };
}

{
  const s = napraviLazno();
  await posalji(
    dogadjaj("evt_8_sub", "customer.subscription.created", pretplata({ status: "active", lookupKey: PLAN_PRICES.advanced.month.lookupKey })),
    s.skladiste,
  );
  await posalji(
    dogadjaj("evt_8_inv", "invoice.paid", faktura({ id: "in_8", billingReason: "subscription_create", amountDue: 11900, lookupKey: PLAN_PRICES.advanced.month.lookupKey, metadata: { user_id: KORISNIK, plan: "advanced", lookup_key: PLAN_PRICES.advanced.month.lookupKey } })),
    s.skladiste,
  );
  check(s.profil.balance === PLANS.advanced.monthlyCredits, `8: Advanced daje ${PLANS.advanced.monthlyCredits}`);

  // Na `dahlia` naplata nema `invoice` — faktura se nalazi preko plaćanja.
  s.fakturePlacanja.set("pi_8", ["in_8"]);

  // Nepotrošen mesec: 1.200 > 500 → tri komada sa različitim ref-om, balans 0.
  const r = await posalji(dogadjaj("evt_8_ref", "charge.refunded", povracenaNaplata({ id: "ch_8", pi: "pi_8", iznos: 11900 })), s.skladiste);
  check(r.status === 200 && r.body.ok === true, "8: charge.refunded → ok");
  check(s.profil.balance === 0, "8: skinut ceo mesec in_8 (1.200 → 0)");
  const komadi = s.knjiga.filter((k) => k.reason === "admin");
  check(komadi.length === 3 && new Set(komadi.map((k) => k.refId)).size === 3, "8: povraćaj preko 500 ide u komade sa RAZLIČITIM ref-om");

  await posalji(dogadjaj("evt_8_ref2", "charge.refunded", povracenaNaplata({ id: "ch_8", pi: "pi_8", iznos: 11900 })), s.skladiste);
  check(s.profil.balance === 0 && s.knjiga.filter((k) => k.reason === "admin").length === 3, "8: isti charge drugim event_id-jem ne skida dvaput (fina brana)");
}

{
  // Potrošen Advanced mesec: −1.200 bi probilo pod −1000 (0030) → odseca se, ne puca.
  const s = napraviLazno();
  await posalji(
    dogadjaj("evt_8p_inv", "invoice.paid", faktura({ id: "in_8p", billingReason: "subscription_create", amountDue: 11900, lookupKey: PLAN_PRICES.advanced.month.lookupKey })),
    s.skladiste,
  );
  s.profil.balance = 0;
  s.fakturePlacanja.set("pi_8p", ["in_8p"]);

  const r = await posalji(dogadjaj("evt_8p_ref", "charge.refunded", povracenaNaplata({ id: "ch_8p", pi: "pi_8p", iznos: 11900 })), s.skladiste);
  check(r.status === 200 && r.body.ok === true && String(r.body.radnja).includes("pod"), "8: povraćaj ispod poda → 200, radnja kaže da je odsečeno");
  check(s.profil.balance === -1000, `8: balans staje na podu −1000 (${s.profil.balance}), ne ${-PLANS.advanced.monthlyCredits}`);
  check(
    s.knjiga.filter((k) => k.reason === "admin").length === 2 && s.revizija.length === 3 && s.revizija[2]?.delta === 0 && s.revizija[2]?.trazeno === -200,
    "8: dva komada u knjizi, treći samo u reviziji (traženo −200, skinuto 0)",
  );

  const ponovo = await posalji(dogadjaj("evt_8p_ref2", "charge.refunded", povracenaNaplata({ id: "ch_8p", pi: "pi_8p", iznos: 11900 })), s.skladiste);
  check(ponovo.body.ok === true && s.profil.balance === -1000 && s.revizija.length === 3, "8: ponovljen povraćaj na podu → bez novih redova");
}

{
  // Stariji API: `charge.invoice` postoji → čita se direktno, bez Stripe poziva.
  const s = napraviLazno();
  await posalji(dogadjaj("evt_8s_inv", "invoice.paid", faktura({ id: "in_8s", billingReason: "subscription_cycle", amountDue: 5900 })), s.skladiste);
  const r = await posalji(
    dogadjaj("evt_8s_ref", "charge.refunded", { ...povracenaNaplata({ id: "ch_8s", pi: "pi_8s", iznos: 5900 }), invoice: "in_8s" }),
    s.skladiste,
  );
  check(r.body.ok === true && s.profil.balance === 0, "8: stari oblik `charge.invoice` i dalje nalazi fakturu");

  const s2 = napraviLazno();
  await posalji(dogadjaj("evt_8b_inv", "invoice.paid", faktura({ id: "in_8b", billingReason: "subscription_cycle", amountDue: 5900 })), s2.skladiste);
  const bez = await posalji(dogadjaj("evt_8b_ref", "charge.refunded", povracenaNaplata({ id: "ch_8b", pi: "pi_8b", iznos: 5900 })), s2.skladiste);
  check(
    bez.body.radnja === "povraćaj bez kredita" && s2.profil.balance === PLANS.pro.monthlyCredits,
    "8: plaćanje bez fakture i bez reda u knjizi → ništa se ne skida (tako je pucalo pre popravke)",
  );
}

{
  const s = napraviLazno();
  s.profil.balance = 37;

  // Delimičan refund: ništa automatski.
  const pre = s.profil.balance;
  await posalji(
    dogadjaj("evt_8_part", "charge.refunded", { id: "ch_8b", object: "charge", customer: "cus_test_1", amount: 11900, amount_refunded: 1000, refunded: false, invoice: "in_8", payment_intent: "pi_8" }),
    s.skladiste,
  );
  check(s.profil.balance === pre, "8: delimičan refund ne dira kredite (ručno)");
}

// ═══════════════════════════════════════════════════════════
// 9. DUPLI WEBHOOK (§12 #9)
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  const telo = dogadjaj("evt_9_inv", "invoice.paid", faktura({ id: "in_9", billingReason: "subscription_cycle", amountDue: 5900 }));

  const prvi = await posalji(telo, s.skladiste);
  const drugi = await posalji(telo, s.skladiste);
  check(prvi.body.ok === true, "9: prva isporuka prolazi");
  check(drugi.status === 200 && drugi.body.duplikat === true, "9: druga isporuka → duplikat (gruba brana)");
  check(s.knjiga.length === 1, "9: jedna stavka u knjizi");

  // Obriši marker pa pošalji ponovo: fina brana (`in_9` u knjizi) drži.
  s.dogadjaji.delete("evt_9_inv");
  const treci = await posalji(telo, s.skladiste);
  check(treci.body.ok === true && s.knjiga.length === 1 && s.profil.balance === PLANS.pro.monthlyCredits, "9: bez markera → already_granted, balans isti (fina brana)");
}

// ═══════════════════════════════════════════════════════════
// 10. PAKET 200 (§12 #10)
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  s.profil.balance = 50;
  const paket = CREDIT_PACKS["dopuna-200"];
  const r = await posalji(
    dogadjaj("evt_10_cs", "checkout.session.completed", sesija({ mode: "payment", paket: "dopuna-200", paymentIntent: "pi_10" })),
    s.skladiste,
  );
  check(r.status === 200 && r.body.ok === true, "10: checkout (payment) prolazi");
  check(s.profil.topup === paket.credits, `10: credit_pack +${paket.credits} u credits_topup`);
  check(s.profil.balance === 50, "10: credits_balance netaknut");
  check(s.knjiga[0]?.reason === "credit_pack" && s.knjiga[0]?.refId === "pi_10", "10: ref je payment_intent (pi_…)");
  check(s.pretplate.size === 0, "10: paket ne pravi red u subscriptions");

  // Paket van kataloga → trajan neuspeh, ništa dodeljeno.
  const los = await posalji(
    dogadjaj("evt_10_los", "checkout.session.completed", sesija({ mode: "payment", paket: "dopuna-9999", paymentIntent: "pi_11" })),
    s.skladiste,
  );
  check(los.status === 200 && los.body.ok === false && s.profil.topup === paket.credits, "10: paket van kataloga je odbijen, bez dodele");
}

// ═══════════════════════════════════════════════════════════
// 12. PRVI MESEC GRATIS (§12 #12)
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  s.profil.inviteId = "inv_test";
  await posalji(
    dogadjaj("evt_12_sub", "customer.subscription.created", pretplata({ status: "active", lookupKey: PLAN_PRICES.pro.month.lookupKey, trialEnd: null })),
    s.skladiste,
  );
  check(s.pretplate.get("sub_test_1")?.status === "active" && s.pretplate.get("sub_test_1")?.trialEnd === null, "12: status active, bez probe");
  check(!s.knjiga.some((r) => r.reason === "trial_grant"), "12: nema trial_grant");

  // 0 € faktura sa popustom → JESTE plaćen period → dodela.
  await posalji(
    dogadjaj("evt_12_inv", "invoice.paid", faktura({ id: "in_12", billingReason: "subscription_create", amountDue: 0, discount: true })),
    s.skladiste,
  );
  check(s.profil.balance === PLANS.pro.monthlyCredits, `12: gratis mesec dodeljuje ${PLANS.pro.monthlyCredits} (za razliku od probe)`);

  await posalji(
    dogadjaj("evt_12_cs", "checkout.session.completed", sesija({ mode: "subscription", subId: "sub_test_1" })),
    s.skladiste,
  );
  check(s.profil.inviteId === null, "12: checkout.session.completed briše invite_id");
}

// ═══════════════════════════════════════════════════════════
// PONOVLJENA PROBA — ISTA KARTICA (§7.6)
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  s.zapamceniOtisci.set("fp_ista", "user_neko_drugi");
  s.otisci.set("sub_test_1", { fingerprint: "fp_ista", uProbi: true });
  const r = await posalji(
    dogadjaj("evt_fp", "checkout.session.completed", sesija({ mode: "subscription", subId: "sub_test_1" })),
    s.skladiste,
  );
  check(r.body.ok === true && s.probaNaplacena.includes("sub_test_1"), "ista kartica na drugom nalogu → proba se odmah naplaćuje");

  const s2 = napraviLazno();
  s2.otisci.set("sub_test_1", { fingerprint: "fp_nova", uProbi: true });
  await posalji(dogadjaj("evt_fp2", "checkout.session.completed", sesija({ mode: "subscription", subId: "sub_test_1" })), s2.skladiste);
  check(s2.probaNaplacena.length === 0 && s2.zapamceniOtisci.get("fp_nova") === KORISNIK, "nova kartica → otisak zapamćen, proba ostaje");
}

// ═══════════════════════════════════════════════════════════
// POGREŠAN POTPIS
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  const r = await posalji(
    dogadjaj("evt_lazan", "invoice.paid", faktura({ id: "in_lazan", billingReason: "subscription_cycle", amountDue: 5900 })),
    s.skladiste,
    { tajna: "whsec_pogresna_00000000000000000000000000" },
  );
  check(r.status === 401, "pogrešan potpis → 401");
  check(s.dogadjaji.size === 0 && s.knjiga.length === 0, "pogrešan potpis ne upisuje ni događaj ni kredite");

  postavi(s.skladiste);
  const bez = await ruta.POST(new Request("http://localhost/api/billing/webhook", { method: "POST", body: "{}" }));
  postavi(null);
  check(bez.status === 401, "bez `stripe-signature` zaglavlja → 401");
}

// ═══════════════════════════════════════════════════════════
// NEMA KORISNIKA / KOMP IZ WEBHOOKA / NEPOZNAT TIP
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  s.profil.customerId = "cus_drugi";
  const r = await posalji(
    dogadjaj("evt_bez", "customer.subscription.created", pretplata({ id: "sub_nepoznata", status: "active", lookupKey: PLAN_PRICES.pro.month.lookupKey, metadata: null })),
    s.skladiste,
  );
  check(r.status === 200 && r.body.ok === false, "bez user_id, bez pretplate, bez kupca → 200 sa ok:false (trajan neuspeh)");
  check(s.dogadjaji.has("evt_bez") && s.pretplate.size === 0, "događaj upisan, ogledalo netaknuto");
}

{
  const s = napraviLazno();
  const r = await posalji(
    dogadjaj("evt_komp", "customer.subscription.created", pretplata({ status: "active", lookupKey: PLAN_PRICES.advanced.month.lookupKey, metadata: { user_id: KORISNIK, plan: "komp" } })),
    s.skladiste,
  );
  check(r.body.ok === false && s.pretplate.size === 0 && s.profil.plan === "dopuna", "webhook koji pokušava plan `komp` je odbijen (D1)");
}

{
  const s = napraviLazno();
  const r = await posalji(dogadjaj("evt_nepoznat", "payout.paid", { id: "po_1", object: "payout" }), s.skladiste);
  check(r.status === 200 && r.body.ok === true && s.dogadjaji.has("evt_nepoznat") && s.knjiga.length === 0, "nepoznat tip: 200, upisan, bez kredita");
}

// ═══════════════════════════════════════════════════════════
// REDOSLED (§6.4): stariji updated posle novijeg ne vraća stanje unazad
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  await posalji(dogadjaj("evt_r1", "customer.subscription.updated", pretplata({ status: "active", lookupKey: PLAN_PRICES.pro.month.lookupKey }), T0 + 10), s.skladiste);
  await posalji(dogadjaj("evt_r0", "customer.subscription.updated", pretplata({ status: "trialing", lookupKey: PLAN_PRICES.pro.month.lookupKey }), T0 + 5), s.skladiste);
  check(s.pretplate.get("sub_test_1")?.status === "active", "stariji događaj stigao kasnije → ignorisan, status ostaje active");

  // invoice.paid pre subscription.created: korisnik iz metapodataka/kupca.
  const s2 = napraviLazno();
  await posalji(dogadjaj("evt_r_inv", "invoice.paid", faktura({ id: "in_r", billingReason: "subscription_create", amountDue: 5900, subId: "sub_jos_nema" })), s2.skladiste);
  check(s2.profil.balance === PLANS.pro.monthlyCredits, "invoice.paid pre subscription.created → dodela ne zavisi od reda u ogledalu");
}

// ═══════════════════════════════════════════════════════════
// PLAN SA FAKTURE, NE IZ BAZE (§6.3): downgrade kroz schedule
// ═══════════════════════════════════════════════════════════
// Downgrade Pro → Starter na kraju perioda: Stripe šalje `invoice.paid`
// (`subscription_cycle`, već po ceni `starter_month`) i `subscription.updated`
// van reda. Metapodaci fakture ostaju `pro` — snimak iz checkout-a.

async function proPretplatnik(s: ReturnType<typeof napraviLazno>) {
  await posalji(
    dogadjaj("evt_d_sub", "customer.subscription.created", pretplata({ status: "active", lookupKey: PLAN_PRICES.pro.month.lookupKey })),
    s.skladiste,
  );
  await posalji(
    dogadjaj("evt_d_inv0", "invoice.paid", faktura({ id: "in_d0", billingReason: "subscription_create", amountDue: 5900 })),
    s.skladiste,
  );
  s.profil.balance = 37;
}

const obnovaStarter = dogadjaj(
  "evt_d_inv1",
  "invoice.paid",
  faktura({ id: "in_d1", billingReason: "subscription_cycle", amountDue: 2900, lookupKey: PLAN_PRICES.starter.month.lookupKey }),
  T0 + 30 * DAN,
);
const promenaStarter = dogadjaj(
  "evt_d_upd",
  "customer.subscription.updated",
  pretplata({ status: "active", lookupKey: PLAN_PRICES.starter.month.lookupKey, periodEnd: T0 + 60 * DAN }),
  T0 + 30 * DAN + 1,
);

{
  const s = napraviLazno();
  await proPretplatnik(s);
  check(s.profil.plan === "pro" && s.pretplate.get("sub_test_1")?.plan === "pro", "downgrade: pre obnove profiles.plan = pro, ogledalo pro");

  const r = await posalji(obnovaStarter, s.skladiste);
  check(r.status === 200 && r.body.ok === true, "downgrade: invoice.paid subscription_cycle → 200 ok");
  check(s.profil.plan === "pro", "downgrade: faktura je stigla dok je profiles.plan još pro");
  check(
    s.profil.balance === PLANS.starter.monthlyCredits,
    `downgrade: stavka starter_month → balans ${PLANS.starter.monthlyCredits}, ne ${PLANS.pro.monthlyCredits}`,
  );
}

{
  const normalan = napraviLazno();
  await proPretplatnik(normalan);
  await posalji(promenaStarter, normalan.skladiste);
  await posalji(obnovaStarter, normalan.skladiste);

  const obrnut = napraviLazno();
  await proPretplatnik(obrnut);
  await posalji(obnovaStarter, obrnut.skladiste);
  await posalji(promenaStarter, obrnut.skladiste);

  const stanje = (x: ReturnType<typeof napraviLazno>) =>
    JSON.stringify({
      balans: x.profil.balance,
      plan: x.profil.plan,
      ogledalo: x.pretplate.get("sub_test_1")?.plan,
      knjiga: x.knjiga,
    });
  check(
    normalan.profil.balance === PLANS.starter.monthlyCredits && normalan.profil.plan === "starter",
    `redosled: updated pa invoice.paid → starter, ${PLANS.starter.monthlyCredits}`,
  );
  check(stanje(obrnut) === stanje(normalan), "redosled: invoice.paid pre subscription.updated → isti krajnji rezultat");
}

{
  // Upgrade sa `always_invoice`: samo proracione stavke, STARI plan prvi po redu.
  const s = napraviLazno();
  await posalji(
    dogadjaj(
      "evt_u_inv",
      "invoice.paid",
      faktura({
        id: "in_u",
        billingReason: "subscription_update",
        amountDue: 1500,
        linije: [
          linija({ lookupKey: PLAN_PRICES.starter.month.lookupKey, iznos: -1450, proracija: true }),
          linija({ lookupKey: PLAN_PRICES.pro.month.lookupKey, iznos: 2950, proracija: true }),
        ],
      }),
    ),
    s.skladiste,
  );
  check(s.profil.balance === PLANS.pro.monthlyCredits, "proracija: samo proracione stavke → plan iz pozitivne (Pro), ne iz prve");

  // Obnova sa proracijama iz prethodnog perioda + redovna stavka novog plana.
  const s2 = napraviLazno();
  await posalji(
    dogadjaj(
      "evt_u_inv2",
      "invoice.paid",
      faktura({
        id: "in_u2",
        billingReason: "subscription_cycle",
        amountDue: 1400,
        linije: [
          linija({ lookupKey: PLAN_PRICES.pro.month.lookupKey, iznos: -2950, proracija: true }),
          linija({ lookupKey: PLAN_PRICES.starter.month.lookupKey, iznos: 1450, proracija: true }),
          linija({ lookupKey: PLAN_PRICES.starter.month.lookupKey, iznos: 2900 }),
        ],
      }),
    ),
    s2.skladiste,
  );
  check(s2.profil.balance === PLANS.starter.monthlyCredits, "proracija: redovna stavka odlučuje, ne prva po redu (Pro kredit)");
}

{
  const s = napraviLazno();
  s.profil.balance = 12;
  const tudja = await posalji(
    dogadjaj("evt_vk", "invoice.paid", faktura({ id: "in_vk", billingReason: "subscription_cycle", amountDue: 1000, lookupKey: "tudja_cena" })),
    s.skladiste,
  );
  check(
    tudja.status === 200 && tudja.body.ok === true && String(tudja.body.radnja).startsWith("preskočeno") && s.knjiga.length === 0 && s.profil.balance === 12,
    "faktura bez plana iz kataloga → 200, preskočeno, bez dodele",
  );

  const paket = await posalji(
    dogadjaj("evt_vk2", "invoice.paid", faktura({ id: "in_vk2", billingReason: "subscription_cycle", amountDue: 4900, lookupKey: CREDIT_PACKS["dopuna-200"].lookupKey })),
    s.skladiste,
  );
  check(
    paket.body.ok === true && String(paket.body.radnja).startsWith("preskočeno") && s.knjiga.length === 0,
    "jednokratna cena (paket) na fakturi pretplate nije plan → preskočeno",
  );
}

{
  const s = napraviLazno();
  const r = await posalji(
    dogadjaj("evt_sch", "subscription_schedule.updated", { id: "sub_sched_test", object: "subscription_schedule", subscription: "sub_test_1" }),
    s.skladiste,
  );
  check(
    r.status === 200 && r.body.radnja === "preskočeno:subscription_schedule.updated" && s.knjiga.length === 0 && s.pretplate.size === 0,
    "subscription_schedule.updated → preskočeno, ništa ne dira",
  );
}

// ═══════════════════════════════════════════════════════════
// POVRAĆAJ SKIDA CEO MESEC FAKTURE (0030)
// ═══════════════════════════════════════════════════════════
// Prijava iz sandboxa: onboarding +2, proba +10, „Aktiviraj odmah" → Pro, u
// konzoli „452". Balans JE 450; 2 su dopuna (0026). Povraćaj te fakture skida
// ceo mesec (`balance_after`), ne deltu — v. `zaPovracaj`.

{
  const s = napraviLazno();
  s.dodeli("onboarding", ONBOARDING_CREDITS, `signup:${KORISNIK}`);
  await posalji(
    dogadjaj("evt_m_sub", "customer.subscription.created", pretplata({ status: "trialing", lookupKey: PLAN_PRICES.pro.month.lookupKey, trialEnd: T0 + 7 * DAN, periodEnd: T0 + 7 * DAN })),
    s.skladiste,
  );
  check(
    s.profil.balance === TRIAL_CREDITS && s.profil.topup === ONBOARDING_CREDITS,
    `mesec: pre fakture balans ${TRIAL_CREDITS}, dopuna ${ONBOARDING_CREDITS} (onboarding ide u dopunu)`,
  );

  await posalji(
    dogadjaj("evt_m_inv", "invoice.paid", faktura({ id: "in_m", billingReason: "subscription_cycle", amountDue: 5900 }), T0 + DAN),
    s.skladiste,
  );
  const red = s.knjiga.find((k) => k.reason === "monthly_grant" && k.refId === "in_m");
  check(
    s.profil.balance === PLANS.pro.monthlyCredits && s.profil.topup === ONBOARDING_CREDITS,
    `mesec: invoice.paid → balans tačno ${PLANS.pro.monthlyCredits}, dopuna ${ONBOARDING_CREDITS} netaknuta`,
  );
  check(
    red?.delta === PLANS.pro.monthlyCredits - TRIAL_CREDITS && red.balanceAfter === PLANS.pro.monthlyCredits,
    `mesec: knjiga nosi primenjenu deltu ${PLANS.pro.monthlyCredits - TRIAL_CREDITS} i balance_after ${PLANS.pro.monthlyCredits}`,
  );

  s.fakturePlacanja.set("pi_m", ["in_m"]);
  await posalji(dogadjaj("evt_m_ref", "charge.refunded", povracenaNaplata({ id: "ch_m", pi: "pi_m", iznos: 5900 })), s.skladiste);
  check(
    s.profil.balance === 0 && s.profil.topup === ONBOARDING_CREDITS,
    `mesec: povraćaj → balans 0 (ne ${TRIAL_CREDITS}), dopuna ${ONBOARDING_CREDITS} ostaje`,
  );
}

{
  // Downgrade: ostatak 600, faktura Starter → delta negativna. Povraćaj skida ceo mesec, ne 0.
  const s = napraviLazno();
  s.profil.balance = 600;
  s.profil.topup = 25;
  await posalji(
    dogadjaj("evt_md_inv", "invoice.paid", faktura({ id: "in_md", billingReason: "subscription_cycle", amountDue: 2900, lookupKey: PLAN_PRICES.starter.month.lookupKey })),
    s.skladiste,
  );
  const red = s.knjiga.find((k) => k.refId === "in_md");
  check(
    s.profil.balance === PLANS.starter.monthlyCredits && red?.delta === PLANS.starter.monthlyCredits - 600,
    `downgrade: balans ${PLANS.starter.monthlyCredits}, delta ${red?.delta} (negativna)`,
  );
  check(s.profil.topup === 25, "downgrade: dopuna preživljava mesečnu dodelu");

  s.fakturePlacanja.set("pi_md", ["in_md"]);
  await posalji(dogadjaj("evt_md_ref", "charge.refunded", povracenaNaplata({ id: "ch_md", pi: "pi_md", iznos: 2900 })), s.skladiste);
  check(
    s.profil.balance === 0 && s.profil.topup === 25,
    `downgrade: povraćaj → balans 0, ne ${PLANS.starter.monthlyCredits}`,
  );
}

{
  // Deo meseca potrošen pre povraćaja → dug, isto kao potrošen paket.
  const s = napraviLazno();
  await posalji(
    dogadjaj("evt_mp_inv", "invoice.paid", faktura({ id: "in_mp", billingReason: "subscription_cycle", amountDue: 2900, lookupKey: PLAN_PRICES.starter.month.lookupKey })),
    s.skladiste,
  );
  s.profil.balance = PLANS.starter.monthlyCredits - 40;
  s.fakturePlacanja.set("pi_mp", ["in_mp"]);
  await posalji(dogadjaj("evt_mp_ref", "charge.refunded", povracenaNaplata({ id: "ch_mp", pi: "pi_mp", iznos: 2900 })), s.skladiste);
  check(s.profil.balance === -40, `potrošeno 40 pa povraćaj → dug −40 (${s.profil.balance})`);
}

{
  // Red pre 0030 (bez `balance_after`) → staro pravilo, max(delta, 0).
  const s = napraviLazno();
  s.knjiga.push({ userId: KORISNIK, delta: PLANS.pro.monthlyCredits - TRIAL_CREDITS, reason: "monthly_grant", refId: "in_staro" });
  s.profil.balance = PLANS.pro.monthlyCredits;
  s.fakturePlacanja.set("pi_staro", ["in_staro"]);
  await posalji(dogadjaj("evt_staro_ref", "charge.refunded", povracenaNaplata({ id: "ch_staro", pi: "pi_staro", iznos: 5900 })), s.skladiste);
  check(s.profil.balance === TRIAL_CREDITS, `red bez balance_after → skida se delta (balans ${s.profil.balance})`);
}

{
  // Paket: skida se ono što je paket dodao; faktura ne postoji.
  const s = napraviLazno();
  const paket = CREDIT_PACKS["dopuna-200"];
  await posalji(
    dogadjaj("evt_pk_cs", "checkout.session.completed", sesija({ mode: "payment", paket: "dopuna-200", paymentIntent: "pi_pk" })),
    s.skladiste,
  );
  s.profil.balance = 50;
  await posalji(dogadjaj("evt_pk_ref", "charge.refunded", povracenaNaplata({ id: "ch_pk", pi: "pi_pk", iznos: 4900 })), s.skladiste);
  check(s.profil.balance === 50 - paket.credits, `paket: povraćaj skida ${paket.credits} (iz kase koja sme u minus)`);
}

// ═══════════════════════════════════════════════════════════
// IZGUBLJEN SPOR (charge.dispute.closed)
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  await posalji(dogadjaj("evt_sp_inv", "invoice.paid", faktura({ id: "in_sp", billingReason: "subscription_cycle", amountDue: 5900 })), s.skladiste);
  s.naplate.set("ch_sp", { customerId: "cus_test_1", paymentIntentId: "pi_sp" });
  s.fakturePlacanja.set("pi_sp", ["in_sp"]);
  const spor = (id: string, status: string) =>
    dogadjaj(id, "charge.dispute.closed", { id: "dp_sp", object: "dispute", charge: "ch_sp", payment_intent: "pi_sp", status, amount: 5900, currency: "eur" });

  const dobijen = await posalji(spor("evt_sp_won", "won"), s.skladiste);
  check(dobijen.body.ok === true && s.profil.balance === PLANS.pro.monthlyCredits, "spor dobijen → krediti netaknuti");

  const izgubljen = await posalji(spor("evt_sp_lost", "lost"), s.skladiste);
  check(izgubljen.body.ok === true && s.profil.balance === 0, `spor izgubljen → skinut ceo mesec (balans ${s.profil.balance})`);
  check(s.knjiga.some((k) => k.reason === "admin" && k.refId === "spor:dp_sp"), "spor: ref je spor:<dp_…>");

  const s2 = napraviLazno();
  const nepoznat = await posalji(
    dogadjaj("evt_sp_x", "charge.dispute.closed", { id: "dp_x", object: "dispute", charge: "ch_nema", payment_intent: null, status: "lost", amount: 5900, currency: "eur" }),
    s2.skladiste,
  );
  check(nepoznat.status === 200 && nepoznat.body.ok === false, "spor nad naplatom koju Stripe ne zna → 200, ok:false (trajno)");
}

{
  // `invoicePayments` ne odgovara → 500, ništa skinuto, marker povučen; retry skida.
  const s = napraviLazno();
  await posalji(dogadjaj("evt_ip_inv", "invoice.paid", faktura({ id: "in_ip", billingReason: "subscription_cycle", amountDue: 5900 })), s.skladiste);
  s.fakturePlacanja.set("pi_ip", ["in_ip"]);
  let prviPut = true;
  const nestabilno: NaplataSkladiste = {
    ...s.skladiste,
    async faktureZaPlacanje(pi) {
      if (prviPut) {
        prviPut = false;
        throw new Error("Stripe ne odgovara");
      }
      return await s.skladiste.faktureZaPlacanje(pi);
    },
  };
  const telo = dogadjaj("evt_ip_ref", "charge.refunded", povracenaNaplata({ id: "ch_ip", pi: "pi_ip", iznos: 5900 }));
  const pao = await posalji(telo, nestabilno);
  check(
    pao.status === 500 && s.profil.balance === PLANS.pro.monthlyCredits && !s.dogadjaji.has("evt_ip_ref"),
    "invoicePayments pao → 500, ništa skinuto, marker povučen",
  );
  const ponovljen = await posalji(telo, nestabilno);
  check(ponovljen.body.ok === true && s.profil.balance === 0, "retry povraćaja skida ceo mesec");
}

// ═══════════════════════════════════════════════════════════
// PROLAZNA GREŠKA SE PONAVLJA
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  let prviPut = true;
  const nestabilno: NaplataSkladiste = {
    ...s.skladiste,
    async primeniFakturu(a) {
      if (prviPut) {
        prviPut = false;
        throw new Error("baza ne odgovara");
      }
      return await s.skladiste.primeniFakturu(a);
    },
  };
  const telo = dogadjaj("evt_retry", "invoice.paid", faktura({ id: "in_retry", billingReason: "subscription_cycle", amountDue: 5900 }));
  const pao = await posalji(telo, nestabilno);
  check(pao.status === 500 && !s.dogadjaji.has("evt_retry"), "prolazna greška → 500, marker povučen");
  const ponovljen = await posalji(telo, nestabilno);
  check(ponovljen.status === 200 && ponovljen.body.ok === true && s.profil.balance === PLANS.pro.monthlyCredits, "retry prolazi i tek tada dodeljuje");
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
