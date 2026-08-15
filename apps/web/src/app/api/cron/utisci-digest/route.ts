// apps/web/src/app/api/cron/utisci-digest/route.ts
// Dnevni mejlovi, 21:00 (F11 §7, odluka 11) — dva posla u istom prolazu:
//
//   1. „Rešeno je ono što si prijavio" — korisnicima čije su prijave rešene
//      (F11.4 §7): najviše 1 mejl dnevno po korisniku, jedan mejl za više
//      prijava, 3 pokušaja po prijavi (F11 §9).
//   2. Digest utisaka — meni, sve što nije išlo instant.
//
// Oba žive u istoj ruti jer oba idu JEDNOM dnevno, a Vercel Hobby dozvoljava
// samo dva cron rasporeda (v. `vercel.json`). Redosled je namerno: korisniku
// pre sebe — njegov mejl je o odgovoru na ono što je tražio, digest je o meni.
//
// Ovo NIJE admin ruta: nema sesiju, nema aktera i ne prolazi kroz
// `pripremiRadnju()`. Umesto prava, ovde stoji tajna (`CRON_SECRET`, poređena
// otporno na vreme) — ali sve ostalo ostaje: posao menja podatke, pa ostavlja
// red u `admin_audit`, sa `actor_id = null`.
//
// `GET` je ono što stvarno okida raspored — Vercel Cron ne ume drugu metodu.
// `POST` postoji za ručno pokretanje iz terminala:
//
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" https://…/api/cron/utisci-digest

import { RADNJE } from "@/lib/admin";
import { saCronAuditom } from "@/lib/cron";
import { posaljiDigest, posaljiResenoObavestenja } from "@/lib/utisci-izvestaj";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * Oba posla nose do 100+ Resend poziva; podrazumevanih 10 s je tesno i za
 * digest od 150 zapisa („S6", ručni korak 4).
 */
export const maxDuration = 60;

async function pokreni(req: Request): Promise<Response> {
  return saCronAuditom(req, RADNJE.CRON_DIGEST, async (osnova) => {
    const [reseno, digest] = await Promise.all([
      posaljiResenoObavestenja(osnova),
      posaljiDigest(osnova),
    ]);

    // Prazan dan ne šalje nijedan mejl i ne ostavlja trag — nije se ništa
    // promenilo (pravilo „prazan dan nema red" iz „S6", tačka 13).
    const promenjeno = reseno.poslato > 0 || reseno.preskoceno > 0 || digest.poslato > 0;

    return {
      telo: {
        reseno: { poslato: reseno.poslato, preskoceno: reseno.preskoceno },
        digest: { poslato: digest.poslato, razlog: digest.razlog },
      },
      audit: promenjeno
        ? { reseno: reseno.poslato + reseno.preskoceno, digest: digest.poslato }
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
