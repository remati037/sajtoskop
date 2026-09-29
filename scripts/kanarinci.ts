// scripts/kanarinci.ts
// Kanarinci u bazi (docs/bezbednost.md, Sloj 2; checklista 2.5).
//
//   pnpm kanarinci                   # pregled, ništa se ne upisuje
//   pnpm kanarinci -- --pisi         # upiši nove i osveži postojeće (jednom mesečno)
//   pnpm kanarinci -- --izvestaj     # ko je otključao kog kanarinca
//   pnpm kanarinci -- --fajl=putanja # drugi spisak umesto scripts/kanarinci.local.json
//
// ── šta je kanarinac ───────────────────────────────────────
// Izmišljen biznis sa mojim telefonom i mojim domenom, upisan u `businesses` kao
// da ga je vratio Google. Ako se pojavi u tuđem proizvodu ili nečijem CSV-u,
// `unlocks` kaže koji nalog ga je otključao, a samo otključan prospekt ima
// telefon, sajt i izvoz (pravilo 9).
//
// ── kako oznaka ne curi ────────────────────────────────────
// `businesses` i `website_audits` ne dobijaju nijednu kolonu. Oznaka je u
// tabeli `canaries` (0036) koju ne čita nijedna ruta, pa `search_listing`,
// kartica i CSV kanarinca ne mogu da razlikuju od pravog prospekta. Test
// `apps/web/test/kanarinci.ts` pada ako se `canaries` pojavi u kodu weba.
//
// Isto važi i za sadržaj reda. Audit ne izmišlja ova skripta: upisuje se
// `enrich_basic` posao, a worker proverava moj domen istim putem kao svaki
// drugi sajt, sa istim Ugly Score-om (pravilo 6), robots.txt i razmakom
// (pravilo 12). Kad se prospekt otključa, `enrich_full` pravi snimak i AI
// analizu kao i za pravi.
//
// ── spisak ne ide u git ────────────────────────────────────
// Nazivi, telefoni i domeni su u `scripts/kanarinci.local.json` (u .gitignore).
// Oblik je u `scripts/kanarinci.primer.json`. Repo koji procuri ne sme da
// otkrije koje firme su lažne.
//
// `place_id` je nasumičan i u Googleovom obliku (`ChIJ` + 23 znaka). Nastaje
// samo pri prvom upisu, a posle se čita iz `canaries` po oznaci. Zato oznaka u
// spisku ne sme da se menja: nova oznaka znači novog kanarinca.
//
// ── svežina ────────────────────────────────────────────────
// `search_listing` ne prikazuje red čiji je `google_refreshed_at` stariji od
// 30 dana (pravilo 1). Kanarinca Google nikad ne osvežava jer ga Google ne zna,
// pa `--pisi` pomera taj datum na sada. Pokreće se ručno jednom mesečno;
// podsetnik je u checklisti („Posle lansiranja").
//
// Ne troši nijedan Places poziv i ne dira kredite.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
// Relativno, ne kroz `@sajtoskop/shared`: koren monorepoa nema taj paket među
// zavisnostima (isto obrazloženje kao u `rescore-audits.ts`).
import {
  buildScanQueries,
  CITY_SLUGS,
  NICHE_SLUGS,
  phoneType,
  resolveCity,
  resolveNiche,
} from "../packages/shared/src/index";
import type { Business } from "../packages/shared/src/index";
import { loadRootEnv } from "../apps/worker/src/lib/env";
import { placeIdsNeedingAudit, upsertBusinesses } from "../apps/worker/src/lib/db-writes";
import { workspaceRoot } from "../apps/worker/src/lib/paths";
import { enqueueMany } from "../apps/worker/src/lib/queue";
import { supabaseAdmin } from "../apps/worker/src/lib/supabase";

loadRootEnv();

const pisi = process.argv.includes("--pisi");
const izvestaj = process.argv.includes("--izvestaj");
const fajlArg = process.argv.find((a) => a.startsWith("--fajl="))?.slice("--fajl=".length);

const TTL_DANA = 30;
const COUNTRY = "RS";
const DAN_MS = 86_400_000;

// ── spisak ─────────────────────────────────────────────────

const kanarinacSchema = z.strictObject({
  /** Trajna oznaka. Ne menja se posle prvog upisa (v. zaglavlje). */
  oznaka: z.string().regex(/^[a-z0-9-]{1,40}$/, { error: "Oznaka: mala slova, cifre i crtica." }),
  naziv: z.string().trim().min(2).max(120),
  grad: z.enum(CITY_SLUGS),
  nisa: z.enum(NICHE_SLUGS),
  adresa: z.string().trim().min(3).max(200),
  // Nacionalni oblik, kako ga Google vraća u `nationalPhoneNumber` („060 1234567").
  // `+381 60…` bi bio jedini takav telefon u bazi i odao bi kanarinca.
  telefon: z.string().regex(/^0[0-9 /-]{5,19}$/, { error: "Telefon u obliku „060 1234567“." }),
  sajt: z.url({ protocol: /^https?$/ }),
  ocena: z.number().min(1).max(5).nullable().default(null),
  brojOcena: z.number().int().min(0).nullable().default(null),
});

const spisakSchema = z.strictObject({
  kanarinci: z
    .array(kanarinacSchema)
    .min(1)
    .max(10, { error: "Najviše 10 kanarinaca (docs/bezbednost.md: 5–10)." })
    .refine((k) => new Set(k.map((x) => x.oznaka)).size === k.length, {
      error: "Oznake moraju biti jedinstvene.",
    })
    .refine((k) => new Set(k.map((x) => new URL(x.sajt).hostname)).size === k.length, {
      error: "Svaki kanarinac mora imati svoj domen, inače se trag ne vezuje za jednog.",
    }),
});

type Kanarinac = z.infer<typeof kanarinacSchema>;

function citajSpisak(): Kanarinac[] {
  const fajl = fajlArg
    ? path.resolve(fajlArg)
    : path.join(workspaceRoot(), "scripts", "kanarinci.local.json");

  let sirovo: unknown;
  try {
    sirovo = JSON.parse(readFileSync(fajl, "utf8"));
  } catch (err) {
    throw new Error(
      `Spisak ${fajl} nije pročitan (${err instanceof Error ? err.message : String(err)}).\n` +
        "Napravi ga po uzoru na scripts/kanarinci.primer.json.",
    );
  }

  const r = spisakSchema.safeParse(sirovo);
  if (!r.success) throw new Error(`Spisak ${fajl} nije ispravan:\n${z.prettifyError(r.error)}`);
  return r.data.kanarinci;
}

// ── baza ───────────────────────────────────────────────────

type OznakaRed = { place_id: string; label: string; created_at: string };

async function postojeceOznake(): Promise<OznakaRed[]> {
  const { data, error } = await supabaseAdmin()
    .from("canaries")
    .select("place_id, label, created_at")
    .order("label");
  if (error) throw new Error(`Čitanje canaries nije uspelo: ${error.message}`);
  return (data ?? []) as OznakaRed[];
}

/** Googleov oblik: `ChIJ` + 23 znaka iz base64url abecede. */
function novPlaceId(): string {
  return `ChIJ${randomBytes(18).toString("base64url").slice(0, 23)}`;
}

function kaoBusiness(k: Kanarinac, placeId: string): Business {
  return {
    placeId,
    name: k.naziv,
    address: k.adresa,
    phone: k.telefon,
    phoneKind: phoneType(k.telefon),
    website: k.sajt,
    // Google daje jednu decimalu; `numeric(2,1)` bi svejedno zaokružio.
    rating: k.ocena === null ? null : Math.round(k.ocena * 10) / 10,
    reviewCount: k.brojOcena,
  };
}

// ── upis ───────────────────────────────────────────────────

async function upis(): Promise<void> {
  const spisak = citajSpisak();
  const oznake = new Map((await postojeceOznake()).map((r) => [r.label, r.place_id]));

  if (spisak.length < 5) {
    console.log(`! Samo ${spisak.length} kanarinaca; docs/bezbednost.md predlaže 5–10.\n`);
  }

  const van = [...oznake.keys()].filter((o) => !spisak.some((k) => k.oznaka === o));
  if (van.length > 0) {
    console.log(
      `! U bazi, a ne u spisku: ${van.join(", ")}. Ne brišu se (to je dokaz); ` +
        "ali se više ne osvežavaju, pa za 30 dana nestaju iz pretrage.\n",
    );
  }

  const plan = spisak.map((k) => ({ k, placeId: oznake.get(k.oznaka) ?? novPlaceId(), nov: !oznake.has(k.oznaka) }));

  for (const { k, placeId, nov } of plan) {
    console.log(
      `${nov ? "+ nov   " : "~ osveži"} ${k.oznaka.padEnd(12)} ${placeId}  ${k.grad}/${k.nisa}  ${k.naziv}`,
    );
  }

  if (!pisi) {
    console.log("\nPregled — ništa nije upisano. Pokreni sa `-- --pisi` za upis.");
    return;
  }

  // Po kombinaciji, jer `upsertBusinesses` prima jedan grad i jednu nišu.
  const poKombinaciji = new Map<string, typeof plan>();
  for (const stavka of plan) {
    const kljuc = `${stavka.k.grad}/${stavka.k.nisa}`;
    poKombinaciji.set(kljuc, [...(poKombinaciji.get(kljuc) ?? []), stavka]);
  }

  for (const stavke of poKombinaciji.values()) {
    const prvi = stavke[0]!.k;
    const city = resolveCity(prvi.grad);
    const niche = resolveNiche(prvi.nisa);
    // Isti `query_text` koji bi upisao pravi `scan` za tu kombinaciju.
    await upsertBusinesses({
      businesses: stavke.map((s) => kaoBusiness(s.k, s.placeId)),
      citySlug: city.slug,
      nicheSlug: niche.slug,
      queryText: buildScanQueries(niche, city)[0] ?? niche.query,
      countryCode: COUNTRY,
    });
  }

  // Oznaka tek posle reda u `businesses` (FK).
  const nove = plan.filter((p) => p.nov).map((p) => ({ place_id: p.placeId, label: p.k.oznaka }));
  if (nove.length > 0) {
    const { error } = await supabaseAdmin().from("canaries").insert(nove);
    if (error) throw new Error(`Upis canaries nije uspeo: ${error.message}`);
  }

  // Audit kao za svaki prospekt iz scana: isti posao, isti ključ deduplikacije.
  const zaAudit = await placeIdsNeedingAudit(plan.map((p) => p.placeId));
  const upisano = await enqueueMany(
    zaAudit.map((placeId) => ({
      type: "enrich_basic" as const,
      payload: { placeId },
      dedupeKey: placeId,
    })),
  );

  const rok = new Date(Date.now() + TTL_DANA * DAN_MS).toISOString().slice(0, 10);
  console.log(
    `\nUpisano ${plan.length} (${plan.filter((p) => p.nov).length} novih), ` +
      `${upisano} poslova za audit. Vidljivi su do ${rok}; pokreni ponovo pre toga.`,
  );
  if (upisano > 0) console.log("Audit radi worker; domen mora da odgovara kad posao krene.");
}

// ── izveštaj ───────────────────────────────────────────────

type BizRed = {
  place_id: string;
  name: string;
  city_slug: string;
  niche_slug: string | null;
  google_refreshed_at: string;
};
type AuditRed = { place_id: string; site_status: string; ugly_band: string | null; audit_level: number };
type UnlockRed = { place_id: string; user_id: string; created_at: string };
type ProfilRed = { id: string; email: string | null; role: string };

async function izvestajKanarinaca(): Promise<void> {
  const oznake = await postojeceOznake();
  if (oznake.length === 0) {
    console.log("U bazi nema nijednog kanarinca. Prvo `pnpm kanarinci -- --pisi`.");
    return;
  }
  const ids = oznake.map((o) => o.place_id);
  const db = supabaseAdmin();

  const [biz, audit, otkljucano] = await Promise.all([
    db.from("businesses").select("place_id, name, city_slug, niche_slug, google_refreshed_at").in("place_id", ids),
    db.from("website_audits").select("place_id, site_status, ugly_band, audit_level").in("place_id", ids),
    db.from("unlocks").select("place_id, user_id, created_at").in("place_id", ids).order("created_at"),
  ]);
  for (const r of [biz, audit, otkljucano]) {
    if (r.error) throw new Error(`Čitanje izveštaja nije uspelo: ${r.error.message}`);
  }

  const unlocks = (otkljucano.data ?? []) as UnlockRed[];
  const korisnici = [...new Set(unlocks.map((u) => u.user_id))];
  const profili = new Map<string, ProfilRed>();
  if (korisnici.length > 0) {
    const { data, error } = await db.from("profiles").select("id, email, role").in("id", korisnici);
    if (error) throw new Error(`Čitanje profila nije uspelo: ${error.message}`);
    for (const p of (data ?? []) as ProfilRed[]) profili.set(p.id, p);
  }

  const bizPo = new Map(((biz.data ?? []) as BizRed[]).map((b) => [b.place_id, b]));
  const auditPo = new Map(((audit.data ?? []) as AuditRed[]).map((a) => [a.place_id, a]));

  for (const o of oznake) {
    const b = bizPo.get(o.place_id);
    const a = auditPo.get(o.place_id);
    const staro = b ? Math.floor((Date.now() - Date.parse(b.google_refreshed_at)) / DAN_MS) : null;
    const svezina =
      staro === null ? "nema reda u businesses"
      : staro >= TTL_DANA ? `NEVIDLJIV (osvežen pre ${staro} d)`
      : `vidljiv još ${TTL_DANA - staro} d`;
    const auditTekst = a ? `${a.site_status}${a.ugly_band ? `/${a.ugly_band}` : ""} (nivo ${a.audit_level})` : "bez audita";
    const njegovi = unlocks.filter((u) => u.place_id === o.place_id);

    console.log(
      `\n${o.label}  ${o.place_id}  ${b ? `${b.city_slug}/${b.niche_slug ?? "?"}  ${b.name}` : ""}\n` +
        `  ${svezina} · ${auditTekst} · otključalo ${njegovi.length}`,
    );
    for (const u of njegovi) {
      const p = profili.get(u.user_id);
      console.log(
        `    ${u.created_at.slice(0, 16).replace("T", " ")}  ${u.user_id}  ${p?.email ?? "(obrisan nalog)"}` +
          (p?.role === "admin" ? "  [admin]" : ""),
      );
    }
  }

  const nevidljivi = oznake.filter((o) => {
    const b = bizPo.get(o.place_id);
    return !b || Date.now() - Date.parse(b.google_refreshed_at) >= TTL_DANA * DAN_MS;
  });
  if (nevidljivi.length > 0) {
    console.log(`\n! ${nevidljivi.length} kanarinaca se ne vidi u pretrazi. \`pnpm kanarinci -- --pisi\` ih vraća.`);
  }
}

// ── main ───────────────────────────────────────────────────

(izvestaj ? izvestajKanarinaca() : upis()).catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
