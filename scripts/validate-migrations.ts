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
import { budgetDay } from "../apps/worker/src/lib/api-budget";

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
                   "job_subscribers"]) {
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

  console.log("\nPrava nad funkcijama");
  for (const fn of ["spend_credit_and_unlock", "grant_credits", "create_profile_with_grant",
                    "consume_api_call", "api_budget_status", "mark_api_exhausted",
                    "set_api_day_calls", "enqueue_job", "claim_job", "complete_job",
                    "fail_job", "defer_job", "reap_stuck_jobs", "claim_cache_miss",
                    "release_cache_miss"]) {
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
