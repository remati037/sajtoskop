// apps/web/test/aktiviraj.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S26] „Aktiviraj odmah" (naplata-stripe.md §7.4). Ruta naplaćuje pravu
// karticu odmah, pa su pravila koja ovde drže sva o tome KOJA pretplata i
// KADA:
//
//   1. Van probe → 409, i Stripe se ne zove ni jednom. Aktivna pretplata ne
//      sme da dobije drugu fakturu u istom periodu.
//   2. Pretplata dolazi iz baze po `userId` iz sesije, NIKAD iz tela zahteva.
//      Telo je prazno i šema odbija svako polje (`strictObject({})`).
//   3. Otkazana proba se ne aktivira — to bi naplatilo mesec pretplati koja se
//      na kraju tog meseca gasi.
//   4. Odbijena kartica je 402 i proba ostaje (`error_if_incomplete`).
//
// Odluka živi u `lib/aktiviraj.ts` bez Supabase-a i Stripe-a, pa se ovde
// proverava sa lažnim zavisnostima — bez mreže. Ožičenje rute (koji upit, koji
// Stripe poziv) proverava se statički, kao i ostale billing rute.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  aktivirajProbu,
  type IshodStripea,
  type PretplataZaAktivaciju,
  type ZavisnostiAktivacije,
} from "../src/lib/aktiviraj";
import { aktivirajBodySchema } from "../src/lib/billing-schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");
const izvor = (rel: string) => readFileSync(path.join(webSrc, rel), "utf8");
const bezKomentara = (kod: string) =>
  kod
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ── lažna baza i lažni Stripe ──────────────────────────────
// Baza je mapa `user_id → red`, i upit radi ISTO što i pravi u ruti: po
// `user_id`, samo `trialing`. Stripe beleži svaki poziv.

type Red = PretplataZaAktivaciju & { userId: string };

function svet(redovi: Red[], stripeKaze: IshodStripea = "ok") {
  const zvaniStripe: string[] = [];
  const citanja: string[] = [];
  const z: ZavisnostiAktivacije = {
    async citajProbu(userId) {
      citanja.push(userId);
      const r = redovi.find((x) => x.userId === userId && x.status === "trialing");
      return r ? { subscriptionId: r.subscriptionId, status: r.status, cancelAtPeriodEnd: r.cancelAtPeriodEnd } : null;
    },
    async zavrsiProbu(subscriptionId) {
      zvaniStripe.push(subscriptionId);
      return stripeKaze;
    },
  };
  return { z, zvaniStripe, citanja };
}

// ── 1. van probe ───────────────────────────────────────────
console.log("van probe → 409");

{
  const { z, zvaniStripe } = svet([]);
  const r = await aktivirajProbu("user_a", z);
  check(!r.ok && r.status === 409 && r.kod === "nije_u_probi", "nalog bez pretplate → 409 nije_u_probi");
  check(zvaniStripe.length === 0, "Stripe se ne zove kad probe nema");
}

{
  const { z, zvaniStripe } = svet([
    { userId: "user_a", subscriptionId: "sub_aktivna", status: "active", cancelAtPeriodEnd: false },
  ]);
  const r = await aktivirajProbu("user_a", z);
  check(!r.ok && r.status === 409, "aktivna pretplata → 409 (nema druge fakture u istom periodu)");
  check(zvaniStripe.length === 0, "Stripe se ne zove za aktivnu pretplatu");
}

{
  // Pojas i tregeri: i kad bi upit vratio ne-`trialing` red (neko skine
  // filter), odluka ga odbija.
  const z: ZavisnostiAktivacije = {
    citajProbu: async () => ({ subscriptionId: "sub_x", status: "past_due", cancelAtPeriodEnd: false }),
    zavrsiProbu: async () => {
      throw new Error("Stripe ne sme da se zove");
    },
  };
  const r = await aktivirajProbu("user_a", z);
  check(!r.ok && r.status === 409, "red koji nije `trialing` odbija i sama odluka, ne samo upit");
}

{
  const { z, zvaniStripe } = svet([
    { userId: "user_a", subscriptionId: "sub_otkazana", status: "trialing", cancelAtPeriodEnd: true },
  ]);
  const r = await aktivirajProbu("user_a", z);
  check(!r.ok && r.status === 409 && r.kod === "proba_otkazana", "otkazana proba → 409 proba_otkazana");
  check(zvaniStripe.length === 0, "otkazana proba se ne naplaćuje");
}

// ── 2. pretplata iz baze, ne iz tela ───────────────────────
console.log("\npretplata iz baze, po sesiji");

{
  const { z, zvaniStripe, citanja } = svet([
    { userId: "user_a", subscriptionId: "sub_od_a", status: "trialing", cancelAtPeriodEnd: false },
    { userId: "user_b", subscriptionId: "sub_od_b", status: "trialing", cancelAtPeriodEnd: false },
  ]);
  const r = await aktivirajProbu("user_a", z);
  check(r.ok && r.status === 200, "proba → 200");
  check(citanja.length === 1 && citanja[0] === "user_a", "baza se pita po userId iz sesije");
  check(
    zvaniStripe.length === 1 && zvaniStripe[0] === "sub_od_a",
    "Stripe dobija TAČNO pretplatu tog korisnika, nikad tuđu",
  );
}

check(aktivirajBodySchema.safeParse({}).success, "prazno telo prolazi");
check(
  !aktivirajBodySchema.safeParse({ subscriptionId: "sub_tudja" }).success,
  "`subscriptionId` u telu → odbijeno (strictObject)",
);
check(!aktivirajBodySchema.safeParse({ userId: "user_b" }).success, "`userId` u telu → odbijeno");
check(!aktivirajBodySchema.safeParse(null).success, "`null` telo → odbijeno");
check(!aktivirajBodySchema.safeParse([]).success, "niz kao telo → odbijeno");

// ── 3. Stripe odgovori ─────────────────────────────────────
console.log("\nStripe odgovori");

{
  const { z } = svet(
    [{ userId: "user_a", subscriptionId: "sub_a", status: "trialing", cancelAtPeriodEnd: false }],
    "kartica_odbijena",
  );
  const r = await aktivirajProbu("user_a", z);
  check(!r.ok && r.status === 402 && r.kod === "kartica_odbijena", "odbijena kartica → 402");
  check(!r.ok && r.poruka.includes("Proba traje dalje"), "poruka kaže da proba ostaje");
}

{
  // Naš red kasni za webhookom: baza kaže `trialing`, Stripe već zna da nije.
  const { z } = svet(
    [{ userId: "user_a", subscriptionId: "sub_a", status: "trialing", cancelAtPeriodEnd: false }],
    "nije_u_probi",
  );
  const r = await aktivirajProbu("user_a", z);
  check(!r.ok && r.status === 409, "Stripe kaže da proba više ne traje (dupli klik) → 409");
}

// ── 4. ožičenje rute ───────────────────────────────────────
console.log("\nruta");

{
  const kod = izvor("app/api/billing/aktiviraj/route.ts");
  const cist = bezKomentara(kod);

  check(cist.includes("requireUserId()"), "korisnik iz Clerk sesije (pravilo 8)");
  check(cist.includes("aktivirajBodySchema.safeParse"), "telo ide kroz Zod šemu");
  check(
    !/(raw|telo|body)\s*(\?\.|\.)\s*(subscriptionId|subscription_id|userId|user_id)/.test(cist) &&
      !/searchParams/.test(cist),
    "nijedan ID se ne čita iz tela ni iz query-ja",
  );
  check(
    cist.includes('.eq("user_id", userId)') && cist.includes('.eq("status", "trialing")'),
    "pretplata se nalazi po user_id i statusu trialing",
  );
  check(
    cist.includes('trial_end: "now"') && cist.includes('proration_behavior: "none"'),
    "Stripe: trial_end now, bez proracije (§7.4)",
  );
  check(cist.includes('payment_behavior: "error_if_incomplete"'), "odbijena kartica ne završava probu");
  check(cist.includes("subscriptions.retrieve("), "stanje se proverava u Stripe-u pre izmene (dupli klik)");
  check(cist.includes("proveriIpTempo("), "ruta ima IP tempo");
  check(cist.includes('"nodejs"'), "runtime je nodejs");
  check(
    cist.includes("err instanceof KonfigGreska") && /503,?\s*\)/.test(cist),
    "nepodešena naplata je 503, ne 502",
  );
  check(
    !/credits_balance|rpc\(|\.update\(\{/.test(cist.replace(/subscriptions\.update\(/g, "")),
    "ruta ne dira kredite ni bazu — to rade webhookovi",
  );

  const dugme = bezKomentara(izvor("components/aktiviraj-odmah.tsx"));
  check(dugme.includes('body: "{}"'), "klijent šalje prazno telo");
  check(!/subscription/i.test(dugme), "klijent ne zna ni za jedan ID pretplate");
  check(dugme.includes('variant="secondary"'), "dugme na strani je sekundarno (§7.1)");
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
