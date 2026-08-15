// packages/shared/src/feedback-motor.ts
// Motor pravila za utiske (F11 §3).
//
// Čiste funkcije: bez React-a, bez `fetch`-a, bez `Date.now()` u telu odluke —
// trenutak se uvek prosleđuje. Zato se ista pravila mogu proveriti u testu, u
// ruti i u komponenti, i zato ne mogu da se raziđu.
//
// ── zašto motor, a ne `if` u komponenti ──────────────────────
// Pitanja su raspoređena po pet ekrana i tri stanja posla. Bez jednog mesta koje
// odlučuje, dva pitanja se pojave u istoj minuti — a korisnik ne vidi dva
// pitanja, vidi anketu, i zatvara sve što liči na nju do kraja bete.

import { vaziPitanje, type Pitanje, type Uslovi } from "./feedback-katalog";

const SAT_MS = 60 * 60 * 1000;
const DAN_MS = 24 * SAT_MS;

/** Tvrde granice iz F11 §3.1. Menjaju se ovde ili nigde. */
export const MOTOR = {
  /** Najviše pitanja po sesiji. Drugo pitanje pretvara proizvod u anketu. */
  PO_SESIJI: 1,
  /** Globalni cooldown pošto je pitanje prikazano. */
  COOLDOWN_SATI: 72,
  /** Ko odgovori, dobija mir. */
  COOLDOWN_POSLE_ODGOVORA_DANA: 7,
  /** Pitanje na prvom ekranu je pitanje pre iskustva. */
  NAJRANIJE_MS: 60_000,
  /** Dva odbacivanja zaredom → ćutanje. Čovek je rekao ne, dvaput. */
  ODBACIVANJA_DO_CUTANJA: 2,
  CUTANJE_DANA: 14,
  /** Treće odbacivanje → ćutanje do kraja bete. Ostaje samo dugme. */
  ODBACIVANJA_DO_KRAJA: 3,
  CUTANJE_DO_KRAJA_DANA: 3650,
} as const;

export type StatusPitanja = "prikazano" | "odgovoreno" | "odbaceno";

/** Jedan red iz `feedback_prompts`, sveden na ono što odluka koristi. */
export type StanjePitanja = {
  status: StatusPitanja;
  /** ISO trenutak poslednjeg prikaza. */
  shownAt: string;
};

/** Stanje motora za jednog korisnika — profil + `feedback_prompts`. */
export type MotorStanje = {
  cooldownUntil: string | null;
  mutedUntil: string | null;
  dismissStreak: number;
  poPitanju: Readonly<Record<string, StanjePitanja>>;
};

/** Šta se zna o TRENUTKU, a ne o korisniku. Sve stiže iz pregledača. */
export type MotorTrenutak = {
  /** Je li u ovoj sesiji već postavljeno pitanje (`sessionStorage`). */
  pitanoUSesiji: boolean;
  /** Nema posla u toku, nema otvorenog modala, panela ni dropdown-a. */
  ekranMiran: boolean;
  /** Koliko je prošlo od punog učitavanja strane. */
  odUcitavanjaMs: number;
  /**
   * Stanje naloga za pitanja koja imaju `uslov` (kampanjska).
   *
   * Opciono je zato što ga većina poziva ne treba: kontekstualno pitanje zavisi
   * samo od okidača. Kad ga nema, pitanje sa `uslov`-om **otpada** — motor koji
   * ne zna uslov nije motor koji sme da pretpostavi da je ispunjen.
   */
  uslovi?: Uslovi;
};

/** Zašto pitanja nema. Postoji da bi se u razvoju videlo šta je odlučilo. */
export type Razlog =
  | "cuti"
  | "vec-pitano-u-sesiji"
  | "ekran-nije-miran"
  | "prerano"
  | "cooldown"
  | "nema-kandidata";

/**
 * Sme li se pitanje uopšte pojaviti u ovom trenutku i ovom nalogu, mimo
 * cooldowna i istorije: nije mu istekao rok (`do:`) i uslov nad nalogom stoji.
 */
function kandidatVazi(pitanje: Pitanje, trenutak: MotorTrenutak, sada: number): boolean {
  if (!vaziPitanje(pitanje, sada)) return false;
  if (!pitanje.uslov) return true;
  return trenutak.uslovi !== undefined && pitanje.uslov(trenutak.uslovi);
}

export type Odluka = { pitanje: Pitanje } | { pitanje: null; razlog: Razlog };

const kasnije = (iso: string | null, sada: number): boolean =>
  iso !== null && Date.parse(iso) > sada;

/**
 * Sme li se BAŠ ovo pitanje postaviti ovom korisniku ikad ponovo.
 *
 * Podrazumevano jednom po nalogu, zauvek — i to bez obzira da li je odgovoreno
 * ili samo viđeno. Korisnik koji je pitanje video i ignorisao ga ne sme da ga
 * vidi ponovo (§3.2). Izuzetak nosi samo pitanje sa `ponovi`.
 */
export function smeDaSePita(pitanje: Pitanje, stanje: MotorStanje, sada: number): boolean {
  const dosad = stanje.poPitanju[pitanje.kljuc];
  if (!dosad) return true;
  if (!pitanje.ponovi) return false;

  const od = Date.parse(dosad.shownAt);
  if (Number.isNaN(od)) return false;
  return sada - od >= pitanje.ponovi.naSati * SAT_MS;
}

/**
 * Redosled odlučivanja iz F11 §3.2. `kandidati` su pitanja čiji je OKIDAČ već
 * pukao — motor ne zna ništa o listama, poslovima ni otključavanjima.
 *
 * Incident sme preko cooldowna, ali ne preko ćutanja i ne preko pravila „jedno
 * po sesiji": čovek koji je rekao ne dvaput nije rekao ne samo molbama.
 */
export function odluci(
  stanje: MotorStanje,
  trenutak: MotorTrenutak,
  kandidati: readonly Pitanje[],
  sada: number = Date.now(),
): Odluka {
  if (kasnije(stanje.mutedUntil, sada)) return { pitanje: null, razlog: "cuti" };
  if (trenutak.pitanoUSesiji) return { pitanje: null, razlog: "vec-pitano-u-sesiji" };

  // Odlaganje, ne odbijanje: sledeći događaj na mirnom ekranu prolazi.
  if (!trenutak.ekranMiran) return { pitanje: null, razlog: "ekran-nije-miran" };
  if (trenutak.odUcitavanjaMs < MOTOR.NAJRANIJE_MS) return { pitanje: null, razlog: "prerano" };

  const uCooldownu = kasnije(stanje.cooldownUntil, sada);

  const moguca = kandidati
    .filter((p) => kandidatVazi(p, trenutak, sada))
    .filter((p) => !uCooldownu || p.sloj === "incident")
    .filter((p) => smeDaSePita(p, stanje, sada));

  if (moguca.length === 0) {
    return { pitanje: null, razlog: uCooldownu ? "cooldown" : "nema-kandidata" };
  }

  // Najveći prioritet pobeđuje; drugo ostaje kandidat za sledeći put, ne
  // prikazuje se (§9). Stabilno: kod izjednačenja pobeđuje redosled u katalogu.
  const najbolje = moguca.reduce((a, b) => (b.prioritet > a.prioritet ? b : a));
  return { pitanje: najbolje };
}

/** Isto, ali bez razloga — za mesta gde je zanimljiv samo ishod. */
export function sledecePitanje(
  stanje: MotorStanje,
  trenutak: MotorTrenutak,
  kandidati: readonly Pitanje[],
  sada: number = Date.now(),
): Pitanje | null {
  return odluci(stanje, trenutak, kandidati, sada).pitanje;
}

// ── posledice ────────────────────────────────────────────────
// Tri funkcije koje računaju NOVO stanje profila. Upis radi pozivalac; ovde nema
// baze, pa se ista pravila vide i u testu.

/**
 * Prikaz pali globalni cooldown od 72 h.
 *
 * Cooldown kreće od prikaza, ne od odgovora: pitanje koje je korisnik ignorisao
 * ga je jednako prekinulo kao i ono na koje je odgovorio.
 */
export function poslePrikaza(sada: number = Date.now()): { cooldownUntil: string } {
  return { cooldownUntil: new Date(sada + MOTOR.COOLDOWN_SATI * SAT_MS).toISOString() };
}

/** Ko odgovara, dobija mir: cooldown 7 dana i streak na nulu. */
export function posleOdgovora(sada: number = Date.now()): {
  cooldownUntil: string;
  dismissStreak: 0;
} {
  return {
    cooldownUntil: new Date(sada + MOTOR.COOLDOWN_POSLE_ODGOVORA_DANA * DAN_MS).toISOString(),
    dismissStreak: 0,
  };
}

/**
 * Odbacivanje: streak raste, pa na dva ćutanje 14 dana, na tri do kraja bete.
 *
 * Streak se NE nulira kad korisnik istog dana pošalje utisak dugmetom (§9) —
 * dugme nije odgovor na pitanje. Zato ovde nema ulaza osim streaka.
 */
export function posleOdbacivanja(
  dismissStreak: number,
  sada: number = Date.now(),
): { dismissStreak: number; mutedUntil: string | null } {
  const sledeci = Math.max(0, dismissStreak) + 1;

  if (sledeci >= MOTOR.ODBACIVANJA_DO_KRAJA) {
    return {
      dismissStreak: sledeci,
      mutedUntil: new Date(sada + MOTOR.CUTANJE_DO_KRAJA_DANA * DAN_MS).toISOString(),
    };
  }

  if (sledeci >= MOTOR.ODBACIVANJA_DO_CUTANJA) {
    return {
      dismissStreak: sledeci,
      mutedUntil: new Date(sada + MOTOR.CUTANJE_DANA * DAN_MS).toISOString(),
    };
  }

  return { dismissStreak: sledeci, mutedUntil: null };
}
