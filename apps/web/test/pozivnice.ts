// apps/web/test/pozivnice.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S27] Pristupne pozivnice (naplata-stripe.md §9). Podela posla:
//   · `pnpm check:sql` — `redeem_invite` nad pravom migracijom: svi ishodi,
//     `upper(trim())`, komp kroz `admin_open_komp`, `used_count`, `invite_id`.
//   · ovaj fajl — sloj iznad baze: šta uopšte ulazi u rute (Zod), kakav kod
//     generator pravi, da ruta za prihvatanje odbija bez sesije i loš kod PRE
//     baze, i da svaki ishod iz baze ima rečenicu iz §9.4.
//   · static — da admin rute idu kroz omotač sa revizijom i da nijedna tabela
//     pozivnica nema RLS politiku.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { RedeemInviteResult } from "@sajtoskop/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const koren = path.resolve(here, "../../..");
const webSrc = path.resolve(here, "../src");
const stubs = pathToFileURL(path.resolve(koren, "scripts/lib/next-stubs.ts")).href;

registerHooks({
  resolve(specifier, context, next) {
    if (["server-only", "next/navigation", "@clerk/nextjs/server"].includes(specifier)) {
      return { url: stubs, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(path.join(webSrc, specifier.slice(2))).href, context);
    }
    return next(specifier, context);
  },
});

// Isti držač sesije koji čita `auth()` iz stubova.
const sesija = ((globalThis as Record<string, unknown>).__sajtoskopSession ??= {
  current: null,
}) as { current: string | null };

const S = await import("../src/lib/pozivnice-schema");
const { generisiKod } = await import("../src/lib/pozivnice-pristup");
const { POST: prihvati } = await import("../src/app/api/pozivnice/prihvati/route");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ═══════════════════════════════════════════════════════════
// 1. telo admin rute
// ═══════════════════════════════════════════════════════════
console.log("\nšema: POST /api/admin/pozivnice/pristup");

const sema = S.pozivnicaPristupBodySchema;
const komp = (o: Record<string, unknown> = {}) => ({
  kind: "komp",
  komp_days: 30,
  komp_credits: 300,
  max_uses: 1,
  ...o,
});
const mesec = (o: Record<string, unknown> = {}) => ({ kind: "prvi_mesec", max_uses: 1, ...o });
const prolazi = (v: unknown) => sema.safeParse(v).success;

check(prolazi(komp()), "komp 30 dana / 300 kredita prolazi");
check(prolazi(komp({ komp_days: null })), "`komp_days: null` prolazi (bez roka)");
check(
  !prolazi({ kind: "komp", komp_credits: 300, max_uses: 1 }),
  "izostavljen `komp_days` NIJE `null` — tišina ne sme da postane neograničen komp",
);
check(prolazi(komp({ komp_days: 1 })) && prolazi(komp({ komp_days: 365 })), "rok 1 i 365 dana prolaze");
check(!prolazi(komp({ komp_days: 0 })), "rok 0 dana odbijen");
check(!prolazi(komp({ komp_days: 366 })), "rok 366 dana odbijen");
check(!prolazi(komp({ komp_days: 1.5 })), "rok mora da bude ceo broj");
check(prolazi(komp({ komp_credits: 0 })) && prolazi(komp({ komp_credits: 2000 })), "krediti 0 i 2000 prolaze");
check(!prolazi(komp({ komp_credits: -1 })), "negativni krediti odbijeni");
check(!prolazi(komp({ komp_credits: 2001 })), "preko 2000 kredita odbijeno (granica `admin_open_komp`)");
check(prolazi(komp({ max_uses: 100 })), "100 upotreba prolazi");
check(!prolazi(komp({ max_uses: 0 })), "0 upotreba odbijeno");
check(!prolazi(komp({ max_uses: 101 })), "101 upotreba odbijena");
check(prolazi(komp({ note: "x".repeat(200) })), "napomena od 200 znakova prolazi");
check(!prolazi(komp({ note: "x".repeat(201) })), "napomena od 201 znaka odbijena");
check(prolazi(mesec()), "prvi_mesec prolazi bez polja kompa");
check(!prolazi(mesec({ komp_days: 30 })), "prvi_mesec sa `komp_days` odbijen (strictObject)");
check(!prolazi(mesec({ komp_credits: 100 })), "prvi_mesec sa `komp_credits` odbijen");
check(!prolazi({ kind: "poklon", max_uses: 1 }), "nepoznat tip odbijen");
check(!prolazi(komp({ created_by: "user_x" })), "autor se ne provlači kroz telo");
check(!prolazi(komp({ used_count: 0 })), "brojač se ne provlači kroz telo");

{
  const r = sema.safeParse(komp({ email: "  Ana@Studio.RS ", code: " sajt-abcd-efgh " }));
  check(r.success && r.data.email === "ana@studio.rs", "mejl se seče i spušta na mala slova");
  check(r.success && r.data.code === "SAJT-ABCD-EFGH", "kod se seče i diže na velika slova (kao `upper(trim())`)");
  const p = sema.safeParse(komp({ email: "", code: "", note: "  " }));
  check(
    p.success && p.data.email === undefined && p.data.code === undefined && p.data.note === undefined,
    "prazna polja obrasca su „nije uneto“ — prazan kod znači generisan",
  );
  check(!prolazi(komp({ email: "nije-mejl" })), "neispravan mejl odbijen");
  check(!prolazi(komp({ code: "AB" })), "prekratak kod odbijen");
  check(!prolazi(komp({ code: "SAJT ABCD" })), "razmak u kodu odbijen");
  check(!prolazi(komp({ code: "-ABCDEF" })), "crtica na početku odbijena");
  check(!prolazi(komp({ code: "VLADA/../X" })), "kosa crta u kodu odbijena (kod ide u putanju)");
  check(prolazi(komp({ code: "vlada2026" })), "ručni kod sme da sadrži 0 i 1 — bira ga admin");
}

// ═══════════════════════════════════════════════════════════
// 2. generator
// ═══════════════════════════════════════════════════════════
console.log("\ngenerator koda");

check(S.AZBUKA_KODA.length === 32, "azbuka ima 32 znaka");
check(new Set(S.AZBUKA_KODA).size === 32, "svaki znak azbuke je jedinstven");
check(!/[01OI]/.test(S.AZBUKA_KODA), "azbuka nema 0, O, 1 ni I");

const kodovi = Array.from({ length: 5000 }, () => generisiKod());
check(kodovi.every((k) => S.OBLIK_GENERISANOG.test(k)), "5000 kodova, svi u obliku SAJT-XXXX-XXXX");
check(kodovi.every((k) => !/[01OI]/.test(k)), "nijedan kod nema zabranjen znak");
check(new Set(kodovi).size === kodovi.length, "5000 kodova, nijedan ponovljen");
check(kodovi.every((k) => S.kodSchema.safeParse(k).success), "svaki generisan kod prolazi i šemu za prihvatanje");
{
  const vidjeni = new Set(kodovi.flatMap((k) => k.slice(5).replace("-", "").split("")));
  check(vidjeni.size === 32, `sva 32 znaka azbuke se pojavljuju (${vidjeni.size}) — nema odsečenog opsega`);
}

// ═══════════════════════════════════════════════════════════
// 3. ruta za prihvatanje — sve što se odbija PRE baze
// ═══════════════════════════════════════════════════════════
console.log("\nPOST /api/pozivnice/prihvati");

const zahtev = (body: string) =>
  new Request("http://localhost/api/pozivnice/prihvati", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

sesija.current = null;
{
  const r = await prihvati(zahtev(JSON.stringify({ code: "SAJT-ABCD-EFGH" })));
  check(r.status === 401, `bez sesije → 401 (${r.status})`);
}

sesija.current = "user_test_pozivnice";
for (const [telo, opis] of [
  [JSON.stringify({ code: "ab" }), "prekratak kod"],
  [JSON.stringify({ code: "<script>" }), "kod sa nedozvoljenim znakovima"],
  [JSON.stringify({}), "bez koda"],
  [JSON.stringify({ code: 12345678 }), "kod kao broj"],
  ["nije json", "telo koje nije JSON"],
  [JSON.stringify({ code: "SAJT-ABCD-EFGH", userId: "user_drugi" }), "`userId` u telu (pravilo 8)"],
] as const) {
  const r = await prihvati(zahtev(telo));
  const body = (await r.json().catch(() => null)) as { greska?: string } | null;
  check(r.status === 400 && typeof body?.greska === "string", `${opis} → 400 (${r.status})`);
}
sesija.current = null;

// ═══════════════════════════════════════════════════════════
// 4. ishodi `redeem_invite` → rečenice (§9.4)
// ═══════════════════════════════════════════════════════════
console.log("\nishodi");

const RAZLOZI = [
  "not_found",
  "revoked",
  "expired",
  "used_up",
  "wrong_email",
  "already_redeemed",
  "has_subscription",
  "no_user",
] as const satisfies readonly Exclude<RedeemInviteResult["reason"], "redeemed">[];

check(
  Object.keys(S.ISHOD_POZIVNICE).length === RAZLOZI.length,
  "svaki razlog iz baze ima rečenicu, i nijedna rečenica nije višak",
);

const pad = (reason: (typeof RAZLOZI)[number]) =>
  S.ishodPrihvatanja({ ok: false, reason, kind: "komp" }, null);

for (const razlog of RAZLOZI) {
  const i = pad(razlog);
  check(!i.ok && i.status >= 400 && i.poruka.length > 0, `${razlog} → ${!i.ok ? i.status : "?"} „${!i.ok ? i.poruka : ""}“`);
}
{
  const nf = pad("not_found");
  check(!nf.ok && nf.poruka === "Kod ne postoji." && nf.status === 404, "not_found: „Kod ne postoji.“ i 404");
  const uu = pad("used_up");
  check(!uu.ok && uu.poruka.includes("već iskorišćen"), "isti kod drugi put → „već iskorišćen“");
  const we = pad("wrong_email");
  check(!we.ok && we.poruka.includes("za drugu adresu"), "kod za drugi mejl → „za drugu adresu“");
  const hs = pad("has_subscription");
  check(!hs.ok && hs.poruka.includes("Već imaš plan"), "nalog sa planom → „Već imaš plan“");
}

{
  const doKad = "2026-10-11T12:00:00.000Z";
  const k = S.ishodPrihvatanja({ ok: true, reason: "redeemed", kind: "komp" }, { kompDo: doKad, krediti: 300 });
  check(k.ok && k.dalje === "/dashboard?pozivnica=komp", "komp → /dashboard");
  check(k.ok && k.poruka.startsWith("Komp pristup do ") && k.poruka.includes("300 kredita"), `komp poruka: „${k.ok ? k.poruka : ""}“`);
  const b = S.ishodPrihvatanja({ ok: true, reason: "redeemed", kind: "komp" }, { kompDo: null, krediti: 1 });
  check(b.ok && b.poruka === "Komp pristup bez roka, 1 kredit.", `komp bez roka: „${b.ok ? b.poruka : ""}“`);
  const bezProfila = S.ishodPrihvatanja({ ok: true, reason: "redeemed", kind: "komp" }, null);
  check(bezProfila.ok, "komp je otvoren i kad se profil posle ne pročita — ishod nije pad");
  const m = S.ishodPrihvatanja({ ok: true, reason: "redeemed", kind: "prvi_mesec" }, null);
  check(m.ok && m.dalje === "/cenovnik?pozivnica=1", "prvi mesec → /cenovnik?pozivnica=1");
}

// ═══════════════════════════════════════════════════════════
// 5. prikaz
// ═══════════════════════════════════════════════════════════
console.log("\nprikaz");

check(S.opisPozivnice("komp", 30, 300) === "pun pristup 30 dana i 300 kredita", "opis: 30 dana i 300 kredita");
check(S.opisPozivnice("komp", 21, 1) === "pun pristup 21 dan i 1 kredit", "opis: množina (21 dan, 1 kredit)");
check(S.opisPozivnice("komp", null, 0) === "pun pristup bez roka", "opis: bez roka, bez kredita");
check(S.opisPozivnice("prvi_mesec", null, null) === "prvi mesec gratis", "opis: prvi mesec gratis");
check(
  S.linkPozivnice("SAJT-ABCD-EFGH").endsWith("/pozivnica/SAJT-ABCD-EFGH") &&
    /^https?:\/\//.test(S.linkPozivnice("SAJT-ABCD-EFGH")),
  "link je apsolutan i vodi na /pozivnica/<kod>",
);

{
  const sad = Date.now();
  const st = (o: Partial<Parameters<typeof S.stanjePozivnice>[0]>) =>
    S.stanjePozivnice({ revokedAt: null, expiresAt: null, usedCount: 0, maxUses: 1, ...o }, sad);
  check(st({}) === "aktivna", "stanje: aktivna");
  check(st({ usedCount: 1 }) === "iskoriscena", "stanje: iskorišćena");
  check(st({ expiresAt: new Date(sad - 1000).toISOString() }) === "istekla", "stanje: istekla");
  check(st({ revokedAt: new Date(sad).toISOString(), usedCount: 1 }) === "opozvana", "opoziv ima prednost, kao u `redeem_invite`");
}

// ═══════════════════════════════════════════════════════════
// 6. statičke provere
// ═══════════════════════════════════════════════════════════
console.log("\nstatičke provere");

const citaj = (p: string) => readFileSync(path.join(webSrc, p), "utf8");

{
  const napravi = citaj("app/api/admin/pozivnice/pristup/route.ts");
  const opozovi = citaj("app/api/admin/pozivnice/pristup/[id]/route.ts");
  for (const [ime, ruta] of [
    ["POST pristup", napravi],
    ["DELETE pristup/[id]", opozovi],
  ] as const) {
    check(/pripremiRadnju\(/.test(ruta), `${ime}: kroz \`pripremiRadnju\` (404 za ne-admina, tempo)`);
    check(/saAuditom\(/.test(ruta), `${ime}: kroz \`saAuditom\` (revizija i na uspeh i na pad)`);
  }
  check(/RADNJE\.POZIVNICA\b/.test(napravi), "pravljenje je `invite.create`");
  check(/RADNJE\.POZIVNICA_OPOZIV\b/.test(opozovi), "opoziv je `invite.revoke`");
}

{
  const lib = citaj("lib/pozivnice-pristup.ts");
  check(!/payload\s*[:=]\s*\{[^}]*\bemail\s*:/.test(lib), "payload za reviziju ne nosi mejl (samo id)");
  check(!/payload\s*[:=]\s*\{[^}]*\bcode\s*:/.test(lib), "payload za reviziju ne nosi ni kod");
  check(/rpc\(\s*["']redeem_invite["']/.test(lib), "prihvatanje ide kroz `redeem_invite`");
  // Samo UPISI — čitanje `credits_balance` posle prihvatanja (za rečenicu) je dozvoljeno.
  check(
    !/\.(?:update|insert|upsert)\(\{[^}]*\b(?:credits_balance|credits_topup|plan|komp_expires_at)\b/.test(lib),
    "lib ne piše ni kredite, ni plan, ni rok kompa — to radi `redeem_invite`",
  );
}

{
  const ruta = citaj("app/api/pozivnice/prihvati/route.ts");
  check(/const TEMPO = 5;/.test(ruta) && /proveriIpTempo\(req, "pozivnica-prihvati", TEMPO\)/.test(ruta), "prihvatanje: 5/min po IP");
  check(/requireUserId\(\)/.test(ruta), "prihvatanje: `user_id` iz sesije");
}

check(
  existsSync(path.join(webSrc, "app/pozivnica/[code]/page.tsx")) &&
    !existsSync(path.join(webSrc, "app/(app)/pozivnica")),
  "javna strana je van `(app)` — gost je vidi bez prijave",
);

{
  // Tačka 6 iz K3: kupon iz `invite_id` i brisanje posle checkout-a.
  const checkout = citaj("app/api/billing/checkout/route.ts");
  check(/invite_id/.test(checkout) && /STRIPE_COUPON_FIRST_MONTH/.test(checkout), "checkout čita `invite_id` i ubacuje kupon");
  const billing = citaj("lib/billing.ts");
  const mod = billing.indexOf('sesija.mode !== "subscription"');
  const brise = billing.indexOf("oznaciPozivnicuIskoriscenom(userId)");
  check(mod > 0 && brise > mod, "webhook briše `invite_id` na checkout.session.completed za pretplatu (ne za paket)");
}

{
  const migracije = path.join(koren, "supabase/migrations");
  const sql = readdirSync(migracije)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(path.join(migracije, f), "utf8"))
    .join("\n");
  for (const t of ["access_invites", "access_invite_redemptions"]) {
    check(new RegExp(`alter table ${t} enable row level security`).test(sql), `${t}: RLS uključen`);
    check(!new RegExp(`create policy[^;]*\\bon\\s+${t}\\b`, "i").test(sql), `${t}: nijedna politika — čita samo admin klijent`);
  }
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
