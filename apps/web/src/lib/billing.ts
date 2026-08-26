// apps/web/src/lib/billing.ts
// Šta se radi na svaki Paddle događaj. Ruta je samo omotač oko ovoga.
//
// ── zašto logika NIJE u ruti ────────────────────────────────
// Ovo je novčana putanja i mora da ima testove koji rade bez mreže i bez baze
// (`apps/web/test/naplata.ts`). Zato je sve što odlučuje ovde, iza jednog
// interfejsa `NaplataSkladiste`: u produkciji ga popunjava `billing-skladiste.ts`
// nad Supabase-om, u testu mapa u memoriji. Verifikacija potpisa se u testu NE
// lažira — ona je pravi `paddle.webhooks.unmarshal` nad pravim HMAC-om.
//
// U ovom fajlu zato nema nijednog `adminSupabase()` poziva i to je namerno:
// odluka ne sme da zna kako izgleda upit koji je sprovodi.
//
// ── pet pravila iz docs/naplata-paddle.md §5.3 ──────────────
// 1. Idempotencija: prvo upis u `billing_events` po `event_id`, pa obrada.
//    Fina brana ispod toga je `ref_id` (Paddle transaction ID) u knjizi, pa
//    dupla dodela ne može ni kad gruba brana zakaže.
// 2. Vezivanje po `custom_data.user_id`, NIKAD po mejlu — kupac često plati sa
//    druge adrese nego što se registrovao.
// 3. Potpis se verifikuje uvek, i u sandboxu (to radi ruta, pre poziva ovamo).
// 4. `user_id` nikad iz tela zahteva ka nama — ovde dolazi iz Paddle-ovog
//    potpisanog payload-a, što je nešto treće i jedini razlog zašto sme.
// 5. Mesečna dodela ostaje idempotentna po transakciji (`p_txn_id`).
//
// ── i jedno pravilo koje je samo naše ───────────────────────
// ‼️ WEBHOOK NIKAD NE SME DA POSTAVI PLAN NA `beta`. Beta se dodeljuje
//    isključivo iz admin konzole (LANSIRANJE §1.1, odluka D1). Ako takav podatak
//    ikad stigne — događaj se odbija i loguje, ne „popravlja".

import "server-only";
import { kupovinaZaPriceId, type PaidPlanId } from "@sajtoskop/shared";
import type { EventEntity } from "@paddle/paddle-node-sdk";

// ═══════════════════════════════════════════════════════════
// TIPOVI
// ═══════════════════════════════════════════════════════════

/** Ishod jedne SQL funkcije iz migracije 0022. */
export type RpcIshod = { ok: boolean; reason: string; granted: number };

export type ArgPretplata = {
  userId: string;
  subscriptionId: string;
  customerId: string | null;
  status: "active" | "trialing" | "past_due" | "paused" | "canceled";
  priceId: string | null;
  plan: PaidPlanId | null;
  periodEnd: string | null;
  credits: number;
  txnId: string | null;
  canceledAt: string | null;
};

export type ArgPaket = {
  userId: string;
  credits: number;
  txnId: string;
  customerId: string | null;
};

export type ArgKorekcija = {
  userId: string;
  delta: number;
  note: string;
  refId: string;
};

/**
 * Sve što obrada radi nad bazom. Namerno uzak: svaka metoda je jedan upit ili
 * jedan RPC, bez ijedne odluke u sebi — odluke su u `obradiDogadjaj`.
 */
export interface NaplataSkladiste {
  /** `true` = red je upisan sada; `false` = već je postojao (duplikat). */
  upisiDogadjaj(e: {
    eventId: string;
    eventType: string;
    occurredAt: string | null;
  }): Promise<boolean>;
  /** Povuci marker kad obrada padne na prolaznu grešku, da Paddle sme ponovo. */
  obrisiDogadjaj(eventId: string): Promise<void>;
  profilPostoji(userId: string): Promise<boolean>;
  korisnikPoPretplati(subscriptionId: string): Promise<string | null>;
  korisnikPoKupcu(customerId: string): Promise<string | null>;
  primeniPretplatu(a: ArgPretplata): Promise<RpcIshod>;
  primeniPaket(a: ArgPaket): Promise<RpcIshod>;
  /** Koliko je kredita ova transakcija dodelila — osnova za povraćaj. */
  dodeljenoZaTransakciju(userId: string, txnId: string): Promise<number>;
  korigujKredite(a: ArgKorekcija): Promise<RpcIshod>;
}

/**
 * Ishod obrade jednog događaja.
 *
 * `ok: false` znači TRAJAN neuspeh — takav se loguje i dobija 200, jer ga
 * ponavljanje neće popraviti: sto ponovljenih isporuka ne pravi profil koji ne
 * postoji, niti čini `pri_` iz tuđeg kataloga našim.
 *
 * PROLAZAN neuspeh (baza ne odgovara, RPC pukne) ovuda uopšte ne prolazi —
 * skladište baca, ruta hvata, briše marker i vraća 500 da Paddle pokuša opet.
 * Dva ishoda su namerno razdvojena po mehanizmu, ne po zastavici: zastavicu bi
 * neko jednom zaboravio da postavi.
 */
export type Ishod = {
  ok: boolean;
  radnja: string;
  greska?: string;
};

// ═══════════════════════════════════════════════════════════
// POMOĆNE ODLUKE
// ═══════════════════════════════════════════════════════════

/** Planovi koji smeju da nastanu iz naplate. `beta` i `dopuna` nisu među njima. */
const PLACENI_PLANOVI: readonly string[] = ["starter", "pro", "advanced"];

/** `admin_adjust_credits` odbija iznos preko 500 po pozivu (0012). */
const MAX_KOREKCIJA = 500;

type CustomData = Record<string, unknown> | null | undefined;

function tekst(cd: CustomData, kljuc: string): string | null {
  const v = cd?.[kljuc];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Pokušaj da webhook postavi plan koji naplata ne sme da dodeli.
 *
 * `custom_data` upisuje naš checkout i tamo `plan` uopšte ne stoji — ali ume da
 * stigne iz transakcije napravljene ručno u Paddle panelu, ili iz pretplate
 * uvezene sa strane. Odgovor je odbijanje celog događaja, ne ignorisanje polja:
 * podatak koji tvrdi nešto što nam nije dozvoljeno je podatak koji ne razumemo.
 */
function betaPokusaj(cd: CustomData): string | null {
  const plan = tekst(cd, "plan");
  if (plan && !PLACENI_PLANOVI.includes(plan)) return plan;
  return null;
}

/**
 * Ko je kupac, u tri koraka.
 *
 * 1. `custom_data.user_id` — jedini put koji naš checkout pravi, i jedini koji
 *    radi za prvu kupovinu. Paddle prepisuje `custom_data` sa transakcije na
 *    pretplatu, pa i svaka obnova nosi isti ID.
 * 2. `paddle_subscription_id` iz naše tabele — hvata obnovu kojoj je
 *    `custom_data` očišćen, i događaj o pretplati koji ga nikad nije ni imao.
 * 3. `paddle_customer_id` sa profila — poslednja mreža, i jedini put za
 *    `adjustment.*`, koji `custom_data` nema uopšte (v. 0022 §2, gde je zbog
 *    ovoga i napravljen indeks).
 *
 * Mejla nema ni u jednom koraku i neće ga biti (pravilo 2 iz §5.3).
 */
async function nadjiKorisnika(
  s: NaplataSkladiste,
  izvori: { customData?: CustomData; subscriptionId?: string | null; customerId?: string | null },
): Promise<string | null> {
  const izCustom = tekst(izvori.customData, "user_id");
  if (izCustom && (await s.profilPostoji(izCustom))) return izCustom;

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

/** Paddle status pretplate → ono što `subscriptions_status_valid` prima. */
const STATUSI: readonly string[] = ["active", "trialing", "past_due", "paused", "canceled"];

function status(sirovo: string): ArgPretplata["status"] | null {
  return STATUSI.includes(sirovo) ? (sirovo as ArgPretplata["status"]) : null;
}

/** Prvi `pri_` iz stavki koji prepoznajemo. Tuđe stavke se preskaču, ne ruše. */
function priceIdIzStavki(stavke: { price?: { id?: string | null } | null }[]): string | null {
  for (const s of stavke) {
    const id = s.price?.id ?? null;
    if (id && kupovinaZaPriceId(id)) return id;
  }
  return null;
}

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
  dogadjaj: EventEntity,
  s: NaplataSkladiste,
): Promise<Ishod> {
  switch (dogadjaj.eventType) {
    case "transaction.completed":
      return await naplacenaTransakcija(dogadjaj.data as TxnPodaci, s);

    case "subscription.created":
    case "subscription.updated":
    case "subscription.canceled":
    case "subscription.past_due":
    case "subscription.activated":
    case "subscription.trialing":
    case "subscription.paused":
    case "subscription.resumed":
      return await stanjePretplate(dogadjaj.eventType, dogadjaj.data as SubPodaci, s);

    case "adjustment.created":
    case "adjustment.updated":
      return await korekcija(dogadjaj.data as AdjPodaci, s);

    default:
      // Nepoznat tip je uredno stanje, ne kvar: Paddle šalje i događaje koje
      // nismo tražili, a destinacija se s vremenom širi. Upisan je i time
      // deduplikovan; ništa drugo se ne radi.
      return { ok: true, radnja: `preskočeno:${dogadjaj.eventType}` };
  }
}

// ── oblici koje čitamo iz payload-a ────────────────────────
// Namerno UŽI od SDK tipova (`TransactionNotification` i drugovi): ovde stoji
// tačno ono što obrada dodiruje, pa se iz same deklaracije vidi šta naplata
// zavisi od Paddle-a. Kastovi iznad su bezbedni jer je `EventEntity` unija u
// kojoj `eventType` određuje `data`.

type TxnPodaci = {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  customData: CustomData;
  items: { price?: { id?: string | null } | null }[];
  billingPeriod: { endsAt: string } | null;
};

type SubPodaci = {
  id: string;
  status: string;
  customerId: string | null;
  customData: CustomData;
  canceledAt: string | null;
  currentBillingPeriod: { endsAt: string } | null;
  items: { price?: { id?: string | null } | null }[];
};

type AdjPodaci = {
  id: string;
  action: string;
  type: string;
  status: string;
  transactionId: string;
  subscriptionId: string | null;
  customerId: string | null;
};

/**
 * `transaction.completed` — jedini događaj koji dodeljuje kredite.
 *
 * Ovo je ujedno i okidač MESEČNE OBNOVE: Paddle šalje isti događaj na svaku
 * naplatu pretplate, pa cron za obnovu kredita ne postoji (Vercel Hobby nema
 * slobodan slot, a i ne treba mu — obnova je posledica naplate, ne kalendara).
 *
 * ── zašto se grana po `pri_`, a ne po `custom_data.kind` ────
 * `kind` upisuje naš checkout i on je tačan — ali samo tamo gde je naš checkout
 * i napravio transakciju. `pri_` je na transakciji UVEK i katalog (`plans.ts`)
 * je ionako jedini koji zna koliko kredita nosi. Grananje po katalogu zato radi
 * i za transakciju napravljenu u panelu, a `kind` ostaje kao ukrštena provera:
 * neslaganje se loguje, ali odluku donosi ono što je stvarno plaćeno.
 */
async function naplacenaTransakcija(t: TxnPodaci, s: NaplataSkladiste): Promise<Ishod> {
  const beta = betaPokusaj(t.customData);
  if (beta) {
    return {
      ok: false,
      radnja: "transaction.completed",
      greska: `webhook je pokušao plan \`${beta}\` — beta i dopuna se dodeljuju samo iz konzole`,
    };
  }

  const priceId = priceIdIzStavki(t.items);
  const kupovina = kupovinaZaPriceId(priceId);
  if (!kupovina) {
    return {
      ok: false,
      radnja: "transaction.completed",
      greska: "nijedna stavka nije iz našeg kataloga",
    };
  }

  const najavljeno = tekst(t.customData, "kind");
  if (najavljeno && najavljeno !== kupovina.kind) {
    console.warn(
      `[paddle-webhook] custom_data.kind je \`${najavljeno}\`, a katalog kaže ` +
        `\`${kupovina.kind}\` — ide po katalogu`,
    );
  }

  const userId = await nadjiKorisnika(s, {
    customData: t.customData,
    subscriptionId: t.subscriptionId,
    customerId: t.customerId,
  });
  if (!userId) {
    // Novac je stigao i ne zna se čiji je. Ponavljanje ne pomaže — 200, pa u log.
    return {
      ok: false,
      radnja: "transaction.completed",
      greska: `transakcija ${t.id} nije vezana ni za jedan profil`,
    };
  }

  if (kupovina.kind === "pack") {
    const r = await s.primeniPaket({
      userId,
      credits: kupovina.credits,
      txnId: t.id,
      customerId: t.customerId,
    });
    return r.ok
      ? { ok: true, radnja: `paket:${r.reason}` }
      : { ok: false, radnja: "paket", greska: r.reason };
  }

  if (!t.subscriptionId) {
    // `apply_subscription` traži ID pretplate i s pravom: bez njega nema šta da
    // se upiše u ogledalo, a kredite bi trebalo dodeliti mimo pretplate — dakle
    // u pogrešnu kasu. Paddle stavlja `subscription_id` na naplaćenu transakciju
    // sa ponavljajućom cenom, pa je ovo stanje kvar, ne obična grana.
    return {
      ok: false,
      radnja: "transaction.completed",
      greska: `pretplatnička transakcija ${t.id} nema subscription_id`,
    };
  }

  const r = await s.primeniPretplatu({
    userId,
    subscriptionId: t.subscriptionId,
    customerId: t.customerId,
    // Naplata je prošla; tek `subscription.*` događaj ume da javi drugačije, a
    // on stiže zasebno i prepisuje ovo.
    status: "active",
    priceId,
    plan: kupovina.plan,
    periodEnd: t.billingPeriod?.endsAt ?? null,
    credits: kupovina.credits,
    txnId: t.id,
    canceledAt: null,
  });

  return r.ok
    ? { ok: true, radnja: `pretplata:${r.reason}` }
    : { ok: false, radnja: "pretplata", greska: r.reason };
}

/**
 * Svi `subscription.*` događaji idu kroz jednu granu, jer i rade jednu stvar:
 * osvežavaju ogledalo. Nijedan od njih ne dodeljuje kredite (`credits: 0`,
 * `txnId: null`) — dodela visi o naplati, a naplata je `transaction.completed`.
 *
 * `subscription.canceled` NE GASI PRISTUP (LANSIRANJE §1.5): upisuje se
 * `canceled_at`, a `plan_expires_at` ostaje kraj plaćenog perioda. Kapija iz
 * S19 čita taj datum; ovde se ništa ne oduzima.
 *
 * `subscription.past_due` isto ne oduzima ništa — samo obeleži stanje. Korisnik
 * čija je kartica pala ne sme da izgubi pristup pre nego što Paddle završi
 * ciklus pokušaja naplate.
 */
async function stanjePretplate(
  tip: string,
  p: SubPodaci,
  s: NaplataSkladiste,
): Promise<Ishod> {
  const beta = betaPokusaj(p.customData);
  if (beta) {
    return {
      ok: false,
      radnja: tip,
      greska: `webhook je pokušao plan \`${beta}\` — beta se dodeljuje samo iz konzole`,
    };
  }

  const st = status(p.status);
  if (!st) return { ok: false, radnja: tip, greska: `nepoznat status \`${p.status}\`` };

  const userId = await nadjiKorisnika(s, {
    customData: p.customData,
    subscriptionId: p.id,
    customerId: p.customerId,
  });
  if (!userId) {
    return { ok: false, radnja: tip, greska: `pretplata ${p.id} nije vezana ni za jedan profil` };
  }

  const priceId = priceIdIzStavki(p.items);
  const kupovina = kupovinaZaPriceId(priceId);
  // `null` plan znači „ne diraj postojeći" — `apply_subscription` ga uzima kroz
  // `coalesce`. Tako promena adrese ili kartice na pretplati sa cenom koju ne
  // prepoznajemo ne obara plan koji korisnik već ima.
  const plan = kupovina?.kind === "subscription" ? kupovina.plan : null;

  const r = await s.primeniPretplatu({
    userId,
    subscriptionId: p.id,
    customerId: p.customerId,
    status: st,
    priceId,
    plan,
    periodEnd: p.currentBillingPeriod?.endsAt ?? null,
    credits: 0,
    txnId: null,
    canceledAt: p.canceledAt,
  });

  return r.ok ? { ok: true, radnja: `${tip}:${r.reason}` } : { ok: false, radnja: tip, greska: r.reason };
}

/**
 * Povraćaj i chargeback — jedini put kojim krediti idu NANIŽE iz naplate.
 *
 * `admin_adjust_credits(p_kind => 'povracaj')` je jedini omotač koji sme
 * negativan iznos (migracija 0012/0022) i jedini koji preskače proveru „balans
 * bi bio negativan". To je namerno: povraćaj mora da prođe i kad su krediti već
 * potrošeni, jer je novac vraćen bez obzira na to. Balans ide u minus i tamo
 * ostaje do prve mesečne dodele, koja ga POSTAVLJA na ciljnu vrednost.
 *
 * Tri ograničenja, sva zapisana da se ne otkrivaju kasnije:
 *
 * 1. **Samo pun povraćaj** (`type === "full"`). Delimičan bi tražio srazmeru
 *    prema iznosu ORIGINALNE transakcije, a taj iznos nigde ne čuvamo — Paddle
 *    je merchant of record i knjiga je kod njega. Delimičan povraćaj se zato
 *    loguje i rešava iz admin konzole, gde ista funkcija stoji sa iznosom koji
 *    čovek unese.
 * 2. **Samo odobren** (`status === "approved"`). Povraćaj koji je kupac tražio
 *    stiže kao `pending_approval` i može da bude odbijen; skidanje kredita pre
 *    odluke bi bilo skidanje kredita bez povraćaja. Zato se hvata i
 *    `adjustment.updated` — trenutak odobrenja je često tek on.
 * 3. **Skida se tačno koliko je ta transakcija dala**, pročitano iz knjige, a ne
 *    izračunato iz plana. Plan je u međuvremenu mogao da se promeni.
 */
async function korekcija(a: AdjPodaci, s: NaplataSkladiste): Promise<Ishod> {
  if (a.action !== "refund" && a.action !== "chargeback") {
    return { ok: true, radnja: `preskočeno:adjustment.${a.action}` };
  }

  if (a.status !== "approved") {
    return { ok: true, radnja: `povraćaj čeka odobrenje:${a.status}` };
  }

  if (a.type !== "full") {
    console.warn(
      `[paddle-webhook] delimičan povraćaj ${a.id} nad ${a.transactionId} — ` +
        "krediti se ne diraju automatski, v. admin konzolu",
    );
    return { ok: true, radnja: "povraćaj delimičan — ručno" };
  }

  const userId = await nadjiKorisnika(s, {
    subscriptionId: a.subscriptionId,
    customerId: a.customerId,
  });
  if (!userId) {
    return { ok: false, radnja: "povraćaj", greska: `${a.id} nije vezan ni za jedan profil` };
  }

  const dodeljeno = await s.dodeljenoZaTransakciju(userId, a.transactionId);
  if (dodeljeno <= 0) {
    // Transakcija koja nikad nije dala kredite (na primer promena kartice na
    // nulti iznos). Nema šta da se vrati i to nije greška.
    return { ok: true, radnja: "povraćaj bez kredita" };
  }

  // `admin_adjust_credits` odbija iznos preko 500 po pozivu, a Advanced plan
  // daje 800. Zato se deli na komade sa RAZLIČITIM `ref_id`-jem — isti bi drugi
  // komad proglasio duplikatom i tiho vratio manje nego što treba.
  let ostatak = dodeljeno;
  let komad = 0;
  while (ostatak > 0) {
    const iznos = Math.min(ostatak, MAX_KOREKCIJA);
    const refId = komad === 0 ? `povracaj:${a.id}` : `povracaj:${a.id}#${komad + 1}`;

    const r = await s.korigujKredite({
      userId,
      delta: -iznos,
      note: `Paddle ${a.action} ${a.id} nad transakcijom ${a.transactionId}`,
      refId,
    });
    if (!r.ok) return { ok: false, radnja: "povraćaj", greska: r.reason };

    ostatak -= iznos;
    komad += 1;
  }

  return { ok: true, radnja: `povraćaj -${dodeljeno}` };
}
