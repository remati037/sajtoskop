// apps/worker/src/jobs/monthly-grant.ts
// Mesečna dodela kredita (F4 §2) — od S25 SAMO za godišnje pretplate i komp
// (naplata-stripe.md §10). Reset na `plan.monthlyCredits`, bez rollovera.
//
// ── zašto worker više ne dodeljuje SVIMA po `profiles.plan` ─
// `invoice.paid` je jedini trenutak kad se ZNA da je mesec plaćen: mesečne
// planove puni webhook (`apply_invoice_paid`), pa dodela na kalendar tamo ne
// sme — dala bi kredite i onome kome je kartica pala 3. u mesecu, i probi koja
// je ušla 28. (100 umesto 10, B2). Ostaju dva slučaja bez Stripe događaja
// „između":
//
//   ciklus = year   Stripe fakturiše jednom godišnje, krediti stižu mesečno.
//                   Prvi mesec daje `invoice.paid` (`subscription_create`), pa
//                   se mesec u kome je pretplata NASTALA preskače — inače bi
//                   bilo dvaput u istom mesecu.
//   plan = komp     bez Stripe-a uopšte; `PLANS.komp.monthlyCredits` dok komp
//                   traje (`komp_expires_at` prazan ili u budućnosti).
//
// Sve ostalo (`dopuna`, `trialing`, `past_due`, `canceled`, mesečni planovi)
// worker NE DIRA. Pražnjenje na kraju pretplate radi `expire_subscription_credits`.
//
// Zašto posao, a ne cron u Supabase-u: red poslova već ima retry, backoff i
// žetvu zaglavljenih. Idempotencija je u bazi, ne ovde: `grant_monthly_credits`
// odbija drugi poziv sa istim `ref_id` (mesec). Zato je bezbedno pustiti isti
// posao dvaput.

import { CREDITS_TIMEZONE, PLANS, planFor } from "@sajtoskop/shared";
import type { MonthlyGrantResult } from "@sajtoskop/shared";
import { supabaseAdmin } from "../lib/supabase";
import type { JobContext, JobResult } from "./types";
import { monthlyGrantPayloadSchema } from "./types";

/** Koliko redova se čita odjednom. Desetine korisnika danas; ovo je za posle. */
const STRANA = 500;

type Cilj = { userId: string; target: number; zasto: string };

/** `2026-09` po beogradskom kalendaru — isti izraz kao `creditMonth()` u shared paketu. */
function mesecOd(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CREDITS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

/**
 * Godišnje pretplate koje su žive i NISU nastale ovog meseca.
 *
 * Čita `subscriptions`, ne `profiles.plan`: plan na profilu ostaje i posle
 * otkaza (§1.5), a dodela sme samo dok Stripe drži pretplatu aktivnom.
 */
async function godisnjeCiljeve(month: string): Promise<Cilj[]> {
  const db = supabaseAdmin();
  const ciljevi: Cilj[] = [];
  let od = 0;

  for (;;) {
    const { data, error } = await db
      .from("subscriptions")
      .select("user_id, plan, created_at")
      .eq("ciklus", "year")
      .eq("status", "active")
      .gt("current_period_end", new Date().toISOString())
      .order("stripe_subscription_id", { ascending: true })
      .range(od, od + STRANA - 1)
      .returns<{ user_id: string; plan: string | null; created_at: string }[]>();

    if (error) throw new Error(`Čitanje godišnjih pretplata nije uspelo: ${error.message}`);

    const redovi = data ?? [];
    for (const r of redovi) {
      // Prvi mesec je dao `invoice.paid` (subscription_create) — preskoči.
      if (mesecOd(r.created_at) === month) continue;
      ciljevi.push({
        userId: r.user_id,
        target: planFor(r.plan).monthlyCredits,
        zasto: `godišnji ${r.plan ?? "?"}`,
      });
    }

    if (redovi.length < STRANA) break;
    od += STRANA;
  }

  return ciljevi;
}

/** Komp nalozi dok komp traje. */
async function kompCiljeve(): Promise<Cilj[]> {
  const db = supabaseAdmin();
  const ciljevi: Cilj[] = [];
  let od = 0;

  for (;;) {
    const { data, error } = await db
      .from("profiles")
      .select("id, komp_expires_at")
      .eq("plan", "komp")
      .or(`komp_expires_at.is.null,komp_expires_at.gt.${new Date().toISOString()}`)
      .order("id", { ascending: true })
      .range(od, od + STRANA - 1)
      .returns<{ id: string; komp_expires_at: string | null }[]>();

    if (error) throw new Error(`Čitanje komp naloga nije uspelo: ${error.message}`);

    const redovi = data ?? [];
    for (const r of redovi) {
      ciljevi.push({ userId: r.id, target: PLANS.komp.monthlyCredits, zasto: "komp" });
    }

    if (redovi.length < STRANA) break;
    od += STRANA;
  }

  return ciljevi;
}

export async function runMonthlyGrant(raw: unknown, ctx: JobContext): Promise<JobResult> {
  const { month } = monthlyGrantPayloadSchema.parse(raw);
  const db = supabaseAdmin();

  // Isti nalog ume da bude i komp i sa godišnjom pretplatom (rok kompa uz
  // plaćen plan, §1.5) — jedan `ref_id` po mesecu ionako dozvoljava jednu
  // dodelu, pa se uzima veća od dve mete, da mesec ne zavisi od redosleda.
  const poKorisniku = new Map<string, Cilj>();
  for (const c of [...(await godisnjeCiljeve(month)), ...(await kompCiljeve())]) {
    const postojeci = poKorisniku.get(c.userId);
    if (!postojeci || c.target > postojeci.target) poKorisniku.set(c.userId, c);
  }

  let dodeljeno = 0;
  let preskoceno = 0;
  let palo = 0;
  let ukupnoDelta = 0;

  for (const cilj of poKorisniku.values()) {
    const { data: res, error: rpcErr } = await db.rpc("grant_monthly_credits", {
      p_user: cilj.userId,
      p_target: cilj.target,
      p_ref_id: month,
    });

    if (rpcErr) {
      // Jedan korisnik ne obara dodelu za sve ostale. Posao se svejedno
      // završava kao neuspeh (v. ispod), pa se ponavlja i njega pokupi.
      palo++;
      ctx.log(`${cilj.userId} (${cilj.zasto}): ${rpcErr.message}`);
      continue;
    }

    const row = ((res ?? []) as MonthlyGrantResult[])[0];
    if (!row) {
      palo++;
      continue;
    }

    if (row.reason === "already_granted") preskoceno++;
    else if (row.ok) {
      dodeljeno++;
      ukupnoDelta += row.delta;
    } else {
      palo++;
      ctx.log(`${cilj.userId} (${cilj.zasto}): ${row.reason}`);
    }
  }

  // Neuspeh nekih korisnika MORA da obori posao: inače se `monthly_grant` za taj
  // mesec zavede kao `done` i niko nikad ne sazna da 3 čoveka nemaju kredite.
  // Ponovljeni pokušaj preskače one koji su prošli — dodela je idempotentna.
  if (palo > 0) {
    throw new Error(
      `${month}: ${dodeljeno} dodeljeno, ${preskoceno} preskočeno, ${palo} nije uspelo`,
    );
  }

  return {
    note:
      `${month}: ${dodeljeno} ${dodeljeno === 1 ? "korisnik" : "korisnika"} (godišnji + komp) dobilo kredite ` +
      `(neto ${ukupnoDelta >= 0 ? "+" : ""}${ukupnoDelta}), ${preskoceno} već imalo dodelu`,
  };
}
