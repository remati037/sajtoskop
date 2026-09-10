// apps/web/src/lib/pozivnice-pristup.ts
// Pristupne pozivnice (S27, naplata-stripe.md §9): pravljenje, opoziv, spisak i
// prihvatanje.
//
// Za razliku od Clerk pozivnica (`admin-pozivnice.ts`), ove žive u NAŠOJ bazi —
// `access_invites` i `access_invite_redemptions` iz 0025. Obe tabele imaju RLS
// bez ijedne politike, pa se čitaju isključivo `adminSupabase()`-om, a jedini
// put do prava je `redeem_invite` (security definer, samo `service_role`).
//
// Zaštita je zato u pozivaocu: admin funkcije odavde smeju da se zovu tek posle
// `requireAdminRoute()` / `requireAdminPage()`, a `prihvatiPozivnicu()` tek sa
// `userId`-jem iz verifikovane sesije (pravilo 8).
//
// ── šta se ovde NE radi ─────────────────────────────────────
// Ni plan ni krediti se ne pišu odavde. `komp` dodeljuje `redeem_invite` kroz
// `admin_open_komp` (jedini put, v. `test/admin-komp.ts`), a `prvi_mesec` samo
// postavlja `profiles.invite_id` — kupon ubacuje checkout.

import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type {
  AccessInviteRedemptionRow,
  AccessInviteRow,
  RedeemInviteResult,
} from "@sajtoskop/shared";
import type { Ishod } from "./admin-radnje";
import {
  AZBUKA_KODA,
  ishodPrihvatanja,
  linkPozivnice,
  stanjePozivnice,
  type IshodPrihvatanja,
  type PozivnicaPristupBody,
  type PozivnicaPristupRed,
  type StanjePozivnice,
} from "./pozivnice-schema";
import { adminSupabase } from "./supabase";
import { inGrupe } from "./upiti";

// ═══════════════════════════════════════════════════════════
// KOD
// ═══════════════════════════════════════════════════════════

/**
 * `SAJT-XXXX-XXXX` iz `AZBUKA_KODA`.
 *
 * `randomBytes`, ne `Math.random()`: kod je pristup nalogu. Azbuka ima 32 znaka
 * pa je `256 % 32 = 0` i nijedan bajt se danas ne odbacuje — ali odbacivanje
 * gornjeg, nepotpunog opsega stoji svejedno, da izmena azbuke ne unese
 * pristrasnost bez ijednog upozorenja.
 */
export function generisiKod(): string {
  const granica = 256 - (256 % AZBUKA_KODA.length);
  let znakovi = "";

  while (znakovi.length < 8) {
    for (const b of randomBytes(16)) {
      if (znakovi.length === 8) break;
      if (b >= granica) continue;
      znakovi += AZBUKA_KODA[b % AZBUKA_KODA.length];
    }
  }

  return `SAJT-${znakovi.slice(0, 4)}-${znakovi.slice(4)}`;
}

/** Postgres `unique_violation` — kod koji već postoji. */
const DUPLIKAT = "23505";

/** Koliko puta generator sme da promaši postojeći kod. Na 2^40 kombinacija — nijednom. */
const POKUSAJA = 3;

// ═══════════════════════════════════════════════════════════
// SPISAK (konzola)
// ═══════════════════════════════════════════════════════════

export type ListaPristupnih = {
  redovi: PozivnicaPristupRed[];
  /** Rečenica zašto spiska nema. `null` kad je sve u redu. */
  greska: string | null;
};

/** Najnovijih 100. Pozivnica ima desetine, ne hiljade (§9.1: „prvih 20"). */
const PO_STRANI = 100;

/**
 * Spisak za `/admin/pozivnice`, najnovije prvo, sa tim ko je koju iskoristio.
 *
 * Tri upita umesto jednog ugnježđenog izbora: `profiles` nije u vezi sa
 * `access_invites` direktno, a pad drugog i trećeg upita ne sme da sakrije
 * same pozivnice — samo kolonu „ko".
 */
export async function citajPozivnice(): Promise<ListaPristupnih> {
  const db = adminSupabase();

  const { data, error } = await db
    .from("access_invites")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PO_STRANI)
    .returns<AccessInviteRow[]>();

  if (error) {
    console.error("[pozivnice] spisak:", error.message);
    return {
      redovi: [],
      greska: "Baza trenutno ne odgovara, pa spisak pristupnih pozivnica nije učitan.",
    };
  }

  const pozivnice = data ?? [];
  const iskoriscenja: AccessInviteRedemptionRow[] = [];
  const mejlovi = new Map<string, string | null>();

  for (const deo of inGrupe(pozivnice.map((p) => p.id))) {
    const r = await db
      .from("access_invite_redemptions")
      .select("invite_id, user_id, redeemed_at")
      .in("invite_id", deo)
      .order("redeemed_at", { ascending: true })
      .returns<AccessInviteRedemptionRow[]>();
    if (r.error) console.error("[pozivnice] iskorišćenja:", r.error.message);
    else iskoriscenja.push(...(r.data ?? []));
  }

  for (const deo of inGrupe([...new Set(iskoriscenja.map((r) => r.user_id))])) {
    const r = await db
      .from("profiles")
      .select("id, email")
      .in("id", deo)
      .returns<{ id: string; email: string | null }[]>();
    if (r.error) console.error("[pozivnice] mejlovi:", r.error.message);
    else for (const p of r.data ?? []) mejlovi.set(p.id, p.email);
  }

  const poPozivnici = new Map<string, PozivnicaPristupRed["iskoristili"]>();
  for (const r of iskoriscenja) {
    const lista = poPozivnici.get(r.invite_id) ?? [];
    lista.push({ userId: r.user_id, email: mejlovi.get(r.user_id) ?? null, kad: r.redeemed_at });
    poPozivnici.set(r.invite_id, lista);
  }

  return {
    redovi: pozivnice.map((p) => ({
      id: p.id,
      code: p.code,
      kind: p.kind,
      kompDays: p.komp_days,
      kompCredits: p.komp_credits,
      email: p.email,
      note: p.note,
      maxUses: p.max_uses,
      usedCount: p.used_count,
      createdAt: p.created_at,
      expiresAt: p.expires_at,
      revokedAt: p.revoked_at,
      iskoristili: poPozivnici.get(p.id) ?? [],
    })),
    greska: null,
  };
}

// ═══════════════════════════════════════════════════════════
// PRAVLJENJE I OPOZIV (konzola)
// ═══════════════════════════════════════════════════════════

/**
 * Nova pozivnica.
 *
 * `payload` za dnevnik nosi id i parametre — NE mejl na koji je vezana (K3
 * prompt, tačka 3): adresa čoveka koji još nema nalog ne treba da ostane u
 * reviziji zauvek. Vidi se u tabeli pozivnica dok pozivnica postoji. Ni kod ne
 * ulazi u dnevnik: kod je pristup, a `ref` (id) je dovoljan trag.
 */
export async function napraviPozivnicu(actor: string, telo: PozivnicaPristupBody): Promise<Ishod> {
  const komp = telo.kind === "komp";
  const red = {
    kind: telo.kind,
    komp_days: komp ? telo.komp_days : null,
    komp_credits: komp ? telo.komp_credits : null,
    email: telo.email ?? null,
    note: telo.note ?? null,
    max_uses: telo.max_uses,
    created_by: actor,
  };

  const payload = {
    kind: telo.kind,
    komp_days: red.komp_days,
    komp_credits: red.komp_credits,
    max_uses: telo.max_uses,
    vezana_za_mejl: telo.email !== undefined,
    rucni_kod: telo.code !== undefined,
    sa_napomenom: telo.note !== undefined,
  };

  for (let pokusaj = 0; pokusaj < (telo.code ? 1 : POKUSAJA); pokusaj++) {
    const code = telo.code ?? generisiKod();

    const { data, error } = await adminSupabase()
      .from("access_invites")
      .insert({ ...red, code })
      .select("id, code")
      .single<{ id: string; code: string }>();

    if (error?.code === DUPLIKAT) {
      if (telo.code) {
        return {
          ok: false,
          status: 409,
          poruka: `Kod ${code} već postoji. Izaberi drugi, ili ostavi polje prazno za generisan.`,
          payload,
        };
      }
      continue;
    }
    if (error) throw new Error(`access_invites: ${error.message}`);

    return {
      ok: true,
      poruka: `Pozivnica ${data.code} je napravljena. Link je ispod — pošalji ga ručno.`,
      ref: data.id,
      payload: { ...payload, invite_id: data.id },
      podaci: { link: linkPozivnice(data.code) },
    };
  }

  throw new Error(`generator je ${POKUSAJA} puta dao postojeći kod`);
}

/**
 * Opoziv: `revoked_at = now()`, red ostaje.
 *
 * Ne briše se, jer `access_invite_redemptions` i ledger (`invite:<id>`) na
 * njega pokazuju — brisanje bi pokidalo trag o tome odakle je nalogu komp.
 * Ko je pozivnicu VEĆ iskoristio zadržava ono što je dobio; opoziv zatvara
 * samo buduće upotrebe.
 *
 * Jedan izuzetak: `prvi_mesec` prihvaćen a još nepotrošen u checkout-u. Taj
 * nalog nosi `profiles.invite_id`, a checkout na njega ubacuje kupon bez
 * ikakve provere pozivnice. Opoziv zato briše i tu oznaku — inače bi opozvana
 * pozivnica i dalje davala gratis mesec.
 */
export async function opozoviPozivnicu(id: string): Promise<Ishod> {
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, status: 404, poruka: "Te pozivnice nema." };
  }

  const db = adminSupabase();

  const { data, error } = await db
    .from("access_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null)
    .select("id, code, kind, used_count")
    .maybeSingle<Pick<AccessInviteRow, "id" | "code" | "kind" | "used_count">>();

  if (error) throw new Error(`access_invites: ${error.message}`);

  if (!data) {
    const { data: postoji, error: e2 } = await db
      .from("access_invites")
      .select("id")
      .eq("id", id)
      .maybeSingle<{ id: string }>();
    if (e2) throw new Error(`access_invites: ${e2.message}`);
    return postoji
      ? { ok: false, status: 409, poruka: "Ta pozivnica je već opozvana.", ref: id }
      : { ok: false, status: 404, poruka: "Te pozivnice nema.", ref: id };
  }

  let skinuto = 0;
  if (data.kind === "prvi_mesec") {
    const { data: profili, error: e3 } = await db
      .from("profiles")
      .update({ invite_id: null })
      .eq("invite_id", id)
      .select("id")
      .returns<{ id: string }[]>();
    if (e3) throw new Error(`profiles(invite_id): ${e3.message}`);
    skinuto = (profili ?? []).length;
  }

  const oIskoriscenima =
    data.used_count === 0
      ? ""
      : data.kind === "komp"
        ? " Ko ju je već iskoristio, zadržava komp i kredite."
        : skinuto > 0
          ? ` ${skinuto} ${skinuto === 1 ? "nalog koji je još nije potrošio gubi" : "naloga koji je još nisu potrošili gube"} gratis mesec.`
          : " Ko je već platio kroz nju, zadržava pretplatu.";

  return {
    ok: true,
    poruka: `Pozivnica ${data.code} je opozvana. Link više ne radi.${oIskoriscenima}`,
    ref: id,
    payload: { invite_id: id, kind: data.kind, iskorisceno: data.used_count, skinut_gratis: skinuto },
  };
}

// ═══════════════════════════════════════════════════════════
// JAVNA STRANA I PRIHVATANJE
// ═══════════════════════════════════════════════════════════

/**
 * Ono što `/pozivnica/[code]` sme da pokaže: tip, rok i krediti, i je li
 * pozivnica još upotrebljiva.
 *
 * Ni mejl na koji je vezana ni napomena ne izlaze — strana je javna. Da li
 * pozivnica pripada baš ovom nalogu kaže tek `redeem_invite`, pri prihvatanju.
 */
export type PozivnicaZaStranu = {
  kind: AccessInviteRow["kind"];
  kompDays: number | null;
  kompCredits: number | null;
  stanje: StanjePozivnice;
};

export async function citajPozivnicuZaStranu(code: string): Promise<PozivnicaZaStranu | null> {
  const { data, error } = await adminSupabase()
    .from("access_invites")
    .select("kind, komp_days, komp_credits, max_uses, used_count, expires_at, revoked_at")
    .eq("code", code)
    .maybeSingle<
      Pick<
        AccessInviteRow,
        "kind" | "komp_days" | "komp_credits" | "max_uses" | "used_count" | "expires_at" | "revoked_at"
      >
    >();

  if (error) throw new Error(`access_invites: ${error.message}`);
  if (!data) return null;

  return {
    kind: data.kind,
    kompDays: data.komp_days,
    kompCredits: data.komp_credits,
    stanje: stanjePozivnice({
      revokedAt: data.revoked_at,
      expiresAt: data.expires_at,
      usedCount: data.used_count,
      maxUses: data.max_uses,
    }),
  };
}

/**
 * Korisnik prihvata kod — `redeem_invite(userId, code)`, jedna transakcija.
 *
 * `userId` MORA da dođe iz `requireUserId()` (pravilo 8). Kod je već prošao
 * `kodSchema`, dakle normalizovan je istim `upper(trim())` kao u funkciji.
 *
 * Posle komp prihvatanja se profil čita još jednom, samo zbog rečenice iz
 * §9.4 („do <datum>, N kredita"). Pad tog čitanja ne obara ishod: komp je u
 * tom trenutku već otvoren.
 */
export async function prihvatiPozivnicu(userId: string, code: string): Promise<IshodPrihvatanja> {
  const db = adminSupabase();

  const { data, error } = await db.rpc("redeem_invite", { p_user: userId, p_code: code });
  if (error) throw new Error(`redeem_invite: ${error.message}`);

  const red = ((data ?? []) as RedeemInviteResult[])[0];
  if (!red) throw new Error("redeem_invite nije vratio nijedan red.");

  if (!red.ok || red.kind !== "komp") return ishodPrihvatanja(red, null);

  const { data: profil, error: pErr } = await db
    .from("profiles")
    .select("komp_expires_at, credits_balance, credits_topup")
    .eq("id", userId)
    .maybeSingle<{ komp_expires_at: string | null; credits_balance: number; credits_topup: number }>();

  if (pErr) console.error("[pozivnice] profil posle prihvatanja:", pErr.message);

  return ishodPrihvatanja(
    red,
    profil
      ? { kompDo: profil.komp_expires_at, krediti: profil.credits_balance + profil.credits_topup }
      : null,
  );
}
