// apps/web/test/unlock.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S30, C5, §7.4–§7.5] `unlockLead` posle S30: odgovor nosi posao analize, a
// „Pokušaj ponovo" ume da naruči nov `enrich_full`.
//
// Šta je ovde STVARNO, a šta lažno (isti obrazac kao `clerk-webhook.ts`):
//   · STVARNO: odluka kad se posao upisuje, kad se čita živ posao, kad se
//     upisuje korak trake, i šta ide u odgovor.
//   · LAŽNO: skladište (`UnlockSkladiste`) — nijedan poziv ne ide u bazu. Trka
//     nad kreditima ostaje na `pnpm check:f4`, nad pravom bazom.
//   · STATIČKI: ruta prosleđuje `ponovi` i `enrichJobId`, šema skida `userId`.
//
// Regresija koje se najviše plašim: posle `done` kartica zove istu rutu bez
// `ponovi`. Kad bi to naručivalo analizu, posao koji završi bez traga bi se
// upisivao u krug — svaki put drugi Playwright i drugi Claude poziv.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { RpcResult, SpendReason } from "@sajtoskop/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../src");
const stubs = pathToFileURL(path.resolve(here, "../../../scripts/lib/next-stubs.ts")).href;

registerHooks({
  resolve(specifier, context, next) {
    if (["server-only", "next/navigation", "@clerk/nextjs/server"].includes(specifier)) {
      return { url: stubs, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(path.join(webSrc, specifier.slice(2))).href, context);
    }
    return next(specifier, context);
  },
});

const { unlockLead } = await import("../src/lib/unlock");
type UnlockSkladiste = import("../src/lib/unlock").UnlockSkladiste;
type UnlockedLead = import("../src/lib/search-types").UnlockedLead;
const { unlockBodySchema } = await import("../src/lib/unlock-schema");

let fail = 0;
const check = (ok: boolean, line: string): void => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

const KORISNIK = "user_test_1";
const MESTO = "ChIJ_test_1";

const LEAD_BEZ_ANALIZE: UnlockedLead = {
  placeId: MESTO,
  name: "PVC Mont",
  citySlug: "sabac",
  nicheSlug: "pvc-stolarija",
  address: null,
  hasWebsite: true,
  phoneType: "mobilni",
  rating: 4.6,
  siteStatus: "ok",
  uglyBand: "ruzan",
  platform: null,
  ratingCount: 38,
  hasEmail: false,
  nicheLabel: "PVC stolarija",
  issueCount: 2,
  isUnlocked: true,
  phone: "064 312 8890",
  websiteUrl: "https://pvcmont.rs",
  email: null,
  uglyScore: 61,
  signals: ["Nije prilagođen telefonu"],
  psiMobileScore: null,
  psiLcpMs: null,
  aiIssues: null,
  aiVerdict: null,
  aiSolidan: null,
  screenshot: null,
};

type Belezka = {
  enqueue: number;
  zivPosao: number;
  lead: number;
  korak: number;
};

function lazno(
  opcije: {
    reason?: SpendReason;
    ok?: boolean;
    lead?: UnlockedLead;
    enqueue?: number | Error;
    ziv?: number | null | Error;
    krediti?: number;
    koraci?: Record<string, string> | null;
  } = {},
): { skladiste: UnlockSkladiste; b: Belezka } {
  const b: Belezka = { enqueue: 0, zivPosao: 0, lead: 0, korak: 0 };
  const skladiste: UnlockSkladiste = {
    async spend(userId, placeId) {
      check(userId === KORISNIK && placeId === MESTO, "spend dobija korisnika iz argumenta, ne iz tela");
      return { ok: opcije.ok ?? true, reason: opcije.reason ?? "unlocked" } as RpcResult<SpendReason>;
    },
    async enqueue() {
      b.enqueue++;
      if (opcije.enqueue instanceof Error) throw opcije.enqueue;
      return opcije.enqueue ?? 77;
    },
    async zivPosao() {
      b.zivPosao++;
      if (opcije.ziv instanceof Error) throw opcije.ziv;
      return opcije.ziv === undefined ? null : opcije.ziv;
    },
    async lead() {
      b.lead++;
      return opcije.lead ?? LEAD_BEZ_ANALIZE;
    },
    async krediti() {
      return opcije.krediti ?? 1;
    },
    async oznaciKorak() {
      b.korak++;
      return opcije.koraci === undefined ? { pretraga: "t", otkljucavanje: "t" } : opcije.koraci;
    },
  };
  return { skladiste, b };
}

// ── novo otključavanje ─────────────────────────────────────
console.log("novo otključavanje");
{
  const { skladiste, b } = lazno({ krediti: 1 });
  const o = await unlockLead(KORISNIK, MESTO, { koraci: { pretraga: "t" } }, skladiste);
  check(o.ok === true, "ok");
  if (o.ok) {
    check(o.enrichJobId === 77, "enrichJobId je ID upravo upisanog posla");
    check(o.creditsLeft === 1, "creditsLeft iz skladišta (zbir kasa)");
    check(o.onboardingSteps?.otkljucavanje === "t", "prvo otključavanje upisuje korak trake");
  }
  check(b.enqueue === 1 && b.zivPosao === 0, "upisan tačno jedan posao, živ posao se ne traži");
  check(b.korak === 1, "korak upisan jednom");
}
{
  const { skladiste, b } = lazno();
  const o = await unlockLead(KORISNIK, MESTO, { koraci: { pretraga: "t", otkljucavanje: "t" } }, skladiste);
  check(o.ok && o.onboardingSteps === undefined && b.korak === 0, "korak koji profil već ima se ne upisuje (nula poziva)");
}
{
  const { skladiste, b } = lazno({ enqueue: new Error("baza pala") });
  const o = await unlockLead(KORISNIK, MESTO, {}, skladiste);
  check(o.ok === true, "pad upisa posla NE obara otključavanje (kredit je već skinut)");
  check(o.ok && o.enrichJobId === null, "…a enrichJobId je null, pa kartica crta grešku sa ponovnim pokušajem");
  check(b.enqueue === 1, "pokušan je tačno jedan upis");
}
{
  const { skladiste, b } = lazno({ koraci: null });
  const o = await unlockLead(KORISNIK, MESTO, {}, skladiste);
  check(o.ok && o.onboardingSteps === undefined && b.korak === 1, "pao upis koraka → odgovor bez koraka, bez greške");
}

// ── već otključan ──────────────────────────────────────────
console.log("\nveć otključan (osvežavanje posle done, §7.4)");
{
  const { skladiste, b } = lazno({ reason: "already_unlocked", ziv: 55 });
  const o = await unlockLead(KORISNIK, MESTO, {}, skladiste);
  check(o.ok && o.reason === "already_unlocked", "already_unlocked");
  check(b.enqueue === 0, "BEZ `ponovi` nema novog posla — ni kad analiza fali");
  check(b.zivPosao === 1 && o.ok && o.enrichJobId === 55, "vraća živ posao ovog korisnika");
  check(b.korak === 0, "ponovljeno otključavanje ne upisuje korak");
}
{
  const { skladiste } = lazno({ reason: "already_unlocked", ziv: new Error("pad") });
  const o = await unlockLead(KORISNIK, MESTO, {}, skladiste);
  check(o.ok && o.enrichJobId === null, "pad čitanja živog posla → null, ne 500");
}

console.log("\n„Pokušaj ponovo“ (§7.5)");
{
  const { skladiste, b } = lazno({ reason: "already_unlocked", enqueue: 88 });
  const o = await unlockLead(KORISNIK, MESTO, { ponovi: true }, skladiste);
  check(b.enqueue === 1 && o.ok && o.enrichJobId === 88, "ponovi + nema AI analize → nov enrich_full");
}
{
  const { skladiste, b } = lazno({
    reason: "already_unlocked",
    lead: { ...LEAD_BEZ_ANALIZE, screenshot: { desktop: "u", mobile: null } },
  });
  await unlockLead(KORISNIK, MESTO, { ponovi: true }, skladiste);
  check(b.enqueue === 1, "ponovi + snimak postoji, AI ne → nov enrich_full");
}
{
  const { skladiste, b } = lazno({
    reason: "already_unlocked",
    lead: { ...LEAD_BEZ_ANALIZE, aiIssues: [] },
  });
  await unlockLead(KORISNIK, MESTO, { ponovi: true }, skladiste);
  check(b.enqueue === 0 && b.zivPosao === 1, "ponovi + AI prošao → bez novog posla");
}
{
  const { skladiste, b } = lazno({
    reason: "already_unlocked",
    lead: { ...LEAD_BEZ_ANALIZE, siteStatus: "mrtav", uglyScore: null },
  });
  await unlockLead(KORISNIK, MESTO, { ponovi: true }, skladiste);
  check(b.enqueue === 0, "ponovi + mrtav domen → bez novog posla (worker ga ni ne slika)");
}
{
  const { skladiste, b } = lazno({
    reason: "already_unlocked",
    lead: { ...LEAD_BEZ_ANALIZE, hasWebsite: false, websiteUrl: null, siteStatus: "nema_sajt" },
  });
  await unlockLead(KORISNIK, MESTO, { ponovi: true }, skladiste);
  check(b.enqueue === 0, "ponovi + nema sajt → bez novog posla");
}

console.log("\nneuspeh");
{
  const { skladiste, b } = lazno({ ok: false, reason: "insufficient_credits" });
  const o = await unlockLead(KORISNIK, MESTO, { ponovi: true }, skladiste);
  check(!o.ok && o.reason === "insufficient_credits", "nema kredita → ok: false sa razlogom");
  check(b.lead === 0 && b.enqueue === 0 && b.korak === 0, "…i ništa posle: ni čitanje, ni posao, ni korak");
}

// ── statički: ruta i šema ─────────────────────────────────
console.log("\nruta i šema");
{
  const telo = unlockBodySchema.safeParse({ placeId: MESTO, ponovi: true, userId: "user_tudji" });
  check(telo.success && telo.data.ponovi === true, "šema prima `ponovi`");
  check(telo.success && !("userId" in telo.data), "`userId` iz tela nestaje na granici (pravilo 8)");
  check(!unlockBodySchema.safeParse({ placeId: MESTO, ponovi: "da" }).success, "`ponovi` mora biti boolean");

  const ruta = readFileSync(path.join(webSrc, "app/api/unlock/route.ts"), "utf8");
  check(/enrichJobId:\s*outcome\.enrichJobId/.test(ruta), "ruta vraća enrichJobId");
  check(/ponovi:\s*parsed\.data\.ponovi/.test(ruta), "ruta prosleđuje `ponovi` iz ISPARSIRANOG tela");
  check(ruta.includes('greska("Nemaš dovoljno kredita.", 402)'), "402 tekst bez bete (C4)");
  check(!/beta/i.test(ruta.replace(/\/\/.*$/gm, "")), "nigde „beta“ van komentara");

  const lib = readFileSync(path.join(webSrc, "lib/unlock.ts"), "utf8");
  const citanje = lib.slice(lib.indexOf("async function readBalance"));
  check(citanje.includes("credits_topup"), "creditsLeft je zbir obe kase (S21)");
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
