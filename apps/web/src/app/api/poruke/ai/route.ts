// apps/web/src/app/api/poruke/ai/route.ts
// „Napiši drugačije" — AI varijanta poruke (F7 §2).
//
// POST upisuje posao u red i vraća `jobId`; klijent polluje `/api/job/:id` kao
// kod scana, pa na „done" povlači tekst kroz GET. Anthropic se ne zove odavde —
// zove ga worker (00-kontekst §3, i ceo prompt živi tamo).
//
// Naplata: poziv ne troši kredit. Troši DVA dnevna limita: po korisniku
// (`claim_ai_rewrite`, `PLANS[plan].aiRewritePerDay` — 5 / 20 / 60, ono što
// cenovnik obećava) i globalni cap `ai:outreach` u workeru (`api_budget.by_kind`,
// štiti moj račun kod Anthropica). Razlog za limit umesto kredita: kredit vredi
// €0,15–0,29, a poziv pola centa — kredit bi bio 40× precenjen i ubio bi jedinu
// funkciju koja pravi naviku (naplata-stripe.md §14.2).
//
// [S25, B1] Do S25 `claim_ai_rewrite` niko nije zvao: `aiRewritePerDay` sa
// cenovnika nije postojao u praksi. Sada je kapija OVDE, pre upisa posla;
// worker na svaki pad posle upisa vraća rezervaciju (`release_ai_rewrite`).
//
// [S19] Kapija pristupa je svejedno ona za TROŠENJE, ne za čitanje. „Ne troši
// kredit" nije isto što i „ne košta": svaka varijanta je plaćen Anthropic poziv
// iz mog džepa. `grace` nalog dobija svoje poruke — one se generišu bez ijednog
// spoljnog poziva, na `GET /api/poruke` — ali ne i nove AI varijante.

import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { brojReci, PLANS, type AiRewriteClaimResult } from "@sajtoskop/shared";
import { requireUserId } from "@/lib/auth";
import { enqueueRewrite, getJobForUser } from "@/lib/jobs";
import { kanalEnum } from "@/lib/pipeline-schema";
import { citajPristup, odbijenica } from "@/lib/pristup";
import { proveriIpTempo } from "@/lib/rate-limit";
import type { ApiError } from "@/lib/search-types";
import { adminSupabase, userSupabase } from "@/lib/supabase";
import { formatDatum } from "@/lib/ui-tekst";

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
  // IP tempo pre svega (Faza 1, 1.2) — AI varijanta troši dnevni cap.
  const ogranicen = await proveriIpTempo(req, "poruke-ai");
  if (ogranicen) return ogranicen;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return greska("Nisi prijavljen.", 401);
  }

  const { pristup } = await citajPristup();
  const odbijenPristup = odbijenica(pristup, "ai-poruka");
  if (odbijenPristup) return odbijenPristup;

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

    // Dnevni limit po PLANU KAPIJE, ne po `profiles.plan`: `dopuna` ima svoje
    // limite (§1.3), a plan koji joj je istekao bi joj dao tuđe. `pristup` je
    // ovde uvek pun (kapija iznad), ali ume da bude `null` na kvaru veze — tada
    // se uzima najmanji limit, jer je to jedini koji ne obećava više nego što
    // ijedan plan daje.
    const limit = PLANS[pristup?.planLimita ?? "dopuna"].aiRewritePerDay;
    const { data: claimData, error: claimErr } = await adminSupabase().rpc("claim_ai_rewrite", {
      p_user: userId,
      p_limit: limit,
    });
    if (claimErr) throw new Error(`claim_ai_rewrite: ${claimErr.message}`);

    const claim = ((claimData ?? []) as AiRewriteClaimResult[])[0];
    if (!claim) throw new Error("claim_ai_rewrite nije vratio rezultat.");

    if (!claim.ok) {
      if (claim.reason === "no_user") {
        return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
      }
      // 429 sa TAČNIM datumom reseta — LA ponoć, ista po kojoj se resetuju i
      // ostali dnevni brojači (`BUDGET_TIMEZONE`).
      return greska(
        `Iskoristio si ${claim.used} ${claim.used === 1 ? "varijantu" : "varijanti"} za danas. ` +
          `Limit se resetuje ${formatDatum(claim.reset_at)} u 9 ujutru.`,
        429,
      );
    }

    const ime = (await currentUser())?.firstName?.trim() || null;
    let posao: Awaited<ReturnType<typeof enqueueRewrite>>;
    try {
      posao = await enqueueRewrite({ userId, placeId, channel, senderName: ime });
    } catch (err) {
      // Rezervacija je potrošena, a posao nije upisan — vrati je korisniku.
      const { error: relErr } = await adminSupabase().rpc("release_ai_rewrite", { p_user: userId });
      if (relErr) console.error(`[api/poruke/ai] release_ai_rewrite: ${relErr.message}`);
      throw err;
    }

    // Dupli klik deli postojeći posao — druga rezervacija se vraća, jer ni
    // drugi Anthropic poziv neće nastati.
    if (posao.joined) {
      const { error: relErr } = await adminSupabase().rpc("release_ai_rewrite", { p_user: userId });
      if (relErr) console.error(`[api/poruke/ai] release_ai_rewrite: ${relErr.message}`);
    }

    return NextResponse.json({ jobId: posao.jobId, joined: posao.joined }, { headers: HEADERS });
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
  // [Faza 3, 3.2] Identitet ide eksplicitno u get_job_for_user (pretplata u SQL-u).
  let userId: string;
  try {
    userId = await requireUserId();
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
    // `getJobForUser` proverava pretplatu kroz RPC — tuđi i nepostojeći posao
    // daju isti odgovor, kao i u `/api/job/:id`.
    const job = await getJobForUser(userId, jobId);
    if (!job) return greska("Posao ne postoji.", 404);

    // [Faza 2, 2.4] Pretplata ne znači da je posao za BAŠ ovaj lead (W4):
    // korisnik sa dva rewrite posla ume da dobije poruku drugog. Payload je iz
    // baze, ne iz URL-a — uparivanje se radi ovde, pre čitanja poruke.
    const { data: posao } = await adminSupabase()
      .from("job_queue")
      .select("payload")
      .eq("id", jobId)
      .maybeSingle<{ payload: Record<string, unknown> }>();

    if (!posao) return greska("Posao ne postoji.", 404);

    const payloadPlace = posao.payload.placeId;
    const payloadKanal = posao.payload.channel;
    if (
      job.type !== "rewrite_message" ||
      payloadPlace !== placeId ||
      payloadKanal !== channel.data
    ) {
      // Isti odgovor kao za tuđ posao — ne otkriva se šta u payloadu stoji.
      return greska("Posao ne postoji.", 404);
    }

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
