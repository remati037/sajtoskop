// apps/web/src/lib/tema.ts
// Tri stanja teme: „sistem", „svetla", „tamna".
//
// ── zašto klasa `.dark`, a ne `prefers-color-scheme` ──────────
// Medija upit ne zna za izbor korisnika. Čim postoji prekidač sa tri stanja,
// jedini izvor istine je klasa na <html>, a medija upit služi samo da razreši
// stanje „sistem".
//
// ── zašto skripta u <head>-u ─────────────────────────────────
// React hidratacija stiže posle prvog farbanja. Bez ove skripte korisnik sa
// tamnom temom svaki put dobije beo blesak preko celog ekrana — to je jedna od
// retkih stvari koje aplikaciju odmah učine jeftinom.

export const TEME = ["sistem", "svetla", "tamna"] as const;

export type Tema = (typeof TEME)[number];

/** Šta je stvarno na ekranu pošto se „sistem" razreši. */
export type StvarnaTema = "svetla" | "tamna";

export const TEMA_KLJUC = "sajtoskop-tema";

export function jeTema(v: unknown): v is Tema {
  return typeof v === "string" && (TEME as readonly string[]).includes(v);
}

/**
 * Skripta koja se ubacuje u <head> pre bilo kakvog renderovanja.
 *
 * Namerno je bez ijedne zavisnosti i u jednom `try` bloku: `localStorage` puca
 * u privatnom režimu nekih pregledača, a tema koja obori celu stranicu je gora
 * od pogrešne teme.
 */
export const TEMA_SKRIPTA = `
(function () {
  try {
    var izbor = localStorage.getItem("${TEMA_KLJUC}");
    var sistem = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var tamna = izbor === "tamna" || ((!izbor || izbor === "sistem") && sistem);
    var koren = document.documentElement;
    koren.classList.toggle("dark", tamna);
    koren.style.colorScheme = tamna ? "dark" : "light";
  } catch (e) {}
})();
`;
