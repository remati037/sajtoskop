// apps/worker/test/api-budget.ts
// Pokretanje: pnpm --filter worker test  (ili `pnpm test` iz korena)
//
// [Faza 0, 0.1] `BudgetError` mora da nosi `retryAfter` da bi worker scan
// odložio do reset kvote umesto da potroši sva tri pokušaja i padne (K1).
// Ovi helperi računaju taj trenutak u LA zoni; poređenje sa SQL funkcijama
// baze (`budget_next_day_reset` / `budget_next_month_reset`) stoji u
// `pnpm check:sql` — ovde se drži sama logika koračanja.

import { budgetDay, budgetMonth, nextDayReset, nextMonthReset } from "../src/lib/api-budget";

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

const at = (s: string) => new Date(s).getTime();

// Dnevni reset je uvek ponoć sledećeg LA dana, ne 24h unapred — 05:00 PDT je
// usred LA dana, pa reset pada na 07:00Z sutradan (ponoć po LA).
const r1 = nextDayReset(new Date("2026-08-09T12:00:00Z"));
check(budgetDay(r1) === "2026-08-10", `nextDayReset prelazi u sledeći LA dan (${budgetDay(r1)})`);
check(
  r1.getTime() === at("2026-08-10T07:00:00Z"),
  `reset je tačno ponoć po LA (${r1.toISOString()})`,
);

// Kasno uveče po LA (16:00 PDT) i dalje vraća sutra, ne prekosutra.
const r2 = nextDayReset(new Date("2026-08-09T23:00:00Z"));
check(budgetDay(r2) === "2026-08-10", `kasno uveče → i dalje sutra (${budgetDay(r2)})`);

// DST: 8. mart 2026 u 02:00 LA ne postoji (02:00 → 03:00), dan traje 23h, ali
// reset ostaje ponoć — 08:00Z, dok je još PST.
const spring = nextDayReset(new Date("2026-03-07T12:00:00Z"));
check(
  spring.getTime() === at("2026-03-08T08:00:00Z"),
  `martovski reset je 08:00Z (PST, pre DST) — ${spring.toISOString()}`,
);

// Mesečni reset: prvi sledećeg LA meseca.
const m1 = nextMonthReset(new Date("2026-08-15T10:00:00Z"));
check(budgetMonth(m1) === "2026-09", `nextMonthReset prelazi u septembar (${budgetMonth(m1)})`);

// Prelazak na zimsko računanje (1. novembar) ne pomera mesečni reset.
const m2 = nextMonthReset(new Date("2026-10-31T12:00:00Z"));
check(budgetMonth(m2) === "2026-11", `oktobar → novembar (${budgetMonth(m2)})`);

// Mesečni reset je uvek posle dnevnog — worker ne sme da dobije obrnuti redosled.
check(nextMonthReset().getTime() > nextDayReset().getTime(), "monthly reset je posle daily reseta");

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
