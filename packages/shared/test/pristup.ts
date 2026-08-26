// packages/shared/test/pristup.ts
// Pokretanje: pnpm --filter @sajtoskop/shared test  (ili `pnpm test` iz korena)
//
// [S19] `stanjePristupa()` je jedini izvor istine o tome ko sme unutra. Sve što
// kapije, baneri i modal rade jeste da pročitaju `stanje`, `pun` i `cita` — pa
// je ovo mesto na kome se greška u pristupu hvata, a ne u pet komponenti.
//
// Trenutak se PROSLEĐUJE (funkcija nema `Date.now()` u telu), pa se „istekla
// juče" i „za 31 dan" proveravaju bez laganja sistemskog sata.

import { GRACE_DAYS, PLANS, stanjePristupa, type PretplataZaPristup, type ProfilZaPristup } from "../src/index";

let fail = 0;
function check(ok: boolean, line: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
}

const SADA = Date.parse("2026-08-21T12:00:00.000Z");
const DAN = 24 * 60 * 60 * 1000;
const zaDana = (n: number) => new Date(SADA + n * DAN).toISOString();

function profil(over: Partial<ProfilZaPristup> = {}): ProfilZaPristup {
  return { plan: "beta", betaExpiresAt: null, planExpiresAt: null, creditsTopup: 0, ...over };
}

function pretplata(over: Partial<PretplataZaPristup> = {}): PretplataZaPristup {
  return { status: "active", currentPeriodEnd: null, canceledAt: null, ...over };
}

// ── 1. neograničena beta ───────────────────────────────────
console.log("\nneograničena beta");

{
  const p = stanjePristupa(profil(), null, SADA);
  check(p.stanje === "beta" && p.pun && p.cita, "beta_expires_at NULL → beta, pun pristup");
  check(p.punDo === null && p.citanjeDo === null, "neograničena beta nema nijedan datum");
}

// Kredita nema, a pristup ostaje: novčanik i pristup su dve različite kapije.
// Bez ovoga bi „nemaš kredita" postalo „nemaš nalog", i to na dan lansiranja.
check(
  stanjePristupa(profil({ creditsTopup: 0 }), null, SADA).pun,
  "neograničena beta i sa nula kredita ostaje pun pristup",
);

// `null` uz PLAĆEN plan znači „bete nema", ne „neograničeno" — inače bi svaki
// pretplatnik kome pretplata istekne dobio večan pristup.
check(
  stanjePristupa(profil({ plan: "starter", planExpiresAt: zaDana(-1) }), null, SADA).stanje !==
    "beta",
  "beta_expires_at NULL uz plan `starter` NIJE neograničena beta",
);

// ── 2. istek bete: grace pa zaključano ─────────────────────
console.log("\nistek bete");

{
  const juce = profil({ betaExpiresAt: zaDana(-1) });
  const p = stanjePristupa(juce, null, SADA);
  check(p.stanje === "grace", "beta istekla juče → grace");
  check(p.pun === false && p.cita === true, "grace: ne troši, ali čita");
  check(
    p.stanje === "grace" && Date.parse(p.citanjeDo) === Date.parse(zaDana(-1)) + GRACE_DAYS * DAN,
    `grace traje tačno ${GRACE_DAYS} dana od isteka`,
  );
}

check(
  stanjePristupa(profil({ betaExpiresAt: zaDana(-1) }), null, SADA + 28 * DAN).stanje === "grace",
  "29 dana posle isteka → i dalje grace",
);
// Granica je zatvorena: u sekundi u kojoj grace ističe pristup je već zaključan.
check(
  stanjePristupa(profil({ betaExpiresAt: zaDana(-1) }), null, SADA + 29 * DAN).stanje ===
    "zakljucan",
  "tačno na isteku grace-a → zaključan (granica se ne prašta)",
);
check(
  stanjePristupa(profil({ betaExpiresAt: zaDana(-31) }), null, SADA).stanje === "zakljucan",
  "31 dan posle isteka → zaključan",
);
{
  const p = stanjePristupa(profil({ betaExpiresAt: zaDana(-31) }), null, SADA);
  check(p.pun === false && p.cita === false, "zaključan: ni troši ni čita");
}
check(
  stanjePristupa(profil({ betaExpiresAt: zaDana(1) }), null, SADA).stanje === "beta",
  "beta sa rokom u budućnosti → beta",
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

check(
  stanjePristupa(
    profil({ plan: "starter", planExpiresAt: zaDana(12) }),
    pretplata({ status: "active", canceledAt: zaDana(-1) }),
    SADA,
  ).stanje === "otkazan",
  "zakazano otkazivanje (status active + canceled_at) se čita isto kao otkazano",
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

// ── 4. dopuna ──────────────────────────────────────────────
console.log("\ndopuna");

{
  const p = stanjePristupa(profil({ plan: "beta", betaExpiresAt: zaDana(-5), creditsTopup: 40 }), null, SADA);
  check(p.stanje === "dopuna" && p.pun, "credits_topup > 0 bez pretplate → dopuna, pun pristup");
  check(p.planLimita === "dopuna", "dopuna dobija svoje dnevne limite");
  check(
    PLANS.dopuna.cacheMissPerDay === PLANS.starter.cacheMissPerDay,
    "dopuna deli dnevni osigurač sa Starterom (§1.3)",
  );
}

check(
  stanjePristupa(profil({ betaExpiresAt: zaDana(-90), creditsTopup: 10 }), null, SADA).stanje ===
    "dopuna",
  "kupljen paket vraća pun pristup i posle isteka grace-a",
);
check(
  stanjePristupa(profil({ plan: "pro", planExpiresAt: zaDana(5), creditsTopup: 10 }), pretplata(), SADA)
    .stanje === "aktivan",
  "paket uz aktivnu pretplatu ne pretvara pretplatnika u `dopuna`",
);

// ── 5. sitnice koje ruše kapiju ────────────────────────────
console.log("\notpornost");

check(
  stanjePristupa(profil({ plan: "izmisljen", betaExpiresAt: zaDana(5) }), null, SADA).planLimita ===
    "dopuna",
  "nepoznat plan iz baze pada na podrazumevani (`dopuna`), ne ruši kapiju",
);

// [S20] Podrazumevani plan više NIJE `beta`. Dok je bio, nepoznata vrednost u
// koloni je uz `beta_expires_at IS NULL` davala NEOGRANIČEN pristup — dakle
// tipfeler u bazi je bio doživotan besplatan nalog. Ovo je ta rupa, zatvorena.
check(
  stanjePristupa(profil({ plan: "izmisljen" }), null, SADA).stanje === "zakljucan",
  "nepoznat plan uz prazan rok NIJE neograničena beta",
);
check(
  stanjePristupa(profil({ plan: null }), null, SADA).stanje === "zakljucan",
  "prazan plan uz prazan rok NIJE neograničena beta",
);
check(
  stanjePristupa(profil({ plan: "beta", betaExpiresAt: "ovo-nije-datum" }), null, SADA).stanje ===
    "zakljucan",
  "neispravan datum se ponaša kao da ga nema — nikad kao neograničen pristup",
);
check(
  stanjePristupa(
    profil({ plan: "starter", betaExpiresAt: zaDana(20), planExpiresAt: zaDana(2) }),
    pretplata({ currentPeriodEnd: zaDana(2) }),
    SADA,
  ).punDo === zaDana(20),
  "pun pristup ide do KASNIJEG od dva roka (max, ne poslednji upisan)",
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
