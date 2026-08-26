// apps/web/src/lib/paddle-server.ts
// Serverski Paddle klijent. Jedno mesto na kome `PADDLE_API_KEY` uopšte postoji
// u procesu.
//
// `import "server-only"` je ovde iz istog razloga kao u `lib/supabase.ts`: jedan
// slučajan import iz „use client" komponente i tajni ključ ide u bundle svakog
// posetioca. Klijentska strana Paddle-a živi u `lib/paddle-okruzenje.ts` i tamo
// se dodiruju isključivo `NEXT_PUBLIC_*` vrednosti — dva fajla su razdvojena
// baš zbog te granice, ne zbog urednosti.

import "server-only";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { paddleServerEnv } from "./env";
import { PADDLE_OKRUZENJA, type PaddleOkruzenje } from "./paddle-okruzenje";

/**
 * Okruženje za SERVERSKI SDK.
 *
 * Čita se iz iste promenljive kao klijentsko (`NEXT_PUBLIC_PADDLE_ENV`), i to je
 * namerno: sandbox katalog i produkcioni katalog su odvojeni, pa `pri_` koji
 * pregledač vidi mora da postoji i u nalogu ka kome server šalje transakciju.
 * Dve promenljive bi značile da se te dve strane mogu raziđi bez ijedne greške
 * pri podizanju — a razilaženje se onda vidi tek kao „price not found" u
 * checkout-u, ili gore, kao transakcija u pogrešnom nalogu.
 */
function okruzenje(): PaddleOkruzenje {
  const sirovo = process.env.NEXT_PUBLIC_PADDLE_ENV;
  const nadjeno = PADDLE_OKRUZENJA.find((o) => o === sirovo);
  if (!nadjeno) {
    throw new Error(
      "NEXT_PUBLIC_PADDLE_ENV mora biti tačno `sandbox` ili `production`; " +
        "podrazumevane vrednosti nema jer bi značila naplatu u pogrešnu kasu.",
    );
  }
  return nadjeno;
}

let klijent: Paddle | null = null;

/**
 * Paddle SDK, podignut jednom po procesu.
 *
 * Baca kad env nije podešen ili kad se ključ i okruženje ne poklapaju. Ukrštena
 * provera je ista zamka koju `paddleKonfig()` hvata na klijentu: `pdl_sdbx_`
 * ključ uz `production` (ili obrnuto) ne puca sam od sebe — otvori transakciju u
 * DRUGOM nalogu, gde naših cena nema. Bolje da checkout ruta vrati 500 sa
 * razlogom nego da napravi transakciju koju webhook nikad neće videti.
 */
export function paddleServer(): Paddle {
  if (klijent) return klijent;

  const { PADDLE_API_KEY } = paddleServerEnv();
  const okr = okruzenje();

  const ocekivaniPrefiks = okr === "sandbox" ? "pdl_sdbx_" : "pdl_live_";
  if (!PADDLE_API_KEY.startsWith(ocekivaniPrefiks)) {
    // Poruka nosi PREFIKS, ne ključ. Ovaj tekst završi u logu.
    throw new Error(
      `Paddle API ključ i okruženje se ne poklapaju: NEXT_PUBLIC_PADDLE_ENV je ` +
        `\`${okr}\`, a ključ ne počinje sa \`${ocekivaniPrefiks}\`.`,
    );
  }

  klijent = new Paddle(PADDLE_API_KEY, {
    environment: okr === "sandbox" ? Environment.sandbox : Environment.production,
  });
  return klijent;
}
