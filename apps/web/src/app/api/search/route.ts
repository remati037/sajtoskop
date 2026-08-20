// apps/web/src/app/api/search/route.ts
// Jedini ulaz u pretragu — i jedino mesto na kome se odlučuje da li ona košta.
//
// F2: čita iz keša. F3: promašaj keša upisuje `scan` posao. F9: taj posao se
// plaća kreditima, a keš mlađi od 30 dana je besplatan svima. Sam Places poziv
// i dalje radi isključivo worker — ova funkcija ne sme da dodirne Google (pravilo 7).
//
// ── redosled na plaćenom putu, i zašto baš taj ─────────────
// Svaka provera koja može da odbije zahtev stoji PRE naplate, i nijedna posle:
//
//   1. `requireUserId()`         — bez sesije nema ničega (pravilo 8)
//   2. registar keša             — možda je besplatno, pa nema šta da se naplati
//   3. `pay !== true`            — cena se vraća klijentu, kredit se ne dira
//   4. pre-flight budžet         — da se ne plati posao koji čeka Googleovu kvotu
//   5. `claim_cache_miss`        — dnevni osigurač po planu (F9 zadržava i njega)
//   6. `spend_credit_and_scan`   — kredit i posao, u jednoj transakciji
//
// ── [S17] cena je po stranici ──────────────────────────────
// Klijent šalje `dubina` (zatvoren skup od tri), NIKAD broj rezultata. Ova ruta
// je prevodi u `maxResults` i time u broj stranica, dakle u broj Places poziva,
// dakle u cenu — 1 kredit po stranici (LANSIRANJE §1.2).
//
// Dubina menja i BESPLATAN put, ne samo cenu: pogodak u kešu traži i svežinu i
// dovoljan obim. Keširane 1 stranica ne pokriva zahtev za 3 — 20 redova nije 60.
//
// Zaštita NIJE u middleware-u (Clerk je deprecirao `createRouteMatcher`), nego
// prva linija handlera: `requireUserId()`.

import { NextResponse } from "next/server";
import {
  cenaSkeniranja,
  DEFAULT_PLAN,
  maxRezultataZaDubinu,
  stranicaZaRezultate,
} from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { budzetZaScan } from "@/lib/budzet";
import {
  claimCacheMiss,
  releaseCacheMiss,
  scanBezRegistra,
  spendCreditAndScan,
  zivPlacenPosao,
} from "@/lib/jobs";
import { getOwnProfile } from "@/lib/profile";
import { proveriIpTempo } from "@/lib/rate-limit";
import { searchCachedLeads } from "@/lib/search";
import { besplatno, COUNTRY, stanjeKesa } from "@/lib/search-cache";
import { searchBodySchema } from "@/lib/search-schema";
import { PAGE_SIZE, type SearchResponse } from "@/lib/search-types";
import { formatDatum } from "@/lib/ui-tekst";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Rezultat zavisi od toga ko pita (šta je otključano) — nikad u deljeni keš. */
const HEADERS = { "Cache-Control": "private, no-store" };

const PRAZAN_SUMAR = { noSite: 0, social: 0, dead: 0, ugly: 0, ok: 0 };

function greska(poruka: string, status: number, detalji?: string[]): Response {
  return NextResponse.json(
    detalji ? { greska: poruka, detalji } : { greska: poruka },
    { status, headers: HEADERS },
  );
}

export async function POST(req: Request): Promise<Response> {
  // IP tempo pre svega (Faza 1, 1.2) — ista brana kao na /api/unlock.
  const ogranicen = await proveriIpTempo(req, "search");
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return greska("Telo zahteva nije ispravan JSON.", 400);
  }

  const parsed = searchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return greska(
      "Neispravni parametri pretrage.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  const { city, niche, filters, page, pay, force, dubina } = parsed.data;

  // Ponuda → rezultati → stranice → cena. Jedan lanac, jedan izvor (shared), i
  // baza ga u `spend_credit_and_scan` prelazi ponovo nad istim `maxResults`.
  const maxResults = maxRezultataZaDubinu(dubina);
  const stranica = stranicaZaRezultate(maxResults);
  const cost = cenaSkeniranja(maxResults);

  try {
    const stanje = await stanjeKesa(city, niche);
    const uKesu = besplatno(stanje, stranica);

    // ── besplatan put ───────────────────────────────────────
    // Dva slučaja, oba bez naplate: keš je svež, ili je scan u toku i ovaj
    // korisnik ga je već platio. Drugi je bitan koliko i prvi — bez njega bi
    // korisnik koji gleda kako mu se lista puni na svakom osvežavanju nailazio
    // na traženje kredita za posao koji je maločas platio.
    if (uKesu && !(pay && force)) {
      const result = await searchCachedLeads({
        userId, city, niche, filters, page,
        scannedAt: stanje.scannedAt,
      });

      // `emptyScan` je „skenirano, Google nema nijednu firmu", a `total === 0`
      // ume da bude i „filteri su preuski". UI na to dvoje odgovara različito,
      // pa razliku mora da napravi server — on jedini zna šta piše u registru.
      const body: SearchResponse = { ...result, emptyScan: stanje.total === 0 };
      return NextResponse.json(body, { headers: HEADERS });
    }

    const uToku = await zivPlacenPosao({ userId, countryCode: COUNTRY, city, niche, maxResults });

    if (uToku !== null) {
      const result = await searchCachedLeads({
        userId, city, niche, filters, page,
        scannedAt: stanje.scannedAt,
      });

      const body: SearchResponse = {
        ...result,
        status: "queued",
        job: { id: uToku, joined: false },
      };

      return NextResponse.json(body, { headers: HEADERS });
    }

    // ── scan koji je završio a nije se registrovao ───────────
    // Ovde se stiže samo kad keš NIJE svež. Ako je za istu kombinaciju maločas
    // završio `scan` posao, ugovor `runScan`-a je pao: podaci su možda upisani,
    // ali ih registar ne zna, pa bi svaki sledeći klik bio nova naplata za isti
    // posao. Zaustavlja se PRE cene i pre naplate — i za `pay` i bez njega, jer
    // je poslednji korak pollovanja upravo zahtev bez `pay` i on je taj koji je
    // do sada ekran ostavljao prazan, bez rezultata i bez ijedne reči.
    const neregistrovan = await scanBezRegistra({ countryCode: COUNTRY, city, niche, maxResults });

    if (neregistrovan !== null) {
      console.error(
        `[api/search] scan #${neregistrovan} završen bez upisa u registar keša ` +
          `(${COUNTRY}:${city}:${niche}) — naplata zaustavljena`,
      );

      return greska(
        "Skeniranje je završeno, ali rezultat nije upisan u keš — greška je na mojoj strani. " +
          "Kredit NIJE skinut. Ne pokreći isto skeniranje ponovo, javi mi i sređujem ga.",
        503,
      );
    }

    // ── nije besplatno: koliko košta ────────────────────────
    const profile = await getOwnProfile();

    // Prikazano stanje kredita je ZBIR obe kase (0022): potrošnja prazni prvo
    // `credits_balance`, pa `credits_topup`, i provera je nad zbirom. Prikazati
    // samo balans značilo bi reći „nemaš dovoljno" čoveku koji ima kupljen paket.
    const creditsLeft = (profile?.credits_balance ?? 0) + (profile?.credits_topup ?? 0);

    // Tri razloga naplate, tri rečenice korisniku (F9 odluka 8 + S17):
    //   prvo         — kombinacije nema u registru
    //   osvezavanje  — ima je, ali je starija od 30 dana
    //   plice        — sveža je, ali je skenirana pliće nego što se traži
    const kind = !stanje.scannedAt
      ? ("prvo" as const)
      : stanje.fresh
        ? ("plice" as const)
        : ("osvezavanje" as const);

    if (!pay) {
      // Nijedan lead ne izlazi uz `needs_scan` — ni ime, ni grad (pravilo 1 i 9).
      const body: SearchResponse = {
        status: "needs_scan",
        freshness: null,
        total: 0,
        page,
        pageSize: PAGE_SIZE,
        results: [],
        summary: PRAZAN_SUMAR,
        scan: {
          cost,
          kind,
          lastScannedAt: stanje.scannedAt,
          creditsLeft,
          dubina,
          kesiranaDubina: stanje.fresh ? stanje.pages : null,
        },
      };

      return NextResponse.json(body, { headers: HEADERS });
    }

    // ── plaćeni put ─────────────────────────────────────────
    // Rezerviše se tačno onoliko poziva koliko izabrana dubina traži. Odbiti
    // „Brzo" zato što u kvoti nema mesta za tri poziva značilo bi odbiti
    // skeniranje koje bi stalo.
    const budzet = await budzetZaScan(stranica);
    if (!budzet.dostupno) {
      return greska(
        "Dnevna kvota za skeniranje je potrošena. Kredit nije skinut — probaj sutra, " +
          "keširane pretrage rade i dalje.",
        503,
      );
    }

    const claim = await claimCacheMiss(userId, profile?.plan ?? DEFAULT_PLAN);

    if (!claim.ok) {
      if (claim.reason === "no_user") {
        return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
      }

      return greska(
        `Dostigao si dnevni limit od ${claim.used} skeniranja. ` +
          `Limit se resetuje ${formatDatum(claim.resetAt)} u 9 ujutru. ` +
          `Pretrage iz keša su i dalje neograničene i besplatne.`,
        429,
      );
    }

    let charge: Awaited<ReturnType<typeof spendCreditAndScan>>;
    try {
      charge = await spendCreditAndScan({ userId, countryCode: COUNTRY, city, niche, maxResults });
    } catch (err) {
      // Rezervacija je potrošena, a naplata nije prošla — vrati je korisniku.
      await releaseCacheMiss(userId);
      throw err;
    }

    if (!charge.ok) {
      // Dnevna rezervacija se vraća u SVAKOM neuspehu naplate. Bez ovoga korisnik
      // bez kredita gubi i dnevni pokušaj, iako ništa nije skenirano.
      await releaseCacheMiss(userId);

      if (charge.reason === "no_user") {
        return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
      }

      // 402 Payment Required — isti status kao kod otključavanja, pa klijent zna
      // da ponudi „vidi kredite" umesto „pokušaj ponovo".
      // [S17] Poruka mora da kaže KOLIKO fali i da postoji jeftinija ponuda —
      // korisnik sa 1 kreditom koji je kliknuo „Duboko" ima uredan izlaz, ne zid.
      const jeftinije = cost > 1 ? ` Za „Brzo" (1 kredit) ti je dovoljno ono što imaš.` : "";

      return greska(
        `Nemaš dovoljno kredita: ovo skeniranje košta ${cost}, a imaš ${charge.creditsLeft}.` +
          `${jeftinije} Pretrage iz keša su besplatne i ne troše ništa.`,
        402,
      );
    }

    // Dupli klik: posao je isti i već plaćen, pa ni dnevna rezervacija ne sme da
    // se potroši drugi put.
    if (!charge.charged) await releaseCacheMiss(userId);

    // [Faza 2, 2.6] Naplata koja prođe bez job_id je interna greška, ne `job: 0`
    // (N6): klijent koji polluje posao 0 zauvek visi na traci. Klijent dobija 500
    // i može da pokuša ponovo — `spend_credit_and_scan` je idempotentan po
    // kombinaciji, pa ponovljen pokušaj ne skida kredit dvaput.
    const jobId = charge.jobId;
    if (jobId === null) {
      throw new Error("spend_credit_and_scan je vratio ok bez job_id.");
    }

    // Zastareo keš se NE prikazuje dok novi scan ne završi (F9, odluka 3 §0).
    // Sveži keš se prikazuje i tokom ručnog osvežavanja — nema razloga da ekran
    // ostane prazan dok se osvežava nešto što je i dalje ispravno.
    //
    // [Faza 2, 2.7] Keš-čitanje posle naplate ne sme da obori odgovor (W7):
    // korisnik je platio, pa odgovor MORA da bude `queued` sa job id — klijent
    // polluje posao i rezultati stižu čim scan završi. Pad keš-čitanja se
    // loguje i vraća se prazan `queued`.
    let result: Awaited<ReturnType<typeof searchCachedLeads>>;
    try {
      result = uKesu
        ? await searchCachedLeads({
            userId, city, niche, filters, page,
            scannedAt: stanje.scannedAt,
            source: "api",
          })
        : {
            status: "cache" as const,
            freshness: null,
            total: 0,
            page,
            pageSize: PAGE_SIZE,
            results: [],
            summary: PRAZAN_SUMAR,
          };
    } catch (err) {
      console.error("[api/search] keš-čitanje posle naplate:", err);
      result = {
        status: "cache" as const,
        freshness: null,
        total: 0,
        page,
        pageSize: PAGE_SIZE,
        results: [],
        summary: PRAZAN_SUMAR,
      };
    }

    const body: SearchResponse = {
      ...result,
      status: "queued",
      job: { id: jobId, joined: charge.joined },
      charged: charge.charged,
      cost,
      creditsLeft: charge.creditsLeft,
    };

    return NextResponse.json(body, { headers: HEADERS });
  } catch (err) {
    console.error("[api/search]", err);
    return greska("Pretraga trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}
