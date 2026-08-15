// apps/web/src/lib/dnevnik.ts
// Beta dnevnik (F11 §6.5) — čitanje za dashboard i CRUD za `/admin/dnevnik`.
//
// `changelog` ima jedinu politiku u projektu: `select using (published)` za
// `authenticated` (0011). Ekrani čitaju kroz `adminSupabase()` sa eksplicitnim
// `published = true` — politika ostaje za svaki direktan čitalac.

import "server-only";
import type { ChangelogRow } from "@sajtoskop/shared";
import type { Ishod } from "./admin-radnje";
import { adminSupabase } from "./supabase";

export type StavkaDnevnika = ChangelogRow & {
  /** Presek `from_feedback` sa korisnikovim prijavama — za „iz tvog utiska". */
  izTvogUtiska: boolean;
};

export type DnevnikPrikaz = {
  /** Poslednjih 5 objavljenih stavki, za dashboard (F11 §6.5). */
  stavke: StavkaDnevnika[];
  /** „N od M promena iz utisaka" — N je broj stavki vezanih za prijave. */
  izUtisaka: number;
  ukupno: number;
};

/** Dashboard: 5 poslednjih objavljenih stavki + brojač „iz utisaka". */
export async function citajDnevnik(userId: string): Promise<DnevnikPrikaz> {
  const db = adminSupabase();

  const [stavke, moje] = await Promise.all([
    db
      .from("changelog")
      .select("*")
      .eq("published", true)
      .order("shipped_at", { ascending: false })
      .limit(5)
      .returns<ChangelogRow[]>(),
    db.from("feedback").select("id").eq("user_id", userId).returns<{ id: number }[]>(),
  ]);

  if (stavke.error) throw new Error(`Čitanje dnevnika nije uspelo: ${stavke.error.message}`);
  if (moje.error) console.error("[dnevnik] korisnikove prijave:", moje.error.message);

  const mojiIdjevi = new Set((moje.data ?? []).map((f) => f.id));

  // Brojač „iz utisaka" se računa nad SVIM objavljenim stavkama, ne nad 5
  // prikazanih — „17 od 23 promene iz utisaka" je brojka o dnevniku, ne o
  // vrhu liste. Tabela je u beti mala, pa se ceo spisak pročita jednom.
  const [sve, ukupno] = await Promise.all([
    db
      .from("changelog")
      .select("id, from_feedback")
      .eq("published", true)
      .returns<Pick<ChangelogRow, "id" | "from_feedback">[]>(),
    db.from("changelog").select("id", { count: "exact", head: true }).eq("published", true),
  ]);

  if (sve.error) console.error("[dnevnik] brojač:", sve.error.message);

  return {
    stavke: (stavke.data ?? []).map((s) => ({
      ...s,
      izTvogUtiska: s.from_feedback.some((id) => mojiIdjevi.has(id)),
    })),
    izUtisaka: (sve.data ?? []).filter((s) => s.from_feedback.length > 0).length,
    ukupno: ukupno.count ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════
// ADMIN — `/admin/dnevnik`
// ═══════════════════════════════════════════════════════════

/** Sve stavke, objavljene i nacrtne, najnovije prvo. */
export async function citajSveStavke(): Promise<ChangelogRow[]> {
  const { data, error } = await adminSupabase()
    .from("changelog")
    .select("*")
    .order("shipped_at", { ascending: false })
    .limit(200)
    .returns<ChangelogRow[]>();

  if (error) throw new Error(`Čitanje dnevnika nije uspelo: ${error.message}`);
  return data ?? [];
}

/** Telo za `POST` i `PATCH` — isti oblik, razlika je samo u ID-ju. */
export type StavkaTelo = {
  title: string;
  kind: ChangelogRow["kind"];
  body: string | null;
  published: boolean;
};

const NEMA_STAVKE: Ishod = { ok: false, status: 404, poruka: "Ta stavka dnevnika ne postoji." };

/** Nova stavka. `shipped_at` je sada — datum je istorija, ne plan. */
export async function napraviStavku(telo: StavkaTelo): Promise<Ishod> {
  const { data, error } = await adminSupabase()
    .from("changelog")
    .insert({
      title: telo.title,
      kind: telo.kind,
      body: telo.body,
      published: telo.published,
    })
    .select("id, title")
    .returns<{ id: number; title: string }[]>();

  if (error) throw new Error(error.message);

  const red = data?.[0];
  if (!red) throw new Error("Upis stavke nije vratio ID.");

  return { ok: true, poruka: `Stavka „${red.title}" je objavljena.`, ref: `dnevnik:${red.id}` };
}

export async function izmeniStavku(id: number, telo: StavkaTelo): Promise<Ishod> {
  const { data, error } = await adminSupabase()
    .from("changelog")
    .update({
      title: telo.title,
      kind: telo.kind,
      body: telo.body,
      published: telo.published,
    })
    .eq("id", id)
    .select("id, title")
    .returns<{ id: number; title: string }[]>();

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return NEMA_STAVKE;

  return {
    ok: true,
    poruka: `Stavka „${data[0]!.title}" je sačuvana.`,
    ref: `dnevnik:${id}`,
  };
}

export async function obrisiStavku(id: number): Promise<Ishod> {
  const { data, error } = await adminSupabase()
    .from("changelog")
    .delete()
    .eq("id", id)
    .select("id, title")
    .returns<{ id: number; title: string }[]>();

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return NEMA_STAVKE;

  return {
    ok: true,
    poruka: `Stavka „${data[0]!.title}" je obrisana.`,
    ref: `dnevnik:${id}`,
  };
}
