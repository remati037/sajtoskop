// apps/web/src/app/api/cron/utisci-slike/route.ts
// Nedeljno čišćenje sirotana u bucketu `feedback` (F11 §9).
//
// Sirotan je slika koja je otpremljena, a utisak uz nju nikad poslat — otprema i
// slanje su dva zahteva, a između njih stoji čovek koji sme da se predomisli.
// S2 je napunio bucket, ali ga nije čistio (v. „S2 — šta se razišlo", tačka 11);
// ovo je taj dug.
//
// Briše se samo ono što je starije od 24 h I što nijedan `feedback.screenshot_path`
// ne pominje. Sumnja uvek ide u korist fajla: sve što se ne može pouzdano
// proglasiti sirotanom ostaje na disku, jer se obrisana slika uz živu prijavu ne
// vraća.
//
// ── ova ruta NIJE u `vercel.json` ────────────────────────────
// Hobby plan dozvoljava dva cron posla, a oba su zauzeta: digest u 21:00 i
// nedeljni izveštaj. Ovaj je od njih trojice najmanje hitan — sirotan je nekoliko
// stotina kilobajta u privatnom bucketu, a ne pogrešna brojka ni propušten bug.
// Pokreće se rukom, jednom u nekoliko nedelja:
//
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//        https://app.sajtoskop.com/api/cron/utisci-slike
//
// ‼️ Od S24 je aplikacija na `app.` poddomenu. Goli domen je LANDING i ovu rutu
//    nema — komanda protiv njega vraća tuđi `404` i izgleda kao da je cron pao.
//
// Posao je idempotentan i bezbedan za ponavljanje: drugi poziv za redom nema šta
// da obriše. Kad projekat ikad pređe na Pro, dodaje se red u `vercel.json` i
// ništa u kodu se ne menja.

import { RADNJE } from "@/lib/admin";
import { saCronAuditom } from "@/lib/cron";
import { obrisiSirotanskeSlike } from "@/lib/slika";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Listanje bucketa po fasciklama ume da potraje kad korisnika bude više. */
export const maxDuration = 60;

async function pokreni(req: Request): Promise<Response> {
  return saCronAuditom(req, RADNJE.CRON_SLIKE, async () => {
    const ishod = await obrisiSirotanskeSlike();

    // Nedelja u kojoj nije bilo nijednog sirotana ne ostavlja red — isto pravilo
    // kao za prazan digest. Greška ga ostavlja uvek, i to je ono zbog čega bi se
    // u reviziju uopšte gledalo.
    const vredi = ishod.obrisano > 0 || ishod.greska !== null || ishod.odseceno;

    return {
      telo: {
        obrisano: ishod.obrisano,
        pregledano: ishod.pregledano,
        odseceno: ishod.odseceno,
        razlog: ishod.greska,
      },
      audit: vredi
        ? {
            obrisano: ishod.obrisano,
            pregledano: ishod.pregledano,
            ...(ishod.odseceno ? { odseceno: true } : {}),
            ...(ishod.greska ? { greska: ishod.greska } : {}),
          }
        : null,
    };
  });
}

export async function GET(req: Request): Promise<Response> {
  return pokreni(req);
}

export async function POST(req: Request): Promise<Response> {
  return pokreni(req);
}
