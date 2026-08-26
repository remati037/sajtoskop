// scripts/paddle-doktor.ts — je li lanac naplate spojen, PRE nego što platiš
//
// Pokretanje:
//   pnpm paddle:doktor
//   pnpm paddle:doktor --url=http://localhost:3001/api/billing/webhook
//
// ── zašto ovo postoji ───────────────────────────────────────
// Lanac ima četiri karike: Paddle → tunel → lokalni server → baza. Kad pukne
// bilo koja SEM poslednje, niko ne prijavi grešku:
//
//   · Paddle vidi `delivered` čim mu tunel odgovori 200
//   · Hookdeck vraća 200 „SUCCESS" i kad mu CLI NIJE zakačen
//   · lokalni server ne zna da je neko trebalo da ga pozove
//
// Rezultat je plaćena kupovina bez kredita i tri zelena svetla. Ovaj alat
// prolazi kroz karike redom i staje na prvoj koja ne drži.

process.loadEnvFile(new URL("../.env", import.meta.url).pathname);

const API_KEY = process.env.PADDLE_API_KEY ?? "";
const TAJNA = process.env.PADDLE_WEBHOOK_SECRET ?? "";
const OKRUZENJE = process.env.NEXT_PUBLIC_PADDLE_ENV ?? "";

const arg = (ime: string): string | null => {
  const p = process.argv.find((a) => a.startsWith(`--${ime}=`));
  return p ? p.slice(ime.length + 3) : null;
};

const LOKALNO = arg("url") ?? "http://localhost:3000/api/billing/webhook";
/** Putanja mora da se poklopi sa onim što tunel prosleđuje. */
const PUTANJA = "/api/billing/webhook";

let pao = 0;
const ok = (t: string) => console.log(`  ✓ ${t}`);
const lose = (t: string, savet?: string) => {
  pao++;
  console.log(`  ✗ ${t}`);
  if (savet) console.log(`     → ${savet}`);
};
const info = (t: string) => console.log(`    ${t}`);

// ═══════════════════════════════════════════════════════════
console.log("\n1. .env");
// ═══════════════════════════════════════════════════════════

if (OKRUZENJE === "sandbox" || OKRUZENJE === "production") ok(`NEXT_PUBLIC_PADDLE_ENV = ${OKRUZENJE}`);
else lose("NEXT_PUBLIC_PADDLE_ENV nije `sandbox` ni `production`");

const ocekivaniPrefiks = OKRUZENJE === "production" ? "pdl_live_" : "pdl_sdbx_";
if (API_KEY.startsWith(ocekivaniPrefiks)) ok("PADDLE_API_KEY ima prefiks koji odgovara okruženju");
else if (!API_KEY) lose("PADDLE_API_KEY je prazan", "Paddle → Developer tools → Authentication");
else lose(`PADDLE_API_KEY ne počinje sa \`${ocekivaniPrefiks}\``, "ključ je iz drugog okruženja");

// ‼️ Prazna tajna obara i CHECKOUT, ne samo webhook: `paddleServerEnv()` validira
//    oba ključa u istoj šemi, pa `paddleServer()` baca i za rutu koja tajnu
//    nikad ne koristi. To je namerna sprega (v. lib/env.ts), ali se lako promaši.
if (TAJNA.startsWith("pdl_ntfset_")) ok("PADDLE_WEBHOOK_SECRET ima ispravan prefiks");
else if (!TAJNA)
  lose(
    "PADDLE_WEBHOOK_SECRET je prazan",
    "ovo obara i /api/billing/checkout, ne samo webhook — v. lib/env.ts",
  );
else lose("PADDLE_WEBHOOK_SECRET ne počinje sa `pdl_ntfset_`");

if (pao > 0) {
  console.log("\nPopravi .env pa pusti ponovo. Posle izmene RESTARTUJ `pnpm dev`.\n");
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════
console.log("\n2. lokalni server");
// ═══════════════════════════════════════════════════════════

// Zahtev BEZ potpisa. Ruta ga odbija pre ijednog upita u bazu, pa je ovo
// bezopasno — a odgovor `401 Nedostaje potpis.` je dokaz da je baš NAŠA ruta
// odgovorila, ne nešto drugo na tom portu.
const ODZIV = "Nedostaje potpis.";

async function kucni(url: string, opis: string): Promise<string | null> {
  try {
    const r = await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(10_000) });
    const t = (await r.text()).trim();
    info(`${opis}: HTTP ${r.status} — ${t.slice(0, 120)}`);
    return t;
  } catch (err) {
    info(`${opis}: nema odgovora (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

const lokalni = await kucni(LOKALNO, LOKALNO);
if (lokalni === ODZIV) ok("ruta odgovara i prepoznata je kao naša");
else if (lokalni === null) lose("dev server ne odgovara", "pokreni `pnpm dev` (port 3000)");
else lose("na toj adresi odgovara nešto drugo", "je li `pnpm dev` na tom portu?");

// ═══════════════════════════════════════════════════════════
console.log("\n3. Paddle destination");
// ═══════════════════════════════════════════════════════════

const BAZA = OKRUZENJE === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

type Dest = {
  id: string;
  destination: string;
  active: boolean;
  traffic_source?: string;
  subscribed_events?: { name: string }[];
};

let odrediste: Dest | null = null;

try {
  const r = await fetch(`${BAZA}/notification-settings`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const telo = (await r.json()) as { data?: Dest[] };
  const svi = (telo.data ?? []).filter((d) => d.active);

  if (svi.length === 0) {
    lose("nema nijednog AKTIVNOG destination-a", "Paddle → Developer tools → Notifications");
  } else {
    odrediste = svi[0]!;
    if (svi.length > 1) info(`aktivnih destination-a: ${svi.length} — proveravam prvi`);
    ok(`destination: ${odrediste.destination}`);

    const dogadjaji = (odrediste.subscribed_events ?? []).map((e) => e.name);
    if (dogadjaji.includes("transaction.completed")) ok("sluša `transaction.completed`");
    else lose("NE sluša `transaction.completed`", "bez njega se krediti ne dodeljuju nikad");

    if (odrediste.traffic_source === "all") ok("traffic source = all (simulator radi)");
    else info(`traffic source = ${odrediste.traffic_source ?? "?"} — simulator neće raditi`);

    // Hookdeck rutira po ID-ju izvora i putanju dodaje CLI (`--path`), pa je
    // kod njega URL bez putanje uredan. Kod direktnog tunela (ngrok) nije —
    // tamo Paddle gađa tačno ono što je upisano, dakle koren aplikacije.
    const prekoAgregatora = /(^|\.)hkdk\.events$/.test(new URL(odrediste.destination).hostname);
    if (odrediste.destination.endsWith(PUTANJA)) {
      ok(`URL pokazuje na \`${PUTANJA}\``);
    } else if (prekoAgregatora) {
      info(`URL nema putanju — kod Hookdeck-a je to uredno (dodaje je CLI kroz --path)`);
    } else {
      lose(
        `URL se ne završava sa \`${PUTANJA}\``,
        "direktan tunel prosleđuje doslovno — Paddle bi gađao koren aplikacije",
      );
    }
  }
} catch (err) {
  lose(`Paddle API ne odgovara: ${err instanceof Error ? err.message : String(err)}`);
}

// ═══════════════════════════════════════════════════════════
console.log("\n4. ceo lanac spolja");
// ═══════════════════════════════════════════════════════════
// Ovo je jedina provera koja stvarno nešto dokazuje: kuca na JAVNU adresu koju
// Paddle gađa i gleda da li nazad stigne odgovor NAŠE rute.

if (!odrediste) {
  info("preskočeno — nema destination-a");
} else {
  const spolja = await kucni(odrediste.destination, "javna adresa");

  if (spolja === ODZIV) {
    ok("lanac je spojen — odgovor je stigao iz naše rute");
  } else if (spolja === null) {
    lose(
      "javna adresa ne odgovara",
      "tunel ne radi. Pokreni ga i proveri da URL u Paddle-u odgovara onom koji tunel ispisuje.",
    );
  } else if (spolja.includes("Hookdeck")) {
    // ‼️ Ovo je tačno stanje koje je 26.8. progutalo tri plaćena paketa.
    lose(
      "odgovorio je HOOKDECK, ne naša ruta",
      'Hookdeck vraća 200 „SUCCESS" i kad ništa ne prosleđuje — v. uputstvo ispod',
    );
    console.log(`
     Hookdeck sakriva ishod: njegov 200 ne znači da je tvoj server išta primio.
     Dva izlaza, oba rešavaju problem:

     A) ngrok — direktan tunel, bez posrednika (PREPORUKA)
        1. https://dashboard.ngrok.com/domains → „Create Domain" (besplatan tarif
           daje jedan STALAN domen, pa se URL u Paddle-u upisuje samo jednom)
        2. ngrok http 3000 --url=https://TVOJ-DOMEN.ngrok-free.app
        3. u Paddle destination upiši:
           https://TVOJ-DOMEN.ngrok-free.app${PUTANJA}
        4. pnpm paddle:doktor  → ovde mora da piše „lanac je spojen"

        Tajna se NE menja: menjaš URL postojećeg destination-a, ne praviš nov.

     B) Hookdeck, ali ispravno podešen
        1. hookdeck login              (izađi iz Console/guest režima — u njemu
                                        URL ume da se promeni pri svakom startu)
        2. hookdeck listen 3000 paddle-local --path ${PUTANJA}
        3. prepiši URL koji CLI ISPIŠE u Paddle destination
        4. destination u Hookdeck-u mora da bude tipa CLI, nikad HTTP —
           HTTP sa localhost adresom njihov oblak ne može da dohvati
`);
  } else {
    lose("sa javne adrese je stigao nepoznat odgovor", "nešto između Paddle-a i tebe odgovara umesto rute");
  }
}

// ═══════════════════════════════════════════════════════════
console.log(
  pao === 0
    ? "\nSve drži. Kupovina u sandboxu treba da dodeli kredite sama.\n"
    : `\n${pao} stvar(i) ne drži. Dok se ne poprave, zaostale kupovine pokupi sa:\n` +
        "  pnpm paddle:replay --last\n",
);
process.exit(pao === 0 ? 0 : 1);
