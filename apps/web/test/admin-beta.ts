// apps/web/test/admin-beta.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S20] Beta nalozi u admin konzoli. Jedno pravilo drži ceo fajl:
//
//   ‼️ Plan `beta` sme da nastane ISKLJUČIVO iz admin konzole (LANSIRANJE §1.1,
//      odluka D1). Nikad iz registracije, nikad iz kupona, nikad iz webhooka.
//
// To pravilo je do S20 bilo samo rečenica u dokumentu: `profiles.plan` je imao
// `default 'beta'`, a `beta_expires_at IS NULL` po §1.5 znači NEOGRANIČENO —
// dakle svaka registracija je otvarala doživotan besplatan nalog. S19 je rupu
// imenovao i ostavio je ovoj sesiji.
//
// ── podela posla između tri provere ─────────────────────────
//   · `pnpm check:sql` — TRIGER u bazi, nad pravom migracijom: goli `update` i
//     `insert` ne mogu da dodele `beta`, a zastavica iz `admin_open_beta` ne
//     curi u sledeću transakciju. To je jedini sloj koji drži i kad se
//     aplikacija zaobiđe, i zato se proverava tamo gde SQL zaista radi.
//   · ovaj fajl — sloj iznad: šta uopšte može da uđe u rute, i da nijedno drugo
//     mesto u izvoru ne upisuje `beta`.
//   · `packages/shared/test/pristup.ts` — da nepoznat i prazan plan više ne
//     padaju na `beta`, dakle da tipfeler u koloni nije doživotan pristup.
//
// Provera „nijedan drugi put" je namerno STATIČKA (čita izvor). Regresija koje
// se stvarno plašim nije „ruta je vratila pogrešan status" nego „neko je sutra
// dopisao `plan: 'beta'` u kuponu, zato što je tamo zgodno".

import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { DEFAULT_PLAN, PLANS } from "@sajtoskop/shared";

// Isti resolve hook kao u `ide-odmah.ts`, `dubina.ts`, `naplata.ts` i `pristup.ts`.
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
  BETA_PREDLOG,
  betaNalogBodySchema,
  betaRokBodySchema,
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
// 1. `beta` ne može kroz obrazac za plan
// ═══════════════════════════════════════════════════════════
console.log("\nplan: beta nije ponuđen i nije primljen");

check(!PLAN_OPCIJE.includes("beta"), "padajući spisak planova ne nudi `beta`");
check(
  PLAN_OPCIJE.length === Object.keys(PLANS).length - 1,
  "izbačen je tačno jedan plan, ostali su svi tu",
);
check(planBodySchema.safeParse({ plan: "beta" }).success === false, "šema odbija plan `beta`");
check(planBodySchema.safeParse({ plan: "starter" }).success, "šema i dalje prima plaćen plan");
check(planBodySchema.safeParse({ plan: "dopuna" }).success, "šema prima `dopuna`");

{
  // Drugi sloj: i kad telo sklopi neko ko šemu zaobilazi, radnja odbija sa
  // rečenicom, a ne izuzetkom iz Postgresa. Do baze se ne stiže — zato ovaj
  // poziv i radi bez ijednog stuba za Supabase.
  const ishod = await promeniPlan("user_neko", "beta");
  check(ishod.ok === false, "promeniPlan odbija `beta` i pre baze");
  check(!ishod.ok && ishod.status === 400, "odbijenica je 400, ne 500 iz baze");
  check(
    !ishod.ok && ishod.poruka.includes("beta"),
    "poruka imenuje plan i upućuje na pravi obrazac",
  );
}

check(DEFAULT_PLAN !== "beta", `podrazumevani plan je \`${DEFAULT_PLAN}\`, ne \`beta\``);
check("beta" in PLANS, "plan `beta` i dalje POSTOJI — zabranjen je put, ne pojam");

// ═══════════════════════════════════════════════════════════
// 2. rok: `null` je neograničeno, prošlost je dozvoljena
// ═══════════════════════════════════════════════════════════
console.log("\nrok bete");

check(betaRokBodySchema.safeParse({ do: null }).success, "`do: null` prolazi (NEOGRANIČENO)");
check(betaRokBodySchema.safeParse({ do: zaDana(30) }).success, "ISO datum u budućnosti prolazi");
check(
  betaRokBodySchema.safeParse({ do: zaDana(-5) }).success,
  "ISO datum u PROŠLOSTI prolazi — tako se beta gasi (§1.5)",
);
check(
  betaRokBodySchema.safeParse({ do: "2026-09-21" }).success === false,
  "goli `YYYY-MM-DD` nije ISO trenutak i ne prolazi",
);
check(
  betaRokBodySchema.safeParse({}).success === false,
  "izostavljen `do` NIJE isto što i `null` — tišina ne sme da postane neograničena beta",
);
check(
  betaRokBodySchema.safeParse({ do: null, plan: "beta" }).success === false,
  "strictObject: plan se ne provlači uz rok",
);
check(
  betaRokBodySchema.safeParse({ do: zaDana(365 * 20) }).success === false,
  "rok 20 godina unapred je omaška u godini, ne odluka",
);

// ═══════════════════════════════════════════════════════════
// 3. otvaranje beta naloga: tri polja, jedan poziv
// ═══════════════════════════════════════════════════════════
console.log("\notvaranje beta naloga");

const REF = "adm:0193b7c2-4c1a-4f0e-9a3d-1f2e3d4c5b6a";
const telo = (over: Record<string, unknown> = {}) => ({
  do: zaDana(30),
  krediti: 50,
  refId: REF,
  ...over,
});

check(betaNalogBodySchema.safeParse(telo()).success, "predlog (50 kredita, rok) prolazi");
check(betaNalogBodySchema.safeParse(telo({ do: null })).success, "neograničena beta prolazi");
check(betaNalogBodySchema.safeParse(telo({ krediti: 0 })).success, "0 kredita prolazi (produženje)");
check(
  betaNalogBodySchema.safeParse(telo({ krediti: -5 })).success === false,
  "negativan broj kredita odbijen — oduzimanje ide kroz korekciju, ne kroz betu",
);
check(
  betaNalogBodySchema.safeParse(telo({ krediti: 501 })).success === false,
  "preko 500 kredita odbijeno (ista granica kao u RPC-u)",
);
check(
  betaNalogBodySchema.safeParse(telo({ refId: "scan:12" })).success === false,
  "tuđ prostor imena u `refId` odbijen — idempotencije se ne smeju sudariti",
);
check(
  betaNalogBodySchema.safeParse({ do: null, krediti: 50 }).success === false,
  "bez `refId` nema idempotencije, pa nema ni radnje",
);

check(
  BETA_PREDLOG.krediti === PLANS.beta.monthlyCredits && BETA_PREDLOG.dana === 30,
  `predlog je ${BETA_PREDLOG.krediti} kredita i ${BETA_PREDLOG.dana} dana (odluka P6)`,
);

// ═══════════════════════════════════════════════════════════
// 4. trag u reviziji
// ═══════════════════════════════════════════════════════════
console.log("\nrevizija");

check(RADNJE.BETA !== RADNJE.BETA_ROK, "otvaranje i pomeranje roka su DVE radnje u dnevniku");

{
  const ruta = readFileSync(
    path.join(webSrc, "app/api/admin/korisnici/[id]/beta/route.ts"),
    "utf8",
  );
  check(/export async function POST/.test(ruta), "ruta ima POST (otvori beta nalog)");
  check(/export async function PATCH/.test(ruta), "ruta ima PATCH (samo rok)");
  // Pravilo 14: red u dnevniku i na uspeh i na pad. `saAuditom` je jedini omotač
  // koji to garantuje, pa ruta koja ga ne zove nema trag ni kad prođe.
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
// 5. nijedan DRUGI put ne dodeljuje `beta`
// ═══════════════════════════════════════════════════════════
// Ovo je provera zbog koje ceo fajl postoji. Ne testira ponašanje nego IZVOR:
// da sutra niko ne dopiše `plan: "beta"` u kupon, u onboarding ili u webhook,
// zato što je tamo zgodno.
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
 * Jedini fajl kome je dozvoljeno da napiše `plan: "beta"` — i to u `payload`-u
 * za dnevnik, ne u upisu. Sam upis radi `admin_open_beta` u SQL-u.
 */
const DOZVOLJEN = path.join(webSrc, "lib/admin-radnje.ts");

const upisujeBetu = izvori.filter(
  (f) => f !== DOZVOLJEN && /(?:plan|p_plan)\s*:\s*["']beta["']/.test(readFileSync(f, "utf8")),
);
check(
  upisujeBetu.length === 0,
  `nijedan fajl osim admin-radnje.ts ne piše plan \`beta\`${
    upisujeBetu.length ? `: ${upisujeBetu.map((f) => path.relative(koren, f)).join(", ")}` : ""
  }`,
);

// Traži se POZIV, ne pomen: `packages/shared/src/db.ts` funkciju legitimno
// imenuje u tipu njenog rezultata.
const zoveRpc = izvori.filter(
  (f) => f !== DOZVOLJEN && /rpc\(\s*["']admin_open_beta["']/.test(readFileSync(f, "utf8")),
);
check(zoveRpc.length === 0, "`admin_open_beta` se zove sa tačno jednog mesta u kodu");

// Registracija. Do S20 je ovde stajalo `PLANS.beta.monthlyCredits`, dakle 50
// kredita uz plan koji je kolona dodeljivala sama.
{
  const profil = readFileSync(path.join(webSrc, "lib/profile.ts"), "utf8");
  check(
    /KREDITI_NA_REGISTRACIJI\s*=\s*0\b/.test(profil),
    "registracija dodeljuje 0 kredita (nema besplatnog plana za javnost, §1.1)",
  );
  // Uvoza `PLANS` u ovom fajlu više nema — komentar koji objašnjava šta je tu
  // nekad stajalo sme da ostane, sam uvoz ne sme.
  check(
    !/^import .*\bPLANS\b/m.test(profil),
    "registracija ne uvozi više nijedan broj iz tabele planova",
  );
}

// Webhook. Provera je iz S18 i mora da ostane — ovde je zato što je „kupon,
// webhook, registracija" jedna te ista rečenica iz §1.1, pa treba i da padne
// zajedno.
{
  const naplata = readFileSync(path.join(webSrc, "lib/billing.ts"), "utf8");
  check(
    /beta se dodeljuje samo iz konzole|beta i dopuna se dodeljuju samo iz konzole/.test(naplata),
    "webhook i dalje odbija pokušaj plana `beta`",
  );
}

// ═══════════════════════════════════════════════════════════
// 6. brana u bazi — poslednja i jedina koja drži izvan aplikacije
// ═══════════════════════════════════════════════════════════
// PONAŠANJE trigera proverava `pnpm check:sql` nad pravim Postgresom. Ovde je
// samo da migracija koja ga uvodi nije nestala, i — što je važnije — da se
// zastavica pali sa TAČNO JEDNOG mesta. Drugi `set_config('sajtoskop.beta'…)`
// bilo gde u migracijama bi bio drugi ključ od iste brave.
console.log("\nbrana u bazi");

const migracije = path.join(koren, "supabase/migrations");
const svaSql = readdirSync(migracije)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(path.join(migracije, f), "utf8"))
  .join("\n");

check(/create trigger profiles_beta_guard/.test(svaSql), "triger `profiles_beta_guard` postoji");
check(
  (svaSql.match(/set_config\('sajtoskop\.beta'/g) ?? []).length === 1,
  "zastavica se pali sa tačno jednog mesta (`admin_open_beta`)",
);
check(
  /alter column plan set default 'dopuna'/.test(svaSql),
  "`profiles.plan` više nema `default 'beta'`",
);

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
