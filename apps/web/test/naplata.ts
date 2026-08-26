// apps/web/test/naplata.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S18] Paddle webhook. Ovo je novčana putanja i test to prati doslovno:
//
//   · POTPIS SE NE LAŽIRA. Telo se potpisuje pravim HMAC-om, isto kao što ga
//     Paddle potpisuje, i verifikuje pravi `paddle.webhooks.unmarshal`. Test sa
//     preskočenom verifikacijom ne bi dokazao ništa o jedinoj autentikaciji koju
//     taj endpoint ima.
//   · BAZA JESTE LAŽNA. `NaplataSkladiste` je zamenjen mapom u memoriji. Trke
//     nad kreditima proverava `pnpm check:f4` nad pravom bazom, a atomsku
//     naplatu `pnpm check:sql` nad pravom migracijom; ovde se proverava ono što
//     nijedno od to dvoje ne vidi — ODLUKA koja se donese pre nego što se do
//     baze uopšte stigne.
//
// Pet slučajeva koji su bili razlog da ovaj fajl postoji:
//   1. isti `event_id` dvaput → jedna stavka u knjizi, jedna dodela
//   2. pogrešan potpis → 401 i nijedan upis
//   3. `transaction.completed` bez ijednog traga o korisniku → ne ruši se,
//      događaj se upisuje, greška se javi
//   4. kupovina paketa → krediti u `credits_topup`, ne u `credits_balance`
//   5. webhook koji pokušava plan `beta` → odbijen

import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { CREDIT_PACKS, PLAN_PRICE_IDS, PLANS } from "@sajtoskop/shared";

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

const { KORISNIK, napraviLazno, postavi } = await import("./lazno-skladiste");
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
// koji nešto znači: `paddleServer()` ukršta `pdl_sdbx_` sa okruženjem, a SDK
// traži `pdl_ntfset_` za webhook tajnu. Ostatak je namerno niz cifara koji ne
// liči ni na jedan pravi ključ.
//
// `gitleaks:allow` je tu jer skener meri entropiju, a ne poreklo — bez njega
// commit sa ovim fajlom pada na lažnoj uzbuni. Oznaka stoji SAMO na ove dve
// linije; nigde drugde u repozitorijumu je nema i ne sme da je bude.
const TAJNA = "pdl_ntfset_test_00000000000000000000"; // gitleaks:allow
const API_KLJUC = "pdl_sdbx_test_00000000000000000000"; // gitleaks:allow

/**
 * Isto što Paddle stavlja u `Paddle-Signature`: `ts=<sekunde>;h1=<hmac>`, gde je
 * HMAC-SHA256 računat nad `"<ts>:<sirovo telo>"`.
 *
 * ‼️ Vreme mora da bude SVEŽE: SDK odbija potpis stariji od 5 sekundi.
 */
function potpis(telo: string, tajna = TAJNA): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", tajna).update(`${ts}:${telo}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

// `PADDLE_*` promenljive se postavljaju ovde, a ne u `.env`: test ne sme da
// zavisi od toga da li na ovoj mašini uopšte postoji Paddle nalog. Sve tri su
// izmišljene i nijedna ne otvara nijedan pravi nalog — ruta ih traži samo zato
// što `paddleServerEnv()` s pravom odbija da radi bez njih.
process.env.PADDLE_API_KEY = API_KLJUC;
process.env.PADDLE_WEBHOOK_SECRET = TAJNA;
process.env.NEXT_PUBLIC_PADDLE_ENV = "sandbox";

// Uvoz rute ide POSLE postavljanja env-a i posle resolve hooka: prvi red rute je
// `import`, a on se izvršava odmah.
const ruta = await import("../src/app/api/billing/webhook/route");

/** Jedan potpisan zahtev ka pravoj ruti, nad zadatim lažnim skladištem. */
async function posalji(
  telo: unknown,
  skladiste: NaplataSkladiste,
  opcije: { tajna?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  postavi(skladiste);
  const sirovo = JSON.stringify(telo);
  const res = await ruta.POST(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "paddle-signature": potpis(sirovo, opcije.tajna ?? TAJNA),
      },
      body: sirovo,
    }),
  );
  const tekst = await res.text();
  postavi(null);

  // Odbijenice (401, 500) vraćaju goli tekst, ne JSON — v. rutu. Zato se
  // parsiranje ne sme pretpostaviti: pad na prazan objekat je tačan odgovor.
  let body: Record<string, unknown> = {};
  try {
    body = tekst ? (JSON.parse(tekst) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  return { status: res.status, body };
}

// ═══════════════════════════════════════════════════════════
// PAYLOAD-I
// ═══════════════════════════════════════════════════════════
// Oblik je Paddle-ov (snake_case iz mreže); SDK ga sam prevodi u camelCase.
//
// Cena se ne skraćuje na `{ id }` iako obrada čita samo `id`: SDK payload
// PARSIRA u svoje entitete pre nego što ga mi vidimo, a `PriceNotification`
// bezuslovno čita `unit_price` i `quantity`. Skraćen oblik zato ne pada na
// našoj proveri nego u SDK-u, i to kao `Cannot read properties of undefined` —
// greška koja ne liči ni na šta i troši pola sata.

function cena(priceId: string) {
  return {
    id: priceId,
    product_id: "pro_test_1",
    description: "Test",
    name: "Test",
    type: "standard",
    billing_cycle: { interval: "month", frequency: 1 },
    trial_period: null,
    tax_mode: "account_setting",
    unit_price: { amount: "2900", currency_code: "EUR" },
    unit_price_overrides: [],
    quantity: { minimum: 1, maximum: 1 },
    custom_data: null,
    status: "active",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    import_meta: null,
  };
}

function txnCompleted(o: {
  eventId: string;
  txnId: string;
  priceId: string;
  customData?: Record<string, unknown> | null;
  subscriptionId?: string | null;
}) {
  return {
    event_id: o.eventId,
    event_type: "transaction.completed",
    occurred_at: "2026-08-21T10:00:00Z",
    notification_id: `ntf_${o.eventId}`,
    data: {
      id: o.txnId,
      status: "completed",
      customer_id: "ctm_test_1",
      address_id: null,
      business_id: null,
      custom_data: o.customData === undefined ? { user_id: KORISNIK } : o.customData,
      currency_code: "EUR",
      origin: "web",
      subscription_id: o.subscriptionId === undefined ? "sub_test_1" : o.subscriptionId,
      invoice_id: null,
      invoice_number: null,
      collection_mode: "automatic",
      discount_id: null,
      billing_details: null,
      billing_period: { starts_at: "2026-08-21T10:00:00Z", ends_at: "2026-09-21T10:00:00Z" },
      items: [{ price: cena(o.priceId), quantity: 1 }],
      details: null,
      payments: [],
      checkout: null,
      created_at: "2026-08-21T10:00:00Z",
      updated_at: "2026-08-21T10:00:00Z",
      billed_at: "2026-08-21T10:00:00Z",
      revised_at: null,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 1. DUPLA ISPORUKA
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  const telo = txnCompleted({
    eventId: "evt_dupli",
    txnId: "txn_dupli",
    priceId: PLAN_PRICE_IDS.starter.month,
  });

  const prvi = await posalji(telo, s.skladiste);
  const drugi = await posalji(telo, s.skladiste);

  check(prvi.status === 200 && prvi.body.ok === true, "prva isporuka prolazi");
  check(drugi.status === 200 && drugi.body.duplikat === true, "druga isporuka je duplikat");
  check(s.knjiga.length === 1, "jedna stavka u knjizi posle dve isporuke");
  check(
    s.profil.balance === PLANS.starter.monthlyCredits,
    `Starter dodeljuje ${PLANS.starter.monthlyCredits} kredita tačno jednom`,
  );
}

// ═══════════════════════════════════════════════════════════
// 2. POGREŠAN POTPIS
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  const odgovor = await posalji(
    txnCompleted({
      eventId: "evt_lazan",
      txnId: "txn_lazan",
      priceId: PLAN_PRICE_IDS.pro.month,
    }),
    s.skladiste,
    { tajna: "pdl_ntfset_pogresna_tajna_00000000" },
  );

  check(odgovor.status === 401, "pogrešan potpis → 401");
  check(s.dogadjaji.size === 0, "pogrešan potpis ne upisuje događaj");
  check(s.knjiga.length === 0, "pogrešan potpis ne dodeljuje kredite");
  check(s.profil.balance === 0 && s.profil.topup === 0, "obe kase ostaju prazne");
}

// Isto i kad zaglavlja uopšte nema — bez njega nema šta da se verifikuje.
{
  const s = napraviLazno();
  postavi(s.skladiste);
  const res = await ruta.POST(
    new Request("http://localhost/api/billing/webhook", { method: "POST", body: "{}" }),
  );
  postavi(null);
  check(res.status === 401, "bez `Paddle-Signature` zaglavlja → 401");
  check(s.dogadjaji.size === 0, "zahtev bez potpisa ne upisuje događaj");
}

// ═══════════════════════════════════════════════════════════
// 3. NEMA KORISNIKA
// ═══════════════════════════════════════════════════════════
// Novac je stigao i ne zna se čiji je. Ponavljanje ne bi pomoglo, pa 200 —
// ali događaj MORA da ostane upisan i greška MORA da se vidi u odgovoru.

{
  const s = napraviLazno();
  const odgovor = await posalji(
    txnCompleted({
      eventId: "evt_bez_korisnika",
      txnId: "txn_bez_korisnika",
      priceId: PLAN_PRICE_IDS.starter.month,
      customData: null,
      subscriptionId: "sub_nepoznata",
    }),
    s.skladiste,
  );

  check(odgovor.status === 200, "bez `custom_data.user_id` ruta ne puca — 200");
  check(odgovor.body.ok === false, "odgovor javlja da radnja nije prošla");
  check(s.dogadjaji.has("evt_bez_korisnika"), "događaj je ipak upisan");
  check(s.knjiga.length === 0, "nijedan kredit nije dodeljen");
}

// ═══════════════════════════════════════════════════════════
// 4. PAKET IDE U DRUGU KASU
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  const paket = CREDIT_PACKS["dopuna-150"];
  const odgovor = await posalji(
    txnCompleted({
      eventId: "evt_paket",
      txnId: "txn_paket",
      priceId: paket.priceId,
      customData: { user_id: KORISNIK, kind: "pack" },
      // Jednokratna kupovina nema pretplatu — i ne sme da je traži.
      subscriptionId: null,
    }),
    s.skladiste,
  );

  check(odgovor.status === 200 && odgovor.body.ok === true, "paket prolazi bez pretplate");
  check(s.profil.topup === paket.credits, `paket puni credits_topup (${paket.credits})`);
  check(s.profil.balance === 0, "paket NE dira credits_balance");
  check(s.knjiga[0]?.reason === "credit_pack", "razlog u knjizi je `credit_pack`");
  check(s.pretplate.size === 0, "paket ne pravi red u `subscriptions`");
}

// ═══════════════════════════════════════════════════════════
// 5. POKUŠAJ DA SE DODELI BETA
// ═══════════════════════════════════════════════════════════
// LANSIRANJE §1.1: beta nastaje ISKLJUČIVO iz admin konzole. Nijedan potpisan
// payload to ne menja.

{
  const s = napraviLazno();
  const odgovor = await posalji(
    txnCompleted({
      eventId: "evt_beta",
      txnId: "txn_beta",
      priceId: PLAN_PRICE_IDS.advanced.month,
      customData: { user_id: KORISNIK, kind: "subscription", plan: "beta" },
    }),
    s.skladiste,
  );

  check(odgovor.status === 200, "pokušaj bete ne ruši rutu");
  check(odgovor.body.ok === false, "pokušaj bete je odbijen");
  check(s.profil.plan === "beta", "plan ostaje netaknut (nije podignut na advanced)");
  check(s.knjiga.length === 0, "odbijen događaj ne dodeljuje kredite");
  check(s.pretplate.size === 0, "odbijen događaj ne upisuje pretplatu");
}

// Isti pokušaj kroz `subscription.updated` — druga grana, isti zid.
{
  const s = napraviLazno();
  const odgovor = await posalji(
    {
      event_id: "evt_beta_sub",
      event_type: "subscription.updated",
      occurred_at: "2026-08-21T10:00:00Z",
      notification_id: "ntf_beta_sub",
      data: {
        id: "sub_test_2",
        status: "active",
        customer_id: "ctm_test_1",
        address_id: "add_test_1",
        business_id: null,
        currency_code: "EUR",
        created_at: "2026-08-21T10:00:00Z",
        updated_at: "2026-08-21T10:00:00Z",
        started_at: "2026-08-21T10:00:00Z",
        first_billed_at: "2026-08-21T10:00:00Z",
        next_billed_at: "2026-09-21T10:00:00Z",
        paused_at: null,
        canceled_at: null,
        discount: null,
        collection_mode: "automatic",
        billing_details: null,
        current_billing_period: {
          starts_at: "2026-08-21T10:00:00Z",
          ends_at: "2026-09-21T10:00:00Z",
        },
        billing_cycle: { interval: "month", frequency: 1 },
        scheduled_change: null,
        items: [{ price: cena(PLAN_PRICE_IDS.pro.month), quantity: 1, status: "active" }],
        custom_data: { user_id: KORISNIK, plan: "beta" },
        import_meta: null,
      },
    },
    s.skladiste,
  );

  check(odgovor.body.ok === false, "beta kroz `subscription.updated` je takođe odbijena");
  check(s.pretplate.size === 0, "odbijena pretplata se ne upisuje u ogledalo");
}

// ═══════════════════════════════════════════════════════════
// 6. OTKAZIVANJE NE GASI PRISTUP
// ═══════════════════════════════════════════════════════════
// LANSIRANJE §1.5: `canceled` upisuje `canceled_at`, a pristup traje do kraja
// plaćenog perioda. Nijedan kredit se ne oduzima.

{
  const s = napraviLazno();
  await posalji(
    txnCompleted({
      eventId: "evt_kupovina",
      txnId: "txn_kupovina",
      priceId: PLAN_PRICE_IDS.pro.month,
      customData: { user_id: KORISNIK, kind: "subscription" },
    }),
    s.skladiste,
  );

  const preOtkaza = s.profil.balance;

  await posalji(
    {
      event_id: "evt_otkaz",
      event_type: "subscription.canceled",
      occurred_at: "2026-08-25T10:00:00Z",
      notification_id: "ntf_otkaz",
      data: {
        id: "sub_test_1",
        status: "canceled",
        customer_id: "ctm_test_1",
        address_id: "add_test_1",
        business_id: null,
        currency_code: "EUR",
        created_at: "2026-08-21T10:00:00Z",
        updated_at: "2026-08-25T10:00:00Z",
        started_at: "2026-08-21T10:00:00Z",
        first_billed_at: "2026-08-21T10:00:00Z",
        next_billed_at: null,
        paused_at: null,
        canceled_at: "2026-08-25T10:00:00Z",
        discount: null,
        collection_mode: "automatic",
        billing_details: null,
        current_billing_period: {
          starts_at: "2026-08-21T10:00:00Z",
          ends_at: "2026-09-21T10:00:00Z",
        },
        billing_cycle: { interval: "month", frequency: 1 },
        scheduled_change: null,
        items: [{ price: cena(PLAN_PRICE_IDS.pro.month), quantity: 1, status: "active" }],
        custom_data: { user_id: KORISNIK },
        import_meta: null,
      },
    },
    s.skladiste,
  );

  check(s.pretplate.get("sub_test_1")?.status === "canceled", "otkaz je upisan u ogledalo");
  check(s.profil.balance === preOtkaza, "otkaz ne dira kredite");
  check(s.profil.plan === "pro", "otkaz ne obara plan — granicu drži `plan_expires_at`");
}

// ═══════════════════════════════════════════════════════════
// 7. POVRAĆAJ
// ═══════════════════════════════════════════════════════════
// Mora da prođe i kad su krediti potrošeni: `admin_adjust_credits` sa
// `p_kind => 'povracaj'` sme u minus (0022 §1).

{
  const s = napraviLazno();
  const paket = CREDIT_PACKS["dopuna-50"];
  await posalji(
    txnCompleted({
      eventId: "evt_paket_2",
      txnId: "txn_paket_2",
      priceId: paket.priceId,
      customData: { user_id: KORISNIK, kind: "pack" },
      subscriptionId: null,
    }),
    s.skladiste,
  );

  // Korisnik je u međuvremenu sve potrošio.
  s.profil.topup = 0;

  const adj = (eventId: string) => ({
    event_id: eventId,
    event_type: "adjustment.created",
    occurred_at: "2026-08-26T10:00:00Z",
    notification_id: `ntf_${eventId}`,
    data: {
      id: "adj_test_1",
      action: "refund",
      type: "full",
      status: "approved",
      transaction_id: "txn_paket_2",
      subscription_id: null,
      customer_id: "ctm_test_1",
      reason: "kupac se predomislio",
      credit_applied_to_balance: false,
      currency_code: "EUR",
      items: [],
      totals: {
        subtotal: "1900",
        tax: "0",
        total: "1900",
        fee: "0",
        earnings: "0",
        currency_code: "EUR",
        retained_fee: "0",
      },
      payout_totals: null,
      created_at: "2026-08-26T10:00:00Z",
      updated_at: "2026-08-26T10:00:00Z",
    },
  });

  const prvi = await posalji(adj("evt_povracaj"), s.skladiste);
  check(prvi.status === 200 && prvi.body.ok === true, "povraćaj prolazi");
  check(
    s.profil.balance === -paket.credits,
    `povraćaj prolazi i kad su krediti potrošeni (balans ${-paket.credits})`,
  );

  // Ista korekcija drugim `event_id`-jem: gruba brana ne hvata, fina mora.
  await posalji(adj("evt_povracaj_2"), s.skladiste);
  check(
    s.profil.balance === -paket.credits,
    "ponovljen povraćaj sa istim `adjustment.id` ne skida dvaput",
  );
}

// ═══════════════════════════════════════════════════════════
// 8. NEPOZNAT TIP DOGAĐAJA
// ═══════════════════════════════════════════════════════════

{
  const s = napraviLazno();
  const odgovor = await posalji(
    {
      event_id: "evt_nepoznat",
      event_type: "payout.paid",
      occurred_at: "2026-08-21T10:00:00Z",
      notification_id: "ntf_nepoznat",
      data: { id: "pay_1" },
    },
    s.skladiste,
  );

  check(odgovor.status === 200 && odgovor.body.ok === true, "nepoznat tip dobija 200");
  check(s.dogadjaji.has("evt_nepoznat"), "nepoznat tip se ipak upisuje (deduplikacija)");
  check(s.knjiga.length === 0, "nepoznat tip ne dira kredite");
}

// ═══════════════════════════════════════════════════════════
// 9. `pri_` KOJI NIJE NAŠ
// ═══════════════════════════════════════════════════════════
// Katalog je jedini izvor istine o tome koliko kredita nosi koja cena. Cena iz
// tuđeg kataloga nema odgovor na to pitanje i mora da bude odbijena, ne
// „procenjena".

{
  const s = napraviLazno();
  const odgovor = await posalji(
    txnCompleted({
      eventId: "evt_tudja_cena",
      txnId: "txn_tudja_cena",
      priceId: "pri_01xxxxxxxxxxxxxxxxxxxxxxxx",
    }),
    s.skladiste,
  );

  check(odgovor.body.ok === false, "`pri_` van kataloga je odbijen");
  check(s.knjiga.length === 0, "`pri_` van kataloga ne dodeljuje kredite");
}

// ═══════════════════════════════════════════════════════════
// 10. GRANANJE IDE PO KATALOGU
// ═══════════════════════════════════════════════════════════
// `custom_data.kind` je ukrštena provera, ne odluka: pogrešan `kind` uz ispravan
// `pri_` mora da završi tamo gde cena kaže, a ne tamo gde `custom_data` tvrdi.

{
  const s = napraviLazno();
  const paket = CREDIT_PACKS["dopuna-50"];
  await posalji(
    txnCompleted({
      eventId: "evt_kriv_kind",
      txnId: "txn_kriv_kind",
      priceId: paket.priceId,
      customData: { user_id: KORISNIK, kind: "subscription" },
      subscriptionId: null,
    }),
    s.skladiste,
  );

  check(s.profil.topup === paket.credits, "pogrešan `kind` ne odvodi paket u pogrešnu kasu");
  check(s.profil.plan === "beta", "paket ne postavlja plan");
}

// ═══════════════════════════════════════════════════════════
// 11. PROLAZNA GREŠKA SE PONAVLJA
// ═══════════════════════════════════════════════════════════
// Kad skladište baci (baza ne odgovara), ruta MORA da povuče marker i vrati 500.
// Da proguta grešku i vrati 200, Paddle bi zapamtio uspeh i dodela bi bila
// trajno izgubljena — korisnik sa naplaćenom karticom i bez kredita.

// I obratno: ista ruta na tu grešku vraća 500 i BRIŠE marker, da retry prođe.
{
  const s = napraviLazno();
  let prviPut = true;
  const nestabilno: NaplataSkladiste = {
    ...s.skladiste,
    async primeniPretplatu(a) {
      if (prviPut) {
        prviPut = false;
        throw new Error("baza ne odgovara");
      }
      return await s.skladiste.primeniPretplatu(a);
    },
  };

  const telo = txnCompleted({
    eventId: "evt_retry",
    txnId: "txn_retry",
    priceId: PLAN_PRICE_IDS.starter.month,
  });

  const pao = await posalji(telo, nestabilno);
  check(pao.status === 500, "prolazna greška → 500");
  check(!s.dogadjaji.has("evt_retry"), "marker je povučen, pa retry sme ponovo");

  const ponovljen = await posalji(telo, nestabilno);
  check(ponovljen.status === 200 && ponovljen.body.ok === true, "retry prolazi");
  check(s.profil.balance === PLANS.starter.monthlyCredits, "krediti stižu tek iz retryja");
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
