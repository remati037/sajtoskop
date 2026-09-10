// apps/web/src/app/api/admin/pozivnice/pristup/route.ts
// Nova pristupna pozivnica — komp ili prvi mesec gratis (S27, naplata-stripe.md §9.3).
//
// Tanka kao sve rute pod `/api/admin`: `pripremiRadnju()` (admin, tempo — ko
// nije admin dobija 404 sa praznim telom, pravilo 13), telo kroz šemu, poziv u
// `lib/pozivnice-pristup.ts`, trag kroz `saAuditom()` i na uspeh i na pad
// (pravilo 14).
//
// Radnja je `invite.create`, ista kao za Clerk pozivnicu — tako traži K3. Dve
// vrste se u reviziji razlikuju po `payload.tip`: `pristupna` ovde, a Clerk
// pozivnica nosi `nacin`. `target` je prazan: nalog još ne postoji.
//
// `GET`-a nema: spisak čita serverska komponenta ekrana (isti razlog kao za
// Clerk pozivnice, v. „S3 — šta se razišlo", tačka 3).

import { RADNJE } from "@/lib/admin";
import { pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";
import { napraviPozivnicu } from "@/lib/pozivnice-pristup";
import { pozivnicaPristupBodySchema } from "@/lib/pozivnice-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;

  return saAuditom(
    { actor, action: RADNJE.POZIVNICA, target: null, ip, payload: { tip: "pristupna" } },
    async () => {
      const telo = await procitajTelo(req, pozivnicaPristupBodySchema);
      if (!telo.ok) return telo.ishod;

      return napraviPozivnicu(actor, telo.telo);
    },
  );
}
