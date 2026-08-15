// apps/web/src/lib/utisci.ts
// Stanje motora pitanja: čitanje za layout i tri upisa iz ruta (F11 §3).
//
// `feedback_prompts` ima RLS `using (false)` (pravilo 10), pa sve ide kroz
// `adminSupabase()`. Vlasnik reda je uvek `userId` iz verifikovane sesije —
// nikad iz tela (pravilo 8).
//
// Pravila odlučuju u `@sajtoskop/shared/feedback-motor`; ovde je samo baza. Ta
// podela je namerna: isti motor radi u pregledaču (da traka ne bljesne) i na
// serveru (da klijent koji zaobiđe motor ne dobije ništa).

import "server-only";
import {
  posleOdbacivanja,
  posleOdgovora,
  poslePrikaza,
  type FeedbackPromptRow,
  type MotorStanje,
  type Pitanje,
  type ProfileRow,
  type StanjePitanja,
  type Uslovi,
} from "@sajtoskop/shared";
import { adminSupabase } from "./supabase";

const DAN_MS = 24 * 60 * 60 * 1000;

/**
 * Stanje pitanja za jednog korisnika.
 *
 * Jedan upit po PUNOM učitavanju strane, ne po klijentskoj navigaciji: layout se
 * ne izvršava ponovo pri prelasku `/pretraga → /lista` (F11 §3.3). Gornja
 * granica je broj pitanja u katalogu, dakle ≤ 12 redova po korisniku.
 */
export async function citajStanjePitanja(
  userId: string,
): Promise<Record<string, StanjePitanja>> {
  const { data, error } = await adminSupabase()
    .from("feedback_prompts")
    .select("prompt_key, status, shown_at")
    .eq("user_id", userId);

  if (error) throw new Error(`Čitanje stanja pitanja nije uspelo: ${error.message}`);

  const stanje: Record<string, StanjePitanja> = {};
  for (const red of (data ?? []) as Pick<
    FeedbackPromptRow,
    "prompt_key" | "status" | "shown_at"
  >[]) {
    stanje[red.prompt_key] = { status: red.status, shownAt: red.shown_at };
  }

  return stanje;
}

/**
 * Celo stanje motora — profil (već pročitan u layout-u) + `feedback_prompts`.
 *
 * Pad čitanja ne sme da obori layout: bez stanja motora pitanja prosto nema, a
 * aplikacija radi. Zato se greška guta u log, a vraća se stanje koje ćuti.
 */
export async function citajStanjeMotora(
  userId: string,
  profil: ProfileRow | null,
): Promise<MotorStanje> {
  let poPitanju: Record<string, StanjePitanja> = {};

  try {
    poPitanju = await citajStanjePitanja(userId);
  } catch (err) {
    console.error("[utisci] stanje pitanja:", err);
    // Prazna mapa bi značila „nijedno pitanje nije viđeno" i pustila bi pitanje
    // koje je korisnik već odbacio. Zato se u tom slučaju ćuti do sledećeg
    // učitavanja — jedan promašen prikaz je jeftiniji od ponovljenog pitanja.
    return {
      cooldownUntil: null,
      mutedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      dismissStreak: profil?.feedback_dismiss_streak ?? 0,
      poPitanju: {},
    };
  }

  return {
    cooldownUntil: profil?.feedback_cooldown_until ?? null,
    mutedUntil: profil?.feedback_muted_until ?? null,
    dismissStreak: profil?.feedback_dismiss_streak ?? 0,
    poPitanju,
  };
}

/**
 * Stanje naloga za kampanjska pitanja (F11 §2.3).
 *
 * ── zašto ovo uopšte mora sa servera ─────────────────────────
 * „≥ 7 dana od registracije i ≥ 5 otključanih" nije događaj u aplikaciji. Nema
 * ekrana koji bi ga prijavio i nema trenutka u kom bi pukao — to je stanje koje
 * se čita. Zato ide istim putem kao i ostatak stanja motora: jednom po PUNOM
 * učitavanju, u layout-u, pa kroz `UtisciProvider` u klijent. Klijentska
 * navigacija ne košta ništa (F11 §3.3).
 *
 * ── dužina pauze: `profiles.last_seen_at` (F12, migracija 0012) ─
 * Do F12 se izvodila iz poslednje pretrage, jer te kolone nije bilo (v. „S2 —
 * šta se razišlo", tačka 3). `searches` je bio najbliži zapis o dolasku, ali ne
 * i tačan: čovek koji svakog dana otvara pipeline a ništa ne pretražuje bi po
 * njemu ispao odsutan mesecima, i dobio bi `zasto-ne-vracas` a da nikad nije ni
 * otišao.
 *
 * Sada dolazi iz profila koji je layout ionako pročitao, pa je i jedan upit
 * manje: ostaje samo broj otključanih.
 *
 * ── zašto se čita PRE nego što se upiše ──────────────────────
 * `zabeleziDolazak()` ide kroz `after()`, dakle posle odgovora. Vrednost koja se
 * ovde čita je zato uvek PRETHODNI dolazak, a to je jedino što „pauza" i znači.
 * Da se upisivalo pre renderovanja, pauza bi uvek bila nula.
 */
export async function citajUslove(userId: string, profil: ProfileRow | null): Promise<Uslovi> {
  const { count, error } = await adminSupabase()
    .from("unlocks")
    .select("place_id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) console.error("[utisci] broj otključanih:", error.message);

  const sada = Date.now();

  const nastanak = profil ? Date.parse(profil.created_at) : Number.NaN;
  const danaOdRegistracije = Number.isNaN(nastanak)
    ? 0
    : Math.floor((sada - nastanak) / DAN_MS);

  // Bez ijednog ranijeg dolaska nema ni pauze: čovek koji nikad nije bio se nije
  // ni vratio, a `zasto-ne-vracas` mu ne bi značilo ništa. Isto važi i za sve
  // koji su poslednji put bili pre nego što je kolona uvedena — njihov prvi
  // dolazak posle 0012 se broji kao početak, ne kao povratak.
  const prethodni = profil?.last_seen_at ? Date.parse(profil.last_seen_at) : Number.NaN;
  const danaPauze = Number.isNaN(prethodni)
    ? 0
    : Math.max(0, Math.floor((sada - prethodni) / DAN_MS));

  return { danaOdRegistracije, otkljucano: count ?? 0, danaPauze };
}

export type PrikazIshod = "upisano" | "vec_prikazano";

/**
 * „Pitanje je prikazano." Zove se PRI PRIKAZU, ne pri odgovoru — isto pravilo
 * koje F10 već koristi za podsetnik (F11 §3.2). Korisnik koji je pitanje video i
 * ignorisao ga ne sme da ga vidi ponovo.
 *
 * Upis pada na PK `(user_id, prompt_key)` kad red već postoji. To je i cela
 * odbrana od dva taba: drugi tab dobija `vec_prikazano`, ruta vraća 409 i traka
 * se tamo ne pojavljuje (§9).
 *
 * Pitanje sa `ponovi` (samo `posao-pao`) sme ponovo, ali tek kad prođe njegov
 * razmak. Uslov je u `where`-u, ne u kodu iznad — bez toga bi dva taba u istoj
 * sekundi oba prošla.
 */
export async function zabeleziPrikaz(userId: string, pitanje: Pitanje): Promise<PrikazIshod> {
  const db = adminSupabase();
  const sada = Date.now();

  const { error } = await db.from("feedback_prompts").insert({
    user_id: userId,
    prompt_key: pitanje.kljuc,
    status: "prikazano",
    shown_at: new Date(sada).toISOString(),
  });

  if (error) {
    // 23505 = unique_violation. Red već postoji.
    if (error.code !== "23505") {
      throw new Error(`Upis prikaza nije uspeo: ${error.message}`);
    }

    if (!pitanje.ponovi) return "vec_prikazano";

    const prag = new Date(sada - pitanje.ponovi.naSati * 60 * 60 * 1000).toISOString();

    const { data, error: greskaPonovo } = await db
      .from("feedback_prompts")
      .update({
        status: "prikazano",
        shown_at: new Date(sada).toISOString(),
        feedback_id: null,
        answered_at: null,
      })
      .eq("user_id", userId)
      .eq("prompt_key", pitanje.kljuc)
      .lt("shown_at", prag)
      .select("prompt_key");

    if (greskaPonovo) throw new Error(`Ponovljen prikaz nije uspeo: ${greskaPonovo.message}`);
    if (!data || data.length === 0) return "vec_prikazano";
  }

  await pomeriCooldown(userId, poslePrikaza(sada).cooldownUntil);
  return "upisano";
}

/**
 * Odbacivanje pitanja (`✕`).
 *
 * Idempotentno po pitanju: već odbačeno pitanje ne diže streak drugi put. Bez
 * toga bi petlja nad ovom rutom sama sebe ućutkala — i, gore, klijent koji
 * dvaput pošalje isti klik bi korisniku uzeo 14 dana.
 */
export async function zabeleziOdbacivanje(userId: string, pitanje: Pitanje): Promise<void> {
  const db = adminSupabase();

  const { data, error } = await db
    .from("feedback_prompts")
    .select("status, dismissed_count")
    .eq("user_id", userId)
    .eq("prompt_key", pitanje.kljuc)
    .maybeSingle<Pick<FeedbackPromptRow, "status" | "dismissed_count">>();

  if (error) throw new Error(`Čitanje pitanja nije uspelo: ${error.message}`);

  // Pitanje koje nije prikazano ne može da bude odbačeno. Ovo je klijent koji
  // je zaobišao motor — nema šta da se upiše i nema šta da se javi.
  if (!data || data.status !== "prikazano") return;

  const { error: greskaUpisa } = await db
    .from("feedback_prompts")
    .update({ status: "odbaceno", dismissed_count: data.dismissed_count + 1 })
    .eq("user_id", userId)
    .eq("prompt_key", pitanje.kljuc)
    .eq("status", "prikazano");

  if (greskaUpisa) throw new Error(`Upis odbacivanja nije uspeo: ${greskaUpisa.message}`);

  const profil = await citajBrojace(userId);
  const sledece = posleOdbacivanja(profil?.feedback_dismiss_streak ?? 0);

  const { error: greskaProfila } = await db
    .from("profiles")
    .update({
      feedback_dismiss_streak: sledece.dismissStreak,
      ...(sledece.mutedUntil ? { feedback_muted_until: sledece.mutedUntil } : {}),
    })
    .eq("id", userId);

  if (greskaProfila) console.error("[utisci] upis streaka:", greskaProfila.message);
}

/**
 * Odgovor: pitanje se veže sa zapisom, cooldown ide na 7 dana, streak na nulu.
 *
 * Zove se iz `POST /api/feedback`, posle upisa utiska — pitanje bez zapisa je
 * prikaz, ne odgovor.
 */
export async function zabeleziOdgovor(
  userId: string,
  kljuc: string,
  feedbackId: number,
): Promise<void> {
  const db = adminSupabase();
  const sada = Date.now();

  const { error } = await db
    .from("feedback_prompts")
    .upsert(
      {
        user_id: userId,
        prompt_key: kljuc,
        status: "odgovoreno",
        answered_at: new Date(sada).toISOString(),
        feedback_id: feedbackId,
      },
      { onConflict: "user_id,prompt_key" },
    );

  if (error) throw new Error(`Upis odgovora nije uspeo: ${error.message}`);

  const sledece = posleOdgovora(sada);

  const { error: greskaProfila } = await db
    .from("profiles")
    .update({
      feedback_cooldown_until: sledece.cooldownUntil,
      feedback_dismiss_streak: sledece.dismissStreak,
    })
    .eq("id", userId);

  // Utisak je upisan i to je ono što se ne sme izgubiti. Promašen cooldown znači
  // najviše jedno pitanje ranije nego što je trebalo.
  if (greskaProfila) console.error("[utisci] upis cooldowna:", greskaProfila.message);
}

// ── pomoćno ──────────────────────────────────────────────────

async function citajBrojace(
  userId: string,
): Promise<Pick<ProfileRow, "feedback_dismiss_streak"> | null> {
  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("feedback_dismiss_streak")
    .eq("id", userId)
    .maybeSingle<Pick<ProfileRow, "feedback_dismiss_streak">>();

  if (error) {
    console.error("[utisci] čitanje brojača:", error.message);
    return null;
  }

  return data;
}

/**
 * Cooldown se pomera samo unapred.
 *
 * `posao-pao` sme preko cooldowna, pa bi njegov prikaz inače mogao da SKRATI
 * ćutanje koje je odgovor na drugo pitanje već zaradio.
 *
 * Ovo je direktan `update` nad `profiles`, ali ne dira `credits_balance`, pa
 * pravilo 3 nije u igri.
 */
async function pomeriCooldown(userId: string, doKada: string): Promise<void> {
  const db = adminSupabase();

  const { data, error } = await db
    .from("profiles")
    .select("feedback_cooldown_until")
    .eq("id", userId)
    .maybeSingle<Pick<ProfileRow, "feedback_cooldown_until">>();

  if (error) {
    console.error("[utisci] čitanje cooldowna:", error.message);
    return;
  }

  const sadasnji = data?.feedback_cooldown_until;
  if (sadasnji && Date.parse(sadasnji) >= Date.parse(doKada)) return;

  const { error: greskaUpisa } = await db
    .from("profiles")
    .update({ feedback_cooldown_until: doKada })
    .eq("id", userId);

  if (greskaUpisa) console.error("[utisci] upis cooldowna:", greskaUpisa.message);
}
