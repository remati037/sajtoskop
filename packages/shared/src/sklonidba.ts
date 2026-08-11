// packages/shared/src/sklonidba.ts
// Padežni oblici gradova i niša za generator poruka (F7).
//
// ── zašto ovo postoji kao zaseban fajl ─────────────────────
// `taxonomy.ts` opisuje ŠTA se pretražuje: slug, Places upit, prioritet sweepa.
// Ovo opisuje KAKO se to izgovara u rečenici. Dve različite stvari koje se
// menjaju iz različitih razloga — nova niša se dodaje zbog pretrage, a oblik se
// menja zbog toga kako poruka zvuči.
//
// ── zašto ne algoritamski ──────────────────────────────────
// Srpska deklinacija se ne izvodi iz sluga pravilima koja stanu u funkciju:
// Šabac → Šapcu (nepostojano a + palatalizacija), Novi Sad → Novom Sadu (dve
// reči, obe se menjaju), Kikinda → Kikindi. Svaki generator koji bi to pogađao
// grešio bi baš na gradovima koji se najviše koriste. Devedeset kratkih stringova
// je jeftinije od jednog „u Šabacu" u poruci koju korisnik šalje strancu.
//
// Nedostajući slug NIJE greška u vreme izvršavanja — generator tada izostavi
// deo rečenice umesto da ispiše pogrešan oblik (v. `outreach.ts`).

/**
 * Lokativ grada, bez predloga: `u ${gradLokativ("sabac")}` → „u Šapcu".
 * Ključevi su `City.slug` iz `taxonomy.ts`.
 */
const GRAD_LOKATIV: Record<string, string> = {
  // tier 1
  beograd: "Beogradu",
  "novi-sad": "Novom Sadu",
  nis: "Nišu",
  kragujevac: "Kragujevcu",

  // tier 2
  subotica: "Subotici",
  zrenjanin: "Zrenjaninu",
  pancevo: "Pančevu",
  cacak: "Čačku",
  kraljevo: "Kraljevu",
  "novi-pazar": "Novom Pazaru",
  smederevo: "Smederevu",
  leskovac: "Leskovcu",
  uzice: "Užicu",
  valjevo: "Valjevu",
  krusevac: "Kruševcu",
  vranje: "Vranju",
  sabac: "Šapcu",
  sombor: "Somboru",
  pozarevac: "Požarevcu",
  pirot: "Pirotu",
  zajecar: "Zaječaru",
  kikinda: "Kikindi",
  "sremska-mitrovica": "Sremskoj Mitrovici",
  jagodina: "Jagodini",
  vrsac: "Vršcu",
  bor: "Boru",
  loznica: "Loznici",
  prokuplje: "Prokuplju",

  // tier 3
  ruma: "Rumi",
  "backa-palanka": "Bačkoj Palanci",
  indjija: "Inđiji",
  "stara-pazova": "Staroj Pazovi",
  arandjelovac: "Aranđelovcu",
  "gornji-milanovac": "Gornjem Milanovcu",
  vrbas: "Vrbasu",
  trstenik: "Trsteniku",
  paracin: "Paraćinu",
  cuprija: "Ćupriji",
  becej: "Bečeju",
  senta: "Senti",
  apatin: "Apatinu",
  negotin: "Negotinu",
  temerin: "Temerinu",
  aleksinac: "Aleksincu",
  lazarevac: "Lazarevcu",
  obrenovac: "Obrenovcu",
  mladenovac: "Mladenovcu",
  ivanjica: "Ivanjici",
  prijepolje: "Prijepolju",
  "smederevska-palanka": "Smederevskoj Palanci",
  "velika-plana": "Velikoj Plani",
  knjazevac: "Knjaževcu",
  svilajnac: "Svilajncu",
  "backa-topola": "Bačkoj Topoli",
};

/**
 * Akuzativ množine niše, za konstrukciju „Radim sajtove za ___".
 *
 * Oblik je namerno onakav kakav bi majstor sam rekao, a ne `Niche.label` iz
 * taksonomije: label je natpis u dropdownu („Agencija za nekretnine"), ovo je
 * deo rečenice („agencije za nekretnine"). Zato su i mala slova.
 */
const NISA_AKUZATIV: Record<string, string> = {
  // zdravstvo
  stomatolog: "stomatološke ordinacije",
  "privatna-ordinacija": "privatne ordinacije",
  "estetska-klinika": "estetske klinike",
  "fizikalna-terapija": "kabinete za fizikalnu terapiju",
  veterinar: "veterinarske ambulante",
  opticar: "optičarske radnje",

  // lepota
  "frizerski-salon": "frizerske salone",
  "kozmeticki-salon": "kozmetičke salone",
  "salon-nokti": "salone za nokte",
  "tattoo-studio": "tattoo studije",
  "spa-masaza": "salone za masažu",

  // fitnes
  teretana: "teretane",
  "borilacki-klub": "borilačke klubove",
  "plesna-skola": "plesne škole",

  // auto
  "auto-servis": "auto servise",
  autoplac: "auto placeve",
  vulkanizer: "vulkanizerske radnje",
  "auto-skola": "auto škole",
  "auto-perionica": "auto perionice",
  "auto-delovi": "prodavnice auto delova",

  // majstori i građevina
  "pvc-stolarija": "firme za PVC stolariju",
  stolar: "stolarske radionice",
  "klima-servis": "servise klima uređaja",
  vodoinstalater: "vodoinstalatere",
  elektricar: "električare",
  "gradjevinski-materijal": "stovarišta građevinskog materijala",
  bravar: "bravare",

  // ugostiteljstvo
  restoran: "restorane",
  picerija: "picerije",
  pekara: "pekare",
  poslasticarnica: "poslastičarnice",
  ketering: "ketering firme",

  // profesionalne usluge
  advokat: "advokatske kancelarije",
  knjigovodja: "knjigovodstvene agencije",
  nekretnine: "agencije za nekretnine",
  geodeta: "geodetske biroe",
  stamparija: "štamparije",
  selidbe: "firme za selidbe",
  fotograf: "fotografe",

  // trgovina
  "salon-namestaja": "salone nameštaja",
  cvecara: "cvećare",
  mesara: "mesare",

  // obrazovanje
  "skola-jezika": "škole jezika",
  "privatni-vrtic": "privatne vrtiće",

  // turizam
  "turisticka-agencija": "turističke agencije",
  apartmani: "izdavaoce apartmana",
  vinarija: "vinarije",
  "etno-selo": "etno sela",
};

/** Lokativ grada bez predloga, ili `null` ako slug nije poznat. */
export function gradLokativ(slug: string | null | undefined): string | null {
  return slug ? (GRAD_LOKATIV[slug] ?? null) : null;
}

/** Akuzativ množine niše, ili `null` ako slug nije poznat. */
export function nisaAkuzativ(slug: string | null | undefined): string | null {
  return slug ? (NISA_AKUZATIV[slug] ?? null) : null;
}

/**
 * Slugovi bez padežnog oblika. Koristi test — nova niša ili grad u taksonomiji
 * bez oblika ovde ne ruši ništa u produkciji, ali tiho osiromaši svaku poruku
 * za taj slug, i to je greška koju treba videti pre puštanja.
 */
export function bezOblika(citySlugs: readonly string[], nicheSlugs: readonly string[]) {
  return {
    gradovi: citySlugs.filter((s) => !(s in GRAD_LOKATIV)),
    nise: nicheSlugs.filter((s) => !(s in NISA_AKUZATIV)),
  };
}
