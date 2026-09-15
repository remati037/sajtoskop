// apps/web/src/lib/unlock.ts
// Otključavanje jednog leada. Ovde se troši kredit — jedino mesto u web sloju
// koje to radi.
//
// ── ZAŠTO JE TROŠAK JEDAN POZIV ───────────────────────────
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
//
// ── [S30] posao analize ide u odgovor (C5, §7.4) ─────────────
// Do S30 odgovor nije nosio ID `enrich_full` posla, pa kartica nije imala šta da
// prati i `snimak.tsx` je govorio „osveži stranicu". Sada:
//   · novo otključavanje → ID posla koji je upravo upisan;
//   · `ponovi` („Pokušaj ponovo", §7.5) nad prospektom bez AI analize → nov
//     upis (dedupe po `place_id` sprečava drugi živ posao za isti prospekt);
//   · sve ostalo → živ posao ovog korisnika za taj prospekt, ako ga ima.
//
// Ponovni upis ide SAMO uz izričit `ponovi`. Kartica posle `done` zove istu rutu
// bez njega da pročita pun lead — kad bi i to naručivalo analizu, posao koji
// završi bez traga (robots.txt) bi se upisivao u krug, svaki put drugi Playwright.
//
// ── zašto skladište kao ulaz ────────────────────────────────
// Isti obrazac kao `NaplataSkladiste` i `StripeZaOtkazivanje`: odluka (kad se
// upisuje posao, kad se upisuje korak, šta ide u odgovor) proverava se u
// `apps/web/test/unlock.ts` bez baze. Produkcija koristi `SUPABASE_SKLADISTE`.

import "server-only";
import type { RpcResult, SpendReason } from "@sajtoskop/shared";
import { enqueueEnrichFull, ziviEnrichPoslovi } from "./jobs";
import { trebaPonovnaAnaliza } from "./kartica";
import { oznaciKorak } from "./onboarding";
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
  /** Stanje posle skidanja (ZBIR obe kase), za prikaz bez dodatnog kruga ka serveru. */
  creditsLeft: number;
  /** [S30] Posao analize koji kartica prati, ili `null`. */
  enrichJobId: number | null;
  /** [S30] Koraci onboardinga — samo kad je ovo otključavanje upisalo nov korak. */
  onboardingSteps?: Record<string, string>;
};

export type UnlockFailure = {
  ok: false;
  reason: Exclude<SpendReason, "unlocked" | "already_unlocked">;
};

export type UnlockOutcome = UnlockSuccess | UnlockFailure;

/** Sve što `unlockLead` traži od sveta. Produkcija: `SUPABASE_SKLADISTE`. */
export type UnlockSkladiste = {
  spend(userId: string, placeId: string): Promise<RpcResult<SpendReason>>;
  /** Upiše `enrich_full` i vrati ID posla. BACA na grešku — pozivalac je hvata. */
  enqueue(userId: string, placeId: string): Promise<number>;
  /** Živ `enrich_full` ovog korisnika za prospekt. BACA na grešku. */
  zivPosao(userId: string, placeId: string): Promise<number | null>;
  lead(placeId: string): Promise<UnlockedLead>;
  krediti(userId: string): Promise<number>;
  /** `null` = korak nije upisan (pao ili korisnik ne postoji). Ne baca. */
  oznaciKorak(userId: string): Promise<Record<string, string> | null>;
};

export type UnlockOpcije = {
  /** „Pokušaj ponovo" (§7.5): nov `enrich_full` ako AI analize nema. */
  ponovi?: boolean;
  /**
   * `profile.onboarding_steps` koji je ruta pročitala kroz kapiju. Kad već ima
   * `otkljucavanje`, korak se ne upisuje — nula poziva za svako otključavanje
   * posle prvog.
   */
  koraci?: Record<string, string> | null;
};

/**
 * Potroši kredit i otključaj lead.
 *
 * `userId` MORA doći iz `requireUserId()`, dakle iz verifikovane Clerk sesije
 * (pravilo 8). Ova funkcija to ne može da proveri — zato je zove isključivo
 * ruta, i zato ne postoji nijedna varijanta koja prima korisnika iz tela zahteva.
 */
export async function unlockLead(
  userId: string,
  placeId: string,
  opcije: UnlockOpcije = {},
  skladiste: UnlockSkladiste = SUPABASE_SKLADISTE,
): Promise<UnlockOutcome> {
  const row = await skladiste.spend(userId, placeId);

  if (!row.ok) {
    return { ok: false, reason: row.reason as UnlockFailure["reason"] };
  }

  const reason = row.reason as UnlockSuccess["reason"];
  const novo = reason === "unlocked";

  // Lead se čita PRE odluke o poslu: ponovni pokušaj zavisi od toga da li AI
  // analiza postoji, a to piše baš u leadu (jedan uslov, `trebaPonovnaAnaliza`).
  const lead = await skladiste.lead(placeId);

  let enrichJobId: number | null;
  if (novo || (opcije.ponovi === true && trebaPonovnaAnaliza(lead))) {
    // Skup enrichment ide isključivo lazy, na unlock (pravilo 5) — i samo kad je
    // otključavanje stvarno novo, ili kad ga je korisnik izričito tražio ponovo.
    // Ponovljeno `already_unlocked` bez `ponovi` ne sme da naruči drugi
    // screenshot i drugi Claude poziv za isti lead.
    enrichJobId = await upisiAnalizu(skladiste, userId, placeId);
  } else {
    enrichJobId = await skladiste.zivPosao(userId, placeId).catch((err: unknown) => {
      console.error(`[unlock] živ posao za ${placeId}: ${poruka(err)}`);
      return null;
    });
  }

  const creditsLeft = await skladiste.krediti(userId);

  // Korak trake (§4.3): „prvi `unlocks` red". Upisuje se samo na NOVO
  // otključavanje i samo kad ga profil još nema.
  let onboardingSteps: Record<string, string> | undefined;
  if (novo && !opcije.koraci?.otkljucavanje) {
    onboardingSteps = (await skladiste.oznaciKorak(userId)) ?? undefined;
  }

  return {
    ok: true,
    reason,
    lead,
    creditsLeft,
    enrichJobId,
    ...(onboardingSteps ? { onboardingSteps } : {}),
  };
}

/**
 * Upis `enrich_full` posla ne sme da obori odgovor.
 *
 * Kredit je u ovom trenutku već skinut i red u `unlocks` postoji — to je
 * commit-ovano u bazi. Ako sad bacimo, korisnik dobija grešku za nešto što je
 * uspelo, plaćeno mu je, a UI ga tera da klikne ponovo. Zato `null`: kartica na
 * to crta stanje greške sa „Pokušaj ponovo" (§7.4, „enqueue pao").
 */
async function upisiAnalizu(
  skladiste: UnlockSkladiste,
  userId: string,
  placeId: string,
): Promise<number | null> {
  try {
    return await skladiste.enqueue(userId, placeId);
  } catch (err) {
    console.error(`[unlock] enrich_full za ${placeId} nije upisan: ${poruka(err)}`);
    return null;
  }
}

function poruka(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  const row = await SUPABASE_SKLADISTE.spend(userId, placeId);

  if (!row.ok) return { ok: false, reason: row.reason };
  if (row.reason === "unlocked") await upisiAnalizu(SUPABASE_SKLADISTE, userId, placeId);
  return { ok: true, reason: row.reason };
}

/**
 * Je li prospekt već otključan ovom korisniku.
 *
 * Postoji zbog kapije u `/api/unlock`: nalog bez punog pristupa sme da ponovo
 * pročita ono što je već otključao, a ne sme ništa novo. Ne odlučuje o kreditu —
 * to i dalje radi `spend_credit_and_unlock`. BACA na grešku; ruta pad tumači
 * kao „ne", dakle protiv prolaza.
 */
export async function vecOtkljucan(userId: string, placeId: string): Promise<boolean> {
  const { count, error } = await adminSupabase()
    .from("unlocks")
    .select("place_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("place_id", placeId);

  if (error) throw new Error(`Provera otključanog nije uspela: ${error.message}`);
  return (count ?? 0) > 0;
}

// ═══════════════════════════════════════════════════════════
// PRODUKCIJSKO SKLADIŠTE
// ═══════════════════════════════════════════════════════════

export const SUPABASE_SKLADISTE: UnlockSkladiste = {
  async spend(userId, placeId) {
    const { data, error } = await adminSupabase().rpc("spend_credit_and_unlock", {
      p_user: userId,
      p_place: placeId,
    });

    if (error) throw new Error(`Otključavanje nije uspelo: ${error.message}`);

    const row = ((data ?? []) as RpcResult<SpendReason>[])[0];
    if (!row) throw new Error("spend_credit_and_unlock nije vratio rezultat.");
    return row;
  },

  async enqueue(userId, placeId) {
    return (await enqueueEnrichFull({ userId, placeId })).jobId;
  },

  async zivPosao(userId, placeId) {
    return (await ziviEnrichPoslovi(userId, [placeId])).get(placeId) ?? null;
  },

  lead: readUnlockedLead,
  krediti: readBalance,

  async oznaciKorak(userId) {
    return (await oznaciKorak(userId, "otkljucavanje"))?.steps ?? null;
  },
};

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

  // Na svež unlock snimaka gotovo uvek nema: `enrich_full` je tek upisan u red.
  // Kartica zato prati posao (§7.4) i posle `done` ponovo zove ovu rutu.
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
 *
 * [S30] ZBIR obe kase, kao svuda drugde u proizvodu (S21). Do S30 je ovde stajao
 * samo `credits_balance`, pa je nov nalog posle prvog otključavanja video
 * „0 kredita" iako mu je u `credits_topup` ostao drugi kredit dobrodošlice —
 * i kartica bi mu ponudila „treba plan" umesto otključavanja koje ima čime da plati.
 */
async function readBalance(userId: string): Promise<number> {
  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("credits_balance, credits_topup")
    .eq("id", userId)
    .maybeSingle<{ credits_balance: number; credits_topup: number }>();

  if (error) throw new Error(`Čitanje stanja kredita nije uspelo: ${error.message}`);
  return (data?.credits_balance ?? 0) + (data?.credits_topup ?? 0);
}
