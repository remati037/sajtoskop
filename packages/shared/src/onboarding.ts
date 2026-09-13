// packages/shared/src/onboarding.ts
// Četiri koraka prvog prolaza — jedan izvor za tri prikaza (O6, docs/tok-i-onboarding.md §4.5).
//
// Vođene tačke uz element, traka „Prvih pet minuta" u bočnoj traci i vodič na
// zahtev čitaju OVAJ spisak. Tri prikaza sa tri kopije istog teksta bi se
// razišla prvi put kad se jedna rečenica popravi.
//
// Isti ključevi koraka stoje i u SQL-u (`onboarding_mark_step`, migracija 0026).
// Test `packages/shared/test/onboarding.ts` čita migraciju i proverava da se
// spiskovi slažu — ključ koji postoji samo ovde je traka koja se nikad ne
// završi, a ključ koji postoji samo tamo je korak koji niko ne vidi.
//
// Ovde nema nijednog upita. Odluke su čiste funkcije, trenutak se ne čita iz
// sata — isti obrazac kao `pristup.ts` i `feedback-motor.ts`.

/** Ključ koraka u `profiles.onboarding_steps`. Tačno četiri, nikad više (§4.3). */
export type KorakKljuc = "pretraga" | "otkljucavanje" | "poruka" | "pipeline";

/** Ključ vođene tačke u `profiles.onboarding_hints_seen` (§4.3). */
export type HintKljuc = "nema-sajt" | "otkljucaj" | "poruka" | "pipeline";

export type Korak = {
  kljuc: KorakKljuc;
  /** Naslov u traci i u vodiču. */
  naslov: string;
  /** Tačka koja uz ovaj korak stoji na ekranu. */
  hint: HintKljuc;
};

/** §4.5, doslovno. Redosled je redosled rada i redosled u traci. */
export const KORACI = [
  { kljuc: "pretraga", naslov: "Prva lista", hint: "nema-sajt" },
  { kljuc: "otkljucavanje", naslov: "Prvi prospekt", hint: "otkljucaj" },
  { kljuc: "poruka", naslov: "Prva poruka", hint: "poruka" },
  { kljuc: "pipeline", naslov: "Prvi u pipeline-u", hint: "pipeline" },
] as const satisfies readonly Korak[];

export const KORAK_KLJUCEVI: readonly KorakKljuc[] = KORACI.map((k) => k.kljuc);
export const HINT_KLJUCEVI: readonly HintKljuc[] = KORACI.map((k) => k.hint);

/**
 * Tekst tačaka (§4.5, tabela). `naslov` je podebljan deo, `telo` ostatak.
 *
 * Vodič na zahtev (§4.8) koristi isti tekst, bez „Jasno".
 */
export const TACKE: Record<HintKljuc, { naslov: string; telo: string }> = {
  "nema-sajt": {
    naslov: "Ovo je najbolji prospekt.",
    telo: "Firma ima ocene na Googlu, a nema sajt — ne moraš da ubeđuješ da je sajt loš, samo da ga nema.",
  },
  otkljucaj: {
    naslov: "Otključavanje otvara telefon, mejl, snimke sajta i gotovu poruku.",
    telo: "Košta 1 kredit; prvi je besplatan. Isti prospekt se ne plaća dvaput.",
  },
  poruka: {
    naslov: "Poruka je napisana za kanal koji si izabrao.",
    telo: "Promeni tab za mejl ili Instagram; „Napiši drugačije“ pravi novu verziju bez kredita.",
  },
  pipeline: {
    naslov: "Označi kad pošalješ.",
    telo: "Pipeline pamti koga si kontaktirao, ko je odgovorio i ko je potpisao — i posle 30 dana znaš gde si stao.",
  },
};

/** Dugme koje zatvara tačku (§4.5). */
export const TACKA_JASNO = "Jasno";

/** Traka „Prvih pet minuta" (§4.6). */
export const TRAKA = {
  naslov: "Prvih pet minuta",
  sakrij: "Sakrij",
  gotovo: "Sva četiri. Sad znaš sve što treba.",
  /**
   * Rečenica ispod NEURAĐENOG koraka. §4.6 je daje samo za poslednja dva — prva
   * dva su u primeru već štiklirana, pa za njih tekst ne postoji i ne izmišlja se.
   */
  uputstvo: {
    pretraga: null,
    otkljucavanje: null,
    poruka: "Kopiraj poruku sa otključane kartice",
    pipeline: "Označi prospekt kao kontaktiran",
  } satisfies Record<KorakKljuc, string | null>,
} as const;

/** Vodič na zahtev (§4.8). */
export const VODIC = {
  naslov: "Vodič",
  pokaziMi: "Pokaži mi",
  ponovi: "Ponovi prve korake",
} as const;

/**
 * Oznaka u `onboarding_hints_seen` da je čovek traku sakrio („Sakrij", §4.6).
 *
 * ‼️ Nije peta tačka. §4.2 i §4.6 obe traže `onboarding_skipped_at = now()` — i
 *    „Preskoči" u čarobnjaku i „Sakrij" u traci — a §4.6 istovremeno kaže da
 *    traka OSTAJE za onoga ko je preskočio čarobnjak. Iz jedne kolone se ta dva
 *    ishoda ne mogu razlikovati, pa „Sakrij" uz datum upisuje i ovu oznaku.
 *    Nova kolona bi bila migracija zbog jednog booleana (v. SESIJE.md, S30).
 */
export const TRAKA_SKRIVENA = "traka";

/** Kanali sa ekrana 3 čarobnjaka — isti skup kao `profiles_onboarding_channel_valid` (0028). */
export const ONBOARDING_KANALI = ["viber", "mejl", "instagram"] as const;
export type OnboardingKanal = (typeof ONBOARDING_KANALI)[number];

export function jeKorakKljuc(v: unknown): v is KorakKljuc {
  return typeof v === "string" && (KORAK_KLJUCEVI as readonly string[]).includes(v);
}

export function jeHintKljuc(v: unknown): v is HintKljuc {
  return typeof v === "string" && (HINT_KLJUCEVI as readonly string[]).includes(v);
}

export function jeOnboardingKanal(v: unknown): v is OnboardingKanal {
  return typeof v === "string" && (ONBOARDING_KANALI as readonly string[]).includes(v);
}

/**
 * Urađeni koraci, redom iz `KORACI`. Nepoznat ključ iz baze se ignoriše — to je
 * podatak koji ovaj kod ne ume da prikaže, ne razlog da traka pukne.
 */
export function uradjeniKoraci(steps: Record<string, unknown> | null | undefined): KorakKljuc[] {
  if (!steps) return [];
  return KORAK_KLJUCEVI.filter((k) => steps[k] !== undefined && steps[k] !== null);
}

export function sviKoraciUradjeni(steps: Record<string, unknown> | null | undefined): boolean {
  return uradjeniKoraci(steps).length === KORAK_KLJUCEVI.length;
}

/**
 * Da li nalog ide u čarobnjak (§1.8, kapija).
 *
 * §1.8 kaže: `pun && done IS NULL && skipped IS NULL`. Uz to ide i
 * `!steps.pretraga`, i to nije ukras nego jedini izlaz iz petlje: ekran 4
 * čarobnjaka plaća prvu listu (to upisuje korak `pretraga`) i šalje na
 * `/pretraga` — a `onboarding_done_at` nastaje tek posle SVA ČETIRI koraka. Bez
 * ovog uslova bi kapija na `/pretraga` čoveka vratila na `/pocetak` sekund
 * pošto je platio listu.
 *
 * Nalog koji nije `pun` (grace) ne ide u čarobnjak: čarobnjak se završava
 * plaćanjem, a to mu kapija ionako ne bi dala.
 */
export function trebaCarobnjak(ulaz: {
  pun: boolean;
  doneAt: string | null;
  skippedAt: string | null;
  steps: Record<string, unknown> | null | undefined;
}): boolean {
  if (!ulaz.pun) return false;
  if (ulaz.doneAt !== null || ulaz.skippedAt !== null) return false;
  return !uradjeniKoraci(ulaz.steps).includes("pretraga");
}

/**
 * Da li traka „Prvih pet minuta" stoji u bočnoj traci (§4.6).
 *
 * Završen prolaz je nema. Sakrivena (`TRAKA_SKRIVENA`) je nema. Preskočen
 * čarobnjak je IMA — §4.2: „traka napretka i prazna stanja rade i za njega".
 */
export function trakaVidljiva(ulaz: {
  doneAt: string | null;
  hintsSeen: readonly string[] | null | undefined;
}): boolean {
  if (ulaz.doneAt !== null) return false;
  return !(ulaz.hintsSeen ?? []).includes(TRAKA_SKRIVENA);
}
