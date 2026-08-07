/**
 * Sajtoskop — liste niša i gradova za Srbiju
 * Za: packages/shared/src/taxonomy.ts
 *
 * PRIORITY = buyingPower × badSiteOdds
 *   buyingPower   1-3  koliko realno mogu da plate sajt (1 = malo, 3 = 500-1500 EUR+)
 *   badSiteOdds   1-3  verovatnoća da im je sajt loš ili da ga nemaju
 *
 * Sweep počni od priority 9, pa 6, pa niže. Nema smisla trošiti pozive
 * na niše koje ne mogu da plate ili koje već imaju dobre sajtove.
 */
 
import type { PhoneKind } from "./types";

export type Niche = {
  slug: string;
  label: string;        // za UI dropdown
  query: string;        // za Google Places Text Search
  queryStatus?: "potvrdjen" | "sumnjiv" | "nevalidan";
  group: NicheGroup;
  buyingPower: 1 | 2 | 3;
  badSiteOdds: 1 | 2 | 3;
};
 
export type NicheGroup =
  | "zdravstvo"
  | "lepota"
  | "fitnes"
  | "auto"
  | "majstori"
  | "ugostiteljstvo"
  | "usluge"
  | "trgovina"
  | "obrazovanje"
  | "turizam";
 
export const NICHES: Niche[] = [
  // ── ZDRAVSTVO ─────────────────────────────────────────────
  { slug: "stomatolog",          label: "Stomatološka ordinacija", query: "stomatolog",queryStatus: "potvrdjen",   group: "zdravstvo",     buyingPower: 3, badSiteOdds: 3 },
  { slug: "privatna-ordinacija", label: "Privatna ordinacija",     query: "privatna lekarska ordinacija",  group: "zdravstvo",     buyingPower: 3, badSiteOdds: 3 },
  { slug: "estetska-klinika",    label: "Estetska klinika",        query: "estetska klinika",              group: "zdravstvo",     buyingPower: 3, badSiteOdds: 2 },
  { slug: "fizikalna-terapija",  label: "Fizikalna terapija",      query: "fizikalna terapija",            group: "zdravstvo",     buyingPower: 2, badSiteOdds: 3 },
  { slug: "veterinar",           label: "Veterinarska ambulanta",  query: "veterinarska ambulanta",        group: "zdravstvo",     buyingPower: 2, badSiteOdds: 3 },
  { slug: "opticar",             label: "Optika",                  query: "optika",                        group: "zdravstvo",     buyingPower: 2, badSiteOdds: 3 },
 
  // ── LEPOTA ────────────────────────────────────────────────
  { slug: "frizerski-salon",     label: "Frizerski salon",         query: "frizerski salon",               group: "lepota",        buyingPower: 1, badSiteOdds: 3 },
  { slug: "kozmeticki-salon",    label: "Kozmetički salon",        query: "kozmetički salon",              group: "lepota",        buyingPower: 2, badSiteOdds: 3 },
  { slug: "salon-nokti",         label: "Salon za nokte",          query: "salon za nokte",                group: "lepota",        buyingPower: 1, badSiteOdds: 3 },
  { slug: "tattoo-studio",       label: "Tattoo studio",           query: "tattoo studio",                 group: "lepota",        buyingPower: 2, badSiteOdds: 2 },
  { slug: "spa-masaza",          label: "Spa i masaža",            query: "salon za masažu",               group: "lepota",        buyingPower: 2, badSiteOdds: 3 },
 
  // ── FITNES ────────────────────────────────────────────────
  { slug: "teretana",            label: "Teretana / fitnes",       query: "teretana",                      group: "fitnes",        buyingPower: 2, badSiteOdds: 3 },
  { slug: "borilacki-klub",      label: "Borilački klub",          query: "borilački klub",                group: "fitnes",        buyingPower: 1, badSiteOdds: 3 },
  { slug: "plesna-skola",        label: "Plesna škola",            query: "plesna škola",                  group: "fitnes",        buyingPower: 2, badSiteOdds: 3 },
 
  // ── AUTO ──────────────────────────────────────────────────
  { slug: "auto-servis",         label: "Auto servis",             query: "auto servis",                   group: "auto",          buyingPower: 2, badSiteOdds: 3 },
  { slug: "autoplac",            label: "Auto plac",               query: "auto plac",queryStatus: "potvrdjen",                     group: "auto",          buyingPower: 3, badSiteOdds: 3 },
  { slug: "vulkanizer",          label: "Vulkanizer",              query: "vulkanizer",                    group: "auto",          buyingPower: 1, badSiteOdds: 3 },
  { slug: "auto-skola",          label: "Auto škola",              query: "auto škola",                    group: "auto",          buyingPower: 3, badSiteOdds: 3 },
  { slug: "auto-perionica",      label: "Auto perionica",          query: "auto perionica",                group: "auto",          buyingPower: 1, badSiteOdds: 3 },
  { slug: "auto-delovi",         label: "Auto delovi",             query: "auto delovi",                   group: "auto",          buyingPower: 2, badSiteOdds: 3 },
 
  // ── MAJSTORI I GRAĐEVINA ──────────────────────────────────
  { slug: "pvc-stolarija",       label: "PVC stolarija",           query: "PVC stolarija",queryStatus: "potvrdjen",                 group: "majstori",      buyingPower: 3, badSiteOdds: 3 },
  { slug: "stolar",              label: "Stolar / nameštaj po meri", query: "stolar nameštaj po meri",     group: "majstori",      buyingPower: 2, badSiteOdds: 3 },
  { slug: "klima-servis",        label: "Servis klima uređaja",    query: "servis klima uređaja",          group: "majstori",      buyingPower: 2, badSiteOdds: 3 },
  { slug: "vodoinstalater",      label: "Vodoinstalater",          query: "vodoinstalater",                group: "majstori",      buyingPower: 1, badSiteOdds: 3 },
  { slug: "elektricar",          label: "Električar",              query: "električar",                    group: "majstori",      buyingPower: 1, badSiteOdds: 3 },
  { slug: "gradjevinski-materijal", label: "Građevinski materijal", query: "građevinski materijal",        group: "majstori",      buyingPower: 3, badSiteOdds: 3 },
  { slug: "bravar",              label: "Bravar",                  query: "bravar",                        group: "majstori",      buyingPower: 1, badSiteOdds: 3 },
 
  // ── UGOSTITELJSTVO ────────────────────────────────────────
  { slug: "restoran",            label: "Restoran",                query: "restoran",                      group: "ugostiteljstvo", buyingPower: 2, badSiteOdds: 3 },
  { slug: "picerija",            label: "Picerija",                query: "picerija",                      group: "ugostiteljstvo", buyingPower: 2, badSiteOdds: 3 },
  { slug: "pekara",              label: "Pekara",                  query: "pekara",                        group: "ugostiteljstvo", buyingPower: 2, badSiteOdds: 3 },
  { slug: "poslasticarnica",     label: "Poslastičarnica",         query: "poslastičarnica",               group: "ugostiteljstvo", buyingPower: 2, badSiteOdds: 3 },
  { slug: "ketering",            label: "Ketering",                query: "ketering",                      group: "ugostiteljstvo", buyingPower: 3, badSiteOdds: 3 },
 
  // ── PROFESIONALNE USLUGE ──────────────────────────────────
    { slug: "advokat",   label: "Advokatska kancelarija", query: "advokat",         queryStatus: "potvrdjen", group: "usluge",  buyingPower: 3, badSiteOdds: 3 },
  { slug: "knjigovodja",         label: "Knjigovodstvena agencija", query: "knjigovodstvena agencija",queryStatus: "potvrdjen",     group: "usluge",        buyingPower: 3, badSiteOdds: 3 },
  { slug: "nekretnine",          label: "Agencija za nekretnine",  query: "agencija za nekretnine",        group: "usluge",        buyingPower: 3, badSiteOdds: 2 },
    { slug: "geodeta",   label: "Geodetski biro",         query: "geodetske usluge",  queryStatus: "nevalidan", group: "usluge",  buyingPower: 3, badSiteOdds: 3 },
  { slug: "stamparija",          label: "Štamparija",              query: "štamparija",queryStatus: "potvrdjen",                    group: "usluge",        buyingPower: 3, badSiteOdds: 3 },
  { slug: "selidbe",             label: "Selidbe",                 query: "selidbe",                       group: "usluge",        buyingPower: 2, badSiteOdds: 3 },
  { slug: "fotograf",  label: "Fotograf",               query: "foto studio",        queryStatus: "nevalidan", group: "usluge",  buyingPower: 2, badSiteOdds: 2 },
 
  // ── TRGOVINA ──────────────────────────────────────────────
  { slug: "salon-namestaja",     label: "Salon nameštaja",         query: "salon nameštaja",               group: "trgovina",      buyingPower: 3, badSiteOdds: 3 },
  { slug: "cvecara",             label: "Cvećara",                 query: "cvećara",                       group: "trgovina",      buyingPower: 1, badSiteOdds: 3 },
  { slug: "mesara",              label: "Mesara",                  query: "mesara",                        group: "trgovina",      buyingPower: 2, badSiteOdds: 3 },
 
  // ── OBRAZOVANJE ───────────────────────────────────────────
  { slug: "skola-jezika",        label: "Škola jezika",            query: "škola stranih jezika",          group: "obrazovanje",   buyingPower: 3, badSiteOdds: 3 },
  { slug: "privatni-vrtic",      label: "Privatni vrtić",          query: "privatni vrtić",                group: "obrazovanje",   buyingPower: 3, badSiteOdds: 3 },
 
  // ── TURIZAM ───────────────────────────────────────────────
  { slug: "turisticka-agencija", label: "Turistička agencija",     query: "turistička agencija",           group: "turizam",       buyingPower: 3, badSiteOdds: 2 },
  { slug: "apartmani",           label: "Apartmani / smeštaj",     query: "apartmani",                     group: "turizam",       buyingPower: 2, badSiteOdds: 3 },
  { slug: "vinarija",            label: "Vinarija",                query: "vinarija",                      group: "turizam",       buyingPower: 3, badSiteOdds: 2 },
  { slug: "etno-selo",           label: "Etno selo / vikendice",   query: "etno selo",                     group: "turizam",       buyingPower: 2, badSiteOdds: 3 },
];
 
/** Prioritet za sweep. Počni od 9. */
export const nichePriority = (n: Niche) => n.buyingPower * n.badSiteOdds;
 
/** Top niše za prvi sweep — priority 9 */
export const SEED_NICHES = NICHES
  .filter((n) => nichePriority(n) === 9)
  .map((n) => n.slug);
// → stomatolog, privatna-ordinacija, autoplac, auto-skola, pvc-stolarija,
//   gradjevinski-materijal, ketering, advokat, knjigovodja, geodeta,
//   stamparija, salon-namestaja, skola-jezika, privatni-vrtic, vinarija*

/**
 * Niše čiji upit je testiran i vraća pun uzorak.
 * Upit koji liči na NAZIV firme sužava rezultat na tačno tu firmu.
 * Upit koji liči na KATEGORIJU vraća celu nišu.
 * Primer: "geodetski biro Valjevo" → 2 rezultata, "geodetske usluge" → ?
 */
export const VALIDATED_NICHES = NICHES
  .filter((n) => n.queryStatus === "potvrdjen")
  .map((n) => n.slug);
 
// ═══════════════════════════════════════════════════════════
// GRADOVI
// ═══════════════════════════════════════════════════════════
 
export type City = {
  slug: string;
  label: string;
  /** Pravilo 11 iz CLAUDE.md — region dolazi kasnije, migracija ne. */
  countryCode: "RS";
  okrug: string;
  tier: 1 | 2 | 3;      // 1 = veliki, sweep prvo; 3 = mali, sweep zadnje
  subareas?: string[];  // za velike gradove — Places vraća max ~60 po upitu,
                        // pa se veliki gradovi moraju cepati po opštinama
};
 
export const CITIES: City[] = [
  // ── TIER 1 ────────────────────────────────────────────────
  {
    slug: "beograd", label: "Beograd", countryCode: "RS", okrug: "Grad Beograd", tier: 1,
    subareas: [
      "Stari grad", "Vračar", "Savski venac", "Novi Beograd", "Zemun",
      "Voždovac", "Zvezdara", "Palilula", "Čukarica", "Rakovica",
      "Surčin", "Borča", "Batajnica", "Banovo brdo", "Dorćol",
    ],
  },
  {
    slug: "novi-sad", label: "Novi Sad", countryCode: "RS", okrug: "Južnobački", tier: 1,
    subareas: ["Centar", "Liman", "Detelinara", "Novo naselje", "Petrovaradin", "Sremska Kamenica"],
  },
  { slug: "nis",           label: "Niš", countryCode: "RS",              okrug: "Nišavski",        tier: 1,
    subareas: ["Medijana", "Palilula", "Pantelej", "Crveni krst", "Niška Banja"] },
  { slug: "kragujevac",    label: "Kragujevac", countryCode: "RS",       okrug: "Šumadijski",      tier: 1 },
 
  // ── TIER 2 ────────────────────────────────────────────────
  { slug: "subotica",      label: "Subotica", countryCode: "RS",         okrug: "Severnobački",    tier: 2 },
  { slug: "zrenjanin",     label: "Zrenjanin", countryCode: "RS",        okrug: "Srednjebanatski", tier: 2 },
  { slug: "pancevo",       label: "Pančevo", countryCode: "RS",          okrug: "Južnobanatski",   tier: 2 },
  { slug: "cacak",         label: "Čačak", countryCode: "RS",            okrug: "Moravički",       tier: 2 },
  { slug: "kraljevo",      label: "Kraljevo", countryCode: "RS",         okrug: "Raški",           tier: 2 },
  { slug: "novi-pazar",    label: "Novi Pazar", countryCode: "RS",       okrug: "Raški",           tier: 2 },
  { slug: "smederevo",     label: "Smederevo", countryCode: "RS",        okrug: "Podunavski",      tier: 2 },
  { slug: "leskovac",      label: "Leskovac", countryCode: "RS",         okrug: "Jablanički",      tier: 2 },
  { slug: "uzice",         label: "Užice", countryCode: "RS",            okrug: "Zlatiborski",     tier: 2 },
  { slug: "valjevo",       label: "Valjevo", countryCode: "RS",          okrug: "Kolubarski",      tier: 2 },
  { slug: "krusevac",      label: "Kruševac", countryCode: "RS",         okrug: "Rasinski",        tier: 2 },
  { slug: "vranje",        label: "Vranje", countryCode: "RS",           okrug: "Pčinjski",        tier: 2 },
  { slug: "sabac",         label: "Šabac", countryCode: "RS",            okrug: "Mačvanski",       tier: 2 },
  { slug: "sombor",        label: "Sombor", countryCode: "RS",           okrug: "Zapadnobački",    tier: 2 },
  { slug: "pozarevac",     label: "Požarevac", countryCode: "RS",        okrug: "Braničevski",     tier: 2 },
  { slug: "pirot",         label: "Pirot", countryCode: "RS",            okrug: "Pirotski",        tier: 2 },
  { slug: "zajecar",       label: "Zaječar", countryCode: "RS",          okrug: "Zaječarski",      tier: 2 },
  { slug: "kikinda",       label: "Kikinda", countryCode: "RS",          okrug: "Severnobanatski", tier: 2 },
  { slug: "sremska-mitrovica", label: "Sremska Mitrovica", countryCode: "RS", okrug: "Sremski",    tier: 2 },
  { slug: "jagodina",      label: "Jagodina", countryCode: "RS",         okrug: "Pomoravski",      tier: 2 },
  { slug: "vrsac",         label: "Vršac", countryCode: "RS",            okrug: "Južnobanatski",   tier: 2 },
  { slug: "bor",           label: "Bor", countryCode: "RS",              okrug: "Borski",          tier: 2 },
  { slug: "loznica",       label: "Loznica", countryCode: "RS",          okrug: "Mačvanski",       tier: 2 },
  { slug: "prokuplje",     label: "Prokuplje", countryCode: "RS",        okrug: "Toplički",        tier: 2 },
 
  // ── TIER 3 ────────────────────────────────────────────────
  { slug: "ruma",              label: "Ruma", countryCode: "RS",              okrug: "Sremski",       tier: 3 },
  { slug: "backa-palanka",     label: "Bačka Palanka", countryCode: "RS",     okrug: "Južnobački",    tier: 3 },
  { slug: "indjija",           label: "Inđija", countryCode: "RS",            okrug: "Sremski",       tier: 3 },
  { slug: "stara-pazova",      label: "Stara Pazova", countryCode: "RS",      okrug: "Sremski",       tier: 3 },
  { slug: "arandjelovac",      label: "Aranđelovac", countryCode: "RS",       okrug: "Šumadijski",    tier: 3 },
  { slug: "gornji-milanovac",  label: "Gornji Milanovac", countryCode: "RS",  okrug: "Moravički",     tier: 3 },
  { slug: "vrbas",             label: "Vrbas", countryCode: "RS",             okrug: "Južnobački",    tier: 3 },
  { slug: "trstenik",          label: "Trstenik", countryCode: "RS",          okrug: "Rasinski",      tier: 3 },
  { slug: "paracin",           label: "Paraćin", countryCode: "RS",           okrug: "Pomoravski",    tier: 3 },
  { slug: "cuprija",           label: "Ćuprija", countryCode: "RS",           okrug: "Pomoravski",    tier: 3 },
  { slug: "becej",             label: "Bečej", countryCode: "RS",             okrug: "Južnobački",    tier: 3 },
  { slug: "senta",             label: "Senta", countryCode: "RS",             okrug: "Severnobački",  tier: 3 },
  { slug: "apatin",            label: "Apatin", countryCode: "RS",            okrug: "Zapadnobački",  tier: 3 },
  { slug: "negotin",           label: "Negotin", countryCode: "RS",           okrug: "Borski",        tier: 3 },
  { slug: "temerin",           label: "Temerin", countryCode: "RS",           okrug: "Južnobački",    tier: 3 },
  { slug: "aleksinac",         label: "Aleksinac", countryCode: "RS",         okrug: "Nišavski",      tier: 3 },
  { slug: "lazarevac",         label: "Lazarevac", countryCode: "RS",         okrug: "Grad Beograd",  tier: 3 },
  { slug: "obrenovac",         label: "Obrenovac", countryCode: "RS",         okrug: "Grad Beograd",  tier: 3 },
  { slug: "mladenovac",        label: "Mladenovac", countryCode: "RS",        okrug: "Grad Beograd",  tier: 3 },
  { slug: "ivanjica",          label: "Ivanjica", countryCode: "RS",          okrug: "Moravički",     tier: 3 },
  { slug: "prijepolje",        label: "Prijepolje", countryCode: "RS",        okrug: "Zlatiborski",   tier: 3 },
  { slug: "smederevska-palanka", label: "Smederevska Palanka", countryCode: "RS", okrug: "Podunavski", tier: 3 },
  { slug: "velika-plana",      label: "Velika Plana", countryCode: "RS",      okrug: "Podunavski",    tier: 3 },
  { slug: "knjazevac",         label: "Knjaževac", countryCode: "RS",         okrug: "Zaječarski",    tier: 3 },
  { slug: "svilajnac",         label: "Svilajnac", countryCode: "RS",         okrug: "Pomoravski",    tier: 3 },
  { slug: "backa-topola",      label: "Bačka Topola", countryCode: "RS",      okrug: "Severnobački",  tier: 3 },
];
 
// ═══════════════════════════════════════════════════════════
// ALLOWLIST SLUGOVA
// ═══════════════════════════════════════════════════════════
//
// `z.enum()` traži ne-prazan tuple, a `NICHES.map(n => n.slug)` je `string[]`.
// Ovo je jedini izvor dozvoljenih vrednosti za `city` i `niche` na granici
// API-ja: slobodan tekst nikad ne dolazi do upita nad bazom.

function slugTuple(items: readonly { slug: string }[]): [string, ...string[]] {
  const [first, ...rest] = items.map((i) => i.slug);
  if (!first) throw new Error("Prazna taksonomija — nema nijednog slug-a.");
  return [first, ...rest];
}

export const CITY_SLUGS = slugTuple(CITIES);
export const NICHE_SLUGS = slugTuple(NICHES);

// ═══════════════════════════════════════════════════════════
// UPIT BUILDER
// ═══════════════════════════════════════════════════════════
 
/**
 * Places Text Search vraća max ~60 rezultata po upitu (3 stranice × 20).
 * Za tier 1 gradove to je nedovoljno — cepaj po subarea.
 */
export function buildQueries(niche: Niche, city: City): string[] {
  if (city.subareas?.length) {
    return city.subareas.map((sa) => `${niche.query} ${sa} ${city.label}`);
  }
  return [`${niche.query} ${city.label}`];
}
 
/** Redosled sweepa: visok prioritet niše u velikim gradovima prvo. */
export function sweepPlan() {
  const plan: { niche: Niche; city: City; weight: number }[] = [];
  for (const niche of NICHES) {
    for (const city of CITIES) {
      plan.push({
        niche,
        city,
        weight: nichePriority(niche) * (4 - city.tier),
      });
    }
  }
  return plan.sort((a, b) => b.weight - a.weight);
}
 
// ═══════════════════════════════════════════════════════════
// TELEFON — tip po prefiksu (nula API troška)
// ═══════════════════════════════════════════════════════════
 
export function phoneType(raw: string): PhoneKind {
  const d = raw.replace(/\D/g, "").replace(/^381/, "0");
  if (/^06[0-9]/.test(d)) return "mobilni";
  if (/^0800/.test(d)) return "besplatni";
  if (/^0(1[0-9]|2[0-9]|3[0-9])/.test(d)) return "fiksni";
  return "nepoznat";
}
 
// ── TODO pre produkcije ────────────────────────────────────
// 1. lat/lng za gradove: dopuni preko Geocoding API-ja (Essentials SKU,
//    10.000 besplatnih poziva mesečno — 50 gradova je trivijalno)
// 2. Proveri da li Places bolje reaguje na `locationBias` sa koordinatama
//    grada nego na naziv grada u upitu. Verovatno da — testiraj oba.
// 3. Za region (faza 2): `countryCode` na City već postoji — proširi uniju
//    na "RS" | "HR" | "BA" | "ME" | "MK" i dodaj gradove. Niše se prevode skoro 1:1.
 