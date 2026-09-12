// apps/web/src/lib/admin-utisci.ts
// Čitanje za `/admin/utisci` (F11 §6.6).
//
// Isti obrazac kao `admin-korisnici.ts`: sve ide kroz `adminSupabase()`, jer
// `feedback` ima RLS `using (false)` (pravilo 10) i nijedan korisnički token ga
// ne vidi. Zaštita je ISKLJUČIVO `requireAdminPage()` / `requireAdminRoute()` u
// pozivaocu — nijedna funkcija odavde ne sme da se pozove pre te provere.
//
// ── zašto ovde nema nijednog Clerk poziva ────────────────────
// Za razliku od liste korisnika, ovde nije potrebno ime ni avatar: kolona „ko"
// nosi mejl iz `profiles`, koji je već u bazi. Ekran za obradu prijava ne sme da
// zavisi od trećeg servisa da bi se iscrtao — isti razlog kao za `/admin`
// pregled.

import "server-only";
import type {
  AdminFali,
  ChangelogRow,
  FeedbackRow,
  FeedbackStatus,
} from "@sajtoskop/shared";
import { adminSupabase } from "./supabase";

/** Stranica po 25, isto kao lista korisnika i revizija. */
export const PO_STRANI = 25;

/**
 * Statusi koji znače „ovo još nije obrađeno".
 *
 * Isti spisak koji `admin_overview` koristi za „otvorene bugove" — kad bi se
 * razišli, filter na ekranu i kartica u pregledu bi brojali dve različite stvari.
 */
export const OTVORENI_STATUSI: readonly FeedbackStatus[] = ["novo", "priznato", "u_radu"];

/** Statusi posle kojih prijava ima ishod. Prelazak u njih upisuje `resolved_at`. */
export const ZAVRSNI_STATUSI: readonly FeedbackStatus[] = ["reseno", "odbijeno", "duplikat"];

export type UpitUtisaka = {
  /** `''` = svi; `'otvoreno'` = spisak iz `OTVORENI_STATUSI`; inače jedan status. */
  status: string;
  /**
   * Sloj je `feedback.source` — dugme, podsetnik, pitanje, kampanja, incident.
   *
   * [S29] Dva pseudo-sloja uz njih: `'fali'` i `'citat'`. Nisu izvori nego
   * POGLEDI, i zato dele isti filter umesto da dobiju svoju traku: čovek koji
   * traži „šta ljudima fali" bira jednu stvar sa jednog mesta, a ne dve.
   *
   *   - `'citat'` je običan filter nad redovima (`answers->>'citat'` postoji)
   *   - `'fali'` menja ceo prikaz: umesto 25 pojedinačnih redova ide zbirna
   *     lista iz `admin_fali()`, jer je kod tog pitanja zanimljivo šta se
   *     PONAVLJA, a ne ko je to napisao u utorak
   */
  sloj: string;
  /** `'1' | '2' | '3'`, ili `'bez'` za odgovore na pitanja (nemaju ocenu). */
  ocena: string;
  /** Clerk ID (`user_…`) ili deo mejla. */
  korisnik: string;
  strana: number;
};

export type RedUtiska = FeedbackRow & {
  /** Iz `profiles`, ne iz Clerka. `null` kad profil nema mejl. */
  email: string | null;
};

export type ListaUtisaka = {
  redovi: RedUtiska[];
  ukupno: number;
  strana: number;
  strana_max: number;
  /**
   * Filter po korisniku je tražen, ali nijedan profil ne odgovara. Razlikuje se
   * od „nema utisaka": prazna lista zbog pogrešno otkucanog mejla i prazna lista
   * zato što čovek ćuti su dva različita zaključka.
   */
  nemaKorisnika: boolean;
};

/**
 * Lista prijava, filtrirana i paginirana u bazi.
 *
 * Filtriranje radi Postgres, a ne pregledač: klijent koji filtrira 25 dobijenih
 * redova ne zna koliko ih ima iza, pa bi paginacija lagala.
 */
export async function citajUtiske(upit: UpitUtisaka): Promise<ListaUtisaka> {
  const db = adminSupabase();
  const strana = Math.max(1, upit.strana);
  const od = (strana - 1) * PO_STRANI;

  // ── filter po korisniku ───────────────────────────────────
  // Clerk ID ide direktno; sve ostalo je deo mejla, pa se prvo prevodi u ID-jeve.
  // Dva upita umesto ugnježđenog `profiles!inner(email)` — PostgREST to ume, ali
  // filter nad ugnježđenim resursom menja i značenje `count`-a, a paginacija tu
  // ne sme da bude „skoro tačna".
  let idKorisnika: string[] | null = null;

  const trazen = upit.korisnik.trim();
  if (trazen) {
    if (trazen.startsWith("user_")) {
      idKorisnika = [trazen];
    } else {
      const { data, error } = await db
        .from("profiles")
        .select("id")
        .ilike("email", `%${trazen}%`)
        .limit(200)
        .returns<{ id: string }[]>();

      if (error) throw new Error(`Traženje korisnika nije uspelo: ${error.message}`);
      idKorisnika = (data ?? []).map((p) => p.id);
    }
  }

  if (idKorisnika !== null && idKorisnika.length === 0) {
    return { redovi: [], ukupno: 0, strana: 1, strana_max: 1, nemaKorisnika: true };
  }

  let q = db
    .from("feedback")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(od, od + PO_STRANI - 1);

  if (upit.status === "otvoreno") q = q.in("status", [...OTVORENI_STATUSI]);
  else if (upit.status) q = q.eq("status", upit.status);

  // [S29] `citat` je pogled nad redovima, ne sloj: traže se odgovori na
  // `prvi-potpisan` kod kojih je treći korak dao dozvolu. `fali` ovde ne stiže
  // — za njega strana zove `citajFali()` i crta drugu listu.
  if (upit.sloj === "citat") q = q.not("answers->>citat", "is", null);
  else if (upit.sloj && upit.sloj !== "fali") q = q.eq("source", upit.sloj);

  // „Bez ocene" je odgovor na pitanje: kampanjski i kontekstualni zapisi nemaju
  // ocenu nego odgovor (0011, `rating` je nullable).
  if (upit.ocena === "bez") q = q.is("rating", null);
  else if (upit.ocena) q = q.eq("rating", Number(upit.ocena));

  if (idKorisnika) q = q.in("user_id", idKorisnika);

  const { data, error, count } = await q.returns<FeedbackRow[]>();
  if (error) throw new Error(`Čitanje utisaka nije uspelo: ${error.message}`);

  const redovi = data ?? [];
  const ukupno = count ?? 0;

  return {
    redovi: await saMejlovima(redovi),
    ukupno,
    strana,
    strana_max: Math.max(1, Math.ceil(ukupno / PO_STRANI)),
    nemaKorisnika: false,
  };
}

/**
 * Zbirna lista „Šta ti ovde fali" (S29 §5.3 C), iz `admin_fali()` (0027).
 *
 * Grupisanje po tekstu radi Postgres, ne TS: lista koja se grupiše u pregledaču
 * grupiše samo ono što je na tekućoj stranici, pa bi „filter po recenzijama"
 * ispao dvaput sa brojem 2 i 1 umesto jednom sa 3.
 *
 * `p_route` sužava na jedan ekran. Prazan string i `null` znače „sve" — filter
 * koji ne filtrira nije greška.
 */
export async function citajFali(ruta = ""): Promise<AdminFali[]> {
  const { data, error } = await adminSupabase().rpc("admin_fali", {
    p_route: ruta.trim() || null,
  });

  if (error) throw new Error(`Čitanje „Fali" liste nije uspelo: ${error.message}`);
  return (data ?? []) as AdminFali[];
}

/**
 * Mejlovi za celu stranicu, JEDNIM upitom.
 *
 * Nikad po redu: 25 upita po učitavanju liste je tačno ona N+1 petlja koju F12
 * §3.1 zabranjuje za korisnike, i ovde važi isto.
 */
async function saMejlovima(redovi: FeedbackRow[]): Promise<RedUtiska[]> {
  if (redovi.length === 0) return [];

  const ids = [...new Set(redovi.map((r) => r.user_id))];

  const { data, error } = await adminSupabase()
    .from("profiles")
    .select("id, email")
    .in("id", ids)
    .returns<{ id: string; email: string | null }[]>();

  // Mejl je ukras u listi; bez njega red i dalje nosi sve što nosi.
  if (error) console.error("[admin] mejlovi uz utiske:", error.message);

  const poId = new Map((data ?? []).map((p) => [p.id, p.email]));
  return redovi.map((r) => ({ ...r, email: poId.get(r.user_id) ?? null }));
}

// ── detalj ───────────────────────────────────────────────────

/** Stavka Beta dnevnika ponuđena za vezivanje (F11 §6.6, „poveži sa stavkom"). */
export type StavkaDnevnika = Pick<
  ChangelogRow,
  "id" | "title" | "kind" | "shipped_at" | "from_feedback"
>;

export type DetaljUtiska = {
  red: RedUtiska;
  /**
   * Potpisan URL slike, TTL 10 minuta, napravljen U OVOM trenutku (§4).
   *
   * `null` je i „nema slike" i „Storage nije odgovorio" — razliku nosi
   * `red.screenshot_path`, koji je tada i dalje popunjen.
   */
  slikaUrl: string | null;
  /** Poslednje stavke dnevnika, za padajući spisak. CRUD nad njima je F11.4. */
  dnevnik: StavkaDnevnika[];
  /** Koliko je utisaka isti čovek poslao ukupno — kontekst uz jednu prijavu. */
  ukupnoOdKorisnika: number;
  /**
   * [S29 §5.3 D] Poslovi na koje se prijava odnosi, pročitani PRI PRIKAZU.
   *
   * Namerno nisu u `ctx`: status posla se menja i posle prijave (retry, žetva,
   * povraćaj), pa je zamrznut status u jsonb-u brojka koja laže već sutradan.
   * `ctx` pamti IDENTIFIKATOR, a ovaj `select` daje ono što je sada istina.
   */
  poslovi: PosaoUzPrijavu[];
};

/** Jedan posao uz prijavu — onaj iz `ctx.jobId` i/ili poslednji za taj prospekt. */
export type PosaoUzPrijavu = {
  id: number;
  type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
  /** `ctx` ga je imenovao, ili je nađen po `payload->>'placeId'`. */
  izvor: "ctx" | "prospekt";
};

/**
 * Jedna prijava sa svime što panel prikazuje.
 *
 * `null` znači da zapisa nema. Ruta i strana iz toga prave `404`, isto kao za
 * sve ostalo pod `/admin` — postojanje ID-ja nije informacija koja se odaje.
 */
export async function citajUtisak(
  id: number,
  potpisi: (path: string) => Promise<string | null>,
): Promise<DetaljUtiska | null> {
  const db = adminSupabase();

  const { data: red, error } = await db
    .from("feedback")
    .select("*")
    .eq("id", id)
    .maybeSingle<FeedbackRow>();

  if (error) throw new Error(`Čitanje utiska nije uspelo: ${error.message}`);
  if (!red) return null;

  const [profil, dnevnik, ukupno] = await Promise.all([
    db
      .from("profiles")
      .select("email")
      .eq("id", red.user_id)
      .maybeSingle<{ email: string | null }>(),
    db
      .from("changelog")
      .select("id, title, kind, shipped_at, from_feedback")
      .order("shipped_at", { ascending: false })
      .limit(30)
      .returns<StavkaDnevnika[]>(),
    db
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", red.user_id),
  ]);

  if (dnevnik.error) console.error("[admin] stavke dnevnika:", dnevnik.error.message);

  // Potpis se pravi TEK ovde, u trenutku otvaranja detalja (§4). Funkcija se
  // prosleđuje da bi ovaj modul ostao čitanje iz baze, bez Storage-a u sebi.
  const slikaUrl = red.screenshot_path ? await potpisi(red.screenshot_path) : null;

  return {
    red: { ...red, email: profil.data?.email ?? null },
    slikaUrl,
    dnevnik: dnevnik.data ?? [],
    ukupnoOdKorisnika: ukupno.count ?? 0,
    poslovi: await posloviZaPrijavu(red.ctx),
  };
}

/** Kolone posla koje panel prikazuje. `payload` se NE čita — u njemu je i upit. */
const POLJA_POSLA = "id, type, status, attempts, last_error, created_at, finished_at";

/**
 * Poslovi uz jednu prijavu (§5.3 D), najviše dva upita i samo kad ima šta.
 *
 * Dva puta do posla, jer prijava dolazi sa dva različita mesta:
 *
 *   1. `ctx.jobId` — čovek je prijavio palo SKENIRANJE i broj posla je znao
 *   2. `ctx.placeId` — čovek je prijavio grešku na KARTICI, i tu broj ne zna;
 *      §5.3 D traži „poslednji `enrich_full` posao" po `payload->>'placeId'`
 *
 * Ovo je admin put: `feedback` ima RLS `using (false)` (pravilo 10) i do ovde
 * se stiže samo kroz `requireAdminPage()`. Zato ovde NEMA provere vlasništva
 * posla — admin sme da vidi svaki, i to je cela razlika u odnosu na to da je
 * status upisan u `ctx` pri prijavi.
 *
 * Pad bilo kog od dva upita znači blok „Kontekst" bez tog reda, ne pala strana:
 * prijava se čita i kad `job_queue` ćuti.
 */
async function posloviZaPrijavu(ctx: FeedbackRow["ctx"]): Promise<PosaoUzPrijavu[]> {
  const db = adminSupabase();
  const nadjeni: PosaoUzPrijavu[] = [];

  const jobId = typeof ctx.jobId === "number" ? ctx.jobId : Number(ctx.jobId ?? Number.NaN);
  if (Number.isInteger(jobId) && jobId > 0) {
    const { data, error } = await db
      .from("job_queue")
      .select(POLJA_POSLA)
      .eq("id", jobId)
      .maybeSingle<Omit<PosaoUzPrijavu, "izvor">>();

    if (error) console.error("[admin] posao uz prijavu:", error.message);
    else if (data) nadjeni.push({ ...data, izvor: "ctx" });
  }

  if (ctx.placeId) {
    const { data, error } = await db
      .from("job_queue")
      .select(POLJA_POSLA)
      .eq("type", "enrich_full")
      .eq("payload->>placeId", ctx.placeId)
      .order("id", { ascending: false })
      .limit(1)
      .returns<Omit<PosaoUzPrijavu, "izvor">[]>();

    if (error) console.error("[admin] enrich posao za prospekt:", error.message);
    else {
      const posao = (data ?? [])[0];
      // Isti posao već stoji gore kad je prijava nosila i broj i prospekt.
      if (posao && !nadjeni.some((p) => p.id === posao.id)) {
        nadjeni.push({ ...posao, izvor: "prospekt" });
      }
    }
  }

  return nadjeni;
}

// ── oznake ───────────────────────────────────────────────────

/**
 * Oznake koje već postoje u tabeli — pune padajući spisak u panelu.
 *
 * Isti razlog kao `citajRadnje()` za reviziju: ručno održavan spisak stringova
 * se razilazi sa podacima čim se doda prva nova oznaka. Slobodan unos ostaje —
 * ovo je predlog, ne enum.
 */
export async function citajOznake(): Promise<string[]> {
  // Bez filtera nad `text[]`: PostgREST ga ume, ali oblik zapisa niza u upitu je
  // tačno ona sitnica koja radi u testu a pukne nad pravim podacima. Tabela je u
  // beti mala, pa se prazni nizovi jeftinije izbace ovde.
  const { data, error } = await adminSupabase()
    .from("feedback")
    .select("tags")
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<{ tags: string[] }[]>();

  if (error) {
    console.error("[admin] spisak oznaka:", error.message);
    return [];
  }

  return [...new Set((data ?? []).flatMap((r) => r.tags))].sort();
}
