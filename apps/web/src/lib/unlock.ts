// apps/web/src/lib/unlock.ts
// Otključavanje jednog leada. Ovde se troši kredit — jedino mesto u web sloju
// koje to radi.
//
// ── ZAŠTO JE OVAJ FAJL TAKO KRATAK ────────────────────────
// Ceo trošak kredita je JEDAN poziv `spend_credit_and_unlock`. Nema
// „pročitaj balans → uporedi → skini", jer između ta dva koraka stane drugi
// zahtev istog korisnika: dva taba, dupli klik, ili skripta sa 20 paralelnih
// poziva. Zaključavanje reda (`select ... for update` u SQL funkciji) je jedina
// stvar koja tu trku rešava, i ono postoji samo unutar jedne transakcije u bazi.
//
// Praktično pravilo za svaku buduću izmenu: ako ovde ikad počne da stoji
// `if (profile.credits_balance < 1)` pre RPC-a — to je bag, ne provera. Ta
// provera je tada samo brža verzija odgovora koji baza već daje, a razlikuje se
// od njega baš u trenutku trke.
//
// Pravilo 3 iz CLAUDE.md: krediti se menjaju samo kroz `spend_credit_and_unlock`
// ili `grant_credits`. Direktan `update profiles.credits_balance` ne postoji.

import "server-only";
import type { RpcResult, SpendReason } from "@sajtoskop/shared";
import { enqueueEnrichFull } from "./jobs";
import {
  LEAD_AUDIT_COLUMNS,
  LEAD_BUSINESS_COLUMNS,
  screenshotPathsOf,
  toPublicLead,
  type LeadAudit,
  type LeadBusiness,
} from "./public-lead";
import { signScreenshots } from "./screenshots";
import type { UnlockedLead } from "./search-types";
import { adminSupabase } from "./supabase";

export type UnlockSuccess = {
  ok: true;
  /** `already_unlocked` znači da kredit NIJE skinut (pravilo 4). */
  reason: Extract<SpendReason, "unlocked" | "already_unlocked">;
  lead: UnlockedLead;
  /** Stanje posle skidanja, za prikaz u headeru bez dodatnog kruga ka serveru. */
  creditsLeft: number;
};

export type UnlockFailure = {
  ok: false;
  reason: Exclude<SpendReason, "unlocked" | "already_unlocked">;
};

export type UnlockOutcome = UnlockSuccess | UnlockFailure;

/**
 * Potroši kredit i otključaj lead.
 *
 * `userId` MORA doći iz `requireUserId()`, dakle iz verifikovane Clerk sesije
 * (pravilo 8). Ova funkcija to ne može da proveri — zato je zove isključivo
 * ruta, i zato ne postoji nijedna varijanta koja prima korisnika iz tela zahteva.
 */
export async function unlockLead(userId: string, placeId: string): Promise<UnlockOutcome> {
  const db = adminSupabase();

  const { data, error } = await db.rpc("spend_credit_and_unlock", {
    p_user: userId,
    p_place: placeId,
  });

  if (error) throw new Error(`Otključavanje nije uspelo: ${error.message}`);

  const row = ((data ?? []) as RpcResult<SpendReason>[])[0];
  if (!row) throw new Error("spend_credit_and_unlock nije vratio rezultat.");

  if (!row.ok) {
    return { ok: false, reason: row.reason as UnlockFailure["reason"] };
  }

  const reason = row.reason as UnlockSuccess["reason"];

  // Skup enrichment ide isključivo lazy, na unlock (pravilo 5) — i samo kad je
  // otključavanje stvarno novo. Ponovljeno `already_unlocked` ne sme da naruči
  // drugi screenshot i drugi Claude poziv za isti lead.
  if (reason === "unlocked") await scheduleEnrichment(userId, placeId);

  const [lead, creditsLeft] = await Promise.all([readUnlockedLead(placeId), readBalance(userId)]);

  return { ok: true, reason, lead, creditsLeft };
}

/**
 * Upis `enrich_full` posla ne sme da obori odgovor.
 *
 * Kredit je u ovom trenutku već skinut i red u `unlocks` postoji — to je
 * commit-ovano u bazi. Ako sad bacimo, korisnik dobija grešku za nešto što je
 * uspelo, plaćeno mu je, a UI ga tera da klikne ponovo. Posao je bonus
 * (u F4 ionako prazan handler), pa se neuspeh beleži i ide dalje.
 */
async function scheduleEnrichment(userId: string, placeId: string): Promise<void> {
  try {
    await enqueueEnrichFull({ userId, placeId });
  } catch (err) {
    console.error(
      `[unlock] enrich_full za ${placeId} nije upisan: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * [Faza 2, 2.1] Otključavanje za BULK UVOZ — bez UI čitanja.
 *
 * `unlockLead` posle RPC-a čita lead i balans za odgovor ekrana; uvoz te
 * podatke ne koristi, pa bi ~4 upita po redu bila bačena. Ostaje ISTI
 * `spend_credit_and_unlock` (jedini put do kredita, pravilo 3) i isti upis
 * `enrich_full` posla — razlika je samo u čitanjima koja uvoz ne gleda.
 */
export async function otkljucajZaUvoz(
  userId: string,
  placeId: string,
): Promise<{ ok: boolean; reason: SpendReason }> {
  const { data, error } = await adminSupabase().rpc("spend_credit_and_unlock", {
    p_user: userId,
    p_place: placeId,
  });

  if (error) throw new Error(`Otključavanje nije uspelo: ${error.message}`);

  const row = ((data ?? []) as RpcResult<SpendReason>[])[0];
  if (!row) throw new Error("spend_credit_and_unlock nije vratio rezultat.");

  if (!row.ok) return { ok: false, reason: row.reason };
  if (row.reason === "unlocked") await scheduleEnrichment(userId, placeId);
  return { ok: true, reason: row.reason };
}

/**
 * Lead posle otključavanja, kroz istu `toPublicLead` funkciju koju koristi
 * pretraga (PRD §1). Odgovor rute tako ne može da se raziđe sa odgovorom liste —
 * a što je važnije, novo polje u `website_audits` je i ovde podrazumevano
 * zaključano dok se svesno ne doda u `UnlockedLead`.
 */
async function readUnlockedLead(placeId: string): Promise<UnlockedLead> {
  const db = adminSupabase();

  const { data: business, error: bErr } = await db
    .from("businesses")
    .select(LEAD_BUSINESS_COLUMNS)
    .eq("place_id", placeId)
    .maybeSingle<LeadBusiness>();

  if (bErr) throw new Error(`Čitanje prospekta nije uspelo: ${bErr.message}`);
  // SQL funkcija je već potvrdila da red postoji (`no_place`), pa je ovo stvarno
  // nemoguće stanje — brisanje između dva upita — a ne očekivana grana.
  if (!business) throw new Error(`Prospekt ${placeId} je nestao usred otključavanja.`);

  const { data: audit, error: aErr } = await db
    .from("website_audits")
    .select(LEAD_AUDIT_COLUMNS)
    .eq("place_id", placeId)
    .maybeSingle<LeadAudit>();

  if (aErr) throw new Error(`Čitanje audita nije uspelo: ${aErr.message}`);

  // Na svež unlock ovo je gotovo uvek prazno: `enrich_full` je tek upisan u red
  // i Playwright još nije ni startovao. Snimci se pojave na prvom sledećem
  // učitavanju liste, u roku od tridesetak sekundi.
  const signed = await signScreenshots(screenshotPathsOf(audit));

  const lead = toPublicLead(business, audit, true, signed);
  // `isUnlocked: true` je ovde nesporno — prosleđen je literal iznad. Suženje
  // postoji da bi povratni tip bio `UnlockedLead`, a ne unija sa zaključanim.
  if (!lead.isUnlocked) throw new Error("toPublicLead je vratio zaključan lead.");
  return lead;
}

/**
 * Balans se čita ODVOJENO, posle RPC-a, i služi samo prikazu.
 * Nikad se ne koristi za odluku da li korisnik sme da otključa — tu odluku
 * donosi baza, pod zaključanim redom.
 */
async function readBalance(userId: string): Promise<number> {
  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("credits_balance")
    .eq("id", userId)
    .maybeSingle<{ credits_balance: number }>();

  if (error) throw new Error(`Čitanje stanja kredita nije uspelo: ${error.message}`);
  return data?.credits_balance ?? 0;
}
