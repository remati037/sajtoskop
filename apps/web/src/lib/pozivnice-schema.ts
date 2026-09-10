// apps/web/src/lib/pozivnice-schema.ts
// Pristupne pozivnice (S27, naplata-stripe.md §9): ugovor tela, oblik koda i
// rečenice za ishode `redeem_invite`.
//
// Odvojeno od `pozivnice-pristup.ts` iz istog razloga kao `admin-radnje-schema.ts`:
// šema i prevod ishoda se proveravaju bez baze i bez Next-a, a obrazac u
// konzoli i javna strana `/pozivnica/[code]` uvoze iste granice i iste
// rečenice. Zato ovde NEMA `server-only` — i zato ovde nema ničega što čita
// bazu ili pravi kod (generator je u `pozivnice-pristup.ts`, uz `node:crypto`).
//
// ── čega ovde nema i ne sme da bude ──────────────────────────
// `created_by`, `used_count`, `revoked_at`. Autor je uvek `requireAdminRoute()`,
// a brojač i opoziv menjaju `redeem_invite` i ruta za opoziv — nikad telo.

import { z } from "zod";
import type { AccessInviteKind, RedeemInviteResult } from "@sajtoskop/shared";
import { formatDatum, plural } from "./ui-tekst";
import { appUrl } from "./veze";

// ═══════════════════════════════════════════════════════════
// KOD
// ═══════════════════════════════════════════════════════════

/**
 * Azbuka generisanog koda: bez `0`/`O` i `1`/`I` (§9.3), jer se kod ponekad
 * prekucava sa telefona ili čita naglas. 24 slova + 8 cifara = 32 znaka, pa
 * osam znakova nosi 40 bita — pogađanje je van domašaja i bez limita, a sa
 * 5 pokušaja u minuti po adresi (§9.4) ne vredi ni pokušavati.
 */
export const AZBUKA_KODA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** `SAJT-XXXX-XXXX`, samo iz `AZBUKA_KODA`. */
export const OBLIK_GENERISANOG = /^SAJT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/**
 * Svaki kod koji baza sme da primi, i generisan i ručno otkucan: 6–32 znaka,
 * velika slova, cifre i crtica, bez crtice na krajevima.
 *
 * Ručni kod sme da sadrži i `0`/`O`/`1`/`I` — admin ga bira svesno („VLADA2026").
 * Uži oblik važi samo za generator.
 */
export const OBLIK_KODA = /^[A-Z0-9][A-Z0-9-]{4,30}[A-Z0-9]$/;

/**
 * Isto poređenje kao `upper(trim(p_code))` u `redeem_invite` (0025 §5). Kod se
 * i upisuje u ovom obliku, pa „ sajt-abcd-efgh " i „SAJT-ABCD-EFGH" nađu isti red.
 */
export function normalizujKod(v: string): string {
  return v.trim().toUpperCase();
}

export const kodSchema = z
  .string({ error: "Kod nedostaje." })
  .max(64, { error: "Kod je predugačak." })
  .transform(normalizujKod)
  .pipe(z.string().regex(OBLIK_KODA, { error: "Kod nije ispravnog oblika." }));

/** Link koji admin kopira i šalje ručno (§9.3). Mejl sa pozivnicom je K6. */
export function linkPozivnice(code: string): string {
  return appUrl(`/pozivnica/${encodeURIComponent(code)}`);
}

// ═══════════════════════════════════════════════════════════
// TELO: POST /api/admin/pozivnice/pristup
// ═══════════════════════════════════════════════════════════

/** Prazno polje obrasca je „nije uneto", ne prazan string u bazi. */
const prazno = (v: unknown) => (typeof v === "string" ? v.trim() || undefined : v);

const zajednicko = {
  /** Prazno = generisan `SAJT-XXXX-XXXX`. */
  code: z.preprocess(prazno, kodSchema.optional()),
  /**
   * Pozivnica vezana za mejl: `redeem_invite` je pušta samo nalogu sa tom
   * adresom u `profiles.email`. Jedina odbrana ručnog koda koji se da pogoditi.
   */
  email: z.preprocess(
    prazno,
    z
      .email({ error: "Mejl adresa nije ispravnog oblika." })
      .max(254, { error: "Mejl adresa je predugačka." })
      .transform((v) => v.toLowerCase())
      .optional(),
  ),
  max_uses: z
    .number({ error: "Broj upotreba mora da bude broj." })
    .int({ error: "Broj upotreba mora da bude ceo broj." })
    .min(1, { error: "Pozivnica mora da važi bar jednom." })
    .max(100, { error: "Najviše 100 upotreba po pozivnici." }),
  note: z.preprocess(
    prazno,
    z.string().max(200, { error: "Napomena je duža od 200 karaktera." }).optional(),
  ),
};

/**
 * Dva tipa (§9.1), dve šeme. `discriminatedUnion`, a ne jedan objekat sa
 * opcionim poljima kompa: `prvi_mesec` sa `komp_days` bi bio obrazac koji
 * tvrdi nešto što baza ignoriše, a strictObject ga ovako odbija naglas.
 *
 * ‼️ `komp_days: null` je NEOGRANIČEN komp i šalje se kao vrednost. Izostavljeno
 *    polje NIJE isto što i `null` (isti razlog kao `kompRok` u
 *    `admin-radnje-schema.ts`): tišina ne sme da postane doživotan pristup.
 *
 * Granica 2000 za kredite je ista kao u `admin_open_komp` (0025), kroz koji
 * `redeem_invite` dodeljuje komp — viša vrednost bi pukla tek pri prihvatanju,
 * u ruci korisnika.
 */
export const pozivnicaPristupBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("komp"),
    ...zajednicko,
    komp_days: z
      .number({ error: "Rok je broj dana, ili `null` za neograničeno." })
      .int({ error: "Rok mora da bude ceo broj dana." })
      .min(1, { error: "Rok je najmanje 1 dan." })
      .max(365, { error: "Rok je najviše 365 dana — duže je „bez roka“, svesno." })
      .nullable(),
    komp_credits: z
      .number({ error: "Broj kredita mora da bude broj." })
      .int({ error: "Broj kredita mora da bude ceo broj." })
      .min(0, { error: "Broj kredita ne može da bude negativan." })
      .max(2000, { error: "Najviše 2000 kredita po pozivnici." }),
  }),
  z.strictObject({
    kind: z.literal("prvi_mesec"),
    ...zajednicko,
  }),
]);

export type PozivnicaPristupBody = z.infer<typeof pozivnicaPristupBodySchema>;

// ═══════════════════════════════════════════════════════════
// TELO: POST /api/pozivnice/prihvati
// ═══════════════════════════════════════════════════════════

/**
 * Samo kod. strictObject namerno: `userId` u telu je propust (pravilo 8), pa
 * ga ruta odbija sa 400 umesto da ga tiho preskoči.
 */
export const prihvatiBodySchema = z.strictObject({ code: kodSchema });

// ═══════════════════════════════════════════════════════════
// ISHODI
// ═══════════════════════════════════════════════════════════

export type RazlogPozivnice = RedeemInviteResult["reason"];

/**
 * Rečenice iz §9.4, jedan izvor za rutu i test.
 *
 * `already_redeemed` je preformulisan iz „Već si iskoristio pozivnicu": nalog je
 * taj koji ima pravo na jednu pozivnicu, a rečenica tako ne pretpostavlja rod.
 */
export const ISHOD_POZIVNICE: Record<
  Exclude<RazlogPozivnice, "redeemed">,
  { status: number; poruka: string }
> = {
  not_found: { status: 404, poruka: "Kod ne postoji." },
  revoked: { status: 410, poruka: "Ova pozivnica je opozvana." },
  expired: { status: 410, poruka: "Pozivnica je istekla." },
  used_up: { status: 409, poruka: "Kod je već iskorišćen." },
  wrong_email: {
    status: 403,
    poruka: "Pozivnica je za drugu adresu. Prijavi se nalogom sa adresom na koju je poslata.",
  },
  already_redeemed: { status: 409, poruka: "Ovaj nalog je već iskoristio jednu pozivnicu." },
  has_subscription: {
    status: 409,
    poruka: "Već imaš plan. Pozivnica važi samo za nalog bez pretplate.",
  },
  // Profil nastaje u ruti (`ensureProfile`) pre poziva, pa ovo znači kvar, ne korisnika.
  no_user: { status: 503, poruka: "Nalog još nije spreman. Osveži stranu za koji trenutak." },
};

/**
 * Kuda posle prihvatanja (§9.4). `prvi_mesec` vodi na cene sa oznakom — kupon
 * ubacuje checkout sam, iz `profiles.invite_id`, pa oznaka nije kapija.
 */
export const POSLE_POZIVNICE: Record<AccessInviteKind, string> = {
  komp: "/dashboard?pozivnica=komp",
  prvi_mesec: "/cenovnik?pozivnica=1",
};

/**
 * „Komp pristup do 11. oktobra 2026, 300 kredita." (§9.4)
 *
 * Isti tekst na dva mesta — u odgovoru rute i na kontrolnoj tabli posle
 * redirekcije — pa jedna funkcija. Krediti su ZBIR obe kase, jer to je ono
 * što korisnik vidi na kontrolnoj tabli.
 */
export function porukaKompa(kompDo: string | null, krediti: number): string {
  const rok = kompDo ? `do ${formatDatum(kompDo)}` : "bez roka";
  return `Komp pristup ${rok}, ${krediti} ${plural(krediti, "kredit", "kredita", "kredita")}.`;
}

export const PORUKA_PRVOG_MESECA =
  "Prvi mesec gratis je tvoj. Izaberi plan — popust se primenjuje sam, pri plaćanju.";

export type IshodPrihvatanja =
  | { ok: true; kind: AccessInviteKind; poruka: string; dalje: string }
  | { ok: false; status: number; poruka: string; reason: RazlogPozivnice };

/**
 * Red iz `redeem_invite` u odgovor rute. Čista funkcija, zbog testa.
 *
 * `komp` je ono što je profil posle prihvatanja: rok i ukupni krediti. `null`
 * znači da se profil nije pročitao — komp je svejedno otvoren, pa ide poruka
 * bez brojeva umesto greške.
 */
export function ishodPrihvatanja(
  red: RedeemInviteResult,
  komp: { kompDo: string | null; krediti: number } | null,
): IshodPrihvatanja {
  if (!red.ok || red.reason !== "redeemed") {
    const razlog: Exclude<RazlogPozivnice, "redeemed"> =
      red.reason === "redeemed" ? "no_user" : red.reason;
    const { status, poruka } = ISHOD_POZIVNICE[razlog] ?? {
      status: 500,
      poruka: "Pozivnica nije prihvaćena.",
    };
    return { ok: false, status, poruka, reason: razlog };
  }

  if (red.kind === "prvi_mesec") {
    return {
      ok: true,
      kind: "prvi_mesec",
      poruka: PORUKA_PRVOG_MESECA,
      dalje: POSLE_POZIVNICE.prvi_mesec,
    };
  }

  return {
    ok: true,
    kind: "komp",
    poruka: komp ? porukaKompa(komp.kompDo, komp.krediti) : "Komp pristup je otvoren.",
    dalje: POSLE_POZIVNICE.komp,
  };
}

/** Odgovor `POST /api/pozivnice/prihvati` kad je prošao. */
export type PrihvatiOdgovor = { ok: true; kind: AccessInviteKind; poruka: string; dalje: string };

// ═══════════════════════════════════════════════════════════
// PRIKAZ
// ═══════════════════════════════════════════════════════════

/**
 * „pun pristup 30 dana i 300 kredita" / „prvi mesec gratis" — naslov kartice
 * na `/pozivnica/[code]` i kolona u konzoli.
 */
export function opisPozivnice(
  kind: AccessInviteKind,
  kompDays: number | null,
  kompCredits: number | null,
): string {
  if (kind === "prvi_mesec") return "prvi mesec gratis";
  const rok = kompDays
    ? `${kompDays} ${plural(kompDays, "dan", "dana", "dana")}`
    : "bez roka";
  const krediti = kompCredits ?? 0;
  return krediti > 0
    ? `pun pristup ${rok} i ${krediti} ${plural(krediti, "kredit", "kredita", "kredita")}`
    : `pun pristup ${rok}`;
}

export type StanjePozivnice = "aktivna" | "iskoriscena" | "istekla" | "opozvana";

/** Isti redosled provera kao u `redeem_invite`: opoziv, istek, pa brojač. */
export function stanjePozivnice(
  p: { revokedAt: string | null; expiresAt: string | null; usedCount: number; maxUses: number },
  sada = Date.now(),
): StanjePozivnice {
  if (p.revokedAt) return "opozvana";
  if (p.expiresAt && Date.parse(p.expiresAt) < sada) return "istekla";
  if (p.usedCount >= p.maxUses) return "iskoriscena";
  return "aktivna";
}

/** Red tabele u konzoli. Ide klijentu — zato ovde, a ne u server-only fajlu. */
export type PozivnicaPristupRed = {
  id: string;
  code: string;
  kind: AccessInviteKind;
  kompDays: number | null;
  kompCredits: number | null;
  /** Adresa za koju je vezana — vidi je samo admin, u dnevnik ne ide. */
  email: string | null;
  note: string | null;
  maxUses: number;
  usedCount: number;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  iskoristili: { userId: string; email: string | null; kad: string }[];
};
