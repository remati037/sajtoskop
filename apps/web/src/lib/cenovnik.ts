// apps/web/src/lib/cenovnik.ts
// Ekran cena: imena planova, kopi i redosled kartica.
//
// Šta ovde VIŠE NIJE, a bilo je: ID-jevi cena i brojevi iz ponude. Oboje sada
// dolazi iz `packages/shared/src/plans.ts`, i to je poenta — webhook mora da
// preslika `lookup_key` → plan, a on ne sme da uvozi fajl ekrana cena. Da su
// ključevi ostali i ovde, razilaženje bi se videlo tek kad neko plati, kao
// „platio Pro, dobio Starter". Ovako drugog spiska nema.
//
// Ostaje ovde: KOPI. Ime plana, rečenica kome je namenjen, tekst pogodnosti i
// nivo podrške — sve što je odluka o prodaji, a ne o proizvodu.
//
// [S25] Iznosi JESU ovde, ali kroz `PLAN_PRICES` iz `plans.ts` — Stripe hosted
// Checkout nema `PricePreview`, pa cenovnik mora da zna cifru pre nego što
// čovek ode na Stripe. Jedan izvor (§4): Stripe se proverava naspram
// `plans.ts` (`pnpm stripe:doktor`), ne obrnuto. Puna prepravka ekrana cena
// (K2) dolazi u S26; ovde je samo ono što ekran već čita.

import {
  CREDIT_PACKS,
  PLAN_PRICES,
  PLANS,
  type CenaPlana,
  type Ciklus,
  type PaidPlanId,
  type PaketId,
} from "@sajtoskop/shared";

export type { Ciklus };
export { GODISNJI_BONUS, formatEur } from "@sajtoskop/shared";

export interface Tier {
  id: PaidPlanId;
  name: "Starter" | "Pro" | "Advanced";
  description: string;
  features: string[];
  /** Iznos i `lookup_key` po ciklusu — iz `PLAN_PRICES`, jedinog izvora. */
  cena: Record<Ciklus, CenaPlana>;
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
 * [S25, D10] „Pretraga po kešu, neograničeno" je otišla — pristup kešu se
 * plaća. Umesto nje stoji obećanje iz §14.4 koje je ista stvar viđena s druge
 * strane: plaćaš samo ono što stvarno stigne.
 */
function pogodnosti(plan: PaidPlanId, podrska: string): string[] {
  const p = PLANS[plan];
  return [
    `${broj(p.monthlyCredits)} kredita mesečno`,
    `Do ${broj(p.cacheMissPerDay)} skeniranja dnevno`,
    `${broj(p.aiRewritePerDay)} AI varijanti poruke dnevno`,
    `Izvoz u CSV do ${broj(p.exportPerDay)} redova dnevno`,
    "Ako nađemo manje firmi nego što si tražio, razliku vraćamo",
    podrska,
  ];
}

export const TIERS: Tier[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Za frilensera koji radi sam i uzima nekoliko klijenata mesečno.",
    features: pogodnosti("starter", "Podrška mejlom"),
    cena: PLAN_PRICES.starter,
  },
  {
    id: "pro",
    name: "Pro",
    description: "Za studio ili agenciju kojoj outreach ide svakog dana.",
    features: pogodnosti("pro", "Prioritet u podršci"),
    cena: PLAN_PRICES.pro,
    featured: true,
  },
  {
    id: "advanced",
    name: "Advanced",
    description: "Za tim koji pokriva celu Srbiju i radi u više niša odjednom.",
    features: pogodnosti("advanced", "Odgovor u istom radnom danu"),
    cena: PLAN_PRICES.advanced,
  },
];

// ── paketi kredita ──────────────────────────────────────────
// Jednokratna kupovina, bez `recurring`. Krediti iz paketa NE ISTIČU i žive u
// `profiles.credits_topup` — odvojenoj kasi od pretplatnih kredita, koji se
// resetuju svakog meseca (v. docs/LANSIRANJE.md §1.4 i migraciju 0022).
//
// Cena po kreditu je NAMERNO viša nego u pretplati (+31% i +27% naspram Startera):
// paket je dopuna, ne jeftinija zamena za plan. Trećeg, većeg paketa nema — da bi
// ostao iznad Startera morao bi da košta više od Advanced plana za manje kredita.

export interface Paket {
  id: PaketId;
  name: string;
  /** Koliko kredita se dodeljuje. Izvor je `CREDIT_PACKS` iz `plans.ts`. */
  credits: number;
  description: string;
  /** Iznos u evrima, iz `CREDIT_PACKS`. */
  eur: number;
}

export const PAKETI: Paket[] = [
  {
    id: "dopuna-75",
    name: "Dopuna 75",
    description: "Za povremenu potrebu, kad plan nije isplativ.",
    credits: CREDIT_PACKS["dopuna-75"].credits,
    eur: CREDIT_PACKS["dopuna-75"].eur,
  },
  {
    id: "dopuna-200",
    name: "Dopuna 200",
    description: "Kad meseca ponestane, a posao ne stane.",
    credits: CREDIT_PACKS["dopuna-200"].credits,
    eur: CREDIT_PACKS["dopuna-200"].eur,
  },
];

/** Nastavak uz cenu: „€29 / mesečno". */
export const CIKLUS_SUFIKS: Record<Ciklus, string> = {
  month: "mesečno",
  year: "godišnje",
};

export const CIKLUS_LABELA: Record<Ciklus, string> = {
  month: "Mesečno",
  year: "Godišnje",
};

export const CIKLUSI: Ciklus[] = ["month", "year"];
