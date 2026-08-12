// apps/web/src/app/api/search/kes/route.ts
// Lista besplatnih pretraga (F9 §3).
//
// Postoji odvojeno od strane, iako stranu crta server i listu ionako dobija na
// prvom renderu: posle završenog skeniranja lista mora da se osveži bez ponovnog
// učitavanja cele strane. `router.refresh()` bi ponovo povukao i taksonomiju i
// balans, a ovde je dovoljno nekoliko desetina redova.
//
// U odgovoru nema nijednog podatka o firmi — samo grad, niša, brojevi i datumi.
// Zato ovde nema ni provere otključavanja: nema šta da procuri (pravilo 9).

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { listaKesa } from "@/lib/search-cache";
import type { KesStavka } from "@/lib/search-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ greska: "Nisi prijavljen." }, { status: 401 });
  }

  try {
    const stavke = await listaKesa(userId);

    // `mine` zavisi od korisnika, pa odgovor nikad ne sme u deljeni keš.
    return NextResponse.json(
      { stavke } satisfies { stavke: KesStavka[] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[api/search/kes]", err);
    return NextResponse.json(
      { greska: "Lista keširanih pretraga trenutno nije dostupna." },
      { status: 500 },
    );
  }
}
