// apps/web/src/lib/admin-utisci-radnje.ts
// Radnje nad prijavom iz `/admin/utisci` (F11 §6.6).
//
// Isti ugovor kao `admin-radnje.ts`: svaka funkcija vraća `Ishod`, a ruta ga
// provlači kroz `saAuditom()` — dakle i uspeh i pad ostavljaju red u dnevniku
// (pravilo 14). Odvojen fajl zato što `admin-radnje.ts` govori o NALOGU, a ovo
// o prijavi; jedini put do kredita im je zajednički i to je jedini razlog zbog
// kog se dodiruju.
//
// ── zamka koju ovaj fajl postoji da ne bi promašio ───────────
// `admin_adjust_credits` (0012) SAM upisuje `admin_audit`, pa ruta za korekciju
// kredita ima `bezAuditaNaUspeh: true`. **`grant_feedback_credits` (0011) to NE
// radi.** Nagrada za bug zato mora da prođe kroz `saAuditom()` bez te zastavice,
// inače je jedina izmena balansa u projektu koja nema traga
// (v. „S3 — šta se razišlo", tačka 6, i „S5", tačka 2).

import "server-only";
import type { ChangelogRow, FeedbackGrantResult, FeedbackRow } from "@sajtoskop/shared";
import type { Ishod } from "./admin-radnje";
import { ZAVRSNI_STATUSI } from "./admin-utisci";
import { NAGRADA_ZA_BUG, type UtisakPatchBody } from "./admin-utisci-schema";
import { adminSupabase } from "./supabase";

const NEMA_UTISKA: Ishod = { ok: false, status: 404, poruka: "Ta prijava ne postoji." };

/** `admin_audit.target_ref` za sve tri radnje — isti oblik kao `ref_id` u knjizi. */
function ref(id: number): string {
  return `fb:${id}`;
}

type Zatecen = Pick<
  FeedbackRow,
  | "id"
  | "user_id"
  | "kind"
  | "status"
  | "tags"
  | "admin_note"
  | "user_note"
  | "resolved_at"
  | "reward_credits"
>;

async function citajZatecen(id: number): Promise<Zatecen | null> {
  const { data, error } = await adminSupabase()
    .from("feedback")
    .select(
      "id, user_id, kind, status, tags, admin_note, user_note, resolved_at, reward_credits",
    )
    .eq("id", id)
    .maybeSingle<Zatecen>();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Čiji je ovo utisak — za `admin_audit.target_user`.
 *
 * Ruta ga čita PRE `saAuditom()`, jer se cilj upisuje u kontekst radnje a ne u
 * njen ishod. Zato ova funkcija NE BACA: kad čitanje padne, red u dnevniku
 * ostaje bez cilja umesto da radnja padne pre nego što je i pokušana. Sama
 * radnja odmah zatim naleti na istu grešku i uredno je prijavi.
 */
export async function vlasnikUtiska(id: number): Promise<string | null> {
  try {
    const { data, error } = await adminSupabase()
      .from("feedback")
      .select("user_id")
      .eq("id", id)
      .maybeSingle<{ user_id: string }>();

    if (error) throw new Error(error.message);
    return data?.user_id ?? null;
  } catch (err) {
    console.error("[admin] vlasnik utiska:", err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// STATUS, OZNAKE, BELEŠKA
// ═══════════════════════════════════════════════════════════

/**
 * Jedna izmena, do tri polja (§6.6).
 *
 * `resolved_at` se ne prima iz tela nego IZVODI iz statusa: prelazak u rešeno,
 * odbijeno ili duplikat je trenutak u kom prijava dobija ishod, a povratak u
 * otvoreno stanje ga poništava. Bez toga bi „prosek do odgovora" merio datum
 * koji je neko ukucao, a ne vreme koje je stvarno prošlo.
 *
 * Prvi upis pobeđuje: prijava koja se iz `reseno` prebaci u `duplikat` zadržava
 * originalni trenutak rešavanja, jer je obrada tada već bila završena.
 */
export async function izmeniUtisak(id: number, telo: UtisakPatchBody): Promise<Ishod> {
  const zatecen = await citajZatecen(id);
  if (!zatecen) return NEMA_UTISKA;

  const izmena: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const payload: Record<string, unknown> = {};

  if (telo.status !== undefined && telo.status !== zatecen.status) {
    izmena.status = telo.status;
    payload.status = telo.status;
    payload.status_pre = zatecen.status;

    const zavrsni = ZAVRSNI_STATUSI.includes(telo.status);
    if (zavrsni && zatecen.resolved_at === null) {
      izmena.resolved_at = new Date().toISOString();
    } else if (!zavrsni && zatecen.resolved_at !== null) {
      izmena.resolved_at = null;
    }

    // F11.4: prelazak u „rešeno" pali tačku na plutajućem dugmetu korisnika
    // („brojač tačke ide na 5" — F11 §9). Mejl stiže iz crona, tačka stoji
    // odmah: korisnik koji ne otvori mejl i dalje vidi da je nešto gotovo.
    if (telo.status === "reseno") {
      await povecajNevidjeno(zatecen.user_id);
    }
  }

  if (telo.tags !== undefined) {
    // Duplikat oznake nije greška u telu nego posledica slobodnog unosa — ovde
    // se tiho skida, jer `text[]` sa dva ista člana filtrira isto a čita se gore.
    const oznake = [...new Set(telo.tags)].sort();
    izmena.tags = oznake;
    payload.oznaka = oznake.length;
  }

  if (telo.admin_note !== undefined) {
    const beleska = telo.admin_note?.trim() || null;
    izmena.admin_note = beleska;
    // Sadržaj beleške NE ulazi u dnevnik: revizija pamti da je beleška menjana,
    // a sam tekst živi uz prijavu. Isti razlog kao kod poruke korisniku („S4").
    payload.beleska = beleska ? beleska.length : 0;
  }

  if (telo.user_note !== undefined) {
    const obrazlozenje = telo.user_note?.trim() || null;
    izmena.user_note = obrazlozenje;
    // Isto pravilo kao za belešku: dnevnik pamti dužinu, ne sadržaj. Sadržaj
    // ide korisniku kroz „Moje prijave" i mejl „rešeno".
    payload.obrazlozenje = obrazlozenje ? obrazlozenje.length : 0;
  }

  // Sve što je stiglo bilo je već upisano. Uredan ishod, ne greška — dva
  // otvorena taba nad istom prijavom su najobičnija stvar.
  if (Object.keys(payload).length === 0) {
    return { ok: true, poruka: "Ništa se nije promenilo.", ref: ref(id) };
  }

  const { error } = await adminSupabase().from("feedback").update(izmena).eq("id", id);
  if (error) throw new Error(error.message);

  return { ok: true, poruka: sazetak(payload), payload, ref: ref(id) };
}

function sazetak(payload: Record<string, unknown>): string {
  const delovi: string[] = [];
  if (typeof payload.status === "string") delovi.push(`status: ${payload.status}`);
  if (typeof payload.oznaka === "number") delovi.push(`oznaka: ${payload.oznaka}`);
  if (typeof payload.beleska === "number") {
    delovi.push(payload.beleska > 0 ? "beleška upisana" : "beleška obrisana");
  }
  if (typeof payload.obrazlozenje === "number") {
    delovi.push(payload.obrazlozenje > 0 ? "obrazloženje upisano" : "obrazloženje obrisano");
  }
  return `Sačuvano — ${delovi.join(", ")}.`;
}

/**
 * Tačka na dugmetu korisnika: `profiles.feedback_unseen_count += 1`.
 *
 * [NAMERNO BEZ TRKE] Ovo je čitanje-pa-upis, a ne `for update` — brojač je
 * kozmetika (tačka na dugmetu), ne novac, i samo se nulira pri otvaranju
 * „Moje prijave". Najgori ishod trke je tačka koja kaže 2 umesto 1, i ispravi
 * se prvim otvaranjem ekrana. Pravilo 3 nije u igri — ovo ne dira kredite.
 *
 * Ne baca: promašen upis znači tačku bez jednog, i to je sve.
 */
async function povecajNevidjeno(userId: string): Promise<void> {
  const db = adminSupabase();

  const { data, error } = await db
    .from("profiles")
    .select("feedback_unseen_count")
    .eq("id", userId)
    .maybeSingle<{ feedback_unseen_count: number }>();

  if (error || !data) {
    console.error("[admin] čitanje brojača nepročitanog:", error?.message ?? "nema profila");
    return;
  }

  const { error: greskaUpisa } = await db
    .from("profiles")
    .update({ feedback_unseen_count: data.feedback_unseen_count + 1 })
    .eq("id", userId);

  if (greskaUpisa) console.error("[admin] upis brojača nepročitanog:", greskaUpisa.message);
}

// ═══════════════════════════════════════════════════════════
// NAGRADA: +10 ZA POTVRĐEN BUG
// ═══════════════════════════════════════════════════════════

/**
 * Ručna dodela kroz `grant_feedback_credits` (pravilo 3, F11 §6.7).
 *
 * Tri kapije, tim redom:
 *   1. **ovde:** prijava mora da bude bug i mora da bude priznata
 *   2. **ovde:** ne dvaput za isti zapis (`reward_credits`)
 *   3. **u RPC-u:** mesečni plafon od 20 i idempotencija po `ref_id = 'fb:<id>'`
 *
 * Treća je jedina koja stvarno drži — prve dve su udobnost i poruka na ekranu.
 * Zato dvostruki klik ne dodeljuje 20 čak i kad dva taba prođu prve dve u istoj
 * sekundi: druga dodela u knjizi pada na jedinstvenom indeksu i izlazi kao
 * „već dodeljeno".
 *
 * ── odstupanje od §6.7, namerno ──────────────────────────────
 * PRD kao kapiju piše `status = 'priznato'`. Ovde prolazi i `u_radu` i `reseno`:
 * bug se priznaje u ponedeljak, a plati kad se popravi u sredu — sa doslovnom
 * kapijom bih morao da vratim status unazad da bih dodelio kredit, i time
 * pokvarim `resolved_at`. „Potvrđen" je smisao, `priznato` je samo prvi status
 * koji to znači.
 */
export async function nagradiBug(id: number): Promise<Ishod> {
  const zatecen = await citajZatecen(id);
  if (!zatecen) return NEMA_UTISKA;

  if (zatecen.kind !== "bug") {
    return {
      ok: false,
      status: 409,
      poruka: "Nagrada od 10 kredita ide samo za prijavu kvara. Prvo označi tip kao bug.",
      ref: ref(id),
    };
  }

  if (zatecen.status === "novo") {
    return {
      ok: false,
      status: 409,
      poruka: "Prvo priznaj bug, pa onda nagradi — nepregledana prijava nije potvrđena.",
      ref: ref(id),
    };
  }

  if (["odbijeno", "duplikat"].includes(zatecen.status)) {
    return {
      ok: false,
      status: 409,
      poruka: "Odbijena prijava i duplikat se ne nagrađuju.",
      ref: ref(id),
    };
  }

  if (zatecen.reward_credits > 0) {
    return {
      ok: true,
      poruka: `Za ovu prijavu je već dodeljeno ${zatecen.reward_credits} kredita.`,
      payload: { vec: zatecen.reward_credits },
      ref: ref(id),
    };
  }

  const { data, error } = await adminSupabase().rpc("grant_feedback_credits", {
    p_user: zatecen.user_id,
    p_amount: NAGRADA_ZA_BUG,
    p_feedback: id,
  });

  if (error) throw new Error(error.message);

  const red = ((data ?? []) as FeedbackGrantResult[])[0];
  if (!red) throw new Error("grant_feedback_credits nije vratio nijedan red.");

  if (!red.ok) {
    // „vec dodeljeno" je uspeh iz ugla balansa: kredit postoji, samo ga nije
    // dodelio ovaj klik. Ostalo je stvarno odbijanje.
    if (red.reason === "vec dodeljeno") {
      return {
        ok: true,
        poruka: "Kredit za ovu prijavu je već dodeljen. Balans se nije promenio.",
        payload: { razlog: red.reason },
        ref: ref(id),
      };
    }

    return {
      ok: false,
      status: red.reason === "mesecni plafon za utiske" ? 409 : 400,
      poruka: PORUKA_NAGRADE[red.reason] ?? red.reason,
      payload: { razlog: red.reason },
      ref: ref(id),
    };
  }

  return {
    ok: true,
    poruka: `+${red.delta} kredita je dodeljeno za potvrđen bug.`,
    payload: { delta: red.delta, korisnik: zatecen.user_id },
    ref: ref(id),
  };
}

const PORUKA_NAGRADE: Record<string, string> = {
  "iznos van granica": "Iznos je van granica — najviše 10 po prijavi.",
  "mesecni plafon za utiske":
    "Ovaj korisnik je ovog meseca dosegao plafon od 20 kredita iz utisaka.",
  invalid_reason:
    "Baza odbija razlog `feedback` u knjizi — migracija 0011 verovatno nije puštena.",
  no_user: "Nalog koji je poslao ovu prijavu više ne postoji.",
};

// ═══════════════════════════════════════════════════════════
// VEZA SA BETA DNEVNIKOM
// ═══════════════════════════════════════════════════════════

/**
 * „Poveži sa stavkom dnevnika" (§6.6) — upis u `changelog.from_feedback`.
 *
 * Zbog te veze ekran `/utisci` iz F11.4 ume da kaže „iz tvog utiska", a to je
 * jedina rečenica koja stvarno traži drugi utisak od istog čoveka (§6.5).
 *
 * Prijava pripada NAJVIŠE jednoj stavci: pre upisa se skida sa svake druge.
 * Padajući spisak u panelu je jedan izbor, pa bi višestruka veza značila stanje
 * koje se u UI-ju ne vidi i ne može da se poništi.
 *
 * Niz se čita pa upisuje, bez transakcije: `changelog` menjam samo ja, iz jednog
 * taba, i najgori ishod trke je da veza završi na obe stavke — što se sledećim
 * izborom ispravlja.
 */
export async function veziSaDnevnikom(id: number, stavka: number | null): Promise<Ishod> {
  const db = adminSupabase();

  const zatecen = await citajZatecen(id);
  if (!zatecen) return NEMA_UTISKA;

  // Sve stavke koje ovu prijavu već pominju.
  const { data: postojece, error: greskaCitanja } = await db
    .from("changelog")
    .select("id, title, from_feedback")
    .contains("from_feedback", [id])
    .returns<Pick<ChangelogRow, "id" | "title" | "from_feedback">[]>();

  if (greskaCitanja) throw new Error(greskaCitanja.message);

  for (const c of postojece ?? []) {
    if (c.id === stavka) continue;

    const { error } = await db
      .from("changelog")
      .update({ from_feedback: c.from_feedback.filter((n) => n !== id) })
      .eq("id", c.id);

    if (error) throw new Error(error.message);
  }

  if (stavka === null) {
    const skinuto = (postojece ?? []).length;
    return {
      ok: true,
      poruka: skinuto > 0 ? "Veza sa dnevnikom je skinuta." : "Prijava nije bila vezana ni za šta.",
      payload: { stavka: null, skinuto },
      ref: ref(id),
    };
  }

  const { data: cilj, error: greskaCilja } = await db
    .from("changelog")
    .select("id, title, from_feedback")
    .eq("id", stavka)
    .maybeSingle<Pick<ChangelogRow, "id" | "title" | "from_feedback">>();

  if (greskaCilja) throw new Error(greskaCilja.message);
  if (!cilj) {
    return { ok: false, status: 404, poruka: "Ta stavka dnevnika ne postoji.", ref: ref(id) };
  }

  if (cilj.from_feedback.includes(id)) {
    return {
      ok: true,
      poruka: `Prijava je već vezana sa „${cilj.title}".`,
      payload: { stavka },
      ref: ref(id),
    };
  }

  const { error } = await db
    .from("changelog")
    .update({ from_feedback: [...cilj.from_feedback, id] })
    .eq("id", stavka);

  if (error) throw new Error(error.message);

  return {
    ok: true,
    poruka: `Vezano sa „${cilj.title}".`,
    payload: { stavka, naslov: cilj.title },
    ref: ref(id),
  };
}
