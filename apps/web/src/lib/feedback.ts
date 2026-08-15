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
import type {
  CreditLedgerRow,
  FeedbackCtx,
  FeedbackGrantResult,
  FeedbackKind,
  FeedbackRow,
  KlijentskaGreska,
  ProfileRow,
} from "@sajtoskop/shared";
import { pitanjeZaKljuc, proveriOdgovor } from "@sajtoskop/shared";
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

// ── nagrada za utisak sa porukom (F11 §6.7) ─────────────────
// Podela odgovornosti iz F11 §4: mesečni plafon od 20 kredita i idempotencija su
// u `grant_feedback_credits`, jer moraju da izdrže i poziv koji zaobiđe
// aplikaciju. OVDE su pravila proizvoda — dužina poruke, jedan put dnevno i
// deset puta mesečno — jer se menjaju češće od šeme. Ako se ikad raziđu, izvor
// istine je RPC.

/** Kraća poruka nije utisak nego klik. */
export const NAGRADA_MIN_PORUKA = 20;
export const NAGRADA_DNEVNO = 1;
export const NAGRADA_MESECNO = 10;

/**
 * Automatska nagrada je uvek +1. Broji se po `delta = 1`, a ne po broju stavki
 * sa razlogom `feedback`: ručnih +10 za potvrđen bug (F11.3) ima isti razlog u
 * knjizi, a oni ne smeju da pojedu korisnikovu dnevnu kvotu.
 */
const NAGRADA_IZNOS = 1;

/**
 * Dan i mesec se računaju po UTC-u, isto kao `date_trunc('month', now())` u
 * `grant_feedback_credits`. Beogradsko vreme bi značilo da se aplikacija i RPC
 * dva sata dnevno ne slažu oko toga koji je mesec.
 */
function pocetakDana(sada: number): string {
  const d = new Date(sada);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function pocetakMeseca(sada: number): string {
  const d = new Date(sada);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * Ide li ovaj zapis na mejl ODMAH, ili čeka digest u 21:00 (F11 odluka 11).
 *
 * Tri stvari gore i nijedna više: prijava kvara, ocena 1 i incident. Sve ostalo
 * — odgovori na pitanja, ideje, pohvale — staje u jedan dnevni mejl.
 *
 * Razlog je merljiv: inboks u koji stiže 40 mejlova mesečno se čita, a onaj u
 * koji stiže 200 se filtrira u fasciklu i tamo umre. Do F11.3 je sve išlo odmah
 * (v. „S1 — šta se razišlo", tačka 3), jer digesta nije bilo — pa bi odgovori na
 * pitanja nigde ne stigli.
 *
 * `source === 'incident'` je tu i kad je odgovor bio „Ne treba": čovek kome je
 * skeniranje palo je hitniji od svega ostalog, i onda kad ne traži dnevnik.
 */
export function ideOdmah(red: FeedbackRow): boolean {
  return red.kind === "bug" || red.rating === 1 || red.source === "incident";
}

export type UtisakUlaz = {
  /** `null` od F11: odgovor na pitanje nema ocenu. */
  rating: 1 | 2 | 3 | null;
  source: FeedbackRow["source"];
  /** Putanja sa klijenta. Naziv ekrana se iz nje IZVODI, ne prima. */
  route: string | null;
  viewport: string | null;
  /** Iz `User-Agent` headera, nikad iz tela (F10 §5). */
  ua: string;

  // ── F11: odgovor na pitanje ───────────────────────────────
  // `promptKey` i `answers` dolaze VEĆ PROVERENI kroz `proveriOdgovor()` iz
  // kataloga (pravilo 16). `kind` i `severity` server izvodi iz kataloga, nikad
  // iz tela (F11 §5).
  promptKey?: string | null;
  answers?: Record<string, unknown> | null;
  kind?: FeedbackKind | null;
  severity?: 1 | 2 | 3 | null;

  // ── F11.2 ────────────────────────────────────────────────
  /** Dnevnik klijentskih grešaka. Upisuje se SAMO uz `kind = 'bug'`. */
  errors?: KlijentskaGreska[] | null;
  /** Putanja u privatnom bucketu `feedback`, već proverena u `/slika`. */
  screenshotPath?: string | null;
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

  // Dnevnik grešaka ide u zapis samo kad je zapis prijava kvara (F11 odluka 10).
  // Provera je ovde, a ne u šemi tela: `kind` server IZVODI iz kataloga, pa se
  // tek na ovom mestu zna da li je ovo bug ili pohvala.
  const dnevnik = ulaz.kind === "bug" ? (ulaz.errors ?? []) : [];

  const ctx: FeedbackCtx = {
    plan: profil.data.plan,
    credits: profil.data.credits_balance,
    unlocks: otkljucani.count ?? 0,
    ua: ulaz.ua.slice(0, UA_MAX),
    viewport: ulaz.viewport ?? "",
    ...(dnevnik.length > 0 ? { errors: dnevnik } : {}),
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
      ...(ulaz.promptKey ? { prompt_key: ulaz.promptKey } : {}),
      ...(ulaz.answers ? { answers: ulaz.answers } : {}),
      ...(ulaz.kind ? { kind: ulaz.kind } : {}),
      ...(ulaz.severity ? { severity: ulaz.severity } : {}),
      ...(ulaz.screenshotPath ? { screenshot_path: ulaz.screenshotPath } : {}),
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
  | { ok: false; razlog: "kasno" }
  /** Drugi korak odgovora ne prolazi šemu iz kataloga (pravilo 16). */
  | { ok: false; razlog: "odgovor"; detalji?: string[] };

/**
 * Dopuna tekstom, tipom, slikom i drugim korakom odgovora.
 *
 * `user_id` je u uslovu, ne samo `id`: bez njega je ovo IDOR na tuđ utisak
 * (P0-1). Rok od sat vremena postoji jer zapis koji sam već pročitao u mejlu ne
 * sme da se prepiše sat kasnije.
 *
 * Od F11.2 dopuna ume da nosi i `answers` — drugi korak pitanja („bi li ga
 * preporučio kolegi", čipovi „šta nije štimalo"). Spajaju se sa već upisanim
 * odgovorom i PONOVO prolaze kroz šemu iz kataloga: drugi korak ne sme da bude
 * rupa kroz koju u `answers` uđe ono što prvi korak ne bi propustio.
 */
export async function dopuniUtisak(
  userId: string,
  id: number,
  dopuna: DopunaBody,
): Promise<DopunaIshod> {
  const db = adminSupabase();
  const odRoka = new Date(Date.now() - DOPUNA_ROK_MS).toISOString();

  // Spajanje odgovora traži postojeći zapis, pa se on prvo pročita. Bez
  // `answers` u telu ovaj upit se preskače — najčešći put ostaje jedan `update`.
  let spojeni: Record<string, unknown> | null = null;

  if (dopuna.answers !== undefined) {
    const { data: stari, error: greskaCitanja } = await db
      .from("feedback")
      .select("prompt_key, answers")
      .eq("id", id)
      .eq("user_id", userId)
      .gte("created_at", odRoka)
      .maybeSingle<Pick<FeedbackRow, "prompt_key" | "answers">>();

    if (greskaCitanja) throw new Error(`Čitanje utiska nije uspelo: ${greskaCitanja.message}`);

    // Zapisa nema, tuđ je ili je prošao rok — te tri stvari razlikuje `update`
    // ispod, na jednom mestu za sve oblike dopune. Ovde se ne prejudicira.
    if (stari) {
      // Bez pitanja nema ni odgovora: `answers` uz utisak sa dugmeta nema šemu po
      // kojoj bi se proverio, a jsonb bez šeme je tačno ono što pravilo 16 brani.
      if (!stari.prompt_key) return { ok: false, razlog: "odgovor" };

      const ulaz = dopuna.answers;
      const spoj =
        typeof ulaz === "object" && ulaz !== null && !Array.isArray(ulaz)
          ? { ...stari.answers, ...(ulaz as Record<string, unknown>) }
          : null;

      if (!spoj) return { ok: false, razlog: "odgovor" };

      const ishod = proveriOdgovor(stari.prompt_key, spoj);
      if (!ishod.ok) return { ok: false, razlog: "odgovor", detalji: ishod.detalji };

      spojeni = ishod.answers;
    }
  }

  const { data, error } = await db
    .from("feedback")
    .update({
      ...(dopuna.kind !== undefined ? { kind: dopuna.kind } : {}),
      ...(dopuna.message !== undefined ? { message: dopuna.message } : {}),
      ...(spojeni ? { answers: spojeni } : {}),
      ...(dopuna.screenshot_path ? { screenshot_path: dopuna.screenshot_path } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .gte("created_at", odRoka)
    .select()
    .maybeSingle<FeedbackRow>();

  if (error) throw new Error(`Dopuna utiska nije uspela: ${error.message}`);

  if (data) {
    // Dnevnik grešaka ide uz zapis tek kad je zapis proglašen bugom — a tip se
    // bira baš u ovom koraku (F11 odluka 10). Zato se `ctx` dopunjuje ovde, a ne
    // pri nastanku: pri nastanku se još ne zna da li je ovo bug.
    if (dopuna.errors?.length && data.kind === "bug" && !data.ctx.errors) {
      const { error: greskaCtx } = await db
        .from("feedback")
        .update({ ctx: { ...data.ctx, errors: dopuna.errors } })
        .eq("id", id)
        .eq("user_id", userId);

      // Utisak je dopunjen i to je ono što se ne sme izgubiti. Bez dnevnika
      // prijava i dalje nosi poruku, ekran i uređaj.
      if (greskaCtx) console.error("[feedback] upis dnevnika grešaka:", greskaCtx.message);
      else data.ctx = { ...data.ctx, errors: dopuna.errors };
    }

    return { ok: true, red: data };
  }

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

// ── nagrada: +1 kredit za utisak sa porukom ─────────────────

/**
 * Da li je korisniku danas i ovog meseca još ostalo mesta za automatsku nagradu.
 *
 * Odvojeno od same dodele zato što se poziva i PRE nego što poruka postoji:
 * panel mora da zna hoće li uz polje za tekst stajati čip „+1 kredit" (§2.4).
 * Obećanje koje se ne ispuni je gore od nikakvog obećanja.
 *
 * Sumnja ide protiv nagrade: ako brojanje padne, čip se ne prikazuje i kredit se
 * ne dodeljuje. Nijedan utisak se pritom ne gubi.
 */
export async function nagradaDostupna(userId: string, sada = Date.now()): Promise<boolean> {
  const { data, error } = await adminSupabase()
    .from("credit_ledger")
    .select("created_at")
    .eq("user_id", userId)
    .eq("reason", "feedback")
    .eq("delta", NAGRADA_IZNOS)
    .gte("created_at", pocetakMeseca(sada))
    .returns<Pick<CreditLedgerRow, "created_at">[]>();

  if (error) {
    console.error("[feedback] provera kvote za nagradu:", error.message);
    return false;
  }

  const stavke = data ?? [];
  if (stavke.length >= NAGRADA_MESECNO) return false;

  const odDanas = pocetakDana(sada);
  const danas = stavke.filter((s) => s.created_at >= odDanas).length;
  return danas < NAGRADA_DNEVNO;
}

/**
 * Nosi li ovaj zapis poruku koja uopšte ulazi u igru za nagradu.
 *
 * Čista funkcija, bez baze: kapije se razlikuju po tome kad se proveravaju, a
 * ova se proverava i u ruti (pre odgovora korisniku) i u `after()` (pre RPC-a).
 */
export function porukaZasluzujeNagradu(red: FeedbackRow): boolean {
  if ((red.message?.trim().length ?? 0) < NAGRADA_MIN_PORUKA) return false;
  if (red.reward_credits > 0) return false;

  // Odgovor o ceni se ne nagrađuje, ni kad nosi rečenicu (odluka 8).
  const pitanje = red.prompt_key ? pitanjeZaKljuc(red.prompt_key) : null;
  return pitanje?.bezNagrade !== true;
}

/**
 * Dodela +1 kredita, kroz `grant_feedback_credits` (pravilo 3).
 *
 * Zove se iz `after()`, dakle posle odgovora korisniku. Ništa odavde ne sme da
 * baci: zapis je upisan, korisnik je odavno dobio potvrdu, a kredit koji nije
 * dodeljen je manja šteta od pale rute.
 *
 * Idempotencija je u RPC-u (`ref_id = 'fb:<id>'`), ne ovde — dvostruka dodela za
 * isti utisak je nemoguća i kad neko pozove funkciju mimo aplikacije.
 */
export async function nagradiZaPoruku(userId: string, red: FeedbackRow): Promise<void> {
  try {
    if (!porukaZasluzujeNagradu(red)) return;
    if (!(await nagradaDostupna(userId))) return;

    const { data, error } = await adminSupabase().rpc("grant_feedback_credits", {
      p_user: userId,
      p_amount: NAGRADA_IZNOS,
      p_feedback: red.id,
    });

    if (error) {
      console.error("[feedback] dodela nagrade:", error.message);
      return;
    }

    const ishod = ((data ?? []) as FeedbackGrantResult[])[0];
    if (!ishod?.ok) console.error("[feedback] nagrada odbijena:", ishod?.reason ?? "bez odgovora");
  } catch (err) {
    console.error("[feedback] dodela nagrade:", err);
  }
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
  /** Adresa aplikacije, za link na `/admin/utisci/<id>` (F11.3). */
  konzola: string | null = null,
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
      // F11: odgovor na pitanje ide u isti mejl kao i ocena (odluka 1).
      promptKey: red.prompt_key,
      answers: red.answers,
      severity: red.severity,
      screenshotPath: red.screenshot_path,
      konzola,
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
