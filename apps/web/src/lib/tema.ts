// apps/web/src/lib/tema.ts
// Dve teme: „tamna" (podrazumevana) i „svetla".
//
// ── zašto nema „sistem" ──────────────────────────────────────
// Imao ga je do sada, kao treće stanje koje se razrešava kroz
// `prefers-color-scheme`. Izbačen je namerno: proizvod ima jedan izgled po kome
// se pamti, a to je tamni. Stanje „sistem" je značilo da isti korisnik na dva
// računara vidi dve različite aplikacije, i da polovina snimaka ekrana koje
// pošaljem ispadne u svetloj temi bez ijedne moje odluke.
//
// Svetla tema ostaje i dalje se testira — nije dekoracija nego izbor.
//
// ── zašto klasa `.dark`, a ne `prefers-color-scheme` ─────────
// Medija upit ne zna za izbor korisnika. Jedini izvor istine je klasa na <html>.
//
// ── zašto skripta u <head>-u ─────────────────────────────────
// React hidratacija stiže posle prvog farbanja. Bez ove skripte bi korisnik sa
// svetlom temom pri svakom osvežavanju dobio tamni blesak (i obrnuto) — to je
// jedna od retkih stvari koje aplikaciju odmah učine jeftinom.

export const TEME = ["tamna", "svetla"] as const;

export type Tema = (typeof TEME)[number];

/** Tamna je podrazumevana — i u skripti iz <head>-a i u provideru. */
export const PODRAZUMEVANA_TEMA: Tema = "tamna";

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
 *
 * Uslov je `izbor !== "svetla"`, a ne `izbor === "tamna"`, i to nosi posao:
 * korisnici kojima je u `localStorage`-u ostala stara vrednost „sistem" prelaze
 * na tamnu bez ijedne migracije.
 */
export const TEMA_SKRIPTA = `
(function () {
  try {
    var izbor = localStorage.getItem("${TEMA_KLJUC}");
    var tamna = izbor !== "svetla";
    var koren = document.documentElement;
    koren.classList.toggle("dark", tamna);
    koren.style.colorScheme = tamna ? "dark" : "light";
  } catch (e) {}
})();
`;
