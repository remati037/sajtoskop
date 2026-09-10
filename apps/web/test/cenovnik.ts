// apps/web/test/cenovnik.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S21] Cenovnik sa paketima, stanje pretplate i portal.
//
// Tri stvari koje su u ovoj isporuci mogle tiho da se pokvare, i nijedna se ne
// vidi kroz `tsc`:
//
//   1. DATUM SLEDEĆE DODELE. `sledecaDodelaKredita()` piše korisniku kad mu se
//      obnavlja kasa koja ističe. Prelazak sa decembra na januar i vremenska
//      zona su dve klasične greške koje daju datum u prošlosti ili 31. u mesecu
//      koji nema 31.
//   2. PORTAL. Ruta koja pravi jednokratan link ka tuđim podacima o naplati sme
//      da uzme kupca ISKLJUČIVO iz sesije, mora da vrati `404` (ne `403`) kad
//      kupca nema, i ne sme da vrati ceo objekat sesije. Provera je statička
//      (čita izvor), jer regresija koje se plašim nije „ruta je vratila
//      pogrešan status" nego „neko je dopisao `customerId` u telo zahteva".
//   3. ŽICE KA `/cenovnik`. Do S21 ih je bilo nula, a dva linka iz S19 su
//      pokazivala na sidro `#paketi` koje nije postojalo. Ovo je tačno vrsta
//      stvari koju niko ne primeti dok neko ne ostane bez kredita.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ALL_LOOKUP_KEYS,
  CREDIT_PACKS,
  formatEur,
  kupovinaZaLookupKey,
  PLAN_PRICES,
  sledecaDodelaKredita,
  smeDaKupiPaket,
  stanjePristupa,
  STANJA_ZA_PAKET,
  type StanjeId,
} from "@sajtoskop/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");
const izvor = (rel: string) => readFileSync(path.join(webSrc, rel), "utf8");

/**
 * Isti fajl bez komentara.
 *
 * Postoji zato što ovi testovi tvrde nešto o KODU, a komentari u ovom
 * repozitorijumu objašnjavaju baš ono što se proverava — „zašto 404, a ne 403"
 * stoji u zaglavlju rute i naivan `includes("403")` bi ga našao. Provera koja
 * pada na sopstveno objašnjenje je gora od provere koje nema: uči te da je
 * ignorišeš.
 */
const bezKomentara = (kod: string) =>
  kod
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ── 1. datum sledeće mesečne dodele ────────────────────────
console.log("sledeća dodela kredita");

/** Dan u mesecu po UTC-u; funkcija vraća podne, pa se dan ne pomera. */
const dan = (iso: string) => new Date(iso).getUTCDate();
const mesec = (iso: string) => new Date(iso).getUTCMonth() + 1;
const godina = (iso: string) => new Date(iso).getUTCFullYear();

{
  const usred = sledecaDodelaKredita(new Date("2026-08-23T10:00:00.000Z"));
  check(dan(usred) === 1 && mesec(usred) === 9 && godina(usred) === 2026, "avgust → 1. septembar");

  // Mesec sa 31 danom pred mesecom sa 30: naivno „+30 dana" bi dalo 31.
  const januar = sledecaDodelaKredita(new Date("2026-01-31T10:00:00.000Z"));
  check(dan(januar) === 1 && mesec(januar) === 2, "31. januar → 1. februar, ne 31.");

  // Prelazak godine — jedina grana koja menja i godinu.
  const decembar = sledecaDodelaKredita(new Date("2026-12-15T10:00:00.000Z"));
  check(
    dan(decembar) === 1 && mesec(decembar) === 1 && godina(decembar) === 2027,
    "decembar → 1. januar naredne godine",
  );

  // Kasno veče 31.12. po UTC-u je već 1.1. u Beogradu, a dodela ide po
  // beogradskom kalendaru (`CREDITS_TIMEZONE`). Bez toga bi korisniku 1.
  // januara pisalo da mu se krediti obnavljaju „1. januar" — datum koji je
  // upravo prošao.
  const nocPreNove = sledecaDodelaKredita(new Date("2026-12-31T23:30:00.000Z"));
  check(
    mesec(nocPreNove) === 2 && godina(nocPreNove) === 2027,
    "31.12. u 23.30 UTC je već januar u Beogradu → sledeća dodela je februar",
  );

  // Datum uvek u budućnosti — to je jedina tvrdnja koja mora da važi UVEK.
  const sada = Date.now();
  check(Date.parse(sledecaDodelaKredita()) > sada, "sledeća dodela je uvek u budućnosti");
}

// ── 2. portal ──────────────────────────────────────────────
console.log("\nportal");

{
  const kod = izvor("app/api/billing/portal/route.ts");

  check(kod.includes("requireUserId()"), "kupac se izvodi iz Clerk sesije");
  check(
    !/req\.json\(\)|request\.json\(\)|searchParams/.test(kod),
    "telo i query se NE čitaju — nema `customerId` spolja (pravilo 8)",
  );
  check(/404\s*\)/.test(kod), "nalog bez Stripe kupca dobija 404");
  check(!/\b403\b/.test(bezKomentara(kod)), "nigde 403 — postojanje portala se ne otkriva");
  check(
    kod.includes("billingPortal.sessions.create") &&
      kod.includes("url: sesija.url") &&
      !/json\(\s*(sesija|session)\s*[,)]/.test(kod),
    "nazad ide samo URL, ne ceo objekat sesije",
  );
  check(kod.includes("return_url") && kod.includes('appUrl("/krediti")'), "portal se vraća na /krediti, kroz appUrl (nikad window.location)");
  check(kod.includes("proveriIpTempo"), "ruta ima IP tempo kao i checkout");

  // Nepodešena naplata NIJE prolazan kvar. Ruta koja na praznu env promenljivu
  // kaže „pokušaj ponovo za koji minut" šalje čoveka u petlju osvežavanja nad
  // nečim što neće proraditi samo od sebe — a pravi razlog ostane samo u logu.
  for (const [ime, put] of [
    ["portal", "app/api/billing/portal/route.ts"],
    ["checkout", "app/api/billing/checkout/route.ts"],
  ] as const) {
    const r = izvor(put);
    check(
      r.includes("err instanceof KonfigGreska") && /503,?\s*\)/.test(r),
      `${ime} razdvaja nepodešenu naplatu (503) od pravog kvara (502)`,
    );
    check(
      !/greska\(\s*(err|String\(err)/.test(r),
      `${ime} ne prosleđuje tekst greške korisniku (nosi imena env promenljivih)`,
    );
  }
  check(kod.includes('"nodejs"'), "runtime je nodejs — SDK ne radi na edge-u");
  check(!/customerPortalSessions|merchant of record/i.test(kod), "portal ne zna za starog provajdera");

  const dugme = izvor("components/portal-dugme.tsx");
  check(
    dugme.includes('method: "POST"') && !/useEffect/.test(dugme),
    "link se traži na klik, ne pri renderu (sesija je jednokratna)",
  );
}

// ── 2b. profil pre novca ───────────────────────────────────
console.log("\nprofil pre naplate");

{
  const kod = izvor("app/api/billing/checkout/route.ts");

  // Izmereno na pravoj kupovini: webhook je stigao 14 s PRE nego što je red u
  // `profiles` nastao, jer se gost registrovao na `/cenovnik` — a ta strana je
  // izvan grupe `(app)`, pa `ensureProfile()` iz layouta nikad nije ni pozvan.
  // Bez profila `nadjiKorisnika()` vrati `null`, webhook to prijavi kao TRAJAN
  // neuspeh (200, bez ponavljanja) i naplaćeni krediti se izgube.
  check(kod.includes("ensureProfile("), "checkout pravi profil pre sesije");

  // Redosled je cela poenta: `ensureProfile` mora da bude PRE `checkout.sessions.create`.
  const iProfil = kod.indexOf("ensureProfile(");
  const iSesija = kod.indexOf("checkout.sessions.create(");
  check(
    iProfil > 0 && iSesija > 0 && iProfil < iSesija,
    "ensureProfile ide PRE nego što Checkout sesija nastane",
  );

  // Webhook, nasuprot tome, NE sme da pravi profile: identitet mu dolazi iz
  // Stripe payload-a, ne iz verifikovane sesije (pravilo 8).
  check(
    !izvor("app/api/billing/webhook/route.ts").includes("ensureProfile"),
    "webhook NE pravi profile (identitet mu nije iz sesije)",
  );

  // [S25] Identitet kupca ide u `client_reference_id` i `metadata.user_id`,
  // kartica pre probe (D2), i nijedan `price_` u kodu.
  check(kod.includes("client_reference_id: userId"), "sesija nosi client_reference_id iz Clerk sesije");
  check(kod.includes('payment_method_collection: "always"'), "kartica PRE probe (D2)");
  check(kod.includes("trial_period_days: TRIAL_DAYS"), "proba iz TRIAL_DAYS, ne upisan broj");
  check(kod.includes("imaoProbuRanije("), "drugu probu isti nalog ne dobija");
  check(!/price_[0-9A-Za-z]{8}/.test(kod) && kod.includes("priceIdZa("), "nijedan price_ ID u kodu — ključ ide kroz stripe-katalog");
  check(kod.includes('appUrl("/welcome?sesija={CHECKOUT_SESSION_ID}")'), "success_url je apsolutan, kroz appUrl");
}

// ── 3. paketi na cenovniku ─────────────────────────────────
console.log("\npaketi kredita");

{
  const ekran = izvor("components/cenovnik-ekran.tsx");

  check(ekran.includes('id="paketi"'), "sidro `#paketi` postoji (linkovi iz S19 vode ovamo)");
  check(ekran.includes("PAKETI.map"), "oba paketa se crtaju iz `plans.ts`, ne ručno");
  check(
    ekran.includes("formatEur(") && !/PricePreview|initializeP|Checkout\.open/.test(ekran),
    "cifra dolazi iz plans.ts kroz formatEur — nema klijentskog SDK-a naplate",
  );
  check(
    ekran.includes("window.location.assign(odg.url)") && ekran.includes('"/api/billing/checkout"'),
    "klik ide POST /api/billing/checkout → location.assign(url)",
  );
  check(!/price_[0-9A-Za-z]/.test(bezKomentara(ekran)), "nijedan ID cene u ekranu — šalje se slug plana/paketa");
  check(
    /Krediti iz paketa ne ističu/.test(ekran.replace(/<[^>]+>/g, "")),
    "kopija kaže da krediti iz paketa ne ističu",
  );
  check(
    ekran.includes("Paket nije zamena za plan") &&
      ekran.includes("Paket traži aktivan plan ili komp"),
    "kopija kaže i da paket nije zamena za plan i da traži plan",
  );
  // Stara kopija je tvrdila SUPROTNO od pravila koje ruta sada sprovodi. Ostavka
  // takvog teksta na ekranu je obećanje koje checkout odbija sa `403`.
  check(
    !/Pretplata nije uslov|kupuje se i bez plana|se kupuje i sam/.test(ekran),
    "nigde ne piše da se paket kupuje bez plana",
  );
  // Jedno primarno dugme po ekranu (§7.1): ono je na istaknutom planu, pa
  // paketi moraju da ostanu sekundarni.
  //
  // ‼️ Od S24 uslov više nije `tier.featured` nego `istaknut`: namera sa
  //    landinga (`?plan=`) pomera akcenat na IZABRAN plan, a Pro ostaje običan.
  //    Tvrdnja koja se proverava je ista i nije oslabljena — primarnih dugmadi
  //    je i dalje tačno jedno i vezano je za jedan izraz, a ne za više kartica.
  check(
    (ekran.match(/variant="primary"/g) ?? []).length === 0 &&
      ekran.includes('variant={istaknut ? "primary" : "secondary"}'),
    "paketi nemaju primarno dugme — ono ostaje na istaknutom planu",
  );

  // Katalog: svih 8 ključeva, svaki sa iznosom, i `formatEur` bez Intl.
  for (const [id, p] of Object.entries(CREDIT_PACKS)) {
    check(ALL_LOOKUP_KEYS.includes(p.lookupKey), `paket ${id} je u ALL_LOOKUP_KEYS`);
    check(kupovinaZaLookupKey(p.lookupKey)?.kind === "pack", `paket ${id}: ključ → pack`);
  }
  check(
    ALL_LOOKUP_KEYS.length === Object.values(PLAN_PRICES).length * 2 + 2,
    `ALL_LOOKUP_KEYS ima 8 cena (${ALL_LOOKUP_KEYS.length})`,
  );
  check(
    Object.values(PLAN_PRICES).every((c) => c.year.eur === c.month.eur * 10),
    "godišnja cena je 10 mesečnih na sva tri plana (GODISNJI_BONUS)",
  );
  check(formatEur(29) === "€29" && formatEur(1190) === "€1.190", "formatEur: €29, €1.190 (tačka kao razdvajač hiljada)");
  check(kupovinaZaLookupKey("price_nepoznat") === null && kupovinaZaLookupKey(null) === null, "nepoznat ključ → null, nikad podrazumevana kupovina");
}

// ── 3b. ko sme da kupi paket (odluka 26.8.) ────────────────
console.log("\npaket traži pristup");

{
  const SADA = Date.parse("2026-08-26T12:00:00.000Z");
  const DAN = 24 * 60 * 60 * 1000;
  const zaDana = (n: number) => new Date(SADA + n * DAN).toISOString();

  /** Najmanji profil koji daje traženo stanje. */
  const stanje = (id: StanjeId) => {
    const bez = { trialEnd: null, cancelAtPeriodEnd: false };
    switch (id) {
      case "komp":
        return stanjePristupa(
          { plan: "komp", kompExpiresAt: null, planExpiresAt: null, creditsTopup: 0 },
          null,
          SADA,
        );
      case "proba":
        return stanjePristupa(
          { plan: "starter", kompExpiresAt: null, planExpiresAt: zaDana(7), creditsTopup: 0 },
          { status: "trialing", currentPeriodEnd: zaDana(7), trialEnd: zaDana(7), cancelAtPeriodEnd: false, canceledAt: null },
          SADA,
        );
      case "aktivan":
        return stanjePristupa(
          { plan: "pro", kompExpiresAt: null, planExpiresAt: zaDana(10), creditsTopup: 0 },
          { status: "active", currentPeriodEnd: zaDana(10), canceledAt: null, ...bez },
          SADA,
        );
      case "otkazan":
        return stanjePristupa(
          { plan: "pro", kompExpiresAt: null, planExpiresAt: zaDana(10), creditsTopup: 0 },
          { status: "canceled", currentPeriodEnd: zaDana(10), canceledAt: zaDana(-1), ...bez },
          SADA,
        );
      case "dopuna":
        return stanjePristupa(
          { plan: "dopuna", kompExpiresAt: null, planExpiresAt: null, creditsTopup: 50 },
          null,
          SADA,
        );
      case "grace":
        return stanjePristupa(
          { plan: "pro", kompExpiresAt: null, planExpiresAt: zaDana(-5), creditsTopup: 0 },
          null,
          SADA,
        );
      case "zakljucan":
        return stanjePristupa(
          { plan: "pro", kompExpiresAt: null, planExpiresAt: zaDana(-90), creditsTopup: 0 },
          null,
          SADA,
        );
    }
  };

  for (const id of ["aktivan", "otkazan", "komp", "proba"] as StanjeId[]) {
    const p = stanje(id);
    check(p.stanje === id && smeDaKupiPaket(p), `${id} SME da kupi paket`);
  }
  for (const id of ["dopuna", "grace", "zakljucan"] as StanjeId[]) {
    const p = stanje(id);
    check(p.stanje === id && !smeDaKupiPaket(p), `${id} NE sme da kupi paket`);
  }

  // Gost i kvar veze. Namerno suprotno od `odbijenica()`, koja nepoznato stanje
  // propušta: tamo bi zatvaranje značilo da kvar baze izgleda kao istekla
  // pretplata, a ovde bi otvaranje značilo uzet novac mimo pravila.
  check(!smeDaKupiPaket(null), "nepoznato stanje (gost, kvar veze) NE sme — pada zatvoreno");

  check(
    STANJA_ZA_PAKET.length === 4 && !STANJA_ZA_PAKET.includes("dopuna"),
    `spisak stanja je četiri člana (${STANJA_ZA_PAKET.join(", ")})`,
  );

  // ‼️ Kapija koja stvarno drži. Skriveno dugme nije zaštita — telo zahteva se
  //    sastavlja u pregledaču, pa bez ove grane svako ko pošalje slug paketa
  //    dobije sesiju bez obzira na stanje naloga (isti princip kao pravilo 9:
  //    CSS blur nije bezbednost).
  const ruta = izvor("app/api/billing/checkout/route.ts");
  check(
    ruta.includes("smeDaKupiPaket(") && /telo\.vrsta === "paket"/.test(ruta),
    "checkout ruta sprovodi pravilo na serveru, ne samo na ekranu",
  );
  check(/403,?\s*\)/.test(ruta), "odbijenica je 403 (stanje naloga), ne 402 (novčanik)");

  // Ekrani koji su paket nudili kao izlaz ne smeju da ga nude onome ko ne sme.
  check(
    !izvor("app/zakljucano/page.tsx").includes("#paketi"),
    "/zakljucano više ne nudi paket (zaključan nalog ga ne može kupiti)",
  );
  for (const f of [
    "components/pristup-provider.tsx",
    "components/pretplata-blok.tsx",
    "components/okvir-aplikacije.tsx",
  ]) {
    check(izvor(f).includes("smeDaKupiPaket"), `${f} pita sme li nalog da kupi paket`);
  }
}

// ── 4. obe kase i linkovi ka cenovniku ─────────────────────
console.log("\nobe kase i žice ka /cenovnik");

{
  const layout = izvor("app/(app)/layout.tsx");
  check(
    /credits_balance\s*\+\s*profile\.credits_topup/.test(layout),
    "bočna traka dobija ZBIR obe kase",
  );

  const krediti = izvor("app/(app)/krediti/page.tsx");
  check(krediti.includes("PretplataBlok"), "/krediti ima blok pretplate");
  check(
    krediti.includes("credits_balance") && krediti.includes("credits_topup"),
    "/krediti prosleđuje obe kase odvojeno",
  );
  check(
    !/Beta je besplatna dok traje/.test(bezKomentara(krediti)),
    "bezuslovna beta poruka je otišla (od S16 postoji naplata)",
  );

  const dashboard = izvor("app/(app)/dashboard/page.tsx");
  check(
    /credits_balance\s*\+\s*profile\.credits_topup/.test(dashboard),
    "/dashboard pokazuje ZBIR obe kase",
  );
  check(
    !/podnaslov="beta"/.test(dashboard),
    "/dashboard više ne tvrdi da je svaki nalog beta",
  );

  const blok = izvor("components/pretplata-blok.tsx");
  check(
    blok.includes("Iz pretplate") && blok.includes("Dokupljeni"),
    "obe kase su imenovane i razdvojene",
  );
  check(
    (blok.match(/className="num"/g) ?? []).length >= 4,
    "datumi i iznosi u bloku nose `.num`",
  );

  const navigacija = izvor("lib/navigacija.ts");
  check(navigacija.includes('href: "/cenovnik"'), "bočna traka ima stavku ka /cenovnik");

  const okvir = izvor("components/okvir-aplikacije.tsx");
  check(
    okvir.includes("niskoStanje") && okvir.includes("/cenovnik#paketi"),
    "nisko stanje kredita nudi dokupljivanje",
  );

  // Svaki ekran koji vodi na `#paketi` mora da vodi na sidro koje postoji —
  // provereno gore; ovde se broji da linkova ima više od nule.
  const svi = [
    "components/pristup-provider.tsx",
    "app/zakljucano/page.tsx",
    "components/pretplata-blok.tsx",
    "components/okvir-aplikacije.tsx",
  ].filter((f) => izvor(f).includes("/cenovnik"));
  check(svi.length === 4, `linkova ka /cenovnik ima na ${svi.length} od 4 mesta`);
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
