// packages/shared/test/pristup.ts
// Pokretanje: pnpm --filter @sajtoskop/shared test  (ili `pnpm test` iz korena)
//
// [S19, S25] `stanjePristupa()` je jedini izvor istine o tome ko sme unutra. Sve
// što kapije, baneri i modal rade jeste da pročitaju `stanje`, `pun` i `cita` —
// pa je ovo mesto na kome se greška u pristupu hvata, a ne u pet komponenti.
//
// Trenutak se PROSLEĐUJE (funkcija nema `Date.now()` u telu), pa se „istekla
// juče" i „za 31 dan" proveravaju bez laganja sistemskog sata.
//
// [S25] `beta` → `komp`, novo stanje `proba`, otkazana proba, `cancel_at_period_end`.

import {
  citanjeDoZa,
  GRACE_DAYS,
  ONBOARDING_CREDITS,
  PLANS,
  stanjePristupa,
  STANJA_ZA_PAKET,
  type PretplataZaPristup,
  type ProfilZaPristup,
} from "../src/index";

let fail = 0;
function check(ok: boolean, line: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
}

const SADA = Date.parse("2026-08-21T12:00:00.000Z");
const DAN = 24 * 60 * 60 * 1000;
const zaDana = (n: number) => new Date(SADA + n * DAN).toISOString();

function profil(over: Partial<ProfilZaPristup> = {}): ProfilZaPristup {
  // `createdAt: null` je podrazumevano namerno: tako se ponašaju svi testovi
  // pisani pre S28 (grace bez plaćenog roka ne postoji), pa O3 provere ispod
  // stoje same i vidi se tačno šta datum registracije menja.
  return {
    plan: "komp",
    kompExpiresAt: null,
    planExpiresAt: null,
    creditsTopup: 0,
    createdAt: null,
    ...over,
  };
}

function pretplata(over: Partial<PretplataZaPristup> = {}): PretplataZaPristup {
  return {
    status: "active",
    currentPeriodEnd: null,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...over,
  };
}

// ── 1. neograničen komp ────────────────────────────────────
console.log("\nneograničen komp");

{
  const p = stanjePristupa(profil(), null, SADA);
  check(p.stanje === "komp" && p.pun && p.cita, "komp_expires_at NULL → komp, pun pristup");
  check(p.punDo === null && p.citanjeDo === null, "neograničen komp nema nijedan datum");
  check(p.planLimita === "komp", "komp ima svoje (Advanced) limite");
  check(
    PLANS.komp.cacheMissPerDay === PLANS.advanced.cacheMissPerDay &&
      PLANS.komp.aiRewritePerDay === PLANS.advanced.aiRewritePerDay,
    "komp limiti su Advanced (naplata-stripe.md A3)",
  );
}

// Kredita nema, a pristup ostaje: novčanik i pristup su dve različite kapije.
check(
  stanjePristupa(profil({ creditsTopup: 0 }), null, SADA).pun,
  "neograničen komp i sa nula kredita ostaje pun pristup",
);

// `null` uz PLAĆEN plan znači „kompa nema", ne „neograničeno" — inače bi svaki
// pretplatnik kome pretplata istekne dobio večan pristup.
check(
  stanjePristupa(profil({ plan: "starter", planExpiresAt: zaDana(-1) }), null, SADA).stanje !==
    "komp",
  "komp_expires_at NULL uz plan `starter` NIJE neograničen komp",
);

// ── 2. istek kompa: grace pa zaključano ────────────────────
console.log("\nistek kompa");

{
  const juce = profil({ kompExpiresAt: zaDana(-1) });
  const p = stanjePristupa(juce, null, SADA);
  check(p.stanje === "grace", "komp istekao juče → grace");
  check(p.pun === false && p.cita === true, "grace: ne troši, ali čita");
  check(
    p.stanje === "grace" && Date.parse(p.citanjeDo) === Date.parse(zaDana(-1)) + GRACE_DAYS * DAN,
    `grace traje tačno ${GRACE_DAYS} dana od isteka`,
  );
}

check(
  stanjePristupa(profil({ kompExpiresAt: zaDana(-1) }), null, SADA + 28 * DAN).stanje === "grace",
  "29 dana posle isteka → i dalje grace",
);
// Granica je zatvorena: u sekundi u kojoj grace ističe pristup je već zaključan.
check(
  stanjePristupa(profil({ kompExpiresAt: zaDana(-1) }), null, SADA + 29 * DAN).stanje ===
    "zakljucan",
  "tačno na isteku grace-a → zaključan (granica se ne prašta)",
);
check(
  stanjePristupa(profil({ kompExpiresAt: zaDana(-31) }), null, SADA).stanje === "zakljucan",
  "31 dan posle isteka → zaključan",
);
{
  const p = stanjePristupa(profil({ kompExpiresAt: zaDana(-31) }), null, SADA);
  check(p.pun === false && p.cita === false, "zaključan: ni troši ni čita");
}
check(
  stanjePristupa(profil({ kompExpiresAt: zaDana(1) }), null, SADA).stanje === "komp",
  "komp sa rokom u budućnosti → komp",
);

// ── 3. pretplata ───────────────────────────────────────────
console.log("\npretplata");

{
  const pretplatnik = profil({ plan: "pro", planExpiresAt: zaDana(10) });
  const p = stanjePristupa(pretplatnik, pretplata(), SADA);
  check(p.stanje === "aktivan" && p.pun, "aktivna pretplata → aktivan");
  check(p.planLimita === "pro", "limiti se računaju po plaćenom planu");
}

{
  // Ovo je slučaj zbog kog `otkazan` uopšte postoji kao zasebno stanje: period
  // je plaćen do kraja, pa oduzeti pristup danas znači vratiti novac sutra.
  const p = stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(12) }),
    pretplata({ status: "canceled", canceledAt: zaDana(-2), currentPeriodEnd: zaDana(12) }),
    SADA,
  );
  check(p.stanje === "otkazan", "otkazana pretplata sa periodom u budućnosti → otkazan");
  check(p.pun === true && p.cita === true, "otkazan ima PUN pristup, ne grace");
  check(p.stanje === "otkazan" && p.punDo === zaDana(12), "baner dobija tačan datum kraja perioda");
}

// Stripe: otkazivanje zakazano za kraj perioda ostavlja `active` i diže zastavicu.
check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(12) }),
    pretplata({ status: "active", cancelAtPeriodEnd: true }),
    SADA,
  ).stanje === "otkazan",
  "cancel_at_period_end uz status active se čita kao otkazano",
);
check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(12) }),
    pretplata({ status: "active", canceledAt: zaDana(-1) }),
    SADA,
  ).stanje === "otkazan",
  "canceled_at uz status active se čita kao otkazano",
);

check(
  stanjePristupa(
    profil({ plan: "pro", planExpiresAt: zaDana(3) }),
    pretplata({ status: "past_due" }),
    SADA,
  ).stanje === "aktivan",
  "past_due unutar plaćenog perioda → i dalje pun pristup",
);

check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(-2) }),
    pretplata({ status: "canceled", canceledAt: zaDana(-40) }),
    SADA,
  ).stanje === "grace",
  "otkazana pretplata sa isteklim periodom → grace",
);

// ── 4. proba (naplata-stripe.md §7) ────────────────────────
console.log("\nproba");

{
  // Dan 0: `trialing`, `trial_end = +7d`, `plan_expires_at = +7d`.
  const p = stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(7) }),
    pretplata({ status: "trialing", trialEnd: zaDana(7), currentPeriodEnd: zaDana(7) }),
    SADA,
  );
  check(p.stanje === "proba" && p.pun && p.cita, "trialing → proba, pun pristup");
  check(p.stanje === "proba" && p.probaDo === zaDana(7), "proba nosi datum kraja probe");
  check(p.planLimita === "starter", "proba ima limite plana koji je izabrala");
}

check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(7) }),
    pretplata({ status: "trialing", trialEnd: null, currentPeriodEnd: zaDana(7) }),
    SADA,
  ).stanje === "proba" &&
    (stanjePristupa(
      profil({ plan: "starter", planExpiresAt: zaDana(7) }),
      pretplata({ status: "trialing", trialEnd: null, currentPeriodEnd: zaDana(7) }),
      SADA,
    ) as { probaDo?: string }).probaDo === zaDana(7),
  "proba bez trial_end pada na punDo, nikad na prazno",
);

{
  // Otkazana proba: `cancel_at_period_end = true`, status i dalje `trialing`
  // → `otkazan` sa `punDo = trial_end` (§7.1), ne `proba`.
  const p = stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(4) }),
    pretplata({
      status: "trialing",
      trialEnd: zaDana(4),
      currentPeriodEnd: zaDana(4),
      cancelAtPeriodEnd: true,
    }),
    SADA,
  );
  check(p.stanje === "otkazan", "otkazana proba → otkazan, ne proba");
  check(p.stanje === "otkazan" && p.punDo === zaDana(4), "otkazana proba traje do trial_end");
}

// Dan 8, kartica prošla: `active`, novi period. Nije više proba.
check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(30) }),
    pretplata({ status: "active", trialEnd: zaDana(-1), currentPeriodEnd: zaDana(30) }),
    SADA,
  ).stanje === "aktivan",
  "posle probe → aktivan (trial_end u prošlosti ne pravi probu)",
);

// Dan 8, kartica PALA: `past_due`, `plan_expires_at` ostao dan 8 → grace prirodno.
check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(-1) }),
    pretplata({ status: "past_due", trialEnd: zaDana(-1), currentPeriodEnd: zaDana(-1) }),
    SADA,
  ).stanje === "grace",
  "kartica pala posle probe → grace (nije platio)",
);

// `unpaid`/`incomplete`: kao da pretplate nema — plan_expires_at odlučuje.
check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(-2) }),
    pretplata({ status: "incomplete_expired" }),
    SADA,
  ).stanje === "grace",
  "incomplete_expired sa isteklim rokom → grace, ne pun pristup",
);

// ── 5. dopuna ──────────────────────────────────────────────
console.log("\ndopuna");

{
  const p = stanjePristupa(profil({ plan: "komp", kompExpiresAt: zaDana(-5), creditsTopup: 40 }), null, SADA);
  check(p.stanje === "dopuna" && p.pun, "credits_topup > 0 bez pretplate → dopuna, pun pristup");
  check(p.planLimita === "dopuna", "dopuna dobija svoje dnevne limite");
  check(
    PLANS.dopuna.cacheMissPerDay === PLANS.starter.cacheMissPerDay,
    "dopuna deli dnevni osigurač sa Starterom (§1.3)",
  );
}

check(
  stanjePristupa(profil({ kompExpiresAt: zaDana(-90), creditsTopup: 10 }), null, SADA).stanje ===
    "dopuna",
  "kupljen paket vraća pun pristup i posle isteka grace-a",
);
check(
  stanjePristupa(profil({ plan: "pro", planExpiresAt: zaDana(5), creditsTopup: 10 }), pretplata(), SADA)
    .stanje === "aktivan",
  "paket uz aktivnu pretplatu ne pretvara pretplatnika u `dopuna`",
);

// ── 5a. [S28, O3] grace se broji i od registracije ─────────
// Nov nalog dobija `ONBOARDING_CREDITS` u `credits_topup` (0026), dakle ulazi
// kao `dopuna`. Kad ih potroši, nema nijedan plaćen rok — pre S28 bi u tom
// trenutku bio `zakljucan`, sa prospektima koje je maločas otključao iza
// katanca. O3: grace se broji od KASNIJEG od plaćenog roka i registracije.
console.log("\nO3 — grace od registracije");

{
  const nov = profil({ plan: "dopuna", createdAt: zaDana(-1) });

  const saKreditima = stanjePristupa({ ...nov, creditsTopup: ONBOARDING_CREDITS }, null, SADA);
  check(
    saKreditima.stanje === "dopuna" && saKreditima.pun,
    "nov nalog sa kreditima dobrodošlice → dopuna, pun pristup",
  );

  const p = stanjePristupa(nov, null, SADA);
  check(p.stanje === "grace" && p.cita && !p.pun, "potrošeni krediti dobrodošlice → grace, ne zakljucan");
  check(p.punDo === null, "nov nalog u grace-u nema `punDo` — plaćenog roka nikad nije ni bilo");
  check(
    p.citanjeDo === new Date(Date.parse(zaDana(-1)) + GRACE_DAYS * DAN).toISOString(),
    "`citanjeDo` je registracija + GRACE_DAYS",
  );
}

check(
  stanjePristupa(profil({ plan: "dopuna", createdAt: zaDana(-1) }), null, SADA + 28 * DAN).stanje ===
    "grace",
  "29. dan od registracije je još grace",
);
check(
  stanjePristupa(profil({ plan: "dopuna", createdAt: zaDana(-1) }), null, SADA + 30 * DAN).stanje ===
    "zakljucan",
  "31. dan od registracije → zakljucan",
);

// Registracija ne sme da PRODUŽI grace pretplatniku: kod njega je `punDo`
// uvek kasniji, pa se ništa ne menja. Nalog registrovan pre dve godine kome je
// plan istekao pre 40 dana ostaje zaključan.
check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(-40), createdAt: zaDana(-700) }),
    null,
    SADA,
  ).stanje === "zakljucan",
  "star nalog sa isteklim planom ostaje zakljucan — registracija ga ne vraća",
);
{
  const p = stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(-2), createdAt: zaDana(-700) }),
    null,
    SADA,
  );
  check(
    p.stanje === "grace" && p.citanjeDo === citanjeDoZa(zaDana(-2)),
    "pretplatniku u grace-u `citanjeDo` i dalje ide od plaćenog roka, ne od registracije",
  );
}

// Obrnut redosled: nalog koji je plan kupio pa mu je istekao PRE nego što je
// grace od registracije prošao — merodavan je kasniji od dva, dakle plan.
check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(-1), createdAt: zaDana(-20) }),
    null,
    SADA,
  ).citanjeDo === citanjeDoZa(zaDana(-1)),
  "kad su oba u igri, grace ide od kasnijeg (plan, ne registracija)",
);

// ── 6. ko sme paket ────────────────────────────────────────
console.log("\npaket");
check(
  STANJA_ZA_PAKET.includes("komp") && STANJA_ZA_PAKET.includes("proba") && !STANJA_ZA_PAKET.includes("dopuna"),
  "paket smeju komp i proba, ne sme dopuna",
);

// ── 7. sitnice koje ruše kapiju ────────────────────────────
console.log("\notpornost");

check(
  stanjePristupa(profil({ plan: "izmisljen", kompExpiresAt: zaDana(5) }), null, SADA).planLimita ===
    "dopuna",
  "nepoznat plan iz baze pada na podrazumevani (`dopuna`), ne ruši kapiju",
);

// [S20] Podrazumevani plan više NIJE `beta`/`komp`. Dok je bio, nepoznata
// vrednost u koloni je uz prazan rok davala NEOGRANIČEN pristup.
check(
  stanjePristupa(profil({ plan: "izmisljen" }), null, SADA).stanje === "zakljucan",
  "nepoznat plan uz prazan rok NIJE neograničen komp",
);
check(
  stanjePristupa(profil({ plan: null }), null, SADA).stanje === "zakljucan",
  "prazan plan uz prazan rok NIJE neograničen komp",
);
check(
  stanjePristupa(profil({ plan: "beta" }), null, SADA).stanje === "zakljucan",
  "zaostala vrednost `beta` u koloni NIJE pristup (0025 je prepisuje u `komp`)",
);
check(
  stanjePristupa(profil({ plan: "komp", kompExpiresAt: "ovo-nije-datum" }), null, SADA).stanje ===
    "zakljucan",
  "neispravan datum se ponaša kao da ga nema — nikad kao neograničen pristup",
);
check(
  stanjePristupa(
    profil({ plan: "starter", kompExpiresAt: zaDana(20), planExpiresAt: zaDana(2) }),
    pretplata({ currentPeriodEnd: zaDana(2) }),
    SADA,
  ).punDo === zaDana(20),
  "pun pristup ide do KASNIJEG od dva roka (max, ne poslednji upisan)",
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
