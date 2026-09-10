// apps/web/src/lib/veze.ts
// Veze ka landingu. Jedini fajl u aplikaciji koji sme da zna domen prodajne
// strane (`docs/LANSIRANJE.md` §1.7).
//
// ── zašto uopšte postoji ───────────────────────────────────
// Do S24 je aplikacija mislila da je sama na domenu: logo je svuda vodio na
// `/`, a `/` je ekran za prijavu. Od preokreta na poddomen (`app.sajtoskop.com`)
// logo mora da vodi na prodajnu stranu, koja je DRUGI ORIGIN i živi van ovog
// repozitorijuma.
//
// ── zašto env, a ne konstanta ──────────────────────────────
// Sredina se menja, domen ne treba da se menja u JSX-u. `NEXT_PUBLIC_` prefiks
// je obavezan: ove linkove renderuju i klijentske komponente (futer stoji na
// `/`, `/cenovnik`, pravnim stranama), pa vrednost mora da uđe u bundle.
// Next je ubacuje u trenutku build-a i SAMO kad je napisana kao doslovan
// `process.env.NEXT_PUBLIC_LANDING_URL` — dinamičan pristup (`process.env[ime]`)
// u pregledaču daje `undefined`. Zato je ovde ispisana jednom, doslovno.
//
// ‼️ NEMA `server-only`. Namerno: `lib/env.ts` ga ima i zato se ne može uvoziti
//    odavde. Ovde nema nijedne tajne — landing URL je javan po definiciji.
//
// ── zašto `www`, a ne goli domen ───────────────────────────
// Provereno 27.8. i ponovo pri isporuci S24: `https://sajtoskop.com` odgovara
// `308` i preusmerava na `https://www.sajtoskop.com`. Goli oblik bi značio da
// svaki klik iz aplikacije plaća suvišan skok, pa je kanonski oblik `www`
// (`docs/LANSIRANJE.md` §1.7). Env promenljiva na Vercelu nosi isti oblik.

/** Kad `NEXT_PUBLIC_LANDING_URL` nije postavljen — v. komentar iznad. */
const PODRAZUMEVANI_LANDING = "https://www.sajtoskop.com";

/**
 * `"https://www.sajtoskop.com/"` → `"https://www.sajtoskop.com"`.
 *
 * Kosa crta na kraju nije greška u env-u, ali bi je `landing("/cenovnik")`
 * udvostručio u `//cenovnik` — a to je putanja koju pregledač čita kao drugi
 * host. Jeftinije je normalizovati jednom nego se nadati da je niko neće
 * nalepiti.
 */
function bezKoseNaKraju(vrednost: string): string {
  return vrednost.replace(/\/+$/, "");
}

/**
 * Koren prodajne strane, bez kose crte na kraju.
 *
 * Prazna vrednost pada na podrazumevani domen: aplikacija bez ovog podešavanja
 * i dalje mora da radi, a logo koji ne vodi nikuda je gori od loga koji vodi na
 * pravi sajt.
 */
export const LANDING_URL: string = bezKoseNaKraju(
  process.env.NEXT_PUBLIC_LANDING_URL?.trim() || PODRAZUMEVANI_LANDING,
);

/**
 * Apsolutna adresa na landingu.
 *
 * `landing()` → koren; `landing("/cenovnik")` → strana na landingu. Putanja
 * MORA da počne kosom crtom — bez nje bi `landing("cenovnik")` dao
 * `https://www.sajtoskop.comcenovnik`, što je greška koju `tsc` ne vidi.
 */
export function landing(putanja = ""): string {
  if (!putanja) return LANDING_URL;
  return `${LANDING_URL}${putanja.startsWith("/") ? "" : "/"}${putanja}`;
}

// ── aplikacija sama: `NEXT_PUBLIC_APP_URL` (S25) ───────────
// Stripe Checkout traži APSOLUTNE `success_url` i `cancel_url`, a ruta koja ih
// sklapa je serverska i ne vidi `window.location`. Zato drugi koren, za
// sopstveni domen: `http://localhost:3000` lokalno, `https://app.sajtoskop.com`
// na produkciji. Prazno pada na localhost, jer je to jedino mesto gde sme da
// bude prazno — na Vercelu ga `stripeServerEnv()` (lib/env.ts) traži i baca.

const PODRAZUMEVANI_APP = "http://localhost:3000";

/** Koren aplikacije, bez kose crte na kraju. */
export const APP_URL: string = bezKoseNaKraju(
  process.env.NEXT_PUBLIC_APP_URL?.trim() || PODRAZUMEVANI_APP,
);

/** Apsolutna adresa u aplikaciji: `appUrl("/welcome")`. Nikad `window.location.origin`. */
export function appUrl(putanja = ""): string {
  if (!putanja) return APP_URL;
  return `${APP_URL}${putanja.startsWith("/") ? "" : "/"}${putanja}`;
}
