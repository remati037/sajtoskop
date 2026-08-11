// apps/worker/src/lib/side-budget.ts
// Brojač za API-je koji nisu Google Places: PageSpeed Insights i Anthropic (F6).
//
// ── zašto zaseban fajl, a ne još jedna funkcija u api-budget.ts ──────────
// `api-budget.ts` čuva Googleovu kvotu i sve u njemu — mesečni cap, `exhausted`
// katanac posle 429, LA dan — postoji zbog Googleovog modela naplate. PSI i
// Anthropic nemaju ništa od toga: svoja kvota, svoj račun, svoj reset.
//
// Deljena je samo tabela `api_budget`, i to namerno: jedan pogled na `by_kind`
// pokazuje ceo dnevni trošak. Ali kolona `calls`, nad kojom stoji mesečni cap od
// 1.000 Places poziva, ostaje netaknuta — o tome se stara `consume_side_call` u
// migraciji 0005, ne ovaj fajl.
//
// Ista pravila kao kod Googlea važe i ovde:
//   - `consume()` se zove NEPOSREDNO PRE HTTP zahteva, nikad posle
//   - pada zatvoreno: ako baza nije dostupna, poziv se ne dogodi

import { AI_DAILY_CAP, AI_OUTREACH_DAILY_CAP, PSI_DAILY_CAP } from "@sajtoskop/shared";
import { hoursUntilReset } from "./api-budget";
import { supabaseAdmin } from "./supabase";

/**
 * Ključevi pod kojima se broji u `api_budget.by_kind`.
 *
 * Prefiks nije kozmetika: `consume_side_call` odbija sve što počinje sa
 * `places:`, jer bi taj poziv time izašao iz jedinog budžeta koji ga čuva.
 */
export const SIDE_KIND = {
  psi: "psi:mobile",
  ai: "ai:audit",
  /** F7 §2: „Napiši drugačije". Svoj cap — v. `AI_OUTREACH_DAILY_CAP`. */
  aiOutreach: "ai:outreach",
} as const;

export type SideKind = (typeof SIDE_KIND)[keyof typeof SIDE_KIND];

function num(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 0) throw new Error(`Nevalidan limit: ${raw}`);
  return n;
}

/** Dnevni cap po ključu. Env je izlaz u nuždi, ne podrazumevana konfiguracija. */
export function dailyCapFor(kind: SideKind): number {
  if (kind === SIDE_KIND.ai) return num(process.env.AI_DAILY_LIMIT, AI_DAILY_CAP);
  if (kind === SIDE_KIND.aiOutreach) {
    return num(process.env.AI_OUTREACH_DAILY_LIMIT, AI_OUTREACH_DAILY_CAP);
  }
  return num(process.env.PSI_DAILY_LIMIT, PSI_DAILY_CAP);
}

type SideRow = {
  ok: boolean;
  reason: "consumed" | "daily_cap";
  pt_day: string;
  kind_calls: number;
  retry_after: string | null;
};

export type SideBudgetResult = {
  ok: boolean;
  /** Koliko je poziva tog tipa potrošeno danas, uključujući ovaj. */
  calls: number;
  cap: number;
  /** Popunjeno samo kad je poziv odbijen. */
  retryAfter?: Date;
};

/**
 * Rezerviše JEDAN poziv ka PSI-ju ili Anthropicu.
 *
 * Ne baca kad je cap dostignut — vraća `ok: false`. Razlog je iz PRD-a §3:
 * iznad capa `enrich_full` preskače korak i ostavlja lead na `audit_level = 2`,
 * a ne obara ceo posao za koji je korisnik već platio kredit.
 *
 * Baca samo kad baza nije dostupna: bez brojača se ne troši ničiji novac.
 */
export async function consumeSide(kind: SideKind): Promise<SideBudgetResult> {
  const cap = dailyCapFor(kind);

  const { data, error } = await supabaseAdmin().rpc("consume_side_call", {
    p_kind: kind,
    p_daily_cap: cap,
  });

  if (error) {
    throw new Error(
      `Budžet nije dostupan (consume_side_call, ${kind}): ${error.message}\n` +
        `Bez brojača se spoljni API ne zove — proveri da li je migracija 0005 puštena.`,
    );
  }

  const rows = (data ?? []) as SideRow[];
  if (rows.length === 0) {
    throw new Error(`Budžet: consume_side_call (${kind}) nije vratio nijedan red.`);
  }

  const r = rows[0] as SideRow;

  return {
    ok: r.ok,
    calls: r.kind_calls,
    cap,
    retryAfter: r.retry_after ? new Date(r.retry_after) : undefined,
  };
}

/** Rečenica za log kad je cap dostignut. */
export function capMessage(kind: SideKind, res: SideBudgetResult): string {
  return `dnevni cap za ${kind}: ${res.calls}/${res.cap}, reset za ~${hoursUntilReset()}h`;
}
