// apps/web/src/lib/feedback.ts
// Utisci iz bete: upis, dopuna i podsetnik (F10).
//
// Sve ide kroz `adminSupabase()`: `feedback` ima RLS `using (false)` (pravilo
// 10), pa nijedan red ne može da se pročita ni upiše iz pregledača. Vlasnik reda
// je uvek `userId` iz `requireUserId()` — nikad iz tela (pravilo 8).
//
// Baza je izvor istine, mejl je obaveštenje. Zato ovde nema nijednog poziva ka
// Resend-u: ruta ga zove kroz `after()`, pošto je red već upisan.

import "server-only";
import { currentUser } from "@clerk/nextjs/server";
import type { FeedbackCtx, FeedbackRow, ProfileRow } from "@sajtoskop/shared";
import type { DopunaBody } from "./feedback-schema";
import { posaljiUtisak, type MejlIshod, type UtisakZaMejl } from "./feedback-mail";
import { naslovZaPutanju } from "./navigacija";
import { adminSupabase } from "./supabase";

/**
 * Preko ovoliko utisaka u 24h se i dalje upisuje, ali mejl izostaje.
 * Odluka 6: korisnik uvek vidi „Hvala" — poruka „dosta si mi rekao" je u beti
 * najgori mogući odgovor.
 */
export const MEJL_DNEVNI_LIMIT = 10;

/**
 * Tvrd plafon (F10 §5). Preko ovoga se NE upisuje ništa. Odluka 6 čuva inboks;
 * ovo čuva tabelu od klijenta koji zaobiđe formu i pusti petlju.
 */
export const UPIS_DNEVNI_PLAFON = 50;

/** Koliko dugo posle nastanka utisak sme da se dopuni. */
const DOPUNA_ROK_MS = 60 * 60 * 1000;

const DAN_MS = 24 * 60 * 60 * 1000;

/** Gornja granica dužine UA stringa u `ctx`. Zaštita, ne validacija. */
const UA_MAX = 400;

export type UtisakUlaz = {
  rating: 1 | 2 | 3;
  source: FeedbackRow["source"];
  /** Putanja sa klijenta. Naziv ekrana se iz nje IZVODI, ne prima. */
  route: string | null;
  viewport: string | null;
  /** Iz `User-Agent` headera, nikad iz tela (F10 §5). */
  ua: string;
};

export type UtisakIshod =
  | { ishod: "upisan"; red: FeedbackRow; posaljiMejl: boolean }
  /** Preko tvrdog plafona: ništa nije upisano, korisnik i dalje vidi „Hvala". */
  | { ishod: "plafon" }
  /** Sesija postoji, profil još nije stigao kroz Clerk webhook. */
  | { ishod: "no_user" };

/**
 * Nastanak utiska. Zove se na prvi klik — ocena je jedini obavezan korak.
 *
 * Kontekst skuplja server (odluka 5): plan, krediti i broj otključanih se čitaju
 * iz baze, UA iz headera. Iz tela dolazi samo ono što server ne zna.
 */
export async function zabeleziUtisak(userId: string, ulaz: UtisakUlaz): Promise<UtisakIshod> {
  const db = adminSupabase();
  const od = new Date(Date.now() - DAN_MS).toISOString();

  const [profil, otkljucani, skoro] = await Promise.all([
    db
      .from("profiles")
      .select("plan, credits_balance")
      .eq("id", userId)
      .maybeSingle<Pick<ProfileRow, "plan" | "credits_balance">>(),
    db.from("unlocks").select("place_id", { count: "exact", head: true }).eq("user_id", userId),
    db
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", od),
  ]);

  if (profil.error) throw new Error(`Čitanje profila nije uspelo: ${profil.error.message}`);
  if (!profil.data) return { ishod: "no_user" };
  if (skoro.error) throw new Error(`Brojanje utisaka nije uspelo: ${skoro.error.message}`);

  const dosad = skoro.count ?? 0;
  if (dosad >= UPIS_DNEVNI_PLAFON) return { ishod: "plafon" };

  // Broj otključanih je ukras u mejlu; ako baš on padne, utisak svejedno ide.
  if (otkljucani.error) console.error("[feedback] broj otključanih:", otkljucani.error.message);

  const ctx: FeedbackCtx = {
    plan: profil.data.plan,
    credits: profil.data.credits_balance,
    unlocks: otkljucani.count ?? 0,
    ua: ulaz.ua.slice(0, UA_MAX),
    viewport: ulaz.viewport ?? "",
  };

  const { data, error } = await db
    .from("feedback")
    .insert({
      user_id: userId,
      rating: ulaz.rating,
      source: ulaz.source,
      route: ulaz.route,
      // Jedan izvor istine za naziv ekrana — isti onaj koji stoji u gornjoj traci.
      route_label: ulaz.route ? naslovZaPutanju(ulaz.route) : null,
      ctx,
    })
    .select()
    .single<FeedbackRow>();

  if (error) throw new Error(`Upis utiska nije uspeo: ${error.message}`);

  return { ishod: "upisan", red: data, posaljiMejl: dosad < MEJL_DNEVNI_LIMIT };
}

export type DopunaIshod =
  | { ok: true; red: FeedbackRow }
  /** Nema takvog utiska, ili nije njegov — spolja se ne razlikuje (P0-1). */
  | { ok: false; razlog: "nema" }
  /** Postoji, ali je stariji od sat vremena. */
  | { ok: false; razlog: "kasno" };

/**
 * Dopuna tekstom i tipom, u drugom koraku modala.
 *
 * `user_id` je u uslovu, ne samo `id`: bez njega je ovo IDOR na tuđ utisak
 * (P0-1). Rok od sat vremena postoji jer zapis koji sam već pročitao u mejlu ne
 * sme da se prepiše sat kasnije.
 */
export async function dopuniUtisak(
  userId: string,
  id: number,
  dopuna: DopunaBody,
): Promise<DopunaIshod> {
  const db = adminSupabase();

  const { data, error } = await db
    .from("feedback")
    .update({
      ...(dopuna.kind !== undefined ? { kind: dopuna.kind } : {}),
      ...(dopuna.message !== undefined ? { message: dopuna.message } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - DOPUNA_ROK_MS).toISOString())
    .select()
    .maybeSingle<FeedbackRow>();

  if (error) throw new Error(`Dopuna utiska nije uspela: ${error.message}`);
  if (data) return { ok: true, red: data };

  // Nijedan red nije pogođen. Razlika između „nema ga" i „prošao je rok" je
  // jedina koju korisnik može da razume, pa se traži drugim upitom.
  const { data: postoji } = await db
    .from("feedback")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle<{ id: number }>();

  return { ok: false, razlog: postoji ? "kasno" : "nema" };
}

/**
 * Da li je ovaj zapis u trenutku nastanka bio unutar dnevnog limita za mejl.
 *
 * Isti račun koji je `zabeleziUtisak` već napravio, samo rekonstruisan: koliko
 * je utisaka istog korisnika postojalo u 24h PRE ovoga. Postoji zbog dopune —
 * bez ove provere bi ručno sastavljen `PATCH` poslao mejl za zapis koji je
 * namerno ostao tih (odluka 6). Klijent do drugog koraka ionako ne stiže.
 */
export async function mejlDozvoljenZa(red: FeedbackRow): Promise<boolean> {
  const nastao = new Date(red.created_at).getTime();

  const { count, error } = await adminSupabase()
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", red.user_id)
    .gte("created_at", new Date(nastao - DAN_MS).toISOString())
    .lt("created_at", red.created_at);

  if (error) {
    // Sumnja ide u korist inboksa: utisak je u bazi i ništa se ne gubi.
    console.error("[feedback] provera dnevnog limita:", error.message);
    return false;
  }

  return (count ?? 0) < MEJL_DNEVNI_LIMIT;
}

/**
 * Ko je poslao utisak — za `Reply-To` i za red „Korisnik" u mejlu.
 *
 * Ime i mejl se čitaju sa servera (pravilo 8, odluka 5). Clerk je primarni izvor
 * jer jedini zna ime; `profiles.email` je rezerva za slučaj da poziv ka Clerku
 * padne — bez nje bi jedan spor odgovor Clerk API-ja pojeo `Reply-To`, dakle
 * jedini način da odgovorim u jednom kliku.
 */
export async function citajKontakt(userId: string): Promise<UtisakZaMejl["korisnik"]> {
  let ime: string | null = null;
  let email: string | null = null;

  try {
    const korisnik = await currentUser();
    const puno = [korisnik?.firstName, korisnik?.lastName].filter(Boolean).join(" ").trim();
    ime = puno || korisnik?.username || null;
    email = korisnik?.primaryEmailAddress?.emailAddress ?? null;
  } catch (err) {
    console.error("[feedback] čitanje Clerk profila:", err);
  }

  if (!email) {
    const { data } = await adminSupabase()
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle<Pick<ProfileRow, "email">>();

    email = data?.email ?? null;
  }

  return { ime, email };
}

/** Ishod slanja mejla se pamti uz zapis, ne u logu koji niko ne čita. */
export async function upisiIshodMejla(id: number, ishod: MejlIshod): Promise<void> {
  const { error } = await adminSupabase()
    .from("feedback")
    .update(
      ishod.ok
        ? { emailed_at: new Date().toISOString(), email_error: null }
        : { email_error: ishod.greska.slice(0, 1000) },
    )
    .eq("id", id);

  // Ovde se lanac zaustavlja: utisak je upisan, mejl je (ne)poslat, a korisnik
  // je odavno dobio odgovor. Jedino što ostaje je da se vidi u logu.
  if (error) console.error("[feedback] upis ishoda mejla:", error.message);
}

/**
 * Pošalji utisak na moj inboks i upiši ishod uz zapis.
 *
 * Obe rute je zovu kroz `after()`, dakle posle odgovora korisniku. Ništa ovde ne
 * sme da baci: red je već u bazi, a korisnik je odavno dobio „Poslato".
 *
 * `dopuna: true` je drugi mejl, onaj sa tekstom. Alternativa — čekati tekst pa
 * poslati jedan mejl — znači da utisak korisnika koji zatvori tab nikad ne
 * stigne, a to obara ceo cilj faze (F10 §2).
 */
export async function javiMejlom(
  red: FeedbackRow,
  userId: string,
  dopuna: boolean,
): Promise<void> {
  try {
    const korisnik = await citajKontakt(userId);

    const mejl = await posaljiUtisak({
      id: red.id,
      rating: red.rating,
      kind: red.kind,
      message: red.message,
      source: red.source,
      route: red.route,
      routeLabel: red.route_label,
      ctx: red.ctx,
      createdAt: red.created_at,
      korisnik,
      dopuna,
    });

    await upisiIshodMejla(red.id, mejl);
  } catch (err) {
    console.error("[feedback] slanje mejla:", err);
  }
}

/**
 * „Podsetnik je prikazan." Zove se čim se prozor pojavi, ne kad se odgovori —
 * korisnik koji ga je zatvorio ne sme da ga vidi ponovo.
 *
 * `is("feedback_prompted_at", null)` znači da prvo prikazivanje pobeđuje: dva
 * taba u istoj sekundi ne pomeraju datum unapred.
 *
 * Ovo je direktan `update` nad `profiles`, ali ne dira `credits_balance`, pa
 * pravilo 3 nije u igri.
 */
export async function oznaciPodsetnikVidjen(userId: string): Promise<void> {
  const { error } = await adminSupabase()
    .from("profiles")
    .update({ feedback_prompted_at: new Date().toISOString() })
    .eq("id", userId)
    .is("feedback_prompted_at", null);

  if (error) throw new Error(`Upis podsetnika nije uspeo: ${error.message}`);
}

/**
 * Da li korisniku treba pokazati podsetnik (F10 §1).
 *
 * Čista funkcija nad profilom koji `(app)/layout.tsx` ionako čita — podsetnik ne
 * košta nijedan dodatan upit na svakom učitavanju strane.
 *
 * Drugi uslov je izveden iz balansa umesto iz `count(*)` nad `unlocks`: ivica
 * koju to prima je korisnik koji je dobio povraćaj i vratio se na pun balans,
 * pa mu se podsetnik odloži do sledećeg trošenja. Prihvatljivo — podsetnik nije
 * naplata, sme da promaši dan.
 */
export function trebaPodsetnik(profil: ProfileRow | null, mesecniKrediti: number): boolean {
  if (!profil) return false;
  if (profil.feedback_prompted_at !== null) return false;
  if (profil.credits_balance >= mesecniKrediti) return false;

  const star = Date.now() - new Date(profil.created_at).getTime();
  return star >= 3 * DAN_MS;
}
