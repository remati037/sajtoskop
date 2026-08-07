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
                   "credit_ledger", "searches", "job_queue", "api_budget"]) {
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

  console.log("\nPrava nad funkcijama");
  for (const fn of ["spend_credit_and_unlock", "grant_credits", "create_profile_with_grant"]) {
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
