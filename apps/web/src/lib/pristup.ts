// apps/web/src/lib/pristup.ts
// Serverska strana kapije pristupa (S19, LANSIRANJE §1.5).
//
// Odluka NIJE ovde — ona je jedna čista funkcija, `stanjePristupa()` u
// `@sajtoskop/shared`. Ovde su samo tri stvari koje odluka ne sme da zna:
//   1. odakle stižu redovi (`profiles` kroz RLS, `subscriptions` kroz admin
//      klijent — v. `citajPretplatu`),
//   2. kako izgleda odbijenica u API ruti,
//   3. kuda vodi zaključan nalog na stranici.
//
// ── pravilo koje ovaj fajl čuva ─────────────────────────────
// Ako se ikad zatekne druga računica o pristupu bilo gde u kodu — poređenje
// `plan_expires_at` sa `new Date()`, `if (plan === "komp")` kao dozvola, bilo
// šta — `stanjePristupa()` je izgubio smisao. Kapija se dodaje pozivom odavde,
// nikad novim `if`-om uz podatak.
//
// ── zašto kapija ide UZ PODATAK ─────────────────────────────
// `(app)/layout.tsx` se NE izvršava ponovo pri klijentskoj navigaciji između
// sestrinskih ruta (v. komentar na njegovom vrhu). Zaključan nalog koji je već
// unutra prelazi sa `/lista` na `/pretraga` bez ijednog serverskog poziva u
// layout. Zato svaka stranica i svaka ruta zovu svoju kapiju same.

import "server-only";
import { cache } from "react";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { stanjePristupa, type Pristup, type PretplataZaPristup } from "@sajtoskop/shared";
import type { ProfileRow } from "@sajtoskop/shared";
import { getCurrentUserId } from "./auth";
import { citajProfil } from "./profile";
import { adminSupabase } from "./supabase";
import type { ApiError } from "./search-types";
import { formatDatum } from "./ui-tekst";

/**
 * Najsvežija pretplata korisnika, svedena na ono što odluka koristi.
 *
 * Ide kroz `adminSupabase()`, ne kroz `userSupabase()`: `subscriptions` ima
 * `enable`/`force row level security` BEZ IJEDNE POLITIKE (0022 §3), pa bi
 * korisnički klijent uvek vratio prazno — i svaki pretplatnik bi ispao
 * `aktivan` umesto `otkazan`. Identitet je i dalje iz verifikovane sesije
 * (pravilo 8): `userId` stiže kao argument iz `requireUserId()`/`requireSession()`,
 * nikad iz tela zahteva.
 *
 * `order + limit 1` po istom indeksu koji 0022 pravi
 * (`subscriptions (user_id, current_period_end desc)`). Više redova postoji kad
 * je korisnik menjao plan — merodavan je onaj koji traje najduže.
 *
 * Ne baca. Pad ovog upita ne sme da zaključa nalog; posledica je samo da se
 * otkazana pretplata u poslednjem plaćenom mesecu prikaže kao aktivna.
 */
export const citajPretplatu = cache(async (userId: string): Promise<PretplataZaPristup | null> => {
  const { data, error } = await adminSupabase()
    .from("subscriptions")
    .select("status, current_period_end, trial_end, cancel_at_period_end, canceled_at")
    .eq("user_id", userId)
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{
      status: PretplataZaPristup["status"];
      current_period_end: string | null;
      trial_end: string | null;
      cancel_at_period_end: boolean;
      canceled_at: string | null;
    }>();

  if (error) {
    console.error("[pristup] čitanje pretplate nije uspelo:", error.message);
    return null;
  }

  if (!data) return null;

  return {
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    trialEnd: data.trial_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    canceledAt: data.canceled_at,
  };
});

export type IshodPristupa = {
  profile: ProfileRow | null;
  pretplata: PretplataZaPristup | null;
  /**
   * `null` znači NEPOZNATO stanje, ne „nema pristup".
   *
   * Do njega se stiže samo kad profil nije pročitan — pokvarena Clerk↔Supabase
   * veza. Kapije tada namerno PROPUŠTAJU (v. `zahtevajCitanje` i `odbijenica`):
   * jedan kvar u vezi sa bazom ne sme da izgleda kao istekla pretplata, a i
   * svaka putanja koja stvarno troši novac ionako pada niže, u `no_user` grani
   * SQL funkcije.
   */
  pristup: Pristup | null;
  /** Tehnička poruka iz baze, isti oblik kao u `citajProfil()`. */
  greska: string | null;
};

/**
 * Profil + pretplata + izvedeno stanje, jednom po zahtevu.
 *
 * `cache()` je request-scoped memoizacija iz React-a: layout, stranica i svaka
 * kapija u istom zahtevu dele JEDAN par upita. Bez toga bi svaka dopisana
 * kapija bila dva nova upita po učitavanju strane.
 *
 * Namerno NE kreira profil. Rezervni put za to stoji u `(app)/layout.tsx` i
 * mora da ostane tamo: `ensureProfile` traži Clerk poziv i piše u bazu, a
 * kapija je čitanje.
 */
export const citajPristup = cache(async (): Promise<IshodPristupa> => {
  const userId = await getCurrentUserId();
  if (!userId) return { profile: null, pretplata: null, pristup: null, greska: null };

  const [{ profile, greska }, pretplata] = await Promise.all([
    citajProfil(),
    citajPretplatu(userId),
  ]);

  return { profile, pretplata, pristup: pristupZaProfil(profile, pretplata), greska };
});

/**
 * Isto računanje, ali nad profilom koji je pozivalac već pročitao.
 *
 * Postoji zbog `(app)/layout.tsx`: on profil čita sam (i po potrebi ga kreira),
 * pa bi ga kroz `citajPristup()` čitao drugi put — i to bi u rezervnom putu
 * vratilo memoizovan `null`, dakle stanje od pre kreiranja profila.
 */
export function pristupZaProfil(
  profile: ProfileRow | null,
  pretplata: PretplataZaPristup | null,
): Pristup | null {
  if (!profile) return null;

  return stanjePristupa(
    {
      plan: profile.plan,
      kompExpiresAt: profile.komp_expires_at,
      planExpiresAt: profile.plan_expires_at,
      creditsTopup: profile.credits_topup,
    },
    pretplata,
    Date.now(),
  );
}

// ═══════════════════════════════════════════════════════════
// KAPIJA ZA STRANICE
// ═══════════════════════════════════════════════════════════

/** Gde ide zaključan nalog. Jedna adresa, da se ne bi razišla po stranama. */
export const PUTANJA_ZAKLJUCANO = "/zakljucano";

/**
 * Prva linija svake strane u `(app)` — ODMAH posle `requireSession()`.
 *
 * Zaključan nalog se preusmerava na `/zakljucano`: stranu sa objašnjenjem i
 * dugmetom ka cenovniku. Ne prazan ekran i ne `404` — čovek koji je do juče
 * plaćao mora da razume šta se desilo i šta može (§1.5).
 *
 * Sve ostalo prolazi i dobija `pristup` nazad, pa strana sama odlučuje šta
 * prikazuje (npr. `/pretraga` u `grace` stanju crta objašnjenje umesto forme).
 */
export async function zahtevajCitanje(): Promise<IshodPristupa> {
  const ishod = await citajPristup();
  if (ishod.pristup && !ishod.pristup.cita) redirect(PUTANJA_ZAKLJUCANO);
  return ishod;
}

// ═══════════════════════════════════════════════════════════
// KAPIJA ZA API RUTE
// ═══════════════════════════════════════════════════════════

/** Radnje koje kapija ume da odbije. Tekst odbijenice zavisi od radnje. */
export type Radnja = "pretraga" | "skeniranje" | "otkljucavanje" | "uvoz" | "ai-poruka";

const IME_RADNJE: Record<Radnja, string> = {
  pretraga: "Pretraga",
  skeniranje: "Skeniranje",
  otkljucavanje: "Otključavanje",
  uvoz: "Uvoz",
  "ai-poruka": "Nova varijanta poruke",
};

const HEADERS = { "Cache-Control": "private, no-store" };

/**
 * Odbijenica za rutu koja troši, ili `null` ako radnja sme da prođe.
 *
 * ‼️ `403`, ne `402`. U ovom kodu `402` znači tačno jednu stvar — „nemaš
 *    dovoljno kredita" — i klijent na njega nudi „vidi kredite". Istekao pristup
 *    nije stanje novčanika: kupovina kredita ga u `grace` stanju ne popravlja
 *    ako je razlog istekla pretplata, a `dopuna` ga popravlja i bez plana. Dva
 *    različita razloga sa istim statusom bi značila jedno pogrešno dugme.
 */
export function odbijenica(pristup: Pristup | null, radnja: Radnja): Response | null {
  // Nepoznato stanje ne zaključava — v. `IshodPristupa.pristup`.
  if (!pristup || pristup.pun) return null;

  const poruka =
    pristup.stanje === "grace"
      ? `${IME_RADNJE[radnja]} ne radi jer ti je pristup istekao. Do ${formatDatum(pristup.citanjeDo)} ` +
        "možeš da otvaraš svoje prospekte, vodiš pipeline i izvezeš oba CSV-a. " +
        "Uzmi plan ili paket kredita na /cenovnik i sve se odmah vraća."
      : `${IME_RADNJE[radnja]} ne radi jer ti je pristup istekao. ` +
        "Uzmi plan ili paket kredita na /cenovnik.";

  const body: ApiError = { greska: poruka };
  return NextResponse.json(body, { status: 403, headers: HEADERS });
}

/**
 * Odbijenica za rutu koja samo čita (izvoz, pipeline, poruke).
 *
 * Jedino stanje koje ovde pada je `zakljucan`. `grace` prolazi — to je ceo
 * smisao grace perioda: mesec dana da čovek izvuče svoj rad (§1.5).
 */
export function odbijenicaCitanja(pristup: Pristup | null): Response | null {
  if (!pristup || pristup.cita) return null;

  const body: ApiError = {
    greska:
      "Pristup ti je istekao pre više od mesec dana, pa ovaj podatak više ne mogu da serviram. " +
      "Ništa nije obrisano — uzmi plan ili paket kredita na /cenovnik i sve se vraća.",
  };
  return NextResponse.json(body, { status: 403, headers: HEADERS });
}
