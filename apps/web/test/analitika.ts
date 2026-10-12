// apps/web/test/analitika.ts
// Pokretanje: pnpm --filter web test  (ili `pnpm test` iz korena)
//
// Šta sme da izađe iz aplikacije ka PostHogu.
//
// Analitika je jedino mesto gde podatak napušta sistem a da ga niko nije
// tražio, pa se ovde proverava ono što se inače vidi tek u tuđoj konzoli:
// adrese bez tajni i spisak događaja bez ijednog polja o prospektu.

import { readFileSync } from "node:fs";
import { ocistiAdresu, ocistiSvojstva } from "../src/lib/analitika-zajednicko";

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};
const isto = (dobijeno: string, ocekivano: string, opis: string) =>
  check(dobijeno === ocekivano, `${opis}${dobijeno === ocekivano ? "" : ` (dobijeno: ${dobijeno})`}`);

console.log("adrese");

isto(
  ocistiAdresu("https://app.sajtoskop.com/welcome?sesija=cs_test_123"),
  "https://app.sajtoskop.com/welcome",
  "ID Stripe sesije se odseca",
);
isto(
  ocistiAdresu("https://app.sajtoskop.com/?__clerk_ticket=abc&nalog=nov#x"),
  "https://app.sajtoskop.com/",
  "Clerk tiket i hash se odsecaju",
);
isto(
  ocistiAdresu("https://app.sajtoskop.com/pozivnica/TAJNI-KOD"),
  "https://app.sajtoskop.com/pozivnica/[kod]",
  "kod pozivnice se maskira (apsolutna adresa)",
);
isto(ocistiAdresu("/pozivnica/TAJNI-KOD?x=1"), "/pozivnica/[kod]", "kod pozivnice se maskira (putanja)");
isto(ocistiAdresu("/pretraga?grad=sabac&nisa=pvc-stolarija"), "/pretraga", "query pretrage se odseca");
isto(ocistiAdresu("/pipeline"), "/pipeline", "čista putanja ostaje ista");
isto(ocistiAdresu("Chrome"), "Chrome", "vrednost koja nije adresa ostaje netaknuta");
isto(ocistiAdresu("$direct"), "$direct", "PostHog oznaka direktne posete ostaje netaknuta");

const svojstva: Record<string, unknown> = {
  $current_url: "https://app.sajtoskop.com/welcome?sesija=cs_live_9",
  $pathname: "/pozivnica/abc",
  $referrer: "https://sajtoskop.com/?utm_source=x",
  $viewport_width: 1280,
};
ocistiSvojstva(svojstva);
check(
  svojstva.$current_url === "https://app.sajtoskop.com/welcome" &&
    svojstva.$pathname === "/pozivnica/[kod]" &&
    svojstva.$referrer === "https://sajtoskop.com/" &&
    svojstva.$viewport_width === 1280,
  "ocistiSvojstva čisti sva tekstualna svojstva i ne dira brojeve",
);

// ── spisak događaja ne nosi ništa o prospektu ───────────────
// Tip `Svojstva` je jedina brana: što u njemu ne piše, ne može da se pošalje.
// Zato se čita baš on, a ne pozivi po rutama.
console.log("\ndogađaji");

const izvor = readFileSync(new URL("../src/lib/analitika-zajednicko.ts", import.meta.url), "utf8");
const tip = izvor.slice(izvor.indexOf("export type Svojstva"), izvor.indexOf("export type Dogadjaj"));
check(tip.length > 0, "tip Svojstva postoji");

for (const polje of ["place", "phone", "email", "website", "name", "url", "ugly", "screenshot"]) {
  check(!new RegExp(`\\b\\w*${polje}\\w*\\??:`, "i").test(tip), `nijedno svojstvo ne sadrži „${polje}"`);
}

// ── klijent: ništa na disku, ništa sa tuđeg domena ──────────
console.log("\nklijent");

const klijent = readFileSync(new URL("../src/lib/analitika.ts", import.meta.url), "utf8");
for (const [obrazac, opis] of [
  [/persistence: "memory"/, "persistence je memory (bez kolačića i localStorage-a)"],
  [/autocapture: false/, "autocapture je ugašen"],
  [/disable_session_recording: true/, "snimci sesija su ugašeni"],
  [/disable_external_dependency_loading: true/, "spoljne skripte su ugašene"],
  [/api_host: PROXY/, "događaji idu na /ingest, ne direktno PostHogu"],
] as const) {
  check(obrazac.test(klijent), opis);
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
