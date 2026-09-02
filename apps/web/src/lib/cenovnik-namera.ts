// apps/web/src/lib/cenovnik-namera.ts
// OBLIK namere sa landinga: `/cenovnik?plan=pro&ciklus=godisnje`, `/cenovnik?paket=150`.
//
// Ovde su tipovi i preslikavanja slug ↔ interni id. ČITANJE query-ja je u
// `lib/cenovnik-namera-schema.ts` — razdvojeno namerno: šema uvozi Zod, a ovaj
// fajl uvozi i klijentska komponenta `components/cenovnik-ekran.tsx`. Da su u
// istom modulu, ceo Zod bi ušao u bundle javne strane cena, koju otvara svako
// ko klikne dugme na landingu.
//
// ── zašto slug, a ne `pri_` ID ─────────────────────────────
// `docs/LANSIRANJE.md` §1.7: landing NIKAD ne zna Paddle price ID. Da ga zna,
// prelazak sandbox → produkcija tražio bi izmenu i na landingu — na mestu gde
// se greška ne vidi dok neko ne plati. Preslikavanje slug → `pri_` ostaje u
// aplikaciji, gde već postoji (`lib/cenovnik.ts` → `PLAN_PRICE_IDS`).

import type { Ciklus, PaidPlanId, PaketId } from "@sajtoskop/shared";

/** Kako se plan piše u linku. Isti slugovi stoje na dugmadima landinga. */
export const PLANOVI_U_LINKU = ["starter", "pro", "advanced"] as const;

/**
 * Ciklus u linku je na srpskom, u kodu je Paddle-ov `month` / `year`.
 *
 * Landing piše ono što piše i na dugmetu („godišnje"), ne Paddle-ov rečnik.
 * Preslikavanje je ovde, na granici, i nigde više.
 */
export const CIKLUS_IZ_LINKA = {
  mesecno: "month",
  godisnje: "year",
} as const satisfies Record<string, Ciklus>;

/**
 * Paket se u linku prepoznaje po BROJU KREDITA, ne po internom id-ju.
 *
 * Na landingu piše „Dopuna 150", pa je `?paket=150` jedini oblik koji čovek
 * može da pročita iz adresne trake i proveri. Interni `dopuna-150` je naše ime
 * i nema razloga da izlazi iz aplikacije.
 */
export const PAKET_IZ_LINKA = {
  "50": "dopuna-50",
  "150": "dopuna-150",
} as const satisfies Record<string, PaketId>;

/** Šta je posetilac izabrao na landingu. `null` znači „nije rekao". */
export interface Namera {
  plan: PaidPlanId | null;
  ciklus: Ciklus | null;
  paket: PaketId | null;
}

/** Prazna namera — posetilac je došao pravo na `/cenovnik`. */
export const BEZ_NAMERE: Namera = { plan: null, ciklus: null, paket: null };

/**
 * Obrnut smer: plan + ciklus → putanja `/cenovnik?…`.
 *
 * Postoji zbog GOSTA. Gost nema `user_id`, pa ne može u checkout — ide na
 * registraciju sa `?nazad=`, i ta putanja mora da nosi NJEGOV izbor, ne goli
 * `/cenovnik`. Bez ovoga se čovek posle registracije vrati na spisak od tri
 * plana i bira ponovo, što je tačno ono što S24 uklanja.
 */
export function putanjaZaPlan(plan: PaidPlanId, ciklus: Ciklus): string {
  const uLinku = ciklus === "year" ? "godisnje" : "mesecno";
  return `/cenovnik?plan=${plan}&ciklus=${uLinku}`;
}

/** Isto, za paket. Sidro `#paketi` vraća čoveka tačno na sekciju. */
export function putanjaZaPaket(paket: PaketId): string {
  const uLinku = paket === "dopuna-150" ? "150" : "50";
  return `/cenovnik?paket=${uLinku}#paketi`;
}

/**
 * `/?nalog=nov&nazad=…` — gde gost ide sa dugmeta „Uzmi plan".
 *
 * `/registracija` je redirekcija na `/?nalog=nov`, pa se ide pravo na cilj.
 * `nazad` se kodira jer nosi `?` i `&`; na serveru se i dalje proverava da je
 * INTERNA putanja (`internaPutanja()` u `app/page.tsx`) — ta provera je jedina
 * brana ispred otvorene redirekcije i S24 je ne dira.
 */
export function naRegistraciju(nazad: string): string {
  return `/?nalog=nov&nazad=${encodeURIComponent(nazad)}`;
}
