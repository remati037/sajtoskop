// packages/shared/src/pristup.ts
// Ko sme unutra, dokle, i šta sme dok je tu (LANSIRANJE §1.5, naplata-stripe.md §7).
//
// ── zašto jedna funkcija, i zašto baš ovde ───────────────────
// Sedam stanja pristupa čita pet različitih mesta: kapija u `(app)/layout.tsx`,
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
//
// ── [S25] šta se promenilo sa Stripe-om ──────────────────────
//   · `beta` → `komp` (isti mehanizam, ime iz odluke D4).
//   · novo stanje `proba`: pretplata sa statusom `trialing` — pun pristup, svoj
//     baner, dugme „Aktiviraj odmah". Sedmo stanje, svesno odstupanje od
//     nekadašnjeg komentara „šest stanja" (naplata-stripe.md §7.1, B3).
//   · `otkazan` se čita i iz `cancel_at_period_end` — Stripe tako javlja
//     otkazivanje zakazano za kraj perioda, a status ostaje `active`/`trialing`.

import { DEFAULT_PLAN, GRACE_DAYS, PLANS, type PlanId } from "./plans";

const DAN_MS = 24 * 60 * 60 * 1000;

/** Sedam stanja (LANSIRANJE §1.5 + proba iz naplata-stripe.md §7). Drugog nema i ne sme da nastane. */
export type StanjeId = "komp" | "proba" | "aktivan" | "otkazan" | "dopuna" | "grace" | "zakljucan";

/**
 * Ono što odluka traži od `profiles`. Namerno NIJE `ProfileRow`: funkcija je u
 * shared paketu i ne sme da zavisi od oblika tabele, a i test bi uz pun red
 * morao da izmisli trideset kolona koje nikoga ne zanimaju.
 */
export type ProfilZaPristup = {
  /** `profiles.plan`. Nepoznata vrednost pada na `DEFAULT_PLAN`. */
  plan: string | null;
  /**
   * `profiles.komp_expires_at`.
   *
   * ‼️ `null` je PREOPTEREĆEN i to je jedina zamka u celom fajlu:
   *    - uz `plan = 'komp'` znači **neograničen komp** (LANSIRANJE §1.5, 0025);
   *    - uz svaki drugi plan znači **da kompa nema**.
   *
   * Drugo čitanje ne postoji: kad bi `null` uvek bio „neograničeno", svaki
   * pretplatnik kome pretplata istekne dobio bi večan pristup.
   */
  kompExpiresAt: string | null;
  /** `profiles.plan_expires_at` — Stripe `current_period_end` (ili `trial_end`), puni ga webhook. */
  planExpiresAt: string | null;
  /** `profiles.credits_topup` — kasa koja ne ističe (paketi, §1.4). */
  creditsTopup: number;
  /**
   * `profiles.created_at` — trenutak registracije (S28, O3).
   *
   * Postoji SAMO zbog grane 4 (grace): nov nalog nema nijedan plaćen rok, pa bi
   * bez ovoga prelazio iz `dopuna` pravo u `zakljucan` istog trenutka u kom
   * potroši kredite dobrodošlice — i to na `/zakljucano`, sa prospektima koje je
   * maločas otključao iza katanca. Grace se zato broji od KASNIJEG od dva
   * datuma: plaćenog roka i registracije.
   *
   * `null` znači „ne znam kad je nastao" i tada se ponaša kao pre S28 (nema
   * grace-a bez plaćenog roka). Nijedna druga grana ovo polje ne čita: za nalog
   * sa plaćenim rokom je `punDo` uvek kasniji od registracije, pa bi uračunavanje
   * `createdAt` više gore bila promena bez ijedne posledice osim rizika.
   */
  createdAt: string | null;
};

/**
 * Stripe statusi pretplate, onako kako ih `subscriptions_status_valid` prima.
 *
 * `unpaid` i `incomplete*` se ovde ne razlikuju od „pretplate nema": nijedan
 * ne daje pun pristup sam po sebi, granicu drži `plan_expires_at` (§7.1).
 */
export type StatusPretplate =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

/** Ono što odluka traži od `subscriptions`. Samo najsvežiji red. */
export type PretplataZaPristup = {
  status: StatusPretplate;
  currentPeriodEnd: string | null;
  /** Kraj probe. `null` kad probe nema ili je prošla. */
  trialEnd: string | null;
  /** Otkazivanje zakazano za kraj perioda — status ostaje `active`/`trialing`. */
  cancelAtPeriodEnd: boolean;
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
      stanje: "komp";
      pun: true;
      cita: true;
      /** `null` = neograničen komp. */
      punDo: string | null;
      citanjeDo: string | null;
    })
  | (Zajednicko & {
      stanje: "proba";
      pun: true;
      cita: true;
      punDo: string;
      citanjeDo: string;
      /** Kraj probe — datum na baneru i uz dugme „Aktiviraj odmah". */
      probaDo: string;
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
      /**
       * Plaćeni rok koji je istekao — `null` kad ga nikad nije ni bilo.
       *
       * [S28, O3] Do S28 je ovde bio `string`, jer se u grace ulazilo samo
       * istekom plaćenog roka. Od O3 u grace ulazi i NOV nalog koji je potrošio
       * kredite dobrodošlice, a on nikad nije imao rok — pa je `null` ovde
       * podatak, ne propust: „pristup ti je istekao <datum>" i „besplatni
       * krediti su potrošeni" su dve različite rečenice i UI ih po ovom polju i
       * razlikuje (§2.3, §1.12).
       */
      punDo: string | null;
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
 * (`komp_expires_at`, `plan_expires_at`). Treća kolona bi bila treći datum koji
 * se razilazi sa prva dva čim admin pomeri rok kompa.
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
 *   1. neograničen komp — jedini slučaj bez ijednog datuma
 *   2. pun pristup po datumu — komp / otkazan / proba / aktivan
 *   3. `credits_topup > 0` — dopuna PRETIČE grace, jer je kupljen paket
 *      povratak u pun pristup, a ne produžetak samrtnog roka
 *   4. grace, pa zaključano — grace se broji od KASNIJEG od `punDo` i
 *      `createdAt` (S28, O3: nov nalog koji potroši kredite dobrodošlice ima
 *      mesec dana da čita svoje, isto kao pretplatnik kome je plan istekao)
 */
export function stanjePristupa(
  profil: ProfilZaPristup,
  pretplata: PretplataZaPristup | null,
  sada: number,
): Pristup {
  const plan = planId(profil.plan);
  const jeKomp = plan === "komp";

  // 1. Neograničen komp: `plan = 'komp'` uz prazan rok (0025). Kapija ga ne dira.
  if (jeKomp && profil.kompExpiresAt === null) {
    return {
      stanje: "komp",
      pun: true,
      cita: true,
      planLimita: "komp",
      punDo: null,
      citanjeDo: null,
    };
  }

  // Rok kompa se broji i kad plan više nije `komp`: admin je obećao datum, a
  // kupljena pretplata usput taj datum ne poništava (§1.5, `max` od dva ulaza).
  const punDo = kasniji(profil.kompExpiresAt, profil.planExpiresAt);
  const citanjeDo = citanjeDoZa(punDo);

  const punDoMs = msIli(punDo);

  // 2. Pun pristup traje dok traje kasniji od dva roka.
  if (punDo !== null && citanjeDo !== null && punDoMs !== null && punDoMs > sada) {
    if (jeKomp) {
      return { stanje: "komp", pun: true, cita: true, planLimita: "komp", punDo, citanjeDo };
    }

    // Otkazana pretplata koja još traje NIJE grace (§1.5): korisnik je platio
    // period do kraja i sme sve, samo mu baner kaže do kad. Stripe to javlja na
    // tri načina — `status = 'canceled'` posle `customer.subscription.deleted`,
    // `cancel_at_period_end = true` kad je otkazivanje zakazano za kraj perioda
    // (status ostaje `active` ili `trialing`), i `canceled_at` uz oba. Sva tri
    // znače isto korisniku, pa se i čitaju isto. Otkazana PROBA (`trialing` +
    // `cancel_at_period_end`) je zato `otkazan` sa `punDo = trial_end`, ne
    // `proba` — naplata-stripe.md §7.1.
    const otkazana =
      pretplata !== null &&
      (pretplata.status === "canceled" ||
        pretplata.cancelAtPeriodEnd ||
        pretplata.canceledAt !== null);

    if (otkazana) {
      return { stanje: "otkazan", pun: true, cita: true, planLimita: plan, punDo, citanjeDo };
    }

    // Proba: pretplata postoji, kartica je uzeta, prva naplata je osmog dana.
    // Pun pristup kao i aktivan, ali svoj baner i svoje dugme (§7.1, B3).
    if (pretplata?.status === "trialing") {
      return {
        stanje: "proba",
        pun: true,
        cita: true,
        planLimita: plan,
        punDo,
        citanjeDo,
        probaDo: pretplata.trialEnd ?? punDo,
      };
    }

    // `past_due` (kartica pala) ostaje `aktivan` dok `plan_expires_at` nije
    // prošao — Stripe drži `current_period_end` na starom datumu, pa posle
    // Smart Retries-a nalog prelazi u `grace` prirodno (§7.1, §7.5).
    return { stanje: "aktivan", pun: true, cita: true, planLimita: plan, punDo, citanjeDo };
  }

  // 3. Krediti iz paketa vraćaju PUN pristup i bez pretplate (§1.5 „dopuna").
  //    Stoji ispred grace-a namerno: čovek koji je maločas kupio paket ne sme
  //    da vidi baner „pristup ti ističe" nad kreditima koje je upravo platio.
  if (profil.creditsTopup > 0) {
    return { stanje: "dopuna", pun: true, cita: true, planLimita: "dopuna", punDo, citanjeDo };
  }

  // 4. Grace: čita i izvozi svoje, ne troši ništa (§1.5).
  //
  // [S28, O3] Broji se od KASNIJEG od plaćenog roka i registracije. Nalog koji
  // je imao pretplatu time ne dobija ni dan više (registracija mu je davno pre
  // `punDo`), a nalog koji plan nikad nije imao dobija mesec dana od
  // registracije — bez toga je „potrošio si kredite dobrodošlice" isto što i
  // „nalog ti je istekao pre mesec dana", pa bi čovek odmah posle prve poruke
  // završio na `/zakljucano` bez ijednog otključanog prospekta.
  //
  // `punDo` u odgovoru OSTAJE plaćeni rok (dakle `null` za nov nalog):
  // registracija nije datum do kog je nešto plaćeno, a baner i modal iz njega
  // ispisuju rečenicu o pretplati. `citanjeDo` je jedini datum koji se ovde
  // menja, i on je jedini koji grace i prikazuje.
  const graceDo = citanjeDoZa(kasniji(punDo, profil.createdAt));
  const graceDoMs = msIli(graceDo);

  if (graceDo !== null && graceDoMs !== null && graceDoMs > sada) {
    return { stanje: "grace", pun: false, cita: true, planLimita: plan, punDo, citanjeDo: graceDo };
  }

  return { stanje: "zakljucan", pun: false, cita: false, planLimita: plan, punDo, citanjeDo };
}

// ═══════════════════════════════════════════════════════════
// KO SME DA KUPI PAKET KREDITA
// ═══════════════════════════════════════════════════════════
// ‼️ OVO JE IZMENA ODLUKE iz LANSIRANJE §1.4, doneta 26. avgusta 2026.
//
// Do tada je važilo: „paket se kupuje i bez pretplate; to je podržan slučaj, ne
// izuzetak". Sada važi suprotno — paket je DOPUNA postojećem pristupu, ne ulaz
// u proizvod. Ko nema plan ni komp, uzima plan.
//
// ── zašto je to promena, a ne sitnica ───────────────────────
// Paket je bio jedini put kojim je neko mogao da uđe (i vrati se) bez mesečne
// kartice. Time što ga uslovljava, proizvod dobija jedan ulaz umesto dva:
// `/zakljucano` više nema drugu ponudu, a `dopuna` prestaje da bude stanje u
// koje se ULAZI kupovinom — postaje samo ono u koje se ISPADA kad pretplata
// prestane, a kupljeni krediti ostanu.
//
// `dopuna` zato NIJE mrtvo stanje i ostaje u uniji: pretplatnik koji kupi paket
// pa otkaže plan i dočeka istek perioda i dalje završi u njemu, sa kreditima
// koji ne ističu. Samo više ne može da ga dopuni bez novog plana.
//
// ── zašto komp i proba SMEJU ────────────────────────────────
// Komp nalozi su ljudi kojima sam pristup dao rukom (Vlada, prijatelji,
// partneri — A3). Oduzeti im mogućnost da mi plate paket značilo bi da jedini
// način da plate bude pun plan. Proba je pretplata sa karticom: kartica već
// stoji, pa paket uz probu nije ništa drugo nego paket uz plan koji počinje
// osmog dana (naplata-stripe.md §7.1, `STANJA_ZA_PAKET`).

/** Stanja iz kojih se paket kredita sme kupiti. Jedini spisak, nema drugog. */
export const STANJA_ZA_PAKET: readonly StanjeId[] = ["aktivan", "otkazan", "komp", "proba"];

/**
 * Sme li ovaj nalog da kupi paket kredita.
 *
 * `null` (nepoznato stanje — profil nije pročitan) vraća `false`, i to je
 * suprotno od `odbijenica()` u `apps/web/src/lib/pristup.ts`, koja kvar veze
 * namerno PROPUŠTA. Razlika je namerna i ide po tome šta je šteta u svakom
 * smeru: tamo bi zatvaranje značilo da kvar baze izgleda kao istekla pretplata
 * korisniku koji je platio; ovde bi otvaranje značilo da se novac uzme mimo
 * pravila. Naplata pada zatvoreno.
 *
 * Na serveru se uz to profil garantuje PRE ove provere (`ensureProfile()` u
 * checkout ruti), pa `null` tamo znači stvaran kvar, ne trku.
 */
export function smeDaKupiPaket(pristup: Pristup | null): boolean {
  return pristup !== null && STANJA_ZA_PAKET.includes(pristup.stanje);
}
