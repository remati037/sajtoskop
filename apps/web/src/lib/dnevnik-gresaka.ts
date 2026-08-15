// apps/web/src/lib/dnevnik-gresaka.ts
// Dnevnik klijentskih grešaka (F11 odluka 10).
//
// Poslednjih pet grešaka iz pregledača, u memoriji ovog taba. Šalje se ISKLJUČIVO
// uz `kind = 'bug'` i uz incident — server to i proverava, pa ni ručno sastavljen
// zahtev ne može da zakači dnevnik uz pohvalu.
//
// Šta se NIKAD ne skuplja (F11 §8): telo zahteva, sadržaj polja, `localStorage`,
// stek i query string. Ruta je gola putanja: `/lista?grad=sabac` ulazi kao
// `/lista`, jer se u query stringu ove aplikacije nalaze i grad i niša koje je
// korisnik tražio, a to je njegov posao a ne moj.
//
// Zašto ne Sentry: ~40 linija naspram 30 kB u bundle-u i još jednog naloga koji
// vidi ekrane sa tuđim kontakt podacima (F11 §13).

import type { KlijentskaGreska } from "@sajtoskop/shared";

const MAX_REDOVA = 5;
const MAX_PORUKA = 200;

const dnevnik: KlijentskaGreska[] = [];
let postavljeno = false;

/** Putanja bez query stringa i bez hash-a. Sve ostalo je korisnikov podatak. */
function golaRuta(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname;
}

export function zabeleziGresku(poruka: string, tip: string): void {
  const cist = poruka.trim().slice(0, MAX_PORUKA);
  if (!cist) return;

  dnevnik.push({
    poruka: cist,
    tip: tip.slice(0, 60) || "Error",
    ruta: golaRuta(),
    vreme: new Date().toISOString(),
  });

  // Prstenasti bafer: pamti se poslednjih pet, jer prijava kvara govori o onome
  // što se upravo desilo, a ne o sesiji od pre sat vremena.
  if (dnevnik.length > MAX_REDOVA) dnevnik.splice(0, dnevnik.length - MAX_REDOVA);
}

/** Kopija, ne referenca — pozivalac ovo serijalizuje u telo zahteva. */
export function procitajDnevnik(): KlijentskaGreska[] {
  return [...dnevnik];
}

/** Jednom po tabu. Zove se iz `UtisciProvider`-a, koji stoji iznad svega. */
export function pratiGreske(): void {
  if (postavljeno || typeof window === "undefined") return;
  postavljeno = true;

  window.addEventListener("error", (e) => {
    zabeleziGresku(e.message, e.error instanceof Error ? e.error.name : "Error");
  });

  window.addEventListener("unhandledrejection", (e) => {
    const razlog: unknown = e.reason;
    zabeleziGresku(
      razlog instanceof Error ? razlog.message : String(razlog),
      "unhandledrejection",
    );
  });
}
