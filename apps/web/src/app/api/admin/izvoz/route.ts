// apps/web/src/app/api/admin/izvoz/route.ts
// Izvoz korisnika u CSV (F12 §4, §5).
//
// `GET`, a ne `POST`, iz istog razloga kao `/api/export`: ovo je preuzimanje
// fajla i mora da radi iz običnog `<a download>` linka.
//
// ── zašto onda ide kroz `pripremiRadnju()` ───────────────────
// Zato što po §5 mora da ostavi red u dnevniku, sa brojem redova: ovo je jedini
// put kojim PII izlazi iz sistema u fajl. GET koji piše u `admin_audit` je
// posledica tog zahteva, a ne previd — i pošto piše, troši i tempo od 120/h,
// što je tačno ponašanje koje želim za radnju koja iznosi tuđe mejlove.
//
// `saAuditom()` se ovde NE koristi: on vraća JSON sa rečenicom, a ovo vraća
// fajl. Upis zato ide ručno, u obe grane.

import { ipZahteva, RADNJE, upisiAudit } from "@/lib/admin";
import { greska, pripremiRadnju } from "@/lib/admin-radnje";
import { izveziKorisnike, IZVOZ_MAX } from "@/lib/admin-izvoz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Danas postoji tačno jedan izvoz. `sta` postoji da bi drugi mogao da se doda. */
const DOZVOLJENO = ["korisnici"];

export async function GET(req: Request): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor } = priprema;
  const ip = ipZahteva(req);
  const sta = new URL(req.url).searchParams.get("sta") ?? "korisnici";

  if (!DOZVOLJENO.includes(sta)) {
    await upisiAudit({
      actor,
      action: RADNJE.IZVOZ,
      payload: { sta },
      ok: false,
      error: "nepoznat izvoz",
      ip,
    });
    return greska("Nepoznat izvoz. Danas postoji samo `sta=korisnici`.", 400);
  }

  try {
    const izvoz = await izveziKorisnike();

    await upisiAudit({
      actor,
      action: RADNJE.IZVOZ,
      // Broj redova je poenta ovog reda u dnevniku: „izvezao sam listu" i
      // „izvezao sam listu od 380 ljudi" nisu isti događaj.
      payload: { sta, redova: izvoz.redova, odseceno: izvoz.odseceno },
      ok: true,
      ip,
    });

    return new Response(izvoz.csv, {
      headers: {
        "Cache-Control": "private, no-store",
        // `charset=utf-8` uz BOM iz `toCsv` — Excel na Windowsu inače lomi
        // dijakritiku bez obzira na sadržaj fajla.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${izvoz.filename}"`,
        "X-Sajtoskop-Rows": String(izvoz.redova),
        // Tiho odsečen fajl je fajl na osnovu koga se donese pogrešan zaključak.
        "X-Sajtoskop-Truncated": String(izvoz.odseceno),
        "X-Sajtoskop-Max": String(IZVOZ_MAX),
      },
    });
  } catch (err) {
    const poruka = err instanceof Error ? err.message : String(err);
    console.error("[admin] izvoz korisnika:", err);

    await upisiAudit({ actor, action: RADNJE.IZVOZ, payload: { sta }, ok: false, error: poruka, ip });
    return greska("Izvoz nije prošao. Pokušaj ponovo za koji trenutak.", 500);
  }
}
