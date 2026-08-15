// apps/web/src/lib/admin.ts
// Ko je admin, i šta vidi onaj ko nije.
//
// Pravilo 13 iz CLAUDE.md i odluka 4 iz F12: provera je u SVAKOJ ruti i na
// SVAKOJ strani, nikad samo u layout-u. Razlog je isti kao za `requireSession()`
// u `(app)/layout.tsx` — layout se ne izvršava ponovo pri klijentskoj navigaciji
// između sestrinskih ruta, pa bi zaštita koja stoji samo tamo bila zaštita samo
// pri prvom učitavanju.
//
// ── zašto 404, a ne 403 ──────────────────────────────────────
// `403` je odgovor koji kaže „ovo postoji, ali ti ne smeš". `404` ne kaže ništa.
// Konzola koja ume da obriše nalog i da odštampa kredite ne treba nikome da
// potvrdi ni da postoji (odluka 3).

import "server-only";
import { notFound } from "next/navigation";
import type { AdminRole } from "@sajtoskop/shared";
import { getCurrentUserId, requireSession } from "./auth";
import { adminBootstrapIds } from "./env";
import { adminSupabase } from "./supabase";

/**
 * Je li ovaj korisnik admin.
 *
 * Dva izvora, tim redom: rezerva iz env-a, pa `profiles.role`. Rezerva ide prva
 * zato što je i postoji za slučaj kad je baza ta koja je u kvaru — provera koja
 * bi prvo pitala bazu bi u tom slučaju zaključala i mene.
 *
 * Ide kroz `adminSupabase()`, a ne kroz `userSupabase()`: RLS na `profiles`
 * pušta korisnika da čita svoj red, ali uloga ne sme da zavisi od toga da li je
 * Clerk↔Supabase veza ispravno podešena. Pokvarena veza tada znači „nisi admin",
 * a ne „nema profila, pa neka prođe".
 */
export async function jeAdmin(userId: string): Promise<boolean> {
  if (jeBootstrapAdmin(userId)) return true;

  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: AdminRole }>();

  if (error) {
    // Sumnja ide protiv pristupa. Konzola koja se otvori kad baza zakaže je gora
    // od konzole koja se ne otvori.
    console.error("[admin] čitanje uloge nije uspelo:", error.message);
    return false;
  }

  return data?.role === "admin";
}

/** Je li u rezervnom spisku iz env-a. Spisak sam nigde ne izlazi (§1). */
export function jeBootstrapAdmin(userId: string): boolean {
  return adminBootstrapIds().includes(userId);
}

/**
 * Ista odluka kao `jeAdmin()`, ali BEZ upita — za pozivaoca koji je profil već
 * pročitao.
 *
 * Postoji zbog `(app)/layout.tsx`: on profil čita na svakom punom učitavanju, pa
 * bi `jeAdmin()` tamo bio drugi upit nad istim redom, i to samo da bi se u
 * bočnoj traci pojavio jedan link. Kad `role` nije poznat (`undefined`, jer
 * čitanje profila nije prošlo), ostaje samo rezerva iz env-a — isto kao i u
 * `jeAdmin()`, gde pad čitanja ide protiv pristupa.
 */
export function jeAdminIzProfila(userId: string, role: AdminRole | null | undefined): boolean {
  return jeBootstrapAdmin(userId) || role === "admin";
}

/**
 * Prva linija svake strane pod `/admin`.
 *
 * Prijavljen ali ne admin → `notFound()`, dakle isto što bi video da strane
 * nema.
 *
 * NEprijavljen → `requireSession()` ga vodi na prijavu, kao i sa svake druge
 * zaštićene strane. Tako stoji i u F12 §1, i to je svesno: neprijavljen čovek
 * ovde ne saznaje ništa što ne bi saznao i sa `/pipeline`, a admin koji je
 * otvorio zabeleženu adresu iz odjavljenog pregledača dobija prijavu umesto
 * ćorsokaka. Jedino što se odaje je da adresa `/admin/*` postoji — a to je
 * pretpostavka od koje svako ionako kreće.
 */
export async function requireAdminPage(): Promise<string> {
  const userId = await requireSession();
  if (!(await jeAdmin(userId))) notFound();
  return userId;
}

/**
 * Prva linija svake rute pod `/api/admin`.
 *
 * Baca `NeAdmin`, koji ruta hvata i pretvara u `404` sa PRAZNIM telom — poruka
 * o grešci bi bila ista ona potvrda koju `403` daje.
 *
 * Ovde, za razliku od strane, i NEprijavljen dobija `404`: rutu ne otvara čovek
 * nego kod, pa redirekcija na prijavu nikome ne pomaže, a razlika između „nisi
 * prijavljen" i „nisi admin" je informacija koju spolja niko ne treba da ima.
 *
 * Prvi pozivalac stiže u F12.2, sa mutacijama. Stoji već ovde zato što se sve
 * rute iz §4 na njega oslanjaju, a provera koja se dopisuje uz prvu rutu je
 * provera koja se zaboravi uz drugu.
 */
export class NeAdmin extends Error {
  constructor() {
    super("Nije admin.");
    this.name = "NeAdmin";
  }
}

export async function requireAdminRoute(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new NeAdmin();
  if (!(await jeAdmin(userId))) throw new NeAdmin();
  return userId;
}

/**
 * Odgovor za sve što nije admin. Prazno telo, bez ijedne reči.
 *
 * Stoji ovde da bi svaka admin ruta vraćala bajt u bajt isti odgovor — dve rute
 * koje se razlikuju po dužini tela su dve rute koje se razlikuju po tome da li
 * ekran postoji.
 */
export function odgovorNeAdmin(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

// ═══════════════════════════════════════════════════════════
// DNEVNIK RADNJI (F12 §2, pravilo 14)
// ═══════════════════════════════════════════════════════════

/**
 * Imenski prostor radnji — jedini spisak vrednosti koje smeju da uđu u
 * `admin_audit.action`.
 *
 * Stoji kao konstanta, a ne kao string u svakoj ruti, iz jednog razloga: filter
 * na `/admin/revizija` se puni iz onoga što u tabeli STVARNO stoji. Dva zapisa
 * `user.ban` i `user.blokada` bi tamo bila dve radnje, i pitanje „ko je blokirao
 * ovog čoveka" bi imalo dva odgovora, oba nepotpuna.
 *
 * `KREDITI` mora slovo u slovo da odgovara stringu koji upisuje sam
 * `admin_adjust_credits` (0012) — to je jedina radnja čiji red ne piše ruta.
 */
export const RADNJE = {
  KREDITI: "credits.adjust",
  PLAN: "user.plan",
  ULOGA: "user.role",
  LIMIT: "user.limit_reset",
  BLOKADA: "user.ban",
  ODBLOKADA: "user.unban",
  BRISANJE: "user.delete",
  /** Kaskada iz webhooka `user.deleted` — jedini red bez aktera. */
  KASKADA: "user.delete.cascade",

  // ── F12.3 ────────────────────────────────────────────────
  /** Pozivnica kroz Clerk. `target_user` je prazan — naloga još nema. */
  POZIVNICA: "invite.create",
  POZIVNICA_OPOZIV: "invite.revoke",
  /** Otvoren nalog sa generisanom lozinkom. Lozinka NIKAD ne ulazi u payload. */
  NALOG: "user.create",
  /** Pojedinačna poruka korisniku kroz Resend. Sopstveni brojač, 20 na dan. */
  PORUKA: "user.message",
  /** Izvoz korisnika u CSV — PII izlazi iz sistema, pa ostavlja trag. */
  IZVOZ: "export.users",

  // ── F11.3: utisci u konzoli ──────────────────────────────
  // Tri radnje umesto jedne `feedback.update`, iz istog razloga iz kog su
  // `user.ban` i `user.unban` razdvojeni („S4", tačka 7): filter na
  // `/admin/revizija` je po `action`, pa bi „ko je kome dodelio 10 kredita"
  // inače moralo da se čita red po red kroz `payload`.
  /** Status, oznake i beleška uz prijavu. `target_ref` je `fb:<id>`. */
  UTISAK: "feedback.status",
  /** +10 za potvrđen bug. `grant_feedback_credits` NE upisuje svoj red. */
  UTISAK_NAGRADA: "feedback.reward",
  /** Vezivanje prijave sa stavkom Beta dnevnika. */
  UTISAK_DNEVNIK: "feedback.changelog",

  // ── F11.4: Beta dnevnik ───────────────────────────────────
  // Tri radnje, iz istog razloga iz kog su `user.ban` i `user.unban` dve
  // („S4", tačka 7): filter na `/admin/revizija` je po `action`, pa bi
  // „ko je menjao dnevnik" inače moralo da se čita kroz `payload`.
  DNEVNIK: "changelog.create",
  DNEVNIK_IZMENA: "changelog.update",
  DNEVNIK_BRISANJE: "changelog.delete",

  // ── F11.3: cron ──────────────────────────────────────────
  // Cron nema sesiju, pa nema ni aktera: `actor_id` je `null`, isto kao kod
  // kaskade iz webhooka. Red svejedno postoji, jer sve tri rute menjaju podatke
  // — digest upisuje `emailed_at`, čišćenje briše fajlove iz bucketa.
  CRON_DIGEST: "cron.feedback.digest",
  CRON_IZVESTAJ: "cron.feedback.izvestaj",
  CRON_SLIKE: "cron.feedback.slike",
} as const;

export type AdminRadnja = (typeof RADNJE)[keyof typeof RADNJE];

export type AuditUnos = {
  /** Uvek iz `requireAdminRoute()`, nikad iz tela. `null` je samo webhook. */
  actor: string | null;
  action: AdminRadnja;
  target?: string | null;
  /** Drugi objekat: `ref_id` korekcije, id utiska, stavka dnevnika. */
  ref?: string | null;
  payload?: Record<string, unknown>;
  ok: boolean;
  error?: string | null;
  ip?: string | null;
};

/**
 * Ključevi koji ni slučajno ne smeju da završe u `payload`-u (pravilo 14).
 *
 * Ovo nije zamena za pažnju pri pisanju rute nego mreža ispod nje: `payload` se
 * sastavlja iz već validiranog tela, a telo jednog dana dobije polje koje niko
 * nije mislio da upiše. F12.3 donosi „otvori nalog sa generisanom lozinkom" —
 * tačno onaj slučaj zbog kog ova mreža treba da postoji pre njega, a ne posle.
 */
const ZABRANJEN_KLJUC = /lozink|password|passwd|secret|token|api[-_]?key|klju[cč]|authorization|cookie/i;

/** Duža vrednost od ovoga je greška u pozivaocu, ne podatak. Dnevnik nije skladište. */
const MAX_VREDNOST = 500;

function ocistiPayload(p: Record<string, unknown>): Record<string, unknown> {
  const izlaz: Record<string, unknown> = {};

  for (const [kljuc, vrednost] of Object.entries(p)) {
    if (ZABRANJEN_KLJUC.test(kljuc)) {
      izlaz[kljuc] = "[izbačeno]";
      continue;
    }
    izlaz[kljuc] =
      typeof vrednost === "string" && vrednost.length > MAX_VREDNOST
        ? `${vrednost.slice(0, MAX_VREDNOST)}…`
        : vrednost;
  }

  return izlaz;
}

/**
 * Jedan red u `admin_audit` — i na uspeh i na pad (odluka 5).
 *
 * NE BACA. Radnja je u tom trenutku već izvršena; izuzetak odavde bi rutu
 * pretvorio u `500` posle uspešne izmene, pa bi admin kliknuo drugi put i
 * izmenio isto dvaput. Promašen upis izlazi u log servera i tu se zaustavlja.
 *
 * Jedini izuzetak od „svaka mutacija zove ovo" je USPELA korekcija kredita:
 * njen red upisuje sam `admin_adjust_credits`, u istoj transakciji sa izmenom
 * balansa (v. „S3 — šta se razišlo", tačka 6). Drugi red odavde bi značio dva
 * zapisa o jednoj dodeli.
 */
export async function upisiAudit(unos: AuditUnos): Promise<void> {
  const { error } = await adminSupabase().from("admin_audit").insert({
    actor_id: unos.actor,
    action: unos.action,
    target_user: unos.target ?? null,
    target_ref: unos.ref ?? null,
    payload: ocistiPayload(unos.payload ?? {}),
    ok: unos.ok,
    error: unos.error ?? null,
    ip: unos.ip ?? null,
  });

  if (error) {
    console.error(`[admin] dnevnik nije upisan (${unos.action}):`, error.message);
  }
}

/**
 * Adresa aplikacije kako je vidi pregledač.
 *
 * Ide u link iz pozivnice i u `redirectUrl` koji Clerk vraća čoveku — dakle u
 * mejl, odakle se ne može ispraviti. `req.url` iza proxyja ume da nosi interni
 * host, pa je prvi izvor `Origin` header (pregledač ga šalje uz svaki `POST` sa
 * iste strane), pa prosleđeni host, pa tek onda sam URL.
 */
export function originZahteva(req: Request): string {
  const izHeadera = req.headers.get("origin");
  if (izHeadera && /^https?:\/\//.test(izHeadera)) return izHeadera.replace(/\/$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const sema = req.headers.get("x-forwarded-proto") ?? "https";
    return `${sema}://${host}`;
  }

  return new URL(req.url).origin;
}

/** Adresa iz proxy headera. Vercel je uvek postavlja; lokalno je `null`. */
export function ipZahteva(req: Request): string | null {
  const prosledjena = req.headers.get("x-forwarded-for");
  if (prosledjena) return prosledjena.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}

// ═══════════════════════════════════════════════════════════
// TEMPO (F12 §5: 120 mutacija na sat po adminu, 20 poruka na dan)
// ═══════════════════════════════════════════════════════════

/** 120 na sat. Dva klika u minutu, sat vremena bez prekida — ručno se ne stiže. */
export const TEMPO_NA_SAT = 120;

export type TempoIshod = { ok: true } | { ok: false; status: number; poruka: string };

/**
 * Brojač je sam `admin_audit`, a ne zasebna tabela.
 *
 * Svaka mutacija po definiciji ostavlja red u njemu (pravilo 14), pa je broj
 * redova aktera u poslednjih sat vremena tačno broj njegovih mutacija — i
 * uspelih i palih. Zasebna tabela bi bila drugi izvor istine za isti podatak, i
 * prvi koji se raziđe.
 *
 * Pad čitanja NE prolazi. Ako dnevnik ne može da se pročita, ne može ni da se
 * upiše — a mutacija bez traga je tačno ono što pravilo 14 zabranjuje. Zato
 * ovde sumnja ide protiv radnje, isto kao u `jeAdmin()`.
 */
export async function proveriTempo(actorId: string): Promise<TempoIshod> {
  return brojiRadnje(actorId, null, 60 * 60 * 1000, TEMPO_NA_SAT, (n) =>
    `Previše izmena u poslednjih sat vremena (${n}). Sačekaj, pa pokušaj ponovo.`);
}

/** Poruka korisniku ima svoj, uži brojač (F12 §3.2). */
export const PORUKA_NA_DAN = 20;

/**
 * Drugi brojač, nad JEDNOM radnjom — danas samo `user.message`.
 *
 * Zašto uz onaj od 120/h, a ne umesto njega: tempo je zaštita konzole od
 * skripta, a ovo je zaštita **tuđih inboksa**. Dvadeset mejlova na dan je već
 * mnogo za alat u kom ne postoji kampanja (F12 §9), a 120 mutacija na sat bi
 * pustilo dve stotine.
 *
 * Broje se i pali pokušaji, iz istog razloga kao kod tempa: onaj ko lupa
 * neispravnim telom mora da udari u isti zid.
 */
export async function proveriDnevniTempo(
  actorId: string,
  action: AdminRadnja,
  granica: number,
  imenica: string,
): Promise<TempoIshod> {
  return brojiRadnje(actorId, action, 24 * 60 * 60 * 1000, granica, (n) =>
    `Dnevni limit je ${n} ${imenica}. Brojač se pomera u prozoru od 24 sata.`);
}

async function brojiRadnje(
  actorId: string,
  action: AdminRadnja | null,
  prozorMs: number,
  granica: number,
  poruka: (granica: number) => string,
): Promise<TempoIshod> {
  const od = new Date(Date.now() - prozorMs).toISOString();

  let upit = adminSupabase()
    .from("admin_audit")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", actorId)
    .gte("created_at", od);

  if (action) upit = upit.eq("action", action);

  const { count, error } = await upit;

  if (error) {
    console.error("[admin] tempo se ne može proveriti:", error.message);
    return {
      ok: false,
      status: 503,
      poruka: "Dnevnik radnji trenutno ne odgovara, pa se nijedna izmena ne izvršava bez traga.",
    };
  }

  if ((count ?? 0) >= granica) {
    return { ok: false, status: 429, poruka: poruka(granica) };
  }

  return { ok: true };
}
