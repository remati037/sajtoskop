// apps/web/src/app/api/feedback/route.ts
// Nastanak utiska (F10 §2, prošireno F11 §5). Zove se na klik na ocenu ili na
// klik na odgovor — nema potvrde, nema koraka pre njega.
//
// Redosled je cela odluka 3 iz F10: prvo upis, pa tek onda mejl. Obrnuto bi
// značilo da jedan pad Resend-a briše utisak. Zato je mejl u `after()` i njegov
// ishod ne dodiruje odgovor korisniku — 200 je 200 i kad mejl padne.
//
// `userId` dolazi ISKLJUČIVO iz `requireUserId()`. Iz tela izlaze ocena, ključ
// pitanja, odgovor, putanja i dimenzije prozora — nikad plan, krediti, naziv
// ekrana, `status`, `severity` ni `reward_credits` (pravilo 8, F11 §5).
//
// Pravilo 16, doslovno: `prompt_key` koji ne postoji u `feedback-katalog.ts`
// vraća 400, a `answers` se validira Zod šemom IZ kataloga, po ključu — nikad
// generičkim recordom.

import { after, NextResponse } from "next/server";
import { proveriOdgovor, vaziPitanje, type FeedbackSource, type Pitanje } from "@sajtoskop/shared";
import { originZahteva } from "@/lib/admin";
import { requireUserId } from "@/lib/auth";
import {
  ideOdmah,
  javiMejlom,
  nagradaDostupna,
  upisiIshodMejla,
  zabeleziUtisak,
  MEJL_DNEVNI_LIMIT,
} from "@/lib/feedback";
import { utisakBodySchema, type UtisakOdgovor } from "@/lib/feedback-schema";
import { proveriIpTempo } from "@/lib/rate-limit";
import type { ApiError } from "@/lib/search-types";
import { mojaPutanja } from "@/lib/slika";
import { zabeleziOdgovor } from "@/lib/utisci";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store" };

function greska(poruka: string, status: number, detalji?: string[]): Response {
  const body: ApiError = detalji ? { greska: poruka, detalji } : { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

/** Izvor se IZVODI iz sloja pitanja, ne prima iz tela (F11 §5). */
const IZVOR_ZA_SLOJ: Record<Pitanje["sloj"], FeedbackSource> = {
  kontekst: "pitanje",
  kampanja: "kampanja",
  incident: "incident",
};

// [Faza 1, 1.5] Za utiske VAN pitanja `kind` i `source` se izvode na serveru
// (nalaz N2). `bug` i `incident` postoje samo u katalogu — klijent koji pošalje
// `{rating:3, kind:'bug', source:'incident'}` bez `prompt_key` ne sme da
// izazove instant mejl ni da zagadi metriku bugova.
const IZVOR_BEZ_PITANJA: readonly FeedbackSource[] = ["dugme", "podsetnik"];
const TIP_BEZ_PITANJA: readonly string[] = ["ideja", "pohvala", "drugo"];

export async function POST(req: Request): Promise<Response> {
  // IP tempo pre svega (Faza 1, 1.2) — ista brana kao na /api/unlock.
  const ogranicen = await proveriIpTempo(req, "feedback");
  if (ogranicen) return ogranicen;

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

  const parsed = utisakBodySchema.safeParse(raw);
  if (!parsed.success) {
    return greska(
      "Neispravan utisak.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`),
    );
  }

  const { rating, source, route, viewport, kind, prompt_key, answers, errors, screenshot_path } =
    parsed.data;

  // Putanja slike je jedino polje koje putuje kroz pregledač između dve rute, pa
  // je i jedino koje klijent može da zameni tuđim (v. `mojaPutanja`).
  if (screenshot_path !== undefined && !mojaPutanja(userId, screenshot_path)) {
    return greska("Ta slika nije tvoja.", 403);
  }

  // ── odgovor na pitanje: katalog je jedina kapija ───────────
  let pitanje: Pitanje | null = null;
  let cistiOdgovor: Record<string, unknown> | null = null;

  if (prompt_key !== undefined) {
    const ishod = proveriOdgovor(prompt_key, answers);
    if (!ishod.ok) return greska(ishod.greska, 400, ishod.detalji);

    // Pitanju je istekao rok (`do:`). Motor ga odavno ne nudi; ovo hvata zaostao
    // tab koji ga je video pre ponoći i odgovorio posle nje.
    if (!vaziPitanje(ishod.pitanje, Date.now())) {
      return greska("To pitanje više nije aktivno.", 410);
    }

    pitanje = ishod.pitanje;
    cistiOdgovor = ishod.answers;
  } else {
    // [Faza 1, 1.5] Bez pitanja nema ni `bug`-a ni `incident`-a (v. gore).
    if (!IZVOR_BEZ_PITANJA.includes(source)) {
      return greska("Neispravan izvor utiska.", 400);
    }
    if (kind !== undefined && !TIP_BEZ_PITANJA.includes(kind)) {
      return greska("Neispravan tip utiska.", 400);
    }
  }

  // Prijava kvara je svojstvo pitanja i odgovora, ne tela zahteva: „Pošalji mi
  // dnevnik" nosi `kind: 'bug'` i težinu 2, a „Ne treba" ne nosi ništa.
  const prijava =
    pitanje?.prijava && cistiOdgovor?.odgovor === pitanje.prijava.odgovor
      ? pitanje.prijava
      : null;

  const tip = prijava?.kind ?? kind ?? null;

  // Adresa se čita PRE `after()`: tamo zahtev više ne postoji, a mejl nosi link
  // na `/admin/utisci/<id>` (F11 §7).
  const konzola = originZahteva(req);

  try {
    const ishod = await zabeleziUtisak(userId, {
      rating: rating ?? null,
      source: pitanje ? IZVOR_ZA_SLOJ[pitanje.sloj] : source,
      route: route ?? null,
      viewport: viewport ?? null,
      // UA iz headera, ne iz tela: telo koje šalje lažan UA ne menja zapis.
      ua: req.headers.get("user-agent") ?? "",
      promptKey: pitanje?.kljuc ?? null,
      answers: cistiOdgovor,
      kind: tip,
      severity: prijava?.severity ?? null,
      // Dnevnik se prosleđuje uvek, a upisuje samo uz `kind = 'bug'` — odluku
      // donosi `zabeleziUtisak`, na jednom mestu za obe rute (F11 odluka 10).
      errors: errors ?? null,
      screenshotPath: screenshot_path ?? null,
    });

    if (ishod.ishod === "no_user") {
      // Utisak bez profila ne može da postoji zbog stranog ključa. Redak i
      // prolazan slučaj: Clerk webhook nije stigao pre prvog klika.
      return greska("Tvoj nalog još nije podešen. Osveži stranicu za koji trenutak.", 409);
    }

    if (ishod.ishod === "plafon") {
      // Tvrd plafon je zaštita tabele, ne poruka korisniku (F10 §5). On i dalje
      // vidi „Hvala. Zabeleženo." — samo bez zapisa koji bi mogao da dopuni.
      return NextResponse.json(
        { id: null, dopuna: false, nagrada: false } satisfies UtisakOdgovor,
        { headers: HEADERS },
      );
    }

    const { red, posaljiMejl } = ishod;

    // Pitanje prelazi u `odgovoreno` i vezuje se sa zapisom. Ovo je i mesto gde
    // cooldown ide na 7 dana, a streak na nulu (F11 §3.1) — dakle tek kad zapis
    // stvarno postoji, ne na klik.
    if (pitanje) {
      try {
        await zabeleziOdgovor(userId, pitanje.kljuc, red.id);
      } catch (err) {
        // Utisak je upisan i to je ono što se ne sme izgubiti. Najgore što sledi
        // je da isto pitanje ostane u stanju „prikazano" i da motor ćuti kraće.
        console.error("[api/feedback] vezivanje odgovora:", err);
      }
    }

    // ── instant ili digest (F11 odluka 11) ───────────────────
    // Od F11.3 odmah ide samo ono što gori: bug, ocena 1 i incident. Sve ostalo
    // čeka digest u 21:00, koji kupi zapise sa `emailed_at is null`.
    //
    // Preko dnevnog limita mejl izostaje i tada — ali razlog stoji u bazi umesto
    // u logu koji niko ne čita (odluka 6). `emailed_at` i tada ostaje prazan, pa
    // ga digest svejedno pokupi: jedan red u dnevnom mejlu ne davi inboks, a
    // izgubljen utisak je izgubljen podatak.
    after(() => {
      if (!posaljiMejl) {
        return upisiIshodMejla(red.id, {
          ok: false,
          greska: `preko dnevnog limita od ${MEJL_DNEVNI_LIMIT} mejlova`,
        });
      }
      if (!ideOdmah(red)) return;
      return javiMejlom(red, userId, false, konzola);
    });

    // Utisak preko dnevnog limita za mejl ne ide u drugi korak: tekst koji niko
    // ne bi pročitao ne traži se (F10 §6). Korisnik toga nije svestan.
    //
    // Pitanje bez `dopuna` u katalogu takođe ne traži tekst — mikro-traka tada
    // nestaje odmah posle „Hvala".
    const traziDopunu = posaljiMejl && (pitanje === null || pitanje.dopuna !== undefined);

    // Čip „+1 kredit" stoji uz polje za tekst i samo kad je nagrada zaista
    // dostupna (§2.4). Odgovor o ceni je ne nosi nikad (odluka 8), a kvota se
    // proverava u bazi — obećanje koje se ne ispuni je gore od nikakvog.
    const nagrada =
      traziDopunu && pitanje?.bezNagrade !== true && (await nagradaDostupna(userId));

    return NextResponse.json(
      { id: red.id, dopuna: traziDopunu, nagrada } satisfies UtisakOdgovor,
      { headers: HEADERS },
    );
  } catch (err) {
    console.error("[api/feedback]", err);
    return greska("Slanje utiska trenutno ne radi. Pokušaj ponovo za koji trenutak.", 500);
  }
}
