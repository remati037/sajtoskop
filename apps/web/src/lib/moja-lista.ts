// apps/web/src/lib/moja-lista.ts
// Čitanje sopstvenih otključanih prospekata (F4 §3) i izvor podataka za CSV (§5).
//
// Redosled je namerno ovakav: prvo `unlocks` kroz `userSupabase()` (RLS politika
// „own unlocks" je stvarna brava), pa tek onda `businesses` i `website_audits`
// kroz admin klijent — i to ISKLJUČIVO za `place_id`-jeve koje je prvi upit
// vratio. Obrnut redosled bi značio da admin klijent čita sve pa filtrira u
// TypeScriptu, gde se `where user_id` zaboravi u prvoj sledećoj izmeni.

import "server-only";
import {
  LEAD_AUDIT_COLUMNS,
  LEAD_BUSINESS_COLUMNS,
  screenshotPathsOf,
  toPublicLead,
  type LeadAudit,
  type LeadBusiness,
} from "./public-lead";
import { signScreenshots } from "./screenshots";
import type { UnlockedLead } from "./search-types";
import { adminSupabase, userSupabase } from "./supabase";

/**
 * Gornja granica jednog čitanja liste. Beta plan daje 30 kredita mesečno, pa je
 * 2000 otključanih leadova nedostižno u beti — cap postoji da stranica ne bi
 * pokušala da nacrta neograničenu tabelu ako se planovi promene.
 */
const CAP = 2000;

export type MojLead = UnlockedLead & {
  /** Kad je kredit potrošen. Kolona u tabeli i u CSV-u. */
  unlockedAt: string;
};

export type MojaListaFilter = {
  citySlug?: string;
  nicheSlug?: string;
};

/**
 * Svi otključani prospekti korisnika, najnoviji prvi.
 *
 * Svaki red prolazi kroz `toPublicLead(..., true)` — istu funkciju kao pretraga.
 * Zaključanih redova ovde po definiciji nema, ali se oblik odgovora ne razilazi
 * sa ostatkom aplikacije i novo polje u `website_audits` se ni ovde ne pojavi
 * dok se svesno ne doda u `UnlockedLead`.
 */
export async function getMojaLista(filter: MojaListaFilter = {}): Promise<MojLead[]> {
  const { data: unlocks, error } = await userSupabase()
    .from("unlocks")
    .select("place_id, created_at")
    .order("created_at", { ascending: false })
    .limit(CAP)
    .returns<{ place_id: string; created_at: string }[]>();

  if (error) throw new Error(`Čitanje otključanih prospekata nije uspelo: ${error.message}`);

  const redovi = unlocks ?? [];
  if (redovi.length === 0) return [];

  const otkljucanoU = new Map(redovi.map((r) => [r.place_id, r.created_at]));
  const ids = redovi.map((r) => r.place_id);
  const db = adminSupabase();

  let upit = db.from("businesses").select(LEAD_BUSINESS_COLUMNS).in("place_id", ids);
  if (filter.citySlug) upit = upit.eq("city_slug", filter.citySlug);
  if (filter.nicheSlug) upit = upit.eq("niche_slug", filter.nicheSlug);

  const { data: businesses, error: bErr } = await upit.returns<LeadBusiness[]>();
  if (bErr) throw new Error(`Čitanje prospekata nije uspelo: ${bErr.message}`);

  const firme = businesses ?? [];
  if (firme.length === 0) return [];

  const { data: audits, error: aErr } = await db
    .from("website_audits")
    .select(`place_id, ${LEAD_AUDIT_COLUMNS}`)
    .in(
      "place_id",
      firme.map((b) => b.place_id),
    )
    .returns<(LeadAudit & { place_id: string })[]>();

  if (aErr) throw new Error(`Čitanje audita nije uspelo: ${aErr.message}`);

  const auditPoMestu = new Map((audits ?? []).map((a) => [a.place_id, a]));

  // Cela lista je po definiciji otključana, pa se potpisuje sve odjednom —
  // jedan poziv ka Storage-u umesto dva po redu.
  const signed = await signScreenshots(
    firme.flatMap((b) => screenshotPathsOf(auditPoMestu.get(b.place_id) ?? null)),
  );

  const lista: MojLead[] = [];

  for (const b of firme) {
    const lead = toPublicLead(b, auditPoMestu.get(b.place_id) ?? null, true, signed);
    // Nemoguće stanje — `true` je prosleđen literalno. Suženje je tu zbog tipa.
    if (!lead.isUnlocked) continue;
    lista.push({ ...lead, unlockedAt: otkljucanoU.get(b.place_id) ?? "" });
  }

  // Redosled iz `unlocks` se gubi u `in()` upitu, pa se vraća ovde.
  lista.sort((x, y) => y.unlockedAt.localeCompare(x.unlockedAt));
  return lista;
}
