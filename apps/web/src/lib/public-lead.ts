// apps/web/src/lib/public-lead.ts
// Jedina funkcija u aplikaciji koja sme da pretvori red iz `businesses` /
// `website_audits` u nešto što ide klijentu. P0-3 iz docs/bezbednost-i-zastita.md
// i pravilo 9 iz CLAUDE.md.
//
// ── ZAŠTO UNIJA, A NE `null` ───────────────────────────────
// PRD u sekciji 3 postavlja zaključena polja na `null`. Ali „Gotovo kad" u istom
// dokumentu traži da odgovor za zaključan lead *ne sadrži* `phone`, `email`,
// `websiteUrl`, `uglyScore`. `{"phone": null}` sadrži polje `phone`. Zato je
// `PublicLead` diskriminisana unija (definicija je u `search-types.ts`):
// zaključan lead te ključeve nema uopšte, pa ih ni JSON nema.
//
// ── PRAVILA ────────────────────────────────────────────────
// 1. Nijedna druga funkcija ne vraća red iz `businesses` ili `website_audits`.
// 2. Zabranjen `select *` u svakom upitu koji hrani ovu funkciju.
// 3. `uglyBand` je vidljiv i zaključanom leadu (to je mamac), `uglyScore` nije.
// 4. Novo polje u `website_audits` je PODRAZUMEVANO zaključano — dodaje se u
//    `UnlockedLead`, nikad u `LeadBase`, dok se svesno ne odluči drugačije.
//
// ── SCREENSHOTOVI (F5) ─────────────────────────────────────
// Iz baze stiže PUTANJA u privatnom bucketu, iz ove funkcije izlazi POTPISAN URL
// sa rokom od 15 minuta — i to samo za otključan lead. Potpisivanje je grupno i
// radi se pre poziva (v. `screenshots.ts`), pa ova funkcija ostaje sinhrona:
// inače bi svaka strana pretrage pravila 60 poziva ka Storage-u umesto jednog.
//
// Putanja zaključanog leada se ne potpisuje jer se ni ne prosleđuje — pozivalac
// skuplja putanje isključivo iz redova koje je prethodno proglasio otključanim.

import "server-only";
import type { BusinessRow, WebsiteAuditRow } from "@sajtoskop/shared";
import type { LeadBase, LeadScreenshot, PublicLead } from "./search-types";

// Ulazni oblici su namerno `Pick<>`, a ne ceo red iz baze: tip je istovremeno i
// lista kolona koje upit sme da traži. Ako neko doda kolonu u `Pick`, mora da je
// doda i u `select`.
export type LeadBusiness = Pick<
  BusinessRow,
  "place_id" | "name" | "city_slug" | "address" | "phone" | "phone_type" | "website_url" | "rating"
>;

export type LeadAudit = Pick<
  WebsiteAuditRow,
  | "site_status"
  | "ugly_band"
  | "platform"
  | "ugly_score"
  | "signals"
  | "emails"
  | "psi_mobile_score"
  | "psi_lcp_ms"
  | "ai_issues"
  | "ai_verdict"
  | "screenshot_desktop"
  | "screenshot_mobile"
>;

// `select` liste stoje uz `Pick` tipove, a ne uz upite: pravilo 2 iznad zabranjuje
// `select *`, pa svaki upit mora da nabroji kolone. Kad su te liste raštrkane po
// fajlovima, dodata kolona se doda u jednu i zaboravi u drugoj — tip i dalje
// prolazi kroz `tsc`, a polje u odgovoru je `undefined`. Ovde su jednom.
export const LEAD_BUSINESS_COLUMNS =
  "place_id, name, city_slug, address, phone, phone_type, website_url, rating";

export const LEAD_AUDIT_COLUMNS =
  "site_status, ugly_band, platform, ugly_score, signals, emails, " +
  "psi_mobile_score, psi_lcp_ms, ai_issues, ai_verdict, " +
  "screenshot_desktop, screenshot_mobile";

/**
 * Putanje snimaka jednog audita, za grupno potpisivanje.
 *
 * Pozivalac ovo sme da pozove SAMO za lead koji je proglasio otključanim.
 * Potpisan URL za zaključan lead je isto što i procureo telefon.
 */
export function screenshotPathsOf(a: LeadAudit | null): (string | null)[] {
  return a ? [a.screenshot_desktop, a.screenshot_mobile] : [];
}

function screenshotOf(
  a: LeadAudit | null,
  signed: ReadonlyMap<string, string> | undefined,
): LeadScreenshot | null {
  if (!a || !signed) return null;

  const desktop = a.screenshot_desktop ? (signed.get(a.screenshot_desktop) ?? null) : null;
  const mobile = a.screenshot_mobile ? (signed.get(a.screenshot_mobile) ?? null) : null;

  // Ni jedan ni drugi — polje je `null`, a ne objekat sa dva `null`-a. UI na
  // osnovu toga zna da prikaže poruku „sajt se ne otvara", a ne prazan okvir.
  if (!desktop && !mobile) return null;
  return { desktop, mobile };
}

export function toPublicLead(
  b: LeadBusiness,
  a: LeadAudit | null,
  isUnlocked: boolean,
  /** Rezultat `signScreenshots()`. Bez njega otključan lead nema snimke. */
  signed?: ReadonlyMap<string, string>,
): PublicLead {
  const base: LeadBase = {
    placeId: b.place_id,
    name: b.name,
    citySlug: b.city_slug,
    address: b.address,
    hasWebsite: !!b.website_url,
    phoneType: b.phone_type,
    rating: b.rating,
    siteStatus: a?.site_status ?? null,
    uglyBand: a?.ugly_band ?? null,
    platform: a?.platform ?? null,
  };

  if (!isUnlocked) return { ...base, isUnlocked: false };

  return {
    ...base,
    isUnlocked: true,
    phone: b.phone,
    websiteUrl: b.website_url,
    email: a?.emails?.[0] ?? null,
    uglyScore: a?.ugly_score ?? null,
    signals: (a?.signals ?? []).map((s) => s.label),
    // F6: skor, LCP i AI izlaz idu ISKLJUČIVO otključanom leadu (pravilo 4 gore).
    // `aiVerdict` je rečenica koju korisnik kopira u poruku — to je proizvod, a
    // ne mamac, i nema šta da radi u odgovoru za zaključan lead.
    psiMobileScore: a?.psi_mobile_score ?? null,
    psiLcpMs: a?.psi_lcp_ms ?? null,
    aiIssues: a?.ai_issues ?? null,
    aiVerdict: a?.ai_verdict ?? null,
    screenshot: screenshotOf(a, signed),
  };
}
