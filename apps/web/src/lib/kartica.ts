// apps/web/src/lib/kartica.ts
// Stanje kartice prospekta IZ PODATAKA (tok-i-onboarding §7, D12).
//
// Namerno BEZ `server-only`: istu odluku donosi kartica u pregledaču, test
// (`apps/web/test/kartica.ts`) i `lib/unlock.ts` na serveru — pa je ovo jedino
// mesto na kom se piše „šta znači da analiza nije stigla". Dve kopije tog uslova
// bi značile karticu koja kaže „u toku" dok server odbija ponovni pokušaj.
//
// §7: „`stanje` izvedeno iz podataka, ne iz propa". Zato ovde nema nijednog
// polja koje bi pozivalac mogao da postavi na „greška" sam — greška je ono što
// ostane kad analize nema, a nema ni posla koji je pravi.

import type { ContactChannel, LeadStatusValue, MessageChannel, PhoneKind } from "@sajtoskop/shared";
import type { LeadBase, PublicLead, UnlockedLead } from "./search-types";

/** Pet stanja iz §7 (7.2 otključano, 7.3 zaključano, 7.4 u toku, 7.5 greška, 7.6 nema sajt). */
export type StanjeKartice = "zakljucano" | "u_toku" | "greska" | "nema_sajt" | "otkljucano";

/**
 * Šta je kartica saznala o poslu analize (`enrich_full`) dok ga je pratila.
 *
 *   radi    — posao postoji i još nije završio
 *   pao     — `job_queue.status = failed`, ili status posla nije mogao da se pročita
 *   predugo — 20 provera (60 s) bez `done` (§7.4)
 */
export type IshodPosla = "radi" | "pao" | "predugo";

export type PosaoKartice = { id: number | null; ishod: IshodPosla | null };

/**
 * Status sajta koji je sam po sebi „dobar prospekt" (§7.6): worker za njega ne
 * pravi ni snimak, ni skor, ni PSI, pa stanje „u toku" praktično ne postoji.
 */
const BEZ_SAJTA = new Set(["nema_sajt", "mrtav", "samo_drustvene"]);

/** Varijanta „nema sajt" (§7.6) — i za zaključan prospekt, jer je status javan. */
export function jeBezSajta(lead: Pick<LeadBase, "hasWebsite" | "siteStatus">): boolean {
  return !lead.hasWebsite || (lead.siteStatus !== null && BEZ_SAJTA.has(lead.siteStatus));
}

/**
 * Da li je `enrich_full` ostavio IJEDAN trag: snimak, PSI ili AI.
 *
 * Bilo koji od tri je dovoljan da kartica bude puna — ostali delovi tada imaju
 * svoje rečenice („Snimak nije sačuvan", „Analiza problema nije prošla…", §7.5).
 */
export function analizaStigla(lead: UnlockedLead): boolean {
  return lead.screenshot !== null || lead.aiIssues !== null || lead.psiMobileScore !== null;
}

/**
 * Da li „Pokušaj ponovo" sme da naruči nov `enrich_full` (§7.5, K4).
 *
 * Kad AI izlaza nema, a sajt postoji. Pokriva oba reda iz §7.5 sa dugmetom
 * „Pokušaj ponovo": sve palo (nema ni snimka ni AI) i AI pao a snimak prošao.
 * Red „snimak pao, AI prošao" dugme nema — i ovde ne prolazi, jer `aiIssues`
 * postoji.
 */
export function trebaPonovnaAnaliza(lead: UnlockedLead): boolean {
  return !jeBezSajta(lead) && lead.aiIssues === null;
}

export function stanjeKartice(
  lead: PublicLead,
  posao: PosaoKartice,
  /** Zahtev za otključavanje je poslat, odgovor još nije stigao (§7.3, korak 3). */
  otkljucavam = false,
): StanjeKartice {
  if (!lead.isUnlocked) return otkljucavam ? "u_toku" : "zakljucano";
  if (jeBezSajta(lead)) return "nema_sajt";
  if (analizaStigla(lead)) return "otkljucano";
  if (posao.ishod === "pao" || posao.ishod === "predugo") return "greska";
  if (posao.id !== null) return "u_toku";
  // Analize nema, a nema ni posla koji je pravi: enqueue je pao, ili je posao
  // završio bez traga (robots.txt, sajt koji pregledač ne otvara). §7.4: „inače
  // §7.5".
  return "greska";
}

/** Tabovi bloka poruke. `poziv` nema svoj šablon — nosi Viber tekst (C9). */
export type TabPoruke = MessageChannel | "poziv";

export const TABOVI: readonly TabPoruke[] = ["viber", "mejl", "instagram", "poziv"];

/**
 * Podrazumevan tab (§7.2): kanal iz čarobnjaka kad je primenljiv, inače
 * `predlog` iz odgovora `/api/poruke`.
 *
 * „Primenljiv": Viber traži mobilni broj, Mejl traži adresu. Instagram nema
 * podatak koji bi ga isključio — ručka se traži na profilu firme.
 */
export function podrazumevaniTab(
  kanal: string | null | undefined,
  lead: Pick<UnlockedLead, "phoneType" | "email">,
  predlog: ContactChannel,
): TabPoruke {
  if (kanal === "viber" && lead.phoneType === "mobilni") return "viber";
  if (kanal === "mejl" && lead.email) return "mejl";
  if (kanal === "instagram") return "instagram";
  return predlog;
}

/**
 * Tab koji bi bio podrazumevan za ZAKLJUČAN prospekt (§7.3): iz tipa telefona,
 * jer je on javan. Isto pravilo kao `predlogKanala` u `outreach.ts`.
 */
export function predlogIzTelefona(tip: PhoneKind | null): TabPoruke {
  if (tip === "mobilni") return "viber";
  if (tip === "fiksni" || tip === "besplatni") return "poziv";
  return "mejl";
}

/** „Kontaktiran" iz tosta ne sme da vrati prospekt koji je već dalje u levku. */
export function smeKontaktiran(status: LeadStatusValue | null | undefined): boolean {
  return status === undefined || status === null || status === "nekontaktiran";
}

/** Google Maps za `place_id` (§6 #4). `place_id` je javan. */
export function mapaUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

/** `https://www.pvcmont.rs/` → `pvcmont.rs`. */
export function domenIzUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/** `pvcmont.sabac@gmail.com` → `pvcmont…@gmail.com` (§7.2: truncate u sredini). */
export function skratiMejl(mejl: string, max = 22): string {
  if (mejl.length <= max) return mejl;
  const at = mejl.lastIndexOf("@");
  if (at <= 0) return `${mejl.slice(0, max - 1)}…`;
  const domen = mejl.slice(at);
  const lokalno = Math.max(3, max - domen.length - 1);
  return `${mejl.slice(0, lokalno)}…${domen}`;
}

/**
 * Ključevi koji u JSON-u zaključanog prospekta ne smeju da postoje (pravilo 9,
 * §7 doslovno, plus PSI i `aiSolidan` koji su takođe roba). Test proverava
 * stvaran JSON iz `toPublicLead`, ne tip.
 */
export const ZAKLJUCANI_KLJUCEVI = [
  "phone",
  "email",
  "websiteUrl",
  "uglyScore",
  "signals",
  "aiIssues",
  "aiVerdict",
  "aiSolidan",
  "psiMobileScore",
  "psiLcpMs",
  "screenshot",
] as const;
