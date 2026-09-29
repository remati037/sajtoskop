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
//
// [dfb52a7] ID događaja iz `svix-id` ZAGLAVLJA. Ruta ga je čitala iz polja
// `id` u telu, koje Clerk ne šalje — svaki ispravno potpisan događaj je vraćao
// 400 i nijedan nije stigao do baze. Sekcija 4 pušta PRAVU rutu i pravi
// `verifyWebhook` nad zahtevom potpisanim kao što Svix potpisuje; lažni su samo
// baza, profil, revizija i Sentry.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");
const stubs = pathToFileURL(path.resolve(here, "../../../scripts/lib/next-stubs.ts")).href;

// Moduli koje ruta webhooka uvozi, a koji bi van Next-a tražili bazu, Stripe ili
// Sentry. Stanje deli sa testom kroz `globalThis.__clerkWebhook` (sekcija 4).
// Ključ je TAČAN specifikator iz rute — `lib/otkazivanje.ts` i ostali uvoze
// relativno, pa ih ovo ne dotiče.
const LAZNI_MODULI: Record<string, string> = {
  "@/lib/supabase": `
    const s = () => globalThis.__clerkWebhook;
    export function adminSupabase() {
      return {
        from(tabela) {
          return {
            insert(red) {
              s().markeri.push({ tabela, ...red });
              return { select: () => ({ maybeSingle: async () => ({ data: { event_id: red.event_id }, error: null }) }) };
            },
            delete() {
              const upit = { eq: () => upit, then: (ok) => ok({ error: null }) };
              return upit;
            },
          };
        },
      };
    }`,
  "@/lib/profile": `
    const s = () => globalThis.__clerkWebhook;
    export async function createProfileFromWebhook(userId, email, refId) {
      s().profili.push({ userId, email, refId });
      return { reason: "created" };
    }
    export async function obrisiProfil() { return false; }
    export async function stripeKupacZaNalog() { return null; }`,
  "@/lib/admin": `
    export const RADNJE = { KASKADA: "user.cascade" };
    export async function upisiAudit() {}`,
  "@/lib/sentry": `
    export function prijaviGresku(err) { globalThis.__clerkWebhook.greske.push(String(err)); }`,
};

registerHooks({
  resolve(specifier, context, next) {
    if (["server-only", "next/navigation", "@clerk/nextjs/server"].includes(specifier)) {
      return { url: stubs, shortCircuit: true };
    }
    if (specifier in LAZNI_MODULI) {
      return { url: `lazno:${specifier}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(path.join(webSrc, specifier.slice(2))).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("lazno:")) {
      return { format: "module", source: LAZNI_MODULI[url.slice("lazno:".length)], shortCircuit: true };
    }
    return next(url, context);
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

// ═══════════════════════════════════════════════════════════
// 4. ID DOGAĐAJA IZ `svix-id` ZAGLAVLJA (dfb52a7)
// ═══════════════════════════════════════════════════════════
console.log("\nID događaja dolazi iz `svix-id` zaglavlja, ne iz tela");

{
  type Stanje = {
    markeri: { tabela: string; provider: string; event_id: string }[];
    profili: { userId: string; email: string | null; refId: string }[];
    greske: string[];
  };
  const stanje: Stanje = { markeri: [], profili: [], greske: [] };
  (globalThis as Record<string, unknown>).__clerkWebhook = stanje;

  // Svix tajna je `whsec_` + base64 ključ; potpis je HMAC-SHA256 nad
  // `${svix-id}.${svix-timestamp}.${telo}` (isto što proverava `verifyWebhook`).
  const kljuc = Buffer.from("test-kljuc-za-clerk-webhook-32b!");
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = `whsec_${kljuc.toString("base64")}`;

  const potpisan = (svixId: string, telo: string, potpisId = svixId): Request => {
    const ts = String(Math.floor(Date.now() / 1000));
    const potpis = createHmac("sha256", kljuc).update(`${potpisId}.${ts}.${telo}`).digest("base64");
    return new Request("https://app.sajtoskop.test/api/webhooks/clerk", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": svixId,
        "svix-timestamp": ts,
        "svix-signature": `v1,${potpis}`,
      },
      body: telo,
    });
  };

  // Oblik koji Clerk stvarno šalje: na vrhu `data`, `object`, `type`,
  // `timestamp`, `instance_id` — BEZ `id`.
  const dogadjaj = (userId: string, dodatno: Record<string, unknown> = {}): string =>
    JSON.stringify({
      data: {
        id: userId,
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: "test@sajtoskop.test" }],
      },
      object: "event",
      type: "user.created",
      timestamp: Date.now(),
      instance_id: "ins_test",
      ...dodatno,
    });

  const { POST } = await import("../src/app/api/webhooks/clerk/route");
  type Zahtev = Parameters<typeof POST>[0];
  const posalji = (r: Request): Promise<Response> => POST(r as Zahtev);

  // a) Pravi Clerk događaj, telo bez `id`.
  {
    const odg = await posalji(potpisan("msg_iz_zaglavlja_1", dogadjaj("user_wh_1")));
    check(odg.status === 200, `potpisan događaj bez \`id\` u telu → 200 (dobijeno ${odg.status})`);
    check(
      stanje.markeri.length === 1 &&
        stanje.markeri[0]?.tabela === "webhook_events" &&
        stanje.markeri[0]?.provider === "clerk" &&
        stanje.markeri[0]?.event_id === "msg_iz_zaglavlja_1",
      `marker u \`webhook_events\` nosi \`svix-id\` (${stanje.markeri[0]?.event_id ?? "nema markera"})`,
    );
    check(
      stanje.profili.length === 1 && stanje.profili[0]?.refId === "signup:user_wh_1",
      "događaj je stigao do upisa profila",
    );
  }

  // b) Telo nosi SVOJ `id` — i dalje se ne čita.
  {
    stanje.markeri.length = 0;
    const odg = await posalji(
      potpisan("msg_iz_zaglavlja_2", dogadjaj("user_wh_2", { id: "evt_iz_tela" })),
    );
    check(odg.status === 200, `telo sa \`id\` → 200 (dobijeno ${odg.status})`);
    check(
      stanje.markeri[0]?.event_id === "msg_iz_zaglavlja_2",
      `\`id\` iz tela se ignoriše, marker je iz zaglavlja (${stanje.markeri[0]?.event_id ?? "nema markera"})`,
    );
  }

  // c) Zaglavlje se ne može podmetnuti: potpis pokriva i `svix-id`.
  {
    stanje.markeri.length = 0;
    const odg = await posalji(potpisan("msg_podmetnut", dogadjaj("user_wh_3"), "msg_potpisan"));
    check(odg.status === 400, `izmenjen \`svix-id\` obara potpis → 400 (dobijeno ${odg.status})`);
    check(stanje.markeri.length === 0, "bez ispravnog potpisa nema markera");
  }

  // d) Statički: ID se uzima SAMO iz zaglavlja, a proverava tek posle potpisa.
  {
    const ruta = readFileSync(path.join(webSrc, "app/api/webhooks/clerk/route.ts"), "utf8");
    const kod = ruta.replace(/\/\/.*$/gm, "");
    check(
      /const eventId = req\.headers\.get\("svix-id"\)/.test(kod) &&
        (kod.match(/\beventId\s*=/g) ?? []).length === 1,
      "`eventId` ima jedan izvor: `req.headers.get(\"svix-id\")`",
    );
    check(!/\bevent\.id\b|\bbody\.id\b|\bpayload\.id\b/.test(kod), "nigde se ne čita `event.id` iz tela");
    check(
      kod.indexOf("verifyWebhook(req") > 0 && kod.indexOf("verifyWebhook(req") < kod.indexOf("if (!eventId)"),
      "provera prisustva ID-ja stoji POSLE `verifyWebhook` — zaglavlju se veruje tek uz potpis",
    );
  }

  check(stanje.greske.length === 0, `nijedna greška nije prijavljena Sentry-ju (${stanje.greske.join("; ")})`);
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
