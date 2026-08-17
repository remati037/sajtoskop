/**
 * Praćenje Google API kvote — mesečni cap je tvrda granica, dnevni je mekana.
 *
 * Zašto tako:
 *  Google od 1.3.2025. daje besplatni prag PO SKU-u, mesečno, bez prenosa.
 *  Text Search sa kontakt poljima (nationalPhoneNumber, websiteUri, rating)
 *  pada na Enterprise SKU = 1.000 poziva mesečno. Reset prvog u mesecu.
 *  Googleu je nebitna dnevna raspodela — bitan mu je zbir za mesec.
 *
 *  Dnevni limit ostaje samo kao zaštita od odbeglog skripta, ne kao budžet.
 *
 * Dan i mesec se računaju po America/Los_Angeles, jer tamo Google resetuje.
 * Ponoć PT = 09:00 u Beogradu.
 *
 * ── F3: stanje je u bazi, ne u fajlu ─────────────────────────────────────
 * Do F2 je stanje bilo u `.cache/api-budget.json`. To je radilo dok je postojao
 * samo CLI na mom laptopu. Od trenutka kad worker radi na Hetzneru, dva procesa
 * na dve mašine sa dva fajla znače dva brojača, a mesečni cap prestaje da važi.
 * Sada je jedan red po LA danu u tabeli `api_budget`.
 *
 * ── ko računa LA dan ─────────────────────────────────────────────────────
 * BAZA. `consume_api_call()` sam poziva `budget_day()` i ne prima dan kao
 * parametar — pogrešan sat ili TZ na kontejneru ne može da upiše u pogrešan dan.
 * `budgetDay()` ovde ostaje netaknut, ali služi SAMO za poruke korisniku i za
 * `hoursUntilReset()`. Da se dve implementacije ne raziđu, `pnpm check:sql`
 * poredi izlaz ove funkcije sa izlazom SQL-a.
 *
 * Sve što dodiruje bazu je async i pada zatvoreno: ako Supabase nije dostupan,
 * `consume()` baca i HTTP zahtev ka Googleu se nikad ne dogodi. Bolje propušten
 * scan nego nebrojani pozivi.
 */

import {
  GLOBAL_DAILY_API_CAP,
  GLOBAL_MONTHLY_API_CAP,
} from "@sajtoskop/shared";
import { supabaseAdmin } from "./supabase";

// ─────────────────────────────────────────────────────────────
// Konfiguracija
// ─────────────────────────────────────────────────────────────

function num(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 0) throw new Error(`Nevalidan limit: ${raw}`);
  return n;
}

/** TVRDA granica. Ispod Googleovog besplatnog praga za Enterprise SKU (1.000). */
export function monthlyLimit(): number {
  return num(process.env.GOOGLE_MONTHLY_LIMIT, GLOBAL_MONTHLY_API_CAP);
}

/** MEKA granica — zaštita od odbeglog skripta, ne budžet. */
export function dailyLimit(): number {
  return num(process.env.GOOGLE_DAILY_LIMIT, GLOBAL_DAILY_API_CAP);
}

// ─────────────────────────────────────────────────────────────
// Vreme po Googleovoj zoni
// ─────────────────────────────────────────────────────────────

const PT_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Dan po kome Google resetuje dnevnu kvotu. Format YYYY-MM-DD.
 *
 * NIJE autoritet za upis — to je `budget_day()` u bazi. Ovo je za ispis i za
 * proveru da se klijent i baza slažu.
 */
export function budgetDay(d: Date = new Date()): string {
  return PT_DAY_FMT.format(d);
}

/** Mesec po kome Google resetuje besplatni prag. Format YYYY-MM. */
export function budgetMonth(d: Date = new Date()): string {
  return budgetDay(d).slice(0, 7);
}

/** Sati do reseta dnevne kvote. Korača po satu, pa DST ne pomera rezultat. */
export function hoursUntilReset(d: Date = new Date()): number {
  const today = budgetDay(d);
  for (let i = 1; i <= 30; i++) {
    if (budgetDay(new Date(d.getTime() + i * 3_600_000)) !== today) return i;
  }
  return 24;
}

/**
 * Koliko dana ostaje u LA mesecu, uključujući današnji. Za tempo potrošnje.
 *
 * Računa se po kalendaru, ne dodavanjem 24h: LA dan traje 23h ili 25h dvaput
 * godišnje, pa bi koračanje po milisekundama 1.11. izbrojalo isti datum dvaput,
 * a u martu preskočilo jedan.
 */
export function daysLeftInMonth(d: Date = new Date()): number {
  const [y, m, day] = budgetDay(d).split("-").map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m je 1-based → 0. dan sledećeg
  return daysInMonth - day + 1;
}

/**
 * Tačan trenutak kad Google resetuje dnevnu kvotu — ponoć sledećeg LA dana.
 *
 * LA ponoć je uvek na ceo UTC sat (07:00Z leti, 08:00Z zimi), pa se kreće od
 * celog sata i korača po satu — rezultat je TAČNO ponoć, ne „sutra u ovo
 * doba". Baza ima istu funkciju (`budget_next_day_reset`); `pnpm check:sql`
 * poredi izlaze.
 *
 * [Faza 0, 0.1] `BudgetError` mora da nosi `retryAfter` (K1): bez njega worker
 * umesto odlaganja na reset kvote troši pokušaje i scan konačno padne — iako
 * budžet nije greška nego čekanje.
 */
export function nextDayReset(d: Date = new Date()): Date {
  const start = new Date(d.getTime() - (d.getTime() % 3_600_000));
  const today = budgetDay(start);
  for (let i = 1; i <= 48; i++) {
    const t = new Date(start.getTime() + i * 3_600_000);
    if (budgetDay(t) !== today) return t;
  }
  // Nepoznat kalendar — samo zaštita od beskonačne petlje.
  return new Date(start.getTime() + 48 * 3_600_000);
}

/**
 * Tačan trenutak kad Google vraća mesečni besplatni prag — prvi sledećeg LA
 * meseca, tačno u LA ponoć. Baza ima istu funkciju (`budget_next_month_reset`).
 */
export function nextMonthReset(d: Date = new Date()): Date {
  const start = new Date(d.getTime() - (d.getTime() % 3_600_000));
  const thisMonth = budgetMonth(start);
  // Najviše 32 dana do kraja meseca, a dan ume da traje 25 sati (DST) —
  // 800 sati je sigurna gornja granica.
  for (let i = 1; i <= 800; i++) {
    const t = new Date(start.getTime() + i * 3_600_000);
    if (budgetMonth(t) !== thisMonth) return t;
  }
  return new Date(start.getTime() + 800 * 3_600_000);
}

// ─────────────────────────────────────────────────────────────
// Stanje
// ─────────────────────────────────────────────────────────────

export type BudgetState = {
  day: string;
  month: string;
  calls: number; // danas
  monthCalls: number; // ovaj mesec
  exhausted: boolean; // 429; resetuje se sledećeg PT dana
  byKind: Record<string, number>;
};

/** Zašto poziv nije prošao. Određuje kad posao sme ponovo da se pokuša. */
export type BudgetScope = "daily" | "monthly" | "exhausted";

export class BudgetError extends Error {
  constructor(
    message: string,
    public readonly state: BudgetState,
    /** `undefined` kad je greška pre-flight, a ne odbijen konkretan poziv. */
    public readonly scope?: BudgetScope,
    /** Kad ima smisla pokušati ponovo. Worker ovo upisuje u `job_queue.run_after`. */
    public readonly retryAfter?: Date,
  ) {
    super(message);
    this.name = "BudgetError";
  }
}

// ── oblik redova koje vraćaju RPC funkcije iz 0002 ──────────
// `pt_day` / `pt_month`, ne `day` / `month`: u plpgsql-u bi izlazno polje
// zasenilo istoimenu kolonu i `on conflict (day)` bi pukao. Prefiks znači
// Pacific Time, što je i jedina zona po kojoj se ovaj brojač resetuje.

type ConsumeRow = {
  ok: boolean;
  reason: "consumed" | "daily_cap" | "monthly_cap" | "exhausted";
  pt_day: string;
  pt_month: string;
  day_calls: number;
  month_calls: number;
  retry_after: string | null;
};

type StatusRow = {
  pt_day: string;
  pt_month: string;
  day_calls: number;
  month_calls: number;
  exhausted: boolean;
  kinds: Record<string, number>;
  daily_cap: number;
  monthly_cap: number;
  day_remaining: number;
  month_remaining: number;
  days_left: number;
};

type DayRow = {
  pt_day: string;
  pt_month: string;
  day_calls: number;
  month_calls: number;
  exhausted_at: string | null;
};

function stateFromDay(r: DayRow): BudgetState {
  return {
    day: r.pt_day,
    month: r.pt_month,
    calls: r.day_calls,
    monthCalls: r.month_calls,
    exhausted: r.exhausted_at !== null,
    byKind: {},
  };
}

/**
 * Sve tri funkcije vraćaju `table (...)`, pa supabase-js vraća niz od tačno
 * jednog reda. Prazan niz znači da je funkcija pukla tiho — tretiraj kao grešku.
 */
async function rpcOne<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);

  if (error) {
    throw new Error(
      `Budžet nije dostupan (${fn}): ${error.message}\n` +
        `Bez brojača se Google ne zove — proveri NEXT_PUBLIC_SUPABASE_URL i ` +
        `SUPABASE_SERVICE_ROLE_KEY, pa da li je migracija 0002 puštena.`,
    );
  }

  const rows = (data ?? []) as T[];
  if (rows.length === 0) throw new Error(`Budžet: ${fn} nije vratio nijedan red.`);
  return rows[0] as T;
}

function stateFromStatus(r: StatusRow): BudgetState {
  return {
    day: r.pt_day,
    month: r.pt_month,
    calls: r.day_calls,
    monthCalls: r.month_calls,
    exhausted: r.exhausted,
    byKind: r.kinds ?? {},
  };
}

function stateFromConsume(r: ConsumeRow, exhausted: boolean): BudgetState {
  return {
    day: r.pt_day,
    month: r.pt_month,
    calls: r.day_calls,
    monthCalls: r.month_calls,
    exhausted,
    byKind: {}, // consume ne vraća raspodelu; nije potrebna u poruci o grešci
  };
}

// ─────────────────────────────────────────────────────────────
// Javni API
// ─────────────────────────────────────────────────────────────

export type BudgetStatus = BudgetState & {
  limit: number;
  remaining: number;
  monthLimit: number;
  monthRemaining: number;
  dailyPace: number; // koliko sme dnevno da mesec izdrži
};

export async function status(): Promise<BudgetStatus> {
  const r = await rpcOne<StatusRow>("api_budget_status", {
    p_daily_cap: dailyLimit(),
    p_monthly_cap: monthlyLimit(),
  });

  return {
    ...stateFromStatus(r),
    limit: r.daily_cap,
    monthLimit: r.monthly_cap,
    remaining: r.day_remaining,
    monthRemaining: r.month_remaining,
    dailyPace: Math.floor(r.month_remaining / Math.max(1, r.days_left)),
  };
}

/**
 * Pre-flight. Zovi pre scana da ne pukne na pola.
 *
 * Ovo NIJE rezervacija — između provere i prvog `consume()` može da prođe tuđi
 * poziv. Sprečava očigledan slučaj („traži 3, ostalo 1"), a stvarnu granicu drži
 * `consume()`, atomično u bazi.
 */
export async function assertAvailable(n: number, what = "operacija"): Promise<void> {
  const s = await status();

  if (s.exhausted) {
    throw new BudgetError(
      `Google kvota iscrpljena (429). Reset za ~${hoursUntilReset()}h.`,
      s,
      "exhausted",
      // [Faza 0, 0.1] bez retryAfter-a ovde scan gubi sva tri pokušaja i
      // konačno padne iako kvota samo čeka reset (K1).
      nextDayReset(),
    );
  }
  if (s.monthRemaining < n) {
    throw new BudgetError(
      `MESEČNI budžet: ostalo ${s.monthRemaining} od ${s.monthLimit}, ` +
        `${what} traži ${n}. Reset prvog u mesecu.`,
      s,
      "monthly",
      nextMonthReset(),
    );
  }
  if (s.limit - s.calls < n) {
    throw new BudgetError(
      `Dnevni limit: ${s.calls}/${s.limit}, ${what} traži ${n}. ` +
        `Mesečno ti je ostalo ${s.monthRemaining}. ` +
        `Ako ti stvarno treba danas: GOOGLE_DAILY_LIMIT=${s.calls + n + 10} pnpm scan ...`,
      s,
      "daily",
      nextDayReset(),
    );
  }
}

/**
 * Rezerviše JEDAN HTTP poziv. Zovi neposredno PRE fetcha, za svaku stranicu.
 *
 * Inkrement i provera oba capa se dešavaju u jednoj transakciji u bazi — zato
 * WORKER_CONCURRENCY=3 plus CLI u terminalu ne mogu zajedno da probiju 900.
 */
export async function consume(kind = "places:searchText"): Promise<BudgetState> {
  const r = await rpcOne<ConsumeRow>("consume_api_call", {
    p_kind: kind,
    p_daily_cap: dailyLimit(),
    p_monthly_cap: monthlyLimit(),
  });

  if (r.ok) return stateFromConsume(r, false);

  const retryAfter = r.retry_after ? new Date(r.retry_after) : undefined;
  const state = stateFromConsume(r, r.reason === "exhausted");

  switch (r.reason) {
    case "exhausted":
      throw new BudgetError(
        `Google kvota iscrpljena (429). Reset za ~${hoursUntilReset()}h.`,
        state,
        "exhausted",
        retryAfter,
      );
    case "monthly_cap":
      throw new BudgetError(
        `Mesečni budžet potrošen: ${r.month_calls}/${monthlyLimit()}. ` +
          `Reset prvog u mesecu.`,
        state,
        "monthly",
        retryAfter,
      );
    case "daily_cap":
      throw new BudgetError(
        `Dnevni limit dostignut: ${r.day_calls}/${dailyLimit()}. ` +
          `Reset za ~${hoursUntilReset()}h.`,
        state,
        "daily",
        retryAfter,
      );
    default:
      // Baza je vratila razlog koji ovaj kod ne poznaje — migracija je novija
      // od klijenta. Padni zatvoreno: Google se ne zove.
      throw new BudgetError(
        `Budžet je odbio poziv iz nepoznatog razloga: ${String(r.reason)}`,
        state,
      );
  }
}

/** Na 429 od Googlea. Zaključava PT dan. */
export async function markExhausted(): Promise<BudgetState> {
  return stateFromDay(await rpcOne<DayRow>("mark_api_exhausted", {}));
}

/** Jedan red za CLI ispis. */
export async function budgetSummary(): Promise<string> {
  const s = await status();
  const tail = s.exhausted ? " · ISCRPLJENO (429)" : "";
  return (
    `dan ${s.calls}/${s.limit} · ` +
    `mesec ${s.monthCalls}/${s.monthLimit} ` +
    `(ostalo ${s.monthRemaining}, tempo ${s.dailyPace}/dan)${tail}`
  );
}

// ── sinhronizacija sa Google Cloud konzolom ─────────────────
// `setMonthCalls` je nestao sa prelaskom na bazu: mesec više nije brojač nego
// zbir po danima, pa se ispravlja upisom stvarnih dnevnih vrednosti.

export async function setCalls(n: number, day?: string): Promise<BudgetState> {
  return stateFromDay(
    await rpcOne<DayRow>("set_api_day_calls", {
      p_calls: n,
      p_day: day ?? null,
      p_clear_exhausted: false,
    }),
  );
}

/** Skida katanac posle 429 koji se pokazao kao prolazan. Brojač ostaje. */
export async function clearExhausted(day?: string): Promise<BudgetState> {
  return stateFromDay(
    await rpcOne<DayRow>("set_api_day_calls", {
      p_calls: null,
      p_day: day ?? null,
      p_clear_exhausted: true,
    }),
  );
}
