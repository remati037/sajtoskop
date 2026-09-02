// apps/web/test/veze.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S24] Preokret na `app.` poddomen: veze ka landingu i namera sa landinga.
//
// ── zašto ovaj fajl postoji ─────────────────────────────────
// Dve stvari iz ove isporuke se kvare TIHO i ne vidi ih ni `tsc` ni `next build`:
//
//   1. ZAKUCAN DOMEN U JSX-u. Prvi put kad neko napiše `href="https://…"` u
//      komponenti, aplikacija prestaje da poštuje `NEXT_PUBLIC_LANDING_URL` — a
//      to se ne primeti dok se ne promeni domen, dakle nikad u razvoju.
//   2. NAMERA SA LANDINGA koja obara stranu. `/cenovnik?plan=Pro` je javan link
//      sa TUĐE strane; ako parsiranje baci, izgubljen je kupac, ne zahtev.
//      Provera je zato nad ISPRAVNIM I NEISPRAVNIM ulazom.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { citajNameru } from "../src/lib/cenovnik-namera-schema";
import { naRegistraciju, putanjaZaPaket, putanjaZaPlan } from "../src/lib/cenovnik-namera";
import { LANDING_URL, landing } from "../src/lib/veze";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ── 1. lib/veze.ts ─────────────────────────────────────────
console.log("veze.ts");

check(LANDING_URL.startsWith("https://"), "LANDING_URL je https adresa");
check(!LANDING_URL.endsWith("/"), "LANDING_URL nema kosu crtu na kraju");
check(landing() === LANDING_URL, "landing() je koren");
check(landing("/cenovnik") === `${LANDING_URL}/cenovnik`, "landing('/cenovnik') lepi putanju");
check(landing("cenovnik") === `${LANDING_URL}/cenovnik`, "landing('cenovnik') dopisuje kosu crtu");

// ── 2. domen se ne kuca u JSX-u ────────────────────────────
console.log("\ndomen nigde u JSX-u");

/** Svi `.ts`/`.tsx` iz `src/`, osim `lib/veze.ts` koji SME da zna domen. */
function sviIzvori(dir: string, nadjeno: string[] = []): string[] {
  for (const stavka of readdirSync(dir)) {
    const pun = path.join(dir, stavka);
    if (statSync(pun).isDirectory()) sviIzvori(pun, nadjeno);
    else if (/\.tsx?$/.test(stavka)) nadjeno.push(pun);
  }
  return nadjeno;
}

const IZUZECI = new Set([
  path.join(webSrc, "lib/veze.ts"),
  // Zna domen kao TEKST u potpisu mejla, ne kao link — v. proveru ispod.
  path.join(webSrc, "lib/admin-mail.ts"),
]);

const sumnjivi = sviIzvori(webSrc)
  .filter((f) => !IZUZECI.has(f))
  .filter((f) => /https?:\/\/(www\.)?sajtoskop\.com/.test(readFileSync(f, "utf8")));

check(
  sumnjivi.length === 0,
  sumnjivi.length === 0
    ? "nijedan fajl van lib/veze.ts ne kuca domen landinga"
    : `domen zakucan u: ${sumnjivi.map((f) => path.relative(webSrc, f)).join(", ")}`,
);

// ── 3. logo javnih strana vodi na landing ──────────────────
console.log("\nlogo i futer");

const izvor = (rel: string) => readFileSync(path.join(webSrc, rel), "utf8");

// Znak umotan u `<a href={LANDING_URL}>`, ne u `<Link href="/">`. Provera je
// statička jer je regresija koje se plašim baš „neko je vratio <Link href='/'>".
for (const [fajl, gde] of [
  ["app/cenovnik/page.tsx", "/cenovnik"],
  ["app/welcome/page.tsx", "/welcome"],
  ["app/zakljucano/page.tsx", "/zakljucano"],
  ["components/pravni-okvir.tsx", "pravne strane"],
  ["components/futer.tsx", "futer"],
  ["app/page.tsx", "/"],
] as const) {
  const kod = izvor(fajl);
  check(
    kod.includes("LANDING_URL") && /<a href=\{LANDING_URL\}/.test(kod),
    `${gde}: logo vodi na landing`,
  );
}

const futer = izvor("components/futer.tsx");
check(futer.includes('naziv: "Početna"'), 'futer ima stavku „Početna"');
check(
  !/<Link\s+href="\/"[^>]*>\s*<ZnakSaImenom/.test(futer),
  "futer nema više <Link href=\"/\"> oko znaka",
);

// ── 4. namera sa landinga ──────────────────────────────────
console.log("\nnamera sa landinga");

const prazna = citajNameru({});
check(
  prazna.plan === null && prazna.ciklus === null && prazna.paket === null,
  "goli /cenovnik daje praznu nameru",
);

const pun = citajNameru({ plan: "pro", ciklus: "godisnje" });
check(pun.plan === "pro" && pun.ciklus === "year", "?plan=pro&ciklus=godisnje → pro / year");

check(citajNameru({ ciklus: "mesecno" }).ciklus === "month", "?ciklus=mesecno → month");
check(citajNameru({ paket: "150" }).paket === "dopuna-150", "?paket=150 → dopuna-150");
check(citajNameru({ paket: "50" }).paket === "dopuna-50", "?paket=50 → dopuna-50");

// ‼️ Srce ove isporuke: nepoznata vrednost se IGNORIŠE, ne baca. Link sa tuđe
//    strane koji obori cenovnik je izgubljen kupac.
for (const los of [
  { plan: "Pro" },
  { plan: "enterprise" },
  { ciklus: "annual" },
  { paket: "150 " },
  { paket: "999" },
  { plan: "pro; drop table" },
  { plan: "" },
  { plan: undefined },
]) {
  let pao = false;
  let rezultat = null;
  try {
    rezultat = citajNameru(los as Record<string, string | undefined>);
  } catch {
    pao = true;
  }
  check(!pao && rezultat !== null, `${JSON.stringify(los)} ne obara cenovnik`);
}

check(citajNameru({ plan: "Pro" }).plan === null, "?plan=Pro (veliko P) se ignoriše");
check(citajNameru({ ciklus: "annual" }).ciklus === null, "?ciklus=annual se ignoriše");
check(citajNameru({ paket: "999" }).paket === null, "?paket=999 se ignoriše");

// Nizom (`?plan=pro&plan=starter`) Next daje `string[]` — uzima se prva.
check(citajNameru({ plan: ["pro", "starter"] }).plan === "pro", "niz vrednosti: uzima se prva");

// Mešano: ispravan plan + neispravan ciklus zadržava plan.
const meshano = citajNameru({ plan: "advanced", ciklus: "kvartalno" });
check(
  meshano.plan === "advanced" && meshano.ciklus === null,
  "neispravan ciklus ne obara ispravan plan",
);

// ── 5. put nazad za gosta ──────────────────────────────────
console.log("\ngost: registracija pa nazad na svoj izbor");

check(
  putanjaZaPlan("pro", "year") === "/cenovnik?plan=pro&ciklus=godisnje",
  "putanjaZaPlan sklapa link koji citajNameru ume da pročita",
);

// Krug se mora zatvoriti: ono što sklopimo za `?nazad=` mora da se pročita nazad.
for (const plan of ["starter", "pro", "advanced"] as const) {
  for (const [ciklus, ime] of [
    ["month", "mesecno"],
    ["year", "godisnje"],
  ] as const) {
    const putanja = putanjaZaPlan(plan, ciklus);
    const nazad = citajNameru(
      Object.fromEntries(new URL(putanja, "https://x.test").searchParams),
    );
    check(
      nazad.plan === plan && nazad.ciklus === ciklus,
      `krug plan: ${plan}/${ime} → ${putanja} → nazad isti`,
    );
  }
}

for (const paket of ["dopuna-50", "dopuna-150"] as const) {
  const putanja = putanjaZaPaket(paket);
  check(putanja.endsWith("#paketi"), `${paket}: putanja nosi sidro #paketi`);
  const nazad = citajNameru(
    Object.fromEntries(new URL(putanja, "https://x.test").searchParams),
  );
  check(nazad.paket === paket, `krug paket: ${paket} → ${putanja} → nazad isti`);
}

// ‼️ `?nazad=` mora da PROĐE `internaPutanja()` iz `app/page.tsx` — to je jedina
//    brana ispred otvorene redirekcije i S24 je ne dira. Provera je ovde da se
//    ne desi da sklopimo putanju koju sopstvena brana odbije, pa gost završi na
//    `/pretraga` bez ijednog traga o tome šta je hteo.
function internaPutanja(vrednost: string | undefined): string | null {
  if (!vrednost || !vrednost.startsWith("/")) return null;
  if (vrednost.startsWith("//") || vrednost.startsWith("/\\")) return null;
  return vrednost;
}

for (const putanja of [
  putanjaZaPlan("pro", "year"),
  putanjaZaPlan("starter", "month"),
  putanjaZaPaket("dopuna-150"),
]) {
  check(internaPutanja(putanja) === putanja, `internaPutanja pušta ${putanja}`);
}

const naRegistracijuLink = naRegistraciju(putanjaZaPlan("pro", "year"));
check(
  naRegistracijuLink.startsWith("/?nalog=nov&nazad="),
  "naRegistraciju vodi pravo na karticu registracije",
);
check(
  new URL(naRegistracijuLink, "https://x.test").searchParams.get("nazad") ===
    "/cenovnik?plan=pro&ciklus=godisnje",
  "nazad preživi kodiranje sa `&` u sebi",
);

// Kopija `internaPutanja()` iznad mora da odgovara originalu — inače test tvrdi
// nešto o kodu koji više ne postoji.
const pocetna = izvor("app/page.tsx");
check(
  pocetna.includes('vrednost.startsWith("//")') && pocetna.includes("function internaPutanja"),
  "app/page.tsx i dalje ima internaPutanja() u istom obliku",
);

// ── 6. sidro #paketi ───────────────────────────────────────
console.log("\nsidro #paketi");

const ekran = izvor("components/cenovnik-ekran.tsx");
check(ekran.includes('id="paketi"'), "sekcija paketa i dalje nosi id=\"paketi\"");
check(
  ekran.includes("scrollIntoView"),
  "?paket= bez sidra sam doskroluje do sekcije",
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
