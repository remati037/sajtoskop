// packages/shared/test/onboarding.ts
// Pokretanje: pnpm --filter @sajtoskop/shared test  (ili `pnpm test` iz korena)
//
// [S30] TS strana kataloga koraka (tok-i-onboarding §4.5, O6). SQL stranu —
// `onboarding_mark_step` sa četiri ključa, `done_at`, nepoznat korak baca —
// pokriva `pnpm check:sql`. Ovde je ono što SQL ne vidi:
//
//   1. da se ključevi u `KORACI` i u migraciji 0026 slažu slovo po slovo, i da
//      se kanali slažu sa ograničenjem iz 0028 (čita se sam SQL fajl, ne kopija);
//   2. da je tekst tačaka, trake i vodiča DOSLOVNO iz §4.5–§4.8;
//   3. dve odluke: ko ide u čarobnjak i kad traka stoji.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HINT_KLJUCEVI,
  jeHintKljuc,
  jeKorakKljuc,
  KORAK_KLJUCEVI,
  KORACI,
  ONBOARDING_KANALI,
  sviKoraciUradjeni,
  TACKA_JASNO,
  TACKE,
  TRAKA,
  TRAKA_SKRIVENA,
  trakaVidljiva,
  trebaCarobnjak,
  uradjeniKoraci,
  VODIC,
} from "../src/index";

let fail = 0;
function check(ok: boolean, line: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
}

const koren = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migracija = (ime: string) =>
  readFileSync(path.join(koren, "supabase/migrations", ime), "utf8");

// ── 1. katalog naspram SQL-a ───────────────────────────────
console.log("katalog koraka naspram migracija");

{
  const sql = migracija("0026_onboarding.sql");
  const pogodak = sql.match(/p_step not in \(([^)]+)\)/);
  const izSql = (pogodak?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/'/g, ""))
    .filter(Boolean);

  check(izSql.length === 4, `0026 nabraja četiri koraka (${izSql.join(", ")})`);
  check(
    JSON.stringify([...izSql].sort()) === JSON.stringify([...KORAK_KLJUCEVI].sort()),
    "ključevi u KORACI su tačno oni koje onboarding_mark_step prima",
  );
  // `done_at` nastaje kad su SVA četiri tu — SQL ih nabraja drugi put.
  for (const k of KORAK_KLJUCEVI) {
    check(sql.includes(`v_steps ? '${k}'`), `0026 traži '${k}' za onboarding_done_at`);
  }
}

{
  const sql = migracija("0028_pocetak.sql");
  const pogodak = sql.match(/onboarding_channel in \(([^)]+)\)/);
  const izSql = (pogodak?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, ""));
  check(
    JSON.stringify([...izSql].sort()) === JSON.stringify([...ONBOARDING_KANALI].sort()),
    `kanali čarobnjaka = ograničenje iz 0028 (${izSql.join(", ")})`,
  );
  check(!izSql.includes("poziv"), "poziv nije kanal čarobnjaka (C9: nema šablon)");
}

// ── 2. tekst doslovno ──────────────────────────────────────
console.log("\ntekst doslovno iz §4.5–§4.8");

check(KORACI.length === 4, "četiri koraka");
check(
  KORACI.map((k) => k.naslov).join(" | ") ===
    "Prva lista | Prvi prospekt | Prva poruka | Prvi u pipeline-u",
  "naslovi koraka (§4.5)",
);
check(
  JSON.stringify(HINT_KLJUCEVI) === JSON.stringify(["nema-sajt", "otkljucaj", "poruka", "pipeline"]),
  "ključevi tačaka, redom (§4.3 komentar u migraciji)",
);
check(new Set(HINT_KLJUCEVI).size === 4, "tačke su jedinstvene");
check(!(HINT_KLJUCEVI as readonly string[]).includes(TRAKA_SKRIVENA), "oznaka sakrivene trake nije tačka");

check(TACKE["nema-sajt"].naslov === "Ovo je najbolji prospekt.", "tačka 1, naslov");
check(
  TACKE["nema-sajt"].telo ===
    "Firma ima ocene na Googlu, a nema sajt — ne moraš da ubeđuješ da je sajt loš, samo da ga nema.",
  "tačka 1, telo",
);
check(
  TACKE.otkljucaj.naslov === "Otključavanje otvara telefon, mejl, snimke sajta i gotovu poruku." &&
    TACKE.otkljucaj.telo === "Košta 1 kredit; prvi je besplatan. Isti prospekt se ne plaća dvaput.",
  "tačka 2",
);
check(
  TACKE.poruka.naslov === "Poruka je napisana za kanal koji si izabrao." &&
    TACKE.poruka.telo ===
      "Promeni tab za mejl ili Instagram; „Napiši drugačije“ pravi novu verziju bez kredita.",
  "tačka 3",
);
check(
  TACKE.pipeline.naslov === "Označi kad pošalješ." &&
    TACKE.pipeline.telo ===
      "Pipeline pamti koga si kontaktirao, ko je odgovorio i ko je potpisao — i posle 30 dana znaš gde si stao.",
  "tačka 4",
);
check(TACKA_JASNO === "Jasno", "dugme tačke");

check(TRAKA.naslov === "Prvih pet minuta", "naslov trake (§4.6)");
check(TRAKA.gotovo === "Sva četiri. Sad znaš sve što treba.", "poruka posle četvrtog koraka (§4.6)");
check(TRAKA.sakrij === "Sakrij", "dugme trake");
check(
  TRAKA.uputstvo.poruka === "Kopiraj poruku sa otključane kartice" &&
    TRAKA.uputstvo.pipeline === "Označi prospekt kao kontaktiran",
  "uputstva neurađenih koraka (§4.6)",
);
check(
  TRAKA.uputstvo.pretraga === null && TRAKA.uputstvo.otkljucavanje === null,
  "za prva dva koraka §4.6 nema uputstvo — i ono se ne izmišlja",
);
check(
  VODIC.pokaziMi === "Pokaži mi" && VODIC.ponovi === "Ponovi prve korake",
  "vodič na zahtev (§4.8)",
);

// ── 3. odluke ──────────────────────────────────────────────
console.log("\nko ide u čarobnjak (§1.8)");

const TS = "2026-09-13T10:00:00.000Z";
const nov = { pun: true, doneAt: null, skippedAt: null, steps: {} };

check(trebaCarobnjak(nov) === true, "nov nalog sa pristupom → čarobnjak");
check(trebaCarobnjak({ ...nov, pun: false }) === false, "grace (nije pun) → ne, čarobnjak se završava plaćanjem");
check(trebaCarobnjak({ ...nov, skippedAt: TS }) === false, "preskočen → ne");
check(trebaCarobnjak({ ...nov, doneAt: TS }) === false, "završen → ne");
check(
  trebaCarobnjak({ ...nov, steps: { pretraga: TS } }) === false,
  "prva lista plaćena → ne (bez ovoga kapija vraća čoveka sa /pretraga u čarobnjak)",
);
check(
  trebaCarobnjak({ ...nov, steps: { poruka: TS } }) === true,
  "neki drugi korak bez liste → i dalje čarobnjak",
);
check(trebaCarobnjak({ ...nov, steps: null }) === true, "steps null se čita kao prazno");

console.log("\ntraka napretka (§4.6)");

check(trakaVidljiva({ doneAt: null, hintsSeen: [] }) === true, "u toku → traka stoji");
check(trakaVidljiva({ doneAt: TS, hintsSeen: [] }) === false, "završeno → nema trake");
check(
  trakaVidljiva({ doneAt: null, hintsSeen: [TRAKA_SKRIVENA] }) === false,
  "„Sakrij“ → nema trake",
);
check(
  trakaVidljiva({ doneAt: null, hintsSeen: ["nema-sajt", "otkljucaj"] }) === true,
  "viđene tačke ne sakrivaju traku",
);

console.log("\npomoćne funkcije");

check(
  JSON.stringify(uradjeniKoraci({ pipeline: TS, pretraga: TS, izmisljen: TS })) ===
    JSON.stringify(["pretraga", "pipeline"]),
  "uradjeniKoraci: redom iz KORACI, nepoznat ključ ignorisan",
);
check(sviKoraciUradjeni({ pretraga: TS, otkljucavanje: TS, poruka: TS, pipeline: TS }), "sva četiri");
check(!sviKoraciUradjeni({ pretraga: TS, otkljucavanje: TS, poruka: TS }), "tri nisu sva četiri");
check(jeKorakKljuc("poruka") && !jeKorakKljuc("nema-sajt"), "jeKorakKljuc");
check(jeHintKljuc("nema-sajt") && !jeHintKljuc(TRAKA_SKRIVENA), "jeHintKljuc");

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
