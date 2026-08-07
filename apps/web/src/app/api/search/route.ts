// apps/web/src/app/api/search/route.ts
// Jedini ulaz u pretragu. U F2 čita isključivo iz keša — nula Google poziva.
//
// Zaštita NIJE u middleware-u (Clerk je deprecirao `createRouteMatcher`), nego
// prva linija handlera: `requireUserId()`. Bez sesije nema odgovora, i to pre
// nego što se telo uopšte pogleda.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { searchCachedLeads } from "@/lib/search";
import { searchBodySchema } from "@/lib/search-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  try {
    const result = await searchCachedLeads({ userId, city, niche, filters, page });
    return NextResponse.json(result, {
      // Rezultat zavisi od toga ko pita (šta je otključano) — nikad u deljeni keš.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[api/search]", err);
    return NextResponse.json(
      { greska: "Pretraga trenutno ne radi. Pokušaj ponovo za koji minut." },
      { status: 500 },
    );
  }
}
