// apps/web/src/app/api/search/route.ts
// Jedini ulaz u pretragu.
//
// F2: čita iz keša. F3: promašaj keša više ne završava tu nego upisuje `scan`
// posao i vraća `{ status: "queued", job }`. Sam Places poziv i dalje radi
// isključivo worker — ova funkcija ne sme da dodirne Google (pravilo 7).
//
// Zaštita NIJE u middleware-u (Clerk je deprecirao `createRouteMatcher`), nego
// prva linija handlera: `requireUserId()`. Bez sesije nema odgovora, i to pre
// nego što se telo uopšte pogleda.

import { NextResponse } from "next/server";
import { DEFAULT_PLAN } from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { claimCacheMiss, enqueueRefresh, enqueueScan, releaseCacheMiss } from "@/lib/jobs";
import { getOwnProfile } from "@/lib/profile";
import { searchCachedLeads } from "@/lib/search";
import { searchBodySchema } from "@/lib/search-schema";
import { formatDatum } from "@/lib/ui-tekst";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COUNTRY = "RS";

export async function POST(req: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ greska: "Nisi prijavljen." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ greska: "Telo zahteva nije ispravan JSON." }, { status: 400 });
  }

  const parsed = searchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        greska: "Neispravni parametri pretrage.",
        detalji: parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const { city, niche, filters, page } = parsed.data;

  // Rezultat zavisi od toga ko pita (šta je otključano) — nikad u deljeni keš.
  const headers = { "Cache-Control": "private, no-store" };

  try {
    const result = await searchCachedLeads({ userId, city, niche, filters, page });

    if (result.status === "cache") {
      // Zastarelo se prikazuje ODMAH, osvežavanje ide u pozadini i ne troši
      // korisnikov dnevni limit — nije on tražio nov scan (PRD §5).
      if (result.freshness?.stale) {
        await enqueueRefresh({ countryCode: COUNTRY, city, niche });
      }
      return NextResponse.json(result, { headers });
    }

    // ── promašaj keša: skeniranje uživo ────────────────────
    const profile = await getOwnProfile();
    const claim = await claimCacheMiss(userId, profile?.plan ?? DEFAULT_PLAN);

    if (!claim.ok) {
      if (claim.reason === "no_user") {
        return NextResponse.json(
          { greska: "Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak." },
          { status: 409, headers },
        );
      }

      return NextResponse.json(
        {
          greska:
            `Dostigao si dnevni limit od ${claim.used} ${claim.used === 1 ? "pretrage" : "pretraga"} ` +
            `koje nisu u kešu. Limit se resetuje ${formatDatum(claim.resetAt)} u 9 ujutru. ` +
            `Pretrage iz keša su i dalje neograničene i besplatne.`,
        },
        { status: 429, headers },
      );
    }

    try {
      const job = await enqueueScan({ userId, countryCode: COUNTRY, city, niche });
      return NextResponse.json({ ...result, status: "queued", job }, { headers });
    } catch (err) {
      // Rezervacija je potrošena, a posao nije upisan — vrati je korisniku.
      await releaseCacheMiss(userId);
      throw err;
    }
  } catch (err) {
    console.error("[api/search]", err);
    return NextResponse.json(
      { greska: "Pretraga trenutno ne radi. Pokušaj ponovo za koji minut." },
      { status: 500, headers },
    );
  }
}
