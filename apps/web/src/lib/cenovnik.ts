// apps/web/src/lib/cenovnik.ts
// Ekran cena: imena planova, kopi i redosled kartica.
//
// Šta ovde VIŠE NIJE, a bilo je: `pri_` ID-jevi i brojevi iz ponude. Oboje sada
// dolazi iz `packages/shared/src/plans.ts`, i to je poenta — webhook iz S18 mora
// da preslika `pri_` → plan, a on ne sme da uvozi fajl ekrana cena. Da su
// ID-jevi ostali i ovde, razilaženje bi se videlo tek kad neko plati, kao
// „platio Pro, dobio Starter". Ovako drugog spiska nema.
//
// Ostaje ovde: KOPI. Ime plana, rečenica kome je namenjen, tekst pogodnosti i
// nivo podrške — sve što je odluka o prodaji, a ne o proizvodu.
//
// Šta ovde NIJE i ne sme da bude: iznosi. Cenu ispisuje isključivo Paddle, kroz
// `formattedTotals.total` iz `PricePreview()` — već formatirana, u valuti
// posetioca, sa porezom po njegovoj zemlji. Broj upisan ovde bi bio četvrti
// izvor istine (Paddle, checkout, faktura, pa ovaj fajl) i razišao bi se prvog
// dana kad se cena promeni ili kad neko otvori stranu iz Nemačke, gde je u
// prikazanoj cifri i 19% PDV-a.

import {
  ALL_PRICE_IDS,
  CREDIT_PACKS,
  PLAN_PRICE_IDS,
  PLANS,
  type Ciklus,
  type PaidPlanId,
  type PaketId,
} from "@sajtoskop/shared";

export type { Ciklus };

export interface Tier {
  id: PaidPlanId;
  name: "Starter" | "Pro" | "Advanced";
  description: string;
  features: string[];
  priceId: Record<Ciklus, string>;
  /**
   * Istaknut plan. Tačno jedan sme da bude `true`: §7.1 dizajn sistema traži
   * jedno primarno dugme po ekranu, pa je ovo polje ono koje ga određuje.
   */
  featured?: boolean;
}

/**
 * `2000` → `„2.000"`. Ručno, a ne kroz `Intl.NumberFormat`: ovo se ispisuje i
 * na serveru i u pregledaču, a razlika u ICU podacima između to dvoje daje
 * hydration mismatch nad brojem koji je deo ponude.
 */
function broj(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Pogodnosti se RAČUNAJU iz `PLANS`, ne prepisuju.
 *
 * Ranije su brojevi stajali kao tekst na dva mesta — u `plans.ts` kao pravilo i
 * ovde kao obećanje. Dok se poklapaju, razlike nema; kad se raziđu, cenovnik
 * obeća 300 kredita a kapija dâ 100, i to niko ne primeti dok se neko ne požali.
 * Ovako `tsc` traži da plan postoji, a broj je isti po konstrukciji.
 *
 * Namerno ISTIH ŠEST STAVKI, istim redom, na sve tri kartice. Menja se samo
 * broj. Cenovnik na kome kartice nose različite spiskove tera posetioca da ih
 * čita jednu po jednu; ovako se porede pogledom niz kolonu.
 *
 * Šta NIJE ovde, iako je bilo: „AI poruke po kanalu — mejl, Viber, Instagram"
 * kao Pro pogodnost. Kod daje sve kanale svima i nema razloga da ih uzima
 * Starteru. Razlika je umesto toga dnevni broj AI VARIJANTI poruke — jedini AI
 * poziv koji korisnik ponavlja iz radoznalosti, dakle jedini koji košta po
 * kliku (docs/LANSIRANJE.md §1.3).
 */
function pogodnosti(plan: PaidPlanId, podrska: string): string[] {
  const p = PLANS[plan];
  return [
    `${broj(p.monthlyCredits)} kredita mesečno`,
    `Do ${broj(p.cacheMissPerDay)} skeniranja dnevno`,
    `${broj(p.aiRewritePerDay)} AI varijanti poruke dnevno`,
    `Izvoz u CSV do ${broj(p.exportPerDay)} redova dnevno`,
    "Pretraga po kešu, neograničeno",
    podrska,
  ];
}

export const TIERS: Tier[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Za frilensera koji radi sam i uzima nekoliko klijenata mesečno.",
    features: pogodnosti("starter", "Podrška mejlom"),
    priceId: PLAN_PRICE_IDS.starter,
  },
  {
    id: "pro",
    name: "Pro",
    description: "Za studio ili agenciju kojoj outreach ide svakog dana.",
    features: pogodnosti("pro", "Prioritet u podršci"),
    priceId: PLAN_PRICE_IDS.pro,
    featured: true,
  },
  {
    id: "advanced",
    name: "Advanced",
    description: "Za tim koji pokriva celu Srbiju i radi u više niša odjednom.",
    features: pogodnosti("advanced", "Odgovor u istom radnom danu"),
    priceId: PLAN_PRICE_IDS.advanced,
  },
];

// ── paketi kredita ──────────────────────────────────────────
// Jednokratna kupovina, bez `billing_cycle`. Krediti iz paketa NE ISTIČU i žive
// u `profiles.credits_topup` — odvojenoj kasi od pretplatnih kredita, koji se
// resetuju svakog meseca (v. docs/LANSIRANJE.md §1.4 i migraciju 0022).
//
// Cena po kreditu je NAMERNO viša nego u pretplati (+31% i +13% naspram Startera):
// paket je dopuna, ne jeftinija zamena za plan. Trećeg, većeg paketa nema — da bi
// ostao iznad Startera morao bi da košta više od Advanced plana za manje kredita.
//
// ‼️ Ovo je PODATAK, ne ekran. Sekcija koja pakete prikazuje dolazi u S21;
//    njihove cene se već učitavaju u istom `PricePreview()` pozivu (v. `SVI_PRICE_ID`).

export interface Paket {
  id: PaketId;
  name: string;
  /** Koliko kredita se dodeljuje. Izvor je `CREDIT_PACKS` iz `plans.ts`. */
  credits: number;
  description: string;
  priceId: string;
}

export const PAKETI: Paket[] = [
  {
    id: "dopuna-50",
    name: "Dopuna 50",
    description: "Za povremenu potrebu, kad plan nije isplativ.",
    ...CREDIT_PACKS["dopuna-50"],
  },
  {
    id: "dopuna-150",
    name: "Dopuna 150",
    description: "Kad meseca ponestane, a posao ne stane.",
    ...CREDIT_PACKS["dopuna-150"],
  },
];

/**
 * Bedž uz „Godišnje" na prekidaču.
 *
 * Stoji ovde, a ne u komponenti, jer je tvrdnja o KATALOGU, ne o dizajnu:
 * godišnja cena je deset mesečnih na sva tri plana. Ako se taj odnos ikad
 * promeni u Paddle-u, menja se i ovaj tekst — ili se briše. Namerno se ne
 * računa iz Paddle-ovog odgovora: to bi bila računica nad cenama u pregledaču,
 * a nju ne radimo (v. komentar na vrhu fajla).
 */
export const GODISNJI_BONUS = "2 meseca gratis";

/**
 * Svi `pri_` ID-jevi, za jedan `PricePreview()` poziv umesto osam.
 *
 * Paketi su ovde iako ih ekran cena još ne prikazuje (to je S21): jedan mrežni
 * poziv je isti posao za šest i za osam cena, a kad sekcija sa paketima stigne,
 * njihove cene su već učitane.
 */
export const SVI_PRICE_ID: readonly string[] = ALL_PRICE_IDS;

/** Nastavak uz cenu: „€29.00 / mesečno". */
export const CIKLUS_SUFIKS: Record<Ciklus, string> = {
  month: "mesečno",
  year: "godišnje",
};

export const CIKLUS_LABELA: Record<Ciklus, string> = {
  month: "Mesečno",
  year: "Godišnje",
};

export const CIKLUSI: Ciklus[] = ["month", "year"];
