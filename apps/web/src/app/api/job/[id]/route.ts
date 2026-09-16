// apps/web/src/app/api/job/[id]/route.ts
// Status posla za klijentsko pollovanje.
//
// Vlasništvo se proverava kroz `job_subscribers` i RLS politiku „own
// subscriptions", ne poređenjem sa `payload.userId` — jedan `scan` posao ume da
// ima više pretplatnika kad dva korisnika traže istu kombinaciju (0003 §1).
//
// Nepostojeći i tuđi posao daju isti odgovor: 404. Razlika bi rekla napadaču
// koji ID-jevi postoje.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getJobForUser, MARKER_BEZ_LISTE, vracenoZaPosao } from "@/lib/jobs";
import { stanjeB, stanjeE } from "@/lib/stanja-skeniranja";
import type { JobStatusResponse } from "@/lib/search-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // [Faza 3, 3.2] Identitet ide EKSPLICITNO u RPC (get_job_for_user) — pretplata
  // se proverava u SQL-u, u istom upitu kao i čitanje posla.
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ greska: "Nisi prijavljen." }, { status: 401 });
  }

  const { id } = await params;
  const jobId = Number(id);

  if (!Number.isInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ greska: "Neispravan ID posla." }, { status: 400 });
  }

  const headers = { "Cache-Control": "private, no-store" };

  try {
    const job = await getJobForUser(userId, jobId);
    if (!job) {
      return NextResponse.json({ greska: "Posao ne postoji." }, { status: 404, headers });
    }

    // [0034] Iznos se čita samo kad ima šta da se javi — pao posao. Kredit je
    // do ovog trenutka već vraćen, u istoj transakciji u kojoj je posao pao.
    const vraceno = job.status === "failed" ? await vracenoZaPosao(userId, job.id) : 0;

    // Dva različita pada, dva teksta (`lib/stanja-skeniranja.ts`): skeniranje koje NIJE uspelo je
    // stanje E, a skeniranje koje jeste prošlo ali lista nije stigla do korisnika
    // je stanje B. Razliku pravi interni marker u `last_error`; sam `last_error`
    // NIKAD ne izlazi korisniku — ni on, ni broj posla.
    const bezListe = (job.error ?? "").startsWith(MARKER_BEZ_LISTE);
    const stanje = bezListe ? stanjeB({ vraceno }) : stanjeE({ vraceno });

    const body: JobStatusResponse = {
      id: job.id,
      status: job.status,
      progress: job.progress,
      greska: job.error ? `${stanje.naslov}. ${stanje.telo}` : null,
      vraceno,
    };

    return NextResponse.json(body, { headers });
  } catch (err) {
    console.error("[api/job]", err);
    return NextResponse.json(
      { greska: "Status posla trenutno nije dostupan." },
      { status: 500, headers },
    );
  }
}
