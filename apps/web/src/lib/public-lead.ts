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

import "server-only";
import type { BusinessRow, WebsiteAuditRow } from "@sajtoskop/shared";
import type { LeadBase, PublicLead } from "./search-types";

// Ulazni oblici su namerno `Pick<>`, a ne ceo red iz baze: tip je istovremeno i
// lista kolona koje upit sme da traži. Ako neko doda kolonu u `Pick`, mora da je
// doda i u `select`.
export type LeadBusiness = Pick<
  BusinessRow,
  "place_id" | "name" | "city_slug" | "address" | "phone" | "phone_type" | "website_url" | "rating"
>;

export type LeadAudit = Pick<
  WebsiteAuditRow,
  "site_status" | "ugly_band" | "platform" | "ugly_score" | "signals" | "emails" | "ai_issues"
>;

export function toPublicLead(
  b: LeadBusiness,
  a: LeadAudit | null,
  isUnlocked: boolean,
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
    aiIssues: a?.ai_issues ?? null,
  };
}
