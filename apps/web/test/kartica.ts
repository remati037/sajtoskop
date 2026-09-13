// apps/web/test/kartica.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// [S30] Kartica prospekta (tok-i-onboarding §7, D12). Tri stvari:
//
//   1. PRAVILO 9 NAD JSON-om, ne nad tipom. `toPublicLead` za zaključan prospekt
//      se serijalizuje i proverava se skup KLJUČEVA: `{"phone": null}` bi prošao
//      TypeScript, a i dalje je polje u odgovoru.
//   2. STANJE IZ PODATAKA — pet stanja iz §7 izvode se iz leada i onoga što je
//      kartica saznala o poslu, nijedno se ne postavlja spolja.
//   3. Sitne odluke (podrazumevan tab, ponovni pokušaj, „Kontaktiran") i tekst
//      iz §7.8 slovo po slovo. Plus statička provera da tabela više ne postoji.

import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

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

const { toPublicLead } = await import("../src/lib/public-lead");
type LeadBusiness = import("../src/lib/public-lead").LeadBusiness;
type LeadAudit = import("../src/lib/public-lead").LeadAudit;
const K = await import("../src/lib/kartica");
const { kartica, telefonSaKanalom, formatOcena } = await import("../src/lib/ui-tekst");
type UnlockedLead = import("../src/lib/search-types").UnlockedLead;

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

// ── fiksture ───────────────────────────────────────────────

const FIRMA: LeadBusiness = {
  place_id: "ChIJ_test_1",
  name: "PVC Mont Šabac",
  city_slug: "sabac",
  niche_slug: "pvc-stolarija",
  address: "Karađorđeva 1",
  phone: "064 312 8890",
  phone_type: "mobilni",
  website_url: "https://www.pvcmont.rs/",
  rating: 4.6,
  user_ratings_total: 38,
};

const AUDIT: LeadAudit = {
  site_status: "ok",
  ugly_band: "ruzan",
  platform: "wordpress",
  ugly_score: 61,
  signals: [
    { key: "no_viewport", points: 20, label: "Nije prilagođen telefonu" },
    { key: "copyright_ancient", points: 10, label: "Poslednja izmena: 2019." },
  ],
  emails: ["pvcmont.sabac@gmail.com"],
  psi_mobile_score: 31,
  psi_lcp_ms: 8200,
  ai_issues: [
    { title: "Sporo", detail: "d", severity: "visoka", evidence: "e" },
    { title: "Mali tekst", detail: "d", severity: "srednja", evidence: "e" },
    { title: "Nema forme", detail: "d", severity: "niska", evidence: "e" },
  ],
  ai_verdict: "Sajt se otvara osam sekundi.",
  ai_solidan: false,
  screenshot_desktop: "shots/d.webp",
  screenshot_mobile: "shots/m.webp",
} as LeadAudit;

const POTPISANO = new Map([
  ["shots/d.webp", "https://signed/d"],
  ["shots/m.webp", "https://signed/m"],
]);

/** Ključevi `LeadBase` + `isUnlocked` — i ništa više, za zaključan prospekt. */
const DOZVOLJENI = new Set([
  "placeId", "name", "citySlug", "nicheSlug", "address", "hasWebsite", "phoneType", "rating",
  "siteStatus", "uglyBand", "platform", "ratingCount", "hasEmail", "nicheLabel", "issueCount",
  "isUnlocked",
]);

// ═══════════════════════════════════════════════════════════
// 1. pravilo 9 nad JSON-om
// ═══════════════════════════════════════════════════════════
console.log("zaključan prospekt: JSON ključevi (pravilo 9)");

for (const [opis, a] of [
  ["pun audit", AUDIT],
  ["bez audita", null],
  ["nema sajt", { ...AUDIT, site_status: "nema_sajt", ugly_score: null, ai_issues: null } as LeadAudit],
] as const) {
  const json = JSON.parse(JSON.stringify(toPublicLead(FIRMA, a, false, POTPISANO))) as Record<string, unknown>;
  const kljucevi = Object.keys(json);

  for (const zabranjen of K.ZAKLJUCANI_KLJUCEVI) {
    check(!(zabranjen in json), `${opis}: nema ključ \`${zabranjen}\``);
  }
  const visak = kljucevi.filter((k) => !DOZVOLJENI.has(k));
  check(visak.length === 0, `${opis}: nijedan ključ van LeadBase (${visak.join(", ") || "—"})`);

  // Vrednosti zaključanih polja ne smeju da procure ni kroz drugo ime.
  const tekst = JSON.stringify(json);
  check(!tekst.includes("064") && !tekst.includes("pvcmont"), `${opis}: ni telefon ni domen nigde u JSON-u`);
  check(!tekst.includes("signed"), `${opis}: nijedan potpisan URL`);
  check(!tekst.includes("Sporo") && !tekst.includes("viewport"), `${opis}: ni tekst analize ni ključ signala`);
}

console.log("\nzaključan prospekt: javna polja (§7.0)");
{
  const l = toPublicLead(FIRMA, AUDIT, false);
  check(l.ratingCount === 38, "ratingCount iz user_ratings_total");
  check(l.hasEmail === true, "hasEmail je boolean, ne adresa");
  check(l.nicheLabel === "PVC stolarija", `nicheLabel iz taksonomije („${l.nicheLabel}“)`);
  check(l.issueCount === 3, "issueCount = broj AI stavki");

  const bezAi = toPublicLead(FIRMA, { ...AUDIT, ai_issues: null } as LeadAudit, false);
  check(bezAi.issueCount === 2, "issueCount pada na broj signala kad AI nije prošao");
  check(toPublicLead(FIRMA, null, false).issueCount === null, "bez audita issueCount je null");
  check(
    toPublicLead(FIRMA, { ...AUDIT, emails: [] } as LeadAudit, false).hasEmail === false,
    "prazan niz mejlova → hasEmail false",
  );
  check(toPublicLead({ ...FIRMA, niche_slug: null }, null, false).nicheLabel === "", "bez niše → prazan string");
}

// ═══════════════════════════════════════════════════════════
// 2. stanje iz podataka (§7.2–§7.6)
// ═══════════════════════════════════════════════════════════
console.log("\nstanje kartice");

const NEMA_POSLA = { id: null, ishod: null } as const;
const RADI = { id: 91, ishod: "radi" } as const;

const otkljucan = (a: LeadAudit | null, b: LeadBusiness = FIRMA) => {
  const l = toPublicLead(b, a, true, POTPISANO);
  if (!l.isUnlocked) throw new Error("fikstura");
  return l;
};
const bezAnalize: LeadAudit = {
  ...AUDIT,
  ai_issues: null,
  ai_verdict: null,
  psi_mobile_score: null,
  psi_lcp_ms: null,
  screenshot_desktop: null,
  screenshot_mobile: null,
} as LeadAudit;

check(K.stanjeKartice(toPublicLead(FIRMA, AUDIT, false), NEMA_POSLA) === "zakljucano", "zaključan → zakljucano");
check(
  K.stanjeKartice(toPublicLead(FIRMA, AUDIT, false), NEMA_POSLA, true) === "u_toku",
  "zaključan dok zahtev ide (optimistično, §7.3 korak 3) → u_toku",
);
check(K.stanjeKartice(otkljucan(bezAnalize), RADI) === "u_toku", "otključan, bez analize, posao radi → u_toku");
check(
  K.stanjeKartice(otkljucan(bezAnalize), { id: 91, ishod: "pao" }) === "greska",
  "posao pao → greska",
);
check(
  K.stanjeKartice(otkljucan(bezAnalize), { id: 91, ishod: "predugo" }) === "greska",
  "60 s bez done → greska",
);
check(
  K.stanjeKartice(otkljucan(bezAnalize), NEMA_POSLA) === "greska",
  "bez analize i bez posla (enqueue pao) → greska",
);
check(K.stanjeKartice(otkljucan(AUDIT), NEMA_POSLA) === "otkljucano", "pun audit → otkljucano");
check(
  K.stanjeKartice(otkljucan({ ...bezAnalize, ai_issues: [] } as LeadAudit), NEMA_POSLA) === "otkljucano",
  "AI prošao sa nula stavki → otkljucano (to je nalaz, ne kvar)",
);
check(
  K.stanjeKartice(otkljucan({ ...bezAnalize, screenshot_mobile: "shots/m.webp" } as LeadAudit), RADI) ===
    "otkljucano",
  "snimak stigao, AI nije → otkljucano (sa „Analiza problema nije prošla“)",
);
check(
  K.stanjeKartice(otkljucan({ ...bezAnalize, site_status: "nema_sajt", ugly_score: null } as LeadAudit, { ...FIRMA, website_url: null }), RADI) === "nema_sajt",
  "nema sajt → nema_sajt i dok posao radi (§7.6)",
);
check(
  K.stanjeKartice(otkljucan({ ...bezAnalize, site_status: "mrtav", ugly_score: null } as LeadAudit), NEMA_POSLA) === "nema_sajt",
  "mrtav domen → nema_sajt varijanta, ne greška",
);
check(
  K.stanjeKartice(toPublicLead({ ...FIRMA, website_url: null }, null, false), NEMA_POSLA) === "zakljucano",
  "zaključan bez sajta je i dalje zakljucano",
);

console.log("\nponovni pokušaj (§7.5)");
check(K.trebaPonovnaAnaliza(otkljucan(bezAnalize)) === true, "sve palo → sme ponovo");
check(
  K.trebaPonovnaAnaliza(otkljucan({ ...bezAnalize, screenshot_mobile: "shots/m.webp" } as LeadAudit)) === true,
  "AI pao, snimak prošao → sme ponovo",
);
check(
  K.trebaPonovnaAnaliza(otkljucan({ ...AUDIT, screenshot_desktop: null, screenshot_mobile: null } as LeadAudit)) === false,
  "snimak pao, AI prošao → ne (red iz §7.5 nema dugme)",
);
check(K.trebaPonovnaAnaliza(otkljucan(AUDIT)) === false, "pun audit → ne");
check(
  K.trebaPonovnaAnaliza(otkljucan({ ...bezAnalize, site_status: "mrtav", ugly_score: null } as LeadAudit)) === false,
  "mrtav domen → ne, worker ga ni ne slika",
);

console.log("\npodrazumevan tab poruke (§7.2)");
const tel = (tip: UnlockedLead["phoneType"], email: string | null) => ({ phoneType: tip, email });
check(K.podrazumevaniTab("viber", tel("mobilni", null), "viber") === "viber", "čarobnjak viber + mobilni → viber");
check(K.podrazumevaniTab("viber", tel("fiksni", null), "poziv") === "poziv", "čarobnjak viber + fiksni → predlog (poziv)");
check(K.podrazumevaniTab("mejl", tel("mobilni", "a@b.rs"), "viber") === "mejl", "čarobnjak mejl + ima mejl → mejl");
check(K.podrazumevaniTab("mejl", tel("mobilni", null), "viber") === "viber", "čarobnjak mejl bez adrese → predlog");
check(K.podrazumevaniTab("instagram", tel(null, null), "mejl") === "instagram", "instagram je uvek primenljiv");
check(K.podrazumevaniTab(null, tel("fiksni", null), "poziv") === "poziv", "bez čarobnjaka → predlog");
check(
  K.predlogIzTelefona("mobilni") === "viber" && K.predlogIzTelefona("besplatni") === "poziv" && K.predlogIzTelefona(null) === "mejl",
  "zaključan: tab iz tipa telefona",
);
check(JSON.stringify(K.TABOVI) === JSON.stringify(["viber", "mejl", "instagram", "poziv"]), "četiri taba, redom sa slike (§7.1)");

console.log("\nsitnice");
check(K.smeKontaktiran(null) && K.smeKontaktiran("nekontaktiran"), "„Kontaktiran“ nudi se nekontaktiranom");
check(!K.smeKontaktiran("potpisan") && !K.smeKontaktiran("odgovorio"), "„Kontaktiran“ ne vraća prospekt unazad");
check(K.skratiMejl("pvcmont.sabac.stolarija@gmail.com").endsWith("@gmail.com") && K.skratiMejl("pvcmont.sabac.stolarija@gmail.com").includes("…"), "mejl se skraćuje u sredini");
check(K.skratiMejl("a@b.rs") === "a@b.rs", "kratak mejl ostaje ceo");
check(K.domenIzUrl("https://www.pvcmont.rs/") === "pvcmont.rs", "domen bez šeme i www");
check(K.mapaUrl("ChIJ x") === "https://www.google.com/maps/place/?q=place_id:ChIJ%20x", "Maps link sa place_id");
check(telefonSaKanalom("mobilni") === "Mobilni · Viber" && telefonSaKanalom("fiksni") === "Fiksni · Poziv", "tip telefona · kanal (§7.2)");
check(telefonSaKanalom("besplatni") === "Besplatni · Poziv" && telefonSaKanalom(null) === null, "besplatni i bez tipa");
check(formatOcena(4.6) === "4,6", "ocena sa zarezom");

console.log("\ntekst iz §7.8");
check(kartica.otkljucaj === "Otključaj za 1 kredit", "otkljucaj");
check(kartica.otkljucajBesplatno === "Otključaj · prvi je besplatan", "otkljucajBesplatno");
check(kartica.otkljucajPlan === "Otključaj · treba plan", "otkljucajPlan");
check(kartica.otkljucajVrati === "Otključaj · vrati pristup", "otkljucajVrati");
check(kartica.analiziram === "Analiziram sajt na telefonu i desktopu… obično 10–40 s", "analiziram");
check(
  kartica.analizaPala ===
    "Analiza nije stigla. Kredit je skinut i prospekt je tvoj — kontakt je gore. Analizu možeš da tražiš ponovo.",
  "analizaPala",
);
check(kartica.kopiranoToast === "Kopirano. Označi kao kontaktiran?", "kopiranoToast");
check(kartica.brojProblema(1) === "1 problem" && kartica.brojProblema(4) === "4 problema" && kartica.brojProblema(5) === "5 problema", "brojProblema");
check(
  kartica.potvrdaTekst(11) ===
    "1 kredit — ostaje ti 11. Dobijaš telefon, mejl, sajt, snimke, listu problema i poruku. Isti prospekt se nikad ne naplaćuje drugi put.",
  "potvrdaTekst",
);
check(kartica.vecOtkljucan("X") === "X je već otključan — kredit nije skinut.", "vecOtkljucan");
check(kartica.aiLimit(5) === "Dnevni limit AI varijanti (5) je potrošen, sutra ponovo.", "aiLimit");
check(kartica.nemaKredita === "Nemaš kredita. Plan počinje sa 7 dana probe i 10 kredita.", "nemaKredita");

// ═══════════════════════════════════════════════════════════
// 3. statički: tabela je otišla, maska nije blur
// ═══════════════════════════════════════════════════════════
console.log("\nstatički");
const src = (f: string) => readFileSync(path.join(webSrc, f), "utf8");

check(!existsSync(path.join(webSrc, "components/lead-tabela.tsx")), "lead-tabela.tsx je obrisan (O5)");
for (const f of ["components/pretraga-ekran.tsx", "components/moja-lista-ekran.tsx"]) {
  check(src(f).includes("<KarticaProspekta"), `${f} crta kartice`);
  check(!src(f).includes("lead-tabela"), `${f} ne uvozi tabelu`);
}
{
  const k = src("components/kartica-prospekta.tsx");
  // Komentari se skidaju: zaglavlje fajla SME da kaže „nigde blur" — kod ne sme da ga ima.
  const kod = k.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(!/blur\(/.test(kod) && !/\bblur-/.test(kod), "kartica nigde ne koristi blur (§7: maska iz null)");
  check(k.includes("lead.isUnlocked"), "maska se crta iz lead.isUnlocked");
  check(/<PrijaviGresku[\s\S]{0,80}greska: tekst/.test(k), "stanje greške montira „Prijavi grešku“ sa porukom (§5.3 D)");
  check(k.includes("sessionStorage") && !k.includes("localStorage"), "„Ne pitaj me više danas“ je u sessionStorage-u");
  check(!/#[0-9a-fA-F]{3,8}\b/.test(k.replace(/\/\/.*$/gm, "")), "nijedan hex u kartici");
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
