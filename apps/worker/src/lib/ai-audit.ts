// apps/worker/src/lib/ai-audit.ts
// Claude vision analiza otključanog leada — korak 3 posla `enrich_full` (F6 §2).
//
// ‼️ PROMPT ŽIVI OVDE I NIGDE VIŠE.
// Ovaj fajl je u `apps/worker`. Web ga ne uvozi, ne sme da ga uvozi, i provera iz
// F6 §5 je doslovno to: `grep -r "Ti si iskusan srpski" apps/web/.next/static/`
// mora da bude prazno. Prompt je deo proizvoda, ne deo isporuke klijentu.
//
// ── troškovni model, ukratko ───────────────────────────────
// Ovo je jedini poziv u celom sistemu koji troši Anthropic kredite. Zato:
//   - poziv se dešava ISKLJUČIVO na unlock, nikad u bulk scanu (pravilo 5)
//   - `consumeSide` se zove pre svakog zahteva, sa dnevnim capom (F6 §3)
//   - slike se smanjuju pre slanja — cena vision poziva raste sa rezolucijom
//   - `thinking` je ugašen: ovo je opis slike po šablonu, ne problem koji
//     traži razmišljanje, a adaptivno razmišljanje je na Sonnetu 5
//     UKLJUČENO kad se parametar izostavi
//   - `max_tokens` je 1300 (bilo 1000) — `evidence` po stavci dodaje ~100 tokena
//
// ── šta je promenjeno u odnosu na prethodnu verziju ────────
// 1. `evidence` po stavci. Ovo je jedino polje koje ide u generator outreach
//    poruke. `detail` je za UI i objašnjava problem; `evidence` je rečenica koju
//    vlasnik može da proveri na svom telefonu za deset sekundi. Bez tog polja
//    outreach model prevodi tehnički opis sam, i tu izmišlja.
// 2. `solidan` zastavica. Stara šema je tražila minimum 3 stavke UVEK, pa je
//    model na urednom sajtu morao da izmisli tri problema — a pravilo iznad kaže
//    da ne sme. Dve odredbe su bile u direktnoj kontradikciji i model je birao
//    koju će prekršiti. Sad kad je `solidan: true`, dozvoljeno je 0 stavki.
//    Prag za `solidan: false` je posle merenja spušten sa 3 na 1: ista
//    kontradikcija se inače samo pomerila na ružan sajt sa dva vidljiva
//    problema, koji je dobijao `solidan: true` da bi lista stala.
// 3. Provera curenja imena firme. Pravilo „ne pominji ime firme" je do sad bilo
//    samo molba u promptu. Sad se proverava i, ako procuri, ide retry.
//
// Node-only, isključivo u workeru (pravilo 7).

import Anthropic from "@anthropic-ai/sdk";
import { bandForScore, CITIES, NICHES } from "@sajtoskop/shared";
import type { AiIssue, Signal } from "@sajtoskop/shared";
import sharp from "sharp";
import { z } from "zod";
import { capMessage, consumeSide, SIDE_KIND } from "./side-budget";

// ── podešavanja ────────────────────────────────────────────

/**
 * Sonnet, ne Opus. Cena po pozivu je ovde ceo argument (PRD §2) — opis
 * screenshota po zadatom šablonu ne traži najjači model.
 *
 * Env postoji zbog `scripts/probe-ai.ts`: pre integracije se na tri stvarna
 * screenshota poredi kvalitet i cena. Produkcija ostaje na podrazumevanoj vrednosti.
 *
 * Funkcija, a ne konstanta: `loadRootEnv()` se u `index.ts` poziva TEK posle
 * svih importa, pa bi `const` pročitao prazan `process.env` i env override ne bi
 * radio nikad. Isti razlog važi za `dailyCapFor` i `PSI_API_KEY`.
 */
export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5";
}

/**
 * PRD §2 kaže „konzervativno, oko 1000". Podignuto na 1300 jer `evidence` dodaje
 * jednu kratku rečenicu po stavci. Presečen odgovor je skuplji od 300 tokena:
 * plaća se ceo poziv, pa još jedan retry, pa lead ostane bez analize.
 */
const MAX_TOKENS = 1300;

/**
 * Najduža strana slike posle smanjenja.
 *
 * PRD §2 kaže „npr. širina 1024". Ograničava se najduža strana, a ne širina:
 * mobilni screenshot je 780×1688 (390 CSS × device scale 2), pa bi ograničenje
 * po širini ostavilo sliku od 1688px visine i utrostručilo broj vision tokena.
 * Za detekciju „ovo izgleda kao 2011" je i ovo više nego dovoljno.
 */
const MAX_EDGE = 1024;

const WEBP_QUALITY = 78;

/** Rok za jedan poziv. SDK podrazumevano čeka 10 minuta, što je ovde besmisleno. */
const TIMEOUT_MS = 60_000;

// ── cena ───────────────────────────────────────────────────

/**
 * USD po milion tokena. Služi SAMO za procenu u logu i u probnoj skripti —
 * jedini merodavan broj je onaj u Anthropic konzoli.
 *
 * Napomena: uvodna cena za Sonnet 5 ($2/$10) važi do 31.08.2026, posle toga je
 * $3/$15. Ovde stoji puna cena da procena ne bude optimistična.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Koliko poziva je otišlo ka Anthropicu, uključujući retry. */
  attempts: number;
  /** Procena, po punoj ceni modela. */
  costUsd: number;
};

export function estimateCostUsd(model: string, input: number, output: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (input * p.input + output * p.output) / 1_000_000;
}

// ── oblik odgovora ─────────────────────────────────────────

/**
 * Šema koju model DOBIJA (structured outputs) — Anthropic garantuje da je izlaz
 * validan JSON po njoj, pa „model je vratio markdown ogradu" prestaje da postoji
 * kao klasa greške.
 *
 * [ODSTUPANJE od PRD-a §2] PRD traži samo Zod parsiranje sa jednim retryjem na
 * neispravan JSON. Structured outputs to rešava na izvoru, ali se Zod ZADRŽAVA
 * ispod: broj stavki i odnos prema `solidan` su semantička pravila koja JSON
 * šema ne ume da izrazi (`minItems`/`maxItems` nisu podržani). Retry time ostaje,
 * samo sad hvata pravu grešku umesto formatiranja.
 *
 * Redosled po ozbiljnosti se NE proverava — sortira se u kodu (`sortIssues`).
 * Retry zbog redosleda je plaćen poziv za nešto što je jedan `sort`.
 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    solidan: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "string" },
          severity: { type: "string", enum: ["visoka", "srednja", "niska"] },
        },
        required: ["title", "detail", "evidence", "severity"],
        additionalProperties: false,
      },
    },
    verdict: { type: "string" },
  },
  required: ["solidan", "issues", "verdict"],
  additionalProperties: false,
} as const;

/**
 * Šema po kojoj se odgovor PROVERAVA. Ovde su pravila koja JSON šema ne nosi.
 *
 * Gornje granice dužine su široke namerno: one hvataju odgovor koji je otišao u
 * pogrešnom smeru (esej umesto naslova), a ne odgovor koji je za dve reči duži
 * nego što bih ja napisao. Uska granica bi značila retry, pa `ai_issues = null`,
 * i lead bez analize zbog stilske sitnice.
 *
 * `evidence` ima UŽU granicu od 160 znakova, i to je namerno: to polje ide
 * direktno u poruku koja se šalje strancu. Pasus tamo ne sme da prođe.
 */
const answerSchema = z
  .object({
    solidan: z.boolean(),
    issues: z
      .array(
        z.object({
          title: z.string().min(1).max(120),
          detail: z.string().min(1).max(600),
          evidence: z.string().min(1).max(160),
          severity: z.enum(["visoka", "srednja", "niska"]),
        }),
      )
      .max(5),
    verdict: z.string().min(1).max(600),
  })
  .superRefine((v, ctx) => {
    // Prag je 1, ne 3. Sa 3 je model na sajtu koji ima samo jedan ili dva
    // VIDLJIVA problema imao dva legalna izlaza: izmisliti treći (zabranjeno
    // pravilom iznad) ili proglasiti sajt urednim. Biralo se drugo, pa je ružan
    // sajt sa dva problema dobijao `solidan: true` i ispadao iz outreacha —
    // izmereno na stvarnom leadu sa Ugly Score 46.
    if (!v.solidan && v.issues.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issues"],
        message: "sajt nije označen kao solidan, a nema nijednu stavku",
      });
    }
    if (v.solidan && v.issues.some((i) => i.severity === "visoka")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["solidan"],
        message: "sajt je označen kao solidan, a ima stavku ozbiljnosti visoka",
      });
    }
  });

type Answer = z.infer<typeof answerSchema>;

const SEVERITY_RANK: Record<Answer["issues"][number]["severity"], number> = {
  visoka: 0,
  srednja: 1,
  niska: 2,
};

/** Najozbiljnija prva. Stabilno — unutar iste ozbiljnosti ostaje redosled modela. */
function sortIssues(issues: Answer["issues"]): Answer["issues"] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * Konačna vrednost `solidan`, posle ukrštanja sa Ugly Score-om.
 *
 * ── zašto ovo nije u promptu ───────────────────────────────
 * Model gleda dva screenshota i ocenjuje ono što VIDI. To je čist zadatak i
 * takav treba da ostane. Ugly Score zna i ono što se ne vidi — nedostatak opisa
 * za Google, sliku za deljenje, favikonu — i to je posao koji se naplaćuje iako
 * na slici izgleda uredno.
 *
 * Izmereno na stvarnom leadu: sajt sa Ugly Score 46 (band „ružan") model je
 * ocenio kao uredan, i bio je u pravu o onome što vidi. Ali `ai_solidan = true`
 * znači da mu F7 ne piše poruku, a taj sajt jeste posao. Zato zastavica koja
 * odlučuje o outreachu uzima obe ocene, a prompt ostaje neizmenjen.
 *
 * Prag je granica benda, ne broj: `bandForScore` je jedini izvor pragova
 * (pravilo 6). Sve od „osrednji" naviše (skor 20+) obara vizuelnu ocenu.
 */
function effectiveSolidan(
  modelSolidan: boolean,
  uglyScore: number | null,
  brojStavki: number,
): boolean {
  if (!modelSolidan) return false;

  // Model nije našao nijedan vidljiv problem. Obaranje zastavice bi napravilo
  // lead bez ijednog dokaza — F7 bi imao „piši mu" i ništa da napiše.
  if (brojStavki === 0) return true;

  // Nema heuristike (audit bez skora) — veruj očima, drugog izvora nema.
  if (uglyScore === null) return true;

  return bandForScore(uglyScore) === "solidan";
}

// ── prompt ─────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "Ti si iskusan srpski web developer koji ocenjuje sajtove malih firmi za potrebe",
  "hladnog kontakta. Tvoja ocena se koristi u poruci koja se šalje vlasniku firme,",
  "pa svaka tvrdnja mora da izdrži to da je vlasnik proveri na svom telefonu",
  "u roku od deset sekundi. Odgovaraš isključivo JSON-om, bez uvoda i bez",
  "markdown ograda.",
].join(" ");

const RULES = [
  "Pravila:",
  "",
  "# Šta smeš da tvrdiš",
  "- Isključivo ono što se VIDI na priloženim slikama ili stoji u tehničkim signalima.",
  "- Ne pretpostavljaj šta se dešava van vidljivog dela strane, na drugim stranama sajta,",
  "  ni šta se dešava kad se nešto klikne. Video si dva screenshota, ništa više.",
  "- Ne izvodi poslovne zaključke: nema 'gubite klijente', 'loše rangirate na Googlu',",
  "  'konkurencija je ispred vas'. To ne znaš i ne vidi se na slici.",
  "- Ako sajt izgleda uredno i savremeno, postavi solidan: true i vrati 0 do 2 stavke",
  "  male ozbiljnosti. NE izmišljaj probleme da bi popunio listu.",
  "",
  "# solidan",
  "- true kad sajt radi, prilagođen je telefonu, izgleda kao da je pravljen u poslednjih",
  "  nekoliko godina i nema nijedan problem visoke ozbiljnosti.",
  "- false u svim ostalim slučajevima; tada mora bar 1 stavka, najviše 5.",
  "- Broj stavki NE sme da utiče na ovu zastavicu. Ako si našao samo jedan pravi",
  "  problem, a sajt zbog njega ne radi kako treba, to je solidan: false sa jednom",
  "  stavkom — ne izmišljaj još dve i ne proglašavaj sajt urednim da bi lista stala.",
  "",
  "# issues",
  '- "title": naziv problema, do 6 reči, bez tačke na kraju.',
  '- "detail": dve rečenice, šta je problem i gde se vidi. Ovo čita korisnik alata,',
  "  ovde smeš da budeš precizan.",
  '- "severity": visoka kad sajt ne obavlja svoju osnovnu funkciju (ne otvara se,',
  "  nečitljiv je na telefonu, browser javlja upozorenje). srednja kad smeta ali se",
  "  posao završi. niska za kozmetiku.",
  "- Poređaj po ozbiljnosti, najozbiljnija prva.",
  "",
  "# evidence — najvažnije polje",
  "- Jedna rečenica, najviše 15 reči, u prvom licu, onako kako bi je rekao čovek koji je",
  "  upravo otvorio sajt na svom telefonu.",
  "- Mora da bude proverljiva: vlasnik otvori sajt i vidi tačno to.",
  "- Bez tehničkog žargona, bez naziva tagova, bez brojeva iz alata, bez procenata.",
  "- Opisuj SAMO ono što vlasnik vidi otvarajući svoj sajt. Nikad šta bi se desilo",
  "  negde drugde: bez 'kad zamislim', 'kad bih podelio', 'kad me neko nađe na Guglu'.",
  "- Signal koji se ne vidi u pregledaču — opis za Google, slika za deljenje na",
  "  društvenim mrežama, ikonica u kartici — sme da uđe u detail postojeće stavke,",
  "  ali ne sme da bude sopstvena stavka. Ako problem ne umeš da opišeš rečenicom",
  "  koju vlasnik proveri gledajući svoj sajt, ne pravi stavku od njega.",
  '- Dobro: "Meni pada preko teksta kad se otvori na telefonu."',
  '- Dobro: "U dnu strane piše da je sajt iz 2013."',
  '- Loše: "Nedostaje viewport meta tag."',
  '- Loše: "Sajt nije optimizovan za mobilne uređaje."',
  '- Loše: "Kad podelim link na Fejsbuku, ne pojavljuje se slika." (ne vidi se na sajtu)',
  "",
  "# verdict",
  "- Jedna do dve rečenice. Ovo čita vlasnik pekare, ne developer.",
  "- Bez žargona i bez ocenjivanja čoveka. Konstatuj stanje, ne presuđuj.",
  "",
  "# Jezik",
  "- Srpski, latinica, sa dijakritikom (č, ć, š, ž, đ).",
  "- Ne pominji ime firme ni u jednom polju. Piši 'sajt', ne naziv.",
  "- Bez uzvičnika i bez emodžija.",
].join("\n");

/**
 * Tehnički kontekst uz slike.
 *
 * `Signal.points` se namerno NE šalje. Nije reč o bezbednosti — Anthropic nije
 * pregledač — nego o tome da težine Ugly Score-a nemaju šta da rade van
 * `ugly-score.ts` (pravilo 6), a i svaki token se plaća.
 */
function contextBlock(input: AuditInput): string {
  const signals = input.signals.map((s) => `- ${s.label}`).join("\n") || "- (nijedan)";

  return [
    "Tehnički signali (ulazni podaci — u evidence ih PREVEDI na ljudski jezik,",
    "ne prepisuj ih doslovno):",
    signals,
    "",
    `Platforma: ${input.platform ?? "nepoznata"}`,
    `Ugly Score: ${input.uglyScore ?? "nije izračunat"}`,
    input.psiMobileScore === null || input.psiMobileScore === undefined
      ? "PageSpeed (mobilni): nije izmeren"
      : `PageSpeed (mobilni): ${input.psiMobileScore}/100`,
    "",
    "Vrati JSON sa poljima solidan, issues i verdict.",
    "",
    RULES,
  ].join("\n");
}

// ── curenje imena firme ────────────────────────────────────

/**
 * Pravilo „ne pominji ime firme" je do sad bilo samo molba. Sad se proverava.
 *
 * Provera ima dva sloja, i drugi postoji zbog toga što prvi sam nije dovoljan:
 *
 *  1. Pun naziv kao neprekinut niz. Hvata „Stomatologija Dr Perić" doslovno.
 *  2. Prepoznatljiv token iz naziva. Hvata „Dr Peric" kad je pun naziv
 *     „Stomatologija Dr Perić d.o.o." — model retko prepiše ceo naziv sa
 *     pravnom formom, nego skrati na ono po čemu se firma zna.
 *
 * Drugi sloj bi sam obarao svaki odgovor za firmu „Optika Vid" koji sadrži reč
 * „optika". Zato token mora da bude PREPOZNATLJIV: ne sme da bude reč koja se
 * pojavljuje u nazivu neke niše ili grada iz taksonomije, i mora da ima bar 4
 * znaka. „optika" je naziv niše i otpada; „peric" nije i ostaje.
 *
 * Cena lažnog pozitiva je jedan retry (~$0.02), a u najgorem slučaju lead bez
 * AI analize. Cena lažnog negativa je naziv firme u poruci koja se šalje toj
 * istoj firmi. Zato je prag namerno na strani opreza.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(d\.?o\.?o\.?|s\.?r\.?|p\.?r\.?|ad|doo)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Reči koje se ne računaju kao prepoznatljiv deo naziva.
 *
 * Izvor je taksonomija, ne ručna lista: svaka reč iz naziva niše ili grada je
 * reč koju model legitimno koristi u opisu sajta. Kad se doda nova niša, ova
 * lista se proširi sama — ručno održavan spisak bi zaostao prvog dana.
 *
 * Računa se jednom, lenjo, jer `NICHES` ima preko sto stavki.
 */
let genericneReci: Set<string> | null = null;

function genericne(): Set<string> {
  if (genericneReci) return genericneReci;

  const skup = new Set<string>();
  const dodaj = (s: string) => {
    for (const rec of normalize(s).split(" ")) {
      if (rec.length >= 3) skup.add(rec);
    }
  };

  for (const n of NICHES) {
    dodaj(n.label);
    dodaj(n.query);
    dodaj(n.slug.replace(/-/g, " "));
  }
  for (const g of CITIES) {
    dodaj(g.label);
    for (const deo of g.subareas ?? []) dodaj(deo);
  }

  // Reči koje nisu ni niša ni grad, a stoje u pola naziva domaćih firmi.
  for (const r of ["firma", "sajt", "shop", "market", "company", "group", "team", "plus"]) {
    skup.add(r);
  }

  genericneReci = skup;
  return skup;
}

function leaksBusinessName(answer: Answer, businessName?: string): boolean {
  if (!businessName) return false;
  const needle = normalize(businessName);
  if (needle.length < 4) return false; // prekratko da bi provera bila pouzdana

  const haystack = normalize(
    [answer.verdict, ...answer.issues.flatMap((i) => [i.title, i.detail, i.evidence])].join(" "),
  );

  // Sloj 1: pun naziv.
  if (haystack.includes(needle)) return true;

  // Sloj 2: prepoznatljiv token. Granice reči su obavezne — bez njih bi naziv
  // „Park" pucao na „parking ispred ulaza".
  const reci = new Set(haystack.split(" ").filter(Boolean));
  for (const token of needle.split(" ")) {
    if (token.length < 4) continue;
    if (genericne().has(token)) continue;
    if (reci.has(token)) return true;
  }

  return false;
}

// ── slike ──────────────────────────────────────────────────

type Shot = { variant: "desktop" | "mobile"; webp: Buffer };

/** Smanji na `MAX_EDGE` po najdužoj strani i vrati base64 spreman za API. */
async function toImageBlock(webp: Buffer): Promise<{ data: string; bytes: number }> {
  const resized = await sharp(webp)
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  return { data: resized.toString("base64"), bytes: resized.length };
}

// ── klijent ────────────────────────────────────────────────

let cached: Anthropic | null = null;

function client(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Nedostaje ANTHROPIC_API_KEY.\n" +
        "Popuni ga u .env (koren repoa) i PRE toga postavi spend limit u Anthropic konzoli — " +
        "ovo je jedini poziv u sistemu koji troši stvaran novac po zahtevu.",
    );
  }

  cached = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  return cached;
}

// ── javni API ──────────────────────────────────────────────

export type AuditInput = {
  shots: Shot[];
  signals: Signal[];
  platform: string | null;
  uglyScore: number | null;
  psiMobileScore?: number | null;
  /**
   * Naziv firme. NE šalje se modelu — služi samo za proveru da ime nije procurilo
   * u odgovor. Ako se izostavi, provera se preskače.
   */
  businessName?: string;
};

export type AiOutcome =
  | {
      status: "ok";
      issues: AiIssue[];
      verdict: string;
      /**
       * Sajt je uredan i lead ne ide u outreach. Ovo je KONAČNA ocena: vizuelna
       * ocena modela ukrštena sa Ugly Score-om (v. `effectiveSolidan`).
       */
      solidan: boolean;
      /**
       * Šta je model rekao gledajući samo slike, pre ukrštanja sa skorom.
       * Kad se razlikuje od `solidan`, heuristika je oborila vizuelnu ocenu —
       * bez ovog polja bi to izgledalo kao da model protivreči sam sebi.
       */
      solidanModel: boolean;
      usage: AiUsage;
    }
  /** Dnevni cap dostignut. Lead ostaje na `audit_level = 2` (PRD §3). */
  | { status: "capped"; note: string }
  /** Model je pukao ili dvaput vratio odgovor koji ne prolazi proveru. */
  | { status: "failed"; note: string; usage: AiUsage };

function short(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? err.name;
  return String(err);
}

/** Spoji sve `text` blokove odgovora. Uz structured outputs to je čist JSON. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Analiziraj otključan lead i vrati 0–5 problema na srpskom plus jednu rečenicu
 * koju vlasnik firme razume.
 *
 * Ne baca na greške modela — vraća `failed`, a `enrich_full` nastavlja dalje.
 * Baca samo ako nema API ključa ili ako budžet nije dostupan.
 */
export async function analyzeScreenshots(input: AuditInput): Promise<AiOutcome> {
  if (input.shots.length === 0) {
    return {
      status: "failed",
      note: "nema nijednog screenshota za analizu",
      usage: { inputTokens: 0, outputTokens: 0, attempts: 0, costUsd: 0 },
    };
  }

  const budget = await consumeSide(SIDE_KIND.ai);
  if (!budget.ok) {
    return { status: "capped", note: capMessage(SIDE_KIND.ai, budget) };
  }

  // Redosled je bitan i za model: prvo desktop, pa mobilni, kao u promptu.
  const rank = (v: Shot["variant"]) => (v === "desktop" ? 0 : 1);
  const ordered = [...input.shots].sort((a, b) => rank(a.variant) - rank(b.variant));

  const content: Anthropic.ContentBlockParam[] = [];
  for (const shot of ordered) {
    const { data } = await toImageBlock(shot.webp);
    content.push({
      type: "text",
      text: shot.variant === "desktop" ? "Desktop prikaz:" : "Prikaz na telefonu:",
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/webp", data },
    });
  }
  content.push({ type: "text", text: contextBlock(input) });

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];

  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let lastProblem = "nepoznat razlog";

  // Jedan pokušaj plus jedan retry (PRD §2). Retry je nastavak razgovora, ne nov
  // zahtev: model vidi šta je vratio i šta nije valjalo.
  for (let i = 0; i < 2; i++) {
    attempts++;

    let message: Anthropic.Message;
    try {
      message = await client().messages.create({
        model: aiModel(),
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        // Sonnet 5 uključuje adaptivno razmišljanje kad se parametar izostavi.
        // Ovde ono ne donosi ništa osim tokena — zadatak je opis slike po šablonu.
        thinking: { type: "disabled" },
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        messages,
      });
    } catch (err) {
      lastProblem = short(err);
      break; // mrežna ili API greška — retry na istu grešku nema smisla
    }

    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;

    if (message.stop_reason === "refusal") {
      lastProblem = "model je odbio zahtev";
      break;
    }

    const raw = textOf(message);
    const parsed = answerSchema.safeParse(safeJson(raw));

    if (parsed.success && leaksBusinessName(parsed.data, input.businessName)) {
      lastProblem = "odgovor sadrži naziv firme";
    } else if (parsed.success) {
      return {
        status: "ok",
        issues: sortIssues(parsed.data.issues),
        verdict: parsed.data.verdict,
        solidan: effectiveSolidan(
          parsed.data.solidan,
          input.uglyScore,
          parsed.data.issues.length,
        ),
        solidanModel: parsed.data.solidan,
        usage: {
          inputTokens,
          outputTokens,
          attempts,
          costUsd: estimateCostUsd(aiModel(), inputTokens, outputTokens),
        },
      };
    } else {
      lastProblem =
        message.stop_reason === "max_tokens"
          ? `odgovor presečen na ${MAX_TOKENS} tokena`
          : parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    }

    if (i === 0) {
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content:
          "Odgovor nije prošao proveru: " +
          lastProblem +
          ". Vrati samo validan JSON. Ako je solidan false, mora bar jedna stavka. " +
          "Ne pominji naziv firme ni u jednom polju.",
      });
    }
  }

  return {
    status: "failed",
    note: lastProblem,
    usage: {
      inputTokens,
      outputTokens,
      attempts,
      costUsd: estimateCostUsd(aiModel(), inputTokens, outputTokens),
    },
  };
}

/** `JSON.parse` koji vraća `null` umesto da baca — Zod posle toga kaže šta fali. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── most ka generatoru poruka ──────────────────────────────

/**
 * Izvuci `dokazi` za outreach prompt. SAMO `evidence`, nikad `detail` ni `title`.
 *
 * Ovo je jedina tačka na kojoj audit dodiruje generisanje poruke. Ako ikad
 * poželiš da ovde ubaciš `detail` „jer je detaljniji" — nemoj. `detail` je pisan
 * za korisnika alata i sadrži žargon koji u poruci vlasniku firme zvuči kao
 * kopirani izveštaj.
 *
 * Vraća prazan niz kad je sajt solidan, i to je poenta: `dokazi.length === 0`
 * je signal generatoru poruke da ovom leadu ne treba pisati.
 */
export function auditToDokazi(outcome: AiOutcome, limit = 5): string[] {
  if (outcome.status !== "ok" || outcome.solidan) return [];
  return outcome.issues
    .map((i) => (i as AiIssue & { evidence?: string }).evidence)
    .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
    .slice(0, limit);
}

// ── izloženo isključivo za testove ─────────────────────────
/**
 * `apps/worker/test/ai-audit.ts` proverava ove tri stvari direktno, bez ijednog
 * API poziva. Nijedan produkcioni fajl ovo ne uvozi — provereno grepom, i to je
 * jedini razlog zašto su unutrašnjosti uopšte izložene.
 *
 * Ime sa dve donje crte je namerno ružno: da se vidi da nije javni API modula.
 */
export const __test = {
  answerSchema,
  sortIssues,
  leaksBusinessName,
  normalize,
  effectiveSolidan,
};