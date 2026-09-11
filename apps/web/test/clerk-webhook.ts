// apps/web/test/clerk-webhook.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S28, C6] Brisanje naloga i ŽIVA pretplata. Ovo je jedina putanja u projektu
// na kojoj greška ne košta kredit nego pravu naplatu prave kartice: profil
// obrisan, pretplata ostala `active`, Stripe naplaćuje nalog koji u aplikaciji
// više ne postoji, a sledeća `invoice.paid` stigne za korisnika koga webhook
// naplate ne nalazi.
//
// Šta je ovde STVARNO, a šta lažno:
//   · STVARNO: odluka koje pretplate se otkazuju i kojim argumentima, redosled
//     (Stripe pa baza) i to da pad zaustavlja brisanje. To je ceo C6.
//   · LAŽNO: Stripe klijent (tri funkcije, bez mreže — `StripeZaOtkazivanje`
//     postoji baš zato) i Svix potpis. Potpis pokriva `test/naplata.ts` nad
//     Stripe webhookom; ovde bi bio treći HMAC bez ijedne nove tvrdnje.
//   · STATIČKI: da ruta `user.deleted` zaista zove otkazivanje PRE
//     `obrisiProfil` i da pad vraća 500. Regresija koje se plašim nije „vratila
//     je pogrešan status" nego „neko je preuredio redosled".

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");
const stubs = pathToFileURL(path.resolve(here, "../../../scripts/lib/next-stubs.ts")).href;

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

const { otkaziPretplateNaloga, STATUSI_ZA_OTKAZIVANJE } = await import("../src/lib/otkazivanje");
type StripeZaOtkazivanje = import("../src/lib/otkazivanje").StripeZaOtkazivanje;

let fail = 0;
const check = (ok: boolean, line: string): void => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

const KUPAC = "cus_test_1";
const KORISNIK = "user_test_1";

type Poziv = { id: string; prorate: boolean };

/**
 * Lažni Stripe: tri funkcije koje `otkaziPretplateNaloga` koristi, i beleška o
 * tome šta je pozvano. `pukni` pravi grešku iz mreže na `cancel`.
 */
function lazniStripe(
  pretplate: { id: string; status: string }[],
  opcije: { pukni?: string } = {},
): {
  klijent: StripeZaOtkazivanje;
  otkazani: Poziv[];
  meta: Record<string, string>[];
  /** Brojač u OBJEKTU: destrukturiran broj bi ostao na nuli (kopija vrednosti). */
  brojac: { listanja: number };
} {
  const otkazani: Poziv[] = [];
  const meta: Record<string, string>[] = [];
  const brojac = { listanja: 0 };

  const klijent: StripeZaOtkazivanje = {
    subscriptions: {
      async list(args) {
        brojac.listanja++;
        check(args.customer === KUPAC, "list ide po kupcu naloga");
        check(args.status === "all", "list traži sve statuse, pa se filtrira u kodu");
        return { data: pretplate.filter(() => true) };
      },
      async cancel(id, args) {
        if (opcije.pukni === id) throw new Error("Stripe ne odgovara");
        otkazani.push({ id, prorate: args.prorate });
        return { id, status: "canceled" };
      },
    },
    customers: {
      async update(id, args) {
        check(id === KUPAC, "marker ide na kupca naloga");
        meta.push(args.metadata);
        return { id };
      },
    },
  };

  return { klijent, otkazani, meta, brojac };
}

// ═══════════════════════════════════════════════════════════
// 1. KOJI STATUSI SE OTKAZUJU
// ═══════════════════════════════════════════════════════════
console.log("\notkazuju se samo pretplate koje mogu da naplate");

check(
  STATUSI_ZA_OTKAZIVANJE.length === 3 &&
    STATUSI_ZA_OTKAZIVANJE.includes("trialing") &&
    STATUSI_ZA_OTKAZIVANJE.includes("active") &&
    STATUSI_ZA_OTKAZIVANJE.includes("past_due"),
  "spisak je trialing / active / past_due (C6)",
);

{
  const { klijent, otkazani, meta, brojac } = lazniStripe([
    { id: "sub_trial", status: "trialing" },
    { id: "sub_active", status: "active" },
    { id: "sub_past_due", status: "past_due" },
    { id: "sub_canceled", status: "canceled" },
    { id: "sub_unpaid", status: "unpaid" },
    { id: "sub_incomplete", status: "incomplete_expired" },
    { id: "sub_paused", status: "paused" },
  ]);

  const ishod = await otkaziPretplateNaloga(KORISNIK, KUPAC, klijent);

  check(brojac.listanja === 1, "jedan `list` poziv, ne jedan po statusu");
  check(
    otkazani.map((p) => p.id).join(",") === "sub_trial,sub_active,sub_past_due",
    `otkazane su tri žive pretplate (${otkazani.map((p) => p.id).join(", ") || "nijedna"})`,
  );
  check(
    otkazani.every((p) => p.prorate === false),
    "svaka je otkazana sa `prorate: false` — nalog koji nestaje ne dobija delimičnu fakturu",
  );
  check(
    ishod.preskocene.length === 4 && !ishod.otkazane.includes("sub_canceled"),
    "već mrtve pretplate se NE diraju (cancel nad otkazanom je greška, a greška bi zaustavila brisanje zauvek)",
  );
  check(
    meta.length === 1 && meta[0]?.deleted_user === "1" && typeof meta[0]?.deleted_at === "string",
    "kupac je obeležen `deleted_user`, i to POSLE otkazivanja",
  );
  check(
    Object.keys(meta[0] ?? {}).every((k) => k === "deleted_user" || k === "deleted_at"),
    "marker ne prepisuje ostalu metadata (Stripe spaja ključeve, `user_id` ostaje)",
  );
}

// Nalog koji nikad nije bio na checkoutu nema kupca; ruta tada ni ne zove
// Stripe (grana `kupac ? … : null`), pa se ovde proverava samo da funkcija nad
// kupcem bez pretplata ne radi ništa osim markera.
{
  const { klijent, otkazani, meta } = lazniStripe([]);
  const ishod = await otkaziPretplateNaloga(KORISNIK, KUPAC, klijent);
  check(
    otkazani.length === 0 && ishod.otkazane.length === 0 && meta.length === 1,
    "kupac bez pretplata → nijedan cancel, marker ipak upisan",
  );
}

// ═══════════════════════════════════════════════════════════
// 2. PAD STRIPE-A ZAUSTAVLJA BRISANJE
// ═══════════════════════════════════════════════════════════
console.log("\npad Stripe-a ne sme da pusti brisanje dalje");

{
  const { klijent, otkazani, meta } = lazniStripe(
    [
      { id: "sub_a", status: "active" },
      { id: "sub_b", status: "active" },
    ],
    { pukni: "sub_b" },
  );

  let puklo = false;
  try {
    await otkaziPretplateNaloga(KORISNIK, KUPAC, klijent);
  } catch {
    puklo = true;
  }

  check(puklo, "greška iz Stripe-a se BACA (ruta je pretvara u 500, Svix ponavlja)");
  check(otkazani.length === 1, "prva pretplata je otkazana, druga nije — ponovljena isporuka je dokrajčuje");
  check(meta.length === 0, "marker se ne upisuje dok sve pretplate nisu stale");
}

// ═══════════════════════════════════════════════════════════
// 3. RUTA: REDOSLED I STATUS (statički)
// ═══════════════════════════════════════════════════════════
console.log("\nuser.deleted: prvo Stripe, pa baza");

{
  const ruta = readFileSync(path.join(webSrc, "app/api/webhooks/clerk/route.ts"), "utf8");

  const iOtkazivanje = ruta.indexOf("otkaziPretplateNaloga(");
  const iBrisanje = ruta.indexOf("obrisiProfil(obrisanId)");
  const iKupac = ruta.indexOf("stripeKupacZaNalog(");

  check(iKupac > 0 && iOtkazivanje > iKupac, "ruta čita `stripe_customer_id` pa otkazuje");
  check(
    iOtkazivanje > 0 && iBrisanje > 0 && iOtkazivanje < iBrisanje,
    "otkazivanje stoji PRE `obrisiProfil` — obrnuto ostavlja živu pretplatu bez naloga",
  );
  check(
    /catch \(err\)[\s\S]{0,900}?status: 500/.test(ruta.slice(iOtkazivanje)),
    "pad u toj grani vraća 500 (Svix ponavlja), ne 200",
  );
  check(
    /otkazane: otkazivanje\?\.otkazane/.test(ruta),
    "revizija (`admin_audit`) nosi spisak otkazanih pretplata (pravilo 14)",
  );
  check(
    !/(password|token|card|payment_method)/i.test(
      ruta.slice(ruta.indexOf("payload: {"), ruta.indexOf("ok: true,")),
    ),
    "payload nema ništa o kartici, tokenu ni lozinci (pravilo 14)",
  );
}

{
  const lib = readFileSync(path.join(webSrc, "lib/otkazivanje.ts"), "utf8");
  check(/import "server-only"/.test(lib), "`lib/otkazivanje.ts` je server-only");
  check(/prorate: false/.test(lib), "`prorate: false` stoji u kodu, ne u komentaru");
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
