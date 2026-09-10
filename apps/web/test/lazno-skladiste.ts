// apps/web/test/lazno-skladiste.ts
// `NaplataSkladiste` u memoriji. Resolve hook u `naplata.ts` ovim fajlom
// zamenjuje `@/lib/billing-skladiste`, pa ruta radi nad njim ne znajući to —
// isto kao što `scripts/lib/next-stubs.ts` zamenjuje Clerk.
//
// Ponaša se kao migracija 0025 tačno tamo gde je to bitno za testove: dve
// kase, razlog bira kasu, `ref_id` je ključ idempotencije, mesečna dodela
// POSTAVLJA balans (bez rollovera), `stale_ignored` po `event.created`,
// pražnjenje na kraju pretplate. Sve ostalo (zaključavanje reda, trke, `check`
// ograničenja) proverava `pnpm check:sql` nad pravom migracijom — ovde bi bilo
// lažno dvaput.
//
// Dve metode koje u produkciji zovu Stripe (`otisakKartice`,
// `naplatiProbuOdmah`) ovde su upravljive iz testa: `otisci` mapa i
// `probaNaplacena` brojač.

import type { NaplataSkladiste, OtisakPretplate } from "../src/lib/billing";

export const KORISNIK = "user_test_1";

export type Knjiga = { userId: string; delta: number; reason: string; refId: string | null };

export type Pretplata = {
  userId: string;
  status: string;
  plan: string | null;
  ciklus: string | null;
  lookupKey: string | null;
  periodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  /** `event.created` poslednjeg PRIMENJENOG događaja — brana za `stale_ignored`. */
  updatedAt: string;
};

export type Lazno = {
  skladiste: NaplataSkladiste;
  knjiga: Knjiga[];
  profil: {
    balance: number;
    topup: number;
    plan: string;
    planExpiresAt: string | null;
    customerId: string | null;
    inviteId: string | null;
  };
  dogadjaji: Set<string>;
  pretplate: Map<string, Pretplata>;
  /** `sub_…` → šta Stripe „zna" o kartici; test puni pre slanja. */
  otisci: Map<string, OtisakPretplate>;
  /** Otisci koje je skladište zapamtilo: fingerprint → prvi user_id. */
  zapamceniOtisci: Map<string, string>;
  /** Koliko puta je proba pretvorena u naplatu (`trial_end: now`). */
  probaNaplacena: string[];
};

export function napraviLazno(): Lazno {
  const dogadjaji = new Set<string>();
  const knjiga: Knjiga[] = [];
  const profil = {
    balance: 0,
    topup: 0,
    plan: "dopuna",
    planExpiresAt: null as string | null,
    customerId: "cus_test_1" as string | null,
    inviteId: null as string | null,
  };
  const pretplate = new Map<string, Pretplata>();
  const otisci = new Map<string, OtisakPretplate>();
  const zapamceniOtisci = new Map<string, string>();
  const probaNaplacena: string[] = [];

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
    async planPoPretplati(id) {
      const p = pretplate.get(id)?.plan;
      return p === "starter" || p === "pro" || p === "advanced" ? p : null;
    },
    async primeniPretplatu(a) {
      // §6.4: stariji `event.created` posle novijeg se ignoriše.
      const prethodna = pretplate.get(a.subscriptionId);
      if (prethodna && Date.parse(a.eventCreated) < Date.parse(prethodna.updatedAt)) {
        return { ok: true, reason: "stale_ignored", granted: 0 };
      }
      pretplate.set(a.subscriptionId, {
        userId: a.userId,
        status: a.status,
        plan: a.plan ?? prethodna?.plan ?? null,
        ciklus: a.ciklus ?? prethodna?.ciklus ?? null,
        lookupKey: a.lookupKey ?? prethodna?.lookupKey ?? null,
        periodEnd: a.periodEnd ?? prethodna?.periodEnd ?? null,
        trialEnd: a.trialEnd,
        cancelAtPeriodEnd: a.cancelAtPeriodEnd,
        canceledAt: a.canceledAt,
        updatedAt: a.eventCreated,
      });
      if (a.customerId) profil.customerId = a.customerId;
      if (["trialing", "active", "past_due"].includes(a.status) && a.plan) profil.plan = a.plan;
      if (a.periodEnd) profil.planExpiresAt = a.periodEnd;
      return { ok: true, reason: "saved", granted: 0 };
    },
    async primeniFakturu(a) {
      // `grant_monthly_credits`: POSTAVLJA balans na cilj, ref je faktura.
      if (!a.invoiceId) return { ok: false, reason: "missing_ref_id", granted: 0 };
      if (knjiga.some((r) => r.reason === "monthly_grant" && r.refId === a.invoiceId)) {
        return { ok: true, reason: "already_granted", granted: 0 };
      }
      const delta = a.target - profil.balance;
      knjiga.push({ userId: a.userId, delta, reason: "monthly_grant", refId: a.invoiceId });
      profil.balance = a.target;
      return { ok: true, reason: "granted", granted: delta };
    },
    async pocniProbu(a) {
      const reason = dodeli("trial_grant", a.credits, `trial:${a.userId}`);
      return { ok: true, reason, granted: reason === "granted" ? a.credits : 0 };
    },
    async istekniPretplatu(a) {
      const ref = `expire:${a.subscriptionId}`;
      if (knjiga.some((r) => r.reason === "expire" && r.refId === ref)) {
        return { ok: true, reason: "already_applied", granted: 0 };
      }
      if (profil.balance <= 0) return { ok: true, reason: "nothing", granted: 0 };
      const delta = -profil.balance;
      knjiga.push({ userId: a.userId, delta, reason: "expire", refId: ref });
      profil.balance = 0;
      return { ok: true, reason: "expired", granted: delta };
    },
    async primeniPaket(a) {
      if (a.customerId) profil.customerId = a.customerId;
      const reason = dodeli("credit_pack", a.credits, a.txnId);
      return { ok: true, reason, granted: reason === "granted" ? a.credits : 0 };
    },
    async oznaciPozivnicuIskoriscenom() {
      profil.inviteId = null;
    },
    async zapamtiOtisak({ fingerprint, userId }) {
      const prvi = zapamceniOtisci.get(fingerprint);
      if (!prvi) {
        zapamceniOtisci.set(fingerprint, userId);
        return "nov";
      }
      return prvi === userId ? "nov" : "vidjen";
    },
    async otisakKartice(subscriptionId) {
      return otisci.get(subscriptionId) ?? null;
    },
    async naplatiProbuOdmah(subscriptionId) {
      probaNaplacena.push(subscriptionId);
    },
    async dodeljenoZaTransakciju(_userId, refIds) {
      return knjiga
        .filter(
          (r) =>
            r.refId !== null &&
            refIds.includes(r.refId) &&
            (r.reason === "monthly_grant" || r.reason === "subscription_grant" || r.reason === "credit_pack"),
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

  return { skladiste, knjiga, profil, dogadjaji, pretplate, otisci, zapamceniOtisci, probaNaplacena };
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
