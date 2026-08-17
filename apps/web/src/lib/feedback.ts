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
 *
 * [Faza 1, 1.6] Celo čitanje + upis je u JEDNOM RPC-u (`zabelezi_utisak`,
 * migracija 0018): `for update` nad profilom serijalizuje paralelne POST-ove,
 * pa dnevni plafon (N3) ne može da se probije — stara verzija je brojala pa
 * upisivala, i dva paralelna zahteva su mogla oba da prođu.
 */
export async function zabeleziUtisak(userId: string, ulaz: UtisakUlaz): Promise<UtisakIshod> {
  const db = adminSupabase();

  // Dnevnik grešaka ide samo uz bug (F11 odluka 10). RPC istu proveru ponavlja
  // nad `p_kind` — ovo je samo da ne šaljemo šta se ionako neće upisati.
  const dnevnik = ulaz.kind === "bug" ? (ulaz.errors ?? null) : null;

  const { data, error } = await db.rpc("zabelezi_utisak", {
    p_user: userId,
    p_rating: ulaz.rating,
    p_source: ulaz.source,
    p_route: ulaz.route,
    // Jedan izvor istine za naziv ekrana — isti onaj koji stoji u gornjoj traci.
    p_route_label: ulaz.route ? naslovZaPutanju(ulaz.route) : null,
    p_ua: ulaz.ua,
    p_viewport: ulaz.viewport,
    p_prompt_key: ulaz.promptKey ?? null,
    p_answers: ulaz.answers ?? null,
    p_kind: ulaz.kind ?? null,
    p_severity: ulaz.severity ?? null,
    p_errors: dnevnik,
    p_screenshot: ulaz.screenshotPath ?? null,
    p_dnevni_plafon: UPIS_DNEVNI_PLAFON,
    p_mejl_limit: MEJL_DNEVNI_LIMIT,
  });

  if (error) throw new Error(`Upis utiska nije uspeo: ${error.message}`);

  const ishod = ((data ?? []) as { ishod: string; posalji_mejl: boolean; red: unknown }[])[0];
  if (!ishod) throw new Error("zabelezi_utisak nije vratio red.");

  if (ishod.ishod === "no_user") return { ishod: "no_user" };
  if (ishod.ishod === "plafon") return { ishod: "plafon" };

  return { ishod: "upisan", red: ishod.red as FeedbackRow, posaljiMejl: ishod.posalji_mejl };
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
 *
 * [Faza 1, 1.6] Upis je jedan RPC (`dopuni_utisak`, migracija 0018) sa
 * `for update` nad redom i CAS poređenjem `answers`: dva paralelna PATCH-a se
 * serijalizuju na bravi, a onaj koji je spoj zasnovao na starom stanju dobija
 * 'stale' i ponavlja sa svežim (N4). Validaciju i dalje radi Zod — SQL nema
 * katalog — pa je CAS jedina tačka koja čuva red od izgubljenog upisa.
 */
export async function dopuniUtisak(
  userId: string,
  id: number,
  dopuna: DopunaBody,
): Promise<DopunaIshod> {
  const db = adminSupabase();
  const odRoka = new Date(Date.now() - DOPUNA_ROK_MS).toISOString();

  // Prvo čitanje je samo ulaz u spajanje odgovora; sam upis je RPC ispod, pa
  // se „nema"/„kasno" razlikuju na jednom mestu. Bez `answers` u telu se ovo
  // preskače — najčešći put ostaje jedan poziv.
  let ocekivani: Record<string, unknown> | null = null;
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

      ocekivani = stari.answers;
      spojeni = ishod.answers;
    }
  }

  // CAS petlja: najviše 3 pokušaja. 'stale' se javlja samo kad neko drugi
  // upiše između našeg čitanja i brave — tada se ponavlja sa svežim stanjem.
  for (let pokusaj = 1; pokusaj <= 3; pokusaj++) {
    const { data, error } = await db.rpc("dopuni_utisak", {
      p_id: id,
      p_user: userId,
      p_expected: ocekivani,
      p_answers: spojeni,
      p_kind: dopuna.kind ?? null,
      p_message: dopuna.message ?? null,
      p_screenshot: dopuna.screenshot_path ?? null,
      p_errors: dopuna.errors ?? null,
    });

    if (error) throw new Error(`Dopuna utiska nije uspela: ${error.message}`);

    const ishod = ((data ?? []) as { ok: boolean; reason: string; red: unknown }[])[0];
    if (!ishod) throw new Error("dopuni_utisak nije vratio red.");

    if (!ishod.ok && ishod.reason === "stale" && dopuna.answers !== undefined) {
      // Sveže stanje: ponovo pročitaj, spoji, validiraj, pa pokušaj ponovo.
      const { data: sveze, error: greskaCitanja } = await db
        .from("feedback")
        .select("prompt_key, answers")
        .eq("id", id)
        .eq("user_id", userId)
        .gte("created_at", odRoka)
        .maybeSingle<Pick<FeedbackRow, "prompt_key" | "answers">>();

      if (greskaCitanja) throw new Error(`Čitanje utiska nije uspelo: ${greskaCitanja.message}`);

      if (!sveze) return { ok: false, razlog: "nema" };
      if (!sveze.prompt_key) return { ok: false, razlog: "odgovor" };

      const ulaz = dopuna.answers;
      const spoj =
        typeof ulaz === "object" && ulaz !== null && !Array.isArray(ulaz)
          ? { ...sveze.answers, ...(ulaz as Record<string, unknown>) }
          : null;
      if (!spoj) return { ok: false, razlog: "odgovor" };

      const ishodSveze = proveriOdgovor(sveze.prompt_key, spoj);
      if (!ishodSveze.ok) return { ok: false, razlog: "odgovor", detalji: ishodSveze.detalji };

      ocekivani = sveze.answers;
      spojeni = ishodSveze.answers;
      continue;
    }

    if (!ishod.ok) {
      // 'nema' | 'kasno' (i 'odgovor' ako ikad stigne iz baze) — isti odgovor
      // kao pre RPC-a, sada iz jednog poziva.
      return ishod.reason === "kasno"
        ? { ok: false, razlog: "kasno" }
        : ishod.reason === "odgovor"
          ? { ok: false, razlog: "odgovor" }
          : { ok: false, razlog: "nema" };
    }

    return { ok: true, red: ishod.red as FeedbackRow };
  }

  // Tri 'stale' pokušaja — neko aktivno piše u isti red. Ovo je greška rada,
  // ne stanje koje korisnik razume: ruta vraća 500 i ništa se ne gubi.
  throw new Error(`dopuni_utisak: previše konkurentnih izmena (${id})`);
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
