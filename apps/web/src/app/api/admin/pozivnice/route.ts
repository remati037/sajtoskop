// apps/web/src/app/api/admin/pozivnice/route.ts
// Pozivanje u betu i opoziv pozivnice (F12 §3.3, §4).
//
// `POST` sa `nacin: "pozivnica"` šalje pozivnicu, sa `nacin: "nalog"` otvara
// nalog odmah. Dve radnje, dva `action`-a u dnevniku (`invite.create` i
// `user.create`) — filter na `/admin/revizija` je po `action`, pa bi jedna
// radnja sa načinom u `payload`-u značila da se „koga sam pozvao" čita red po
// red.
//
// `GET`-a ovde nema: spisak pozivnica čita serverska komponenta ekrana, kroz
// `citajPozivnice()` (isti razlog kao za listu korisnika — v. „S3 — šta se
// razišlo", tačka 3).
//
// ── lozinka ──────────────────────────────────────────────────
// Kod otvaranja naloga generisana lozinka izlazi u `podaci` ovog odgovora i
// nigde više. U `payload` reda u dnevniku ne ulazi, jer u njega uopšte ne stiže
// (v. `otvoriNalog()`).

import { originZahteva, RADNJE } from "@/lib/admin";
import { opozivBodySchema, pozivnicaBodySchema } from "@/lib/admin-radnje-schema";
import { opoziviPozivnicu, otvoriNalog, posaljiPozivnicu } from "@/lib/admin-pozivnice";
import { pripremiRadnju, procitajTelo, saAuditom } from "@/lib/admin-radnje";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;

  // Telo se čita pre `saAuditom()` samo zbog `action`-a: bez načina se ne zna
  // koja se radnja upisuje. Neispravno telo zato dobija svoj `saAuditom()` sa
  // podrazumevanom radnjom — trag ostaje i kad pokušaj ne prođe kroz šemu
  // (v. „S4 — šta se razišlo", tačka 10).
  const telo = await procitajTelo(req, pozivnicaBodySchema);
  if (!telo.ok) {
    return saAuditom(
      { actor, action: RADNJE.POZIVNICA, target: null, ip },
      async () => telo.ishod,
    );
  }

  const { email, poruka, nacin } = telo.telo;
  // Ide u mejl, odakle se ne može ispraviti — zato iz headera koje šalje
  // pregledač, a ne iz `req.url`, koji iza proxyja ume da nosi interni host.
  const origin = originZahteva(req);

  return saAuditom(
    {
      actor,
      action: nacin === "nalog" ? RADNJE.NALOG : RADNJE.POZIVNICA,
      // Naloga u `profiles` još nema, pa „nad kim" ostaje prazno — adresa je u
      // `payload`-u. Kolona `target_user` je ono iz čega revizija pravi link na
      // detalj korisnika, a link na nepostojeći nalog je `404`.
      target: null,
      ip,
      payload: { email },
    },
    async () =>
      nacin === "nalog"
        ? otvoriNalog(email, poruka, origin)
        : posaljiPozivnicu(email, poruka, origin),
  );
}

export async function DELETE(req: Request): Promise<Response> {
  const priprema = await pripremiRadnju(req);
  if (!priprema.ok) return priprema.odgovor;

  const { actor, ip } = priprema;

  return saAuditom(
    { actor, action: RADNJE.POZIVNICA_OPOZIV, target: null, ip },
    async () => {
      const telo = await procitajTelo(req, opozivBodySchema);
      if (!telo.ok) return telo.ishod;

      return opoziviPozivnicu(telo.telo.id);
    },
  );
}
