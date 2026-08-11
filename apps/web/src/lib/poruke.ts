// apps/web/src/lib/poruke.ts
// Generisanje outreach poruka za jedan otključan lead (F7 §2) i evidentiranje
// onoga što je korisnik kopirao.
//
// Sama logika kopija je u `@sajtoskop/shared/outreach` — čista funkcija bez
// mreže, ista za web, worker i CLI. Ovde je samo ono što traži bazu: provera da
// je lead zaista otključan, čitanje njegovih polja i upis u `outreach_messages`.
//
// ── zašto poruke NISU keširane u bazi ──────────────────────
// `outreach_messages` je istorija poslatog, ne keš. Šablon se generiše iz čiste
// funkcije za mikrosekundu, jeftinije nego što bi se pročitao iz baze. Kad se
// tekst šablona popravi, svaki lead odmah dobija bolju poruku; keš bi mesecima
// servirao staru verziju i to bi se videlo tek po padu stope odgovora.

import "server-only";
import { napisiPoruke, type OutreachInput, type OutreachResult } from "@sajtoskop/shared";
import type { LeadChannel, MessageChannel } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";
import {
  LEAD_AUDIT_COLUMNS,
  LEAD_BUSINESS_COLUMNS,
  toPublicLead,
  type LeadAudit,
  type LeadBusiness,
} from "./public-lead";

/** Ime pod kojim se korisnik potpisuje u poruci. Bez njega poruka ide bez potpisa. */
export type Potpis = string | null;

/**
 * Da li je `placeId` otključan za ovog korisnika.
 *
 * Ide kroz `userSupabase()`, dakle kroz RLS politiku „own unlocks" — ista brava
 * kao u `moja-lista.ts`. Sa admin klijentom bi provera bila `where user_id = ...`
 * u TypeScriptu, tačno na mestu gde se takav uslov najlakše izgubi.
 */
async function jeOtkljucan(placeId: string): Promise<boolean> {
  const { data, error } = await userSupabase()
    .from("unlocks")
    .select("place_id")
    .eq("place_id", placeId)
    .maybeSingle<{ place_id: string }>();

  if (error) throw new Error(`Provera otključanja nije uspela: ${error.message}`);
  return !!data;
}

export type PorukeIshod =
  | { ok: true; rezultat: OutreachResult; naziv: string }
  | { ok: false; razlog: "not_unlocked" | "no_place" };

/**
 * Tri poruke za jedan lead.
 *
 * Poruka sadrži telefon, adresu sajta i AI nalaz — sve zaključana polja iz
 * pravila 9. Zato je prvi korak provera otključanja, a ne poslednji: bez nje bi
 * ova ruta bila zaobilaznica oko celog kreditnog modela.
 */
export async function porukeZaLead(placeId: string, potpis: Potpis): Promise<PorukeIshod> {
  if (!(await jeOtkljucan(placeId))) return { ok: false, razlog: "not_unlocked" };

  const db = adminSupabase();

  const { data: b, error: bErr } = await db
    .from("businesses")
    .select(LEAD_BUSINESS_COLUMNS)
    .eq("place_id", placeId)
    .maybeSingle<LeadBusiness>();

  if (bErr) throw new Error(`Čitanje prospekta nije uspelo: ${bErr.message}`);
  if (!b) return { ok: false, razlog: "no_place" };

  const { data: a, error: aErr } = await db
    .from("website_audits")
    .select(LEAD_AUDIT_COLUMNS)
    .eq("place_id", placeId)
    .maybeSingle<LeadAudit>();

  if (aErr) throw new Error(`Čitanje audita nije uspelo: ${aErr.message}`);

  return { ok: true, rezultat: napisiPoruke(uUlaz(b, a, potpis)), naziv: b.name };
}

/**
 * Red iz baze → ulaz generatora.
 *
 * Namerno ne ide kroz `toPublicLead`: generatoru trebaju `Signal` objekti sa
 * ključevima (`no_viewport`, `copyright_ancient`), a javni oblik leada nosi samo
 * tekstove signala — težine i ključevi ne izlaze sa servera (P0-3). Ovde smo na
 * serveru i to je jedina razlika koja ovaj prevod opravdava.
 */
function uUlaz(b: LeadBusiness, a: LeadAudit | null, potpis: Potpis): OutreachInput {
  return {
    name: b.name,
    citySlug: b.city_slug,
    nicheSlug: b.niche_slug,
    siteStatus: a?.site_status ?? null,
    websiteUrl: b.website_url,
    signals: a?.signals ?? [],
    aiIssues: a?.ai_issues ?? null,
    aiSolidan: a?.ai_solidan ?? null,
    phoneType: b.phone_type,
    rating: b.rating,
    reviewCount: b.user_ratings_total,
    senderName: potpis,
  };
}

export type KopiranoIshod =
  | { ok: true; status: "kontaktiran" | "nepromenjen" }
  | { ok: false; razlog: "not_unlocked" };

/**
 * Korisnik je kliknuo „Kopiraj" (F7 §2).
 *
 * Dva upisa, tim redom: prvo status, pa tek onda istorija poruke. Status je ono
 * zbog čega ceo kanban postoji; ako drugi upis padne, izgubi se zapis teksta, a
 * ne mesto leada u levku.
 *
 * `mark_contacted` namerno ne vraća lead unazad — v. objašnjenje u migraciji 0007.
 */
export async function zabeleziKopiranje(
  userId: string,
  placeId: string,
  channel: LeadChannel,
  body: string,
  source: "sablon" | "ai",
): Promise<KopiranoIshod> {
  const db = adminSupabase();

  const { data, error } = await db.rpc("mark_contacted", {
    p_user: userId,
    p_place: placeId,
    p_channel: channel,
  });

  if (error) throw new Error(`Upis kontakta nije uspeo: ${error.message}`);

  const red = ((data ?? []) as { ok: boolean; reason: string }[])[0];
  if (!red?.ok) return { ok: false, razlog: "not_unlocked" };

  // `poziv` nema tekst poruke — telefonski razgovor se ne arhivira.
  if (channel !== "poziv" && body.trim()) {
    const { error: mErr } = await db.from("outreach_messages").insert({
      user_id: userId,
      place_id: placeId,
      // Suženo gornjim `!== "poziv"` — `outreach_messages.channel` po CHECK
      // ograničenju prima samo kanale koji imaju tekst.
      channel: channel satisfies MessageChannel as MessageChannel,
      body,
      source,
    });

    // Ne ruši odgovor: status je upisan, a to je ono što korisnik vidi. Gubitak
    // arhive je vredan loga, ne crvene poruke na ekranu.
    if (mErr) console.error("[poruke] upis u outreach_messages nije uspeo:", mErr.message);
  }

  return { ok: true, status: red.reason === "contacted" ? "kontaktiran" : "nepromenjen" };
}
