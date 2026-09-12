// packages/shared/test/feedback-katalog.ts
// Katalog pitanja (F11 §2, S29 §5.3). Pokretanje: pnpm --filter @sajtoskop/shared test
//
// Pravilo 16 doslovno: pitanje ne postoji dok nije ovde, a `answers` prolazi
// Zod šemom IZ kataloga, po ključu. Ovaj fajl je jedino mesto na kom se to
// proverava bez baze i bez Next-a.

import type { Uslovi } from "../src/index";
import {
  KATALOG,
  opisOdgovora,
  PITANJE_KLJUCEVI,
  pitanjeZaKljuc,
  proveriOdgovor,
  ROK_PITANJA,
  sledecePitanje,
  vaziPitanje,
} from "../src/index";

let fail = 0;

function check(ok: boolean, line: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
}

const DAN_MS = 24 * 60 * 60 * 1000;
const mirno = { pitanoUSesiji: false, ekranMiran: true, odUcitavanjaMs: 120_000 };
const prazno = { cooldownUntil: null, mutedUntil: null, dismissStreak: 0, poPitanju: {} };

// ── provera odgovora ───────────────────────────────────────

console.log("katalog: provera odgovora");
check(proveriOdgovor("prva-lista", { odgovor: "jeste" }).ok, "poznat odgovor prolazi");
check(!proveriOdgovor("prva-lista", { odgovor: "mozda" }).ok, "nepoznata vrednost pada");
check(!proveriOdgovor("prva-lista", { odgovor: "jeste", x: 1 }).ok, "nepoznat ključ pada");
check(!proveriOdgovor("izmisljeno", { odgovor: "jeste" }).ok, "pitanje van kataloga pada");
check(!proveriOdgovor("prazan-rezultat", { tekst: "a" }).ok, "prekratak tekst pada");
check(proveriOdgovor("prazan-rezultat", { tekst: "bravar u Loznici" }).ok, "tekst prolazi");

// Drugi korak i čipovi prolaze KROZ ISTU šemu, jer se na serveru spajaju sa
// prvim odgovorom pa se proverava spoj (pravilo 16).
check(
  proveriOdgovor("prvi-potpisan", { odgovor: "presudno", preporuka: "da" }).ok,
  "drugi korak (preporuka) prolazi istu šemu",
);
check(
  !proveriOdgovor("prvi-potpisan", { odgovor: "presudno", preporuka: "možda" }).ok,
  "nepoznata vrednost drugog koraka pada",
);
check(
  proveriOdgovor("tacnost-podataka", { odgovor: "ponesto", netacno: ["telefon", "mejl"] }).ok,
  "čipovi uz odgovor ponesto prolaze",
);
check(
  !proveriOdgovor("tacnost-podataka", { odgovor: "sve-tacno", netacno: ["telefon"] }).ok,
  "odgovor sve-tacno sa spiskom netačnih polja pada",
);
check(
  !proveriOdgovor("tacnost-podataka", { odgovor: "ponesto", netacno: ["adresa"] }).ok,
  "nepoznat čip pada",
);

// ── S29: pitanje o ceni je obrisano ────────────────────────
// Nije prekrečeno nego uklonjeno: naplata postoji, pa opseg u RSD više nije
// procena nego pogrešna brojka. Ruta ga od sada odbija sa 400.

console.log("\nkatalog: cena je otišla");
check(pitanjeZaKljuc("cena") === null, "pitanja `cena` više nema u katalogu");
check(!PITANJE_KLJUCEVI.includes("cena"), "`cena` nije ni u spisku ključeva");
check(!proveriOdgovor("cena", { odgovor: "1990-3900" }).ok, "odgovor o ceni sada pada kao nepoznat");

// ── S29 §5.3 A: nps-7 ──────────────────────────────────────

console.log("\nkatalog: nps-7");
const nps = pitanjeZaKljuc("nps-7");
check(nps !== null, "nps-7 postoji u katalogu");

if (nps) {
  check(nps.opcije.length === 11, "skala ima 11 opcija (0–10)");
  check(
    nps.opcije.every((o, i) => o.vrednost === String(i) && o.label === String(i)),
    "opcije idu 0…10 redom",
  );
  check(nps.kljucOdgovora === "ocena", "prvi odgovor ide pod ključ `ocena`, ne `odgovor`");
  check(nps.bezNagrade === true, "ocena se ne plaća kreditom");
  check(nps.oblik === "kartica" && nps.sloj === "kampanja", "kampanjska kartica");

  // Cela skala prolazi, ništa van nje.
  for (let i = 0; i <= 10; i++) {
    if (!proveriOdgovor("nps-7", { ocena: String(i) }).ok) {
      fail++;
      console.log(`✗ ocena ${i} bi morala da prođe`);
    }
  }
  console.log("✓ svih 11 ocena (0–10) prolazi");

  check(!proveriOdgovor("nps-7", { ocena: 11 }).ok, "ocena 11 pada");
  check(!proveriOdgovor("nps-7", { ocena: -1 }).ok, "negativna ocena pada");
  check(!proveriOdgovor("nps-7", { ocena: 7.5 }).ok, "decimalna ocena pada");
  check(!proveriOdgovor("nps-7", { odgovor: "9" }).ok, "ocena pod pogrešnim ključem pada");
  check(!proveriOdgovor("nps-7", {}).ok, "odgovor bez ocene pada");

  // Kartica šalje string; u bazu mora da uđe broj, jer ga `admin_nps()` sabira.
  const ishod = proveriOdgovor("nps-7", { ocena: "9" });
  check(ishod.ok && ishod.answers.ocena === 9, "vrednost iz kartice ulazi kao BROJ, ne string");
  check(ishod.ok && opisOdgovora(nps, ishod.answers) === "9/10", "opis nosi skalu, ne „ocena 9/3”");

  // Uslov iz §5.3 A: 7 dana i bar jedno otključavanje.
  const rok = Date.parse(`${nps.do}T23:59:59.999Z`);
  const kad = rok - 30 * DAN_MS;
  const puno: Uslovi = { danaOdRegistracije: 7, otkljucano: 1, danaPauze: 0 };

  check(
    sledecePitanje(prazno, { ...mirno, uslovi: puno }, [nps], kad)?.kljuc === "nps-7",
    "7 dana i 1 otključan → kartica prolazi",
  );
  check(
    sledecePitanje(
      prazno,
      { ...mirno, uslovi: { ...puno, otkljucano: 0 } },
      [nps],
      kad,
    ) === null,
    "nijedan otključan → nema NPS-a (nema šta da oceni)",
  );
  check(
    sledecePitanje(
      prazno,
      { ...mirno, uslovi: { ...puno, danaOdRegistracije: 6 } },
      [nps],
      kad,
    ) === null,
    "šesti dan → nema NPS-a",
  );
  check(
    sledecePitanje(prazno, mirno, [nps], kad) === null,
    "bez stanja naloga kampanjsko pitanje otpada",
  );
  check(
    sledecePitanje(prazno, { ...mirno, uslovi: puno }, [nps], rok + 1000) === null,
    "istekao rok ćuti pitanje i kad je uslov ispunjen",
  );
}

// ── S29 §5.3 C: fali ───────────────────────────────────────

console.log("\nkatalog: fali");
const fali = pitanjeZaKljuc("fali");
check(fali !== null, "fali postoji u katalogu");

if (fali) {
  check(fali.tekstPrvi === true, "tekst je PRVI korak — klik tu ne nosi informaciju");
  check(fali.opcije.length === 0, "nema ponuđenih opcija");
  check(fali.uslov === undefined, "nema uslova nad nalogom — okida ga ekran");
  check(fali.ponovi?.naSati === 24, "ponavlja se najviše jednom na 24 h");
  check(fali.oblik === "mikro", "mikro-traka ispod praznog stanja");

  check(!proveriOdgovor("fali", {}).ok, "odgovor bez teksta pada");
  check(!proveriOdgovor("fali", { tekst: "a" }).ok, "prekratak tekst pada");
  check(proveriOdgovor("fali", { tekst: "filter po recenzijama" }).ok, "tekst prolazi");
  check(
    proveriOdgovor("fali", { tekst: "nema te niše", query: "bravar Loznica" }).ok,
    "tekst uz upit iz combobox-a prolazi",
  );
  check(
    !proveriOdgovor("fali", { tekst: "nema te niše", route: "/pretraga" }).ok,
    "ruta u odgovoru pada — nju čita server, ne klijent",
  );

  const saUpitom = proveriOdgovor("fali", { tekst: "nema niše", query: "bravar" });
  check(
    saUpitom.ok && opisOdgovora(fali, saUpitom.answers).includes("tražio: bravar"),
    "opis nosi i ono što je čovek tražio",
  );
}

// ── S29 §5.3 B: citat na `prvi-potpisan` ───────────────────

console.log("\nkatalog: citat");
const potpisan = pitanjeZaKljuc("prvi-potpisan");
check(potpisan?.treciKorak?.kljucOdgovora === "citat", "treći korak upisuje `citat`");
check(potpisan?.treciKorak?.kadDrugi === "da", "treći korak se otvara samo posle „Da”");
check(
  potpisan?.treciKorak?.opcije.map((o) => o.vrednost).join(",") === "da-ime,da-bez,ne",
  "tri ponuđena odgovora: da-ime · da-bez · ne",
);
check(potpisan?.dopuna !== undefined, "uz citat ide i polje za rečenicu koja se citira");

check(
  proveriOdgovor("prvi-potpisan", { odgovor: "presudno", preporuka: "da", citat: "da-ime" }).ok,
  "citat posle preporuka=da prolazi",
);
check(
  proveriOdgovor("prvi-potpisan", { odgovor: "pomoglo", preporuka: "da", citat: "ne" }).ok,
  "„radije ne” je i dalje validan odgovor trećeg koraka",
);
check(
  !proveriOdgovor("prvi-potpisan", { odgovor: "presudno", preporuka: "ne", citat: "da-ime" }).ok,
  "citat uz preporuka=ne pada — to je citat koji ne smem da objavim",
);
check(
  !proveriOdgovor("prvi-potpisan", { odgovor: "presudno", preporuka: "mozda", citat: "da-bez" }).ok,
  "citat uz preporuka=mozda pada",
);
check(
  !proveriOdgovor("prvi-potpisan", { odgovor: "presudno", citat: "da-ime" }).ok,
  "citat bez drugog koraka pada",
);
check(
  !proveriOdgovor("prvi-potpisan", { odgovor: "presudno", preporuka: "da", citat: "mozda" }).ok,
  "nepoznata vrednost citata pada",
);

// ── rok ────────────────────────────────────────────────────

console.log("\nkatalog: rok");
check(
  KATALOG.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.do)),
  "svako pitanje u katalogu ima rok (`do:`)",
);
check(
  KATALOG.every((p) => p.do === ROK_PITANJA),
  `sva pitanja nose isti rok (${ROK_PITANJA}) — jedan datum, ne sedam`,
);

const prvaLista = pitanjeZaKljuc("prva-lista");
if (prvaLista) {
  const rok = Date.parse(`${prvaLista.do}T23:59:59.999Z`);
  check(vaziPitanje(prvaLista, rok - DAN_MS), "pitanje važi dan pre roka");
  check(vaziPitanje(prvaLista, rok), "pitanje važi do kraja poslednjeg dana");
  check(!vaziPitanje(prvaLista, rok + 1000), "posle roka pitanje za motor ne postoji");
}

// Ključevi su izvedeni iz kataloga — spisak koji se održava ručno se raziđe.
check(
  PITANJE_KLJUCEVI.length === KATALOG.length &&
    KATALOG.every((p) => PITANJE_KLJUCEVI.includes(p.kljuc)),
  "PITANJE_KLJUCEVI se izvodi iz kataloga",
);
check(
  new Set(PITANJE_KLJUCEVI).size === PITANJE_KLJUCEVI.length,
  "nijedan ključ se ne ponavlja",
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
