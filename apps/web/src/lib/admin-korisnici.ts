// apps/web/src/lib/admin-korisnici.ts
// Čitanje za `/admin/korisnici` i `/admin/korisnici/[id]` (F12 §3.1 i §3.2).
//
// Sve ide kroz `adminSupabase()`, jer konzola po definiciji čita tuđe redove, a
// RLS to ne pušta nijednim korisničkim tokenom. Zaštita je zato ISKLJUČIVO
// `requireAdminPage()` / `requireAdminRoute()` u pozivaocu — bez nje je ovaj
// modul otvorena baza. Nijedna funkcija odavde ne sme da se pozove pre te
// provere.
//
// ── dva izvora, dva režima kvara ─────────────────────────────
// Baza zna plan, kredite i brojeve; Clerk zna ime, avatar, poslednju prijavu i
// blokadu. Clerk je mreža i ume da ne odgovori — kad ne odgovori, lista se i
// dalje prikazuje, a kolone iz Clerka nose crticu i jednu rečenicu zašto
// (F12 §6). Nikad obrnuto: pad Clerka ne sme da sakrije ko je u bazi.

import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type {
  AdminAuditRow,
  AdminUserRow,
  CreditLedgerRow,
  FeedbackRow,
  JobQueueRow,
  LeadStatusValue,
  PretplataZaPristup,
  Pristup,
  ProfileRow,
  SearchRow,
  StanjeId,
} from "@sajtoskop/shared";
import { stanjePristupa } from "@sajtoskop/shared";
import { adminBootstrapIds } from "./env";
import { adminSupabase } from "./supabase";
import { inGrupe } from "./upiti";

/** Stranica po 25 (F12 §3.1). Menja se ovde i nigde više. */
export const PO_STRANI = 25;

export type FilterKorisnika = "svi" | "aktivni7" | "admini" | "bez_aktivnosti";
export type SortKorisnika = "created_at" | "credits" | "unlocks" | "last_seen";
export type Smer = "asc" | "desc";

export type UpitKorisnika = {
  q: string;
  filter: FilterKorisnika;
  plan: string;
  /** Jedno od šest stanja pristupa, ili `""` za „sva" (S20). */
  stanje: StanjeId | "";
  sort: SortKorisnika;
  smer: Smer;
  strana: number;
};

/**
 * Ulazi za `stanjePristupa()` onako kako ih vraća `admin_users_page` (0024).
 *
 * Funkcija se zove u TS-u, nad redom iz baze — nikad u SQL-u. Kolona „stanje" u
 * konzoli mora da pokazuje ISTO ono što kapija zaključuje, a to je moguće samo
 * ako je računica jedna (LANSIRANJE §1.5).
 */
export function pristupIzReda(r: AdminUserRow): Pristup {
  const pretplata: PretplataZaPristup | null = r.sub_status
    ? { status: r.sub_status, currentPeriodEnd: r.sub_period_end, canceledAt: r.sub_canceled_at }
    : null;

  return stanjePristupa(
    {
      plan: r.plan,
      betaExpiresAt: r.beta_expires_at,
      planExpiresAt: r.plan_expires_at,
      creditsTopup: r.credits_topup,
    },
    pretplata,
    Date.now(),
  );
}

/**
 * Koliko naloga se najviše čita pri filtriranju po stanju.
 *
 * Filter po stanju ne može u SQL — to bi bila druga implementacija šest stanja
 * (v. komentar uz `admin_users_page` u 0024). Zato se ULAZI pročitaju ovde,
 * stanje se izračuna istom TS funkcijom koju zovu i kapije, i u bazu se vrati
 * spisak ID-jeva; paginacija time ostaje tačna, jer je i dalje u SQL-u.
 *
 * Granica postoji zato što je ovo jedini upit u konzoli koji ne stane u
 * stranicu. Pet hiljada naloga je red veličine iznad svakog broja iz
 * LANSIRANJE §1.3 („60–100 korisnika u normalnom režimu"); kad se približi,
 * filter po stanju traži materijalizovanu kolonu, a ne veći broj ovde.
 */
const MAX_ZA_FILTER_STANJA = 5000;

/**
 * ID-jevi naloga koji su u traženom stanju.
 *
 * Dva laka upita: `profiles` bez ijednog agregata i `subscriptions` u celini.
 * Nijedan ne dodiruje `unlocks`, `searches` ni `feedback` — te brojeve računa
 * `admin_users_page` tek nad suženim spiskom.
 */
async function idjeviUStanju(stanje: StanjeId): Promise<string[]> {
  const db = adminSupabase();
  const sada = Date.now();

  const [profili, pretplate] = await Promise.all([
    db
      .from("profiles")
      .select("id, plan, beta_expires_at, plan_expires_at, credits_topup")
      .limit(MAX_ZA_FILTER_STANJA)
      .returns<
        {
          id: string;
          plan: string;
          beta_expires_at: string | null;
          plan_expires_at: string | null;
          credits_topup: number;
        }[]
      >(),
    db
      .from("subscriptions")
      .select("user_id, status, current_period_end, canceled_at")
      // Merodavna je ona koja traje najduže — isti izbor kao u `citajPretplatu()`.
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .limit(MAX_ZA_FILTER_STANJA)
      .returns<
        {
          user_id: string;
          status: PretplataZaPristup["status"];
          current_period_end: string | null;
          canceled_at: string | null;
        }[]
      >(),
  ]);

  if (profili.error) throw new Error(`Filter po stanju nije uspeo: ${profili.error.message}`);
  if (pretplate.error) {
    // Pad ovog upita ne sme da isprazni listu. Bez pretplata se `otkazan` ne
    // razlikuje od `aktivan`, ali sve ostalo je i dalje tačno.
    console.error("[admin] pretplate za filter stanja:", pretplate.error.message);
  }

  const poKorisniku = new Map<string, PretplataZaPristup>();
  for (const s of pretplate.data ?? []) {
    // Spisak je već sortiran opadajuće — prvi red po korisniku je merodavan.
    if (poKorisniku.has(s.user_id)) continue;
    poKorisniku.set(s.user_id, {
      status: s.status,
      currentPeriodEnd: s.current_period_end,
      canceledAt: s.canceled_at,
    });
  }

  return (profili.data ?? [])
    .filter(
      (p) =>
        stanjePristupa(
          {
            plan: p.plan,
            betaExpiresAt: p.beta_expires_at,
            planExpiresAt: p.plan_expires_at,
            creditsTopup: p.credits_topup,
          },
          poKorisniku.get(p.id) ?? null,
          sada,
        ).stanje === stanje,
    )
    .map((p) => p.id);
}

/**
 * Podaci koje o korisniku zna samo Clerk.
 *
 * `null` na celom objektu znači „Clerk nije odgovorio", i to je stanje koje se
 * prikazuje — a ne prazna vrednost koja izgleda kao „nema ime".
 */
export type ClerkPodaci = {
  ime: string | null;
  avatar: string | null;
  poslednjaPrijava: string | null;
  blokiran: boolean;
  zakljucan: boolean;
};

export type RedKorisnika = AdminUserRow & {
  clerk: ClerkPodaci | null;
  /**
   * Stanje pristupa, izračunato istom funkcijom koju zovu kapije (§1.5).
   *
   * Stoji u redu, a ne u komponenti, iz istog razloga iz kog `bootstrap` stoji
   * ovde: prikaz ne sme da bude mesto na kome se odluka o pristupu (ponovo)
   * donosi.
   */
  pristup: Pristup;
  /**
   * Admin je kroz `ADMIN_BOOTSTRAP_IDS`, a ne kroz `profiles.role`.
   *
   * Prvi admin je uvek takav (odluka 1 i 2): njegov Clerk ID ne ide u migraciju,
   * pa mu je uloga u bazi `'user'` iako u konzolu ulazi. Bez ovog polja bi lista
   * tvrdila da admina nema.
   *
   * Sam spisak iz env-a se i dalje nigde ne ispisuje (§1) — vidi se samo da li
   * je JEDAN već prikazani red u njemu, i to isključivo drugom adminu.
   */
  bootstrap: boolean;
  /**
   * Postoji li nalog u Clerku. `null` znači da Clerk nije odgovorio, pa se ne zna
   * — to nije isto što i „nema ga" i ne sme da se prikaže isto (F12 §6).
   */
  uClerku: boolean | null;
};

export type ListaKorisnika = {
  redovi: RedKorisnika[];
  ukupno: number;
  strana: number;
  strana_max: number;
  /** Rečenica o tome zašto kolone iz Clerka nose crticu. `null` kad je sve u redu. */
  clerkGreska: string | null;
};

/**
 * Lista korisnika: JEDAN upit u bazu i JEDAN poziv Clerku za celu stranicu
 * (F12 §8).
 *
 * Agregat, filteri, sortiranje i ukupan broj dolaze iz `admin_users_page`
 * (migracija 0012). PostgREST to ne ume u jednom zahtevu — v. obrazloženje uz
 * funkciju.
 */
export async function citajKorisnike(upit: UpitKorisnika): Promise<ListaKorisnika> {
  const strana = Math.max(1, upit.strana);
  const bootstrap = adminBootstrapIds();

  // Filter po stanju se rešava PRE upita: stanje se ne računa u SQL-u, pa se u
  // bazu šalje spisak ID-jeva koji mu odgovaraju (v. `idjeviUStanju`).
  // `null` je „bez sužavanja"; prazan niz je legitiman ishod „nijedan nalog nije
  // u tom stanju" i mora da vrati praznu listu, a ne celu.
  const ids = upit.stanje ? await idjeviUStanju(upit.stanje) : null;

  const { data, error } = await adminSupabase().rpc("admin_users_page", {
    p_q: upit.q || null,
    p_filter: upit.filter,
    p_plan: upit.plan || null,
    p_sort: upit.sort,
    p_dir: upit.smer,
    p_limit: PO_STRANI,
    p_offset: (strana - 1) * PO_STRANI,
    // Filter „Admini" mora da vidi i onoga ko je admin samo iz env-a (0014).
    p_bootstrap: bootstrap,
    p_ids: ids,
  });

  if (error) throw new Error(`Čitanje liste korisnika nije uspelo: ${error.message}`);

  const redovi = (data ?? []) as AdminUserRow[];
  const ukupno = redovi[0]?.ukupno ?? 0;

  const { poId, greska, odgovorio } = await citajIzClerka(redovi.map((r) => r.id));

  return {
    redovi: redovi.map((r) => ({
      ...r,
      clerk: poId.get(r.id) ?? null,
      bootstrap: bootstrap.includes(r.id),
      uClerku: odgovorio ? poId.has(r.id) : null,
      pristup: pristupIzReda(r),
    })),
    ukupno,
    strana,
    strana_max: Math.max(1, Math.ceil(ukupno / PO_STRANI)),
    clerkGreska: greska,
  };
}

// ── detalj ───────────────────────────────────────────────────

export type StavkaLedgera = Pick<
  CreditLedgerRow,
  "id" | "delta" | "reason" | "ref_id" | "created_at"
>;

export type StavkaPretrage = Pick<
  SearchRow,
  "id" | "city_slug" | "niche_slug" | "source" | "results_count" | "created_at"
>;

export type StavkaOtkljucanog = {
  place_id: string;
  created_at: string;
  naziv: string | null;
};

export type StavkaPosla = Pick<JobQueueRow, "id" | "type" | "status" | "created_at">;

export type StavkaUtiska = Pick<
  FeedbackRow,
  "id" | "rating" | "kind" | "status" | "prompt_key" | "message" | "created_at"
>;

export type DetaljKorisnika = {
  profil: ProfileRow;
  /**
   * Najsvežija pretplata, svedena na ono što odluka o pristupu koristi.
   * `null` znači „nikad je nije ni bilo" — beta i dopuna nemaju pretplatu.
   */
  pretplata: PretplataZaPristup | null;
  /**
   * Stanje pristupa i IZVEDENI datumi (`punDo`, `citanjeDo`).
   *
   * Blok „Pristup" ih samo ispisuje. Sabiranje `beta_expires_at` i
   * `plan_expires_at` na strani bi bila druga računica o pristupu — tačno ono
   * što §1.5 zabranjuje, i to na ekranu sa kog se pristup dodeljuje.
   */
  pristup: Pristup;
  clerk: ClerkPodaci | null;
  clerkGreska: string | null;
  /** Admin je iz env-a, ne iz `profiles.role` — v. `RedKorisnika.bootstrap`. */
  bootstrap: boolean;
  /** `null` = Clerk nije odgovorio; `false` = naloga tamo više nema (§6). */
  uClerku: boolean | null;
  ledger: StavkaLedgera[];
  otkljucani: StavkaOtkljucanog[];
  pretrage: StavkaPretrage[];
  poslovi: StavkaPosla[];
  /** Broj leadova po koloni kanbana. Kolone bez ijednog leada se ne pojavljuju. */
  pipeline: { status: LeadStatusValue; broj: number }[];
  utisci: StavkaUtiska[];
};

/**
 * Četiri bloka sa `/admin/korisnici/[id]` (F12 §3.2), samo čitanje.
 *
 * `null` znači da profila nema — ruta iz toga pravi `404`, isto kao za sve
 * ostalo pod `/admin`. Postojanje naloga nije informacija koja se odaje ni
 * adminu koji je pogrešio ID, jer se ta strana ne razlikuje od one koju vidi
 * neko ko tu nema šta da traži.
 */
export async function citajKorisnika(id: string): Promise<DetaljKorisnika | null> {
  const db = adminSupabase();

  const { data: profil, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(`Čitanje profila nije uspelo: ${error.message}`);
  if (!profil) return null;

  // Sedam nezavisnih čitanja, svih sedam odjednom. Nijedno ne zavisi od ishoda
  // drugog, pa bi redom bilo sedam čekanja umesto jednog.
  const [ledger, otkljucani, pretrage, poslovi, pipeline, utisci, pretplata] = await Promise.all([
    db
      .from("credit_ledger")
      .select("id, delta, reason, ref_id, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<StavkaLedgera[]>(),
    db
      .from("unlocks")
      .select("place_id, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<{ place_id: string; created_at: string }[]>(),
    db
      .from("searches")
      .select("id, city_slug, niche_slug, source, results_count, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<StavkaPretrage[]>(),
    // Posao nema `user_id` — vlasništvo je u `job_subscribers` (0003), jer se na
    // isti scan kači više korisnika. Zato ide preko ugnježđenog izbora.
    db
      .from("job_subscribers")
      .select("job_queue!inner(id, type, status, created_at)")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<{ job_queue: StavkaPosla }[]>(),
    db
      .from("lead_status")
      .select("status")
      .eq("user_id", id)
      .returns<{ status: LeadStatusValue }[]>(),
    db
      .from("feedback")
      .select("id, rating, kind, status, prompt_key, message, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<StavkaUtiska[]>(),
    // Isti izbor kao u `citajPretplatu()` iz `lib/pristup.ts`: više redova
    // postoji kad je korisnik menjao plan, a merodavan je onaj koji traje
    // najduže. Ne uvozim tu funkciju jer je memoizovana po ZAHTEVU i vezana za
    // korisnika iz sesije — ovde se čita TUĐI red.
    db
      .from("subscriptions")
      .select("status, current_period_end, canceled_at")
      .eq("user_id", id)
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .limit(1)
      .returns<
        {
          status: PretplataZaPristup["status"];
          current_period_end: string | null;
          canceled_at: string | null;
        }[]
      >(),
  ]);

  for (const [ime, r] of [
    ["knjiga", ledger],
    ["otključani", otkljucani],
    ["pretrage", pretrage],
    ["poslovi", poslovi],
    ["pipeline", pipeline],
    ["utisci", utisci],
    ["pretplata", pretplata],
  ] as const) {
    if (r.error) console.error(`[admin] ${ime}:`, r.error.message);
  }

  // Naziv prospekta je ukras nad `place_id`-jem, ali bez njega je blok
  // „Aktivnost" spisak neprozirnih stringova. `businesses` ima `using (false)`,
  // pa i to ide kroz admin klijent.
  const placeIds = (otkljucani.data ?? []).map((u) => u.place_id);
  const nazivi = new Map<string, string>();

  if (placeIds.length > 0) {
    // [Faza 2, 2.2] `.in()` u grupama — korisnik ume da ima stotine unlockova.
    for (const deo of inGrupe(placeIds)) {
      const { data: firme, error: bErr } = await db
        .from("businesses")
        .select("place_id, name")
        .in("place_id", deo)
        .returns<{ place_id: string; name: string }[]>();

      if (bErr) console.error("[admin] nazivi prospekata:", bErr.message);
      else for (const f of firme ?? []) nazivi.set(f.place_id, f.name);
    }
  }

  const poKoloni = new Map<LeadStatusValue, number>();
  for (const red of pipeline.data ?? []) {
    poKoloni.set(red.status, (poKoloni.get(red.status) ?? 0) + 1);
  }

  const { poId, greska, odgovorio } = await citajIzClerka([id]);

  const redPretplate = (pretplata.data ?? [])[0];
  const zaPristup: PretplataZaPristup | null = redPretplate
    ? {
        status: redPretplate.status,
        currentPeriodEnd: redPretplate.current_period_end,
        canceledAt: redPretplate.canceled_at,
      }
    : null;

  return {
    profil,
    pretplata: zaPristup,
    pristup: stanjePristupa(
      {
        plan: profil.plan,
        betaExpiresAt: profil.beta_expires_at,
        planExpiresAt: profil.plan_expires_at,
        creditsTopup: profil.credits_topup,
      },
      zaPristup,
      Date.now(),
    ),
    clerk: poId.get(id) ?? null,
    clerkGreska: greska,
    bootstrap: adminBootstrapIds().includes(id),
    uClerku: odgovorio ? poId.has(id) : null,
    ledger: ledger.data ?? [],
    otkljucani: (otkljucani.data ?? []).map((u) => ({
      place_id: u.place_id,
      created_at: u.created_at,
      naziv: nazivi.get(u.place_id) ?? null,
    })),
    pretrage: pretrage.data ?? [],
    poslovi: (poslovi.data ?? []).map((p) => p.job_queue),
    pipeline: [...poKoloni.entries()].map(([status, broj]) => ({ status, broj })),
    utisci: utisci.data ?? [],
  };
}

// ── revizija ─────────────────────────────────────────────────

export type ListaRevizije = {
  redovi: AdminAuditRow[];
  ukupno: number;
  strana: number;
  strana_max: number;
};

/** Dnevnik radnji, obrnuti hronološki red (F12 §3.5). */
export async function citajReviziju(opts: {
  action: string;
  korisnik: string;
  strana: number;
}): Promise<ListaRevizije> {
  const strana = Math.max(1, opts.strana);
  const od = (strana - 1) * PO_STRANI;

  let upit = adminSupabase()
    .from("admin_audit")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(od, od + PO_STRANI - 1);

  if (opts.action) upit = upit.eq("action", opts.action);
  if (opts.korisnik) upit = upit.eq("target_user", opts.korisnik);

  const { data, error, count } = await upit.returns<AdminAuditRow[]>();

  if (error) throw new Error(`Čitanje revizije nije uspelo: ${error.message}`);

  const ukupno = count ?? 0;

  return {
    redovi: data ?? [],
    ukupno,
    strana,
    strana_max: Math.max(1, Math.ceil(ukupno / PO_STRANI)),
  };
}

/**
 * Spisak radnji koje u dnevniku stvarno postoje — puni padajući filter.
 *
 * Bez ovoga bi filter bio ručno održavan spisak stringova koji se razilazi sa
 * kodom čim se doda prva nova radnja.
 */
export async function citajRadnje(): Promise<string[]> {
  const { data, error } = await adminSupabase()
    .from("admin_audit")
    .select("action")
    .order("action")
    .limit(1000)
    .returns<{ action: string }[]>();

  if (error) {
    console.error("[admin] spisak radnji:", error.message);
    return [];
  }

  return [...new Set((data ?? []).map((r) => r.action))].sort();
}

// ── Clerk ────────────────────────────────────────────────────

/**
 * Ime, avatar, poslednja prijava i blokada za do 100 korisnika — JEDNIM
 * pozivom (F12 §3.1). Nikad po korisniku: 25 poziva po učitavanju liste bi
 * značilo da se strana otvara sekundama.
 *
 * Pad se ne propagira. Konzola bez Clerkovih kolona je i dalje konzola; konzola
 * koja se ne otvori zato što je treći servis spor nije ništa.
 */
async function citajIzClerka(
  ids: string[],
): Promise<{ poId: Map<string, ClerkPodaci>; greska: string | null; odgovorio: boolean }> {
  const poId = new Map<string, ClerkPodaci>();
  if (ids.length === 0) return { poId, greska: null, odgovorio: true };

  try {
    const clerk = await clerkClient();
    const { data } = await clerk.users.getUserList({ userId: ids, limit: ids.length });

    for (const u of data) {
      poId.set(u.id, {
        ime: u.fullName ?? u.username ?? null,
        avatar: u.hasImage ? u.imageUrl : null,
        poslednjaPrijava: u.lastSignInAt ? new Date(u.lastSignInAt).toISOString() : null,
        blokiran: u.banned,
        zakljucan: u.locked,
      });
    }

    // `odgovorio` je ono što razlikuje „Clerk ćuti" od „tog naloga tamo nema".
    // ID koji je tražen a nije se vratio je profil koji je nadživeo svog Clerk
    // korisnika — brisanje iz Clerk konzole pre nego što je `user.deleted`
    // webhook postojao (F12 §6). Bez ove razlike oba stanja izgledaju isto:
    // prazne kolone i nikakvo objašnjenje.
    return { poId, greska: null, odgovorio: true };
  } catch (err) {
    console.error("[admin] Clerk lista korisnika:", err);
    return {
      poId,
      greska:
        "Clerk trenutno ne odgovara, pa ime, poslednja prijava i status blokade nisu učitani. Podaci iz baze su tačni.",
      odgovorio: false,
    };
  }
}
