// apps/web/src/app/api/export/route.ts
// CSV izvoz otključanih prospekata (F4 §5).
//
// `GET`, a ne `POST`: ovo je preuzimanje fajla, pa mora da radi iz običnog
// `<a download>` linka. Ništa se ne menja osim dnevnog brojača izvoza, i to je
// jedini razlog zbog kog GET ovde uopšte piše u bazu.
//
// `?limit=99999` je pokriven u `exportUnlockedCsv`: parametar je želja, a cap je
// odluka baze (F4 §7).

import { NextResponse } from "next/server";
import { CITY_SLUGS, NICHE_SLUGS, planFor } from "@sajtoskop/shared";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { exportUnlockedCsv } from "@/lib/export";
import { getOwnProfile } from "@/lib/profile";
import type { ApiError } from "@/lib/search-types";
import { formatDatum } from "@/lib/ui-tekst";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

// Query parametri, ne telo — GET ga nema. Nepoznat grad ili niša su greška, a ne
// tihi „izvezi sve": korisnik koji dobije ceo spisak umesto filtriranog troši
// dnevni cap na nešto što nije tražio.
const querySchema = z.object({
  city: z.enum(CITY_SLUGS, { error: "Nepoznat grad." }).optional(),
  niche: z.enum(NICHE_SLUGS, { error: "Nepoznata niša." }).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

function greska(poruka: string, status: number, detalji?: string[]): Response {
  const body: ApiError = detalji ? { greska: poruka, detalji } : { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function GET(req: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    city: url.searchParams.get("city") ?? undefined,
    niche: url.searchParams.get("niche") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return greska(
      "Neispravni parametri izvoza.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "upit"}: ${i.message}`),
    );
  }

  try {
    const profile = await getOwnProfile();

    // Bez profila kroz RLS ne znamo ni plan ni da li je lista stvarno prazna —
    // `getMojaLista()` čita `unlocks` istim klijentom i istom politikom, pa bi
    // vratila prazno i korisnik bi dobio „nemaš nijedan otključan prospekt" iako
    // ih ima. Obrazloženje je u `components/veza-greska.tsx`.
    //
    // 503, a ne 500: ovo nije bag u kodu nego privremeno neispravna veza sa
    // bazom, i prolazi samo od sebe kad se Clerk↔Supabase podesi.
    if (!profile) {
      return greska(
        "Ne mogu da pročitam tvoj nalog iz baze, pa izvoz nije bezbedan — " +
          "vratio bi prazan fajl umesto tvojih prospekata. Podaci su netaknuti. " +
          "Osveži stranicu, pa ako se ponovi, javi mi.",
        503,
      );
    }

    const plan = profile.plan;

    const rezultat = await exportUnlockedCsv({
      userId,
      plan,
      filter: { citySlug: parsed.data.city, nicheSlug: parsed.data.niche },
      limit: parsed.data.limit,
    });

    if (!rezultat.ok) {
      if (rezultat.reason === "nothing_to_export") {
        return greska(
          "Nemaš nijedan otključan prospekt za ovaj izbor. Otključaj nešto pa probaj ponovo.",
          409,
        );
      }

      if (rezultat.reason === "no_user") {
        return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
      }

      return greska(
        `Dostigao si dnevni limit izvoza od ${planFor(plan).exportPerDay} redova ` +
          `(danas: ${rezultat.used}). Limit se resetuje ${formatDatum(rezultat.resetAt)} u 9 ujutru.`,
        429,
      );
    }

    return new NextResponse(rezultat.csv, {
      headers: {
        ...HEADERS,
        // `charset=utf-8` uz BOM iz `toCsv` — Excel na Windowsu inače lomi
        // dijakritiku bez obzira na sadržaj fajla.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${rezultat.filename}"`,
        // Koliko je odsečeno dnevnim capom. UI iz ovoga pravi poruku posle
        // preuzimanja — u telu odgovora nema mesta, ono je fajl.
        "X-Sajtoskop-Rows": String(rezultat.rows),
        "X-Sajtoskop-Truncated": String(rezultat.truncated),
      },
    });
  } catch (err) {
    console.error("[api/export]", err);
    return greska("Izvoz trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}
