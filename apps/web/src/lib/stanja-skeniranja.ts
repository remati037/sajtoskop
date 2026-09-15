// apps/web/src/lib/stanja-skeniranja.ts
// Tekstovi stanja skeniranja (A–F) na jednom mestu — `docs/11-tekstovi-stanja-skeniranja.md`.
//
// ── zašto modul, a ne stringovi u komponentama ──────────────
// Do sada su isti tekstovi živeli na četiri mesta: `pretraga-ekran.tsx`
// (`setGreska`, prazna stanja, traka posla), ruta `/api/search`, ruta
// `/api/job/:id` i modal. Menjanje jedne rečenice je značilo tražiti je po
// JSX-u, pa se poruka koja traži previše od korisnika zadržala mesecima.
//
// ── pravila iz dokumenta, sprovedena ovde ───────────────────
// 1. Prvo šta je korisnik dobio, pa novac.
// 2. Nula internih pojmova: „keš", „broj posla", „kombinacija" ne izlaze odavde.
// 3. ‼️ `job_id` NIKAD ne ulazi u tekst. Ide u log, `admin_audit` i
//    `credit_ledger.details` (migracija 0034). Zato ga nijedna funkcija ispod
//    ne prima — ne može da procuri ni greškom.
// 4. Nikad upozorenje na sopstveni bug: kredit se vrati automatski, pa se
//    ponavljanje dozvoli. Nema teksta koji ga zabranjuje.
// 5. Krediti su brojevi, ne „deo kredita".
//
// Brojevi i imena ulaze kao PARAMETRI. Komponente ne sklapaju rečenice.

import { plural } from "./ui-tekst";

/** Adresa podrške — u tekstu stoji samo ovde (stanje E). */
export const PODRSKA_MEJL = "podrska@sajtoskop.com";

/**
 * Jedno stanje ekrana: naslov, telo i natpis radnje.
 *
 * `akcija` je samo NATPIS — šta dugme radi odlučuje komponenta. `telo` ume da
 * bude `null` (stanje A bez povraćaja), i tada se drugi red ne prikazuje
 * uopšte; „nije bilo povraćaja" se ne piše.
 */
export type StanjeSkeniranja = {
  naslov: string;
  telo: string | null;
  akcija: string | null;
};

/** „1 kredit", „2 kredita" — nikad „2 kredit". */
function kredita(n: number): string {
  return `${n} ${plural(n, "kredit", "kredita", "kredita")}`;
}

/** „naplaćen je 1 kredit" / „naplaćena su 2 kredita" — slaganje uz broj. */
function naplaceno(n: number): string {
  return n === 1 ? `naplaćen je ${kredita(n)}` : `naplaćena su ${kredita(n)}`;
}

/**
 * A · Manje firmi nego što je naplaćeno (scenario 14).
 *
 * `vraceno === 0` → drugi red izostaje. Brojevi su iz knjige (`scan` i
 * `scan_refund`), ne iz procene na ekranu: ako se razlikuju, ekran računa iz
 * nečeg drugog i to je bug, ne kozmetika.
 */
export function stanjeA(a: {
  nadjeno: number;
  grad: string;
  placeno: number;
  vraceno: number;
}): StanjeSkeniranja {
  return {
    naslov: `Pronađeno ${a.nadjeno} ${plural(a.nadjeno, "firma", "firme", "firmi")} u ${a.grad}`,
    telo:
      a.vraceno > 0
        ? `Manji grad od očekivanog — ${naplaceno(a.placeno)}, a ${a.vraceno} smo ti vratila.`
        : null,
    akcija: "Vidi listu",
  };
}

/** B · Skeniranje prošlo, rezultati se nisu sačuvali. Kredit je već vraćen. */
export function stanjeB(a: { vraceno: number }): StanjeSkeniranja {
  return {
    naslov: "Nešto je zastalo kod nas",
    telo: `Skeniranje je završeno, ali lista nije stigla do tebe. Vratili smo ti ${kredita(a.vraceno)}.`,
    akcija: "Pokušaj ponovo",
  };
}

/** C · Nijedna firma ne odgovara kriterijumima. Naplate nije ni bilo. */
export function stanjeC(a: { nisa: string; grad: string }): StanjeSkeniranja {
  return {
    naslov: `Nema rezultata za ${a.nisa} u ${a.grad}`,
    telo: "Nismo našli ni jednu firmu koja odgovara. Nije naplaćeno.",
    akcija: "Promeni pretragu",
  };
}

/**
 * D · Skeniranje u toku.
 *
 * Dokument je ovde pisao „Moje pretrage" — ekran koji ne postoji. To je blok
 * `Tvoji pristupi` na dnu `/pretraga` (`kes-lista.tsx`): plaćene kombinacije
 * koje se otvaraju bez novih kredita. Rečenica zato upućuje na njega, i to
 * njegovim imenom iz UI-ja — „keš" je interni pojam (pravilo 2) i ne izlazi.
 */
export function stanjeD(a: { nisa: string; grad: string }): StanjeSkeniranja {
  return {
    naslov: `Skeniram ${a.nisa} u ${a.grad}`,
    telo:
      "Obično traje 20\u201340 sekundi. Možeš da zatvoriš stranicu — " +
      "listu ćeš naći u \u201ETvoji pristupi\u201C, na dnu ove strane.",
    akcija: null,
  };
}

/** E · Skeniranje palo (Places, timeout, bilo šta). Kredit je već vraćen. */
export function stanjeE(a: { vraceno: number }): StanjeSkeniranja {
  return {
    naslov: "Skeniranje nije uspelo",
    telo: `Vratili smo ti ${kredita(a.vraceno)}. Ako se ponovi, piši nam na ${PODRSKA_MEJL}.`,
    akcija: "Pokušaj ponovo",
  };
}

/** F · Pristup pretrazi koju korisnik već ima. */
export function stanjeF(): StanjeSkeniranja {
  return {
    naslov: "Ovu listu već imaš",
    telo: "Otvaranje ne troši kredite.",
    akcija: "Vidi listu",
  };
}
