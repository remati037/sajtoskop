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
  ALL_PRICE_IDS,
  CREDIT_PACKS,
  PLAN_PRICE_IDS,
  sledecaDodelaKredita,
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
  check(/404\s*\)/.test(kod), "nalog bez Paddle kupca dobija 404");
  check(!/\b403\b/.test(bezKomentara(kod)), "nigde 403 — postojanje portala se ne otkriva");
  check(
    kod.includes("urls.general.overview") && !/json\(\s*(sesija|session)\s*[,)]/.test(kod),
    "nazad ide samo URL, ne ceo objekat sesije",
  );
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

  const dugme = izvor("components/portal-dugme.tsx");
  check(
    dugme.includes('method: "POST"') && !/useEffect/.test(dugme),
    "link se traži na klik, ne pri renderu (sesija je jednokratna)",
  );
}

// ── 3. paketi na cenovniku ─────────────────────────────────
console.log("\npaketi kredita");

{
  const ekran = izvor("components/cenovnik-ekran.tsx");

  check(ekran.includes('id="paketi"'), "sidro `#paketi` postoji (linkovi iz S19 vode ovamo)");
  check(ekran.includes("PAKETI.map"), "oba paketa se crtaju iz `plans.ts`, ne ručno");
  check(
    ekran.includes("SVI_PRICE_ID.map") &&
      (bezKomentara(ekran).match(/\.PricePreview\(/g) ?? []).length === 1,
    "i dalje JEDAN `PricePreview()` poziv za sve cene",
  );
  check(
    /Krediti iz paketa ne ističu/.test(ekran.replace(/<[^>]+>/g, "")),
    "kopija kaže da krediti iz paketa ne ističu",
  );
  check(
    ekran.includes("Paket nije zamena za plan") && ekran.includes("Pretplata nije uslov"),
    "kopija kaže i da paket nije zamena za plan i da se kupuje bez pretplate",
  );
  // Jedno primarno dugme po ekranu (§7.1): ono je na istaknutom planu, pa
  // paketi moraju da ostanu sekundarni.
  check(
    (ekran.match(/variant="primary"/g) ?? []).length === 0 &&
      ekran.includes('tier.featured ? "primary" : "secondary"'),
    "paketi nemaju primarno dugme — ono ostaje na istaknutom planu",
  );

  // Katalog: cene paketa moraju da budu u istom spisku koji ide u PricePreview,
  // inače se sekcija nacrta bez ijedne cifre.
  for (const [id, p] of Object.entries(CREDIT_PACKS)) {
    check(ALL_PRICE_IDS.includes(p.priceId), `paket ${id} je u ALL_PRICE_ID`);
  }
  check(
    ALL_PRICE_IDS.length === Object.values(PLAN_PRICE_IDS).length * 2 + 2,
    `ALL_PRICE_ID ima 8 cena (${ALL_PRICE_IDS.length})`,
  );
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
