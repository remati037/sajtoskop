// apps/web/src/app/api/search/route.ts
// Jedini ulaz u pretragu — i jedino mesto na kome se odlučuje da li ona košta.
//
// F2: čita iz keša. F3: promašaj keša upisuje `scan` posao. F9: taj posao se
// plaća kreditima. S25 (D10): PLAĆA SE I PRISTUP KEŠU — besplatno je samo ono
// što je korisnik već platio (`search_access`, 30 dana, do plaćene dubine).
// Sam Places poziv i dalje radi isključivo worker — ova funkcija ne sme da
// dodirne Google (pravilo 7).
//
// ── redosled na plaćenom putu, i zašto baš taj ─────────────
// Svaka provera koja može da odbije zahtev stoji PRE naplate, i nijedna posle:
//
//   1. `requireUserId()`         — bez sesije nema ničega (pravilo 8)
//   1a. `odbijenica()`           — [S19] istekao pristup: ni keš
//   2. registar keša + pristup   — plaćen pristup nad svežim kešom → lista, 0 kredita
//   3. `pay !== true`            — cena se vraća klijentu, kredit se ne dira
//   4. pre-flight budžet         — SAMO kad će biti Places poziva (keš ga nema)
//   5. `claim_cache_miss`        — dnevni osigurač po planu, isto samo za Places
//   6. `spend_credit_and_scan`   — kredit i pristup (i posao, kad treba), u
//                                  jednoj transakciji
//
// ── [S17] cena je po stranici, [S25] i iz keša ─────────────
// Klijent šalje `dubina` (zatvoren skup od tri), NIKAD broj rezultata. Ruta je
// prevodi u `maxResults`, dakle u broj stranica, dakle u cenu — 1 kredit po
// stranici. Iz svežeg keša cena je broj stranica koje STVARNO postoje
// (`ceil(total/20)`, najviše tražena dubina), jer manje firmi je manje
// podataka (§14.4). Pristup ističe najkasnije kad i Google podatak (pravilo 1).
//
// Zaštita NIJE u middleware-u (Clerk je deprecirao `createRouteMatcher`), nego
// prva linija handlera: `requireUserId()`.

import { NextResponse } from "next/server";
import { DEFAULT_PLAN, maxRezultataZaDubinu, stranicaZaRezultate } from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { budzetZaScan } from "@/lib/budzet";
import {
  claimCacheMiss,
  hasSearchAccess,
  releaseCacheMiss,
  scanBezRegistra,
  spendCreditAndScan,
  zivPlacenPosao,
} from "@/lib/jobs";
import { citajPristup, odbijenica } from "@/lib/pristup";
import { proveriIpTempo } from "@/lib/rate-limit";
import { searchCachedLeads } from "@/lib/search";
import { cenaIzKesa, COUNTRY, pokrivaKes, stanjeKesa } from "@/lib/search-cache";
import { searchBodySchema } from "@/lib/search-schema";
import { PAGE_SIZE, type ScanKind, type SearchResponse } from "@/lib/search-types";
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

/** Prazan `cache` odgovor — za `queued` bez ičega u kešu i za pad čitanja posle naplate. */
function prazno(page: number): SearchResponse {
  return {
    status: "cache",
    freshness: null,
    total: 0,
    page,
    pageSize: PAGE_SIZE,
    results: [],
    summary: PRAZAN_SUMAR,
  };
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

  // [S19] Kapija pristupa, pre svega ostalog i pre ijednog upita o kešu.
  // Odbija se i pretraga po kešu, ne samo skeniranje: §1.5 daje `grace` nalogu
  // „samo čitanje postojećih prospekata", a pretraga je pronalaženje novih.
  const { pristup, profile } = await citajPristup();
  const odbijen = odbijenica(pristup, pay ? "skeniranje" : "pretraga");
  if (odbijen) return odbijen;

  // Ponuda → rezultati → stranice → cena. Jedan lanac, jedan izvor (shared), i
  // baza ga u `spend_credit_and_scan` prelazi ponovo nad istim `maxResults`.
  const maxResults = maxRezultataZaDubinu(dubina);
  const stranica = stranicaZaRezultate(maxResults);

  try {
    const stanje = await stanjeKesa(city, niche);
    // Keš može da posluži: svež i dovoljno dubok. NIJE „besplatno" — pristup
    // se plaća; samo nema Places poziva i lista stiže odmah (D10).
    const izKesa = pokrivaKes(stanje, stranica);
    const cost = cenaIzKesa(stanje, stranica);

    // ── plaćen pristup ──────────────────────────────────────
    // Pristup postoji i keš ga pokriva → lista, bez naplate. Paginacija,
    // filteri i osvežavanja idu ovuda. `force` (ručno ponovno skeniranje nad
    // svežim kešom) namerno preskače — to je nov Places poziv i plaća se ponovo.
    const imaPristup = await hasSearchAccess({ userId, countryCode: COUNTRY, city, niche, maxResults });

    if (imaPristup && izKesa && !(pay && force)) {
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

    // Pristup je plaćen, a scan još traje (keš nije svež): korisnik gleda kako
    // mu se lista puni. Bez ove grane bi svako osvežavanje u toku čekanja
    // naletelo na cenu za posao koji je maločas plaćen.
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
    // Samo kad keš NIJE svež: ako je za istu kombinaciju maločas završio `scan`
    // posao, ugovor `runScan`-a je pao i svaki sledeći klik bi bio nova naplata
    // za isti posao. Zaustavlja se PRE cene i pre naplate.
    if (!izKesa) {
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
    }

    // ── nije plaćeno: koliko košta ──────────────────────────
    // Prikazano stanje kredita je ZBIR obe kase (0022): potrošnja prazni prvo
    // `credits_balance`, pa `credits_topup`, i provera je nad zbirom.
    const creditsLeft = (profile?.credits_balance ?? 0) + (profile?.credits_topup ?? 0);

    // Četiri razloga naplate, četiri rečenice korisniku (F9 odluka 8, S17, S25):
    //   kes          — svež i dovoljno dubok: pristup odmah, po broju stranica
    //   prvo         — kombinacije nema u registru
    //   osvezavanje  — ima je, ali je starija od 30 dana
    //   plice        — sveža je, ali je skenirana pliće nego što se traži
    const kind: ScanKind = izKesa
      ? "kes"
      : !stanje.scannedAt
        ? "prvo"
        : stanje.fresh
          ? "plice"
          : "osvezavanje";

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
    // Budžet i dnevni osigurač su za PLACES POZIVE. Pristup iz keša ih nema, pa
    // ih i ne troši — čovek koji je iskoristio dnevni limit skeniranja i dalje
    // sme da kupi pristup onome što je već u kešu.
    const placesPoziv = !izKesa || force;
    let rezervisano = false;

    if (placesPoziv) {
      // Rezerviše se tačno onoliko poziva koliko izabrana dubina traži. Odbiti
      // „Brzo" zato što u kvoti nema mesta za tri poziva značilo bi odbiti
      // skeniranje koje bi stalo.
      const budzet = await budzetZaScan(stranica);
      if (!budzet.dostupno) {
        return greska(
          "Dnevna kvota za skeniranje je potrošena. Kredit nije skinut — probaj sutra, " +
            "pristup onome što je već u kešu radi i dalje.",
          503,
        );
      }

      // Dnevni osigurač po planu iz KAPIJE, ne po `profiles.plan`: stanje
      // `dopuna` ima svoje limite (§1.3), a plan koji mu je istekao bi mu dao tuđe.
      const claim = await claimCacheMiss(
        userId,
        pristup?.planLimita ?? profile?.plan ?? DEFAULT_PLAN,
      );

      if (!claim.ok) {
        if (claim.reason === "no_user") {
          return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
        }

        return greska(
          `Dostigao si dnevni limit od ${claim.used} skeniranja. ` +
            `Limit se resetuje ${formatDatum(claim.resetAt)} u 9 ujutru. ` +
            `Ono što je već u kešu možeš da otvaraš i dalje.`,
          429,
        );
      }
      rezervisano = true;
    }

    const vrati = async () => {
      if (rezervisano) await releaseCacheMiss(userId);
    };

    let charge: Awaited<ReturnType<typeof spendCreditAndScan>>;
    try {
      charge = await spendCreditAndScan({ userId, countryCode: COUNTRY, city, niche, maxResults });
    } catch (err) {
      // Rezervacija je potrošena, a naplata nije prošla — vrati je korisniku.
      await vrati();
      throw err;
    }

    if (!charge.ok) {
      // Dnevna rezervacija se vraća u SVAKOM neuspehu naplate.
      await vrati();

      if (charge.reason === "no_user") {
        return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
      }

      // 402 Payment Required — isti status kao kod otključavanja, pa klijent zna
      // da ponudi „vidi kredite". Iznos dolazi iz BAZE (`charge.cost`): iz keša
      // je manji od dubine kad firmi ima manje (§14.4). Korisnik sa 1 kreditom
      // koji je kliknuo „Duboko" ima uredan izlaz, ne zid.
      const jeftinije = charge.cost > 1 ? ` Za „Brzo" (1 kredit) ti je dovoljno ono što imaš.` : "";

      return greska(
        `Nemaš dovoljno kredita: ovo košta ${charge.cost}, a imaš ${charge.creditsLeft}.${jeftinije}`,
        402,
      );
    }

    // ── pristup iz keša: naplaćeno, lista odmah, nula Places poziva ──
    if (charge.reason === "cached" || (charge.reason === "already_paid" && charge.jobId === null)) {
      // `cached` uz rezervaciju znači da je web mislio da keš ne pokriva, a
      // baza da pokriva (TTL na granici) — rezervacija se vraća, poziva nema.
      await vrati();

      let result: SearchResponse;
      try {
        result = await searchCachedLeads({
          userId, city, niche, filters, page,
          scannedAt: stanje.scannedAt,
          source: "cache",
        });
      } catch (err) {
        // Naplata je prošla, pristup postoji — čitanje sme da padne samo na
        // prazan odgovor, nikad na 500 koji bi izgledao kao neuspela naplata.
        console.error("[api/search] keš-čitanje posle naplate pristupa:", err);
        result = prazno(page);
      }

      const body: SearchResponse = {
        ...result,
        status: "cache",
        emptyScan: stanje.total === 0,
        charged: charge.charged,
        ...(charge.charged ? { cost: charge.cost, creditsLeft: charge.creditsLeft } : {}),
      };
      return NextResponse.json(body, { headers: HEADERS });
    }

    // Dupli klik: posao je isti i već plaćen, pa ni dnevna rezervacija ne sme da
    // se potroši drugi put.
    if (!charge.charged) await vrati();

    // [Faza 2, 2.6] Naplata koja prođe bez job_id je interna greška, ne `job: 0`:
    // klijent koji polluje posao 0 zauvek visi na traci. `spend_credit_and_scan`
    // je idempotentan po kombinaciji, pa ponovljen pokušaj ne skida kredit dvaput.
    const jobId = charge.jobId;
    if (jobId === null) {
      throw new Error("spend_credit_and_scan je vratio ok bez job_id.");
    }

    // Zastareo keš se NE prikazuje dok novi scan ne završi (F9, odluka 3 §0).
    // Sveži keš se prikazuje i tokom ručnog osvežavanja — nema razloga da ekran
    // ostane prazan dok se osvežava nešto što je i dalje ispravno.
    //
    // [Faza 2, 2.7] Keš-čitanje posle naplate ne sme da obori odgovor (W7):
    // korisnik je platio, pa odgovor MORA da bude `queued` sa job id.
    let result: SearchResponse;
    try {
      result = izKesa
        ? await searchCachedLeads({
            userId, city, niche, filters, page,
            scannedAt: stanje.scannedAt,
            source: "api",
          })
        : prazno(page);
    } catch (err) {
      console.error("[api/search] keš-čitanje posle naplate:", err);
      result = prazno(page);
    }

    const body: SearchResponse = {
      ...result,
      status: "queued",
      job: { id: jobId, joined: charge.joined },
      charged: charge.charged,
      cost: charge.cost,
      creditsLeft: charge.creditsLeft,
    };

    return NextResponse.json(body, { headers: HEADERS });
  } catch (err) {
    console.error("[api/search]", err);
    return greska("Pretraga trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}
