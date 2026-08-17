// scripts/validate-migrations.ts
// Pokreće sve migracije iz `supabase/migrations/` u Postgresu koji radi u WASM-u
// (PGlite) i proverava da rade ono što treba. Pokretanje: `pnpm check:sql`
//
// Zašto ne `supabase start`: on traži Docker. Ovo traži samo Node i radi za sekundu,
// pa može u CI i u pre-push naviku bez ijedne pripreme.
//
// Šta OVO NE proverava, jer PGlite nije Supabase:
//   - stvarno ponašanje `auth.jwt()` sa Clerk tokenom (ovde je shim)
//   - da li RLS politike zaista blokiraju anon ključ preko PostgREST-a
//   - trku nad `FOR UPDATE` — PGlite ima jednu konekciju
// Te tri stvari proverava `pnpm check:f1` nad pravom bazom.

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Prava implementacija, ne kopija: cela poenta provere je da se TS i SQL slažu
// oko LA dana. Uvoz ne dodiruje bazu — `supabaseAdmin()` je lenj.
import { budgetDay, nextDayReset, nextMonthReset } from "../apps/worker/src/lib/api-budget";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");

let failed = 0;

function check(ok: boolean, msg: string, extra?: string): void {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${msg}${extra ? `  ${extra}` : ""}`);
}

const db = new PGlite();

async function one<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

async function mustFail(sql: string, msg: string): Promise<void> {
  try {
    await db.exec(sql);
    check(false, msg, "prošlo, a nije smelo");
  } catch {
    check(true, msg);
  }
}

async function main(): Promise<void> {
  // Supabase stvari koje PGlite nema.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb language sql stable
      as $$ select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $$;
  `);

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.error(`Nema migracija u ${migrationsDir}`);
    process.exit(1);
  }

  // Dva prolaza: migracije moraju da budu idempotentne da bi se smele ponoviti.
  for (const pass of [1, 2]) {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      try {
        await db.exec(sql);
        check(true, `${file}${pass === 2 ? " (drugi prolaz)" : ""}`);
      } catch (err) {
        check(false, `${file}${pass === 2 ? " (drugi prolaz)" : ""}`, String(err));
        process.exit(1);
      }
    }
  }

  console.log("\nRLS");
  for (const t of ["profiles", "businesses", "website_audits", "unlocks",
                   "credit_ledger", "searches", "job_queue", "api_budget",
                   "job_subscribers", "search_cache", "feedback",
                   "feedback_prompts", "changelog", "admin_audit",
                   "request_limits", "webhook_events",
                   "lead_status", "outreach_messages", "signed_events"]) {
    const r = await one<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = $1`, [t]);
    check(r?.relrowsecurity === true, `uključen na ${t}`);
  }

  console.log("\nOgraničenja");
  await db.exec(`insert into profiles (id, email, credits_balance) values ('u1','a@b.rs',5)`);
  await mustFail(`update profiles set credits_balance = -1 where id='u1'`, "negativan balans odbijen");
  await mustFail(`insert into businesses (place_id, city_slug, name, phone_type) values ('x','nis','X','sms')`, "nepoznat phone_type odbijen");
  await mustFail(`insert into businesses (place_id, city_slug, name, country_code) values ('x','nis','X','srb')`, "neispravan country_code odbijen");

  await db.exec(`insert into businesses (place_id, city_slug, name) values ('p1','nis','Firma 1'), ('p2','nis','Firma 2')`);
  await mustFail(`insert into website_audits (place_id, site_status) values ('p1','ziv')`, "nepoznat site_status odbijen");
  await mustFail(`insert into website_audits (place_id, site_status, ugly_score) values ('p1','nema_sajt',60)`, "skor uz status bez sajta odbijen");
  await mustFail(`insert into website_audits (place_id, site_status, ugly_score) values ('p1','ok',120)`, "skor van 0-100 odbijen");
  await db.exec(`insert into website_audits (place_id, site_status, ugly_score, ugly_band) values ('p1','ok',55,'ruzan')`);
  await mustFail(`insert into website_audits (place_id, site_status) values ('p1','ok')`, "drugi audit za isti place_id odbijen");
  await mustFail(`insert into job_queue (type, payload) values ('bilo_sta','{}')`, "nepoznat tip posla odbijen");
  await mustFail(`insert into credit_ledger (user_id, delta, reason) values ('u1',1,'poklon')`, "nepoznat razlog u ledgeru odbijen");

  console.log("\nspend_credit_and_unlock");
  type Rpc = { ok: boolean; reason: string };
  const spend = (u: string, p: string) =>
    one<Rpc>(`select * from spend_credit_and_unlock($1,$2)`, [u, p]);
  const balance = async () =>
    (await one<{ credits_balance: number }>(`select credits_balance from profiles where id='u1'`))?.credits_balance;

  check((await spend("nema_ga", "p1"))?.reason === "no_user", "nepostojeći korisnik → no_user");
  check((await spend("u1", "nema_ga"))?.reason === "no_place", "nepostojeći lead → no_place");
  check((await spend("u1", "p1"))?.reason === "unlocked", "prvi unlock → unlocked");
  check((await balance()) === 4, "balans umanjen za 1");
  check((await spend("u1", "p1"))?.reason === "already_unlocked", "isti lead drugi put → already_unlocked");
  check((await balance()) === 4, "drugi put ne naplaćuje");

  await db.exec(`update profiles set credits_balance = 0 where id='u1'`);
  check((await spend("u1", "p2"))?.reason === "insufficient_credits", "bez kredita → insufficient_credits");

  console.log("\ngrant_credits");
  const grant = (a: number, r: string, ref: string | null) =>
    one<Rpc>(`select * from grant_credits('u1',$1,$2,$3)`, [a, r, ref]);

  check((await grant(0, "monthly_grant", null))?.reason === "invalid_amount", "dodela 0 kredita odbijena");
  check((await grant(5, "unlock", null))?.reason === "invalid_reason", "razlog 'unlock' odbijen");
  check((await grant(30, "monthly_grant", "r1"))?.reason === "granted", "prva dodela → granted");
  check((await grant(30, "monthly_grant", "r1"))?.reason === "already_granted", "ista dodela drugi put → already_granted");
  check((await balance()) === 30, "dodato tačno 30, ne 60");

  console.log("\ncreate_profile_with_grant");
  const cpg = (u: string) =>
    one<Rpc>(`select * from create_profile_with_grant($1,'x@y.rs',30,$2)`, [u, `signup:${u}`]);
  check((await cpg("u2"))?.reason === "created", "novi profil → created");
  check((await cpg("u2"))?.reason === "existing", "ponovljen webhook → existing");
  const u2 = await one<{ credits_balance: number }>(`select credits_balance from profiles where id='u2'`);
  check(u2?.credits_balance === 30, "ponovljen webhook ne daje 60 kredita");

  // ── 0002: budžet Google poziva ──────────────────────────
  // Ovde se proverava baš ono zbog čega je brojač i otišao iz fajla u bazu:
  // da capovi zaista zaustave poziv i da se LA dan računa isto u SQL-u i u TS-u.

  console.log("\nbudget_day — LA dan");
  type DayCheck = { sql_day: string };
  const sqlDay = await one<DayCheck>(`select budget_day()::text as sql_day`);
  check(sqlDay?.sql_day === budgetDay(), `SQL ${sqlDay?.sql_day} = TS ${budgetDay()}`);

  // Prelazak dana po LA, ne po UTC: 2026-08-09 06:30Z je još 8. avgust u LA.
  const beforeMidnight = await one<DayCheck>(
    `select budget_day('2026-08-09T06:30:00Z'::timestamptz)::text as sql_day`);
  check(beforeMidnight?.sql_day === "2026-08-08", `06:30Z → ${beforeMidnight?.sql_day} (PDT, još juče)`);

  const afterMidnight = await one<DayCheck>(
    `select budget_day('2026-08-09T07:30:00Z'::timestamptz)::text as sql_day`);
  check(afterMidnight?.sql_day === "2026-08-09", `07:30Z → ${afterMidnight?.sql_day} (PDT, nov dan)`);

  // Zimi je pomak 8h, ne 7h — ista granica pada na drugi UTC sat.
  const winter = await one<DayCheck>(
    `select budget_day('2026-12-09T07:30:00Z'::timestamptz)::text as sql_day`);
  check(winter?.sql_day === "2026-12-08", `zimi 07:30Z → ${winter?.sql_day} (PST, još juče)`);

  // ── Faza 0 (0.1): retryAfter na pre-flight odbijanju ────
  // `BudgetError` iz `assertAvailable` nosi `retryAfter` koji računa TS
  // (`nextDayReset`/`nextMonthReset`). Baza ima istu funkciju; ovde se poredi
  // da se dve implementacije ne raziđu — pogrešan `run_after` znači scan koji
  // se budi pre reseta kvote i troši pokušaje (K1).

  console.log("\nreset kvote — TS i SQL se slažu (Faza 0, 0.1)");
  type Reset = { ms: number };
  const sqlResetMs = (expr: string) =>
    one<Reset>(`select (extract(epoch from ${expr}) * 1000)::bigint as ms`);

  const dayMs = await sqlResetMs("budget_next_day_reset(budget_day())");
  check(
    dayMs?.ms === nextDayReset().getTime(),
    `nextDayReset TS = SQL (${new Date(dayMs?.ms ?? 0).toISOString()})`,
  );

  const monthMs = await sqlResetMs("budget_next_month_reset(budget_day())");
  check(
    monthMs?.ms === nextMonthReset().getTime(),
    `nextMonthReset TS = SQL (${new Date(monthMs?.ms ?? 0).toISOString()})`,
  );

  // Prelazak dana po LA, ne po UTC: 06:30Z je još juče u LA, pa reset pada na
  // ponoć SUTRAŠNJEG LA dana.
  const beforeMidnightReset = await sqlResetMs(
    `budget_next_day_reset(budget_day('2026-08-09T06:30:00Z'::timestamptz))`);
  check(
    beforeMidnightReset?.ms === nextDayReset(new Date("2026-08-09T06:30:00Z")).getTime(),
    "nextDayReset pre LA ponoći → sledeći LA dan",
  );

  // Prelazak na letnje vreme (8. mart 2026, 02:00 → 03:00): sat koračanja
  // preleće promenu bez pomeranja rezultata.
  const spring = await sqlResetMs(
    `budget_next_day_reset(budget_day('2026-03-07T12:00:00Z'::timestamptz))`);
  check(
    spring?.ms === nextDayReset(new Date("2026-03-07T12:00:00Z")).getTime(),
    "nextDayReset preleće DST promenu (mart 2026)",
  );

  console.log("\nconsume_api_call");
  type Consume = {
    ok: boolean; reason: string; day_calls: number; month_calls: number;
    retry_after: string | null;
  };
  const consume = (daily = 3, monthly = 900, kind = "places:searchText") =>
    one<Consume>(`select * from consume_api_call($1,$2,$3)`, [kind, daily, monthly]);

  check((await consume())?.reason === "consumed", "prvi poziv → consumed");
  await consume();
  const third = await consume();
  check(third?.day_calls === 3, `treći poziv → day_calls ${third?.day_calls}`);

  const overDaily = await consume();
  check(overDaily?.ok === false && overDaily.reason === "daily_cap", "četvrti uz cap 3 → daily_cap");
  check(overDaily?.retry_after !== null, "daily_cap nosi retry_after");

  // Dnevni cap ne sme da inkrementira brojač — odbijen poziv nije potrošen poziv.
  const afterReject = await one<{ calls: number }>(
    `select calls from api_budget where day = budget_day()`);
  check(afterReject?.calls === 3, `odbijen poziv ne broji: calls ${afterReject?.calls}`);

  const overMonthly = await consume(100, 3);
  check(overMonthly?.reason === "monthly_cap", "mesečni cap → monthly_cap");
  const at = (v: string | null | undefined): number =>
    v ? new Date(String(v)).getTime() : 0;
  check(
    at(overMonthly?.retry_after) > at(overDaily?.retry_after),
    "monthly_cap se odlaže dalje od daily_cap (prvi u mesecu, ne sutra)",
  );

  const byKind = await one<{ by_kind: Record<string, number> }>(
    `select by_kind from api_budget where day = budget_day()`);
  check(byKind?.by_kind["places:searchText"] === 3, "by_kind broji po SKU-u");

  console.log("\nmark_api_exhausted");
  await db.exec(`select mark_api_exhausted()`);
  const locked = await consume(100, 900);
  check(locked?.reason === "exhausted", "posle 429 svaki poziv → exhausted");

  await db.exec(`select set_api_day_calls(null, null, true)`);
  check((await consume(100, 900))?.reason === "consumed", "set_api_day_calls skida katanac");

  // ── 0005: PSI i Claude imaju svoj brojač ────────────────
  // Jedina stvar koju ovaj blok stvarno čuva: da otključavanje leada ne troši
  // Googleovu mesečnu kvotu. Ako `calls` ovde mrdne, mesečni cap od 1.000
  // Places poziva tiho postane cap na broj unlockova.

  console.log("\nconsume_side_call");
  type Side = { ok: boolean; reason: string; kind_calls: number; retry_after: string | null };
  const side = (kind: string, cap: number) =>
    one<Side>(`select * from consume_side_call($1,$2)`, [kind, cap]);

  const googleBefore = await one<{ calls: number }>(
    `select calls from api_budget where day = budget_day()`);

  check((await side("psi:mobile", 2))?.reason === "consumed", "prvi PSI poziv → consumed");
  check((await side("psi:mobile", 2))?.kind_calls === 2, "drugi PSI poziv → kind_calls 2");
  const psiOver = await side("psi:mobile", 2);
  check(psiOver?.ok === false && psiOver.reason === "daily_cap", "treći uz cap 2 → daily_cap");
  check(psiOver?.retry_after !== null, "daily_cap nosi retry_after");

  // Capovi su po ključu: iscrpljen PSI ne sme da zaustavi Claude analizu.
  check((await side("ai:audit", 1))?.ok === true, "drugi ključ ima svoj cap");

  const googleAfter = await one<{ calls: number }>(
    `select calls from api_budget where day = budget_day()`);
  check(
    googleAfter?.calls === googleBefore?.calls,
    `PSI i AI ne diraju Googleov brojač (calls ${googleBefore?.calls} → ${googleAfter?.calls})`,
  );

  const sideKinds = await one<{ by_kind: Record<string, number> }>(
    `select by_kind from api_budget where day = budget_day()`);
  check(sideKinds?.by_kind["psi:mobile"] === 2, "by_kind broji PSI odvojeno");
  check(sideKinds?.by_kind["ai:audit"] === 1, "by_kind broji AI odvojeno");

  await mustFail(
    `select consume_side_call('places:searchText', 100)`,
    "Places ključ kroz side brojač odbijen",
  );

  // ── 0006: zastavica „sajt je uredan" ────────────────────
  console.log("\nai_solidan");
  await mustFail(
    `update website_audits set ai_solidan = true where place_id = 'p1'`,
    "ai_solidan bez ai_issues odbijen",
  );
  await db.exec(
    `update website_audits set ai_issues = '[]'::jsonb, ai_solidan = true where place_id = 'p1'`,
  );
  const solidan = await one<{ ai_solidan: boolean }>(
    `select ai_solidan from website_audits where place_id = 'p1'`,
  );
  check(solidan?.ai_solidan === true, "uredan sajt sme da ima praznu listu stavki");

  // ── 0003: red poslova ───────────────────────────────────

  console.log("\nenqueue_job i dedup");
  type Enq = { job_id: number; joined: boolean };
  const enq = (key: string | null, user: string | null, type = "scan") =>
    one<Enq>(`select * from enqueue_job($1, '{"citySlug":"sabac"}'::jsonb, $2, $3)`,
             [type, key, user]);

  const j1 = await enq("RS:sabac:pvc-stolarija", "u1");
  check(j1?.joined === false, "prvi upis → nov posao");
  const j2 = await enq("RS:sabac:pvc-stolarija", "u2");
  check(j2?.joined === true && j2.job_id === j1?.job_id, "isti ključ → prikačen na postojeći");

  const subs = await one<{ n: number }>(
    `select count(*)::int as n from job_subscribers where job_id = $1`, [j1?.job_id]);
  check(subs?.n === 2, `oba korisnika pretplaćena (${subs?.n})`);

  console.log("\nclaim_job");
  type Job = { id: number; type: string; status: string; attempts: number };
  const claimed = await one<Job>(`select * from claim_job()`);
  check(claimed?.id === j1?.job_id, "preuzet najstariji pending");
  check(claimed?.status === "running" && claimed.attempts === 1, "status running, attempts 1");
  check((await one<Job>(`select * from claim_job()`)) === undefined, "nema drugog posla → prazno");

  // Isti ključ sme ponovo tek kad prethodni završi.
  const whileRunning = await enq("RS:sabac:pvc-stolarija", "u1");
  check(whileRunning?.joined === true, "dedup važi i dok posao radi");

  console.log("\nfail_job — backoff");
  type Fail = { final: boolean; next_run: string | null };
  const f1 = await one<Fail>(`select * from fail_job($1, 'pukao')`, [j1?.job_id]);
  check(f1?.final === false && f1.next_run !== null, "prvi pad → pending sa backoff-om");

  // [Faza 0, 0.2] Statusna zaštita: fail_job viđa samo `running` poslove.
  // Posao koji je već pao (pending sa backoff-om) se ne dira — bez toga bi
  // mrežna greška posle `complete_job` vratila gotov posao u red.
  const f1b = await one<Fail>(`select * from fail_job($1, 'posle pada')`, [j1?.job_id]);
  const f1Row = await one<{ status: string; last_error: string }>(
    `select status, last_error from job_queue where id = $1`, [j1?.job_id]);
  check(
    f1b?.final === true && f1Row?.status === "pending" && f1Row.last_error === "pukao",
    "fail na već palom poslu je no-op (0.2)",
  );

  // Stari test: running posao koji iscrpi pokušaje → failed. Posao se prvo
  // vrati u `running` (run_after u prošlost, pa ga claim_job preuzme).
  await db.exec(`update job_queue set run_after = now() where id = ${j1?.job_id}`);
  await db.exec(`select claim_job()`);
  await db.exec(`update job_queue set attempts = max_attempts where id = ${j1?.job_id}`);
  const f2 = await one<Fail>(`select * from fail_job($1, 'opet')`, [j1?.job_id]);
  check(f2?.final === true, "posle max_attempts → failed");
  const failedRow = await one<{ status: string; last_error: string }>(
    `select status, last_error from job_queue where id = $1`, [j1?.job_id]);
  check(failedRow?.status === "failed" && failedRow.last_error === "opet", "last_error sačuvan");

  // Tek sad, kad je posao mrtav, isti ključ pravi nov posao.
  const afterFail = await enq("RS:sabac:pvc-stolarija", "u1");
  check(afterFail?.joined === false, "završen posao oslobađa dedup ključ");

  console.log("\ndefer_job — budžet ne troši pokušaje");
  await db.exec(`select claim_job()`);
  const beforeDefer = await one<{ attempts: number }>(
    `select attempts from job_queue where id = $1`, [afterFail?.job_id]);
  await db.exec(`select defer_job(${afterFail?.job_id}, now() + interval '1 day', 'dnevni limit')`);
  const afterDefer = await one<{ attempts: number; status: string }>(
    `select attempts, status from job_queue where id = $1`, [afterFail?.job_id]);
  check(
    afterDefer?.attempts === (beforeDefer?.attempts ?? 1) - 1 && afterDefer?.status === "pending",
    `odloženi posao vraća attempts ${beforeDefer?.attempts} → ${afterDefer?.attempts}`,
  );

  // [Faza 0, 0.2] defer_job takođe viđa samo `running` poslove. Posao koji je
  // već odložen (pending) se ne dira — kasno stiglo odlaganje ne sme da
  // produži run_after gotovog posla.
  const beforeDeferNoop = await one<{ attempts: number; status: string }>(
    `select attempts, status from job_queue where id = $1`, [afterFail?.job_id]);
  await db.exec(`select defer_job(${afterFail?.job_id}, now() + interval '2 days', 'ne treba')`);
  const afterDeferNoop = await one<{ attempts: number; status: string }>(
    `select attempts, status from job_queue where id = $1`, [afterFail?.job_id]);
  check(
    afterDeferNoop?.attempts === beforeDeferNoop?.attempts && afterDeferNoop?.status === "pending",
    "defer na poslu koji nije running je no-op (0.2)",
  );

  console.log("\ncomplete_job — statusna zaštita (0.2)");
  // Ceo scenarij „mrežna greška posle uspeha": posao se preuzme, kompletira,
  // pa fail_job i defer_job stignu KASNO. Sve troje mora da ostavi posao `done`.
  const jc = await enq("RS:sabac:complete-test", null);
  await db.exec(`select claim_job()`);
  await db.exec(`select complete_job(${jc?.job_id})`);
  const doneRow = await one<{ status: string; finished_at: string }>(
    `select status, finished_at from job_queue where id = $1`, [jc?.job_id]);
  check(doneRow?.status === "done" && doneRow.finished_at !== null, "running posao → done");

  await db.exec(`select fail_job(${jc?.job_id}, 'kasno stigla greška')`);
  await db.exec(`select defer_job(${jc?.job_id}, now() + interval '1 day', 'kasno odlaganje')`);
  const afterLate = await one<{ status: string }>(
    `select status from job_queue where id = $1`, [jc?.job_id]);
  check(afterLate?.status === "done", "fail/defer posle done su no-op — posao ostaje done (0.2)");

  // Ponovljen complete_job ne pomera finished_at — posao se ne „restartuje".
  const atMs = (v: string | Date | null | undefined): number =>
    v ? new Date(v).getTime() : 0;
  await db.exec(`select complete_job(${jc?.job_id})`);
  const finishedAgain = await one<{ finished_at: string }>(
    `select finished_at from job_queue where id = $1`, [jc?.job_id]);
  check(
    atMs(finishedAgain?.finished_at) === atMs(doneRow?.finished_at),
    "ponovljen complete_job ne menja finished_at (0.2)",
  );

  console.log("\nreap_stuck_jobs");
  await db.exec(`
    insert into job_queue (type, payload, status, attempts, locked_at)
    values ('enrich_basic', '{"placeId":"p1"}', 'running', 1, now() - interval '20 minutes'),
           ('enrich_basic', '{"placeId":"p2"}', 'running', 3, now() - interval '20 minutes'),
           ('enrich_basic', '{"placeId":"p3"}', 'running', 1, now())`);
  type Reap = { requeued: number; failed: number };
  const reaped = await one<Reap>(`select * from reap_stuck_jobs(15)`);
  check(reaped?.failed === 1, `bez pokušaja → failed (${reaped?.failed})`);
  check(reaped?.requeued === 1, `sa pokušajima → pending (${reaped?.requeued})`);
  const stillRunning = await one<{ n: number }>(
    `select count(*)::int as n from job_queue where status = 'running'`);
  check(stillRunning?.n === 1, "svež running posao nije diran");

  console.log("\nclaim_cache_miss");
  type Miss = { ok: boolean; reason: string; used: number; remaining: number };
  const miss = (u: string, lim: number) =>
    one<Miss>(`select * from claim_cache_miss($1,$2)`, [u, lim]);

  check((await miss("nema_ga", 10))?.reason === "no_user", "nepostojeći korisnik → no_user");
  check((await miss("u1", 2))?.remaining === 1, "prva pretraga → ostalo 1");
  check((await miss("u1", 2))?.remaining === 0, "druga pretraga → ostalo 0");
  const blocked = await miss("u1", 2);
  check(blocked?.ok === false && blocked.reason === "limit_reached", "treća → limit_reached");

  await db.exec(`select release_cache_miss('u1')`);
  check((await miss("u1", 2))?.ok === true, "release_cache_miss vraća jednu pretragu");

  // Brojač se resetuje po LA danu, ne po kalendaru korisnika.
  await db.exec(`update profiles set cache_miss_day = budget_day() - 1 where id = 'u1'`);
  const nextDay = await miss("u1", 2);
  check(nextDay?.used === 1, `nov LA dan resetuje brojač (used ${nextDay?.used})`);

  // ── F4: mesečna dodela bez rollovera ─────────────────────
  console.log("\ngrant_monthly_credits");
  type Grant = { ok: boolean; reason: string; delta: number };
  const mesecna = (u: string, target: number, ref: string) =>
    one<Grant>(`select * from grant_monthly_credits($1,$2,$3)`, [u, target, ref]);

  await db.exec(`update profiles set credits_balance = 12 where id = 'u1'`);
  const g1 = await mesecna("u1", 30, "2026-09");
  check(g1?.delta === 18, `12 → 30 upisuje delta 18  (${g1?.delta})`);

  // Poenta cele funkcije: reset, ne sabiranje. Rollover u besplatnoj beti znači
  // da neko ko se registrovao u avgustu ima 90 kredita u oktobru.
  const g2 = await mesecna("u1", 30, "2026-10");
  check(g2?.delta === 0 && g2.ok, "isti balans sledeći mesec → delta 0, bez rollovera");

  const g3 = await mesecna("u1", 30, "2026-10");
  check(g3?.reason === "already_granted", `ponovljen isti mesec → already_granted (${g3?.reason})`);

  // Nulta stavka MORA da postoji, inače idempotencija nema šta da uhvati.
  const nula = await one<{ n: number }>(
    `select count(*)::int as n from credit_ledger
     where user_id = 'u1' and reason = 'monthly_grant' and ref_id = '2026-10' and delta = 0`);
  check(nula?.n === 1, "nulta stavka je upisana u knjigu");

  await db.exec(`update profiles set credits_balance = 5 where id = 'u1'`);
  check((await mesecna("u1", 30, "2026-10"))?.delta === 0, "potrošeni krediti se NE vraćaju ponovljenim poslom");

  check((await mesecna("u1", 30, ""))?.reason === "missing_ref_id", "bez ref_id → odbijeno");
  check((await mesecna("nema_ga", 30, "2026-09"))?.reason === "no_user", "nepostojeći korisnik → no_user");

  // Invarijanta iz F4 §8, na profilu koji nijedan test nije dirao golim UPDATE-om:
  // registracija → otključavanje → mesečni reset, sve kroz funkcije.
  await db.exec(`select create_profile_with_grant('u3', 'c@d.rs', 30, 'signup:u3')`);
  await db.exec(`select spend_credit_and_unlock('u3', 'p1')`);
  await db.exec(`select grant_monthly_credits('u3', 30, '2026-11')`);
  const knjiga = await one<{ zbir: number; balans: number }>(
    `select (select coalesce(sum(delta),0) from credit_ledger where user_id = 'u3')::int as zbir,
            (select credits_balance from profiles where id = 'u3')::int as balans`);
  check(knjiga?.zbir === knjiga?.balans && knjiga?.balans === 30,
    `sum(delta) = credits_balance = 30  (${knjiga?.zbir} = ${knjiga?.balans})`);

  // ── F4: dnevni cap na export ─────────────────────────────
  console.log("\nclaim_export");
  type Export = { ok: boolean; reason: string; allowed: number; used: number };
  const exp = (u: string, lim: number, want: number) =>
    one<Export>(`select * from claim_export($1,$2,$3)`, [u, lim, want]);

  check((await exp("u1", 100, 30))?.allowed === 30, "prvi izvoz: traženo 30 → odobreno 30");
  const delimicno = await exp("u1", 100, 90);
  check(delimicno?.allowed === 70, `preko capa → delimično, ne odbijeno (${delimicno?.allowed})`);
  const pun = await exp("u1", 100, 10);
  check(pun?.ok === false && pun.reason === "limit_reached", "iscrpljen cap → limit_reached");

  await db.exec(`update profiles set export_day = budget_day() - 1 where id = 'u1'`);
  check((await exp("u1", 100, 10))?.allowed === 10, "nov LA dan resetuje brojač izvoza");

  // ── F9: naplata skeniranja i registar keša ───────────────
  // Ovde su sve četiri odluke o naplati iz F9 §0 napisane kao provere. Ako se
  // ijedna ikad promeni „usput", ovo pada pre nego što neko izgubi kredit.
  console.log("\nspend_credit_and_scan");
  type Scan = { ok: boolean; reason: string; job_id: number; joined: boolean;
                charged: boolean; credits_left: number };
  const scan = (u: string, c: string, n: string) =>
    one<Scan>(`select * from spend_credit_and_scan($1,'RS',$2,$3)`, [u, c, n]);

  await db.exec(`insert into profiles (id, email, credits_balance) values ('s1','s1@x.rs',3), ('s2','s2@x.rs',1)`);

  const prvi = await scan("s1", "beograd", "pvc-stolarija");
  check(prvi?.reason === "charged" && prvi.charged === true, "prvo skeniranje → charged");
  check(prvi?.credits_left === 2, "kredit skinut tačno jednom");

  const dupli = await scan("s1", "beograd", "pvc-stolarija");
  check(dupli?.reason === "already_paid" && dupli.charged === false, "dupli klik → bez druge naplate");
  check(dupli?.job_id === prvi?.job_id, "dupli klik se kači na isti posao");

  const drugi = await scan("s2", "beograd", "pvc-stolarija");
  check(drugi?.charged === true && drugi.joined === true,
    "drugi korisnik na istom poslu ipak plaća (F9 odluka 3)");

  check((await scan("s2", "nis", "stomatolog"))?.reason === "insufficient_credits",
    "bez kredita → insufficient_credits");
  check((await one<{ n: number }>(
    `select count(*)::int as n from job_queue where type='scan' and payload->>'citySlug'='nis'`))?.n === 0,
    "odbijena naplata NE upisuje posao");
  check((await scan("nema_ga", "nis", "stomatolog"))?.reason === "no_user", "nepoznat profil → no_user");

  console.log("\nrefund_scan");
  check((await one<{ refunded: number }>(
    `select * from refund_scan($1)`, [prvi?.job_id]))?.refunded === 2, "vraćeno obojici platilaca");
  check((await one<{ refunded: number }>(
    `select * from refund_scan($1)`, [prvi?.job_id]))?.refunded === 0, "drugi poziv ne vraća ponovo");
  check((await one<{ b: number }>(
    `select credits_balance as b from profiles where id='s1'`))?.b === 3, "balans s1 vraćen na 3");

  console.log("\nregistar keša");
  const stanje = (c: string, n: string) =>
    one<{ scanned_at: string | null; fresh: boolean; total: number; no_site: number }>(
      `select * from search_cache_state('RS',$1,$2)`, [c, n]);

  check((await stanje("kraljevo", "frizer"))?.scanned_at === null, "neskenirana kombinacija → bez datuma");

  await db.exec(`select record_scan('RS','beograd','pvc-stolarija',0,null)`);
  const prazna = await stanje("beograd", "pvc-stolarija");
  check(prazna?.fresh === true && prazna.total === 0,
    "prazan rezultat se pamti kao svež (F9 odluka 6)");

  await db.exec(`
    insert into businesses (place_id, city_slug, niche_slug, name) values
      ('f1','nis','stomatolog','Zubar A'), ('f2','nis','stomatolog','Zubar B');
    insert into website_audits (place_id, site_status) values ('f1','nema_sajt');
    select record_scan('RS','nis','stomatolog',2,null);
  `);
  const puna = await stanje("nis", "stomatolog");
  check(puna?.fresh === true && puna.total === 2 && puna.no_site === 1,
    "brojači za listu se čitaju iz stvarnog stanja baze");

  // Rupa u pravilu 1: Google vrati nulu za kombinaciju koja u bazi ima stare
  // redove. Ništa nije osveženo, pa se rok NE sme pomerati — inače bi zastareli
  // podaci bili proglašeni svežim na 30 dana.
  await db.exec(`
    update businesses set google_refreshed_at = now() - interval '90 days' where city_slug='nis';
    update search_cache set last_scanned_at = now() - interval '90 days' where city_slug='nis';
    select record_scan('RS','nis','stomatolog',0,null);
  `);
  check((await stanje("nis", "stomatolog"))?.fresh === false,
    "prazan odgovor nad starim redovima NE produžava rok (pravilo 1)");

  await db.exec(`insert into searches (user_id, country_code, city_slug, niche_slug, source)
                 values ('s1','RS','beograd','pvc-stolarija','api')`);
  const lista = await db.query<{ city_slug: string; fresh: boolean; mine: boolean }>(
    `select * from search_cache_overview('s1')`);
  check(lista.rows.length === 2, "pregled vraća i sveže i istekle kombinacije");
  check(lista.rows.find((r) => r.city_slug === "beograd")?.mine === true,
    "kombinacija iz istorije korisnika je označena kao njegova");
  check(lista.rows.find((r) => r.city_slug === "nis")?.mine === false, "tuđa kombinacija nije `mine`");

  // ── F10: utisci ──────────────────────────────────────────
  // Ograničenja tabele su druga brana ispod Zod šeme. Klijent koji zaobiđe formu
  // mora da udari u bazu, a ne da upiše `rating = 7` i tip „šta god".
  console.log("\nfeedback");
  await db.exec(`insert into profiles (id, email, credits_balance) values ('fb1','fb@x.rs',30)`);

  await mustFail(`insert into feedback (user_id, rating) values ('fb1', 0)`, "ocena 0 odbijena");
  await mustFail(`insert into feedback (user_id, rating) values ('fb1', 4)`, "ocena 4 odbijena");
  await mustFail(`insert into feedback (user_id, rating, kind) values ('fb1', 2, 'zalba')`, "nepoznat tip odbijen");
  await mustFail(`insert into feedback (user_id, rating, source) values ('fb1', 2, 'sms')`, "nepoznat izvor odbijen");
  await mustFail(
    `insert into feedback (user_id, rating, message) values ('fb1', 2, repeat('a', 2001))`,
    "poruka preko 2000 karaktera odbijena",
  );
  await mustFail(`insert into feedback (user_id, rating) values ('nema_ga', 2)`, "utisak bez profila odbijen");

  await db.exec(`
    insert into feedback (user_id, rating, kind, message, source, route, route_label)
    values ('fb1', 1, 'bug', 'Kredit je skinut, a nista se nije desilo.', 'dugme', '/pretraga', 'Pretraga')
  `);
  const utisak = await one<{ n: number; prazan: number }>(
    `select count(*)::int as n,
            count(*) filter (where ctx = '{}'::jsonb)::int as prazan
     from feedback where user_id = 'fb1'`);
  check(utisak?.n === 1, "ispravan utisak upisan");
  check(utisak?.prazan === 1, "ctx podrazumevano prazan objekat, ne null");

  // Nalog obrisan → utisci idu s njim. Mejlovi koji su već stigli ostaju kod
  // mene, ali to je pošta, ne baza (F10 §6).
  await db.exec(`delete from profiles where id = 'fb1'`);
  check(
    (await one<{ n: number }>(`select count(*)::int as n from feedback where user_id = 'fb1'`))?.n === 0,
    "brisanje naloga briše i utiske (on delete cascade)",
  );

  check(
    (await one<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
       where table_name = 'profiles' and column_name = 'feedback_prompted_at'`))?.n === 1,
    "profiles.feedback_prompted_at postoji",
  );

  // ── F11: motor utisaka ───────────────────────────────────
  // Ovde stoje tri stvari koje bi tiho pale: da zapis bez ijednog sadržaja ne
  // može da postoji, da `feedback` prolazi kroz `grant_credits` (telo funkcije,
  // ne samo `check`), i da ista nagrada ne može da se dodeli dvaput.
  console.log("\nF11 — feedback v2");
  await db.exec(`insert into profiles (id, email, credits_balance) values ('f11','f11@x.rs',5)`);

  await mustFail(
    `insert into feedback (user_id) values ('f11')`,
    "zapis bez ocene, odgovora i poruke odbijen",
  );
  await mustFail(
    `insert into feedback (user_id, rating, status) values ('f11', 2, 'bilo_sta')`,
    "nepoznat status odbijen",
  );
  await mustFail(
    `insert into feedback (user_id, rating, severity) values ('f11', 2, 5)`,
    "težina van 1-3 odbijena",
  );

  // Ocena više nije obavezna: odgovor na pitanje je nema.
  await db.exec(`
    insert into feedback (user_id, prompt_key, answers, source)
    values ('f11', 'prva-lista', '{"odgovor":"delimicno"}'::jsonb, 'pitanje')
  `);
  const bezOcene = await one<{ n: number }>(
    `select count(*)::int as n from feedback where user_id='f11' and rating is null`);
  check(bezOcene?.n === 1, "odgovor na pitanje sme bez ocene");

  await mustFail(
    `insert into feedback (user_id, rating, source) values ('f11', 2, 'sms')`,
    "nepoznat izvor i dalje odbijen",
  );
  await db.exec(`insert into feedback (user_id, rating, source) values ('f11', 2, 'incident')`);

  // F11.2 od sada stvarno upisuje `screenshot_path` (slika uz utisak) i čita
  // `ctx.errors` (dnevnik klijentskih grešaka). Kolona i jsonb moraju da postoje
  // pre nego što ruta pokuša da ih napuni.
  await db.exec(`
    insert into feedback (user_id, rating, kind, screenshot_path, ctx)
    values ('f11', 1, 'bug', 'f11/aaaa.png',
            '{"plan":"beta","credits":5,"unlocks":0,"ua":"x","viewport":"390×844",
              "errors":[{"poruka":"pukao fetch","tip":"TypeError","ruta":"/pretraga",
                         "vreme":"2026-08-12T10:00:00.000Z"}]}'::jsonb)
  `);
  check(
    (await one<{ n: number }>(
      `select count(*)::int as n from feedback
       where user_id='f11' and screenshot_path is not null
         and jsonb_array_length(ctx->'errors') = 1`))?.n === 1,
    "slika i dnevnik grešaka staju uz utisak",
  );

  console.log("\nfeedback_prompts");
  await db.exec(`
    insert into feedback_prompts (user_id, prompt_key) values ('f11', 'prva-lista')
  `);
  await mustFail(
    `insert into feedback_prompts (user_id, prompt_key) values ('f11', 'prva-lista')`,
    "isto pitanje drugi put odbijeno (PK)",
  );
  await mustFail(
    `insert into feedback_prompts (user_id, prompt_key, status) values ('f11', 'x', 'ceka')`,
    "nepoznat status pitanja odbijen",
  );

  console.log("\ngrant_feedback_credits");
  type FbGrant = { ok: boolean; reason: string; delta: number };
  const fbId = await one<{ id: number }>(
    `select id from feedback where user_id='f11' order by id limit 1`);
  const nagrada = (a: number, id: number | undefined) =>
    one<FbGrant>(`select * from grant_feedback_credits('f11',$1,$2)`, [a, id ?? 0]);

  // Bez izmene TELA `grant_credits` ovo bi vratilo `invalid_reason` i tiho ne
  // dodelilo ništa — zamka koju F11 §4 izričito imenuje.
  const prvaNagrada = await nagrada(1, fbId?.id);
  check(prvaNagrada?.ok === true && prvaNagrada.delta === 1, "prva nagrada → +1 kredit");
  check(
    (await one<{ b: number }>(`select credits_balance as b from profiles where id='f11'`))?.b === 6,
    "balans porastao tačno za 1",
  );
  check((await nagrada(1, fbId?.id))?.reason === "vec dodeljeno", "ista nagrada drugi put ne prolazi");
  check((await nagrada(11, fbId?.id))?.reason === "iznos van granica", "iznos preko 10 odbijen");

  const zapisNagrade = await one<{ n: number }>(
    `select count(*)::int as n from credit_ledger
     where user_id='f11' and reason='feedback' and ref_id = 'fb:' || $1::text`, [fbId?.id]);
  check(zapisNagrade?.n === 1, "u knjizi tačno jedna stavka za taj utisak");

  // Mesečni plafon je u RPC-u, a ne u aplikaciji — mora da izdrži i poziv koji
  // zaobiđe web (F11 §4).
  await db.exec(`
    insert into credit_ledger (user_id, delta, reason, ref_id)
    values ('f11', 19, 'feedback', 'fb:test-plafon')
  `);
  check(
    (await nagrada(10, 999))?.reason === "mesecni plafon za utiske",
    "preko 20 kredita mesečno iz utisaka → odbijeno",
  );

  console.log("\nchangelog");
  check(
    (await one<{ n: number }>(
      `select count(*)::int as n from pg_policies where tablename = 'changelog'`))?.n === 1,
    "changelog ima tačno jednu politiku",
  );

  // ── F12: admin konzola ───────────────────────────────────
  // Tri stvari koje bi tiho pale: da uloga ne može da bude bilo šta, da
  // korekcija kredita ne može da odvede balans ispod nule, i da dupli klik ne
  // dodeli dvaput. Sve tri su novac ili prava pristupa.
  console.log("\nF12 — admin");
  await db.exec(`insert into profiles (id, email, credits_balance) values
    ('adm','adm@x.rs',0), ('meta','meta@x.rs',10)`);

  await mustFail(`update profiles set role = 'superadmin' where id = 'adm'`, "nepoznata uloga odbijena");
  await db.exec(`update profiles set role = 'admin' where id = 'adm'`);
  check(
    (await one<{ role: string }>(`select role from profiles where id='adm'`))?.role === "admin",
    "uloga admin upisana",
  );
  check(
    (await one<{ role: string }>(`select role from profiles where id='meta'`))?.role === "user",
    "podrazumevana uloga je user (postojeći profili ne postaju admini)",
  );

  console.log("\nadmin_adjust_credits");
  type Adjust = { ok: boolean; reason: string; balance: number };
  const adjust = (delta: number, ref: string | null, user = "meta") =>
    one<Adjust>(`select * from admin_adjust_credits('adm',$1,$2,'beleška',$3)`, [user, delta, ref]);

  check((await adjust(0, null))?.reason === "invalid_amount", "delta 0 odbijena");
  check((await adjust(501, null))?.reason === "iznos van granica", "iznos preko 500 odbijen");
  check((await adjust(5, "adm:x", "nema_ga"))?.reason === "no_user", "nepostojeći korisnik → no_user");

  const dodato = await adjust(30, "adm:r1");
  check(dodato?.ok === true && dodato.balance === 40, `+30 → balans ${dodato?.balance}`);

  // Poenta `ref_id`-ja iz forme: dupli klik ne sme da dodeli 60.
  const ponovo = await adjust(30, "adm:r1");
  check(ponovo?.reason === "already_applied" && ponovo.balance === 40,
    "isti ref_id drugi put → already_applied, bez druge dodele");
  check(
    (await one<{ n: number }>(
      `select count(*)::int as n from credit_ledger where user_id='meta' and ref_id='adm:r1'`))?.n === 1,
    "u knjizi tačno jedna stavka za taj ref_id",
  );

  // Jedini put do negativnog iznosa (pravilo 3) — i jedini koji sme da odbije.
  const oduzeto = await adjust(-15, "adm:r2");
  check(oduzeto?.ok === true && oduzeto.balance === 25, `−15 → balans ${oduzeto?.balance}`);
  const preko = await adjust(-500, "adm:r3");
  check(preko?.ok === false && preko.reason === "balans bi bio negativan",
    "oduzimanje ispod nule odbijeno");
  check(
    (await one<{ b: number }>(`select credits_balance as b from profiles where id='meta'`))?.b === 25,
    "odbijena korekcija ne menja balans",
  );

  // Pravilo 14: mutacija i njen trag su jedna transakcija.
  const trag = await one<{ n: number; delta: string }>(
    `select count(*)::int as n, max(payload->>'delta') as delta
     from admin_audit where action='credits.adjust' and target_user='meta'`);
  check(trag?.n === 2, `svaka uspela korekcija ima red u reviziji (${trag?.n})`);

  // Brisanje admina NE sme da obori dnevnik njegovih radnji — zato je `actor_id`
  // nullable, uprkos tome što PRD piše `not null` (v. komentar u 0012).
  await db.exec(`delete from profiles where id = 'adm'`);
  const posleBrisanja = await one<{ n: number; sirocad: number }>(
    `select count(*)::int as n,
            count(*) filter (where actor_id is null)::int as sirocad
     from admin_audit where target_user='meta'`);
  check(posleBrisanja?.n === 2 && posleBrisanja.sirocad === 2,
    "brisanje aktera ostavlja dnevnik, sa actor_id = null");

  console.log("\nadmin_users_page");
  type Strana = {
    id: string; email: string; role: string; credits_balance: number;
    unlocks_count: string; searches_count: string; ukupno: string;
  };
  const strana = (filter: string | null, q: string | null = null, sort = "created_at") =>
    db.query<Strana>(
      `select * from admin_users_page($1,$2,null,$3,'desc',25,0)`, [q, filter, sort]);

  const sve = await strana(null);
  check(sve.rows.length > 0 && Number(sve.rows[0]?.ukupno) === sve.rows.length,
    `lista vraća i ukupan broj (${sve.rows[0]?.ukupno})`);

  const poMejlu = await strana(null, "meta@");
  check(poMejlu.rows.length === 1 && poMejlu.rows[0]?.id === "meta", "filter po mejlu (ILIKE)");

  // `u1` je ranije u ovom fajlu otključao `p1` i pretraživao — dakle nije „bez
  // aktivnosti", a `meta` jeste. Bez ovog filtera nemam kome da pošaljem
  // `zasto-ne-vracas` mejl (F12 §3.1).
  const mrtvi = await strana("bez_aktivnosti");
  check(mrtvi.rows.some((r) => r.id === "meta"), "filter bez_aktivnosti hvata neaktivan nalog");
  check(!mrtvi.rows.some((r) => r.id === "u1"), "filter bez_aktivnosti preskače aktivan nalog");

  const poOtkljucanima = await strana(null, null, "unlocks");
  check(
    Number(poOtkljucanima.rows[0]?.unlocks_count ?? 0) >=
      Number(poOtkljucanima.rows[poOtkljucanima.rows.length - 1]?.unlocks_count ?? 0),
    "sortiranje po broju otključanih radi (opadajuće)",
  );

  // Prvi admin postoji SAMO u `ADMIN_BOOTSTRAP_IDS` — `profiles.role` mu je
  // `'user'`, jer ga niko nije postavio i ne može sam sebi (§1). Bez osmog
  // parametra (0014) filter „Admini" je na takvoj instalaciji prazan, dakle
  // beskoristan tačno tamo gde je najpotrebniji.
  const bezEnva = await db.query<Strana>(
    `select * from admin_users_page(null,'admini',null,'created_at','desc',25,0,'{}'::text[])`);
  check(bezEnva.rows.length === 0, "filter admini bez env-a: nijedan (niko nema role='admin')");

  const saEnvom = await db.query<Strana>(
    `select * from admin_users_page(null,'admini',null,'created_at','desc',25,0,$1::text[])`,
    [["meta"]]);
  check(
    saEnvom.rows.length === 1 && saEnvom.rows[0]?.id === "meta",
    "filter admini hvata admina iz ADMIN_BOOTSTRAP_IDS",
  );
  check(
    (await strana(null)).rows.length > 1,
    "bootstrap spisak ne menja ostale filtere",
  );

  // ── F12.2: kaskada brisanja naloga ───────────────────────
  // Webhook `user.deleted` briše JEDAN red — `profiles` — i računa na to da baza
  // odnese ostalo (pravilo 15). Nijedna od tih veza nije dodata u 0012; sve su
  // starije, i tačno zato ih niko ne bi primetio da se raziđu. Prvi
  // `references profiles` bez `on delete cascade` u nekoj budućoj migraciji
  // pretvara brisanje naloga u grešku stranog ključa — u produkciji, na radnji
  // koja se ne može ponoviti do pola.
  //
  // Isto tako se proverava i suprotna strana: `businesses` i `website_audits`
  // NE smeju da nestanu. To nisu korisnikovi podaci nego imovina proizvoda
  // (00-kontekst §4).
  console.log("\nF12.2 — kaskada brisanja naloga");
  await db.exec(`
    insert into profiles (id, email, credits_balance) values ('brisan','brisan@x.rs',5);
    insert into unlocks (user_id, place_id) values ('brisan','p1');
    insert into credit_ledger (user_id, delta, reason) values ('brisan',-1,'unlock');
    insert into searches (user_id, country_code, city_slug, source)
      values ('brisan','RS','nis','cache');
    insert into feedback (user_id, rating) values ('brisan', 2);
    insert into feedback_prompts (user_id, prompt_key) values ('brisan','prva-lista');
    insert into lead_status (user_id, place_id, status, channel, contacted_at)
      values ('brisan','p1','kontaktiran','mejl',now());
    insert into outreach_messages (user_id, place_id, channel, body)
      values ('brisan','p1','mejl','Dobar dan');
    insert into job_queue (id, type, payload) values (9001,'scan','{}'::jsonb);
    insert into job_subscribers (job_id, user_id) values (9001,'brisan');
  `);

  await db.exec(`delete from profiles where id = 'brisan'`);

  for (const tabela of [
    "unlocks",
    "credit_ledger",
    "feedback",
    "feedback_prompts",
    "lead_status",
    "outreach_messages",
    "job_subscribers",
  ]) {
    const r = await one<{ n: number }>(
      `select count(*)::int as n from ${tabela} where user_id = 'brisan'`);
    check(r?.n === 0, `${tabela}: kaskada odnela redove obrisanog naloga`);
  }

  // `searches` je `on delete set null`, ne cascade — i to je namerno: udeo keša u
  // pretragama je brojka o sistemu, a ne o čoveku. Red ostaje, samo bez vlasnika.
  const pretrage = await one<{ ukupno: number; bez: number }>(
    `select count(*)::int as ukupno,
            count(*) filter (where user_id is null)::int as bez
     from searches where city_slug = 'nis' and source = 'cache'`);
  check(
    (pretrage?.ukupno ?? 0) >= 1 && (pretrage?.bez ?? 0) >= 1,
    "searches preživljava brisanje, sa user_id = null",
  );

  check(
    (await one<{ n: number }>(`select count(*)::int as n from businesses where place_id='p1'`))?.n === 1,
    "businesses OSTAJE — nije korisnikov podatak",
  );
  check(
    (await one<{ n: number }>(`select count(*)::int as n from website_audits where place_id='p1'`))?.n === 1,
    "website_audits OSTAJE — nije korisnikov podatak",
  );

  // ── F12.3: uloga u jednoj transakciji i pregled sistema ──
  // `admin_set_role` postoji zato što je „poslednji admin ostaje" do sada bila
  // provera u dva zahteva (v. „S4 — šta se razišlo", tačka 1). Sve što se ovde
  // proverava je prava pristupa, dakle jedina radnja u konzoli koja menja ko sme
  // šta — a nju TypeScript ne može da uhvati.
  console.log("\nF12.3 — admin_set_role");
  await db.exec(`insert into profiles (id, email, credits_balance) values
    ('a1','a1@x.rs',0), ('a2','a2@x.rs',0)`);
  await db.exec(`update profiles set role = 'admin' where id = 'a1'`);

  type Uloga = { ok: boolean; reason: string; admins: number };
  const uloga = (actor: string, user: string, role: string) =>
    one<Uloga>(`select * from admin_set_role($1,$2,$3)`, [actor, user, role]);

  check((await uloga("a1", "a2", "superadmin"))?.reason === "invalid_role", "nepoznata uloga odbijena");
  check((await uloga("a1", "a1", "user"))?.reason === "self", "sebi se uloga ne menja");
  check((await uloga("a1", "nema_ga", "admin"))?.reason === "no_user", "nepostojeći nalog → no_user");

  // Jedini admin u bazi. Ovo je slučaj zbog kog cela funkcija postoji.
  const poslednji = await uloga("a2", "a1", "user");
  check(poslednji?.ok === false && poslednji.reason === "last_admin",
    "poslednji admin ne može da bude degradiran");
  check(
    (await one<{ role: string }>(`select role from profiles where id='a1'`))?.role === "admin",
    "odbijena promena ne dira red u bazi",
  );

  const dodeljena = await uloga("a1", "a2", "admin");
  check(dodeljena?.ok === true && dodeljena.admins === 2, `uloga dodeljena (admina: ${dodeljena?.admins})`);
  check((await uloga("a1", "a2", "admin"))?.reason === "unchanged", "ista uloga drugi put → unchanged");

  const skinuta = await uloga("a2", "a1", "user");
  check(skinuta?.ok === true && skinuta.admins === 1,
    "kad admina ima dvoje, jednom sme da se skine uloga");

  console.log("\nadmin_overview");
  const pregled = await one<{ v: Record<string, Record<string, unknown>> }>(
    `select admin_overview(75, 900) as v`);

  for (const kartica of ["budzet", "poslovi", "korisnici", "krediti", "utisci", "baza"]) {
    check(pregled?.v?.[kartica] !== undefined, `pregled ima karticu „${kartica}"`);
  }
  check(pregled?.v?.budzet?.dan_cap === 75, "kap iz TS-a stiže do budžeta, nije zakucan u SQL-u");
  check(
    Number(pregled?.v?.korisnici?.ukupno ?? 0) >= 2,
    `pregled broji profile (${pregled?.v?.korisnici?.ukupno})`,
  );
  // Posao 9001 je ubačen gore kao `pending` i od tada čeka — dakle ovo je i
  // provera da „najstariji na čekanju" uopšte nešto vidi, jer se na njemu pali
  // jedino crveno stanje osim budžeta (F12 §3.4).
  check(Number(pregled?.v?.poslovi?.na_cekanju ?? 0) >= 1, "pregled vidi posao na čekanju");
  check(
    Array.isArray(pregled?.v?.utisci?.cena_odgovori),
    "pregled vraća SIROVE odgovore o ceni — medijanu računa medijanaCene()",
  );

  // ── F11.3: utisci u konzoli ──────────────────────────────
  // Migracija 0015 dopunjuje `admin_overview` sa dve stvari koje `/admin/utisci`
  // prikazuje kao red brojki. Provera postoji zato što bi obe tiho vratile
  // prazno: `jsonb` nema šemu, pa promašen ključ ne puca nego nestane sa ekrana.
  //
  // Isti razlog zbog kog se brojke uopšte računaju TU, a ne u drugoj funkciji:
  // kartica „Utisci" na `/admin` i red brojki na `/admin/utisci` moraju da
  // pokažu isti broj (F11 §6.6).
  console.log("\nF11.3 — admin_overview: utisci");

  // Odgovor na pitanje o ceni — ulazi u `cena_odgovori`, iz kog `medijanaCene()`
  // računa medijanu. SQL je ovde ne dira (sredine opsega su u katalogu).
  await db.exec(`
    insert into feedback (user_id, prompt_key, answers, source)
    values ('f11', 'cena', '{"odgovor":"990-1990"}'::jsonb, 'kampanja')
  `);

  // Funnel po pitanju: jedno odgovoreno, jedno odbačeno, jedno samo prikazano.
  await db.exec(`
    update feedback_prompts set status = 'odgovoreno' where user_id='f11' and prompt_key='prva-lista';
    insert into feedback_prompts (user_id, prompt_key, status)
      values ('f11', 'cena', 'odgovoreno'), ('f11', 'prazan-rezultat', 'odbaceno');
  `);

  // Prijava sa ishodom — `resolved_at` upisuje ruta pri prelasku u završni
  // status, i samo iz njega se računa „prosek do odgovora".
  await db.exec(`
    update feedback set status = 'reseno', resolved_at = created_at + interval '2 hours'
     where user_id = 'f11' and kind = 'bug'
  `);

  type Utisci = {
    po_pitanju: { kljuc: string; prikazano: number; odgovoreno: number; odbaceno: number }[];
    obrada: { reseno: number; prosek_sec: number; nereseno: number };
    pitanja: { prikazano: number; odgovoreno: number };
    cena_odgovori: string[];
  };

  const sviUtisci = (
    await one<{ v: { utisci: Utisci } }>(`select admin_overview(75, 900) as v`)
  )?.v?.utisci;

  check(Array.isArray(sviUtisci?.po_pitanju), "pregled vraća odgovorenost po pitanju");

  const prvaLista = sviUtisci?.po_pitanju.find((q) => q.kljuc === "prva-lista");
  check(
    prvaLista?.prikazano === 1 && prvaLista.odgovoreno === 1,
    `po_pitanju broji odgovorena pitanja (${prvaLista?.odgovoreno}/${prvaLista?.prikazano})`,
  );
  check(
    sviUtisci?.po_pitanju.find((q) => q.kljuc === "prazan-rezultat")?.odbaceno === 1,
    "po_pitanju broji i odbačena",
  );
  // Zbir po pitanjima mora da se poklopi sa zbirnom brojkom — dve brojke o istoj
  // stvari na istom ekranu koje se ne slažu su gore od nijedne.
  check(
    sviUtisci?.po_pitanju.reduce((z, q) => z + q.prikazano, 0) === sviUtisci?.pitanja.prikazano,
    "zbir po pitanjima = zbirna odgovorenost",
  );

  check(
    (sviUtisci?.obrada.reseno ?? 0) >= 1 && (sviUtisci?.obrada.prosek_sec ?? 0) === 7200,
    `prosek do odgovora je 2 h (${sviUtisci?.obrada.prosek_sec} s)`,
  );
  check(
    (sviUtisci?.obrada.nereseno ?? 0) >= 1,
    `nerešene se broje odvojeno (${sviUtisci?.obrada.nereseno})`,
  );
  check(
    sviUtisci?.cena_odgovori.includes("990-1990") === true,
    "odgovor o ceni izlazi SIROV — medijanu i dalje računa medijanaCene()",
  );

  check(
    (await one<{ n: number }>(
      `select count(*)::int as n from pg_indexes
        where tablename = 'feedback' and indexname = 'feedback_created_idx'`))?.n === 1,
    "lista utisaka ima indeks po created_at",
  );

  // ── F11.4: zatvaranje petlje ──────────────────────────────
  // Migracija 0016 donosi dve kolone na kojima stoji ceo ostatak isporuke:
  // `user_note` (obrazloženje koje korisnik vidi) i `notify_attempts` (brojač
  // pokušaja mejla „rešeno"). Obe bi tiho radile prazno — `add column` ne puca
  // kad se zaboravi, samo sve ostane bez teksta, odnosno na nula pokušaja.
  console.log("\nF11.4 — petlja: user_note i notify_attempts");

  check(
    (await one<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
        where table_name = 'feedback' and column_name in ('user_note', 'notify_attempts')`,
    ))?.n === 2,
    "feedback ima i user_note i notify_attempts",
  );

  // Mejl „rešeno" čita upravo ovaj presek — parcijalni indeks mora da postoji,
  // inače svaki dnevni prolaz šeta kroz celu tabelu.
  check(
    (await one<{ n: number }>(
      `select count(*)::int as n from pg_indexes
        where tablename = 'feedback' and indexname = 'feedback_notify_idx'`,
    ))?.n === 1,
    "cron 'rešeno' ima parcijalni indeks",
  );

  // Ograničenje stvarno drži: negativan brojač ne sme da prođe.
  await mustFail(
    `update feedback set notify_attempts = -1 where id = (select id from feedback limit 1)`,
    "notify_attempts ne sme da bude negativan",
  );

  // ── Faza 1: rate limit, webhook dedup, utisci u RPC-u ──
  console.log("\nFaza 1 — claim_request (IP rate limit)");
  type Claim = { ok: boolean; remaining: number };
  const claim = (ip: string, route: string, lim: number) =>
    one<Claim>(`select * from claim_request($1,$2,$3)`, [ip, route, lim]);

  check((await claim("1.2.3.4", "unlock", 100))?.ok === true, "prvi zahtev → ok");
  let poslednjiClaim: Claim | undefined;
  for (let i = 2; i <= 100; i++) poslednjiClaim = await claim("1.2.3.4", "unlock", 100);
  check(poslednjiClaim?.ok === true, "100. zahtev → ok");
  check((await claim("1.2.3.4", "unlock", 100))?.ok === false, "101. zahtev → ok=false (429)");
  check((await claim("1.2.3.4", "search", 100))?.ok === true, "druga ruta ima svoj brojač");

  // Nov minut resetuje brojač — fiksni prozor, ne kumulativan.
  await db.exec(`update request_limits set minute = minute - interval '1 minute' where ip = '1.2.3.4'`);
  check((await claim("1.2.3.4", "unlock", 100))?.ok === true, "nov minut resetuje brojač");

  console.log("\nFaza 1 — webhook_events (idempotencija)");
  await db.exec(`
    insert into webhook_events (provider, event_id) values ('clerk', 'evt_1') on conflict do nothing;
    insert into webhook_events (provider, event_id) values ('clerk', 'evt_1') on conflict do nothing;
  `);
  const wh = await one<{ n: number }>(
    `select count(*)::int as n from webhook_events where provider = 'clerk' and event_id = 'evt_1'`);
  check(wh?.n === 1, "isti event_id drugi put → preskočen (on conflict do nothing)");

  console.log("\nFaza 1 — zabelezi_utisak (plafon u transakciji)");
  await db.exec(`insert into profiles (id, email, credits_balance) values ('fz1', 'fz1@x.rs', 30)`);
  type ZU = { ishod: string; posalji_mejl: boolean; red: { id: number; ctx: { credits: number; unlocks: number; ua: string } } };
  const zu = (rating: number | null) =>
    one<ZU>(`select * from zabelezi_utisak('fz1', $1, 'dugme', '/pretraga', 'Pretraga', 'test-ua', '1440×900', null, null, null, null, null, null, 2, 10)`, [rating]);

  const z1 = await zu(3);
  check(z1?.ishod === "upisan" && z1.posalji_mejl === true, "prvi utisak → upisan");
  check(z1?.red.ctx.credits === 30 && z1.red.ctx.ua === "test-ua", "ctx gradi RPC (credits, ua)");
  check((await zu(2))?.ishod === "upisan", "drugi uz plafon 2 → upisan");
  check((await zu(1))?.ishod === "plafon", "treći uz plafon 2 → plafon — ništa nije upisano");
  check(
    (await one<ZU>(`select * from zabelezi_utisak('nema_ga', 1, 'dugme', null, null, null, null, null, null, null, null, null, null, 50, 10)`))?.ishod === "no_user",
    "nepostojeći profil → no_user",
  );

  console.log("\nFaza 1 — dopuni_utisak (CAS sa for update)");
  type DU = { ok: boolean; reason: string };
  const fz1Id = z1?.red.id;
  const du = (expected: string | null, answers: string | null, kind: string | null) =>
    one<DU>(`select * from dopuni_utisak($1, 'fz1', $2::jsonb, $3::jsonb, $4, 'poruka', null, null)`,
            [fz1Id, expected, answers, kind]);

  check((await du(null, null, "ideja"))?.ok === true, "dopuna bez answers → ok");
  check(
    (await du('{}', '{"preporuka":"da"}', null))?.ok === true,
    "dopuna sa answers (expected = zatečeni '{}') → ok",
  );
  check(
    (await du('{"stari":"x"}', '{"preporuka":"ne"}', null))?.ok === false,
    "pogrešan expected → ok=false",
  );
  const stale = await one<DU>(`select * from dopuni_utisak($1, 'fz1', '{"stari":"x"}'::jsonb, '{"preporuka":"ne"}'::jsonb, null, null, null, null)`, [fz1Id]);
  check(stale?.reason === "stale", "pogrešan expected → reason=stale (CAS, 1.6)");
  check(
    (await one<DU>(`select * from dopuni_utisak(999999, 'fz1', null, null, null, null, null, null)`))?.reason === "nema",
    "nepostojeći red → nema",
  );

  // ── Faza 2: enqueue_job trka i dedup poruka ──────────────
  // PGlite ima jednu konekciju, pa se prava trka ne može izvesti — ali ishod
  // koji trka mora da ima (isti job_id, drugi je `joined`, nijedan 500) može.
  // Sama grana `unique_violation` u enqueue_job je pokrivena kodom (0019).
  console.log("\nFaza 2 — enqueue_job (trka na prvom upisu)");
  const trka1 = await one<Enq>(
    `select * from enqueue_job('scan', '{"citySlug":"trka"}'::jsonb, 'RS:trka:x', 'u1')`);
  const trka2 = await one<Enq>(
    `select * from enqueue_job('scan', '{"citySlug":"trka"}'::jsonb, 'RS:trka:x', 'u2')`);
  check(
    trka1?.joined === false && trka2?.joined === true && trka1?.job_id === trka2?.job_id,
    `drugi upis istog ključa → joined, isti job_id (2.3)  (${trka1?.job_id}/${trka2?.job_id})`,
  );

  console.log("\nFaza 2 — outreach_messages dedup (2.5)");
  await db.exec(`
    insert into outreach_messages (user_id, place_id, channel, body)
    values ('u1', 'p1', 'mejl', 'ista poruka')
  `);
  await mustFail(
    `insert into outreach_messages (user_id, place_id, channel, body)
     values ('u1', 'p1', 'mejl', 'ista poruka')`,
    "dupli (user, place, kanal, tekst) odbijen",
  );
  // `on conflict do nothing` — tačno ono što ruta i worker zovu — preskače.
  await db.exec(`
    insert into outreach_messages (user_id, place_id, channel, body)
    values ('u1', 'p1', 'mejl', 'ista poruka')
    on conflict do nothing
  `);
  const poruke = await one<{ n: number }>(
    `select count(*)::int as n from outreach_messages
     where user_id = 'u1' and place_id = 'p1' and body = 'ista poruka'`);
  check(poruke?.n === 1, "on conflict do nothing ne duplira");

  // ── Faza 3: napredak posla, brojači keša, pretraga u SQL-u ──
  console.log("\nFaza 3 — get_job_for_user (1 upit po pollingu)");
  // scan posao iz "enqueue_job i dedup" bloka ima pretplatnike u1 i u2.
  type Gj = { id: number; found: number | null; analyzed: number | null };
  const gj = (u: string, id: number) =>
    one<Gj>(`select * from get_job_for_user($1, $2)`, [id, u]);
  check((await gj("u1", j1?.job_id ?? 0))?.id === j1?.job_id, "pretplaćeni vidi posao");
  check((await gj("u2", j1?.job_id ?? 0))?.id === j1?.job_id, "drugi pretplatnik vidi isti posao");
  check((await gj("nema_ga", j1?.job_id ?? 0)) === undefined, "nepretplaćeni ne vidi ništa");
  await db.exec(`update job_queue set found = 5, analyzed = 2 where id = ${j1?.job_id}`);
  check(
    (await gj("u1", j1?.job_id ?? 0))?.found === 5 && (await gj("u1", j1?.job_id ?? 0))?.analyzed === 2,
    "found/analyzed stižu sa reda posla",
  );
  await db.exec(`select inkrementiraj_analizu(${j1?.job_id})`);
  check((await gj("u1", j1?.job_id ?? 0))?.analyzed === 3, "inkrementiraj_analizu diže broj");

  console.log("\nFaza 3 — search_cache brojači (umesto pogleda)");
  type St = { total: number; no_site: number };
  const st = (c: string, n: string) =>
    one<St>(`select * from search_cache_state('RS', $1, $2, 30)`, [c, n]);
  // iz F9 bloka: nis/stomatolog ima f1 (nema_sajt) i f2.
  check(
    (await st("nis", "stomatolog"))?.total === 2 && (await st("nis", "stomatolog"))?.no_site === 1,
    `search_cache_state čita brojače (${(await st("nis", "stomatolog"))?.total})`,
  );
  // Trigger: nov biznis + audit nema_sajt diže oba brojača.
  await db.exec(`
    insert into businesses (place_id, city_slug, niche_slug, name) values ('f3', 'nis', 'stomatolog', 'Firma 3');
    insert into website_audits (place_id, site_status) values ('f3', 'nema_sajt');
  `);
  const st2 = await st("nis", "stomatolog");
  check(
    st2?.total === 3 && st2?.no_site === 2,
    `trigger osvežava i total i no_site (${st2?.total}/${st2?.no_site})`,
  );

  console.log("\nFaza 3 — search_listing (filter/sort/limit u SQL-u)");
  // F9 blok iznad je pomerio google_refreshed_at u prošlost (test pravila 1);
  // per-red TTL iz Faze 6 (6.1) ih zato ispravno izbacuje iz pretrage. Za ovaj
  // test se redovi osveže, da se proverava filter, a ne TTL.
  await db.exec(`update businesses set google_refreshed_at = now() where city_slug = 'nis'`);
  type Lst = { place_id: string; site_status: string | null; total: number; no_site: number; ok: number };
  const lst = (only: boolean, page = 1) =>
    one<Lst>(`select * from search_listing('RS', 'nis', 'stomatolog', $1, false, false, null, $2, 30)`, [only, page]);
  const l1 = await lst(false);
  check(
    l1?.total === 3 && l1?.no_site === 2 && l1?.site_status === "nema_sajt",
    `search_listing vraća agregat + sort po statusu (${l1?.place_id})`,
  );
  check((await lst(true))?.total === 2, "filter onlyNoSite u SQL-u");

  // ── Faza 6: restrict kaskade, CHECK-ovi, partial ─────────
  console.log("\nFaza 6 — restrict kaskade od businesses (6.2)");
  // p1 ima audit i unlocks — brisanje mora da padne na website_audits restrict.
  await mustFail(
    `delete from businesses where place_id = 'p1'`,
    "brisanje biznisa sa auditom odbijeno (restrict)",
  );
  // f2 nema audit — jedini trag je signed_events; i njega restrict čuva.
  await db.exec(`insert into signed_events (user_id, place_id, country_code) values ('u1', 'f2', 'RS')`);
  await mustFail(
    `delete from businesses where place_id = 'f2'`,
    "brisanje biznisa sa potpisom odbijeno (restrict)",
  );

  console.log("\nFaza 6 — CHECK-ovi (6.5)");
  await mustFail(
    `update businesses set rating = 6 where place_id = 'p1'`,
    "rating preko 5 odbijen",
  );
  await mustFail(
    `update website_audits set http_status = 99 where place_id = 'p1'`,
    "http_status van 100-599 odbijen",
  );
  await mustFail(
    `insert into signed_events (user_id, place_id, country_code) values ('u1', 'p1', 'srb')`,
    "neispravan country_code u signed_events odbijen",
  );

  console.log("\nFaza 6 — partial u registru keša (6.4)");
  await db.exec(`select record_scan('RS', 'nis', 'stomatolog', 3, null, true)`);
  check(
    (await one<{ partial: boolean }>(
      `select partial from search_cache where country_code = 'RS' and city_slug = 'nis' and niche_slug = 'stomatolog'`))?.partial === true,
    "parcijalan scan se pamti kao partial",
  );
  await db.exec(`select record_scan('RS', 'nis', 'stomatolog', 3, null, false)`);
  check(
    (await one<{ partial: boolean }>(
      `select partial from search_cache where country_code = 'RS' and city_slug = 'nis' and niche_slug = 'stomatolog'`))?.partial === false,
    "pun scan vraća partial na false",
  );

  console.log("\nPrava nad funkcijama");
  for (const fn of ["spend_credit_and_unlock", "grant_credits", "create_profile_with_grant",
                    "consume_api_call", "consume_side_call", "api_budget_status", "mark_api_exhausted",
                    "set_api_day_calls", "enqueue_job", "claim_job", "complete_job",
                    "fail_job", "defer_job", "reap_stuck_jobs", "claim_cache_miss",
                    "release_cache_miss", "grant_monthly_credits", "claim_export",
                    "spend_credit_and_scan", "refund_scan", "record_scan",
                    "search_cache_state", "search_cache_overview",
                    "grant_feedback_credits",
                    "admin_adjust_credits", "admin_users_page",
                    "admin_set_role", "admin_overview",
                    "claim_request", "zabelezi_utisak", "dopuni_utisak",
                    "get_job_for_user", "inkrementiraj_analizu", "search_listing"]) {
    const r = await one<{ anon: boolean; svc: boolean }>(
      `select has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('service_role', p.oid, 'execute') as svc
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.proname = $1 and n.nspname = 'public'`, [fn]);
    check(r?.anon === false, `${fn}: anon NE sme da izvršava`);
    check(r?.svc === true, `${fn}: service_role sme da izvršava`);
  }

  console.log(failed === 0 ? "\nSve prošlo." : `\n${failed} palo.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
