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
 * Stanje: .cache/api-budget.json (gitignore)
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────
// Konfiguracija
// ─────────────────────────────────────────────────────────────

/** Override za testove: BUDGET_STATE_PATH=/tmp/x.json */
function statePath(): string {
  return (
    process.env.BUDGET_STATE_PATH ??
    join(process.cwd(), ".cache", "api-budget.json")
  );
}

function num(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 0) throw new Error(`Nevalidan limit: ${raw}`);
  return n;
}

/** TVRDA granica. Ispod Googleovog besplatnog praga za Enterprise SKU (1.000). */
export function monthlyLimit(): number {
  return num(process.env.GOOGLE_MONTHLY_LIMIT, 900);
}

/** MEKA granica — zaštita od odbeglog skripta, ne budžet. */
export function dailyLimit(): number {
  return num(process.env.GOOGLE_DAILY_LIMIT, 80);
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

/** Dan po kome Google resetuje dnevnu kvotu. Format YYYY-MM-DD. */
export function budgetDay(d: Date = new Date()): string {
  return PT_DAY_FMT.format(d);
}

/** Mesec po kome Google resetuje besplatni prag. Format YYYY-MM. */
export function budgetMonth(d: Date = new Date()): string {
  return budgetDay(d).slice(0, 7);
}

/** Sati do reseta dnevne kvote. */
export function hoursUntilReset(d: Date = new Date()): number {
  const today = budgetDay(d);
  for (let i = 1; i <= 30; i++) {
    if (budgetDay(new Date(d.getTime() + i * 3_600_000)) !== today) return i;
  }
  return 24;
}

/** Koliko dana ostaje u mesecu, uključujući današnji. Za tempo potrošnje. */
export function daysLeftInMonth(d: Date = new Date()): number {
  const month = budgetMonth(d);
  let days = 0;
  for (let i = 1; i <= 32; i++) {
    if (budgetMonth(new Date(d.getTime() + i * 86_400_000)) !== month) break;
    days++;
  }
  return days + 1;
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

export class BudgetError extends Error {
  constructor(
    message: string,
    public readonly state: BudgetState,
  ) {
    super(message);
    this.name = "BudgetError";
  }
}

function emptyState(
  day = budgetDay(),
  month = budgetMonth(),
  monthCalls = 0,
): BudgetState {
  return { day, month, calls: 0, monthCalls, exhausted: false, byKind: {} };
}

function read(): BudgetState {
  let s: BudgetState;
  try {
    const p = JSON.parse(readFileSync(statePath(), "utf8"));
    s = {
      day: String(p.day ?? ""),
      month: String(p.month ?? ""),
      calls: Number(p.calls ?? 0),
      monthCalls: Number(p.monthCalls ?? 0),
      exhausted: Boolean(p.exhausted),
      byKind: p.byKind ?? {},
    };
  } catch {
    return emptyState();
  }

  const month = budgetMonth();
  if (s.month !== month) return emptyState(budgetDay(), month, 0); // nov mesec

  const day = budgetDay();
  if (s.day !== day) return emptyState(day, month, s.monthCalls); // nov dan, mesec ostaje

  return s;
}

function write(s: BudgetState): void {
  const p = statePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
  renameSync(tmp, p); // atomično
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

export function status(): BudgetStatus {
  const s = read();
  const limit = dailyLimit();
  const monthLimit = monthlyLimit();
  const monthRemaining = Math.max(0, monthLimit - s.monthCalls);
  return {
    ...s,
    limit,
    monthLimit,
    monthRemaining,
    remaining: s.exhausted
      ? 0
      : Math.min(Math.max(0, limit - s.calls), monthRemaining),
    dailyPace: Math.floor(monthRemaining / daysLeftInMonth()),
  };
}

/** Pre-flight. Zovi pre scana da ne pukne na pola. */
export function assertAvailable(n: number, what = "operacija"): void {
  const s = status();

  if (s.exhausted) {
    throw new BudgetError(
      `Google kvota iscrpljena (429). Reset za ~${hoursUntilReset()}h.`,
      s,
    );
  }
  if (s.monthRemaining < n) {
    throw new BudgetError(
      `MESEČNI budžet: ostalo ${s.monthRemaining} od ${s.monthLimit}, ` +
        `${what} traži ${n}. Reset prvog u mesecu.`,
      s,
    );
  }
  if (s.limit - s.calls < n) {
    throw new BudgetError(
      `Dnevni limit: ${s.calls}/${s.limit}, ${what} traži ${n}. ` +
        `Mesečno ti je ostalo ${s.monthRemaining}. ` +
        `Ako ti stvarno treba danas: GOOGLE_DAILY_LIMIT=${s.calls + n + 10} pnpm scan ...`,
      s,
    );
  }
}

/** Rezerviše JEDAN HTTP poziv. Zovi neposredno PRE fetcha, za svaku stranicu. */
export function consume(kind = "places:searchText"): BudgetState {
  const s = read();
  const limit = dailyLimit();
  const monthLimit = monthlyLimit();

  if (s.exhausted) {
    throw new BudgetError(
      `Google kvota iscrpljena (429). Reset za ~${hoursUntilReset()}h.`,
      s,
    );
  }
  if (s.monthCalls >= monthLimit) {
    throw new BudgetError(
      `Mesečni budžet potrošen: ${s.monthCalls}/${monthLimit}. Reset prvog u mesecu.`,
      s,
    );
  }
  if (s.calls >= limit) {
    throw new BudgetError(
      `Dnevni limit dostignut: ${s.calls}/${limit}. Reset za ~${hoursUntilReset()}h.`,
      s,
    );
  }

  s.calls += 1;
  s.monthCalls += 1;
  s.byKind[kind] = (s.byKind[kind] ?? 0) + 1;
  write(s); // upis PRE fetcha
  return s;
}

/** Na 429 od Googlea. Zaključava PT dan. */
export function markExhausted(): BudgetState {
  const s = read();
  s.exhausted = true;
  write(s);
  return s;
}

/** Jedan red za CLI ispis. */
export function budgetSummary(): string {
  const s = status();
  const tail = s.exhausted ? " · ISCRPLJENO (429)" : "";
  return (
    `dan ${s.calls}/${s.limit} · ` +
    `mesec ${s.monthCalls}/${s.monthLimit} ` +
    `(ostalo ${s.monthRemaining}, tempo ${s.dailyPace}/dan)${tail}`
  );
}

// ── sinhronizacija sa Google Cloud konzolom ─────────────────

export function setCalls(n: number): BudgetState {
  const s = read();
  s.calls = n;
  write(s);
  return s;
}

export function setMonthCalls(n: number): BudgetState {
  const s = read();
  s.monthCalls = n;
  write(s);
  return s;
}

/** Samo za testove i za pokvareno stanje. Briše i mesečni brojač. */
export function reset(): BudgetState {
  const s = emptyState();
  write(s);
  return s;
}