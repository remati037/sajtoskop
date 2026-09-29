// packages/shared/test/sentry-scrub.ts
// Pokretanje: pnpm --filter @sajtoskop/shared test  (ili `pnpm test` iz korena)
//
// [checklista 2.1] Dokaz da `beforeSend` ne pušta lični podatak u Sentry.
//
// Događaj ispod je sastavljen u obliku koji Sentry SDK stvarno šalje
// (`request`, `exception.values[].stacktrace.frames`, `breadcrumbs`, `extra`,
// `contexts`, `user`) i u svako polje je podmetnut po jedan podatak koji ne sme
// da izađe. Test zatim serijalizuje ceo izlaz i traži svaki od njih kao
// podniz — dakle ne proverava samo polja za koja znamo, nego i ona koja bi
// SDK sutra dodao, sve dok nose isti tekst.

import { ocistiSentryDogadjaj, ocistiTekst, sentryPrikupljanje } from "../src/index";

let fail = 0;
function check(ok: boolean, line: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
}

// ── tajne koje ne smeju da izađu ────────────────────────────
const MEJL = "vlasnik.firme@gmail.com";
const MEJL_2 = "info@pvc-sabac.rs";
const TEL = "+381 64 123 4567";
const TEL_2 = "015/345-678";
const TEL_3 = "0601234567";
const SAJT = "https://www.stolarija-petrovic.rs/kontakt?utm=1";
const SAJT_GOLI = "zubar-nis.co.rs";
const TELO = '{"placeId":"ChIJ123","ponovi":true}';
const BEARER = "Bearer sk_live_nesto_tajno_123";
const STRIPE_POTPIS = "t=1727600000,v1=abcdef0123456789";
const SVIX_POTPIS = "v1,QmFzZTY0UG90cGlz";
const KOLACIC = "__session=eyJhbGciOiJSUzI1NiJ9.telo.potpis";
const CLERK_AUTH = "signed-in";
const QUERY = "grad=sabac&nisa=pvc-stolarija";

const dogadjaj = {
  event_id: "0123456789abcdef0123456789abcdef",
  timestamp: 1727600000,
  platform: "node",
  environment: "production",
  level: "error",
  server_name: "hetzner-worker",
  message: `Slanje na ${MEJL} nije uspelo`,
  request: {
    method: "POST",
    url: `https://app.sajtoskop.com/api/unlock?${QUERY}`,
    query_string: QUERY,
    data: TELO,
    cookies: { __session: KOLACIC },
    headers: {
      "content-type": "application/json",
      "user-agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
      host: "app.sajtoskop.com",
      authorization: BEARER,
      Authorization: BEARER,
      cookie: KOLACIC,
      "stripe-signature": STRIPE_POTPIS,
      "svix-id": "msg_2abc",
      "svix-timestamp": "1727600000",
      "svix-signature": SVIX_POTPIS,
      "x-clerk-auth-status": CLERK_AUTH,
      "x-clerk-auth-token": KOLACIC,
    },
  },
  user: { id: "user_2abcDEF", email: MEJL, ip_address: "93.87.12.34", username: "petar" },
  exception: {
    values: [
      {
        type: "Error",
        value: `fetch ${SAJT} pao: getaddrinfo ENOTFOUND ${SAJT_GOLI}, zovi ${TEL}`,
        stacktrace: {
          frames: [
            {
              filename: "/app/apps/worker/src/lib/fetch-site.ts",
              abs_path: "/app/apps/worker/src/lib/fetch-site.ts",
              function: "fetchSite",
              lineno: 120,
              context_line: "  const res = await fetch(url);",
              vars: { url: SAJT, phone: TEL_2, kontakt: `piši na ${MEJL_2}` },
            },
          ],
        },
      },
    ],
  },
  breadcrumbs: [
    { category: "console", message: `[kartica] prospekt ${SAJT_GOLI} tel ${TEL_3}` },
    { category: "http", data: { url: SAJT, method: "GET", status_code: 500 } },
    {
      category: "http",
      data: { url: "https://abcd.supabase.co/rest/v1/profiles?id=eq.user_2abc", method: "GET" },
    },
  ],
  extra: {
    website_url: SAJT,
    email: MEJL,
    websiteUri: SAJT_GOLI,
    body: TELO,
    napomena: `korisnik ${MEJL} je platio`,
  },
  contexts: { posao: { tip: "enrich_full", payload: { place_id: "ChIJ123", website: SAJT } } },
  tags: { oblast: "api/unlock", kontakt: MEJL },
};

const ulazPre = JSON.stringify(dogadjaj);
const izlaz = ocistiSentryDogadjaj(dogadjaj);
const tekst = JSON.stringify(izlaz);

console.log("\n── ništa od ovoga ne sme da izađe ──");
const zabranjeno: [string, string][] = [
  ["mejl korisnika", MEJL],
  ["mejl prospekta", MEJL_2],
  ["telefon +381", "64 123 4567"],
  ["telefon fiksni", "345-678"],
  ["telefon bez razmaka", TEL_3],
  ["URL sajta prospekta", "stolarija-petrovic"],
  ["goli domen prospekta", "zubar-nis"],
  ["telo zahteva", "ChIJ123\",\"ponovi"],
  ["Authorization", "sk_live_nesto_tajno"],
  ["Stripe potpis", "v1=abcdef"],
  ["Clerk/Svix potpis", SVIX_POTPIS],
  ["svix-id zaglavlje", "msg_2abc"],
  ["Clerk sesija (kolačić/zaglavlje)", "eyJhbGciOi"],
  ["x-clerk-auth-status", "x-clerk"],
  ["query string (grad/niša)", "nisa=pvc"],
  ["IP adresa", "93.87.12.34"],
  ["korisničko ime", "petar"],
];
for (const [opis, niz] of zabranjeno) {
  check(!tekst.includes(niz), `${opis} ne postoji u izlazu`);
}

console.log("\n── zaglavlja: ostaje samo dozvoljena lista ──");
const zaglavlja = Object.keys(izlaz.request.headers ?? {}).map((k) => k.toLowerCase()).sort();
check(
  JSON.stringify(zaglavlja) === JSON.stringify(["content-type", "host", "user-agent"]),
  `ostala su samo content-type, host, user-agent (dobijeno: ${zaglavlja.join(", ")})`,
);
check(!("data" in izlaz.request), "request.data (telo) je obrisan");
check(!("cookies" in izlaz.request), "request.cookies je obrisan");
check(!("query_string" in izlaz.request), "request.query_string je obrisan");
check(
  izlaz.request.url === "https://app.sajtoskop.com/api/unlock",
  "request.url je putanja naše rute bez query stringa",
);

console.log("\n── korisno ostaje ──");
const okvir = izlaz.exception.values[0]!.stacktrace.frames[0]!;
check(okvir.filename === "/app/apps/worker/src/lib/fetch-site.ts", "stek: putanja fajla netaknuta");
check(okvir.function === "fetchSite" && okvir.lineno === 120, "stek: funkcija i linija netaknute");
check(izlaz.exception.values[0]!.type === "Error", "tip izuzetka netaknut");
check(izlaz.user?.id === "user_2abcDEF" && Object.keys(izlaz.user).length === 1, "user nosi samo id");
check(izlaz.tags.oblast === "api/unlock", "naš tag `oblast` netaknut");
check(
  tekst.includes("https://abcd.supabase.co/rest/v1/profiles") && !tekst.includes("eq.user_2abc"),
  "host infrastrukture ostaje, njegov query string ne",
);
check(izlaz.event_id === dogadjaj.event_id && izlaz.environment === "production", "metapodaci netaknuti");
check(JSON.stringify(dogadjaj) === ulazPre, "ulaz nije menjan (vraća se nov objekat)");

console.log("\n── slobodan tekst: bez lažnih pogodaka ──");
const bezazleno = [
  "posao #1234 pao posle 3/3 pokušaja",
  "2026-09-29 12:00:00 refund_scan(job, pages)",
  "supabase.rpc spend_credit_and_unlock vratio no_user",
  "ref in_1PabcDEF, pi_3Qxyz, scan_refund:4821",
  "12345678-0123-4567-8901-234567890123",
];
for (const s of bezazleno) {
  check(ocistiTekst(s) === s, `ostaje netaknuto: "${s}"`);
}
check(ocistiTekst("Pozovi 011 123 4567 danas") === "Pozovi [telefon] danas", "fiksni beogradski broj");
check(ocistiTekst(`sajt ${SAJT_GOLI}/o-nama`) === "sajt [url]", "goli domen sa putanjom");
check(ocistiTekst("api.stripe.com je vratio 500") === "api.stripe.com je vratio 500", "Stripe host ostaje");

console.log("\n── prva linija: SDK ovo ni ne skuplja ──");
const p = sentryPrikupljanje();
check(p.httpBodies.length === 0, "tela zahteva i odgovora se ne skupljaju");
check(p.cookies === false && p.urlQueryParams === false, "kolačići i query string se ne skupljaju");
check(p.stackFrameVariables === false, "vrednosti lokalnih promenljivih se ne skupljaju");
check(p.userInfo === false, "user.* se ne popunjava automatski");
check(p.httpHeaders.response === false, "zaglavlja odgovora se ne skupljaju");
const dozvoljena = p.httpHeaders.request.allow.map((h) => h.toLowerCase());
check(
  ["authorization", "cookie", "stripe-signature", "svix-id", "svix-signature"].every(
    (h) => !dozvoljena.includes(h),
  ) && !dozvoljena.some((h) => h.includes("clerk") || h.includes("stripe")),
  "lista dozvoljenih zaglavlja nema Authorization, kolačić ni Stripe/Clerk zaglavlja",
);

console.log(fail === 0 ? "\nsve prolazi" : `\n${fail} provera pada`);
process.exit(fail === 0 ? 0 : 1);
