// apps/web/test/admin-komp.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S20 → S25] Komp nalozi (bivša beta) u admin konzoli. Jedno pravilo drži ceo
// fajl:
//
//   ‼️ Plan `komp` sme da nastane ISKLJUČIVO iz admin konzole (`admin_open_komp`)
//      ili pozivnicom (`redeem_invite`, koja istu funkciju zove). Nikad iz
//      registracije, nikad iz kupona, nikad iz webhooka (LANSIRANJE §1.1, D1;
//      naplata-stripe.md §9).
//
// ── podela posla između tri provere ─────────────────────────
//   · `pnpm check:sql` — TRIGER u bazi, nad pravom migracijom: goli `update` i
//     `insert` ne mogu da dodele `komp`, a zastavica iz `admin_open_komp` ne
//     curi u sledeću transakciju.
//   · ovaj fajl — sloj iznad: šta uopšte može da uđe u rute, i da nijedno drugo
//     mesto u izvoru ne upisuje `komp`.
//   · `packages/shared/test/pristup.ts` — da nepoznat i prazan plan ne padaju na
//     `komp`, dakle da tipfeler u koloni nije doživotan pristup.
//
// Provera „nijedan drugi put" je namerno STATIČKA (čita izvor). Regresija koje
// se stvarno plašim nije „ruta je vratila pogrešan status" nego „neko je sutra
// dopisao `plan: 'komp'` u kuponu, zato što je tamo zgodno".

import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { DEFAULT_PLAN, PLANS } from "@sajtoskop/shared";

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

const {
  KOMP_PREDLOG,
  kompNalogBodySchema,
  kompRokBodySchema,
  PLAN_OPCIJE,
  planBodySchema,
} = await import("../src/lib/admin-radnje-schema");
const { promeniPlan } = await import("../src/lib/admin-radnje");
const { RADNJE } = await import("../src/lib/admin");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

const DAN = 24 * 60 * 60 * 1000;
const zaDana = (n: number) => new Date(Date.now() + n * DAN).toISOString();

// ═══════════════════════════════════════════════════════════
// 1. `komp` ne može kroz obrazac za plan
// ═══════════════════════════════════════════════════════════
console.log("\nplan: komp nije ponuđen i nije primljen");

check(!PLAN_OPCIJE.includes("komp"), "padajući spisak planova ne nudi `komp`");
check(!PLAN_OPCIJE.includes("beta"), "padajući spisak ne zna za `beta` — ime je otišlo sa 0025");
check(
  PLAN_OPCIJE.length === Object.keys(PLANS).length - 1,
  "izbačen je tačno jedan plan, ostali su svi tu",
);
check(planBodySchema.safeParse({ plan: "komp" }).success === false, "šema odbija plan `komp`");
check(planBodySchema.safeParse({ plan: "beta" }).success === false, "šema odbija i staro ime `beta`");
check(planBodySchema.safeParse({ plan: "starter" }).success, "šema i dalje prima plaćen plan");
check(planBodySchema.safeParse({ plan: "dopuna" }).success, "šema prima `dopuna`");

{
  const ishod = await promeniPlan("user_neko", "komp");
  check(ishod.ok === false, "promeniPlan odbija `komp` i pre baze");
  check(!ishod.ok && ishod.status === 400, "odbijenica je 400, ne 500 iz baze");
  check(!ishod.ok && ishod.poruka.includes("komp"), "poruka imenuje plan i upućuje na pravi obrazac");
}

check(DEFAULT_PLAN !== "komp", `podrazumevani plan je \`${DEFAULT_PLAN}\`, ne \`komp\``);
check("komp" in PLANS && !("beta" in PLANS), "plan `komp` postoji, `beta` ne — zabranjen je put, ne pojam");
check(
  PLANS.komp.cacheMissPerDay === PLANS.advanced.cacheMissPerDay &&
    PLANS.komp.exportPerDay === PLANS.advanced.exportPerDay &&
    PLANS.komp.aiRewritePerDay === PLANS.advanced.aiRewritePerDay,
  "komp limiti su Advanced (A3)",
);

// ═══════════════════════════════════════════════════════════
// 2. rok: `null` je neograničeno, prošlost je dozvoljena
// ═══════════════════════════════════════════════════════════
console.log("\nrok kompa");

check(kompRokBodySchema.safeParse({ do: null }).success, "`do: null` prolazi (NEOGRANIČENO)");
check(kompRokBodySchema.safeParse({ do: zaDana(30) }).success, "ISO datum u budućnosti prolazi");
check(
  kompRokBodySchema.safeParse({ do: zaDana(-5) }).success,
  "ISO datum u PROŠLOSTI prolazi — tako se komp gasi (§1.5)",
);
check(
  kompRokBodySchema.safeParse({ do: "2026-09-21" }).success === false,
  "goli `YYYY-MM-DD` nije ISO trenutak i ne prolazi",
);
check(
  kompRokBodySchema.safeParse({}).success === false,
  "izostavljen `do` NIJE isto što i `null` — tišina ne sme da postane neograničen komp",
);
check(
  kompRokBodySchema.safeParse({ do: null, plan: "komp" }).success === false,
  "strictObject: plan se ne provlači uz rok",
);
check(
  kompRokBodySchema.safeParse({ do: zaDana(365 * 20) }).success === false,
  "rok 20 godina unapred je omaška u godini, ne odluka",
);

// ═══════════════════════════════════════════════════════════
// 3. otvaranje komp naloga: tri polja, jedan poziv
// ═══════════════════════════════════════════════════════════
console.log("\notvaranje komp naloga");

const REF = "adm:0193b7c2-4c1a-4f0e-9a3d-1f2e3d4c5b6a";
const telo = (over: Record<string, unknown> = {}) => ({
  do: zaDana(30),
  krediti: 300,
  refId: REF,
  ...over,
});

check(kompNalogBodySchema.safeParse(telo()).success, "predlog (300 kredita, rok) prolazi");
check(kompNalogBodySchema.safeParse(telo({ do: null })).success, "neograničen komp prolazi");
check(kompNalogBodySchema.safeParse(telo({ krediti: 0 })).success, "0 kredita prolazi (produženje)");
check(
  kompNalogBodySchema.safeParse(telo({ krediti: -5 })).success === false,
  "negativan broj kredita odbijen — oduzimanje ide kroz korekciju, ne kroz komp",
);
check(
  kompNalogBodySchema.safeParse(telo({ krediti: 2001 })).success === false,
  "preko 2000 kredita odbijeno (ista granica kao u RPC-u, 0025)",
);
check(
  kompNalogBodySchema.safeParse(telo({ krediti: 1200 })).success,
  "1200 (Advanced mesečna dodela) prolazi — granica je dignuta sa 500",
);
check(
  kompNalogBodySchema.safeParse(telo({ refId: "scan:12" })).success === false,
  "tuđ prostor imena u `refId` odbijen — idempotencije se ne smeju sudariti",
);
check(
  kompNalogBodySchema.safeParse({ do: null, krediti: 50 }).success === false,
  "bez `refId` nema idempotencije, pa nema ni radnje",
);

check(
  KOMP_PREDLOG.krediti === PLANS.komp.monthlyCredits && KOMP_PREDLOG.dana === 30,
  `predlog je ${KOMP_PREDLOG.krediti} kredita i ${KOMP_PREDLOG.dana} dana`,
);

// ═══════════════════════════════════════════════════════════
// 4. trag u reviziji
// ═══════════════════════════════════════════════════════════
console.log("\nrevizija");

check(RADNJE.KOMP !== RADNJE.KOMP_ROK, "otvaranje i pomeranje roka su DVE radnje u dnevniku");
check(
  RADNJE.KOMP === "user.beta_open" && RADNJE.KOMP_ROK === "user.beta_expiry",
  "vrednosti radnji su ostale stare — filter revizije mora da nađe i redove od pre S25",
);

{
  const ruta = readFileSync(
    path.join(webSrc, "app/api/admin/korisnici/[id]/komp/route.ts"),
    "utf8",
  );
  check(/export async function POST/.test(ruta), "ruta ima POST (otvori komp)");
  check(/export async function PATCH/.test(ruta), "ruta ima PATCH (samo rok)");
  check(
    (ruta.match(/saAuditom\(/g) ?? []).length === 2,
    "oba metoda idu kroz `saAuditom` (pravilo 14)",
  );
  check(
    (ruta.match(/pripremiRadnju\(/g) ?? []).length === 2,
    "oba metoda idu kroz `pripremiRadnju` (admin + tempo)",
  );
}

// ═══════════════════════════════════════════════════════════
// 5. nijedan DRUGI put ne dodeljuje `komp`
// ═══════════════════════════════════════════════════════════
console.log("\nnijedan drugi put");

function sviFajlovi(dir: string, izlaz: string[] = []): string[] {
  for (const unos of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, unos.name);
    if (unos.isDirectory()) {
      if (unos.name === "node_modules" || unos.name === ".next") continue;
      sviFajlovi(p, izlaz);
    } else if (/\.tsx?$/.test(unos.name)) {
      izlaz.push(p);
    }
  }
  return izlaz;
}

const izvori = [
  ...sviFajlovi(webSrc),
  ...sviFajlovi(path.join(koren, "packages/shared/src")),
  ...sviFajlovi(path.join(koren, "apps/worker/src")),
];

/**
 * Jedini fajl kome je dozvoljeno da napiše `plan: "komp"` — i to u `payload`-u
 * za dnevnik, ne u upisu. Sam upis radi `admin_open_komp` u SQL-u.
 */
const DOZVOLJEN = path.join(webSrc, "lib/admin-radnje.ts");

const upisujeKomp = izvori.filter(
  (f) => f !== DOZVOLJEN && /(?:plan|p_plan)\s*:\s*["'](?:komp|beta)["']/.test(readFileSync(f, "utf8")),
);
check(
  upisujeKomp.length === 0,
  `nijedan fajl osim admin-radnje.ts ne piše plan \`komp\`${
    upisujeKomp.length ? `: ${upisujeKomp.map((f) => path.relative(koren, f)).join(", ")}` : ""
  }`,
);

const zoveRpc = izvori.filter(
  (f) => f !== DOZVOLJEN && /rpc\(\s*["']admin_open_(?:komp|beta)["']/.test(readFileSync(f, "utf8")),
);
check(zoveRpc.length === 0, "`admin_open_komp` se zove sa tačno jednog mesta u kodu");

const zoveStaru = izvori.filter((f) => /admin_open_beta/.test(readFileSync(f, "utf8")));
check(zoveStaru.length === 0, "`admin_open_beta` više ne postoji nigde u izvoru");

// Registracija: krediti dobrodošlice, ali NIJEDAN plan.
//
// [S28] Do S28 je ovde stajalo „0 kredita". Broj je od S28 `ONBOARDING_CREDITS`
// (O1, §4) i to §1.1 ne krši: §1.1 zabranjuje besplatan PLAN, a ne kredite —
// nalog ostaje `dopuna`, dobija dva kredita u `credits_topup` i posle njih mora
// na cenovnik. Ono što ovaj test i dalje čuva je da se broj ne otkucava u
// `profile.ts` i da registracija ne uzima nijedan broj iz tabele planova
// (tim putem je do S20 nastajao doživotan beta nalog).
{
  const profil = readFileSync(path.join(webSrc, "lib/profile.ts"), "utf8");
  check(
    /KREDITI_NA_REGISTRACIJI\s*=\s*ONBOARDING_CREDITS\b/.test(profil),
    "registracija dodeljuje `ONBOARDING_CREDITS` iz kataloga, ne broj otkucan u ruti",
  );
  check(!/^import .*\bPLANS\b/m.test(profil), "registracija ne uvozi nijedan broj iz tabele planova");
}

// Webhook: plan koji nije plaćen se odbija — ista rečenica iz §1.1 kao za
// registraciju i kupon.
{
  const naplata = readFileSync(path.join(webSrc, "lib/billing.ts"), "utf8");
  check(
    /komp i dopuna se dodeljuju samo iz konzole/.test(naplata),
    "webhook odbija pokušaj plana `komp`",
  );
  check(!/NEXT_PUBLIC_STRIPE|customData|unmarshal/i.test(naplata), "naplata nema klijentskih ključeva ni starog provajdera");
}

// ═══════════════════════════════════════════════════════════
// 6. brana u bazi — poslednja i jedina koja drži izvan aplikacije
// ═══════════════════════════════════════════════════════════
console.log("\nbrana u bazi");

const migracije = path.join(koren, "supabase/migrations");
const svaSql = readdirSync(migracije)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(path.join(migracije, f), "utf8"))
  .join("\n");

check(/create trigger profiles_komp_guard/.test(svaSql), "triger `profiles_komp_guard` postoji");
check(
  (svaSql.match(/set_config\('sajtoskop\.komp'/g) ?? []).length === 1,
  "zastavica se pali sa tačno jednog mesta (`admin_open_komp`; pozivnica ide kroz njega)",
);
check(
  /drop trigger if exists profiles_beta_guard on profiles;/.test(svaSql),
  "stari triger `profiles_beta_guard` se briše u 0025",
);
check(
  /alter column plan set default 'dopuna'/.test(svaSql),
  "`profiles.plan` više nema `default 'beta'`",
);
check(
  /plan in \('komp', 'dopuna', 'starter', 'pro', 'advanced'\)/.test(svaSql),
  "profiles_plan_valid zna za `komp`, ne za `beta`",
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
