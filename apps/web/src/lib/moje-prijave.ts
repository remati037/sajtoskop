// apps/web/src/lib/moje-prijave.ts
// „Moje prijave" (F11 §6.4) — korisnikove prijave i njihovi ishodi.
//
// `feedback` ima RLS `using (false)` (pravilo 10), pa se i korisnikov SOPSTVENI
// spisak čita kroz `adminSupabase()`. Zaštita je isključivo `userId` iz sesije
// (pravilo 8) — nijedna funkcija odavde ne prima korisnika iz tela.
//
// [ODSTUPANJE od F11 §6.4, namerno] PRD kaže „Čita se kroz API rutu". Ekran je
// serverska komponenta i čita direktno, kroz isti obrazac kao i svi ekrani
// konzole (v. „S3 — šta se razišlo", tačka 3, i „S6", tačka 17): ruta pod
// `/api` bi bila drugi put do istih podataka, sa istom proverom (`userId` iz
// sesije) i bez ijednog pozivaoca. RLS na `feedback` ostaje `using (false)`
// netaknut — to je i dalje jedina kapija prema klijentu.

import "server-only";
import { opisOdgovora, pitanjeZaKljuc, type FeedbackRow } from "@sajtoskop/shared";
import { adminSupabase } from "./supabase";

/** Gornja granica po korisniku — 100 prijava je daleko iznad bete. */
const PLAFON = 100;

export type MojaPrijava = {
  red: FeedbackRow;
  /** Šta je korisnik napisao — za prikaz uz datum, bez punog `answers` objekta. */
  sadrzaj: string;
};

/** Sve prijave korisnika, najnovije prvo. */
export async function citajMojePrijave(userId: string): Promise<MojaPrijava[]> {
  const { data, error } = await adminSupabase()
    .from("feedback")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(PLAFON)
    .returns<FeedbackRow[]>();

  if (error) throw new Error(`Čitanje prijava nije uspelo: ${error.message}`);

  return (data ?? []).map((red) => ({ red, sadrzaj: sadrzajPrijave(red) }));
}

/**
 * „Otvoren ekran → ishod je viđen" (F11 §6.4: otvaranje upisuje `seen_at` i
 * nulira `feedback_unseen_count` → tačka sa dugmeta nestaje).
 *
 * Zove se iz stranice kroz `after()` — dakle POSLE odgovora, tačno kad je
 * korisnik stvarno video spisak. Idempotentno: drugi prolaz nema šta da menja.
 *
 * `seen_at` se upisuje samo redovima sa ishodom (rešeno, odbijeno, duplikat) —
 * otvorena prijava nema šta da bude „viđena". Brojač se nulira uvek: na ovom
 * ekranu korisnik vidi i otvorene i rešene.
 *
 * Ne baca. Promašena oznaka znači da će tačka ostati do sledećeg otvaranja —
 * nije razlog da ekran padne.
 */
export async function oznaciVidjeno(userId: string): Promise<void> {
  const db = adminSupabase();
  const sada = new Date().toISOString();

  const { error } = await db
    .from("feedback")
    .update({ seen_at: sada, updated_at: sada })
    .eq("user_id", userId)
    .in("status", ["reseno", "odbijeno", "duplikat"])
    .is("seen_at", null);

  if (error) console.error("[moje-prijave] oznaka viđenog:", error.message);

  const { error: greskaProfila } = await db
    .from("profiles")
    .update({ feedback_unseen_count: 0 })
    .eq("id", userId);

  if (greskaProfila) console.error("[moje-prijave] nuliranje brojača:", greskaProfila.message);
}

/** Jedna rečenica onoga što je korisnik napisao — isti oblik koji digest koristi. */
function sadrzajPrijave(red: FeedbackRow): string {
  const delovi: string[] = [];

  const OCENA: Record<1 | 2 | 3, string> = { 1: "Loše", 2: "Ok", 3: "Odlično" };
  if (red.rating !== null) delovi.push(OCENA[red.rating]);

  if (red.prompt_key) {
    const pitanje = pitanjeZaKljuc(red.prompt_key);
    delovi.push(pitanje ? opisOdgovora(pitanje, red.answers) : red.prompt_key);
  }

  const poruka = red.message?.trim().replace(/\s+/g, " ");
  if (poruka) delovi.push(poruka);

  return delovi.join(" · ") || "Utisak";
}
