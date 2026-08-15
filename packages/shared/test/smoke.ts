// packages/shared/test/smoke.ts
// Jedini test u F0. Pokretanje: pnpm test  (ili: pnpm --filter @sajtoskop/shared test)
//
// Ovde su preseljeni samotestovi koji su ranije stajali na dnu ugly-score.ts i
// translit.ts. Morali su da odu iz src/ jer su uvozili `node:url` — a nijedan fajl
// u packages/shared/src ne sme da dodirne `node:` (F0, sekcija 5).

import type { OutreachInput, UglyBand, Uslovi } from "../src/index";
import {
  bezOblika,
  CENA_OPSEZI,
  cirToLat,
  CITY_SLUGS,
  foldForSearch,
  KATALOG,
  medijanaCene,
  MOTOR,
  napisiPoruke,
  NICHE_SLUGS,
  pitanjeZaKljuc,
  posleOdbacivanja,
  posleOdgovora,
  proveriOdgovor,
  proveriPoruku,
  scoreSite,
  sledecePitanje,
  smeDaSePita,
  vaziPitanje,
} from "../src/index";

let fail = 0;

function check(ok: boolean, line: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
}

// ── ugly score ─────────────────────────────────────────────

const year = new Date().getFullYear();

const modern = `<html><head><meta name="viewport" content="width=device-width">
  <title>Ordinacija</title><meta name="description" content="x">
  <meta property="og:title" content="x"><link rel="icon" href="/f.ico">
  </head><body>${"tekst ".repeat(500)}<p>&copy; ${year}</p></body></html>`;

const meh = `<html><head><title>Ordinacija</title></head>
  <body>${"tekst ".repeat(500)}<p>&copy; ${year - 4}</p></body></html>`;

const ancient = `<html><head><title>Ordinacija</title></head><body>
  <table><tr><td><table><tr><td><table><tr><td>
  <font size="2">Dobrodosli</font></td></tr></table></td></tr></table></td></tr></table>
  <center><font color="red">Akcija</font></center><marquee>Novo!</marquee>
  <script src="/js/jquery-1.7.2.min.js"></script>
  ${"tekst ".repeat(400)}<center>&copy; 2011</center></body></html>`;

// jedan <center> u modernom sajtu ne sme da upali legacy_tags
const modernWithOneCenter = modern.replace("</body>", "<center>Radno vreme</center></body>");

const cases: [string, string, UglyBand][] = [
  ["moderan", modern, "solidan"],
  ["moderan +center", modernWithOneCenter, "solidan"],
  ["osrednji", meh, "ruzan"],
  ["iz 2011", ancient, "katastrofa"],
];

console.log("ugly score");
for (const [name, html, expected] of cases) {
  const r = scoreSite({ html, httpsOk: true, loadMs: 800, finalUrl: null });
  const ok = r.band === expected;
  check(ok, `${name.padEnd(16)} skor ${String(r.score).padStart(3)} · ${r.band} · ${r.platform}`);
  console.log(`   ${r.signals.map((s) => `${s.key}(${s.points})`).join(" ") || "—"}`);
  if (!ok) console.log(`   očekivano: ${expected}`);
}

// ── dugačak <head> (regresija) ─────────────────────────────
// Do avgusta 2026. je `head()` tražio ceo `<head>` regexom sa granicom od
// 20.000 znakova. Kad je `<head>` duži, regex ne nađe ništa i funkcija je padala
// na prvih 20.000 znakova DOKUMENTA — pa je sve iza toga bilo nevidljivo.
//
// Posledica na stvarnom sajtu (matildabig.rs, `<head>` 81.602 znaka, viewport na
// poziciji 71.648): upisan `no_viewport` — 30 poena, najteži signal — sajtu koji
// je prilagođen telefonu. Skor 46 („ružan") umesto 12 („solidan").
//
// WordPress sa page builderom rutinski pređe 20.000 znakova, pa je signal bio
// sistematski lažan na najčešćoj platformi u bazi.

console.log("\ndugačak <head>");

const punjenje = "<style>/* " + "x".repeat(60_000) + " */</style>";
const dugHead = `<!doctype html><html lang="sr"><head>
<title>Restoran</title>
${punjenje}
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Opis">
<meta property="og:title" content="Restoran">
<link rel="icon" href="/favicon.ico">
</head><body><p>Sadržaj</p></body></html>`;

const dug = scoreSite({ html: dugHead, httpsOk: true, loadMs: 800, finalUrl: null });
const kljucevi = dug.signals.map((s) => s.key);

check(
  !kljucevi.includes("no_viewport"),
  `viewport iza 20k znakova je viđen  (signali: ${kljucevi.join(", ") || "—"})`,
);
check(!kljucevi.includes("no_description"), "description iza 20k znakova je viđen");
check(!kljucevi.includes("no_og"), "og iza 20k znakova je viđen");
check(!kljucevi.includes("no_favicon"), "favicon iza 20k znakova je viđen");
check(dug.score === 0, `sajt sa svim meta podacima ima skor 0 (dobijeno ${dug.score})`);

// Kontrola: kad viewporta stvarno nema, signal MORA da se javi — inače bi ovaj
// test prolazio i da je provera slučajno ugašena.
const bezViewporta = dugHead.replace(/<meta name="viewport"[^>]*>/, "");
const bezVp = scoreSite({ html: bezViewporta, httpsOk: true, loadMs: 800, finalUrl: null });
check(
  bezVp.signals.some((s) => s.key === "no_viewport"),
  "kontrola: sajt bez viewporta i dalje dobija no_viewport",
);

// Dokument bez `<head>` uopšte — mora da radi, ne da pukne.
const bezHeada = scoreSite({
  html: "<html><body><p>Samo telo</p></body></html>",
  httpsOk: true,
  loadMs: 800,
  finalUrl: null,
});
check(typeof bezHeada.score === "number", `dokument bez <head> ne puca (skor ${bezHeada.score})`);

// ── transliteracija ────────────────────────────────────────

console.log("\ntransliteracija");
const translits: [string, string][] = [
  ["Страхињића Бана, Ниш", "Strahinjića Bana, Niš"],
  ["Vizantijski bulevar 22/4, Niš", "Vizantijski bulevar 22/4, Niš"],
  ["ЉУБИША", "LJUBIŠA"],
  ["Ђорђе Џаџић", "Đorđe Džadžić"],
  ["Стоматолошка ординација Њега", "Stomatološka ordinacija Njega"],
];
for (const [input, expected] of translits) {
  const got = cirToLat(input);
  check(got === expected, `${input} → ${got}${got === expected ? "" : `  očekivano: ${expected}`}`);
}

const folds: [string, string][] = [
  ["Dental Studio Lalić", "dental studio lalic"],
  ["Milošević", "milosevic"],
  ["Ђорђе", "djordje"],
];
for (const [input, expected] of folds) {
  const got = foldForSearch(input);
  check(got === expected, `fold: ${input} → ${got}${got === expected ? "" : `  očekivano: ${expected}`}`);
}

// ── generator outreach poruka (F7) ─────────────────────────
//
// Testira se ono što se ne vidi golim okom pri čitanju šablona: da granice reči
// drže i za najduže kombinacije niše i grada, da generator ODBIJE da piše kad
// nema osnova, i da nijedan slug iz taksonomije nije ostao bez padežnog oblika.

console.log("\noutreach generator");

const bezPadeza = bezOblika(CITY_SLUGS, NICHE_SLUGS);
check(
  bezPadeza.gradovi.length === 0 && bezPadeza.nise.length === 0,
  `svaki slug ima padežni oblik${
    bezPadeza.gradovi.length || bezPadeza.nise.length
      ? ` — fale: ${[...bezPadeza.gradovi, ...bezPadeza.nise].join(", ")}`
      : ""
  }`,
);

const osnovni: OutreachInput = {
  name: "Auto David",
  citySlug: "kraljevo",
  nicheSlug: "autoplac",
  siteStatus: "ok",
  websiteUrl: "autodavid.rs/kontakt",
  signals: [{ key: "no_viewport", points: 30, label: "Sajt nije prilagođen telefonu" }],
  aiIssues: null,
  aiSolidan: null,
  phoneType: "mobilni",
  rating: 4.5,
  reviewCount: 85,
  senderName: "Marko",
};

// Najgori slučaj za granice reči: najduži padežni oblik niše i najduži grad.
// Ako ijedan kanal probije granicu, probiće je ovde.
const najduzi: OutreachInput = {
  ...osnovni,
  citySlug: "smederevska-palanka",
  nicheSlug: "gradjevinski-materijal",
  siteStatus: "nema_sajt",
  websiteUrl: null,
};

for (const [ime, ulaz] of [
  ["tipičan lead", osnovni],
  ["najduža niša i grad", najduzi],
] as const) {
  const r = napisiPoruke(ulaz);
  if (!r.ok) {
    check(false, `${ime}: generator odbio (${r.razlog})`);
    continue;
  }

  for (const kanal of ["mejl", "viber", "instagram"] as const) {
    const p = r.poruke[kanal];
    const greske = proveriPoruku(p);
    check(
      greske.length === 0,
      `${ime} · ${kanal.padEnd(9)} ${String(p.words).padStart(3)} reči${
        greske.length ? ` — ${greske.join("; ")}` : ""
      }`,
    );
  }
}

// Uredan sajt: model je već rekao da nema šta da se zameri. Poruka bi morala da
// izmisli problem, a izmišljen problem je jedina greška koja outreach ubija odmah.
const solidan = napisiPoruke({ ...osnovni, aiSolidan: true, signals: [] });
check(!solidan.ok && solidan.razlog === "solidan", "uredan sajt → generator odbija");

// Slabi signali nisu razlog da se čoveku javiš. Sajt bez favicona i bez Open
// Grapha nema nijednu rečenicu koja sme da nosi prvu rečenicu poruke.
const slabi = napisiPoruke({
  ...osnovni,
  signals: [
    { key: "no_favicon", points: 4, label: "Nema favicon" },
    { key: "no_og", points: 5, label: "Bez Open Graph" },
  ],
});
check(!slabi.ok && slabi.razlog === "nema_osnova", "samo slabi signali → generator odbija");

// Težine u bazi umeju da budu nule (zapisi iz starijih scanova). Redosled tada
// mora da padne na poredak iz `scoreSite`, koji je već po jačini.
const nulteTezine = napisiPoruke({
  ...osnovni,
  signals: [
    { key: "no_viewport", points: 0, label: "Sajt nije prilagođen telefonu" },
    { key: "no_favicon", points: 0, label: "Nema favicon" },
  ],
});
check(
  nulteTezine.ok && nulteTezine.izvor === "signal",
  "signali sa nultim težinama i dalje daju kuku",
);

// Viber bez linka je pravilo, ne preporuka: link od nepoznatog broja se ne
// otvara. Adresa sajta ne sme da procuri ni kroz nalaz analize.
const saLinkom = napisiPoruke({
  ...osnovni,
  aiIssues: [
    {
      title: "Sajt ne radi",
      detail: "x",
      evidence: "Otvorim autodavid.rs i vidim samo poruku o održavanju.",
      severity: "visoka",
    },
  ],
});
check(
  saLinkom.ok && !/autodavid\.rs/.test(saLinkom.poruke.viber.body),
  "domen iz AI nalaza ne procuri u Viber poruku",
);

// ── F11: motor pitanja ─────────────────────────────────────
// Pravila iz F11 §3.1 su tvrda i lako se „popravi" jedno od njih usput. Ovo su
// tri koja su u „Gotovo kad" listi napisana kao uslov puštanja faze.

console.log("\nmotor utisaka");

const SADA = Date.parse("2026-08-12T10:00:00Z");
const mirno = { pitanoUSesiji: false, ekranMiran: true, odUcitavanjaMs: 120_000 };
const prazno = { cooldownUntil: null, mutedUntil: null, dismissStreak: 0, poPitanju: {} };

const prvaLista = pitanjeZaKljuc("prva-lista");
const posaoPao = pitanjeZaKljuc("posao-pao");

check(prvaLista !== null && posaoPao !== null, "katalog ima oba pitanja sa /pretrage");
check(pitanjeZaKljuc("izmisljeno") === null, "ključ van kataloga ne postoji");

if (prvaLista && posaoPao) {
  check(
    sledecePitanje(prazno, mirno, [prvaLista], SADA)?.kljuc === "prva-lista",
    "miran ekran, nema istorije → pitanje prolazi",
  );
  check(
    sledecePitanje(prazno, { ...mirno, odUcitavanjaMs: 5_000 }, [prvaLista], SADA) === null,
    "pre 60 s od učitavanja → ništa",
  );
  check(
    sledecePitanje(prazno, { ...mirno, pitanoUSesiji: true }, [prvaLista], SADA) === null,
    "jedno pitanje po sesiji",
  );
  check(
    sledecePitanje(prazno, { ...mirno, ekranMiran: false }, [prvaLista], SADA) === null,
    "dok posao radi ili je modal otvoren → ništa",
  );

  // Cooldown zaustavlja molbu, ali ne i incident — i to je jedini izuzetak.
  const uCooldownu = {
    ...prazno,
    cooldownUntil: new Date(SADA + 60 * 60 * 1000).toISOString(),
  };
  check(sledecePitanje(uCooldownu, mirno, [prvaLista], SADA) === null, "cooldown ćuti molbu");
  check(
    sledecePitanje(uCooldownu, mirno, [posaoPao], SADA)?.kljuc === "posao-pao",
    "incident seče cooldown",
  );

  // Ćutanje je jače od incidenta: čovek koji je rekao ne dvaput nije rekao ne
  // samo molbama.
  const ucutkan = { ...prazno, mutedUntil: new Date(SADA + 60 * 60 * 1000).toISOString() };
  check(sledecePitanje(ucutkan, mirno, [posaoPao], SADA) === null, "ćutanje je jače od incidenta");

  // Isto pitanje jednom po nalogu — osim onog sa `ponovi`.
  const vidjeno = {
    ...prazno,
    poPitanju: {
      "prva-lista": { status: "odbaceno" as const, shownAt: new Date(SADA - 1000).toISOString() },
      "posao-pao": {
        status: "odgovoreno" as const,
        shownAt: new Date(SADA - 25 * 60 * 60 * 1000).toISOString(),
      },
    },
  };
  check(
    sledecePitanje(vidjeno, mirno, [prvaLista], SADA) === null,
    "viđeno pitanje se ne vraća nikad",
  );
  check(
    sledecePitanje(vidjeno, mirno, [posaoPao], SADA)?.kljuc === "posao-pao",
    "posao-pao sme ponovo posle 24 h",
  );
  check(
    smeDaSePita(
      posaoPao,
      {
        ...prazno,
        poPitanju: {
          "posao-pao": {
            status: "odbaceno",
            shownAt: new Date(SADA - 60 * 60 * 1000).toISOString(),
          },
        },
      },
      SADA,
    ) === false,
    "posao-pao ne sme dvaput u istom danu",
  );

  // Dva odbacivanja zaredom → 14 dana, treće → do kraja bete.
  const prvo = posleOdbacivanja(0, SADA);
  check(prvo.dismissStreak === 1 && prvo.mutedUntil === null, "prvo odbacivanje ne ćuti sistem");

  const drugo = posleOdbacivanja(1, SADA);
  const dana = drugo.mutedUntil
    ? Math.round((Date.parse(drugo.mutedUntil) - SADA) / (24 * 60 * 60 * 1000))
    : 0;
  check(dana === MOTOR.CUTANJE_DANA, `dva odbacivanja → ćutanje ${dana} dana`);

  const trece = posleOdbacivanja(2, SADA);
  check(
    trece.mutedUntil !== null &&
      Date.parse(trece.mutedUntil) - SADA > MOTOR.CUTANJE_DANA * 24 * 60 * 60 * 1000,
    "treće odbacivanje ćuti do kraja bete",
  );

  // Ko odgovori, dobija mir — i streak mu se briše.
  const odgovor = posleOdgovora(SADA);
  check(
    odgovor.dismissStreak === 0 &&
      Math.round((Date.parse(odgovor.cooldownUntil) - SADA) / (24 * 60 * 60 * 1000)) ===
        MOTOR.COOLDOWN_POSLE_ODGOVORA_DANA,
    "odgovor → 7 dana mira i streak na nuli",
  );
}

// `answers` prolazi šemom IZ kataloga, po ključu (pravilo 16).
console.log("\nkatalog: provera odgovora");
check(proveriOdgovor("prva-lista", { odgovor: "jeste" }).ok, "poznat odgovor prolazi");
check(!proveriOdgovor("prva-lista", { odgovor: "mozda" }).ok, "nepoznata vrednost pada");
check(!proveriOdgovor("prva-lista", { odgovor: "jeste", x: 1 }).ok, "nepoznat ključ pada");
check(!proveriOdgovor("izmisljeno", { odgovor: "jeste" }).ok, "pitanje van kataloga pada");
check(!proveriOdgovor("prazan-rezultat", { tekst: "a" }).ok, "prekratak tekst pada");
check(proveriOdgovor("prazan-rezultat", { tekst: "bravar u Loznici" }).ok, "tekst prolazi");

// F11.2: drugi korak i čipovi prolaze KROZ ISTU šemu, jer se na serveru spajaju
// sa prvim odgovorom pa se proverava spoj (pravilo 16).
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
check(proveriOdgovor("cena", { odgovor: "1990-3900" }).ok, "opseg cene prolazi");
check(!proveriOdgovor("cena", { odgovor: "2500" }).ok, "slobodan iznos umesto opsega pada");

// ── F11.2: rok pitanja i medijana cene ─────────────────────

console.log("\nkatalog: rok i medijana");

check(
  KATALOG.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.do)),
  "svako pitanje u katalogu ima rok (`do:`)",
);

const cena = pitanjeZaKljuc("cena");
if (cena) {
  const dan = 24 * 60 * 60 * 1000;
  const rok = Date.parse(`${cena.do}T23:59:59.999Z`);

  check(vaziPitanje(cena, rok - dan), "pitanje važi dan pre roka");
  check(vaziPitanje(cena, rok), "pitanje važi do kraja poslednjeg dana");
  check(!vaziPitanje(cena, rok + 1000), "posle roka pitanje za motor ne postoji");

  // Rok je tvrđi od svega ostalog: ispunjen uslov ga ne oživljava.
  const ispunjeno: Uslovi = { danaOdRegistracije: 30, otkljucano: 12, danaPauze: 0 };
  const mirno2 = { pitanoUSesiji: false, ekranMiran: true, odUcitavanjaMs: 120_000 };
  const prazno2 = { cooldownUntil: null, mutedUntil: null, dismissStreak: 0, poPitanju: {} };

  check(
    sledecePitanje(prazno2, { ...mirno2, uslovi: ispunjeno }, [cena], rok - dan)?.kljuc === "cena",
    "ispunjen uslov pušta kampanjsko pitanje",
  );
  check(
    sledecePitanje(prazno2, { ...mirno2, uslovi: ispunjeno }, [cena], rok + 1000) === null,
    "istekao rok ćuti pitanje i kad je uslov ispunjen",
  );
  check(
    sledecePitanje(
      prazno2,
      { ...mirno2, uslovi: { danaOdRegistracije: 30, otkljucano: 4, danaPauze: 0 } },
      [cena],
      rok - dan,
    ) === null,
    "manje od 5 otključanih → nema pitanja o ceni",
  );
  check(
    sledecePitanje(
      prazno2,
      { ...mirno2, uslovi: { danaOdRegistracije: 3, otkljucano: 12, danaPauze: 0 } },
      [cena],
      rok - dan,
    ) === null,
    "manje od 7 dana od registracije → nema pitanja o ceni",
  );
  // Motor koji ne zna uslov ne sme da pretpostavi da je ispunjen.
  check(
    sledecePitanje(prazno2, mirno2, [cena], rok - dan) === null,
    "bez stanja naloga kampanjsko pitanje otpada",
  );
}

check(medijanaCene([]) === null, "medijana bez odgovora je null");
check(medijanaCene(["ne-bih"]) === 0, "jedan odgovor → njegova sredina");
// Sredine: 0 · 700 · 1.490 · 2.945 · 5.400 · 8.500 (F11 §2.3).
check(
  medijanaCene(["do-990", "990-1990", "1990-3900"]) === 1490,
  "neparan broj odgovora → srednja vrednost",
);
check(
  medijanaCene(["do-990", "990-1990"]) === Math.round((700 + 1490) / 2),
  "paran broj odgovora → prosek dve srednje",
);
check(
  medijanaCene(["izmisljeni-opseg", "990-1990"]) === 1490,
  "nepoznat opseg se preskače, ne obara izveštaj",
);
check(
  CENA_OPSEZI.length === 6 && CENA_OPSEZI.every((o) => o.sredina >= 0),
  `šest opsega u RSD (${CENA_OPSEZI.map((o) => o.sredina).join(" · ")})`,
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
