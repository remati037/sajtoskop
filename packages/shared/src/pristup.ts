// packages/shared/src/pristup.ts
// Ko sme unutra, dokle, i šta sme dok je tu (LANSIRANJE §1.5).
//
// ── zašto jedna funkcija, i zašto baš ovde ───────────────────
// Šest stanja pristupa čita pet različitih mesta: kapija u `(app)/layout.tsx`,
// svaka zaštićena stranica, svaka API ruta koja troši novac, trajan baner i
// modal. Dok god svako od njih sam sabira datume, dva mesta će zaključati
// različito — a to se u naplati ne vidi kao bug nego kao „aplikacija mi ne radi,
// a platio sam".
//
// Stoji u `packages/shared`, ne u `apps/web/src/lib`, iz tri razloga:
//   1. `GRACE_DAYS` je već ovde, u `plans.ts`. Funkcija koja od njega izvodi
//      datum ne sme da bude u drugom paketu od broja koji koristi.
//   2. Odluku čita i SERVER (rute, stranice) i PREGLEDAČ (baner, modal). Sve u
//      `apps/web/src/lib` što dodiruje bazu nosi `server-only`, pa bi klijentska
//      polovina morala da dobije kopiju — dakle drugu računicu.
//   3. Isti obrazac je već dokazan na `feedback-motor.ts`: čiste funkcije,
//      trenutak se PROSLEĐUJE (nema `Date.now()` u telu odluke), pa se ista
//      pravila proveravaju u testu, u ruti i u komponenti.
//
// Ovde nema nijednog upita i nijednog `fetch`-a. Ulaz su dva već pročitana reda.

import { DEFAULT_PLAN, GRACE_DAYS, PLANS, type PlanId } from "./plans";

const DAN_MS = 24 * 60 * 60 * 1000;

/** Šest stanja iz LANSIRANJE §1.5. Drugog nema i ne sme da nastane. */
export type StanjeId = "beta" | "aktivan" | "otkazan" | "dopuna" | "grace" | "zakljucan";

/**
 * Ono što odluka traži od `profiles`. Namerno NIJE `ProfileRow`: funkcija je u
 * shared paketu i ne sme da zavisi od oblika tabele, a i test bi uz pun red
 * morao da izmisli trideset kolona koje nikoga ne zanimaju.
 */
export type ProfilZaPristup = {
  /** `profiles.plan`. Nepoznata vrednost pada na `DEFAULT_PLAN`. */
  plan: string | null;
  /**
   * `profiles.beta_expires_at`.
   *
   * ‼️ `null` je PREOPTEREĆEN i to je jedina zamka u celom fajlu:
   *    - uz `plan = 'beta'` znači **neograničena beta** (LANSIRANJE §1.5, 0022);
   *    - uz svaki drugi plan znači **da bete nema**.
   *
   * Drugo čitanje ne postoji: kad bi `null` uvek bio „neograničeno", svaki
   * pretplatnik kome pretplata istekne dobio bi večan pristup.
   */
  betaExpiresAt: string | null;
  /** `profiles.plan_expires_at` — Paddle `current_period_end`, puni ga webhook (S18). */
  planExpiresAt: string | null;
  /** `profiles.credits_topup` — kasa koja ne ističe (paketi, §1.4). */
  creditsTopup: number;
};

/** Ono što odluka traži od `subscriptions`. Samo najsvežiji red. */
export type PretplataZaPristup = {
  status: "active" | "trialing" | "past_due" | "paused" | "canceled";
  currentPeriodEnd: string | null;
  canceledAt: string | null;
};

type Zajednicko = {
  /**
   * Sme da TROŠI: pretraga, skeniranje, otključavanje, uvoz koji otključava,
   * AI varijanta poruke.
   */
  pun: boolean;
  /**
   * Sme da ČITA svoje: otključani prospekti, pipeline, OBA izvoza.
   * `false` je samo `zakljucan`.
   */
  cita: boolean;
  /**
   * Plan po kome se računaju DNEVNI limiti (`cacheMissPerDay`, `exportPerDay`,
   * `aiRewritePerDay`). Nije isto što i `profiles.plan`: korisnik u stanju
   * `dopuna` ima plan koji mu je istekao, a limite Startera (§1.3).
   */
  planLimita: PlanId;
};

/**
 * Diskriminisana unija, ne `{ stanje, pun, cita }` sa opcionim datumima.
 *
 * Razlog je konkretan: baner u `grace` i baner otkazane pretplate MORAJU da
 * ispišu tačan datum. Sa `punDo?: string` bi svaki od njih imao svoje
 * `?? "uskoro"`, a to je tačno ono „ne znam tačno kad ti ističe pristup" koje
 * korisnika tera u podršku. Ovako tip ne dozvoljava da se datum izostavi.
 */
export type Pristup =
  | (Zajednicko & {
      stanje: "beta";
      pun: true;
      cita: true;
      /** `null` = neograničena beta. */
      punDo: string | null;
      citanjeDo: string | null;
    })
  | (Zajednicko & {
      stanje: "aktivan";
      pun: true;
      cita: true;
      punDo: string;
      citanjeDo: string;
    })
  | (Zajednicko & {
      stanje: "otkazan";
      pun: true;
      cita: true;
      /** „Pretplata traje do <ovaj datum>." Nikad `null` — zato je i zasebno stanje. */
      punDo: string;
      citanjeDo: string;
    })
  | (Zajednicko & {
      stanje: "dopuna";
      pun: true;
      cita: true;
      /** Datum plana koji je istekao, ako ga je ikad bilo. Pristup ne visi o njemu. */
      punDo: string | null;
      citanjeDo: string | null;
    })
  | (Zajednicko & {
      stanje: "grace";
      pun: false;
      cita: true;
      punDo: string;
      /** Dan do kog sme da izveze svoj rad. Ovo je datum koji baner ispisuje. */
      citanjeDo: string;
    })
  | (Zajednicko & {
      stanje: "zakljucan";
      pun: false;
      cita: false;
      punDo: string | null;
      citanjeDo: string | null;
    });

/** Trenutak u milisekundama, ili `null` ako datuma nema ili nije čitljiv. */
function msIli(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Kasniji od dva ISO datuma, u originalnom obliku. Neispravan se ponaša kao da ga nema. */
function kasniji(a: string | null, b: string | null): string | null {
  const ta = msIli(a);
  const tb = msIli(b);
  if (ta === null) return tb === null ? null : b;
  if (tb === null) return a;
  return ta >= tb ? a : b;
}

/** Nepoznat plan iz baze ne sme da sruši kapiju — padni na podrazumevani. */
function planId(vrednost: string | null): PlanId {
  return vrednost !== null && vrednost in PLANS ? (vrednost as PlanId) : DEFAULT_PLAN;
}

/**
 * Datum do kog SME DA ČITA: pun pristup + `GRACE_DAYS`.
 *
 * Izvedeno, nikad skladišteno — §1.5 traži da se čuvaju samo dva ulaza
 * (`beta_expires_at`, `plan_expires_at`). Treća kolona bi bila treći datum koji
 * se razilazi sa prva dva čim admin pomeri rok bete.
 */
export function citanjeDoZa(punDo: string | null): string | null {
  const t = msIli(punDo);
  return t === null ? null : new Date(t + GRACE_DAYS * DAN_MS).toISOString();
}

/**
 * JEDINI izvor istine o pristupu.
 *
 * `sada` je obavezan i namerno: odluka sa `Date.now()` u telu ne može da se
 * proveri testom bez laganja sistemskog sata (isti razlog kao u
 * `feedback-motor.ts`).
 *
 * Redosled provera JESTE deo odluke:
 *   1. neograničena beta — jedini slučaj bez ijednog datuma
 *   2. pun pristup po datumu — beta / otkazan / aktivan
 *   3. `credits_topup > 0` — dopuna PRETIČE grace, jer je kupljen paket
 *      povratak u pun pristup, a ne produžetak samrtnog roka
 *   4. grace, pa zaključano
 */
export function stanjePristupa(
  profil: ProfilZaPristup,
  pretplata: PretplataZaPristup | null,
  sada: number,
): Pristup {
  const plan = planId(profil.plan);
  const jeBeta = plan === "beta";

  // 1. Neograničena beta. Ovo je i stanje SVAKOG naloga otvorenog pre naplate:
  //    `profiles.plan` ima default `'beta'` (0001), a `beta_expires_at` je NULL
  //    dok ga admin ne postavi (0022). Kapija ih zato ne dira.
  if (jeBeta && profil.betaExpiresAt === null) {
    return {
      stanje: "beta",
      pun: true,
      cita: true,
      planLimita: "beta",
      punDo: null,
      citanjeDo: null,
    };
  }

  // Rok bete se broji i kad plan više nije `beta`: admin je obećao datum, a
  // kupljena pretplata usput taj datum ne poništava (§1.5, `max` od dva ulaza).
  const punDo = kasniji(profil.betaExpiresAt, profil.planExpiresAt);
  const citanjeDo = citanjeDoZa(punDo);

  const punDoMs = msIli(punDo);
  const citanjeDoMs = msIli(citanjeDo);

  // 2. Pun pristup traje dok traje kasniji od dva roka.
  if (punDo !== null && citanjeDo !== null && punDoMs !== null && punDoMs > sada) {
    if (jeBeta) {
      return { stanje: "beta", pun: true, cita: true, planLimita: "beta", punDo, citanjeDo };
    }

    // Otkazana pretplata koja još traje NIJE grace (§1.5): korisnik je platio
    // period do kraja i sme sve, samo mu baner kaže do kad. Paddle to javlja na
    // dva načina — `status = 'canceled'` posle `subscription.canceled`, i
    // `canceled_at` uz još uvek aktivan status kad je otkazivanje zakazano za
    // kraj perioda. Oba znače isto korisniku, pa se i čitaju isto.
    const otkazana =
      pretplata !== null && (pretplata.status === "canceled" || pretplata.canceledAt !== null);

    return {
      stanje: otkazana ? "otkazan" : "aktivan",
      pun: true,
      cita: true,
      planLimita: plan,
      punDo,
      citanjeDo,
    };
  }

  // 3. Krediti iz paketa vraćaju PUN pristup i bez pretplate (§1.5 „dopuna").
  //    Stoji ispred grace-a namerno: čovek koji je maločas kupio paket ne sme
  //    da vidi baner „pristup ti ističe" nad kreditima koje je upravo platio.
  if (profil.creditsTopup > 0) {
    return { stanje: "dopuna", pun: true, cita: true, planLimita: "dopuna", punDo, citanjeDo };
  }

  // 4. Grace: čita i izvozi svoje, ne troši ništa (§1.5).
  if (punDo !== null && citanjeDo !== null && citanjeDoMs !== null && citanjeDoMs > sada) {
    return { stanje: "grace", pun: false, cita: true, planLimita: plan, punDo, citanjeDo };
  }

  return { stanje: "zakljucan", pun: false, cita: false, planLimita: plan, punDo, citanjeDo };
}
