// apps/web/test/lazno-skladiste.ts
// `NaplataSkladiste` u memoriji. Resolve hook u `naplata.ts` ovim fajlom
// zamenjuje `@/lib/billing-skladiste`, pa ruta radi nad njim ne znajući to —
// isto kao što `scripts/lib/next-stubs.ts` zamenjuje Clerk.
//
// Ponaša se kao migracija 0022 tačno tamo gde je to bitno za testove: dve kase,
// razlog bira kasu, `ref_id` je ključ idempotencije. Sve ostalo (zaključavanje
// reda, trke, `check` ograničenja) proverava `pnpm check:sql` nad pravom
// migracijom — ovde bi bilo lažno dvaput.

import type { NaplataSkladiste } from "../src/lib/billing";

export const KORISNIK = "user_test_1";

export type Knjiga = { userId: string; delta: number; reason: string; refId: string | null };

export type Lazno = {
  skladiste: NaplataSkladiste;
  knjiga: Knjiga[];
  profil: { balance: number; topup: number; plan: string; customerId: string | null };
  dogadjaji: Set<string>;
  pretplate: Map<string, { userId: string; status: string; plan: string | null }>;
};

export function napraviLazno(): Lazno {
  const dogadjaji = new Set<string>();
  const knjiga: Knjiga[] = [];
  const profil = { balance: 0, topup: 0, plan: "beta", customerId: null as string | null };
  const pretplate = new Map<string, { userId: string; status: string; plan: string | null }>();

  /** `grant_credits`: razlog bira kasu, `ref_id` je ključ idempotencije. */
  function dodeli(reason: string, delta: number, refId: string | null): string {
    if (refId && knjiga.some((r) => r.reason === reason && r.refId === refId)) {
      return "already_granted";
    }
    knjiga.push({ userId: KORISNIK, delta, reason, refId });
    if (reason === "credit_pack") profil.topup += delta;
    else profil.balance += delta;
    return "granted";
  }

  const skladiste: NaplataSkladiste = {
    async upisiDogadjaj({ eventId }) {
      if (dogadjaji.has(eventId)) return false;
      dogadjaji.add(eventId);
      return true;
    },
    async obrisiDogadjaj(eventId) {
      dogadjaji.delete(eventId);
    },
    async profilPostoji(userId) {
      return userId === KORISNIK;
    },
    async korisnikPoPretplati(id) {
      return pretplate.get(id)?.userId ?? null;
    },
    async korisnikPoKupcu(id) {
      return profil.customerId === id ? KORISNIK : null;
    },
    async primeniPretplatu(a) {
      pretplate.set(a.subscriptionId, { userId: a.userId, status: a.status, plan: a.plan });
      if (a.customerId) profil.customerId = a.customerId;
      if (a.plan) profil.plan = a.plan;
      if (a.credits <= 0 || !a.txnId) return { ok: true, reason: "saved", granted: 0 };
      const reason = dodeli("subscription_grant", a.credits, a.txnId);
      return { ok: true, reason, granted: reason === "granted" ? a.credits : 0 };
    },
    async primeniPaket(a) {
      if (a.customerId) profil.customerId = a.customerId;
      const reason = dodeli("credit_pack", a.credits, a.txnId);
      return { ok: true, reason, granted: reason === "granted" ? a.credits : 0 };
    },
    async dodeljenoZaTransakciju(_userId, txnId) {
      return knjiga
        .filter(
          (r) =>
            r.refId === txnId &&
            (r.reason === "subscription_grant" || r.reason === "credit_pack"),
        )
        .reduce((zbir, r) => zbir + r.delta, 0);
    },
    async korigujKredite(a) {
      // `admin_adjust_credits` sa `p_kind => 'povracaj'` sme u minus i preskače
      // proveru „balans bi bio negativan" (0022 §1) — zato ovde nema donjeg praga.
      if (knjiga.some((r) => r.reason === "admin" && r.refId === a.refId)) {
        return { ok: true, reason: "already_applied", granted: 0 };
      }
      knjiga.push({ userId: a.userId, delta: a.delta, reason: "admin", refId: a.refId });
      profil.balance += a.delta;
      return { ok: true, reason: "ok", granted: 0 };
    },
  };

  return { skladiste, knjiga, profil, dogadjaji, pretplate };
}

// ── ono što ruta vidi ───────────────────────────────────────
// Ruta zove `supabaseSkladiste()` pri svakom zahtevu. Kroz resolve hook stiže
// ovamo i dobija ono što je test poslednje postavio.

let tekuce: NaplataSkladiste | null = null;

export function postavi(s: NaplataSkladiste | null): void {
  tekuce = s;
}

export function supabaseSkladiste(): NaplataSkladiste {
  if (!tekuce) throw new Error("Test nije postavio lažno skladište pre poziva rute.");
  return tekuce;
}
