// apps/worker/test/ai-audit.ts
// Pokretanje: pnpm --filter worker test  (ili `pnpm test` iz korena)
//
// NIJEDAN POZIV NE IZLAZI NA MREŽU. `globalThis.fetch` se zamenjuje stubom koji
// hvata i Anthropic i Supabase saobraćaj i vraća unapred pripremljene odgovore.
// Zato ovaj fajl sme u CI: ne troši ni Anthropic kredite ni dnevni cap.
//
// Izuzetak od „testovi samo za ugly-score i spend_credit_and_unlock"
// (00-kontekst §7), iz istog razloga kao `robots.ts`: ovde greška ne pravi
// pogrešan podatak nego plaćen poziv koji vrati smeće, pa još jedan plaćen
// retry, pa lead bez analize. Semantičke provere (`solidan` vs broj stavki,
// curenje naziva firme) su jedino što stoji između modela i baze.

import { analyzeScreenshots, auditToDokazi, __test } from "../src/lib/ai-audit";
import type { AiOutcome } from "../src/lib/ai-audit";

const { answerSchema, sortIssues, leaksBusinessName } = __test;

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ── pomoćni gradioci ───────────────────────────────────────

type Sev = "visoka" | "srednja" | "niska";

const stavka = (severity: Sev, title = "Problem", evidence = "Vidim to na telefonu.") => ({
  title,
  detail: "Dve rečenice objašnjenja. Vidi se na priloženom snimku.",
  evidence,
  severity,
});

const odgovor = (solidan: boolean, issues: ReturnType<typeof stavka>[], verdict = "Sajt radi.") => ({
  solidan,
  issues,
  verdict,
});

const n = (broj: number, severity: Sev = "srednja") =>
  Array.from({ length: broj }, (_, i) => stavka(severity, `Problem ${i + 1}`));

// ═══════════════════════════════════════════════════════════
// 1. answerSchema
// ═══════════════════════════════════════════════════════════

console.log("answerSchema");

// Prag je 1, ne 3 — v. superRefine. Ružan sajt sa dva vidljiva problema mora da
// ostane `solidan: false`, inače ispada iz outreacha.
check(
  !answerSchema.safeParse(odgovor(false, [])).success,
  "solidan false sa 0 stavki → puca (superRefine)",
);
check(answerSchema.safeParse(odgovor(false, n(1))).success, "solidan false sa 1 stavkom → prolazi");
check(answerSchema.safeParse(odgovor(false, n(2))).success, "solidan false sa 2 stavke → prolazi");
check(answerSchema.safeParse(odgovor(false, n(3))).success, "solidan false sa 3 stavke → prolazi");
check(answerSchema.safeParse(odgovor(false, n(5))).success, "solidan false sa 5 stavki → prolazi");
check(answerSchema.safeParse(odgovor(true, [])).success, "solidan true sa 0 stavki → prolazi");

check(
  !answerSchema.safeParse(odgovor(true, [stavka("visoka")])).success,
  "solidan true sa stavkom 'visoka' → puca",
);
check(
  answerSchema.safeParse(odgovor(true, [stavka("niska"), stavka("srednja")])).success,
  "solidan true sa niska/srednja → prolazi (kontrola prethodnog)",
);

check(!answerSchema.safeParse(odgovor(false, n(6))).success, "6 stavki → puca na max(5)");

check(
  !answerSchema.safeParse(odgovor(false, [stavka("visoka", "P", "x".repeat(200)), ...n(2)])).success,
  "evidence od 200 znakova → puca na max(160)",
);
check(
  answerSchema.safeParse(odgovor(false, [stavka("visoka", "P", "x".repeat(160)), ...n(2)])).success,
  "evidence od tačno 160 znakova → prolazi (granica je inkluzivna)",
);

// ═══════════════════════════════════════════════════════════
// 2. sortIssues
// ═══════════════════════════════════════════════════════════

console.log("\nsortIssues");

const poredjano = sortIssues([stavka("niska"), stavka("visoka"), stavka("srednja")]);
check(
  poredjano.map((i) => i.severity).join(",") === "visoka,srednja,niska",
  `[niska, visoka, srednja] → [${poredjano.map((i) => i.severity).join(", ")}]`,
);

// Stabilnost je bitna jer model već vraća stavke poređane po svom osećaju
// ozbiljnosti unutar iste kategorije — taj redosled nema ko drugi da zna.
const stabilno = sortIssues([
  stavka("srednja", "prvi"),
  stavka("visoka", "vrh"),
  stavka("srednja", "drugi"),
]);
check(
  stabilno.map((i) => i.title).join(",") === "vrh,prvi,drugi",
  `ista ozbiljnost zadržava ulazni redosled → [${stabilno.map((i) => i.title).join(", ")}]`,
);

// ═══════════════════════════════════════════════════════════
// 3. leaksBusinessName
// ═══════════════════════════════════════════════════════════

console.log("\nleaksBusinessName");

const saVerdiktom = (verdict: string) => odgovor(false, n(3), verdict);
const saTekstom = (evidence: string) =>
  odgovor(false, [stavka("visoka", "P", evidence), ...n(2)]);

check(
  leaksBusinessName(saVerdiktom("Stomatologija Dr Perić nema mobilnu verziju."), "Stomatologija Dr Perić"),
  '"Stomatologija Dr Perić" u verdictu → true',
);

check(
  !leaksBusinessName(saTekstom("Slika optika se ne učitava."), "Optika Vid"),
  'naziv "Optika Vid", tekst sadrži samo "optika" → false',
);

check(!leaksBusinessName(saVerdiktom("Sajt je zapušten."), undefined), "businessName izostavljen → false");

check(
  leaksBusinessName(
    saVerdiktom("Sajt firme Stomatologija Dr Peric se ne otvara."),
    "Stomatologija Dr Perić d.o.o.",
  ),
  'naziv sa "d.o.o." i bez dijakritike u tekstu → true (skida se pravna forma)',
);

check(
  leaksBusinessName(saTekstom("Dr Peric nije naveden u zaglavlju."), "Stomatologija Dr Perić d.o.o."),
  'delimičan naziv "Dr Peric" → true (prepoznatljiv token)',
);

// ── lažni pozitivi koje drugi sloj sme da napravi ─────────
// Ovo su testovi koji čuvaju cenu: svaki lažni pozitiv je jedan plaćen retry,
// a u najgorem slučaju lead bez analize.

check(
  !leaksBusinessName(saTekstom("Parking ispred ulaza nije označen."), "Restoran Park"),
  '"Restoran Park" vs "parking" → false (granica reči, ne prefiks)',
);

check(
  !leaksBusinessName(saTekstom("Auto delovi se ne vide na slici."), "Auto David"),
  '"Auto David" vs reč "auto" → false ("auto" je reč iz taksonomije)',
);

check(
  leaksBusinessName(saTekstom("David je potpisao stranicu u dnu."), "Auto David"),
  '"Auto David" vs reč "David" → true (prepoznatljiv token)',
);

check(
  !leaksBusinessName(saTekstom("Sajt frizerskog salona u Šapcu."), "Frizerski salon Šabac"),
  "naziv sastavljen samo od niše i grada → false (nema prepoznatljiv token)",
);

check(
  !leaksBusinessName(saTekstom("Meni je nečitljiv."), "Vid"),
  "naziv kraći od 4 znaka → false",
);

// ═══════════════════════════════════════════════════════════
// 4. auditToDokazi
// ═══════════════════════════════════════════════════════════

console.log("\nauditToDokazi");

const usage = { inputTokens: 100, outputTokens: 50, attempts: 1, costUsd: 0.001 };

const ok = (solidan: boolean, issues: ReturnType<typeof stavka>[]): AiOutcome => ({
  status: "ok",
  issues,
  verdict: "Sajt radi.",
  solidan,
  usage,
});

check(auditToDokazi(ok(true, [stavka("niska")])).length === 0, 'status "ok" i solidan true → prazan niz');

check(
  auditToDokazi({ status: "failed", note: "pukao", usage }).length === 0,
  'status "failed" → prazan niz',
);

check(
  auditToDokazi(ok(false, n(3))).length === 3,
  "solidan false sa 3 stavke → tri dokaza",
);

// Stari zapis iz baze: `ai_issues` je jsonb, pa red upisan pre uvođenja
// `evidence` to polje nema — tip tvrdi suprotno.
const stariZapis = [
  stavka("visoka", "Nov", "Meni pada preko teksta."),
  { title: "Star", detail: "Bez evidence polja.", severity: "srednja" as Sev },
  stavka("niska", "Nov2", "   "),
] as ReturnType<typeof stavka>[];

let dokazi: string[] = [];
let bacio = false;
try {
  dokazi = auditToDokazi(ok(false, stariZapis));
} catch {
  bacio = true;
}
check(!bacio, "stavka bez evidence polja → ne baca");
check(
  dokazi.length === 1 && dokazi[0] === "Meni pada preko teksta.",
  `stavka bez evidence i prazna evidence su preskočene (ostalo ${dokazi.length})`,
);

// ═══════════════════════════════════════════════════════════
// 5. Retry i budžet — stub nad `fetch`, bez mreže
// ═══════════════════════════════════════════════════════════

console.log("\nanalyzeScreenshots (stub nad fetch)");

// Klijenti se prave lenjo i keširaju se, pa env mora da stoji pre prvog poziva.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-nije-pravi";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const pravifetch = globalThis.fetch;

type Poziv = { url: string; body: unknown };

type Stub = {
  /** Odgovori modela, redom. Objekat = telo koje model „vraća". */
  odgovori: (Record<string, unknown> | { __refusal: true })[];
  /** Da li budžet pušta poziv. */
  budzetOk: boolean;
};

let anthropicPozivi: Poziv[] = [];
let supabasePozivi = 0;

// ‼️ Stub se instalira JEDNOM, a menja se samo ono što vraća.
//
// Anthropic SDK zapamti referencu na `fetch` u trenutku kad se klijent napravi,
// a klijent se u `ai-audit.ts` kešira u modulu — dakle nastaje pri prvom pozivu
// i živi do kraja procesa. Zamena `globalThis.fetch` posle toga ne stiže do
// njega: SDK i dalje zove prvu funkciju. (Supabase klijent se ponaša drugačije
// i čita `globalThis.fetch` svaki put, što je zavaravalo — polovina testova je
// izgledala ispravno.) Zato jedna stabilna funkcija koja gleda u promenljivu.
let stub: Stub = { odgovori: [], budzetOk: true };
let idx = 0;

function postaviStub(novi: Stub): void {
  stub = novi;
  idx = 0;
  anthropicPozivi = [];
  supabasePozivi = 0;
}

function instalirajStub(): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(
      typeof input === "string" ? input : (input as { url?: string })?.url ?? input,
    );
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    // ── Supabase RPC (consume_side_call) ──
    if (url.includes("supabase.co")) {
      supabasePozivi++;
      return new Response(
        JSON.stringify([
          {
            ok: stub.budzetOk,
            reason: stub.budzetOk ? "consumed" : "daily_cap",
            pt_day: "2026-08-10",
            kind_calls: stub.budzetOk ? 1 : 60,
            retry_after: stub.budzetOk ? null : "2026-08-11T07:00:00Z",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // ── Anthropic Messages API ──
    anthropicPozivi.push({ url, body });
    const sledeci = stub.odgovori[Math.min(idx, stub.odgovori.length - 1)];
    idx++;

    const odbijanje = sledeci && "__refusal" in sledeci;

    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: odbijanje ? [] : [{ type: "text", text: JSON.stringify(sledeci) }],
        stop_reason: odbijanje ? "refusal" : "end_turn",
        stop_details: odbijanje ? { type: "refusal", category: "cyber" } : null,
        usage: { input_tokens: 1500, output_tokens: 300 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

instalirajStub();

// Pravi, mali webp — `toImageBlock` zove sharp, pa mu treba stvarna slika.
const sharp = (await import("sharp")).default;
const slika = await sharp({
  create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 200, b: 200 } },
})
  .webp()
  .toBuffer();

const ulaz = (businessName?: string) => ({
  shots: [{ variant: "desktop" as const, webp: slika }],
  signals: [],
  platform: null,
  uglyScore: 60,
  businessName,
});

// ── 5a. neispravan pa ispravan odgovor ────────────────────

postaviStub({ odgovori: [odgovor(false, []), odgovor(false, n(3))], budzetOk: true });
let r = await analyzeScreenshots(ulaz());

check(r.status === "ok", `prvi neispravan pa ispravan → status "${r.status}"`);
check(r.status === "ok" && r.usage.attempts === 2, "attempts === 2");
check(anthropicPozivi.length === 2, `dva poziva ka modelu (${anthropicPozivi.length})`);

const drugiMessages = (anthropicPozivi[1]?.body as { messages: { role: string; content: unknown }[] })
  ?.messages;
check(
  drugiMessages?.length === 3 &&
    drugiMessages[0]?.role === "user" &&
    drugiMessages[1]?.role === "assistant" &&
    drugiMessages[2]?.role === "user",
  `drugi poziv nosi user → assistant → user (${drugiMessages?.map((m) => m.role).join(" → ")})`,
);
check(
  typeof drugiMessages?.[2]?.content === "string" &&
    (drugiMessages[2].content as string).includes("nije prošao proveru"),
  "poslednja user poruka sadrži tekst greške",
);

// ── 5b. oba pokušaja neispravna ───────────────────────────

postaviStub({ odgovori: [odgovor(false, []), odgovor(false, [])], budzetOk: true });
r = await analyzeScreenshots(ulaz());

check(r.status === "failed", `oba neispravna → status "${r.status}"`);
check(r.status === "failed" && r.usage.attempts === 2, "attempts === 2");
check(
  r.status === "failed" && r.usage.costUsd > 0,
  `neuspeli pokušaji su naplaćeni (costUsd ${r.status === "failed" ? r.usage.costUsd : 0})`,
);

// ── 5c. procurio naziv firme → mora retry ─────────────────

postaviStub({
  odgovori: [
    odgovor(false, n(3), "Sajt firme Auto David se ne otvara na telefonu."),
    odgovor(false, n(3), "Sajt se ne otvara na telefonu."),
  ],
  budzetOk: true,
});
r = await analyzeScreenshots(ulaz("Auto David"));

check(anthropicPozivi.length === 2, `procurio naziv → ide u retry (${anthropicPozivi.length} poziva)`);
check(r.status === "ok" && r.usage.attempts === 2, "posle retryja status ok, attempts === 2");

// Kontrola: bez `businessName` isti odgovor prolazi iz prvog pokušaja.
postaviStub({
  odgovori: [odgovor(false, n(3), "Sajt firme Auto David se ne otvara na telefonu.")],
  budzetOk: true,
});
r = await analyzeScreenshots(ulaz());
check(
  r.status === "ok" && r.usage.attempts === 1,
  "bez businessName provera se preskače (attempts === 1)",
);

// ── 5d. refusal → bez retryja ─────────────────────────────

postaviStub({ odgovori: [{ __refusal: true }], budzetOk: true });
r = await analyzeScreenshots(ulaz());

check(r.status === "failed", `refusal → status "${r.status}"`);
check(r.status === "failed" && r.usage.attempts === 1, "refusal prekida bez retryja (attempts === 1)");
check(anthropicPozivi.length === 1, `samo jedan poziv (${anthropicPozivi.length})`);

// ── 5e. budžet odbija ─────────────────────────────────────

postaviStub({ odgovori: [odgovor(false, n(3))], budzetOk: false });
r = await analyzeScreenshots(ulaz());

check(r.status === "capped", `budžet odbija → status "${r.status}"`);
check(anthropicPozivi.length === 0, `nijedan poziv ka modelu (${anthropicPozivi.length})`);
check(supabasePozivi === 1, `budžet je ipak pitan (${supabasePozivi} poziv)`);

// ── 5f. consumeSide ide PRE pripreme slika ────────────────
// Dokaz je ponašanje, ne redosled linija: slika je namerno neispravna, pa bi
// `sharp` bacio da se priprema dešava prva. Ako se vrati uredan `capped`,
// budžet je pitan pre nego što je slika dotaknuta.

postaviStub({ odgovori: [odgovor(false, n(3))], budzetOk: false });
let bacioNaSlici = false;
try {
  r = await analyzeScreenshots({
    ...ulaz(),
    shots: [{ variant: "desktop", webp: Buffer.from("ovo nije slika") }],
  });
} catch {
  bacioNaSlici = true;
}
check(!bacioNaSlici && r.status === "capped", "consumeSide se zove PRE pripreme slika");

// Kontrola da je slika stvarno neispravna: uz propušten budžet mora da pukne.
postaviStub({ odgovori: [odgovor(false, n(3))], budzetOk: true });
let pukloNaLosojSlici = false;
try {
  await analyzeScreenshots({
    ...ulaz(),
    shots: [{ variant: "desktop", webp: Buffer.from("ovo nije slika") }],
  });
} catch {
  pukloNaLosojSlici = true;
}
check(pukloNaLosojSlici, "kontrola: neispravna slika stvarno puca kad budžet propusti");

globalThis.fetch = pravifetch;

console.log(fail === 0 ? "\nSve proslo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
