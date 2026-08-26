// scripts/paddle-replay.ts — pusti PRAVU Paddle transakciju u lokalni webhook
//
// Pokretanje:
//   pnpm paddle:replay --last
//   pnpm paddle:replay --txn=txn_01m0z4f81gqpegf0ra3r6tjttj
//   pnpm paddle:replay --last --url=http://localhost:3001/api/billing/webhook
//
// ── zašto ovo postoji ───────────────────────────────────────
// Lokalni razvoj naplate zavisi od tunela (Hookdeck/ngrok), a tunel je treća
// pokretna stvar između Paddle-a i koda — i kad zakaže, zakaže TIHO: Paddle
// prijavi `delivered`, tunel prijavi „Accepted", a u bazi nema ničega. Sat
// vremena traženja uzroka na mestu gde uzroka nema.
//
// Ovaj alat preskače tunel. Uzima transakciju koja STVARNO postoji u Paddle-u,
// sklapa `transaction.completed` događaj oko nje, potpisuje ga PRAVOM tajnom iz
// `.env` i šalje na lokalnu rutu. Sve posle toga je pravi kod: verifikacija
// potpisa, `billing_events`, `apply_credit_pack`, obe kase.
//
// ── šta ovo NE može ─────────────────────────────────────────
// Ne može da izmisli kupovinu. Transakcija se ČITA iz Paddle-a i mora da bude
// `completed`; sve ostalo alat odbija. Dakle ne otvara put ka kreditima koji
// nisu plaćeni — otvara put ka kreditima koji jesu, a nisu stigli.
//
// Ne dokazuje da isporuka Paddle → aplikacija radi. To se u produkciji ionako
// dokazuje bez tunela, jer Paddle gađa pravi domen direktno.
//
// ── zašto potpis mora da bude SVEŽ ──────────────────────────
// ‼️ Paddle SDK odbija potpis stariji od 5 sekundi
//    (`WebhooksValidator.MAX_VALID_TIME_DIFFERENCE = 5`). Zato ovaj alat
//    potpisuje u trenutku slanja. Iz istog razloga Hookdeck-ovo dugme „Retry"
//    NIKAD ne radi: ono šalje sačuvan zahtev sa originalnim zaglavljem, a ono
//    je do tada odavno staro. Ponavljanje ide ili odavde, ili iz Paddle-a
//    (`notifications.replay`), koji potpisuje iznova.

import { createHmac } from "node:crypto";

process.loadEnvFile(new URL("../.env", import.meta.url).pathname);

const API_KEY = process.env.PADDLE_API_KEY ?? "";
const TAJNA = process.env.PADDLE_WEBHOOK_SECRET ?? "";
const OKRUZENJE = process.env.NEXT_PUBLIC_PADDLE_ENV ?? "";

function pukni(poruka: string): never {
  console.error(`\n✗ ${poruka}\n`);
  process.exit(1);
}

if (!API_KEY.startsWith("pdl_")) pukni("PADDLE_API_KEY nije podešen u .env");
if (!TAJNA.startsWith("pdl_ntfset_")) pukni("PADDLE_WEBHOOK_SECRET nije podešen u .env");
if (OKRUZENJE !== "sandbox" && OKRUZENJE !== "production") {
  pukni("NEXT_PUBLIC_PADDLE_ENV mora biti `sandbox` ili `production`");
}

// ‼️ Alat je namenjen razvoju. Puštanje događaja u PRODUKCIJSKU bazu iz
//    terminala je putanja koja ne sme da postoji kao udobnost.
if (OKRUZENJE === "production") {
  pukni(
    "NEXT_PUBLIC_PADDLE_ENV je `production`. Ovaj alat radi samo nad sandboxom — " +
      "u produkciji Paddle gađa pravi domen i tunel ne postoji.",
  );
}

const BAZA = "https://sandbox-api.paddle.com";

const arg = (ime: string): string | null => {
  const p = process.argv.find((a) => a.startsWith(`--${ime}=`));
  return p ? p.slice(ime.length + 3) : null;
};
const ima = (ime: string): boolean => process.argv.includes(`--${ime}`);

const URL_RUTE = arg("url") ?? "http://localhost:3000/api/billing/webhook";

/** Sirov Paddle odgovor — snake_case, tačno onako kako ga webhook i očekuje. */
type SirovaTransakcija = {
  id: string;
  status: string;
  custom_data: Record<string, unknown> | null;
  items: { price?: { id?: string } }[];
};

async function paddle<T>(putanja: string): Promise<T> {
  const r = await fetch(`${BAZA}${putanja}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const telo = (await r.json()) as { data?: T; error?: { detail?: string } };
  if (!r.ok || !telo.data) {
    pukni(`Paddle ${putanja} → ${r.status}: ${telo.error?.detail ?? "bez detalja"}`);
  }
  return telo.data;
}

// ── 1. koja transakcija ────────────────────────────────────
let txnId = arg("txn");

if (!txnId && ima("last")) {
  const lista = await paddle<SirovaTransakcija[]>("/transactions?status=completed&per_page=1");
  txnId = lista[0]?.id ?? null;
  if (!txnId) pukni("Nema nijedne `completed` transakcije u sandboxu.");
  console.log(`--last → ${txnId}`);
}

if (!txnId) {
  pukni("Reci koju transakciju: `--txn=txn_…` ili `--last`.");
}

// Sirov JSON, ne kroz SDK: webhook parsira SNAKE_CASE telo, a SDK vraća
// camelCase objekte. Prevođenje nazad bi bilo drugi izvor istine o obliku
// payload-a — a upravo taj oblik je ono što se ovde testira.
const t = await paddle<SirovaTransakcija>(`/transactions/${txnId}`);

if (t.status !== "completed") {
  pukni(`Transakcija ${t.id} je \`${t.status}\`, ne \`completed\`. Nema šta da se dodeli.`);
}

console.log(`\ntransakcija : ${t.id}`);
console.log(`custom_data : ${JSON.stringify(t.custom_data)}`);
console.log(`cene        : ${t.items.map((i) => i.price?.id).join(", ")}`);

if (!t.custom_data || typeof t.custom_data.user_id !== "string") {
  console.warn(
    "\n⚠️  Transakcija nema `custom_data.user_id`. Webhook će pokušati vezivanje " +
      "preko pretplate ili Paddle kupca; ako ni to ne uspe, prijaviće trajan neuspeh.",
  );
}

// ── 2. sklopi i potpiši događaj ────────────────────────────
// `event_id` je ključ GRUBE brane (`billing_events`). Namerno je izveden iz ID-ja
// transakcije, pa dva pokretanja nad istom transakcijom daju isti ključ i drugo
// bude prepoznato kao duplikat. Prefiks `ntfsim_` ga razlikuje od pravog `ntf_`
// koji je Paddle poslao — u knjizi mora da se vidi da je događaj pušten rukom.
//
// FINA brana je ispod toga i ona je prava: `ref_id` u `credit_ledger` je ID
// TRANSAKCIJE (`credit_ledger_grant_idem_idx`), pa krediti ne mogu da se dodele
// dvaput ni kad bi `event_id` bio drugačiji.
const telo = JSON.stringify({
  event_id: `ntfsim_${t.id}`,
  event_type: "transaction.completed",
  occurred_at: new Date().toISOString(),
  notification_id: `ntfsim_${t.id}`,
  data: t,
});

const ts = Math.floor(Date.now() / 1000);
const h1 = createHmac("sha256", TAJNA).update(`${ts}:${telo}`).digest("hex");

// ── 3. pošalji ─────────────────────────────────────────────
console.log(`\nšaljem na ${URL_RUTE} …`);

let odgovor: Response;
try {
  odgovor = await fetch(URL_RUTE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "paddle-signature": `ts=${ts};h1=${h1}`,
    },
    body: telo,
  });
} catch (err) {
  pukni(
    `Ruta nije dostupna na ${URL_RUTE} — je li \`pnpm dev\` pokrenut? ` +
      `(${err instanceof Error ? err.message : String(err)})`,
  );
}

const tekst = await odgovor.text();
console.log(`\n${odgovor.status} ${tekst}\n`);

if (odgovor.status === 401) {
  console.error(
    "Potpis nije prošao. Ili PADDLE_WEBHOOK_SECRET u `.env` nije tajna OVOG\n" +
      "destination-a, ili je server podignut pre nego što si je upisao —\n" +
      "restartuj `pnpm dev`.\n",
  );
}

process.exit(odgovor.ok ? 0 : 1);
