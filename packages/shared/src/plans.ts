// packages/shared/src/plans.ts
// Konfiguracija planova, paketa kredita i globalnih kapova.
//
// Ovo je JEDAN IZVOR ISTINE za tri stvari koje se inače raziđu:
//   1. šta koji plan daje (krediti, dnevni limiti)
//   2. koliko koji plan i paket KOŠTA — Stripe katalog se proverava naspram ovoga
//   3. koliko Places poziva sme da se potroši globalno
//
// Tabela planova je iz docs/naplata-stripe.md §4 i §14.6; paketi su §14.6. Kad se
// ponuda menja, menja se OVDE, pa se ekran cena (`apps/web/src/lib/cenovnik.ts`)
// i Stripe katalog (`pnpm stripe:doktor`) prilagode — ne obrnuto.

/** Kako se plaća pretplata. Isti ključ koristi i prekidač na ekranu cena. */
export type Ciklus = "month" | "year";

/**
 * Pet stanja plana. Samo tri se KUPUJU — v. `PaidPlanId`.
 *
 * `komp`    — pun pristup bez Stripe-a (naplata-stripe.md §9, odluka D4). Nastaje
 *             ISKLJUČIVO kroz `admin_open_komp` (admin konzola) ili `redeem_invite`
 *             (pozivnica tipa `komp`). Nikad iz registracije, nikad iz webhooka.
 *             Rok je `profiles.komp_expires_at`; `NULL` je neograničeno. Limiti
 *             su Advanced (A3). Do S25 se zvao `beta`.
 * `dopuna`  — nije plan koji se kupuje, nego stanje korisnika BEZ pretplate
 *             koji ima kredite iz paketa (`credits_topup > 0`). Nikad ne dobija
 *             mesečnu dodelu; dnevne limite deli sa Starterom.
 */
export type PlanId = "komp" | "dopuna" | "starter" | "pro" | "advanced";

/** Planovi koji postoje kao proizvod u Stripe katalogu. */
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
  // komp = pun pristup bez Stripe-a; limiti Advanced (A3). monthlyCredits je
  // ono što worker POSTAVLJA prvog u mesecu dok komp traje (naplata-stripe.md §10).
  komp:     { monthlyCredits:  300, cacheMissPerDay: 120, exportPerDay: 10000, aiRewritePerDay: 60 },
  dopuna:   { monthlyCredits:    0, cacheMissPerDay:  30, exportPerDay:   500, aiRewritePerDay:  5 },
  // Brojevi iz naplata-stripe.md §14.6: 150 / 450 / 1.200.
  starter:  { monthlyCredits:  150, cacheMissPerDay:  30, exportPerDay:   500, aiRewritePerDay:  5 },
  pro:      { monthlyCredits:  450, cacheMissPerDay:  60, exportPerDay:  2000, aiRewritePerDay: 20 },
  advanced: { monthlyCredits: 1200, cacheMissPerDay: 120, exportPerDay: 10000, aiRewritePerDay: 60 },
};

/**
 * Podrazumevan plan — i za nov nalog, i kao pad kad u bazi stoji vrednost koju
 * kod ne poznaje.
 *
 * ‼️ NIJE `komp` (nekadašnja `beta`), i to je odluka D1 (LANSIRANJE §1.1),
 *    zatvorena u S20. Do migracije 0024 je ovde stajalo `beta`, uz
 *    `profiles.plan default 'beta'` — a prazan rok po §1.5 znači NEOGRANIČENO.
 *    Zajedno je to značilo da svaka registracija otvara doživotan besplatan
 *    nalog, i da nepoznata vrednost u koloni radi isto.
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
 * Podrazumevana dužina komp pristupa u danima (naplata-stripe.md §9, odluka D4).
 *
 * Broj kredita koje komp nalog dobija pri otvaranju NIJE ovde nego u
 * `PLANS.komp.monthlyCredits` — to je isti podatak i ne sme da postoji dvaput.
 *
 * Oba su samo PREDLOG koji obrazac u konzoli (ili pozivnica) popuni; admin sme
 * da postavi drugi datum, „neograničeno" ili drugi broj kredita.
 */
export const KOMP_DEFAULT_DAYS = 30;

// ── proba (D2) ──────────────────────────────────────────────
// Kartica pre probe, 7 dana, 10 kredita; prva naplata osmog dana
// (naplata-stripe.md §2.3, §7). Proba se šalje iz koda u svaki Checkout
// Session, ne podešava se na ceni — Stripe „free trial days" na Price ne
// postoji kao stalan atribut.

/** Koliko dana traje proba. */
export const TRIAL_DAYS = 7;

/** Koliko kredita nosi proba. Jednom po NALOGU, ref `trial:<user>` (§3.4). */
export const TRIAL_CREDITS = 10;

// ═══════════════════════════════════════════════════════════
// CENE — JEDINI IZVOR. STRIPE SE PROVERAVA NASPRAM OVOGA.
// ═══════════════════════════════════════════════════════════
// naplata-stripe.md §4. Stripe hosted Checkout prikazuje iznos na svojoj
// strani; naš cenovnik ga mora prikazati PRE toga, i on ga čita odavde.
// Stripe katalog se PROVERAVA naspram ovog fajla (`pnpm stripe:doktor`), ne
// obrnuto.
//
// ‼️ Nijedan Stripe ID (`prod_`, `price_`, `cus_`, kupon) ne ulazi u kod.
//    `lookup_key` je stabilan preko test/live naloga; `price_` ID-jevi su u
//    ta dva naloga RAZLIČITI i zato ih server nalazi tek u trenutku checkout-a
//    (`apps/web/src/lib/stripe-katalog.ts`), po ključu odavde.
//
// Iznos na Stripe ceni se NE menja (Stripe cene su nepromenljive) — pravi se
// nova cena sa istim `lookup_key` i `transfer_lookup_key: true`, stara se
// arhivira (§14.8). Postojeći pretplatnici ostaju na staroj ceni.

/** `lookup_key` je stabilan preko test/live; `price_` ID nikad ne ulazi u kod. */
export type LookupKey = `${PaidPlanId}_${Ciklus}` | `pack_${number}`;

export type CenaPlana = { eur: number; lookupKey: LookupKey };

export const PLAN_PRICES: Record<PaidPlanId, Record<Ciklus, CenaPlana>> = {
  starter:  { month: { eur: 29,  lookupKey: "starter_month"  }, year: { eur: 290,  lookupKey: "starter_year"  } },
  pro:      { month: { eur: 59,  lookupKey: "pro_month"      }, year: { eur: 590,  lookupKey: "pro_year"      } },
  advanced: { month: { eur: 119, lookupKey: "advanced_month" }, year: { eur: 1190, lookupKey: "advanced_year" } },
};

/**
 * Paketi kredita (naplata-stripe.md §14.6). Jednokratna kupovina, krediti NE ISTIČU.
 *
 * Cena po kreditu je namerno viša nego u pretplati (+31% i +27% naspram
 * Startera): paket je dopuna, ne jeftinija zamena za plan. Trećeg, većeg paketa
 * nema — da bi ostao iznad Startera morao bi da košta više od Advanced plana za
 * manje kredita.
 */
export type PaketId = "dopuna-75" | "dopuna-200";

export const CREDIT_PACKS: Record<PaketId, { credits: number; eur: number; lookupKey: LookupKey }> = {
  "dopuna-75":  { credits:  75, eur: 19, lookupKey: "pack_75"  },
  "dopuna-200": { credits: 200, eur: 49, lookupKey: "pack_200" },
};

/** Svih osam ključeva — za `prices.list({ lookup_keys })` i za `stripe:doktor`. */
export const ALL_LOOKUP_KEYS: readonly LookupKey[] = [
  ...Object.values(PLAN_PRICES).flatMap((c) => [c.month.lookupKey, c.year.lookupKey]),
  ...Object.values(CREDIT_PACKS).map((p) => p.lookupKey),
];

/**
 * Šta je tačno kupljeno za dati `lookup_key`.
 *
 * Postoji da bi checkout i webhook grananje radili nad ISTIM spiskom. Zatvoren
 * rezultat (`Kupovina | null`) tera pozivaoca da odbije nepoznat ključ
 * eksplicitno, umesto da mu se odsustvo grane provuče kao grana — ključ iz tuđeg
 * kataloga na novčanoj putanji ne sme da završi kao paket od `null` kredita.
 *
 * `credits` je za pretplatu MESEČNA dodela — ista i za godišnji ciklus, jer se
 * godišnja pretplata naplaćuje jednom a krediti stižu svakog meseca (§10).
 */
export type Kupovina =
  | { kind: "subscription"; plan: PaidPlanId; ciklus: Ciklus; credits: number; eur: number; lookupKey: LookupKey }
  | { kind: "pack"; paket: PaketId; credits: number; eur: number; lookupKey: LookupKey };

const BY_LOOKUP: Readonly<Record<string, Kupovina>> = Object.fromEntries([
  ...(Object.entries(PLAN_PRICES) as [PaidPlanId, Record<Ciklus, CenaPlana>][]).flatMap(([plan, c]) =>
    (["month", "year"] as const).map((ciklus) => [
      c[ciklus].lookupKey,
      {
        kind: "subscription",
        plan,
        ciklus,
        credits: PLANS[plan].monthlyCredits,
        eur: c[ciklus].eur,
        lookupKey: c[ciklus].lookupKey,
      } satisfies Kupovina,
    ]),
  ),
  ...(Object.entries(CREDIT_PACKS) as [PaketId, (typeof CREDIT_PACKS)[PaketId]][]).map(([paket, p]) => [
    p.lookupKey,
    { kind: "pack", paket, credits: p.credits, eur: p.eur, lookupKey: p.lookupKey } satisfies Kupovina,
  ]),
]);

/** `lookup_key` → šta se dobija. `null` = nije naš katalog → odbij. */
export function kupovinaZaLookupKey(key: string | null | undefined): Kupovina | null {
  return key ? (BY_LOOKUP[key] ?? null) : null;
}

/** Plan + ciklus → `lookup_key`. Ovo šalje checkout ruta u `prices.list`. */
export function lookupKeyZaPlan(plan: PaidPlanId, ciklus: Ciklus): LookupKey {
  return PLAN_PRICES[plan][ciklus].lookupKey;
}

export function lookupKeyZaPaket(paket: PaketId): LookupKey {
  return CREDIT_PACKS[paket].lookupKey;
}

/**
 * „€29", „€1.190" — ručno, bez `Intl`, zbog hydration-a: ispisuje se i na
 * serveru i u pregledaču, a razlika u ICU podacima daje neslaganje nad brojem
 * koji je deo ponude (isti razlog kao `broj()` u `cenovnik.ts`).
 */
export function formatEur(n: number): string {
  return "€" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Bedž uz „Godišnje" na prekidaču. Tvrdnja o KATALOGU: godišnja cena je deset
 * mesečnih na sva tri plana (`PLAN_PRICES`). Ako se odnos promeni, menja se i
 * ovaj tekst — ili se briše.
 */
export const GODISNJI_BONUS = "2 meseca gratis";

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
 *    1.200 kredita mesečno, dakle u najgorem režimu sam troši 1.200 od 2.875
 *    poziva — naplata-stripe.md §14.6 zato traži da `PLACES_MONTHLY_BUDGET_EUR`
 *    ode na €100 pre nego što se otvori peti pretplatnik. Ovo ulazi u nedeljnu rutinu: uporedi tempo u `api_budget` sa brojem
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
 *
 * [S25] Dignut sa 40 na 200 (naplata-stripe.md §14.2, B1): 40 je bilo ISPOD
 * onoga što jedan Advanced plan obećava (60 dnevno), pa bi tri Advanced
 * korisnika istog dana udarila u moj cap pre nego u svoj. 200 = 60 × 3 uz
 * rezervu; najgori trošak je uračunat u §14.7.
 */
export const AI_OUTREACH_DAILY_CAP = 200;

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
