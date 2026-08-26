// packages/shared/src/plans.ts
// Konfiguracija planova, paketa kredita i globalnih kapova.
//
// Ovo je JEDAN IZVOR ISTINE za tri stvari koje se inače raziđu:
//   1. šta koji plan daje (krediti, dnevni limiti)
//   2. koji Paddle `pri_` ID je koji plan / koliko kredita
//   3. koliko Places poziva sme da se potroši globalno
//
// Tabela planova je prepis docs/LANSIRANJE.md §1.3; paketi su §1.4. Kad se
// ponuda menja, menja se OVDE, pa se ekran cena (`apps/web/src/lib/cenovnik.ts`)
// prilagodi — ne obrnuto.

/** Kako se plaća pretplata. Isti ključ koristi i prekidač na ekranu cena. */
export type Ciklus = "month" | "year";

/**
 * Pet stanja plana. Samo tri se KUPUJU — v. `PaidPlanId`.
 *
 * `beta`    — postavlja ISKLJUČIVO admin, kroz konzolu (LANSIRANJE §1.1).
 *             Nikad iz registracije, nikad iz kupona, nikad iz webhooka. Rok
 *             trajanja je `profiles.beta_expires_at`; `NULL` je neograničeno.
 * `dopuna`  — nije plan koji se kupuje, nego stanje korisnika BEZ pretplate
 *             koji ima kredite iz paketa (`credits_topup > 0`). Nikad ne dobija
 *             mesečnu dodelu; dnevne limite deli sa Starterom.
 */
export type PlanId = "beta" | "dopuna" | "starter" | "pro" | "advanced";

/** Planovi koji postoje kao proizvod u Paddle-u. */
export type PaidPlanId = "starter" | "pro" | "advanced";

export type Plan = {
  /**
   * Krediti koji se POSTAVLJAJU svakog meseca, bez rollovera. Pune
   * `profiles.credits_balance` — kasu koja ističe. Krediti iz paketa žive u
   * `profiles.credits_topup` i ovaj broj ih ne dodiruje (migracija 0022).
   */
  monthlyCredits: number;
  /**
   * Dnevni OSIGURAČ za skeniranja — zaštita od odbeglog skripta, ne cenovnik.
   *
   * Mesečnog capa na skeniranja nema i neće ga biti: od S17 je cena 1 kredit po
   * stranici rezultata, dakle 1 kredit = 1 Places poziv, pa je novčanik sam po
   * sebi ograničenje (LANSIRANJE §1.2). Drugi cap preko njega bi bio samo drugi
   * broj koji može da se raziđe sa prvim.
   *
   * Ime je istorijsko (`cache_miss_day` / `cache_miss_count` u bazi): pretraga
   * po kešu je besplatna i neograničena, pa se broje samo promašaji.
   */
  cacheMissPerDay: number;
  /** Koliko redova dnevno sme da izveze u CSV. */
  exportPerDay: number;
  /**
   * Koliko „Napiši drugačije" varijanti poruke sme dnevno (LANSIRANJE §1.3).
   *
   * Ovo je Pro razlika umesto ranije obećanih „AI poruka po kanalu": kod daje
   * sve kanale svima i nema razloga da ih uzima Starteru, a varijanta poruke je
   * jedini AI poziv koji korisnik ponavlja iz radoznalosti — dakle jedini koji
   * stvarno košta po kliku.
   *
   * Brojač je `profiles.ai_rewrite_day` / `ai_rewrite_count`, kapija je
   * `claim_ai_rewrite` (migracija 0022).
   */
  aiRewritePerDay: number;
};

export const PLANS: Record<PlanId, Plan> = {
  beta:     { monthlyCredits:  50, cacheMissPerDay:  15, exportPerDay:   500, aiRewritePerDay:  5 },
  dopuna:   { monthlyCredits:   0, cacheMissPerDay:  30, exportPerDay:   500, aiRewritePerDay:  5 },
  starter:  { monthlyCredits: 100, cacheMissPerDay:  30, exportPerDay:   500, aiRewritePerDay:  5 },
  pro:      { monthlyCredits: 300, cacheMissPerDay:  60, exportPerDay:  2000, aiRewritePerDay: 20 },
  advanced: { monthlyCredits: 800, cacheMissPerDay: 120, exportPerDay: 10000, aiRewritePerDay: 60 },
};

/**
 * Podrazumevan plan — i za nov nalog, i kao pad kad u bazi stoji vrednost koju
 * kod ne poznaje.
 *
 * ‼️ NIJE `beta`, i to je odluka D1 (LANSIRANJE §1.1), zatvorena u S20.
 *    Do migracije 0024 je ovde stajalo `beta`, uz `profiles.plan default 'beta'`
 *    — a `beta_expires_at IS NULL` po §1.5 znači NEOGRANIČENO. Zajedno je to
 *    značilo da svaka registracija otvara doživotan besplatan nalog, i da
 *    nepoznata vrednost u koloni radi isto.
 *
 * `dopuna` je „korisnik bez pretplate": sa nula kredita u obe kase
 * `stanjePristupa()` ga čita kao `zakljucan` i vodi na cenovnik, a čim kupi
 * paket, `credits_topup > 0` ga vraća u pun pristup — bez ijedne izmene plana.
 * Poklapa se sa `profiles.plan default 'dopuna'` iz 0024.
 */
export const DEFAULT_PLAN: PlanId = "dopuna";

/** Nepoznat plan iz baze ne sme da sruši rutu — padni na podrazumevani. */
export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id ?? DEFAULT_PLAN) as PlanId] ?? PLANS[DEFAULT_PLAN];
}

/**
 * Koliko dana posle isteka korisnik i dalje SME DA ČITA svoje (LANSIRANJE §1.5).
 *
 * U `grace` stanju rade postojeći prospekti, pipeline i oba izvoza; pretraga,
 * skeniranje i otključavanje ne rade. Trideset dana je namerno velikodušno:
 * otključani prospekti su plaćeni, pipeline je korisnikov rad, a oduzeti mu ih
 * istog dana je najbrži put do chargebacka.
 *
 * Kapija koja ovo koristi je S19; ovde stoji da broj ne bi bio upisan u tri
 * komponente.
 */
export const GRACE_DAYS = 30;

/**
 * Podrazumevana dužina bete u danima (LANSIRANJE §1.5, odluka P6).
 *
 * Broj kredita koje beta nalog dobija pri otvaranju NIJE ovde nego u
 * `PLANS.beta.monthlyCredits` — to je isti podatak i ne sme da postoji dvaput.
 *
 * Oba su samo PREDLOG koji obrazac u konzoli popuni; admin sme da postavi drugi
 * datum, „neograničeno" ili drugi broj kredita.
 */
export const BETA_DEFAULT_DAYS = 30;

// ═══════════════════════════════════════════════════════════
// PADDLE KATALOG
// ═══════════════════════════════════════════════════════════
// ‼️ ID-jevi su iz SANDBOX naloga. Sandbox i produkcija su odvojeni katalozi —
//    `pri_` iz jednog ne postoji u drugom i Paddle.js na njemu vrati „price not
//    found". Pri prelasku na produkciju menjaju se ovaj spisak,
//    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN i NEXT_PUBLIC_PADDLE_ENV — sve troje zajedno.
//
// Zašto u `packages/shared`, a ne u `apps/web/src/lib/cenovnik.ts` gde su bili:
// webhook (S18) mora da preslika `pri_` → plan, a webhook je serverski kod koji
// ne sme da zavisi od fajla ekrana cena. Da su ID-jevi ostali na dva mesta,
// razilaženje bi se videlo tek kad neko plati — i to kao „platio Pro, dobio
// Starter". Ovako je ekran cena taj koji uvozi odavde, pa razilaženje ne može
// ni da nastane: nema drugog spiska.
//
// Cene NAMERNO nisu ovde. Iznos ispisuje isključivo Paddle, kroz `PricePreview()`,
// već formatiran i sa porezom po zemlji posetioca. Broj upisan u kod bio bi
// četvrti izvor istine (Paddle, checkout, faktura, kod) i razišao bi se prvog
// dana kad se cena promeni.
//
// Nema nijednog `unit_price_overrides` za `RS` (odluka P7): jedna EUR cena za
// ceo svet. Paddle ne podržava RSD, pa je override bio sniženi evro za kupce iz
// Srbije — ostatak napuštenog pokušaja da cena bude u dinarima. Vraća se, ako
// ikad zatreba, JEDNIM poljem na ceni u Paddle panelu: bez migracije, bez
// izmene koda, bez deploya.

export const PLAN_PRICE_IDS: Record<PaidPlanId, Record<Ciklus, string>> = {
  starter: {
    month: "pri_01m0d1ev6hhw8gkr8wep26ccwq",
    year:  "pri_01m0d1evasz8q3cjr825r47875",
  },
  pro: {
    month: "pri_01m0d1evmksy2njzrwh6hgcxf1",
    year:  "pri_01m0d1evrkaph19esyfjkgvrq4",
  },
  advanced: {
    month: "pri_01m0d1ew18pfyjwe4de9jc7tqw",
    year:  "pri_01m0d1ew53ndkee89grn2dc1w3",
  },
};

/**
 * Paketi kredita (LANSIRANJE §1.4). Jednokratna kupovina, krediti NE ISTIČU.
 *
 * Cena po kreditu je namerno viša nego u pretplati (+31% i +13% naspram
 * Startera): paket je dopuna, ne jeftinija zamena za plan. Trećeg, većeg paketa
 * nema — da bi ostao iznad Startera morao bi da košta više od Advanced plana za
 * manje kredita.
 */
export type PaketId = "dopuna-50" | "dopuna-150";

export const CREDIT_PACKS: Record<PaketId, { credits: number; priceId: string }> = {
  "dopuna-50":  { credits:  50, priceId: "pri_01m0ffx0j4pyxenvfxrjwz55pf" },
  "dopuna-150": { credits: 150, priceId: "pri_01m0ffx0q683zv2z0d7dh0qm3v" },
};

/**
 * `pri_` → plan. Gradi se IZ `PLAN_PRICE_IDS`, ne piše se ručno: ručno pisana
 * obrnuta mapa je drugi spisak istih ID-jeva, dakle tačno ono što ovaj fajl
 * postoji da spreči.
 */
const PLAN_BY_PRICE_ID: Readonly<Record<string, PaidPlanId>> = Object.fromEntries(
  (Object.entries(PLAN_PRICE_IDS) as [PaidPlanId, Record<Ciklus, string>][]).flatMap(
    ([plan, ids]) => [
      [ids.month, plan],
      [ids.year, plan],
    ],
  ),
);

const CREDITS_BY_PRICE_ID: Readonly<Record<string, number>> = Object.fromEntries(
  Object.values(CREDIT_PACKS).map((p) => [p.priceId, p.credits]),
);

/** Koji plan je kupljen. `null` = `pri_` koji nije naš plan (paket ili tuđ katalog). */
export function planForPriceId(priceId: string | null | undefined): PaidPlanId | null {
  return priceId ? PLAN_BY_PRICE_ID[priceId] ?? null : null;
}

/** Koliko kredita nosi kupljen paket. `null` = `pri_` koji nije naš paket. */
export function creditsForPriceId(priceId: string | null | undefined): number | null {
  return priceId ? CREDITS_BY_PRICE_ID[priceId] ?? null : null;
}

/** Svi `pri_` iz kataloga — za jedan `PricePreview()` poziv umesto osam. */
export const ALL_PRICE_IDS: readonly string[] = [
  ...Object.values(PLAN_PRICE_IDS).flatMap((ids) => [ids.month, ids.year]),
  ...Object.values(CREDIT_PACKS).map((p) => p.priceId),
];

// ═══════════════════════════════════════════════════════════
// GLOBALNI KAPOVI — BUDŽET, NE PROIZVOLJAN BROJ
// ═══════════════════════════════════════════════════════════
// Ovo je tvrdi stop u kodu, ne preporuka (CLAUDE.md, sekcija Budžet).

/**
 * Cena jednog Places Text Search poziva, u evrima.
 *
 * ‼️ SKU je **Text Search ENTERPRISE** (`E967-44BC-B44D`), $35 na 1.000 poziva.
 *    Ne Essentials. Razlog je `FIELD_MASK` u `apps/worker/src/lib/places.ts`:
 *    traži `nationalPhoneNumber` i `websiteUri`, a kontakt polja podižu poziv u
 *    Enterprise razred.
 *
 * ‼️ ZAMKA U GOOGLEOVOJ TABELI, i jedini razlog zbog kog ovaj komentar postoji:
 *    Essentials SKU-ovi imaju **10.000** besplatnih poziva mesečno, Enterprise
 *    ima **1.000**. Pogrešan red daje budžet deset puta veći nego što jeste, a
 *    greška se ne vidi dok ne stigne račun.
 */
export const PLACES_EUR_PER_CALL = 0.032;

/** Googleov besplatan prag za BAŠ TAJ SKU. Ne 10.000 — v. zamku iznad. */
export const PLACES_FREE_CALLS_MONTH = 1000;

/**
 * Koliko sam mesečno spreman da platim preko besplatnog praga (odluka P2).
 *
 * ‼️ OVO JE SVESNO POVEĆANJE BROJA PLACES POZIVA, prijavljeno po pravilu iz
 *    CLAUDE.md. Stari kapovi (75 dnevno / 900 mesečno) držali su potrošnju na
 *    nuli po cenu toga da se skeniranje odbija plaćenom korisniku. Očekivan
 *    račun na prvih 20 korisnika je **€5–15 mesečno**; tvrda granica je €60,
 *    preko koje se skeniranje zaustavlja i vraća `partial: true`, kao i danas.
 *
 * ‼️ BUDŽET MORA DA RASTE SA BROJEM PRETPLATNIKA. Jedan Advanced korisnik ima
 *    800 kredita mesečno, dakle u najgorem režimu sam troši skoro trećinu celog
 *    kapa. Ovo ulazi u nedeljnu rutinu: uporedi tempo u `api_budget` sa brojem
 *    aktivnih pretplata i podigni `PLACES_MONTHLY_BUDGET_EUR` PRE nego što cap
 *    počne da odbija skeniranje plaćenom korisniku. Odbijeno skeniranje je
 *    povraćaj i loša reč — skuplje od svakog Places računa.
 *
 * Čita se iz env-a jer se menja bez deploya. Ovo je jedino mesto u
 * `packages/shared` koje dodiruje `process.env`, i čita se odbranjeno: paket
 * ulazi i u klijentski bundle, gde `process` ume da ne postoji.
 */
export const PLACES_MONTHLY_BUDGET_EUR = ((): number => {
  const sirovo =
    typeof process !== "undefined" ? process.env?.PLACES_MONTHLY_BUDGET_EUR : undefined;
  const n = Number(sirovo);
  return sirovo !== undefined && sirovo !== "" && Number.isFinite(n) && n >= 0 ? n : 60;
})();

/**
 * TVRDA mesečna granica: besplatan prag plus ono što je budžet kupio.
 * Sa podrazumevanih €60 to je 1.000 + 1.875 = 2.875 poziva.
 *
 * Pošto je od S17 **1 kredit = 1 Places poziv**, ovo je ujedno i gornja granica
 * kredita koji smeju otići na skeniranje — oko 28 Starter korisnika koji SVE
 * kredite bace na skeniranje, ili realno 60–100 korisnika u normalnom režimu.
 */
export const GLOBAL_MONTHLY_API_CAP =
  PLACES_FREE_CALLS_MONTH + Math.floor(PLACES_MONTHLY_BUDGET_EUR / PLACES_EUR_PER_CALL);

/**
 * Dnevni cap je MEKA granica — zaštita od odbeglog skripta, ne budžet. Googleu
 * je nebitna dnevna raspodela, bitan mu je zbir za mesec.
 *
 * Deli se sa 20, ne sa 30: dozvoljava neravnomeran mesec (nedelja kad se javi
 * pet korisnika odjednom) bez toga da jedan dan pojede sve.
 */
export const GLOBAL_DAILY_API_CAP = Math.floor(GLOBAL_MONTHLY_API_CAP / 20);

// ── kapovi za ne-Google pozive (F6) ───────────────────────
// Ovi brojači stoje u `api_budget.by_kind` i NE diraju `calls` — v. migraciju
// 0005 i `consume_side_call`. Googleov mesečni prag se njima ne troši.

/**
 * PageSpeed Insights, dnevno. PSI daje 25.000 poziva dnevno uz ključ, pa ovo
 * nije budžet nego zaštita od odbeglog skripta. Duplo od AI capa jer PSI ume da
 * se pusti i na backfillu, a ne košta ništa.
 */
export const PSI_DAILY_CAP = 120;

/**
 * Claude vision analiza, dnevno. Ovo je JEDINI cap iza koga stoji stvaran račun.
 *
 * 60 nije proizvoljno: 20 beta korisnika × 30 kredita mesečno je gornja granica
 * od 600 unlockova mesečno (F6 §3), dakle prosek od 20 dnevno. Trostruko od
 * proseka ostavlja mesta za dan kad se svi jave odjednom, a i dalje drži dnevni
 * trošak u redu veličine jednog evra.
 *
 * Preko capa `enrich_full` PRESKAČE AI korak i ostavlja `audit_level = 2` —
 * lead i dalje ima skor, screenshot i PSI. Posao se ne odlaže i ne pada.
 */
export const AI_DAILY_CAP = 60;

/**
 * „Napiši drugačije" — AI varijanta outreach poruke (F7 §2), dnevno, GLOBALNO.
 *
 * Zaseban cap od `AI_DAILY_CAP`, i to je cela poenta: analiza otključanog leada
 * je jednokratna i korisnik je platio kreditom, a dugme „Napiši drugačije" se
 * pritiska iz radoznalosti i može da se pritisne deset puta za isti lead.
 * Sa zajedničkim capom bi to pojelo budžet za analizu — a analiza je proizvod,
 * varijanta poruke je začin.
 *
 * Ovo je granica nad MOJIM računom kod Anthropica. Granica po korisniku je
 * `Plan.aiRewritePerDay` i to su dva različita pitanja: ovaj cap štiti mene i
 * kad se svi jave istog dana, onaj štiti ponudu (Starter nije Pro).
 */
export const AI_OUTREACH_DAILY_CAP = 40;

/** Google resetuje kvotu u 09:00 po lokalnom vremenu Kalifornije. */
export const BUDGET_TIMEZONE = "America/Los_Angeles";

/**
 * Krediti se resetuju po domaćem kalendaru, ne po Googleovom.
 *
 * Dnevni brojači (`cache_miss_day`, `export_day`, `ai_rewrite_day`) namerno idu
 * po LA danu — oni štite moju kvotu. Mesečna dodela nema veze sa kvotom:
 * korisniku u Šapcu „prvog u mesecu" znači prvog po njegovom kalendaru.
 */
export const CREDITS_TIMEZONE = "Europe/Belgrade";

/**
 * Mesec u obliku `2026-09`, po domaćem vremenu. Ovo je `ref_id` za mesečnu
 * dodelu, dakle ključ idempotencije — dva poziva sa istim mesecom su jedan.
 */
export function creditMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CREDITS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

/**
 * Kad stiže sledeća mesečna dodela — prvi dan narednog meseca, kao ISO datum.
 *
 * Postoji zbog S21: `/krediti` mora da uz kasu koja ISTIČE napiše TAČAN datum
 * obnove, jer je „obnavlja se prvog u mesecu" rečenica koju korisnik čita 28.
 * u mesecu i ne zna da li se odnosi na sutra ili na pet nedelja.
 *
 * Mesec se uzima iz `creditMonth()`, dakle po istom beogradskom kalendaru po
 * kom `grant_monthly_credits` računa svoj ključ idempotencije — druga računica
 * bi ispisala datum koji se ne poklapa sa dodelom.
 *
 * Vreme je `T12:00:00Z`, a ne ponoć, i to je jedina sitnica u ovoj funkciji:
 * `formatDatum()` renderuje po vremenskoj zoni procesa, pa bi ponoć u UTC-u na
 * mašini zapadno od Griniča ispala prethodni dan. Podne izdrži ±11 sati.
 */
export function sledecaDodelaKredita(now: Date = new Date()): string {
  const delovi = creditMonth(now).split("-");
  const godina = Number(delovi[0]);
  const mesec = Number(delovi[1]);
  const prelazak = mesec === 12;
  const g = prelazak ? godina + 1 : godina;
  const m = prelazak ? 1 : mesec + 1;
  return `${g}-${String(m).padStart(2, "0")}-01T12:00:00.000Z`;
}

/** Pravilo 1 iz CLAUDE.md: Google podatak stariji od ovoga se ne servira. */
export const GOOGLE_TTL_DAYS = 30;

// ═══════════════════════════════════════════════════════════
// DUBINA SKENIRANJA — 1 KREDIT = 1 STRANICA = 1 PLACES POZIV
// ═══════════════════════════════════════════════════════════
// LANSIRANJE §1.2, isporuka S17. Ovo je JEDINI izvor cene skeniranja; do S17 je
// tu stajala konstanta `SCAN_CREDIT_COST = 1` i ona više ne postoji.
//
// ── zašto je jedinica STRANICA, a ne „skeniranje" ─────────
// Text Search vraća najviše 20 rezultata po stranici i naplaćuje SVAKU stranicu
// kao poseban poziv (`consume()` je u `fetchPage`, ne u `searchText`). Skeniranje
// za 20 rezultata je zato koštalo mene 1 poziv, a za 60 rezultata 3 — trostruka
// razlika u trošku uz istu cenu za korisnika. Od S17 se cena poklapa sa troškom,
// pa novčanik sam po sebi ograničava izloženost: nema režima potrošnje koji je
// 3× skuplji od drugog.
//
// ── zašto POSTOJI i tip `Dubina`, a ne samo funkcija ──────
// Cena je funkcija broja stranica — `cenaSkeniranja(maxResults)` je totalna nad
// bilo kojim brojem i nju koriste worker, CLI i SQL (isti izraz u migraciji
// 0023). Ali korisnik ne bira „37 rezultata": bira jednu od tri ponude, ta se
// ponuda deli linkom (`?dubina=duboko`) i mora da preživi Back. Zato je `Dubina`
// ZATVOREN skup od tri člana — token koji UI prikazuje i URL nosi — dok je
// `stranicaZaRezultate` derivacija koja i za zatečen payload (`maxResults: 30`
// iz starih poslova) i za CLI-jev slobodan `--broj` daje istu cenu.
//
// Dva izvora bi se razišla; ovako je `DUBINE[d].maxResults` samo IMENOVANA
// vrednost iste funkcije, a `dubinaZaRezultate` je njen inverz.

/** Koliko rezultata Places vraća po stranici. Googleov maksimum, ne naš izbor. */
export const PLACES_PAGE_SIZE = 20;

/** Tvrda granica Text Searcha: 3 stranice × 20 = 60 rezultata. */
export const PLACES_MAX_PAGES = 3;

/**
 * Koliko stranica (dakle Places poziva, dakle kredita) traži toliko rezultata.
 *
 * Ograničeno na 1–3 sa obe strane: `0` bi značilo besplatno skeniranje, a `4`
 * poziv koji Google ionako ne vraća. Ista formula stoji u `spend_credit_and_scan`
 * (migracija 0023) — tamo je izvor naplate, ovde izvor prikaza.
 */
export function stranicaZaRezultate(maxResults: number): number {
  const n = Number.isFinite(maxResults) ? Math.floor(maxResults) : 0;
  return Math.min(PLACES_MAX_PAGES, Math.max(1, Math.ceil(n / PLACES_PAGE_SIZE)));
}

/** Cena skeniranja u kreditima. 1 kredit = 1 stranica = 1 Places poziv. */
export function cenaSkeniranja(maxResults: number): number {
  return stranicaZaRezultate(maxResults);
}

/** Tri ponude na ekranu pretrage. Vrednost ide u URL, pa se ne prevodi. */
export type Dubina = "brzo" | "standardno" | "duboko";

/** Redosled u segmentnoj kontroli — od najjeftinije ka najskupljoj. */
export const DUBINE = ["brzo", "standardno", "duboko"] as const satisfies readonly Dubina[];

/**
 * Podrazumevana dubina. Namerno „Standardno" (2 kredita): korisnik koji ništa ne
 * dira plaća isto koliko je do S17 plaćalo svako skeniranje bilo koje dubine.
 */
export const PODRAZUMEVANA_DUBINA: Dubina = "standardno";

export type DubinaOpis = {
  /** Šta piše na dugmetu. */
  labela: string;
  /** Gornja granica rezultata — ono što ide u `payload.maxResults`. */
  maxResults: number;
  /** Broj stranica = broj Places poziva = cena u kreditima. */
  stranica: number;
};

/**
 * `maxResults` je NAMERNO tačan umnožak stranice (20/40/60), a ne „do 45".
 * Worker računa stranice iz `maxResults`, pa svaka vrednost između bi značila da
 * plaćeno i skenirano više nisu isti broj poziva.
 */
export const DUBINA_OPIS: Record<Dubina, DubinaOpis> = {
  brzo:       { labela: "Brzo",       maxResults: 20, stranica: 1 },
  standardno: { labela: "Standardno", maxResults: 40, stranica: 2 },
  duboko:     { labela: "Duboko",     maxResults: 60, stranica: 3 },
};

/** Koliko kredita košta izabrana dubina. */
export function cenaDubine(dubina: Dubina): number {
  return DUBINA_OPIS[dubina].stranica;
}

/** Koliko rezultata nosi izabrana dubina — jedina vrednost koja sme u payload. */
export function maxRezultataZaDubinu(dubina: Dubina): number {
  return DUBINA_OPIS[dubina].maxResults;
}

/**
 * Inverz: koja je ponuda odgovarala ovom broju rezultata.
 *
 * Postoji zbog zatečenih podataka — poslovi upisani pre S17 nose `maxResults: 30`,
 * a redovi u `search_cache` dobijaju dubinu backfillom iz broja rezultata. Bez
 * inverza bi ekran za takav red morao da izmisli oznaku.
 */
export function dubinaZaRezultate(maxResults: number): Dubina {
  const stranica = stranicaZaRezultate(maxResults);
  return DUBINE.find((d) => DUBINA_OPIS[d].stranica === stranica) ?? PODRAZUMEVANA_DUBINA;
}

/** Nepoznata vrednost iz URL-a ili tela zahteva ne sme da sruši ekran. */
export function dubinaIli(raw: unknown, rezerva: Dubina = PODRAZUMEVANA_DUBINA): Dubina {
  return DUBINE.find((d) => d === raw) ?? rezerva;
}

/**
 * Šta je tačno kupljeno za dati `pri_`.
 *
 * Postoji da bi checkout (S18) i webhook (S18) grananje radili nad ISTIM
 * spiskom. Ranije su postojale dve poluge — `planForPriceId` i
 * `creditsForPriceId` — i svaki pozivalac je sam sklapao „ako nije plan, valjda
 * je paket". To „valjda" je na novčanoj putanji: `pri_` iz tuđeg kataloga bi
 * prošao kroz obe provere kao `null` i završio kao paket od `null` kredita.
 *
 * Zatvoren rezultat (`Kupovina | null`) tera pozivaoca da odbije nepoznat ID
 * eksplicitno, umesto da mu se odsustvo grane provuče kao grana.
 */
export type Kupovina =
  | { kind: "subscription"; plan: PaidPlanId; ciklus: Ciklus; credits: number }
  | { kind: "pack"; paket: PaketId; credits: number };

const CIKLUS_BY_PRICE_ID: Readonly<Record<string, Ciklus>> = Object.fromEntries(
  Object.values(PLAN_PRICE_IDS).flatMap((ids) => [
    [ids.month, "month" as Ciklus],
    [ids.year, "year" as Ciklus],
  ]),
);

const PAKET_BY_PRICE_ID: Readonly<Record<string, PaketId>> = Object.fromEntries(
  (Object.entries(CREDIT_PACKS) as [PaketId, { credits: number; priceId: string }][]).map(
    ([paket, p]) => [p.priceId, paket],
  ),
);

/**
 * `pri_` → šta se za njega dobija. `null` znači „nije iz našeg kataloga" i
 * jedini ispravan odgovor na njega je odbijanje, ne podrazumevana vrednost.
 *
 * `credits` je za pretplatu MESEČNA dodela — ista i za godišnji ciklus, jer se
 * godišnja pretplata naplaćuje jednom a krediti stižu svakog meseca. Godišnja
 * obnova kredita zato NE ide iz ovog broja nego iz mesečne dodele
 * (`grant_monthly_credits`, `creditMonth()` kao ključ idempotencije).
 */
export function kupovinaZaPriceId(priceId: string | null | undefined): Kupovina | null {
  if (!priceId) return null;

  const plan = PLAN_BY_PRICE_ID[priceId];
  if (plan) {
    return {
      kind: "subscription",
      plan,
      ciklus: CIKLUS_BY_PRICE_ID[priceId] ?? "month",
      credits: PLANS[plan].monthlyCredits,
    };
  }

  const paket = PAKET_BY_PRICE_ID[priceId];
  if (paket) return { kind: "pack", paket, credits: CREDIT_PACKS[paket].credits };

  return null;
}
