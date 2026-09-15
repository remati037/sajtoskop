// apps/web/src/lib/billing.ts
// Šta se radi na svaki Stripe događaj. Ruta je samo omotač oko ovoga.
//
// ── zašto logika NIJE u ruti ────────────────────────────────
// Ovo je novčana putanja i mora da ima testove koji rade bez mreže i bez baze
// (`apps/web/test/naplata.ts`). Zato je sve što odlučuje ovde, iza jednog
// interfejsa `NaplataSkladiste`: u produkciji ga popunjava `billing-skladiste.ts`
// nad Supabase-om (i nad Stripe-om, za tri stvari koje traže mrežu — otisak
// kartice, prekid probe i cenu sa stavke fakture), u testu mapa u memoriji. Verifikacija potpisa se u
// testu NE lažira — ona je pravi `stripe.webhooks.constructEvent` nad pravim
// `whsec_` HMAC-om.
//
// U ovom fajlu zato nema nijednog `adminSupabase()` ni `stripe()` poziva i to je
// namerno: odluka ne sme da zna kako izgleda upit koji je sprovodi.
//
// ── pravila (naplata-stripe.md §6) ──────────────────────────
// 1. Idempotencija: gruba brana je `billing_events.event_id` (ruta, pre obrade);
//    fina brana je `ref_id` u knjizi — `in_…` za mesečnu dodelu, `pi_…` za
//    paket, `trial:<user>` za probu, `expire:<sub>` za pražnjenje,
//    `povracaj:<ch_…>` / `spor:<dp_…>` za vraćen novac. Dupla
//    isporuka ne dodeljuje dvaput ni kad gruba brana zakaže.
// 2. Korisnik se nalazi iz metapodataka koje NOSI SVAKI događaj (naš checkout ih
//    upisuje, Stripe ih prepisuje na pretplatu, fakture i naplate), pa nijedan
//    događaj ne zavisi od prethodnog. Nikad po mejlu.
// 3. Redosled nije garantovan: `apply_subscription` odbija događaj stariji od
//    poslednjeg primenjenog (`stale_ignored`); `invoice.paid` ne zavisi od reda u
//    `subscriptions`; `checkout.session.completed` za pretplatu ne radi ništa
//    novčano.
// 4. `expire_subscription_credits` SAMO na `deleted`, nikad na `updated` sa
//    `canceled` — Stripe šalje `deleted` tačno jednom, na kraju perioda.
//
// ── i jedno pravilo koje je samo naše ───────────────────────
// ‼️ WEBHOOK NIKAD NE SME DA POSTAVI PLAN NA `komp`. Komp se dodeljuje
//    isključivo iz admin konzole ili pozivnicom (LANSIRANJE §1.1, odluka D1).
//    Ako takav podatak ikad stigne — događaj se odbija i loguje, ne „popravlja".

import "server-only";
import type Stripe from "stripe";
import {
  CREDIT_PACKS,
  kupovinaZaLookupKey,
  PLANS,
  TRIAL_CREDITS,
  type Ciklus,
  type PaidPlanId,
  type PaketId,
} from "@sajtoskop/shared";

// ═══════════════════════════════════════════════════════════
// TIPOVI
// ═══════════════════════════════════════════════════════════

/** Ishod jedne SQL funkcije iz migracije 0025. */
export type RpcIshod = { ok: boolean; reason: string; granted: number };

export type ArgPretplata = {
  userId: string;
  subscriptionId: string;
  customerId: string | null;
  status: Stripe.Subscription.Status;
  plan: PaidPlanId | null;
  ciklus: Ciklus | null;
  lookupKey: string | null;
  periodEnd: string | null;
  trialEnd: string | null;
  /** Izveden — `otkazKrajemPerioda()`. Samo za UI; izvor istine je `cancelAt`. */
  cancelAtPeriodEnd: boolean;
  /** Sirov Stripe `cancel_at` (0031). `null` = otkaz nije zakazan (ili je povučen). */
  cancelAt: string | null;
  /**
   * Trenutak klika na „otkaži", NE kraj pretplate — Stripe ga postavlja već pri
   * zakazivanju, dok je status `active`. Ništa iz njega ne zaključuje stanje.
   */
  canceledAt: string | null;
  /** `event.created` — brana od događaja koji stignu van reda. */
  eventCreated: string;
};

export type ArgFaktura = {
  userId: string;
  /** `in_…` — ključ idempotencije mesečne dodele. */
  invoiceId: string;
  /** Na koliko se balans POSTAVLJA (`PLANS[plan].monthlyCredits`, plan sa stavke fakture). */
  target: number;
};

/** Ono što obrada treba sa Stripe cene sa stavke fakture. */
export type CenaStavke = { lookupKey: string | null; recurring: boolean };

export type ArgProba = { userId: string; subscriptionId: string; credits: number };

export type ArgIstek = { userId: string; subscriptionId: string };

export type ArgPaket = {
  userId: string;
  credits: number;
  /** `pi_…` — ključ idempotencije paketa. */
  txnId: string;
  customerId: string | null;
};

export type ArgPovracaj = {
  userId: string;
  /** `povracaj:<ch_…>` ili `spor:<dp_…>` — tačno jedan red po refundu, bez sufiksa. */
  refId: string;
  /** Koliko kredita skinuti, pozitivno. Već srazmerno delimičnom refundu. */
  iznos: number;
  /** `topup` = paket (dopuna, pa ostatak iz balansa); `balance` = pretplata. */
  kasa: "balance" | "topup";
  /** `credit_ledger.details` — naplata, srazmera, ref-ovi dodele. */
  details: Record<string, unknown>;
};

/** Ishod `apply_refund` (0032). `skinuto` je pozitivno; za `already_applied` — ranije skinuto. */
export type IshodPovracaja = { ok: boolean; reason: string; skinuto: number };

/** Jedan red knjige koji je naplata ostavila — sirovina za povraćaj. */
export type StavkaDodele = {
  reason: string;
  delta: number;
};

/**
 * Jedan Stripe refund nad naplatom. `id` je ključ idempotencije povraćaja
 * (`povracaj:<re_…>`), `amount` je iznos BAŠ TOG refunda — ne kumulativni
 * `charge.amount_refunded`.
 */
export type StripeRefund = { id: string; amount: number; created: number; status: string | null };

/** Ono što Stripe zna o naplati iza spora — spor sam ne nosi kupca. */
export type NaplataSpora = { customerId: string | null; paymentIntentId: string | null };

/** Ono što skladište zna o kartici iza pretplate — traži mrežu (Stripe). */
export type OtisakPretplate = {
  /** `payment_method.card.fingerprint`; `null` kad kartice nema (npr. SEPA). */
  fingerprint: string | null;
  /** Pretplata je u probi — samo tada „ista kartica" znači nešto. */
  uProbi: boolean;
};

/**
 * Sve što obrada radi nad bazom (i, gde mora, nad Stripe-om). Namerno
 * uzak: svaka metoda je jedan upit ili jedan RPC, bez ijedne odluke u sebi —
 * odluke su u `obradiDogadjaj`.
 */
export interface NaplataSkladiste {
  /** `true` = red je upisan sada; `false` = već je postojao (duplikat). */
  upisiDogadjaj(e: {
    eventId: string;
    eventType: string;
    occurredAt: string | null;
  }): Promise<boolean>;
  /** Povuci marker kad obrada padne na prolaznu grešku, da Stripe sme ponovo. */
  obrisiDogadjaj(eventId: string): Promise<void>;
  profilPostoji(userId: string): Promise<boolean>;
  korisnikPoPretplati(subscriptionId: string): Promise<string | null>;
  korisnikPoKupcu(customerId: string): Promise<string | null>;
  /**
   * `price_…` → cena (Stripe poziv). Stavka fakture nosi samo ID cene, a plan se
   * čita isključivo sa fakture — nikad iz našeg ogledala. ID koga nema u mapi
   * nije cena koju razumemo.
   */
  ceneStavki(priceIds: string[]): Promise<Map<string, CenaStavke>>;
  primeniPretplatu(a: ArgPretplata): Promise<RpcIshod>;
  primeniFakturu(a: ArgFaktura): Promise<RpcIshod>;
  pocniProbu(a: ArgProba): Promise<RpcIshod>;
  istekniPretplatu(a: ArgIstek): Promise<RpcIshod>;
  primeniPaket(a: ArgPaket): Promise<RpcIshod>;
  /** `profiles.invite_id = null` — pozivnica „prvi mesec" je potrošena. */
  oznaciPozivnicuIskoriscenom(userId: string): Promise<void>;
  /** `nov` = prvi put; `vidjen` = ista kartica već stoji uz DRUGI nalog. */
  zapamtiOtisak(a: { fingerprint: string; userId: string }): Promise<"nov" | "vidjen">;
  /** Otisak kartice iza pretplate (Stripe poziv). `null` kad pretplate nema. */
  otisakKartice(subscriptionId: string): Promise<OtisakPretplate | null>;
  /** `subscriptions.update(sub, { trial_end: "now" })` — proba se odmah pretvara u naplatu. */
  naplatiProbuOdmah(subscriptionId: string): Promise<void>;
  /** Kupac i payment_intent naplate (Stripe poziv). `null` kad naplata ne postoji. */
  naplata(chargeId: string): Promise<NaplataSpora | null>;
  /** `in_…` fakture koje je ovo plaćanje platilo (Stripe poziv, `invoicePayments`). */
  faktureZaPlacanje(paymentIntentId: string): Promise<string[]>;
  /**
   * Refundi nad naplatom (Stripe poziv, `refunds.list`), najstariji prvi.
   *
   * `charge.refunded` u `data.object` nosi naplatu, a lista `charge.refunds` ume
   * da bude skraćena ili neekspandovana — zato zaseban, deterministički poziv.
   */
  refundiNaplate(chargeId: string): Promise<StripeRefund[]>;
  /** Redovi knjige pod ovim ref-ovima (`in_…`, `pi_…`) — iznos računa `dodeljenoZaTransakciju`. */
  dodeleZaTransakciju(userId: string, refIds: string[]): Promise<StavkaDodele[]>;
  /** `apply_refund` (0032) — jedini put kojim naplata skida kredite. */
  primeniPovracaj(a: ArgPovracaj): Promise<IshodPovracaja>;
}

/**
 * Ishod obrade jednog događaja.
 *
 * `ok: false` znači TRAJAN neuspeh — takav se loguje i dobija 200, jer ga
 * ponavljanje neće popraviti: sto ponovljenih isporuka ne pravi profil koji ne
 * postoji, niti čini ključ iz tuđeg kataloga našim.
 *
 * PROLAZAN neuspeh (baza ne odgovara, RPC pukne) ovuda uopšte ne prolazi —
 * skladište baca, ruta hvata, briše marker i vraća 500 da Stripe pokuša opet.
 */
export type Ishod = {
  ok: boolean;
  radnja: string;
  greska?: string;
};

/** Podešavanja koja obrada ne sme da čita sama iz env-a (test ih prosleđuje). */
export type NaplataOpcije = {
  /** ID kupona „prvi mesec gratis" — samo za prepoznavanje gratis fakture. */
  kuponPrvogMeseca?: string | null;
};

// ═══════════════════════════════════════════════════════════
// POMOĆNE ODLUKE
// ═══════════════════════════════════════════════════════════

/** Planovi koji smeju da nastanu iz naplate. `komp` i `dopuna` nisu među njima. */
const PLACENI_PLANOVI: readonly string[] = ["starter", "pro", "advanced"];

/** Fakture koje nose mesečnu dodelu (§6.1). Sve ostalo (npr. `manual`) se preskače. */
const RAZLOZI_DODELE: readonly string[] = [
  "subscription_create",
  "subscription_cycle",
  "subscription_update",
];

type Meta = Stripe.Metadata | Record<string, string> | null | undefined;

function tekst(meta: Meta, kljuc: string): string | null {
  const v = meta?.[kljuc];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Unix sekunde → ISO, ili `null`. */
function iso(sekunde: number | null | undefined): string | null {
  return typeof sekunde === "number" ? new Date(sekunde * 1000).toISOString() : null;
}

/**
 * Da li je otkaz zakazan za kraj TEKUĆEG perioda (0031).
 *
 * Na `2026-08-26.dahlia` portal otkaz šalje kao `cancel_at = current_period_end`
 * i `cancel_at_period_end = false`; stariji objekti nose `cancel_at_period_end =
 * true`. Prihvataju se oba. `cancel_at` posle kraja perioda (zakazan kroz API
 * za neku kasniju obnovu) NIJE „kraj perioda" — upisuje se, ali zastavica ostaje
 * `false`. Bez poznatog kraja perioda nema poređenja, pa `cancel_at` sam znači da.
 */
export function otkazKrajemPerioda(
  sub: { cancel_at?: number | null; cancel_at_period_end?: boolean | null },
  periodEnd: number | null,
): boolean {
  if (sub.cancel_at_period_end === true) return true;
  if (typeof sub.cancel_at !== "number") return false;
  return periodEnd === null || sub.cancel_at <= periodEnd;
}

/** `string | { id }` → `string | null`. Stripe polja su ID ili proširen objekat. */
function id(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

/**
 * Pokušaj da webhook postavi plan koji naplata ne sme da dodeli.
 *
 * `metadata.plan` upisuje naš checkout i tamo je uvek plaćen plan — ali ume da
 * stigne iz pretplate napravljene ručno u Stripe panelu. Odgovor je odbijanje
 * celog događaja, ne ignorisanje polja: podatak koji tvrdi nešto što nam nije
 * dozvoljeno je podatak koji ne razumemo.
 */
function kompPokusaj(meta: Meta): string | null {
  const plan = tekst(meta, "plan");
  if (plan && !PLACENI_PLANOVI.includes(plan)) return plan;
  return null;
}

/**
 * Ko je kupac, u tri koraka (naplata-stripe.md §6.3).
 *
 * 1. `metadata.user_id` / `client_reference_id` — naš checkout ih uvek upisuje
 *    i Stripe ih prepisuje na sve buduće događaje te pretplate.
 * 2. `subscriptions.stripe_subscription_id` u našoj tabeli.
 * 3. `profiles.stripe_customer_id` — poslednja mreža; radi za sve, jer customer
 *    nastaje u našoj ruti PRE sesije.
 *
 * Mejla nema ni u jednom koraku i neće ga biti.
 */
async function nadjiKorisnika(
  s: NaplataSkladiste,
  izvori: { kandidati?: (string | null)[]; subscriptionId?: string | null; customerId?: string | null },
): Promise<string | null> {
  for (const k of izvori.kandidati ?? []) {
    if (k && (await s.profilPostoji(k))) return k;
  }

  if (izvori.subscriptionId) {
    const izPretplate = await s.korisnikPoPretplati(izvori.subscriptionId);
    if (izPretplate) return izPretplate;
  }

  if (izvori.customerId) {
    const izKupca = await s.korisnikPoKupcu(izvori.customerId);
    if (izKupca) return izKupca;
  }

  return null;
}

/**
 * ID pretplate sa fakture — dva oblika, po verziji API-ja (§6.3):
 * `invoice.parent.subscription_details.subscription` (2025-03-31+) ili
 * `invoice.subscription` (stariji).
 */
export function subIdIzFakture(inv: Stripe.Invoice): string | null {
  const novi = inv.parent?.subscription_details?.subscription;
  if (novi) return id(novi);
  const stari = (inv as unknown as { subscription?: string | { id: string } | null }).subscription;
  return id(stari);
}

/** Metapodaci pretplate snimljeni na fakturi — oba oblika. */
function metaIzFakture(inv: Stripe.Invoice): Meta {
  const novi = inv.parent?.subscription_details?.metadata;
  if (novi) return novi;
  const stari = (inv as unknown as { subscription_details?: { metadata?: Meta } | null })
    .subscription_details;
  return stari?.metadata ?? null;
}

/** Stavka fakture svedena na ono što odlučuje o planu. */
type StavkaFakture = {
  /** Proširena cena, ili goli `price_…` ID koji skladište tek treba da razreši. */
  cena: CenaStavke | string | null;
  proracija: boolean;
  iznos: number;
};

/**
 * Stavka u oba oblika: `pricing.price_details.price` + `parent.*.proration`
 * (2025-03-31+) ili `price` + `proration` (stariji API).
 */
function stavkaIzLinije(linija: Stripe.InvoiceLineItem): StavkaFakture {
  const stara = linija as unknown as { price?: Stripe.Price | null; proration?: boolean };
  const p = linija.pricing?.price_details?.price ?? stara.price ?? null;
  return {
    cena:
      typeof p === "string" || p === null
        ? p
        : { lookupKey: p.lookup_key ?? null, recurring: p.recurring !== null },
    proracija:
      linija.parent?.subscription_item_details?.proration ??
      linija.parent?.invoice_item_details?.proration ??
      stara.proration ??
      false,
    iznos: linija.amount ?? 0,
  };
}

/**
 * Koji plan faktura plaća — ISKLJUČIVO sa stavki same fakture.
 *
 * Ni `profiles.plan`, ni `subscriptions.plan`, ni metapodaci pretplate. Kod
 * downgrade-a na kraju perioda Stripe pravi subscription schedule, pa
 * `invoice.paid` (`subscription_cycle`, već po novoj ceni) i
 * `customer.subscription.updated` (novi `lookup_key`) stižu van reda. Ako
 * faktura stigne prva, ogledalo još drži stari plan — korisnik bi platio
 * Starter a dobio Pro kredite. Metapodaci su još gori: to je snimak iz
 * checkout-a i portal ih nikad ne menja. Faktura je jedino mesto koje zna šta
 * je stvarno plaćeno.
 *
 * Na pinovanoj verziji stavka nosi samo `price_…` ID, bez `lookup_key` i bez
 * `recurring` — zato `s.ceneStavki`.
 *
 * Izbor stavke: ponavljajuća cena iz našeg kataloga. Proracija (upgrade) daje
 * stavke obe cene — kredit za neiskorišćen stari plan i doplatu za novi — pa
 * se prvo traži redovna stavka, a tek ako je nema (`always_invoice`),
 * pozitivna proraciona. Dva različita plana na istom nivou = ne zna se → `null`.
 */
async function planIzFakture(inv: Stripe.Invoice, s: NaplataSkladiste): Promise<PaidPlanId | null> {
  const stavke = (inv.lines?.data ?? []).map(stavkaIzLinije);

  const ids = [...new Set(stavke.flatMap((x) => (typeof x.cena === "string" ? [x.cena] : [])))];
  const cene = ids.length > 0 ? await s.ceneStavki(ids) : new Map<string, CenaStavke>();

  const nase = stavke.flatMap((x) => {
    const c = typeof x.cena === "string" ? cene.get(x.cena) : x.cena;
    if (!c?.recurring) return [];
    const k = kupovinaZaLookupKey(c.lookupKey);
    return k?.kind === "subscription" ? [{ plan: k.plan, proracija: x.proracija, iznos: x.iznos }] : [];
  });

  const redovne = nase.filter((x) => !x.proracija);
  const izbor = redovne.length > 0 ? redovne : nase.filter((x) => x.iznos > 0);
  const planovi = new Set(izbor.map((x) => x.plan));
  return planovi.size === 1 ? [...planovi][0]! : null;
}

/**
 * Gratis mesec (pozivnica): `amount_due = 0`, ali JESTE plaćen period i dobija
 * kredite — za razliku od probe, koja isto ima 0 € ali nema popust.
 */
function gratisMesec(inv: Stripe.Invoice, kupon: string | null | undefined): boolean {
  if ((inv.total_discount_amounts ?? []).some((d) => d.amount > 0)) return true;
  for (const d of inv.discounts ?? []) {
    if (typeof d === "string") return true;
    const c = (d as { coupon?: string | { id: string } | null }).coupon;
    const cid = id(c);
    if (cid && (!kupon || cid === kupon)) return true;
  }
  return false;
}

/** Stripe status → ono što `subscriptions_status_valid` prima. Isti spisak. */
const STATUSI: readonly string[] = [
  "trialing", "active", "past_due", "canceled", "unpaid",
  "incomplete", "incomplete_expired", "paused",
];

// ═══════════════════════════════════════════════════════════
// OBRADA
// ═══════════════════════════════════════════════════════════

/**
 * Jedan verifikovan događaj → jedna izmena u bazi.
 *
 * Ruta je ovo već potpisom autentikovala i već je upisala `billing_events`
 * (i stala ako je bio duplikat). Ovde se samo grana.
 */
export async function obradiDogadjaj(
  dogadjaj: Stripe.Event,
  s: NaplataSkladiste,
  opcije: NaplataOpcije = {},
): Promise<Ishod> {
  switch (dogadjaj.type) {
    case "checkout.session.completed":
      return await zavrsenaSesija(dogadjaj.data.object, s);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return await stanjePretplate(dogadjaj.type, dogadjaj.data.object, dogadjaj.created, s);

    case "invoice.paid":
      return await placenaFaktura(dogadjaj.data.object, s, opcije);

    case "invoice.payment_failed": {
      // Ništa u kreditima: `subscription.updated` stiže sa `past_due`, a kapija
      // iz `plan_expires_at` sama spusti nalog u grace (§7.5). Mejl je P4.
      const inv = dogadjaj.data.object;
      console.warn(`[stripe-webhook] naplata pala: ${inv.id} (${subIdIzFakture(inv) ?? "bez pretplate"})`);
      return { ok: true, radnja: `naplata pala:${inv.id}` };
    }

    case "charge.refunded":
      return await povracaj(dogadjaj.data.object, s);

    case "charge.dispute.created": {
      // Samo log (i mejl adminu, P4). Krediti se ne diraju dok Stripe ne odluči.
      const d = dogadjaj.data.object;
      console.warn(`[stripe-webhook] SPOR otvoren: ${d.id} nad ${id(d.charge)} (${d.amount} ${d.currency})`);
      return { ok: true, radnja: `spor otvoren:${d.id}` };
    }

    case "charge.dispute.closed": {
      const d = dogadjaj.data.object;
      if (d.status !== "lost") return { ok: true, radnja: `spor zatvoren:${d.status}` };
      return await izgubljenSpor(d, s);
    }

    default:
      // Nepoznat tip je uredno stanje, ne kvar: endpoint prima tačno nabrojane
      // događaje (§6.1), ali spisak u panelu ume da se proširi. Upisan je i time
      // deduplikovan; ništa drugo se ne radi.
      return { ok: true, radnja: `preskočeno:${dogadjaj.type}` };
  }
}

/**
 * `checkout.session.completed` — dva slučaja po `mode`:
 *
 *   payment       paket kredita: `apply_credit_pack(ref = payment_intent)`.
 *                 Jedini novčani posao ovog događaja.
 *   subscription  NIŠTA novčano — pretplatu i kredite donose
 *                 `customer.subscription.*` i `invoice.paid`. Ovde se samo
 *                 označava potrošena pozivnica i pamti otisak kartice (§7.6).
 */
async function zavrsenaSesija(
  sesija: Stripe.Checkout.Session,
  s: NaplataSkladiste,
): Promise<Ishod> {
  const customerId = id(sesija.customer);
  const userId = await nadjiKorisnika(s, {
    kandidati: [sesija.client_reference_id, tekst(sesija.metadata, "user_id")],
    subscriptionId: id(sesija.subscription),
    customerId,
  });
  if (!userId) {
    // Novac je stigao i ne zna se čiji je. Ponavljanje ne pomaže — 200, pa u log.
    return {
      ok: false,
      radnja: "checkout.session.completed",
      greska: `sesija ${sesija.id} nije vezana ni za jedan profil`,
    };
  }

  if (sesija.mode === "payment") {
    // Grananje po KATALOGU: `metadata.paket` je naš slug, a broj kredita zna
    // samo `plans.ts`. `metadata.credits` je tu radi čitljivosti u panelu i ne
    // odlučuje ništa.
    const paket = tekst(sesija.metadata, "paket");
    const opis = paket && paket in CREDIT_PACKS ? CREDIT_PACKS[paket as PaketId] : null;
    if (!opis) {
      return { ok: false, radnja: "paket", greska: `sesija ${sesija.id}: paket van kataloga (${paket ?? "—"})` };
    }

    const pi = id(sesija.payment_intent);
    if (!pi) {
      return { ok: false, radnja: "paket", greska: `sesija ${sesija.id} nema payment_intent` };
    }

    const r = await s.primeniPaket({ userId, credits: opis.credits, txnId: pi, customerId });
    return r.ok ? { ok: true, radnja: `paket:${r.reason}` } : { ok: false, radnja: "paket", greska: r.reason };
  }

  if (sesija.mode !== "subscription") {
    return { ok: true, radnja: `preskočeno:checkout.${sesija.mode}` };
  }

  // Pozivnica „prvi mesec" je potrošena čim je sesija završena — kupon je već
  // na pretplati, a drugi checkout ne sme da ga dobije ponovo.
  await s.oznaciPozivnicuIskoriscenom(userId);

  // Ponovljena proba (§7.6): ista kartica na drugom nalogu → proba se odmah
  // pretvara u naplatu. Jeftino, jedna tabela; pad ovog koraka NE obara
  // događaj — pretplata je ionako već upisana kroz svoj događaj.
  const subId = id(sesija.subscription);
  if (subId) {
    const otisak = await s.otisakKartice(subId);
    if (otisak?.fingerprint && otisak.uProbi) {
      const ishod = await s.zapamtiOtisak({ fingerprint: otisak.fingerprint, userId });
      if (ishod === "vidjen") {
        await s.naplatiProbuOdmah(subId);
        return { ok: true, radnja: "pretplata: ponovljena proba → naplata odmah" };
      }
    }
  }

  return { ok: true, radnja: "pretplata: sesija bez dodele" };
}

/**
 * Svi `customer.subscription.*` događaji idu kroz jednu granu, jer i rade jednu
 * stvar: osvežavaju ogledalo. Nijedan ne dodeljuje kredite plana — dodela visi o
 * naplati, a naplata je `invoice.paid`. Dva izuzetka su probni krediti na
 * `created` sa `trialing` (§7.2) i pražnjenje kase na `deleted` (§6.4).
 */
async function stanjePretplate(
  tip: string,
  sub: Stripe.Subscription,
  created: number,
  s: NaplataSkladiste,
): Promise<Ishod> {
  const komp = kompPokusaj(sub.metadata);
  if (komp) {
    return {
      ok: false,
      radnja: tip,
      greska: `webhook je pokušao plan \`${komp}\` — komp i dopuna se dodeljuju samo iz konzole`,
    };
  }

  if (!STATUSI.includes(sub.status)) {
    return { ok: false, radnja: tip, greska: `nepoznat status \`${sub.status}\`` };
  }

  const customerId = id(sub.customer);
  const userId = await nadjiKorisnika(s, {
    kandidati: [tekst(sub.metadata, "user_id")],
    subscriptionId: sub.id,
    customerId,
  });
  if (!userId) {
    return { ok: false, radnja: tip, greska: `pretplata ${sub.id} nije vezana ni za jedan profil` };
  }

  const item = sub.items?.data?.[0];
  const lookupKey = item?.price?.lookup_key ?? null;
  const kupovina = kupovinaZaLookupKey(lookupKey);
  // `null` plan znači „ne diraj postojeći" — `apply_subscription` ga uzima kroz
  // `coalesce`. Tako promena kartice na pretplati sa cenom koju ne prepoznajemo
  // ne obara plan koji korisnik već ima.
  const plan = kupovina?.kind === "subscription" ? kupovina.plan : null;
  const ciklus = kupovina?.kind === "subscription" ? kupovina.ciklus : null;

  // `current_period_end` je na STAVCI (2025-03-31+) ili na pretplati (stariji API).
  const periodEnd =
    (item as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    null;

  const r = await s.primeniPretplatu({
    userId,
    subscriptionId: sub.id,
    customerId,
    status: sub.status,
    plan,
    ciklus,
    lookupKey,
    periodEnd: iso(periodEnd),
    trialEnd: iso(sub.trial_end),
    cancelAtPeriodEnd: otkazKrajemPerioda(sub, periodEnd),
    cancelAt: iso(sub.cancel_at),
    canceledAt: iso(sub.canceled_at),
    eventCreated: new Date(created * 1000).toISOString(),
  });
  if (!r.ok) return { ok: false, radnja: tip, greska: r.reason };

  let dodatak = "";

  // Dan 0 probe: 10 kredita, jednom po NALOGU (`trial:<user>`), nikad drugi put.
  if (tip === "customer.subscription.created" && sub.status === "trialing") {
    const p = await s.pocniProbu({ userId, subscriptionId: sub.id, credits: TRIAL_CREDITS });
    if (!p.ok) return { ok: false, radnja: "proba", greska: p.reason };
    dodatak += `, proba:${p.reason}`;
  }

  // Kraj pretplate: kasa koja ističe se prazni. SAMO ovde, nikad na `updated`
  // sa `canceled` — Stripe šalje `deleted` tačno jednom, na kraju perioda.
  if (tip === "customer.subscription.deleted") {
    const e = await s.istekniPretplatu({ userId, subscriptionId: sub.id });
    if (!e.ok) return { ok: false, radnja: "istek", greska: e.reason };
    dodatak += `, istek:${e.reason}`;
  }

  return { ok: true, radnja: `${tip}:${r.reason}${dodatak}` };
}

/**
 * `invoice.paid` — JEDINI događaj koji dodeljuje kredite plana (§6.1, §10).
 *
 * Balans se POSTAVLJA na mesečni broj (bez rollovera), ključ je `in_…`. Samo
 * `subscription_create` / `subscription_cycle` / `subscription_update`;
 * mesečni ciklus, ili prva faktura godišnjeg (ostalih 11 daje worker).
 *
 * Proba: prva faktura je 0 €, `subscription_create` — NE dodeljuje plan
 * kredite; proba ima svojih 10 iz `TRIAL_STARTED`. Dodela stiže osmog dana kao
 * `subscription_cycle`. Gratis mesec (pozivnica) isto ima 0 €, ali JESTE plaćen
 * period i dobija kredite — razliku pravi popust na fakturi.
 */
async function placenaFaktura(
  inv: Stripe.Invoice,
  s: NaplataSkladiste,
  opcije: NaplataOpcije,
): Promise<Ishod> {
  if (!RAZLOZI_DODELE.includes(inv.billing_reason ?? "")) {
    return { ok: true, radnja: `faktura bez dodele:${inv.billing_reason ?? "?"}` };
  }
  if (inv.amount_due < 0) {
    return { ok: true, radnja: "faktura bez dodele:negativan iznos" };
  }
  if (
    inv.billing_reason === "subscription_create" &&
    inv.amount_due === 0 &&
    !gratisMesec(inv, opcije.kuponPrvogMeseca)
  ) {
    return { ok: true, radnja: "proba počela, bez dodele" };
  }

  const subId = subIdIzFakture(inv);
  const customerId = id(inv.customer);
  const userId = await nadjiKorisnika(s, {
    kandidati: [tekst(metaIzFakture(inv), "user_id"), tekst(inv.metadata, "user_id")],
    subscriptionId: subId,
    customerId,
  });
  if (!userId) {
    return { ok: false, radnja: "invoice.paid", greska: `faktura ${inv.id} nije vezana ni za jedan profil` };
  }

  const plan = await planIzFakture(inv, s);
  if (!plan) {
    // Faktura koja ne plaća jedan prepoznat plan (ručna stavka, tuđa cena) —
    // uredno stanje, ne kvar: ništa se ne dodeljuje i ponavljanje ne pomaže.
    console.warn(`[stripe-webhook] faktura ${inv.id}: nijedna stavka nije plan iz našeg kataloga — bez dodele`);
    return { ok: true, radnja: "preskočeno:faktura van kataloga" };
  }

  const r = await s.primeniFakturu({ userId, invoiceId: inv.id, target: PLANS[plan].monthlyCredits });
  return r.ok
    ? { ok: true, radnja: `faktura:${r.reason}` }
    : { ok: false, radnja: "invoice.paid", greska: r.reason };
}

/**
/**
 * `charge.refunded` — jedini put kojim krediti idu NANIŽE iz naplate (uz
 * izgubljen spor).
 *
 * Skida se TAČNO ono što je vraćena transakcija upisala u knjigu: suma `delta`
 * redova pod `in_…` / `pi_…` te naplate (`dodeljenoZaTransakciju`). Nikad iz
 * `plans.ts` i nikad iz `balance_after` — kod proracije iznos u parama i broj
 * kredita nisu u srazmeri (Pro → Advanced usred perioda: €59.41, +750).
 *
 * ── ključ je REFUND, ne naplata (0033) ────────────────────
 * Jedan `re_…` = jedan red `povracaj:<re_…>`, sa srazmerom `refund.amount /
 * charge.amount`. Retry iste isporuke nosi isti `re_…` i pada na unique indeks;
 * dva delimična refunda iste naplate su dva `re_…` i oba prolaze. Zato se ni ne
 * gleda kumulativni `charge.amount_refunded`.
 *
 * Događaj je okidač, a ne spisak posla: prolazi se kroz SVE refunde naplate i
 * svaki koji još nije u knjizi se primenjuje. `refunds.list` je deterministički
 * izvor (lista na samoj naplati ume da bude skraćena), a već primenjeni refund
 * vraća `already_applied`, pa je ponavljanje besplatno. Time ni refund koji je
 * nastao dok je prethodni događaj još čekao ne ostane nepokriven.
 */
async function povracaj(charge: Stripe.Charge, s: NaplataSkladiste): Promise<Ishod> {
  const refundi = (await s.refundiNaplate(charge.id))
    // `failed` / `canceled` refund nije vraćen novac.
    .filter((r) => r.status === null || !["failed", "canceled"].includes(r.status))
    .sort((a, b) => a.created - b.created);

  if (refundi.length === 0) {
    console.warn(`[stripe-webhook] ${charge.id}: refunds.list bez ijednog refunda — ništa se ne skida`);
    return { ok: true, radnja: "preskočeno:nema_refunda" };
  }

  const staraFaktura = id((charge as unknown as { invoice?: string | { id: string } | null }).invoice);
  const refKandidati = await refoviNaplate(s, staraFaktura, id(charge.payment_intent));
  const customerId = id(charge.customer);

  const radnje: string[] = [];
  for (const refund of refundi) {
    const ishod = await skiniDodeljeno(
      s,
      {
        customerId,
        chargeId: charge.id,
        refKandidati,
        // Srazmera JEDNOG refunda, nikad kumulativni `amount_refunded`.
        srazmera: { vraceno: refund.amount, ukupno: charge.amount },
      },
      `povracaj:${refund.id}`,
      { naplata: charge.id, refund: refund.id, iznos: charge.amount, vraceno: refund.amount },
    );
    // Trajan neuspeh jednog refunda obara ceo događaj: ostatak je već primenjen i
    // idempotentan, pa ponovljena isporuka nastavlja odakle je stalo.
    if (!ishod.ok) return ishod;
    radnje.push(`${refund.id}: ${ishod.radnja}`);
  }

  return { ok: true, radnja: radnje.join(" · ") };
}

/**
 * `charge.dispute.closed` sa `lost` — novac je otišao, kao pun povraćaj.
 *
 * Spor ne nosi kupca, pa se naplata čita sa Stripe-a. Do 0030 se ovde slalo
 * `customerId: null` i bez ijednog ref-a, pa izgubljen spor nikad nije našao
 * korisnika i nije skinuo nijedan kredit.
 */
async function izgubljenSpor(d: Stripe.Dispute, s: NaplataSkladiste): Promise<Ishod> {
  const chargeId = id(d.charge);
  const naplata = chargeId ? await s.naplata(chargeId) : null;
  if (!chargeId || !naplata) {
    return { ok: false, radnja: "spor", greska: `spor ${d.id}: naplata ${chargeId ?? "—"} nije pronađena` };
  }

  const pi = id(d.payment_intent) ?? naplata.paymentIntentId;
  return await skiniDodeljeno(
    s,
    // Spor nije refund i nema `re_…`; ključ ostaje `spor:<dp_…>`, iznos je pun.
    { customerId: naplata.customerId, chargeId, refKandidati: await refoviNaplate(s, null, pi), srazmera: PUN_POVRACAJ },
    `spor:${d.id}`,
    { spor: d.id, naplata: chargeId },
  );
}

/**
 * Ref-ovi pod kojima je naplata mogla da dodeli kredite: `in_…` i `pi_…`.
 *
 * Na pinovanoj `dahlia` ni naplata ni `PaymentIntent` NEMAJU polje `invoice`
 * (uklonjeno 2025-03-31, uz delimična plaćanja faktura) — veza plaćanje →
 * faktura je `InvoicePayment`. Stari oblik `charge.invoice` se čita kad
 * postoji, bez Stripe poziva.
 */
async function refoviNaplate(
  s: NaplataSkladiste,
  staraFaktura: string | null,
  paymentIntentId: string | null,
): Promise<string[]> {
  const fakture = staraFaktura
    ? [staraFaktura]
    : paymentIntentId
      ? await s.faktureZaPlacanje(paymentIntentId)
      : [];
  return [...new Set([...fakture, ...(paymentIntentId ? [paymentIntentId] : [])])];
}

/** Koliko je novca vraćeno od koliko naplaćenog, u najmanjoj jedinici valute. */
export type Srazmera = { vraceno: number; ukupno: number };

const PUN_POVRACAJ: Srazmera = { vraceno: 1, ukupno: 1 };

/**
 * Šta je transakcija upisala u knjigu, po kasi — suma `delta`, bez ijedne
 * izvedene vrednosti.
 *
 * `credit_pack` je puni dopunu; sve ostalo (`monthly_grant`,
 * `subscription_grant`) kasu koja ističe. Suma sme da bude i negativna: dodela
 * POSTAVLJA balans, pa faktura downgrade-a (600 → 150) ima deltu −450 — tada
 * povraćaj nema šta da skine.
 */
export function dodeljenoZaTransakciju(stavke: StavkaDodele[]): { balance: number; topup: number } {
  return stavke.reduce(
    (zbir, st) =>
      st.reason === "credit_pack"
        ? { ...zbir, topup: zbir.topup + st.delta }
        : { ...zbir, balance: zbir.balance + st.delta },
    { balance: 0, topup: 0 },
  );
}

/** Deo dodele koji odgovara vraćenom novcu, zaokružen nadole. Pun refund = cela dodela. */
export function zaSkidanje(dodeljeno: number, sr: Srazmera): number {
  if (dodeljeno <= 0 || sr.ukupno <= 0 || sr.vraceno <= 0) return 0;
  if (sr.vraceno >= sr.ukupno) return dodeljeno;
  return Math.floor((dodeljeno * sr.vraceno) / sr.ukupno);
}

/** Zajednički deo povraćaja i izgubljenog spora: nađi korisnika, izračunaj, skini jednim redom. */
async function skiniDodeljeno(
  s: NaplataSkladiste,
  izvor: { customerId: string | null; chargeId: string | null; refKandidati: string[]; srazmera: Srazmera },
  refId: string,
  details: Record<string, unknown>,
): Promise<Ishod> {
  const refovi = izvor.refKandidati;
  const userId = await nadjiKorisnika(s, { customerId: izvor.customerId });
  if (!userId) {
    return { ok: false, radnja: "povraćaj", greska: `${izvor.chargeId ?? refId} nije vezan ni za jedan profil` };
  }

  const stavke = refovi.length > 0 ? await s.dodeleZaTransakciju(userId, refovi) : [];
  if (stavke.length === 0) {
    // Naplata koja nikad nije upisala kredite (proba od 0 €, faktura van
    // kataloga). Nema šta da se vrati i to nije greška — ni fallback na plan.
    console.warn(`[stripe-webhook] ${refId}: nema dodele pod ${refovi.join(", ") || "—"} — ništa se ne skida`);
    return { ok: true, radnja: "preskočeno:nema_dodele" };
  }

  const dodela = dodeljenoZaTransakciju(stavke);
  if (dodela.balance !== 0 && dodela.topup !== 0) {
    // Jedno plaćanje plaća ili fakturu ili paket. Oba odjednom znači podatak
    // koji ne razumemo, a jedan red po refundu ne može da nosi dve kase.
    return { ok: false, radnja: "povraćaj", greska: `${refId}: ista naplata je dala i pretplatu i paket — ručno` };
  }

  const kasa = dodela.topup !== 0 ? "topup" : "balance";
  const dodeljeno = kasa === "topup" ? dodela.topup : dodela.balance;
  if (dodeljeno <= 0) {
    console.warn(`[stripe-webhook] ${refId}: dodela ${dodeljeno} (npr. downgrade) — ništa se ne skida`);
    return { ok: true, radnja: `preskočeno:dodela ${dodeljeno}` };
  }

  const iznos = zaSkidanje(dodeljeno, izvor.srazmera);
  if (iznos <= 0) {
    return { ok: true, radnja: "preskočeno:delimičan povraćaj manji od kredita" };
  }

  const r = await s.primeniPovracaj({
    userId,
    refId,
    iznos,
    kasa,
    details: { ...details, refovi, dodeljeno },
  });
  if (!r.ok) return { ok: false, radnja: "povraćaj", greska: r.reason };

  if (r.reason === "already_applied") {
    // Od 0033 je ključ sam refund, pa je ovo uvek ponovljena isporuka istog
    // refunda — ne drugi delimičan refund nad istom naplatom.
    return { ok: true, radnja: "povraćaj:already_applied" };
  }
  if (r.reason === "na_podu") {
    return { ok: true, radnja: `povraćaj -0 od ${iznos}, balans je na podu` };
  }
  return {
    ok: true,
    radnja: r.reason === "odseceno" ? `povraćaj -${r.skinuto} od ${iznos}, odsečeno na pod` : `povraćaj -${r.skinuto}`,
  };
}
