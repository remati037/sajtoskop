// apps/web/src/app/api/poruke/ai/route.ts
// „Napiši drugačije" — AI varijanta poruke (F7 §2).
//
// POST upisuje posao u red i vraća `jobId`; klijent polluje `/api/job/:id` kao
// kod scana, pa na „done" povlači tekst kroz GET. Anthropic se ne zove odavde —
// zove ga worker (00-kontekst §3, i ceo prompt živi tamo).
//
// Naplata: poziv ne troši kredit. Troši dnevni cap `ai:outreach`, koji je
// globalan i stoji u `api_budget.by_kind`. Razlog je što je ovo varijanta
// poruke za lead koji je korisnik već platio, a ne nov podatak.

import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { brojReci } from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { enqueueRewrite, getJobForUser } from "@/lib/jobs";
import { kanalEnum } from "@/lib/pipeline-schema";
import type { ApiError } from "@/lib/search-types";
import { userSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

const bodySchema = z.object({
  placeId: z.string().min(1).max(255),
  channel: kanalEnum,
});

function greska(poruka: string, status: number): Response {
  const body: ApiError = { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

/** Kroz RLS politiku „own unlocks" — ista brava kao u `lib/poruke.ts`. */
async function jeOtkljucan(placeId: string): Promise<boolean> {
  const { data, error } = await userSupabase()
    .from("unlocks")
    .select("place_id")
    .eq("place_id", placeId)
    .maybeSingle<{ place_id: string }>();

  if (error) throw new Error(`Provera otključanja nije uspela: ${error.message}`);
  return !!data;
}

export async function POST(req: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return greska("Telo zahteva nije ispravan JSON.", 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return greska("Neispravan zahtev.", 400);

  const { placeId, channel } = parsed.data;

  try {
    // Provera pre upisa posla, ne u workeru: posao za neotključan lead ne treba
    // ni da nastane. Worker je svejedno proverava ponovo — red poslova je
    // `jsonb` i ne sme da veruje da ga je upisala proverena ruta.
    if (!(await jeOtkljucan(placeId))) return greska("Taj prospekt nije otključan.", 403);

    const ime = (await currentUser())?.firstName?.trim() || null;
    const { jobId, joined } = await enqueueRewrite({ userId, placeId, channel, senderName: ime });

    return NextResponse.json({ jobId, joined }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/poruke/ai POST]", err);
    return greska("Pisanje varijante trenutno ne radi. Pokušaj ponovo za koji minut.", 500);
  }
}

/**
 * Varijanta koju je napisao BAŠ traženi posao.
 *
 * ── zašto `jobId`, a ne samo `placeId` ────────────────────
 * Posao koji ne uspe (model prekršio pravila, dnevni cap) namerno ne upisuje
 * ništa. Bez vezivanja za posao, upit „poslednja AI poruka za ovaj lead" bi tada
 * vratio varijantu od pre sat vremena i klijent bi je prikazao kao novu —
 * neuspeh bi izgledao kao uspeh, i to isti tekst svaki put.
 *
 * Zato se čita `job_queue.created_at` (uz proveru pretplate) i uzima se samo
 * poruka nastala posle tog trenutka. Vreme dolazi iz baze, pa sat pregledača ne
 * učestvuje u odluci.
 *
 * Čita se kroz `userSupabase()`, dakle kroz politiku „own rows" nad
 * `outreach_messages`. Tuđa poruka se ne može pročitati ni sa tačnim `placeId`-om.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  const url = new URL(req.url);
  const placeId = url.searchParams.get("placeId")?.trim();
  const channel = kanalEnum.safeParse(url.searchParams.get("channel"));
  const jobId = Number(url.searchParams.get("jobId"));

  if (!placeId || !channel.success || !Number.isInteger(jobId) || jobId <= 0) {
    return greska("Neispravan zahtev.", 400);
  }

  try {
    // `getJobForUser` proverava pretplatu kroz RLS — tuđi i nepostojeći posao
    // daju isti odgovor, kao i u `/api/job/:id`.
    const job = await getJobForUser(jobId);
    if (!job) return greska("Posao ne postoji.", 404);

    const { data, error } = await userSupabase()
      .from("outreach_messages")
      .select("body, created_at")
      .eq("place_id", placeId)
      .eq("channel", channel.data)
      .eq("source", "ai")
      .gte("created_at", job.createdAt)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ body: string; created_at: string }>();

    if (error) throw new Error(error.message);

    // Posao gotov, a poruke nema → model nije dao ništa upotrebljivo. To je
    // uredan ishod, ne kvar, i korisniku se kaže baš tako.
    if (!data) {
      return greska(
        "Model nije napisao verziju koja prolazi pravila kopija. Šablon iznad ostaje.",
        404,
      );
    }

    // Broj reči se računa ovde, a ne u komponenti: `brojReci` je deo generatora
    // i ima svoju definiciju reči (samostalna crta se ne broji). Druga
    // implementacija u klijentu bi bila drugi izvor istine za isti broj.
    return NextResponse.json({ body: data.body, words: brojReci(data.body) }, { headers: HEADERS });
  } catch (err) {
    console.error("[api/poruke/ai GET]", err);
    return greska("Čitanje varijante trenutno ne radi.", 500);
  }
}
