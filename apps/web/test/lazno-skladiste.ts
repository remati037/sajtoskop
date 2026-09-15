// apps/web/test/lazno-skladiste.ts
// `NaplataSkladiste` u memoriji. Resolve hook u `naplata.ts` ovim fajlom
// zamenjuje `@/lib/billing-skladiste`, pa ruta radi nad njim ne znajući to —
// isto kao što `scripts/lib/next-stubs.ts` zamenjuje Clerk.
//
// Ponaša se kao migracije 0025, 0026 i 0030 tačno tamo gde je to bitno za
// testove: dve kase, razlog bira kasu (`credit_pack` i `onboarding` → dopuna),
// `ref_id` je ključ idempotencije, mesečna dodela POSTAVLJA balans (bez
// rollovera) i pamti `balance_after`, `stale_ignored` po `event.created`,
// pražnjenje na kraju pretplate, povraćaj se odseca na pod −1000. Sve ostalo
// (zaključavanje reda, trke, `check` ograničenja) proverava `pnpm check:sql`
// nad pravom migracijom — ovde bi bilo lažno dvaput.
//
// Metode koje u produkciji zovu Stripe (`otisakKartice`, `naplatiProbuOdmah`,
// `naplata`, `faktureZaPlacanje`) ovde su upravljive iz testa: `otisci`,
// `naplate` i `fakturePlacanja` mape i `probaNaplacena` brojač.
// `ceneStavki` razrešava izmišljene ID-jeve `cenaId(lookup_key)` iz kataloga.

import { kupovinaZaLookupKey } from "@sajtoskop/shared";
import type {
  CenaStavke,
  NaplataSkladiste,
  NaplataSpora,
  OtisakPretplate,
  StavkaDodele,
} from "../src/lib/billing";

export const KORISNIK = "user_test_1";

const CENA_PREFIKS = "price_test_";

/** `profiles_credits_nonneg` (0022). */
const POD = -1000;

/** Izmišljen `price_…` ID za cenu sa datim `lookup_key` — ono što stavka fakture nosi. */
export function cenaId(lookupKey: string): string {
  return `${CENA_PREFIKS}${lookupKey}`;
}

export type Knjiga = {
  userId: string;
  delta: number;
  reason: string;
  refId: string | null;
  /** `credit_ledger.balance_after` (0030) — samo mesečna dodela ga upisuje. */
  balanceAfter?: number | null;
};

/** `admin_audit` za povraćaj: šta je traženo i šta je stvarno skinuto. */
export type Revizija = { refId: string; trazeno: number; delta: number };

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
  /** `ch_…` → kupac i payment_intent (`charges.retrieve`); test puni pre spora. */
  naplate: Map<string, NaplataSpora>;
  /** `pi_…` → `in_…` fakture koje je to plaćanje platilo (`invoicePayments.list`). */
  fakturePlacanja: Map<string, string[]>;
  revizija: Revizija[];
  /**
   * `grant_credits` — za fiksture koje u produkciji ne stižu kroz webhook
   * (`onboarding` iz `create_profile_with_grant`).
   */
  dodeli: (reason: string, delta: number, refId: string | null) => string;
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
  const naplate = new Map<string, NaplataSpora>();
  const fakturePlacanja = new Map<string, string[]>();
  const revizija: Revizija[] = [];

  /** `grant_credits` (0026): razlog bira kasu, `ref_id` je ključ idempotencije. */
  function dodeli(reason: string, delta: number, refId: string | null): string {
    if (refId && knjiga.some((r) => r.reason === reason && r.refId === refId)) {
      return "already_granted";
    }
    knjiga.push({ userId: KORISNIK, delta, reason, refId });
    if (reason === "credit_pack" || reason === "onboarding") profil.topup += delta;
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
    async ceneStavki(ids) {
      // Kao `prices.retrieve`: `cenaId(lookup_key)` je cena iz kataloga, paketi
      // nisu ponavljajući. Nepoznat ID nema cenu u mapi.
      const mapa = new Map<string, CenaStavke>();
      for (const id of ids) {
        const kljuc = id.startsWith(CENA_PREFIKS) ? id.slice(CENA_PREFIKS.length) : null;
        const k = kupovinaZaLookupKey(kljuc);
        if (k) mapa.set(id, { lookupKey: k.lookupKey, recurring: k.kind === "subscription" });
      }
      return mapa;
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
      // `grant_monthly_credits` (0030): POSTAVLJA balans na cilj, ref je faktura,
      // cilj ostaje u knjizi kao `balance_after`. Dopuna se ne dira.
      if (!a.invoiceId) return { ok: false, reason: "missing_ref_id", granted: 0 };
      if (knjiga.some((r) => r.reason === "monthly_grant" && r.refId === a.invoiceId)) {
        return { ok: true, reason: "already_granted", granted: 0 };
      }
      const delta = a.target - profil.balance;
      knjiga.push({ userId: a.userId, delta, reason: "monthly_grant", refId: a.invoiceId, balanceAfter: a.target });
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
    async naplata(chargeId) {
      return naplate.get(chargeId) ?? null;
    },
    async faktureZaPlacanje(paymentIntentId) {
      return fakturePlacanja.get(paymentIntentId) ?? [];
    },
    async dodeleZaTransakciju(_userId, refIds): Promise<StavkaDodele[]> {
      return knjiga
        .filter(
          (r) =>
            r.refId !== null &&
            refIds.includes(r.refId) &&
            (r.reason === "monthly_grant" || r.reason === "subscription_grant" || r.reason === "credit_pack"),
        )
        .map((r) => ({ reason: r.reason, delta: r.delta, balanceAfter: r.balanceAfter ?? null }));
    },
    async korigujKredite(a) {
      // `admin_adjust_credits` sa `p_kind => 'povracaj'` sme u minus i preskače
      // proveru „balans bi bio negativan" (0022 §1), ali ne ispod poda (0030).
      if (knjiga.some((r) => r.reason === "admin" && r.refId === a.refId)) {
        return { ok: true, reason: "already_applied", granted: 0 };
      }
      let delta = a.delta;
      if (profil.balance + delta < POD) {
        delta = Math.min(0, POD - profil.balance);
        if (delta === 0) {
          if (revizija.some((r) => r.refId === a.refId)) {
            return { ok: true, reason: "already_applied", granted: 0 };
          }
          revizija.push({ refId: a.refId, trazeno: a.delta, delta: 0 });
          return { ok: true, reason: "na_podu", granted: 0 };
        }
      }
      knjiga.push({ userId: a.userId, delta, reason: "admin", refId: a.refId });
      revizija.push({ refId: a.refId, trazeno: a.delta, delta });
      profil.balance += delta;
      return { ok: true, reason: delta === a.delta ? "ok" : "odseceno", granted: 0 };
    },
  };

  return {
    skladiste,
    knjiga,
    profil,
    dogadjaji,
    pretplate,
    otisci,
    zapamceniOtisci,
    probaNaplacena,
    naplate,
    fakturePlacanja,
    revizija,
    dodeli,
  };
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
