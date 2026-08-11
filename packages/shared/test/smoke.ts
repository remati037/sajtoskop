// packages/shared/test/smoke.ts
// Jedini test u F0. Pokretanje: pnpm test  (ili: pnpm --filter @sajtoskop/shared test)
//
// Ovde su preseljeni samotestovi koji su ranije stajali na dnu ugly-score.ts i
// translit.ts. Morali su da odu iz src/ jer su uvozili `node:url` — a nijedan fajl
// u packages/shared/src ne sme da dodirne `node:` (F0, sekcija 5).

import type { OutreachInput, UglyBand } from "../src/index";
import {
  bezOblika,
  cirToLat,
  CITY_SLUGS,
  foldForSearch,
  napisiPoruke,
  NICHE_SLUGS,
  proveriPoruku,
  scoreSite,
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

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
