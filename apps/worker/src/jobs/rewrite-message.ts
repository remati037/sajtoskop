// apps/worker/src/jobs/rewrite-message.ts
// „Napiši drugačije" — AI varijanta outreach poruke (F7 §2).
//
// ‼️ PROMPT ŽIVI OVDE I NIGDE VIŠE — isto pravilo kao za vision prompt u
// `ai-audit.ts`. Ovaj fajl je u `apps/worker`; web ga ne uvozi i ne sme.
//
// ── šta ovaj posao NIJE ───────────────────────────────────
// Nije zamena za šablon. Šablon je podrazumevan, besplatan i predvidiv; ovo je
// dugme koje korisnik pritisne kad mu šablonska rečenica ne leži. Zato:
//   - model dobija GOTOVU šablonsku poruku i piše varijantu, ne piše od nule
//   - fiksne rečenice (pravna, i ona koja skida pritisak) dodajemo mi, ne model
//   - izlaz prolazi kroz `proveriPoruku`, istu kapiju kroz koju prolazi šablon
//   - ako padne na proveri, ne upisuje se NIŠTA i korisnik to vidi kao takvo
//
// Poslednja stavka je cela poenta. Model koji uvede emodži, uzvičnik ili link u
// Viber poruku ne dobija priliku da to pošalje korisniku — pravila kopija su
// merena u praksi i ne pregovaraju se sa modelom.
//
// ── [S25, B1] dnevni limit po korisniku ─────────────────────
// Ruta je PRE upisa posla rezervisala jedno mesto u dnevnom limitu plana
// (`claim_ai_rewrite`). Svaki pad posle toga — neotključan lead, nestao
// prospekt, generator odbio, globalni cap, model bez upotrebljivog izlaza —
// vraća rezervaciju (`release_ai_rewrite`), da korisnik ne plati limitom nešto
// što nije dobio. Uspeh je ne vraća: to je jedina varijanta koja se broji.

import Anthropic from "@anthropic-ai/sdk";
import {
  brojReci,
  GRANICE,
  napisiPoruke,
  proveriPoruku,
  repZauzima,
  sastaviVarijantu,
  type MessageChannel,
  type OutreachInput,
  type Poruka,
} from "@sajtoskop/shared";
import { z } from "zod";
import type { JobContext, JobResult } from "./types";
import { rewritePayloadSchema } from "./types";
import { supabaseAdmin } from "../lib/supabase";
import { capMessage, consumeSide, SIDE_KIND } from "../lib/side-budget";

/** Isti model kao vision analiza — ovo je pisanje po šablonu, ne rezonovanje. */
function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5";
}

/** Poruka je najviše 90 reči. 600 tokena je duplo više nego što izlaz može da bude. */
const MAX_TOKENS = 600;
const TIMEOUT_MS = 30_000;

const izlazSchema = z.object({
  subject: z.string().max(120).optional(),
  body: z.string().min(20).max(2000),
});

/**
 * Oblik izlaza za `output_config.format`, isto kao u `ai-audit.ts`.
 *
 * Sa strukturisanim izlazom nema vađenja JSON-a regexom iz slobodnog teksta, pa
 * nema ni cele klase promašaja u kojoj model napiše ispravnu poruku uz uvodnu
 * rečenicu i time obori parsiranje. Zod ostaje kao druga brana.
 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["body"],
  additionalProperties: false,
} as const;

/**
 * Prompt.
 *
 * Model NE dobija sirove signale ni Ugly Score — dobija gotovu poruku i pravila.
 * Time ne može da izmisli problem koji u analizi ne postoji, a to je jedina
 * greška u ovom koraku koja stvarno košta: korisnik na osnovu izmišljene
 * primedbe piše strancu.
 */
function prompt(p: Poruka, kanal: MessageChannel, budzet: number): string {
  const pravila = [
    "Piši na srpskom, latinicom, sa dijakritikom.",
    // Bilo je uopšteno („nikad perfekat u prvom licu") i model ga je prekršio i
    // uz izričitu zabranu — napisao je „Probao sam da pronađem vaš sajt".
    // Nabrojani oblici i njihove zamene su konkretni, pa se ne tumače.
    "Sve glagole o sebi piši u PREZENTU, jer pol pošiljaoca ne znamo.",
    "ZABRANJENO: „probao sam“, „tražio sam“, „video sam“, „našao sam“, „pokušao sam“ i svaki oblik na „-o sam“ ili „-la sam“.",
    "Umesto toga: „probam“, „tražim“, „vidim“, „nalazim“, „pokušavam“, „otvorim“.",
    "Zadrži TAČNO isti konkretan problem iz originalne poruke. Ne dodaj nijednu novu tvrdnju o sajtu.",
    "Ako original pominje ocenu i broj ocena, zadrži tačno te brojeve.",
    "Bez emodžija, bez uzvičnika, bez reči napisanih velikim slovima.",
    "Bez pominjanja alata, analize, skora i „automatski sam proverio“.",
    `Najviše ${budzet} reči.`,
  ];

  // Fiksne rečenice se NE traže od modela — dodaju se posle (v. `sastaviVarijantu`).
  // Zato mu se ovde izričito zabranjuje da ih piše: kad bi ih napisao, u poruci
  // bi stajale dvaput.
  if (kanal === "mejl") {
    pravila.push(
      "NE piši pozdrav na kraju, ne potpisuj se, i ne piši rečenicu o tome odakle ti kontakt niti da mogu da te ignorišu — to se dodaje posle tebe.",
      "Počni sa „Poštovani,“ i novim redom.",
    );
  }
  if (kanal === "viber") {
    pravila.push(
      "Bez ijednog linka i bez adrese sajta — Viber poruka.",
      "NE piši rečenicu da mogu da ignorišu poruku — dodaje se posle tebe.",
    );
  }
  if (kanal === "instagram") {
    pravila.push(
      "Bez ponude usluge. Završi pitanjem koje traži odgovor.",
      "Ovo je prva poruka nepoznatom nalogu — kratko je važnije od potpuno.",
    );
  }

  return [
    "Prepiši ovu hladnu poruku vlasniku male firme u Srbiji tako da zvuči kao da je",
    "piše čovek, a ne šablon. Isti smisao, drugačije rečenice.",
    "",
    "PRAVILA:",
    ...pravila.map((r) => `- ${r}`),
    "",
    "ORIGINALNA PORUKA:",
    p.subject ? `Naslov: ${p.subject}` : null,
    p.body,
    "",
    kanal === "mejl"
      ? 'Vrati isključivo JSON: {"subject": "...", "body": "..."}'
      : 'Vrati isključivo JSON: {"body": "..."}',
  ]
    .filter((r) => r !== null)
    .join("\n");
}

export async function runRewriteMessage(payload: unknown, ctx: JobContext): Promise<JobResult> {
  const { userId, placeId, channel, senderName } = rewritePayloadSchema.parse(payload);
  const db = supabaseAdmin();

  // Otključanje se proverava i ovde, iako ga je ruta već proverila. Posao u redu
  // je zaseban ulaz u sistem i ne sme da veruje da je payload upisao neko ko je
  // proverio prava — red poslova je `jsonb`, ne poziv funkcije.
  const { data: unlock, error: uErr } = await db
    .from("unlocks")
    .select("place_id")
    .eq("user_id", userId)
    .eq("place_id", placeId)
    .maybeSingle<{ place_id: string }>();

  if (uErr) throw new Error(`Provera otključanja nije uspela: ${uErr.message}`);
  if (!unlock) {
    await vratiRezervaciju(db, userId);
    return { note: `${placeId} nije otključan za ${userId} — posao odbijen` };
  }

  const ulaz = await ucitajUlaz(db, placeId, senderName);
  if (!ulaz) {
    await vratiRezervaciju(db, userId);
    return { note: `${placeId} više ne postoji u bazi` };
  }

  const sablon = napisiPoruke(ulaz);
  if (!sablon.ok) {
    await vratiRezervaciju(db, userId);
    return { note: `generator odbio poruku: ${sablon.razlog}` };
  }

  const original = sablon.poruke[channel];

  // ── zašto se pri neuspehu NE upisuje šablon ──────────────
  // Prva verzija je u oba slučaja ispod upisivala šablon kao „AI varijantu".
  // U UI-u je to izgledalo kao da dugme ne radi: korisnik klikne, sačeka, i
  // dobije tekst identičan onom iznad. Tri plaćena poziva ka modelu su tako
  // završila kao tri kopije šablona bez ijednog traga da nešto nije u redu.
  //
  // Sada se pri neuspehu ne upisuje ništa, a posao se uredno završava. Klijent
  // po odsustvu nove poruke kaže šta se desilo. Bolje „model nije dao
  // upotrebljivu verziju" nego tiho servirana ista poruka.
  const budzet = await consumeSide(SIDE_KIND.aiOutreach);
  if (!budzet.ok) {
    ctx.log(capMessage(SIDE_KIND.aiOutreach, budzet));
    await vratiRezervaciju(db, userId);
    return { note: "dnevni cap za ai:outreach — varijanta nije pisana", partial: true };
  }

  const varijanta = await pitajModel(original, channel, senderName, ctx);
  if (!varijanta) {
    await vratiRezervaciju(db, userId);
    return { note: "model nije dao upotrebljiv izlaz — ništa nije upisano", partial: true };
  }

  await upisi(db, userId, placeId, channel, varijanta);
  return { note: `AI varijanta za ${placeId} (${channel}), ${brojReci(varijanta)} reči` };
}

/**
 * Najviše dva poziva: prvi, pa jedan ispravak sa konkretnom greškom.
 *
 * ── zašto ipak retry ──────────────────────────────────────
 * Prva verzija je zvala model jednom, uz obrazloženje da izlaz koji padne na
 * proveri pada zbog nerazumevanja pravila, a ne zbog mreže. To je bilo tačno za
 * emodži i linkove, ali ne i za najčešći stvarni promašaj — dužinu. Model je na
 * mejlu napisao 96 reči uz granicu od 90; to nije nerazumevanje nego brojanje, i
 * to je greška koju model ispravi iz prve kad mu se kaže koliko je premašio.
 *
 * Isti oblik ispravke koji `ai-audit.ts` već koristi: prethodni izlaz kao
 * `assistant` poruka, pa `user` poruka sa tekstom greške.
 */
// Tri, ne dva: dužina i rodni perfekat su dva NEZAVISNA promašaja, pa je mejl
// sa dva pokušaja umeo da potroši oba na različite greške i završi bez rezultata.
// Poziv je tekstualan i bez slika — tri su i dalje jeftinija od jedne analize.
const MAX_POKUSAJA = 3;

async function pitajModel(
  original: Poruka,
  kanal: MessageChannel,
  potpis: string | null,
  ctx: JobContext,
): Promise<string | null> {
  // Model piše samo promenljivi deo, pa mu se i granica saopštava umanjena za
  // fiksni rep koji dodajemo mi. Sa punom granicom bi sastavljena poruka
  // redovno probijala 90 reči i padala na proveri — na naš račun.
  const budzet = GRANICE[kanal].max - repZauzima(kanal);

  const razgovor: Anthropic.MessageParam[] = [
    { role: "user", content: prompt(original, kanal, budzet) },
  ];

  try {
    // [Faza 0, 0.4] `maxRetries: 0` (V5): SDK po podrazumevanoj vrednosti sam
    // ponavlja mrežne greške do 2 puta, a posao kroz red ima sopstvena 3
    // pokušaja sa backoff-om — ukupno do 9 plaćenih poziva za jedan zahtev.
    // Retry već radi red poslova; ovde mu se ne duplira.
    const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });

    for (let pokusaj = 1; pokusaj <= MAX_POKUSAJA; pokusaj++) {
      const res = await client.messages.create({
        model: aiModel(),
        max_tokens: MAX_TOKENS,
        // Sonnet 5 uključuje adaptivno razmišljanje kad se parametar izostavi —
        // isto upozorenje stoji i u `ai-audit.ts`. Bez ovoga je model na mejlu
        // potrošio svih 600 tokena na razmišljanje, vratio `stop_reason:
        // max_tokens` i nijedan tekstualni blok. Prepisivanje jedne poruke po
        // zadatim pravilima nije problem koji traži razmišljanje.
        thinking: { type: "disabled" },
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        messages: razgovor,
      });

      const tekst = res.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();

      const zamerka = (poruka: string): boolean => {
        ctx.log(`pokušaj ${pokusaj}: ${poruka}`);
        if (pokusaj >= MAX_POKUSAJA) return false;
        razgovor.push({ role: "assistant", content: tekst });
        razgovor.push({
          role: "user",
          content: `Odgovor nije prihvaćen: ${poruka}. Ispravi i vrati samo JSON.`,
        });
        return true;
      };

      const json = /\{[\s\S]*\}/.exec(tekst)?.[0];
      if (!json) {
        if (zamerka("nije vraćen JSON")) continue;
        return null;
      }

      let sirovo: unknown;
      try {
        sirovo = JSON.parse(json);
      } catch {
        if (zamerka("JSON se ne parsira")) continue;
        return null;
      }

      const izlaz = izlazSchema.safeParse(sirovo);
      if (!izlaz.success) {
        if (zamerka(izlaz.error.issues[0]?.message ?? "izlaz ne odgovara šemi")) continue;
        return null;
      }

      // Fiksni rep se dodaje ovde, ne traži se od modela — tako pravna rečenica i
      // ona koja skida pritisak glase tačno onako kako moraju, bez obzira na to
      // kako je model raspoložen. Tek sastavljena poruka ide na proveru, istu kroz
      // koju prolazi i šablon.
      const kandidat = sastaviVarijantu(
        kanal,
        izlaz.data.body,
        potpis,
        // `subject` iz modela ako ga je dao, inače naslov šablona.
        { ...original, subject: izlaz.data.subject ?? original.subject },
      );

      const greske = proveriPoruku(kandidat);
      if (greske.length > 0) {
        // Poruka za model računa i fiksni rep, pa mu se kaže koliko SVOG teksta
        // sme — inače skraćuje na 90 i ponovo promaši za širinu repa.
        const savet =
          kandidat.words > GRANICE[kanal].max
            ? `predugačko — tvoj deo sme najviše ${budzet} reči, a poruka sa dodatkom ima ${kandidat.words}`
            : greske.join("; ");
        if (zamerka(savet)) continue;
        return null;
      }

      return kandidat.body;
    }

    return null;
  } catch (err) {
    ctx.log(`Anthropic poziv nije uspeo: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Vrati mesto u dnevnom limitu koje je ruta rezervisala (`claim_ai_rewrite`).
 *
 * Ne baca: posao je već pao iz svog razloga, a neuspeo `release` je greška koja
 * korisnika košta jednu varijantu do LA ponoći — u log, ne u red poslova.
 */
async function vratiRezervaciju(db: ReturnType<typeof supabaseAdmin>, userId: string): Promise<void> {
  const { error } = await db.rpc("release_ai_rewrite", { p_user: userId });
  if (error) console.error(`[rewrite] release_ai_rewrite(${userId}) nije uspeo: ${error.message}`);
}

async function upisi(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  placeId: string,
  channel: MessageChannel,
  body: string,
): Promise<void> {
  // [Faza 2, 2.5] `ignoreDuplicates`: ponovljen posao (žetva posle pada) ne sme
  // da upiše drugi red za istu poruku — jedinstven je po
  // (user_id, place_id, channel, body), migracija 0019.
  const { error } = await db.from("outreach_messages").upsert(
    {
      user_id: userId,
      place_id: placeId,
      channel,
      body,
      source: "ai",
    },
    { onConflict: "user_id,place_id,channel,body", ignoreDuplicates: true },
  );

  if (error) throw new Error(`Upis AI poruke nije uspeo: ${error.message}`);
}

/** Isti ulaz koji generator dobija u webu — jedan oblik, jedan izvor kopija. */
async function ucitajUlaz(
  db: ReturnType<typeof supabaseAdmin>,
  placeId: string,
  senderName: string | null,
): Promise<OutreachInput | null> {
  const { data: b, error: bErr } = await db
    .from("businesses")
    .select("name, city_slug, niche_slug, phone_type, website_url, rating, user_ratings_total")
    .eq("place_id", placeId)
    .maybeSingle<{
      name: string;
      city_slug: string;
      niche_slug: string | null;
      phone_type: OutreachInput["phoneType"];
      website_url: string | null;
      rating: number | null;
      user_ratings_total: number | null;
    }>();

  if (bErr) throw new Error(`Čitanje prospekta nije uspelo: ${bErr.message}`);
  if (!b) return null;

  const { data: a, error: aErr } = await db
    .from("website_audits")
    .select("site_status, signals, ai_issues, ai_solidan")
    .eq("place_id", placeId)
    .maybeSingle<{
      site_status: OutreachInput["siteStatus"];
      signals: OutreachInput["signals"];
      ai_issues: OutreachInput["aiIssues"];
      ai_solidan: boolean | null;
    }>();

  if (aErr) throw new Error(`Čitanje audita nije uspelo: ${aErr.message}`);

  return {
    name: b.name,
    citySlug: b.city_slug,
    nicheSlug: b.niche_slug,
    siteStatus: a?.site_status ?? null,
    websiteUrl: b.website_url,
    signals: a?.signals ?? [],
    aiIssues: a?.ai_issues ?? null,
    aiSolidan: a?.ai_solidan ?? null,
    phoneType: b.phone_type,
    rating: b.rating,
    reviewCount: b.user_ratings_total,
    // Iz payload-a, jer ime živi u Clerku a worker nema sesiju. Bez toga bi AI
    // varijanta stigla bez potpisa, a šablon sa njim — razlika koja izgleda kao kvar.
    senderName,
  };
}
