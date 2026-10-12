// apps/web/src/lib/analitika-zajednicko.ts
// Ono što klijentska i serverska polovina analitike dele: spisak događaja i
// čišćenje adresa. Bez `server-only` i bez ijednog uvoza — čita ga i pregledač.
//
// ── šta NIKAD ne ulazi u događaj ────────────────────────────
// Nijedan podatak o prospektu: ni naziv, ni telefon, ni mejl, ni sajt, ni
// `place_id`. Pravilo 9 kaže da zaključana polja ne postoje u API odgovoru;
// otključana polja su korisnikov plaćen podatak i nemaju šta da traže kod
// trećeg obrađivača. Grad i niša su slugovi iz taksonomije i jedino što opisuje
// pretragu. O korisniku ide Clerk ID, plan i stanje pristupa — bez mejla i imena.
//
// Tip `Svojstva` je brana: događaj koji nije ovde ne može da se pošalje, a
// svojstvo koje nije nabrojano ne prolazi `tsc`.

export type Svojstva = {
  /** Clerk `user.created` je napravio profil. */
  signup_completed: Record<string, never>;
  /** Sva četiri koraka trake su prvi put upisana. */
  onboarding_completed: Record<string, never>;
  /** Plaćena pretraga: pristup gotovoj listi ili novo skeniranje. */
  search_started: {
    city: string;
    niche: string;
    /** 20 / 40 / 60 firmi. */
    list_size: number;
    source: "ready_list" | "scan";
    credits: number;
  };
  prospect_unlocked: Record<string, never>;
  csv_exported: { rows: number; truncated: boolean };
  pipeline_status_changed: { status: string };
  checkout_started:
    | { kind: "plan"; plan: string; cycle: string }
    | { kind: "pack"; pack: string };
  trial_started: { plan: string | null };
  subscription_paid: { plan: string; billing_reason: string };
  credit_pack_purchased: { pack: string; credits: number };
  feedback_submitted: { source: string; kind: string | null };
};

export type Dogadjaj = keyof Svojstva;

/** Segmenti putanje koji nose tajnu ili tuđ identifikator. */
const MASKE: readonly [RegExp, string][] = [
  // Kod pozivnice je ključ za besplatan pristup.
  [/^\/pozivnica\/[^/]+/, "/pozivnica/[kod]"],
];

/**
 * Adresa bez query stringa, bez hash-a i bez tajnih segmenata.
 *
 * Query se odseca CEO, ne po spisku: `/welcome?sesija=cs_…` nosi ID Stripe
 * sesije, Clerk dopisuje `__clerk_ticket` i `__clerk_db_jwt`, a spisak
 * „opasnih" parametara je spisak koji zastari prvim novim redirektom. UTM
 * oznake se time ne gube — PostHog ih izdvaja u svoja svojstva pre ovog koraka.
 *
 * Vrednost koja nije adresa vraća se netaknuta.
 */
export function ocistiAdresu(vrednost: string): string {
  const apsolutna = /^https?:\/\//i.test(vrednost);
  if (!apsolutna && !vrednost.startsWith("/")) return vrednost;

  let url: URL;
  try {
    url = new URL(vrednost, "http://x");
  } catch {
    return vrednost;
  }

  let putanja = url.pathname;
  for (const [obrazac, zamena] of MASKE) putanja = putanja.replace(obrazac, zamena);

  return apsolutna ? `${url.origin}${putanja}` : putanja;
}

/** Isto, nad svim tekstualnim svojstvima događaja. Menja objekat u mestu. */
export function ocistiSvojstva(svojstva: Record<string, unknown> | undefined): void {
  if (!svojstva) return;
  for (const [kljuc, vrednost] of Object.entries(svojstva)) {
    if (typeof vrednost === "string") svojstva[kljuc] = ocistiAdresu(vrednost);
  }
}
