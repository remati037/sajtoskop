// apps/web/src/lib/traka-dopune.ts
// Traka „Nemaš plan" za nalog u stanju `dopuna` (tok-i-onboarding §1.12):
// koja grana i koliko kredita. Čista funkcija, bez baze — čitanje knjige je u
// `lib/onboarding.ts`, prikaz u `components/pristup-baner.tsx`.
//
// ── zašto tri grane ─────────────────────────────────────────
// Do lokalnog testa (docs/LOKALNA-BAZA.md §11.1) traka je izlazila samo bez
// kupljenog paketa i uvek govorila „Dobio si 2 kredita da probaš". Od 0035
// admin korekcije i nagrade za utiske idu u `credits_topup`, pa nalog bez plana
// može imati 7 kredita, a traka i dalje tvrdi 2. Tekst zato ide po izvoru:
//
//   onboarding — samo krediti dobrodošlice: postojeći tekst, „da probaš"
//   paket      — bar jedan kupljen paket: „Imaš N kredita iz paketa", bez
//                „probaj" — čovek je platio, nije na probi
//   poklon     — bez paketa, ali sa admin/feedback dodelom: „Nemaš plan.
//                Imaš N kredita."
//
// Paket ima prednost nad poklonom: ko je platio, to je prva stvar koju treba
// da vidi o svojim kreditima.

/** Razlozi iz `credit_ledger` koji menjaju granu. Ostali (onboarding…) ne. */
export const RAZLOZI_TRAKE_DOPUNE = ["credit_pack", "admin", "feedback"] as const;

export type GranaTrakeDopune = "onboarding" | "paket" | "poklon";

export type TrakaDopune = { grana: GranaTrakeDopune; krediti: number };

/**
 * Grana iz razloga POZITIVNIH redova knjige tog naloga (samo oni iz
 * `RAZLOZI_TRAKE_DOPUNE` su bitni; ostali se ignorišu).
 */
export function granaTrakeDopune(razlozi: readonly string[]): GranaTrakeDopune {
  if (razlozi.includes("credit_pack")) return "paket";
  if (razlozi.includes("admin") || razlozi.includes("feedback")) return "poklon";
  return "onboarding";
}

/**
 * N na traci: dopuna plus balans, ali negativan balans (povraćaj, pod −1000)
 * ne umanjuje ono što čovek može da potroši iz dopune na ekranu.
 */
export function kreditiTrakeDopune(profil: {
  credits_balance: number;
  credits_topup: number;
}): number {
  return profil.credits_topup + Math.max(profil.credits_balance, 0);
}

export function trakaDopune(
  razlozi: readonly string[],
  profil: { credits_balance: number; credits_topup: number },
): TrakaDopune {
  return { grana: granaTrakeDopune(razlozi), krediti: kreditiTrakeDopune(profil) };
}
