// apps/web/src/lib/utisci-izvestaj.ts
// Dnevni digest i nedeljni izveštaj (F11 §7).
//
// Oba mejla idu MENI i oba idu kroz `lib/mail.ts` — tajmaut, čišćenje ključa iz
// greške i provera adrese su tamo, ne ovde (i ne kroz nov `fetch`).
//
// ── zašto digest uopšte postoji ──────────────────────────────
// Odluka 11: instant stiže samo ono što gori (bug, ocena 1, incident). Sve
// ostalo čeka 21:00 i staje u jedan mejl, jedan red po utisku. Inboks u koji
// stiže 40 mejlova mesečno se čita; onaj u koji stiže 200 se filtrira u fasciklu
// i tamo umre — a tada ni instant mejl više ne znači ništa.
//
// ── šta je „poslato" ─────────────────────────────────────────
// `emailed_at`. Isto polje koje puni i instant mejl, pa je „šta još nije otišlo"
// jedan uslov, a ne dva stanja koja se raziđu. Zapis ulazi u digest i kad mu je
// `email_error` popunjen (preko dnevnog limita, pao Resend) — jedan red u
// dnevnom mejlu ne davi inboks, a izgubljen utisak je izgubljen podatak.

import "server-only";
import {
  medijanaCene,
  opisOdgovora,
  pitanjeZaKljuc,
  PRAG_CENE_RSD,
  type FeedbackRow,
  type FeedbackSource,
} from "@sajtoskop/shared";
import { citajPregled } from "./admin-pregled";
import { SLOJ_UTISKA } from "./admin-utisci-schema";
import { feedbackMailEnv } from "./env";
import { escapeHtml, posaljiMejl } from "./mail";
import { adminSupabase } from "./supabase";
import { formatDatumKratko } from "./ui-tekst";

/**
 * Koliko unazad digest gleda.
 *
 * Duže od jednog dana, jer cron ume da ne odradi jedan termin (deploy, pad
 * regiona) — a utisak koji je promašio svoj digest ne sme da promaši i sve
 * sledeće. Kraće od nedelje, jer digest nije arhiva: sve starije se čita na
 * `/admin/utisci`, gde ionako i pripada.
 */
const DIGEST_PROZOR_MS = 48 * 60 * 60 * 1000;

/** Gornja granica po mejlu. Preko ovoga digest prestaje da bude čitljiv. */
const DIGEST_PLAFON = 150;

/** Ispod ovoliko odgovora medijana cene nije dokaz nego signal (F11 §10). */
export const UZORAK_ZA_MEDIJANU = 12;

const rsd = new Intl.NumberFormat("sr-Latn-RS");

export type DigestIshod = {
  poslato: number;
  /** Rečenica za odgovor rute — „prazan dan", „Resend nije odgovorio". */
  razlog: string | null;
};

// ═══════════════════════════════════════════════════════════
// DNEVNI DIGEST — 21:00
// ═══════════════════════════════════════════════════════════

/**
 * Sve što od poslednjeg puta nije otišlo, u jednom mejlu.
 *
 * `osnova` je adresa aplikacije kako je vidi pregledač — ide u link na
 * `/admin/utisci/<id>`. **Potpisan URL slike ovde ne postoji** (§4): potpis živi
 * 10 minuta, a mejl zauvek. Mejl nosi samo putanju i link na ekran, gde se
 * potpis pravi u trenutku otvaranja.
 *
 * Prazan dan ne šalje ništa i ne ostavlja red u dnevniku: cron koji svakog dana
 * upiše „nije bilo posla" je cron koji zatrpa reviziju.
 */
export async function posaljiDigest(osnova: string, sada = Date.now()): Promise<DigestIshod> {
  const db = adminSupabase();
  const od = new Date(sada - DIGEST_PROZOR_MS).toISOString();

  const { data, error } = await db
    .from("feedback")
    .select("*")
    .is("emailed_at", null)
    .gte("created_at", od)
    .order("created_at", { ascending: true })
    .limit(DIGEST_PLAFON)
    .returns<FeedbackRow[]>();

  if (error) throw new Error(`Čitanje utisaka za digest nije uspelo: ${error.message}`);

  const redovi = data ?? [];
  if (redovi.length === 0) return { poslato: 0, razlog: "prazan dan" };

  const podesavanje = feedbackMailEnv();
  if (!podesavanje.ok) return { poslato: 0, razlog: podesavanje.razlog };

  const mejlovi = await mejloviZa(redovi.map((r) => r.user_id));

  const ishod = await posaljiMejl({
    za: [podesavanje.env.FEEDBACK_EMAIL_TO],
    subject: `Utisci dana · ${redovi.length} ${redovi.length === 1 ? "zapis" : "zapisa"}`,
    text: digestTekst(redovi, mejlovi, osnova),
    html: digestHtml(redovi, mejlovi, osnova),
  });

  if (!ishod.ok) return { poslato: 0, razlog: ishod.greska };

  // Tek posle uspešnog slanja. Obrnut redosled bi značio da jedan pad Resend-a
  // trajno sakrije zapise iz svih narednih digesta.
  const { error: greskaUpisa } = await db
    .from("feedback")
    .update({ emailed_at: new Date(sada).toISOString(), email_error: null })
    .in("id", redovi.map((r) => r.id));

  if (greskaUpisa) {
    // Mejl je otišao. Neuspeh ovde znači da će sutrašnji digest poslati isto
    // ponovo — neprijatno, ali bezopasno, i zato ne baca.
    console.error("[digest] upis emailed_at:", greskaUpisa.message);
    return { poslato: redovi.length, razlog: "mejl je otišao, ali oznaka nije upisana" };
  }

  return { poslato: redovi.length, razlog: null };
}

/** Mejlovi za sve autore iz digesta — jednim upitom, nikad po redu. */
async function mejloviZa(ids: string[]): Promise<Map<string, string>> {
  const poId = new Map<string, string>();
  const jedinstveni = [...new Set(ids)];
  if (jedinstveni.length === 0) return poId;

  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("id, email")
    .in("id", jedinstveni)
    .returns<{ id: string; email: string | null }[]>();

  if (error) {
    console.error("[digest] mejlovi autora:", error.message);
    return poId;
  }

  for (const p of data ?? []) if (p.email) poId.set(p.id, p.email);
  return poId;
}

/** Grupisanje po sloju (§7: „Grupisan po sloju, jedan red po utisku"). */
function poSlojevima(redovi: FeedbackRow[]): [FeedbackSource, FeedbackRow[]][] {
  const redosled: FeedbackSource[] = ["incident", "pitanje", "kampanja", "dugme", "podsetnik"];
  const grupe = new Map<FeedbackSource, FeedbackRow[]>();

  for (const r of redovi) {
    const g = grupe.get(r.source);
    if (g) g.push(r);
    else grupe.set(r.source, [r]);
  }

  return redosled
    .filter((s) => grupe.has(s))
    .map((s) => [s, grupe.get(s) ?? []] as [FeedbackSource, FeedbackRow[]]);
}

const OCENA: Record<1 | 2 | 3, string> = { 1: "loše", 2: "ok", 3: "odlično" };

/** Jedan red digesta: šta je rečeno, ko je rekao i gde. */
function sadrzaj(r: FeedbackRow): string {
  const delovi: string[] = [];

  if (r.rating !== null) delovi.push(OCENA[r.rating]);

  if (r.prompt_key) {
    const pitanje = pitanjeZaKljuc(r.prompt_key);
    delovi.push(
      pitanje ? `${r.prompt_key}: ${opisOdgovora(pitanje, r.answers)}` : `${r.prompt_key}: ?`,
    );
  }

  if (r.kind) delovi.push(r.kind);

  const poruka = r.message?.trim().replace(/\s+/g, " ");
  if (poruka) delovi.push(poruka.length > 140 ? `„${poruka.slice(0, 140)}…"` : `„${poruka}"`);

  if (r.screenshot_path) delovi.push("[slika]");

  return delovi.join(" · ") || "—";
}

function sat(iso: string): string {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function veza(osnova: string, id: number): string {
  return `${osnova}/admin/utisci/${id}`;
}

function digestTekst(
  redovi: FeedbackRow[],
  mejlovi: Map<string, string>,
  osnova: string,
): string {
  const blokovi = poSlojevima(redovi).map(([sloj, grupa]) =>
    [
      `${SLOJ_UTISKA[sloj].toUpperCase()} (${grupa.length})`,
      ...grupa.map((r) =>
        [
          `  #${r.id}  ${sat(r.created_at)}  ${mejlovi.get(r.user_id) ?? r.user_id}`,
          `         ${sadrzaj(r)}`,
          `         ${r.route_label ?? r.route ?? "nepoznat ekran"} · ${veza(osnova, r.id)}`,
        ].join("\n"),
      ),
    ].join("\n"),
  );

  return [
    `${redovi.length} ${redovi.length === 1 ? "utisak" : "utisaka"} od poslednjeg digesta.`,
    "Ono što gori (bug, ocena 1, incident) je stiglo odmah i ovde se ne ponavlja.",
    "",
    ...blokovi.flatMap((b) => [b, ""]),
    `Sve prijave: ${osnova}/admin/utisci`,
  ].join("\n");
}

function digestHtml(
  redovi: FeedbackRow[],
  mejlovi: Map<string, string>,
  osnova: string,
): string {
  const blokovi = poSlojevima(redovi).map(([sloj, grupa]) =>
    [
      `<p style="margin:22px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6c757f">${escapeHtml(SLOJ_UTISKA[sloj])} (${grupa.length})</p>`,
      ...grupa.map(
        (r) =>
          `<div style="padding:8px 0;border-top:1px solid #e6e8ea">` +
          `<div style="font-size:12px;color:#6c757f">` +
          `<a href="${escapeHtml(veza(osnova, r.id))}" style="color:#0a0b0c;text-decoration:none;font-weight:600">#${r.id}</a>` +
          ` · ${escapeHtml(sat(r.created_at))} · ${escapeHtml(mejlovi.get(r.user_id) ?? r.user_id)}` +
          ` · ${escapeHtml(r.route_label ?? r.route ?? "nepoznat ekran")}</div>` +
          `<div style="white-space:pre-wrap">${escapeHtml(sadrzaj(r))}</div>` +
          `</div>`,
      ),
    ].join(""),
  );

  return [
    `<div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a0b0c;max-width:640px">`,
    `<p style="margin:0">${redovi.length} ${redovi.length === 1 ? "utisak" : "utisaka"} od poslednjeg digesta. Ono što gori je stiglo odmah i ovde se ne ponavlja.</p>`,
    ...blokovi,
    `<p style="margin:24px 0 0;font-size:13px"><a href="${escapeHtml(`${osnova}/admin/utisci`)}" style="color:#6c757f">Sve prijave →</a></p>`,
    `</div>`,
  ].join("");
}

// ═══════════════════════════════════════════════════════════
// KORISNIKU: „REŠENO JE ONO ŠTO SI PRIJAVIO" (F11 §7, §9)
// ═══════════════════════════════════════════════════════════
// Jedini odlazni mejl prema spolja pored pozivnica i poruke iz konzole — i
// jedini koji nije vezan za radnju admina nego za ishod prijave. Zato nema
// odjave: nije marketinški, vezan je za ono što je korisnik sam pokrenuo
// (§7, poslednji pasus).
//
// „Najviše 1× dnevno po korisniku" i „jedan mejl za 5 prijava" se NE mogu
// ispuniti u trenutku klika u `/admin/utisci` — zato ovo živi u cron ruti,
// koja i ionako ide jednom dnevno (uz digest).
//
// Pad Resend-a: `notified_at` ostaje `null`, sledeći prolaz pokušava ponovo,
// najviše 3 puta (`notify_attempts`). Posle toga kanal je tačka na dugmetu —
// ona ne zavisi od mejla (F11 §9, poslednji red).

export type ResenoIshod = {
  /** Koliko je prijava dobilo mejl. */
  poslato: number;
  /** Koliko je prijava promašilo mejl (nema adrese, pao Resend). */
  preskoceno: number;
};

/** Gornja granica po jednom prolazu — 100 korisnika je daleko iznad bete. */
const RESENO_PLAFON = 100;
/** Posle ovoliko pokušaja mejl se napušta (F11 §9). */
const RESENO_MAX_POKUSAJA = 3;

export async function posaljiResenoObavestenja(
  osnova: string,
  sada = Date.now(),
): Promise<ResenoIshod> {
  const db = adminSupabase();

  const { data, error } = await db
    .from("feedback")
    .select("*")
    .eq("status", "reseno")
    .is("notified_at", null)
    .lt("notify_attempts", RESENO_MAX_POKUSAJA)
    .order("created_at", { ascending: true })
    .limit(RESENO_PLAFON * 10)
    .returns<FeedbackRow[]>();

  if (error) throw new Error(`Čitanje rešenih prijava nije uspelo: ${error.message}`);

  const redovi = data ?? [];
  if (redovi.length === 0) return { poslato: 0, preskoceno: 0 };

  const mejlovi = await mejloviZa(redovi.map((r) => r.user_id));

  const poKorisniku = new Map<string, FeedbackRow[]>();
  for (const r of redovi) {
    const grupa = poKorisniku.get(r.user_id);
    if (grupa) grupa.push(r);
    else poKorisniku.set(r.user_id, [r]);
  }

  let poslato = 0;
  let preskoceno = 0;

  // Grupe u nizove, pa serijski u grupicama od 5: 100 korisnika × Resend poziv
  // ne sme da jede ceo prozor cron funkcije (maxDuration 60 s).
  const grupe = [...poKorisniku.entries()];
  for (let od = 0; od < grupe.length; od += 5) {
    await Promise.all(
      grupe.slice(od, od + 5).map(async ([userId, stavke]) => {
        const email = mejlovi.get(userId);

        // Bez adrese mejl ne može da stigne; tačka na dugmetu je kanal. Pokušaj
        // se broji da red ne bi ostao u upitu zauvek — 3 prolaza i ispada.
        if (!email) {
          await oznaciPokusaj(stavke, RESENO_MAX_POKUSAJA);
          preskoceno += stavke.length;
          return;
        }

        const ishod = await posaljiMejl({
          za: [email],
          subject:
            stavke.length === 1
              ? "Sajtoskop — rešeno je ono što si prijavio"
              : `Sajtoskop — rešeno je ${stavke.length} onoga što si prijavio`,
          text: resenoTekst(stavke, osnova),
          html: resenoHtml(stavke, osnova),
          replyTo: adresaZaOdgovor(),
        });

        if (ishod.ok) {
          await oznaciPoslato(stavke, sada);
          poslato += stavke.length;
        } else {
          await oznaciPokusaj(stavke, 1);
          preskoceno += stavke.length;
        }
      }),
    );
  }

  return { poslato, preskoceno };
}

/** Adresa na koju stižu odgovori — ista ona na koju stižu i utisci. */
function adresaZaOdgovor(): string | null {
  const p = feedbackMailEnv();
  return p.ok ? p.env.FEEDBACK_EMAIL_TO : null;
}

function resenoTekst(stavke: FeedbackRow[], osnova: string): string {
  const redovi = stavke.map((r) => {
    const naslov = r.user_note
      ? `  Obrazloženje: ${r.user_note}`
      : "  Vidi detalje u aplikaciji.";
    return `• ${formatDatumKratko(r.created_at)} — „${sadrzaj(r)}"\n${naslov}`;
  });

  return [
    "Pozdrav!",
    "",
    `Rešio sam ono što si prijavio (${stavke.length} ${stavke.length === 1 ? "prijava" : "prijave"}):`,
    "",
    ...redovi,
    "",
    "Sve svoje prijave:",
    `${osnova}/utisci`,
    "",
    "Marko · Sajtoskop",
  ].join("\n");
}

function resenoHtml(stavke: FeedbackRow[], osnova: string): string {
  const redovi = stavke.map(
    (r) =>
      `<div style="padding:8px 0;border-top:1px solid #e6e8ea">` +
      `<div style="font-size:12px;color:#6c757f">${escapeHtml(formatDatumKratko(r.created_at))}</div>` +
      `<div style="margin-top:2px">„${escapeHtml(sadrzaj(r))}"</div>` +
      (r.user_note
        ? `<div style="margin-top:4px;font-size:13px">${escapeHtml(r.user_note)}</div>`
        : "") +
      `</div>`,
  );

  return [
    `<div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a0b0c;max-width:640px">`,
    `<p style="margin:0">Pozdrav! Rešio sam ono što si prijavio (${stavke.length} ${stavke.length === 1 ? "prijava" : "prijave"}):</p>`,
    ...redovi,
    `<p style="margin:20px 0 0"><a href="${escapeHtml(`${osnova}/utisci`)}" style="color:#4e7c0a">Sve svoje prijave →</a></p>`,
    `<p style="margin:24px 0 0;font-size:12px;color:#6c757f">Marko · Sajtoskop</p>`,
    `</div>`,
  ].join("");
}

async function oznaciPoslato(stavke: FeedbackRow[], sada: number): Promise<void> {
  const { error } = await adminSupabase()
    .from("feedback")
    .update({ notified_at: new Date(sada).toISOString() })
    .in("id", stavke.map((r) => r.id));

  if (error) {
    // Mejl je otišao. Neuspeh ovde znači da će sutrašnji prolaz poslati isto
    // ponovo — neprijatno, ali bezopasno, i zato ne baca.
    console.error("[reseno] upis notified_at:", error.message);
  }
}

/** Broji pokušaj — `koliko` je 1 za pad Resend-a, maksimum za nema-adresu. */
async function oznaciPokusaj(stavke: FeedbackRow[], koliko: number): Promise<void> {
  const { error } = await adminSupabase()
    .from("feedback")
    .update({ notify_attempts: stavke[0]!.notify_attempts + koliko })
    .in("id", stavke.map((r) => r.id));

  if (error) console.error("[reseno] upis pokušaja:", error.message);
}

// ═══════════════════════════════════════════════════════════
// NEDELJNI IZVEŠTAJ — ponedeljak, 09:00
// ═══════════════════════════════════════════════════════════

export type IzvestajIshod = { ok: boolean; razlog: string | null };

/**
 * Funnel po pitanju, medijane i ono što ćuti (§7).
 *
 * Sve brojke dolaze iz `admin_overview` — istog poziva koji puni `/admin` i
 * `/admin/utisci`. Izveštaj koji sam broji bi za mesec dana tvrdio drugu brojku
 * od ekrana, i onda nijedna ne bi značila ništa.
 *
 * Medijana se NE računa ovde: `medijanaCene()` iz `feedback-katalog.ts` je
 * jedini izvor istine, jer su sredine opsega tamo gde i sami opsezi.
 */
export async function posaljiNedeljniIzvestaj(
  osnova: string,
  sada = Date.now(),
): Promise<IzvestajIshod> {
  const podesavanje = feedbackMailEnv();
  if (!podesavanje.ok) return { ok: false, razlog: podesavanje.razlog };

  const [pregled, cute, teza] = await Promise.all([
    citajPregled(),
    citajOneKojiCute(),
    citajTezu(),
  ]);

  const medijana = pregled.medijana;
  const uzorak = pregled.medijanaUzorak;

  const datum = new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(sada));

  const linije = izvestajLinije(pregled, cute, medijana, uzorak, teza, osnova);

  const ishod = await posaljiMejl({
    za: [podesavanje.env.FEEDBACK_EMAIL_TO],
    subject: `Utisci — nedeljni izveštaj (${datum})`,
    text: linije.join("\n"),
    html:
      `<div style="font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a0b0c;max-width:640px">` +
      `<pre style="margin:0;white-space:pre-wrap;font:inherit">${escapeHtml(linije.join("\n"))}</pre>` +
      `</div>`,
  });

  return ishod.ok ? { ok: true, razlog: null } : { ok: false, razlog: ishod.greska };
}

type Pregled = Awaited<ReturnType<typeof citajPregled>>;

function izvestajLinije(
  p: Pregled,
  cute: { email: string | null; id: string }[],
  medijana: number | null,
  uzorak: number,
  teza: Teza,
  osnova: string,
): string[] {
  const pitanja = p.utisci.po_pitanju;
  const zbir = p.utisci.pitanja;

  const procenat = (deo: number, celo: number) =>
    celo > 0 ? `${Math.round((deo / celo) * 100)} %` : "—";

  const redPitanja = pitanja.map((q) => {
    const naslov = pitanjeZaKljuc(q.kljuc)?.naslov ?? "(nije više u katalogu)";
    return [
      `  ${q.kljuc.padEnd(20)} ${String(q.prikazano).padStart(4)} prikazano · ` +
        `${String(q.odgovoreno).padStart(3)} odgovoreno (${procenat(q.odgovoreno, q.prikazano)}) · ` +
        `${String(q.odbaceno).padStart(3)} odbačeno`,
      `  ${" ".repeat(20)} ${naslov}`,
    ].join("\n");
  });

  return [
    "NEDELJNI IZVEŠTAJ — UTISCI",
    "",
    "FUNNEL PO PITANJU",
    ...(redPitanja.length > 0 ? redPitanja : ["  Nijedno pitanje još nije prikazano."]),
    "",
    `  Ukupno: ${zbir.prikazano} prikazano · ${zbir.odgovoreno} odgovoreno ` +
      `(${procenat(zbir.odgovoreno, zbir.prikazano)}) · ${zbir.odbaceno} odbačeno ` +
      `(${procenat(zbir.odbaceno, zbir.prikazano)})`,
    "  Cilj iz F11 §10: odgovorenost ≥ 40 %, odbacivanje < 25 %.",
    "",
    "MEDIJANA CENE",
    medijana === null
      ? "  Nijedan odgovor na pitanje o ceni."
      : `  ${rsd.format(medijana)} RSD mesečno, iz ${uzorak} ${uzorak === 1 ? "odgovora" : "odgovora"}.` +
        `  (prag iz 00-kontekst §2: ${rsd.format(PRAG_CENE_RSD)} RSD)`,
    // Rečenica koja mora da stoji SVAKI put (§10). Za tri meseca ne sme da
    // ispadne da je 1.900 RSD bila „istraženo utvrđena cena".
    uzorak < UZORAK_ZA_MEDIJANU
      ? `  Medijana iz manje od ${UZORAK_ZA_MEDIJANU} odgovora nije dokaz nego signal.`
      : `  I sa ${uzorak} odgovora ovo je signal, ne dokaz — uzorak je cela beta.`,
    "",
    "PRIJAVE",
    `  Ukupno ${p.utisci.ukupno} · novih 7 dana ${p.utisci.novih_7d} · ` +
      `nedirnuto ${p.utisci.nedirnuto}`,
    `  Otvorenih bugova: ${p.utisci.otvoreni_bugovi}`,
    "",
    "OBRADA",
    p.utisci.obrada.reseno > 0
      ? `  Prosek do odgovora: ${trajanjeReci(p.utisci.obrada.prosek_sec)} ` +
        `(iz ${p.utisci.obrada.reseno} rešenih)`
      : "  Nijedna prijava još nije dobila ishod.",
    p.utisci.obrada.nereseno > 0
      ? `  Nerešenih ${p.utisci.obrada.nereseno}, najstarija čeka ` +
        `${trajanjeReci(p.utisci.obrada.nereseno_najstarije_sec)}.`
      : "  Nema nerešenih.",
    "",
    "KO ĆUTI",
    `  Aktivnih 30 dana: ${p.korisnici.aktivni_30d} od ${p.korisnici.ukupno}.`,
    cute.length === 0
      ? "  Svi aktivni su se bar jednom javili."
      : `  Bez ijednog utiska, a bili su tu u poslednjih 30 dana (${cute.length}):`,
    ...cute.slice(0, 20).map((k) => `    ${k.email ?? k.id}`),
    ...(cute.length > 20 ? [`    …i još ${cute.length - 20}`] : []),
    "",
    "PETLJA — DA LI SE VRATE (F11 §10, poslednji red)",
    ...redoviTeze(teza),
    "",
    `Sve prijave: ${osnova}/admin/utisci`,
    `Pregled sistema: ${osnova}/admin`,
  ];
}

/** Jedna stopa: udeo korisnika sa bar dva utiska. */
function stopaDva(skup: { broj: number }[]): string {
  if (skup.length === 0) return "—";
  const dva = skup.filter((k) => k.broj >= 2).length;
  return `${dva} od ${skup.length} (${Math.round((dva / skup.length) * 100)} %)`;
}

function redoviTeze(t: Teza): string[] {
  const video = stopaDva(t.video);
  const nije = stopaDva(t.nije);

  const linije = [
    `  Videli „rešeno":   ${video}`,
    `  Nisu videli:       ${nije}`,
  ];

  if (t.video.length === 0 || t.nije.length === 0) {
    linije.push("  Uzorak je još premali za zaključak.");
  } else {
    const procenat = (skup: { broj: number }[]) => {
      if (skup.length === 0) return 0;
      return (skup.filter((k) => k.broj >= 2).length / skup.length) * 100;
    };
    const razlika = procenat(t.video) - procenat(t.nije);

    // F11 §10, doslovno: ako ljudi koji su videli „rešeno" ne šalju drugi utisak
    // češće — mehanika ne radi i to se piše u izveštaju.
    if (razlika < 10) {
      linije.push(
        `  Razlika je ${razlika >= 0 ? "+" : ""}${Math.round(razlika)} pp — mehanika petlje za sada NE radi (F11 §10).`,
      );
    } else {
      linije.push(
        `  Razlika je +${Math.round(razlika)} pp u korist onih koji su videli ishod — petlja radi.`,
      );
    }
  }

  return linije;
}

export type Teza = {
  /** Korisnici koji su videli ishod (seen_at na rešenom/odbijenom/duplikatu). */
  video: { broj: number }[];
  /** Korisnici koji ishod nikad nisu videli. */
  nije: { broj: number }[];
};

/**
 * Test cele teze o zatvaranju petlje (F11 §10, poslednji red).
 *
 * Porede se dve kohorte korisnika sa bar jednim utiskom: oni koji su videli
 * ishod („rešeno") i oni koji nisu. Metrika je udeo onih koji su poslali DRUGI
 * utisak. Ako nema razlike — mehanika ne radi, i izveštaj to kaže naglas.
 *
 * Jedan upit nad `feedback`-om; kohorte se dele u memoriji. Pad upita vraća
 * prazne kohorte — izveštaj tada kaže „uzorak je premali", ne pada.
 */
async function citajTezu(): Promise<Teza> {
  const { data, error } = await adminSupabase()
    .from("feedback")
    .select("user_id, status, seen_at")
    .limit(5000)
    .returns<{ user_id: string; status: string; seen_at: string | null }[]>();

  if (error) {
    console.error("[izvestaj] teza:", error.message);
    return { video: [], nije: [] };
  }

  const poKorisniku = new Map<string, { broj: number; video: boolean }>();

  for (const r of data ?? []) {
    const k = poKorisniku.get(r.user_id) ?? { broj: 0, video: false };
    k.broj += 1;
    if (
      r.seen_at !== null &&
      (r.status === "reseno" || r.status === "odbijeno" || r.status === "duplikat")
    ) {
      k.video = true;
    }
    poKorisniku.set(r.user_id, k);
  }

  const video: { broj: number }[] = [];
  const nije: { broj: number }[] = [];

  for (const k of poKorisniku.values()) {
    if (k.broj < 1) continue;
    (k.video ? video : nije).push({ broj: k.broj });
  }

  return { video, nije };
}

/** „3 h 20 min", „2 dana" — prosek u sekundama se ne čita. */
function trajanjeReci(sekundi: number): string {
  if (sekundi < 60) return `${Math.round(sekundi)} s`;
  if (sekundi < 3600) return `${Math.round(sekundi / 60)} min`;
  if (sekundi < 86_400) return `${Math.round(sekundi / 3600)} h`;
  return `${Math.round(sekundi / 86_400)} dana`;
}

/**
 * Ko je bio u aplikaciji u poslednjih 30 dana a nije rekao ni reč.
 *
 * Ovo je jedini deo izveštaja koji je spisak imena, i postoji zbog jedne
 * metrike iz §10: pokrivenost ≥ 70 % aktivnih. Bez spiska je to procenat na koji
 * se ne može odgovoriti ničim.
 *
 * Dva upita nad malim tabelama, u paraleli. Pad bilo kog daje prazan spisak i
 * jednu rečenicu manje — izveštaj se zbog toga ne otkazuje.
 */
async function citajOneKojiCute(): Promise<{ id: string; email: string | null }[]> {
  const db = adminSupabase();
  const od = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [aktivni, javili] = await Promise.all([
    db
      .from("profiles")
      .select("id, email")
      .gte("last_seen_at", od)
      .limit(500)
      .returns<{ id: string; email: string | null }[]>(),
    db.from("feedback").select("user_id").limit(2000).returns<{ user_id: string }[]>(),
  ]);

  if (aktivni.error || javili.error) {
    console.error("[izvestaj] ko ćuti:", aktivni.error?.message ?? javili.error?.message);
    return [];
  }

  const govorili = new Set((javili.data ?? []).map((f) => f.user_id));
  return (aktivni.data ?? []).filter((p) => !govorili.has(p.id));
}
