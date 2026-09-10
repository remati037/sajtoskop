// apps/web/src/lib/admin-radnje.ts
// Mutacije iz admin konzole (F12 §3.2) i zajednički omotač za rute iz §4.
//
// Rute pod `/api/admin` su namerno tanke kao i sve ostale u projektu: provera,
// telo, poziv odavde, prevod ishoda u status kod i srpsku rečenicu. Razlog zašto
// je omotač ovde a ne u svakoj ruti je pravilo 14 — trag koji se piše na sedam
// mesta je trag koji na osmom mestu izostane.
//
// ── redosled koji se ne menja ────────────────────────────────
//   1. `requireAdminRoute()`  — ko nije admin dobija `404` sa praznim telom
//   2. `proveriTempo()`       — 120 mutacija na sat po adminu
//   3. telo kroz Zod šemu
//   4. sama izmena
//   5. `upisiAudit()` — i na uspeh i na pad
//
// Koraci 3–5 su unutar `saAuditom()`, pa i odbijeno telo ostavlja red u
// dnevniku. To je namerno: „ko je pokušao" je pitanje koje se postavlja tačno
// onda kad je pokušaj bio neuspešan.

import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import type {
  AdminAdjustResult,
  AdminOpenKompResult,
  AdminRole,
  AdminSetRoleResult,
} from "@sajtoskop/shared";
import {
  ipZahteva,
  NeAdmin,
  odgovorNeAdmin,
  proveriTempo,
  requireAdminRoute,
  upisiAudit,
  type AdminRadnja,
} from "./admin";
import { posaljiPorukuKorisniku } from "./admin-mail";
import type { ApiError } from "./search-types";
import { adminSupabase } from "./supabase";
import { formatDatum } from "./ui-tekst";

const HEADERS = { "Cache-Control": "private, no-store" };

/**
 * Ishod jedne radnje.
 *
 * `payload` se dopisuje u red dnevnika — tu idu vrednosti koje objašnjavaju ŠTA
 * se promenilo (stari i novi plan, iznos, razlog odbijanja), nikad lozinka ni
 * token (pravilo 14; `upisiAudit()` ima i mrežu ispod toga).
 */
export type Ishod =
  | {
      ok: true;
      poruka: string;
      payload?: Record<string, unknown>;
      ref?: string | null;
      /**
       * Ono što ide KLIJENTU, a nikad u dnevnik.
       *
       * Postoji zbog tačno dve stvari iz F12 §3.3: generisane lozinke i linka iz
       * pozivnice. Obe se prikazuju jednom i nigde se ne upisuju — ni u bazu, ni
       * u audit, ni u log. `upisiAudit()` ima mrežu koja izbacuje ključeve nalik
       * na lozinku, ali mreža je poslednja odbrana, a ne put: lozinka prosto
       * nema kuda da uđe u `payload`, jer putuje drugim poljem.
       */
      podaci?: Record<string, unknown>;
    }
  | {
      ok: false;
      status: number;
      poruka: string;
      payload?: Record<string, unknown>;
      ref?: string | null;
    };

export type Priprema =
  | { ok: true; actor: string; ip: string | null }
  | { ok: false; odgovor: Response };

/**
 * Prva dva koraka svake rute pod `/api/admin`.
 *
 * Vraća ili aktera (uvek iz verifikovane sesije, nikad iz tela — pravilo 8), ili
 * gotov odgovor koji ruta samo prosledi dalje.
 */
export async function pripremiRadnju(req: Request): Promise<Priprema> {
  let actor: string;
  try {
    actor = await requireAdminRoute();
  } catch (err) {
    if (err instanceof NeAdmin) return { ok: false, odgovor: odgovorNeAdmin() };
    console.error("[admin] provera prava:", err);
    return { ok: false, odgovor: odgovorNeAdmin() };
  }

  // ── akter mora da postoji u `profiles` ────────────────────
  // `admin_audit.actor_id` je strani ključ ka `profiles`. Admin iz
  // `ADMIN_BOOTSTRAP_IDS` prolazi `jeAdmin()` bez ijednog upita, pa bi onaj koji
  // je sebe obrisao iz Clerk konzole (§6) i dalje ušao u konzolu — a njegov red
  // u dnevniku bi pao na stranom ključu. Mutacija bi tada prošla bez traga, što
  // je tačno ono što pravilo 14 zabranjuje.
  //
  // Zato se ovde staje, i to porukom iz §6: nalog ne postoji, prijavi se ponovo.
  const { data: profilAktera, error: greskaProfila } = await adminSupabase()
    .from("profiles")
    .select("id")
    .eq("id", actor)
    .maybeSingle<{ id: string }>();

  if (greskaProfila) {
    console.error("[admin] provera profila aktera:", greskaProfila.message);
    return {
      ok: false,
      odgovor: greska("Baza trenutno ne odgovara. Pokušaj ponovo za koji trenutak.", 503),
    };
  }

  if (!profilAktera) {
    return {
      ok: false,
      odgovor: greska(
        "Tvoj nalog više ne postoji u bazi, pa izmena ne bi imala ko da se potpiše. Odjavi se i prijavi ponovo.",
        409,
      ),
    };
  }

  const tempo = await proveriTempo(actor);
  if (!tempo.ok) {
    return { ok: false, odgovor: greska(tempo.poruka, tempo.status) };
  }

  return { ok: true, actor, ip: ipZahteva(req) };
}

export function greska(poruka: string, status: number, detalji?: string[]): Response {
  const body: ApiError = detalji ? { greska: poruka, detalji } : { greska: poruka };
  return NextResponse.json(body, { status, headers: HEADERS });
}

/**
 * Telo kroz Zod šemu, u obliku koji `saAuditom()` razume.
 *
 * Neispravno telo je `Ishod` sa `ok: false`, a ne izuzetak — time i ono prolazi
 * kroz dnevnik, i time ruta nema nijednu granu koja preskače trag.
 */
export async function procitajTelo<T>(
  req: Request,
  sema: ZodType<T>,
): Promise<{ ok: true; telo: T } | { ok: false; ishod: Ishod }> {
  let sirovo: unknown;
  try {
    sirovo = await req.json();
  } catch {
    return {
      ok: false,
      ishod: { ok: false, status: 400, poruka: "Telo zahteva nije ispravan JSON." },
    };
  }

  const parsed = sema.safeParse(sirovo);
  if (!parsed.success) {
    const detalji = parsed.error.issues.map((i) => `${i.path.join(".") || "telo"}: ${i.message}`);
    return {
      ok: false,
      ishod: {
        ok: false,
        status: 400,
        poruka: detalji[0] ?? "Neispravan zahtev.",
        payload: { odbijeno: detalji },
      },
    };
  }

  return { ok: true, telo: parsed.data };
}

export type Kontekst = {
  actor: string;
  action: AdminRadnja;
  /**
   * Nad kim. `null` je legitiman za radnje koje nemaju nalog kao cilj —
   * pozivnica ide na mejl adresu naloga koji još ne postoji, izvoz ide nad celom
   * listom. Adresa tada stoji u `payload`-u, a ne ovde: `/admin/revizija` iz ove
   * kolone pravi link na detalj korisnika.
   */
  target: string | null;
  ip: string | null;
  payload?: Record<string, unknown>;
  /**
   * Isključi upis na USPEH. Tačno jedna radnja ga koristi: korekcija kredita,
   * čiji red piše sam `admin_adjust_credits`, u istoj transakciji sa izmenom
   * balansa (v. „S3 — šta se razišlo", tačka 6). Pad i dalje piše ruta — njega
   * RPC ne vidi, jer se do njega uopšte nije ni stiglo.
   */
  bezAuditaNaUspeh?: boolean;
};

/**
 * Izvrši radnju, upiši trag, vrati odgovor.
 *
 * Izuzetak iz `posao()` je `500` i red u dnevniku sa `ok = false` — nikad tiho
 * palo. Poruka izuzetka ide u kolonu `error`, ne u odgovor: tekst iz Postgresa
 * ili iz Clerka spolja ne treba nikome.
 */
export async function saAuditom(ctx: Kontekst, posao: () => Promise<Ishod>): Promise<Response> {
  let ishod: Ishod;

  try {
    ishod = await posao();
  } catch (err) {
    const poruka = err instanceof Error ? err.message : String(err);
    console.error(`[admin] ${ctx.action} nad ${ctx.target}:`, err);

    await upisiAudit({
      actor: ctx.actor,
      action: ctx.action,
      target: ctx.target,
      payload: ctx.payload,
      ok: false,
      error: poruka,
      ip: ctx.ip,
    });

    return greska("Izmena nije prošla. Pokušaj ponovo za koji trenutak.", 500);
  }

  const payload = { ...ctx.payload, ...ishod.payload };

  if (!ishod.ok) {
    await upisiAudit({
      actor: ctx.actor,
      action: ctx.action,
      target: ctx.target,
      ref: ishod.ref,
      payload,
      ok: false,
      error: ishod.poruka,
      ip: ctx.ip,
    });

    return greska(ishod.poruka, ishod.status);
  }

  if (!ctx.bezAuditaNaUspeh) {
    await upisiAudit({
      actor: ctx.actor,
      action: ctx.action,
      target: ctx.target,
      ref: ishod.ref,
      payload,
      ok: true,
      ip: ctx.ip,
    });
  }

  // `podaci` ide isključivo ovuda — u `upisiAudit()` iznad ga nema nigde.
  return NextResponse.json(
    ishod.podaci ? { ok: true, poruka: ishod.poruka, podaci: ishod.podaci } : { ok: true, poruka: ishod.poruka },
    { headers: HEADERS },
  );
}

// ═══════════════════════════════════════════════════════════
// KREDITI
// ═══════════════════════════════════════════════════════════

/**
 * Ručna korekcija — jedini put do negativnog iznosa (pravilo 3).
 *
 * Ništa se ovde ne računa i ne proverava dvaput: granice, balans ispod nule i
 * idempotencija po `ref_id`-ju su u RPC-u, u jednoj transakciji sa upisom u
 * knjigu i u dnevnik. Ovaj sloj samo prevodi razlog u status kod i u rečenicu.
 */
export async function korigujKredite(
  actor: string,
  target: string,
  delta: number,
  napomena: string,
  refId: string,
): Promise<Ishod> {
  const { data, error } = await adminSupabase().rpc("admin_adjust_credits", {
    p_actor: actor,
    p_user: target,
    p_delta: delta,
    p_note: napomena,
    p_ref_id: refId,
  });

  if (error) throw new Error(error.message);

  const red = ((data ?? []) as AdminAdjustResult[])[0];
  if (!red) throw new Error("admin_adjust_credits nije vratio nijedan red.");

  if (!red.ok) {
    const status =
      red.reason === "no_user" ? 404 : red.reason === "balans bi bio negativan" ? 409 : 400;

    return { ok: false, status, poruka: PORUKA_KOREKCIJE[red.reason] ?? red.reason, ref: refId };
  }

  // Dvostruki klik. Ništa se nije promenilo, pa nema šta ni da se upiše — a i ne
  // sme, jer bi drugi red u dnevniku tvrdio drugu dodelu koje nije bilo.
  if (red.reason === "already_applied") {
    return {
      ok: true,
      poruka: `Ta izmena je već primenjena. Balans je i dalje ${red.balance}.`,
      ref: refId,
    };
  }

  const znak = delta > 0 ? `+${delta}` : String(delta);
  return { ok: true, poruka: `${znak} kredita. Balans je sada ${red.balance}.`, ref: refId };
}

/** Razlozi iz RPC-a su mešani (§ komentar u 0012); korisniku ide jedna rečenica. */
const PORUKA_KOREKCIJE: Record<string, string> = {
  invalid_amount: "Iznos 0 ne menja ništa.",
  "iznos van granica": "Iznos je van granica — najviše 500 po izmeni.",
  no_user: "Taj nalog ne postoji.",
  "balans bi bio negativan": "Balans ne može ispod nule.",
};

// ═══════════════════════════════════════════════════════════
// PLAN, ULOGA, DNEVNI LIMIT
// ═══════════════════════════════════════════════════════════

/**
 * Postoji li profil, i sa kojom ulogom.
 *
 * §4: „`target_user` iz putanje i mora da postoji u `profiles`". Bez ove provere
 * bi `update … where id = 'ne-postoji'` bio uredan `200` nad nula redova, i
 * konzola bi tvrdila da je promenila plan nekome koga nema.
 */
async function citajCilj(
  target: string,
): Promise<{ id: string; email: string | null; role: AdminRole } | null> {
  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("id, email, role")
    .eq("id", target)
    .maybeSingle<{ id: string; email: string | null; role: AdminRole }>();

  if (error) throw new Error(error.message);
  return data;
}

const NEMA_NALOGA: Ishod = { ok: false, status: 404, poruka: "Taj nalog ne postoji." };

export async function promeniPlan(target: string, plan: string): Promise<Ishod> {
  // Drugi od tri sloja odluke D1 (LANSIRANJE §1.1). Prvi je `PLAN_OPCIJE`, koji
  // `komp` uopšte ne nudi; treći je triger u bazi (0025), koji drži i kad se
  // aplikacija zaobiđe. Ovaj sloj postoji zato što bi bez njega jedini otpor
  // ručno sklopljenom `PATCH`-u bio izuzetak iz Postgresa — dakle `500` i red u
  // dnevniku koji piše „nije prošlo", umesto rečenice koja kaže ZAŠTO.
  if (plan === "komp" || plan === "beta") {
    return {
      ok: false,
      status: 400,
      poruka:
        "Plan `komp` se ne postavlja odavde. Komp nalog se otvara svojim obrascem, " +
        "jer plan, rok i krediti moraju da idu zajedno.",
      payload: { plan },
    };
  }

  const cilj = await citajCilj(target);
  if (!cilj) return NEMA_NALOGA;

  const { error } = await adminSupabase().from("profiles").update({ plan }).eq("id", target);
  if (error) throw new Error(error.message);

  return { ok: true, poruka: `Plan je sada ${plan}.`, payload: { plan } };
}

// ═══════════════════════════════════════════════════════════
// KOMP NALOZI (S20 → S25, LANSIRANJE §1.1 i §1.5, naplata-stripe.md §9)
// ═══════════════════════════════════════════════════════════

/** Rečenica o roku, ista u obe radnje — dva teksta bi se razišla prvog dana. */
function recenicaORoku(doKad: string | null, sada = Date.now()): string {
  if (doKad === null) return "Komp je neograničen — rok nije postavljen.";
  return Date.parse(doKad) <= sada
    ? `Rok je ${formatDatum(doKad)}, dakle u prošlosti — komp je ugašen.`
    : `Komp traje do ${formatDatum(doKad)}.`;
}

/**
 * „Otvori komp" — plan, rok i krediti u JEDNOM pozivu (§1.1).
 *
 * Ovo je (uz pozivnicu, koja istu funkciju zove iz `redeem_invite`) jedini put
 * kojim `profiles.plan` sme da postane `komp`. Ne zato što se ovaj sloj tako
 * dogovorio, nego zato što `admin_open_komp` jedini pali transakcijsku
 * zastavicu koju triger iz 0025 traži — svaki drugi `update` puca u bazi, i kad
 * dođe iz ove aplikacije, i kad dođe iz SQL editora.
 *
 * Sve tri izmene su u jednoj transakciji, i to je cela poenta: do S20 se beta
 * otvarala u dva poteza (plan, pa krediti) i bez roka uopšte. Kad bi drugi
 * potez pao, nalog bi ostao sa planom i praznim rokom — a prazan rok po §1.5
 * znači NEOGRANIČENO. Najgori ishod pola odrađenog posla bio je doživotan
 * besplatan nalog.
 *
 * Iznos i granice proverava RPC; ovaj sloj prevodi razlog u status kod i u
 * rečenicu, isto kao kod korekcije kredita i uloge.
 */
export async function otvoriKompNalog(
  target: string,
  krediti: number,
  doKad: string | null,
  refId: string,
): Promise<Ishod> {
  const { data, error } = await adminSupabase().rpc("admin_open_komp", {
    p_user: target,
    p_credits: krediti,
    p_expires: doKad,
    p_ref_id: refId,
  });

  if (error) throw new Error(error.message);

  const red = ((data ?? []) as AdminOpenKompResult[])[0];
  if (!red) throw new Error("admin_open_komp nije vratio nijedan red.");

  if (!red.ok) {
    const status = red.reason === "no_user" ? 404 : 400;
    return {
      ok: false,
      status,
      poruka: PORUKA_KOMPA[red.reason] ?? red.reason,
      ref: refId,
      payload: { krediti, do: doKad },
    };
  }

  const rok = recenicaORoku(doKad);

  // Dvostruki klik. Plan i rok su ponovo upisani (to je postavljanje, ne
  // sabiranje), kredita nema drugi put — pa to i piše, umesto lažnog „+50".
  const oKreditima =
    red.reason === "already_granted"
      ? `Krediti su već bili dodeljeni ovom radnjom, balans je i dalje ${red.balance}.`
      : krediti > 0
        ? `+${krediti} kredita, balans je sada ${red.balance}.`
        : "Bez novih kredita.";

  return {
    ok: true,
    poruka: `Komp nalog je otvoren. ${rok} ${oKreditima}`,
    ref: refId,
    payload: { plan: "komp", do: doKad, krediti, dodeljeno: red.granted },
  };
}

const PORUKA_KOMPA: Record<string, string> = {
  no_user: "Taj nalog ne postoji.",
  invalid_amount: "Broj kredita je van granica — od 0 do 2000 po radnji.",
  missing_ref_id: "Ključ forme nije stigao. Osveži stranu.",
};

/**
 * Samo rok kompa — `PATCH .../komp` (§1.5).
 *
 * `null` je NEOGRANIČENO, i to je jedina vrednost koja se ovde tumači.
 *
 * Direktan `update` je dozvoljen: `komp_expires_at` nije balans, pa pravilo 3
 * nije u igri, a triger iz 0025 čuva samo kolonu `plan` — rok nad nalogom koji
 * već JESTE u kompu se time ne dira.
 *
 * ── zašto se ne traži da nalog bude u kompu ──────────────────
 * Rok sme da se postavi i nalogu sa plaćenim planom, i to nije rupa nego
 * upotreba: `stanjePristupa()` uzima KASNIJI od dva roka (§1.5), pa je ovo način
 * da pretplatnik dobije dve nedelje viška posle propalog plaćanja — bez
 * diranja pretplate i bez dodirivanja Stripe-a. Poruka zato izričito kaže kad
 * rok nikome ništa ne menja.
 */
export async function postaviKompRok(target: string, doKad: string | null): Promise<Ishod> {
  const cilj = await citajCilj(target);
  if (!cilj) return NEMA_NALOGA;

  const { data: pre, error: greskaCitanja } = await adminSupabase()
    .from("profiles")
    .select("plan")
    .eq("id", target)
    .maybeSingle<{ plan: string }>();

  if (greskaCitanja) throw new Error(greskaCitanja.message);

  const { error } = await adminSupabase()
    .from("profiles")
    .update({ komp_expires_at: doKad })
    .eq("id", target);

  if (error) throw new Error(error.message);

  const napomena =
    pre?.plan === "komp"
      ? ""
      : ` Nalog nije na komp planu (${pre?.plan ?? "nepoznat"}), pa rok radi samo kao produžetak pristupa.`;

  return {
    ok: true,
    poruka: `${recenicaORoku(doKad)}${napomena}`,
    payload: { do: doKad },
  };
}

/**
 * Reset dnevnog cache-miss brojača (§3.2).
 *
 * Nulira se samo brojač, ne i `cache_miss_day`: dan je oznaka perioda i menja ga
 * isključivo `claim_cache_miss` (0003). Sa `day = null` bi prvo sledeće
 * skeniranje ionako počelo od nule — dakle isto stanje, ali kroz kolonu koju
 * ovaj sloj nema razloga da dira.
 *
 * Direktan `update` je ovde dozvoljen: `cache_miss_count` nije balans, pa
 * pravilo 3 nije u igri.
 */
export async function resetujLimit(target: string): Promise<Ishod> {
  const cilj = await citajCilj(target);
  if (!cilj) return NEMA_NALOGA;

  const { error } = await adminSupabase()
    .from("profiles")
    .update({ cache_miss_count: 0 })
    .eq("id", target);

  if (error) throw new Error(error.message);

  return { ok: true, poruka: "Dnevni limit skeniranja je resetovan." };
}

/**
 * Koliko admina ima u bazi. `ADMIN_BOOTSTRAP_IDS` se NE broji.
 *
 * Od 0013 ovo više nije brava nego prikaz: detalj korisnika iz ovoga odlučuje
 * hoće li dugme „Skini ulogu" uopšte biti ponuđeno. Pravu odluku donosi
 * `admin_set_role`, koji broji ponovo i u istoj transakciji sa upisom.
 */
export async function brojAdmina(): Promise<number> {
  const { count, error } = await adminSupabase()
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");

  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Dodela i skidanje uloge admina (§1, „Zaštite od zaključavanja").
 *
 * Sve tri brave — „ne sebi", „poslednji admin ostaje" i sam upis — su u
 * `admin_set_role` (migracija 0013), u jednoj transakciji i iza jedne
 * savetodavne brave. Ovaj sloj samo prevodi razlog u status kod i u rečenicu,
 * isto kao kod korekcije kredita.
 *
 * ── zašto je ovo nekad bilo drugačije ────────────────────────
 * F12.2 je isti posao radio brojanjem pre upisa pa ponovo posle njega, i vraćao
 * ulogu kad bi ispalo da je konzola ostala prazna (v. „S4 — šta se razišlo",
 * tačka 1). Radilo je, ali je najgori ishod bio poništena izmena posle upisa. Sa
 * RPC-om se do upisa ni ne dolazi, pa `brojAdmina()` ovde više nije brava nego
 * samo podatak za prikaz.
 *
 * `ADMIN_BOOTSTRAP_IDS` je ispod svega i dalje rezerva iz env-a, ali na njega se
 * ne oslanjam kao na odbranu: rešenje koje traži da se dira produkcijski env
 * nije rešenje.
 */
export async function promeniUlogu(
  actor: string,
  target: string,
  role: AdminRole,
): Promise<Ishod> {
  const { data, error } = await adminSupabase().rpc("admin_set_role", {
    p_actor: actor,
    p_user: target,
    p_role: role,
  });

  if (error) throw new Error(error.message);

  const red = ((data ?? []) as AdminSetRoleResult[])[0];
  if (!red) throw new Error("admin_set_role nije vratio nijedan red.");

  if (!red.ok) {
    const status = red.reason === "no_user" ? 404 : red.reason === "invalid_role" ? 400 : 409;
    return {
      ok: false,
      status,
      poruka: PORUKA_ULOGE[red.reason] ?? red.reason,
      payload: { role },
    };
  }

  // Dva otvorena taba nad istim korisnikom. Ništa se nije promenilo, pa nema šta
  // ni da se javi kao izmena — ali red u dnevniku ostaje, jer je pokušaj bio.
  if (red.reason === "unchanged") {
    return {
      ok: true,
      poruka: `Uloga je i bila ${role === "admin" ? "admin" : "korisnik"}.`,
      payload: { role, promena: false },
    };
  }

  return {
    ok: true,
    poruka: role === "admin" ? "Uloga admina je dodeljena." : "Uloga admina je skinuta.",
    payload: { role, admina: red.admins },
  };
}

/** Razlozi iz RPC-a su ključevi; korisniku ide jedna rečenica. */
const PORUKA_ULOGE: Record<string, string> = {
  ok: "Urađeno.",
  unchanged: "Uloga se nije promenila.",
  invalid_role: "Uloga može da bude samo `user` ili `admin`.",
  self: "Sebi ne možeš da menjaš ulogu.",
  no_user: "Taj nalog ne postoji.",
  last_admin: "Ovo je poslednji admin u bazi. Prvo postavi drugog, pa mu skini ulogu.",
};

// ═══════════════════════════════════════════════════════════
// CLERK: BLOKADA I BRISANJE
// ═══════════════════════════════════════════════════════════

/** Clerk baca objekat sa `status`; 404 je „tog korisnika kod nas nema". */
export function clerkStatus(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status: unknown }).status;
    return typeof s === "number" ? s : null;
  }
  return null;
}

/**
 * Blokada i odblokada (§3.2). Clerk je izvor istine za identitet, pa i za to ko
 * sme da se prijavi — blokiran korisnik se zaustavlja na prijavi i aplikacija ga
 * više i ne vidi (§6).
 *
 * Ne sebi: admin koji se blokira ne može da se odblokira, jer za odblokadu treba
 * da bude prijavljen.
 */
export async function postaviBlokadu(
  actor: string,
  target: string,
  blokiran: boolean,
): Promise<Ishod> {
  if (actor === target) {
    return { ok: false, status: 409, poruka: "Sebe ne možeš da blokiraš." };
  }

  const cilj = await citajCilj(target);
  if (!cilj) return NEMA_NALOGA;

  try {
    const clerk = await clerkClient();
    if (blokiran) await clerk.users.banUser(target);
    else await clerk.users.unbanUser(target);
  } catch (err) {
    if (clerkStatus(err) === 404) {
      return {
        ok: false,
        status: 404,
        poruka: "Taj nalog više ne postoji u Clerku.",
        payload: { blokiran },
      };
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  return {
    ok: true,
    poruka: blokiran ? "Nalog je blokiran." : "Blokada je skinuta.",
    payload: { blokiran },
  };
}

/**
 * Pojedinačna poruka korisniku (§3.2), kroz Resend, sa `Reply-To` na mene.
 *
 * Adresa se uzima iz CLERKA, ne iz `profiles`: profil čuva mejl od registracije,
 * a čovek je u međuvremenu mogao da ga promeni — isto pravilo kao kod potvrde za
 * brisanje. Kad Clerk ne odgovori, pada se na `profiles.email`, jer je poruka
 * koja je stigla na staru adresu i dalje bolja od poruke koja nije poslata.
 *
 * Pad mejla OVDE jeste pad radnje, za razliku od pozivnice: tamo posle
 * neuspelog mejla ostaje link koji mogu da pošaljem ručno, a ovde ne ostaje
 * ništa. `ok: false` znači i da je pokušaj u dnevniku obeležen kao neuspeo, pa
 * ponovno slanje nije duplikat nego prvi put.
 */
export async function posaljiPoruku(
  target: string,
  naslov: string,
  poruka: string,
): Promise<Ishod> {
  const cilj = await citajCilj(target);
  if (!cilj) return NEMA_NALOGA;

  let adresa = cilj.email;
  try {
    const clerk = await clerkClient();
    const u = await clerk.users.getUser(target);
    adresa = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? adresa;
  } catch (err) {
    if (clerkStatus(err) !== 404) throw err instanceof Error ? err : new Error(String(err));
    // Naloga u Clerku nema. Ako profil ima adresu, mejl svejedno ima kuda.
  }

  if (!adresa) {
    return { ok: false, status: 409, poruka: "Taj nalog nema mejl adresu, pa poruka nema kuda." };
  }

  const ishod = await posaljiPorukuKorisniku({ za: adresa, naslov, telo: poruka });

  if (!ishod.ok) {
    return {
      ok: false,
      status: 502,
      poruka: `Mejl nije otišao: ${ishod.greska}`,
      payload: { naslov, mejl: adresa },
    };
  }

  return {
    ok: true,
    poruka: `Poruka je poslata na ${adresa}. Odgovor stiže na moju adresu.`,
    // Sadržaj poruke NIJE u dnevniku. Naslov i dužina kažu šta je poslato, a
    // dnevnik radnji nije arhiva prepiske — za to postoji sam inboks.
    payload: { naslov, znakova: poruka.length, mejl: adresa },
  };
}

/**
 * Brisanje naloga (§3.2, §4).
 *
 * Put je Clerk → webhook `user.deleted` → kaskada, i to je jedini put (pravilo
 * 15). Ova funkcija zato NE briše profil sama: baza prati Clerk, ne obrnuto, a
 * dva mesta koja brišu isti red su dva mesta koja se jednog dana raziđu.
 *
 * `potvrda` je mejl koji je admin otkucao. Poredi se sa mejlom IZ CLERKA, ne sa
 * onim iz `profiles`: profil čuva mejl od registracije, a čovek je u međuvremenu
 * mogao da ga promeni — potvrda mora da se odnosi na nalog koji se stvarno briše.
 *
 * ── nalog kog u Clerku više nema ─────────────────────────────
 * §6 opisuje slučaj „brisanje prošlo u Clerku, webhook nije stigao": profil tada
 * ostaje zauvek, a konzola nema čime da ga ukloni. Zato tada poređenje ide sa
 * `profiles.email` i profil se briše direktno — to je jedini put koji preostaje
 * i jedini slučaj u kom se od pravila 15 odstupa, jer Clerk strane tog pravila
 * više ne postoji.
 */
export async function obrisiNalog(
  actor: string,
  target: string,
  potvrda: string,
): Promise<Ishod> {
  if (actor === target) {
    return { ok: false, status: 409, poruka: "Sebe ne možeš da obrišeš." };
  }

  const cilj = await citajCilj(target);
  if (!cilj) return NEMA_NALOGA;

  const clerk = await clerkClient();

  let mejlUClerku: string | null = null;
  let uClerku = true;

  try {
    const u = await clerk.users.getUser(target);
    mejlUClerku =
      u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null;
  } catch (err) {
    if (clerkStatus(err) !== 404) throw err instanceof Error ? err : new Error(String(err));
    uClerku = false;
  }

  const stvarni = (uClerku ? mejlUClerku : cilj.email)?.trim().toLowerCase() ?? null;

  if (!stvarni) {
    return {
      ok: false,
      status: 409,
      poruka: "Taj nalog nema mejl, pa potvrda ne može da se proveri.",
    };
  }

  if (potvrda.trim().toLowerCase() !== stvarni) {
    // Otkucani mejl NE ulazi u dnevnik: to je tuđa adresa koju je neko pogrešno
    // uneo, i nema razloga da ostane zapisana.
    return { ok: false, status: 400, poruka: "Otkucani mejl se ne poklapa sa mejlom naloga." };
  }

  if (!uClerku) {
    const { error } = await adminSupabase().from("profiles").delete().eq("id", target);
    if (error) throw new Error(error.message);

    return {
      ok: true,
      poruka: "Naloga u Clerku više nije bilo; profil i svi njegovi redovi su obrisani.",
      payload: { email: stvarni, put: "baza" },
    };
  }

  await clerk.users.deleteUser(target);

  return {
    ok: true,
    // Kaskadu radi webhook, i to obično za sekund-dva. Poruka to kaže naglas —
    // admin koji odmah osveži listu i vidi profil ne sme da pomisli da je palo.
    poruka: "Nalog je obrisan u Clerku. Profil i svi njegovi redovi nestaju kroz webhook.",
    payload: { email: stvarni, put: "clerk" },
  };
}
