// packages/shared/src/db.ts
// Oblik redova u bazi — snake_case, 1:1 sa supabase/migrations/0001_init.sql.
//
// Zašto postoji: supabase-js bez generika vraća `any`, a `any` je zabranjen u
// novom kodu. Ovo je ručno pisan minimum umesto generisanih tipova, jer
// generator zahteva pokrenut Supabase i uvodi build korak koji nam ne treba.
//
// PRAVILO: kad menjaš migraciju, menjaš i ovaj fajl. Ako se raziđu, `tsc` to
// neće uhvatiti — baza ne proverava TypeScript.
//
// Camel-case oblici (`PlaceRecord`, `AuditRecord`) su u `types.ts` i koriste se
// u domenskoj logici. Ovi ovde se koriste na granici sa bazom.

import type { AiIssue, PhoneKind, Platform, Signal, SiteStatus, UglyBand } from "./types";

/**
 * Dve uloge dok postoji jedan čovek (F12 §9: bez `support` i `read-only`).
 * Vrednosti su iste kao u `profiles_role_valid`.
 */
export type AdminRole = "user" | "admin";

export type ProfileRow = {
  id: string;
  email: string | null;
  plan: string;
  /**
   * Kasa koja ISTIČE: pretplata, beta, admin dodela, utisak. `grant_monthly_credits`
   * je POSTAVLJA na ciljnu vrednost svakog meseca — bez rollovera (migracija 0004).
   *
   * Sme da bude negativna posle povraćaja paketa čiji su krediti već potrošeni;
   * donji prag je -1000, ne 0 (migracija 0022 §1). Nijedna putanja potrošnje je
   * ne gura u minus.
   */
  credits_balance: number;
  /**
   * Kasa koja NE ISTIČE: krediti kupljeni u paketu (LANSIRANJE §1.4).
   * Mesečna dodela je ne dodiruje. Uvek >= 0.
   *
   * Prikazano stanje kredita je ZBIR obe kase; razbijeno na dva reda samo na
   * ekranu `/krediti` (to je S21).
   */
  credits_topup: number;
  cache_miss_day: string | null;
  cache_miss_count: number;
  /** Dnevni cap na CSV export (F4 §5). Isti LA dan kao `cache_miss_day`. */
  export_day: string | null;
  export_count: number;
  /**
   * Dnevni cap na „Napiši drugačije" varijante (LANSIRANJE §1.3, migracija 0022).
   * Isti oblik i isti LA dan kao `export_day`. Kapija je `claim_ai_rewrite`.
   */
  ai_rewrite_day: string | null;
  ai_rewrite_count: number;
  /**
   * Kad je korisniku prikazan podsetnik za utisak (F10, migracija 0010).
   * `null` znači „još nije viđen". Stoji u bazi, a ne u `localStorage`-u, da
   * isti čovek na drugom računaru ne bi dobio isti prozor iznova.
   */
  feedback_prompted_at: string | null;

  /**
   * Stanje motora pitanja (F11, migracija 0011).
   *
   * Stoji na profilu, a ne u zasebnoj tabeli, zato što `(app)/layout.tsx` profil
   * ionako čita — globalni cooldown je time besplatan na svakom učitavanju
   * (F11 §3.3). `feedback_unseen_count` puni tek F11.4.
   */
  feedback_cooldown_until: string | null;
  feedback_muted_until: string | null;
  feedback_dismiss_streak: number;
  feedback_unseen_count: number;

  /**
   * Uloga (F12, migracija 0012). Izvor istine za to ko je admin; `ADMIN_BOOTSTRAP_IDS`
   * je rezerva iz env-a i u ovoj koloni se ne vidi (F12 §1).
   */
  role: AdminRole;
  /**
   * Poslednji dolazak, upisan iz `(app)/layout.tsx` kroz `after()`, najviše
   * jednom na sat (F12 §3.1). `null` znači da korisnik od uvođenja kolone nije
   * otvorio nijedan ekran.
   */
  last_seen_at: string | null;

  /**
   * Naplata (migracija 0022). Sve tri kolone se u S16 samo stvaraju — puni ih
   * webhook iz S18, a čita ih kapija pristupa iz S19.
   *
   * `beta_expires_at = null` znači NEOGRANIČENA beta, ne „istekla".
   * Pun pristup traje do `max(beta_expires_at, plan_expires_at)`, a čitanje
   * još `GRACE_DAYS` posle toga (LANSIRANJE §1.5).
   */
  paddle_customer_id: string | null;
  plan_expires_at: string | null;
  beta_expires_at: string | null;

  created_at: string;
};

/**
 * Ogledalo Paddle pretplate (migracija 0022). Izvor istine je Paddle; ovo
 * postoji da kapija pristupa i ekran stanja ne moraju da zovu mrežu.
 */
export type SubscriptionRow = {
  paddle_subscription_id: string;
  user_id: string;
  paddle_customer_id: string | null;
  /** Paddle-ova lista, ograničena `subscriptions_status_valid`. */
  status: "active" | "trialing" | "past_due" | "paused" | "canceled";
  price_id: string | null;
  /** Samo plaćeni planovi. `beta` i `dopuna` nikad nemaju pretplatu. */
  plan: "starter" | "pro" | "advanced" | null;
  current_period_end: string | null;
  canceled_at: string | null;
  country_code: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Gruba brana idempotencije webhooka (migracija 0022). Fina brana je `ref_id`
 * u `credit_ledger` — Paddle transaction ID.
 */
export type BillingEventRow = {
  event_id: string;
  event_type: string;
  occurred_at: string | null;
  received_at: string;
};

export type BusinessRow = {
  place_id: string;
  country_code: string;
  city_slug: string;
  niche_slug: string | null;
  query_text: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  phone_type: PhoneKind | null;
  website_url: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  google_refreshed_at: string;
  first_seen_at: string;
};

export type WebsiteAuditRow = {
  id: string;
  place_id: string;
  audit_level: 1 | 2 | 3;
  site_status: SiteStatus;
  http_status: number | null;
  final_url: string | null;
  ugly_score: number | null;
  ugly_band: UglyBand | null;
  platform: Platform | null;
  signals: Signal[];
  emails: string[] | null;
  screenshot_desktop: string | null;
  screenshot_mobile: string | null;
  psi_mobile_score: number | null;
  /** Largest Contentful Paint u ms. Dodato u 0005. */
  psi_lcp_ms: number | null;
  ai_issues: AiIssue[] | null;
  ai_verdict: string | null;
  /**
   * Model je ocenio sajt kao uredan. Dodato u 0006.
   * `null` ≠ `false`: null znači da AI nije uspeo ili nije ni pozvan.
   */
  ai_solidan: boolean | null;
  enriched_at: string;
};

export type UnlockRow = {
  user_id: string;
  place_id: string;
  created_at: string;
};

/** `scan` je od F9: plaćeno skeniranje kombinacije koje nema u kešu (0009). */
export type CreditReason =
  | "unlock"
  | "scan"
  | "monthly_grant"
  | "admin"
  | "refund"
  /** Nagrada za utisak (F11, 0011). Ide isključivo kroz `grant_feedback_credits`. */
  | "feedback"
  /** Mesečna dodela iz plaćene pretplate (0022). Puni `credits_balance`. */
  | "subscription_grant"
  /** Kupljen paket kredita (0022). JEDINI razlog koji puni `credits_topup`. */
  | "credit_pack"
  /** Besplatan prvi unlock (F8 §2, dodat u 0022). `ref_id` je `user_id`. */
  | "onboarding";

export type CreditLedgerRow = {
  id: number;
  user_id: string;
  delta: number;
  reason: CreditReason;
  ref_id: string | null;
  created_at: string;
};

export type SearchRow = {
  id: number;
  user_id: string | null;
  country_code: string;
  city_slug: string;
  niche_slug: string | null;
  query_text: string | null;
  source: "cache" | "api";
  results_count: number | null;
  api_calls: number;
  created_at: string;
};

/**
 * Registar keširanih kombinacija (F9, migracija 0009). Jedini izvor istine o
 * tome da li pretraga košta.
 *
 * [S17] Uslov pogotka je od migracije 0023 DVOSTRUK: `last_scanned_at` mlađi od
 * `GOOGLE_TTL_DAYS` **i** `pages >= tražene dubine`. Sve ostalo košta onoliko
 * kredita koliko tražena dubina ima stranica (LANSIRANJE §1.2).
 */
export type SearchCacheRow = {
  country_code: string;
  city_slug: string;
  niche_slug: string;
  last_scanned_at: string;
  last_results_count: number;
  scan_count: number;
  last_job_id: number | null;
  created_at: string;
  /** [Faza 6, 6.4] Budžet je stao usred scana — kombinacija nije potpuna. */
  partial: boolean;
  /**
   * [S17] Koliko je STRANICA povukao poslednji scan (1–3, migracija 0023).
   *
   * Ovo je ono što keš pogodak čini uslovnim: zahtev za 3 stranice nad redom
   * skeniranim na 1 NIJE pogodak — 20 redova nije 60. Isti broj je i cena koja
   * je za taj red plaćena.
   */
  pages: number;
};

export type JobType =
  | "scan"
  | "enrich_basic"
  | "enrich_full"
  | "refresh_google"
  | "monthly_grant"
  /** F7 §2: „Napiši drugačije" — AI varijanta outreach poruke (0008). */
  | "rewrite_message";
export type JobStatus = "pending" | "running" | "done" | "failed";

export type JobQueueRow = {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
  /** [Faza 6, 6.6] Ključ deduplikacije (0003) — pre je postojao samo u SQL-u. */
  dedupe_key: string | null;
  /** [Faza 6, 6.6] Napredak scana (0020) — upisuje worker, čita polling. */
  found: number | null;
  analyzed: number | null;
};

/** [Faza 6, 6.6] Red iz `job_subscribers` (0003) — ko čeka rezultat posla. */
export type JobSubscriberRow = {
  job_id: number;
  user_id: string;
  created_at: string;
};

// ── F7: kanban, poruke, događaj „potpisan" (0007) ──────────

/** Tačno ovih pet, redom kojim stoje kolone u kanbanu. */
export type LeadStatusValue =
  | "nekontaktiran"
  | "kontaktiran"
  | "odgovorio"
  | "potpisan"
  | "nezainteresovan";

/** Kanal kontakta. Širi od `MessageChannel` — `poziv` nema generisanu poruku. */
export type LeadChannel = "mejl" | "viber" | "instagram" | "poziv";

export type LeadStatusRow = {
  user_id: string;
  place_id: string;
  status: LeadStatusValue;
  note: string | null;
  channel: LeadChannel | null;
  /** Datum PRVOG kontakta. `null` tačno kad je status `nekontaktiran` (0007). */
  contacted_at: string | null;
  updated_at: string;
};

export type OutreachMessageRow = {
  id: string;
  user_id: string;
  place_id: string;
  channel: "mejl" | "viber" | "instagram";
  body: string;
  source: "sablon" | "ai";
  created_at: string;
};

/**
 * Snimak atributa leada u trenutku potpisivanja (F7 §3).
 * Vrednosti su prepisane, ne referencirane — `businesses` ima TTL 30 dana.
 */
export type SignedEventRow = {
  id: number;
  user_id: string;
  place_id: string;
  country_code: string;
  city_slug: string | null;
  niche_slug: string | null;
  site_status: SiteStatus | null;
  ugly_band: UglyBand | null;
  ugly_score: number | null;
  platform: Platform | null;
  channel: LeadChannel | null;
  created_at: string;
};

// ── F10: utisci (0010) ─────────────────────────────────────

export type FeedbackKind = "bug" | "ideja" | "pohvala" | "drugo";

/**
 * Odakle je utisak došao.
 *
 * F10 je imao dva izvora (dugme, podsetnik). F11 dodaje tri sloja iz §1:
 * kontekstualno pitanje, kampanjsko pitanje i incident. Svi pišu u istu tabelu i
 * idu kroz isti mejl — jedan inboks, jedan admin, jedan izveštaj (odluka 1).
 */
export type FeedbackSource = "dugme" | "podsetnik" | "pitanje" | "kampanja" | "incident";

/** Životni tok prijave u admin konzoli (F11 §4). Puni ga F11.3. */
export type FeedbackStatus =
  | "novo"
  | "priznato"
  | "u_radu"
  | "reseno"
  | "odbijeno"
  | "duplikat";

/**
 * Dijagnostika uz utisak. Namerno `jsonb`, a ne kolone: čita se očima u mejlu, a
 * sadržaj se u beti menja brže od šeme (F10 §1).
 *
 * Sve osim `viewport` skuplja server. Telo zahteva koje tvrdi `plan: "pro"` se
 * ignoriše (pravilo 8).
 */
export type FeedbackCtx = {
  plan: string;
  credits: number;
  unlocks: number;
  /** User-Agent, iz headera — nikad iz tela. */
  ua: string;
  /** `'1440×900'`. Jedino što server ne zna, pa stiže sa klijenta. */
  viewport: string;
  /**
   * Dnevnik klijentskih grešaka (F11 odluka 10). Postoji SAMO uz `kind = 'bug'`
   * i uz incident — server ga na svemu ostalom odbacuje, ne prima pa filtrira.
   */
  errors?: KlijentskaGreska[];
};

/**
 * Jedan red iz dnevnika klijentskih grešaka.
 *
 * Šta ovde NIKAD ne sme da se nađe (F11 §8): telo zahteva, sadržaj polja,
 * `localStorage`, i query string — zato je `ruta` gola putanja, bez `?`.
 */
export type KlijentskaGreska = {
  /** Poruka greške, odsečena na 200 karaktera. */
  poruka: string;
  /** `'TypeError'`, `'unhandledrejection'` — vrsta, ne stek. */
  tip: string;
  /** `'/pretraga'`. Bez query stringa, bez hash-a. */
  ruta: string;
  /** ISO trenutak. */
  vreme: string;
};

export type FeedbackRow = {
  id: number;
  user_id: string;
  country_code: string;
  /**
   * 1 loše · 2 ok · 3 odlično.
   *
   * Od 0011 sme da bude `null`: odgovor na pitanje („Delimično", opseg cene)
   * nema ocenu. Zapis bez ijednog sadržaja i dalje ne može da postoji —
   * `feedback_ima_sadrzaj` traži bar jedno od ocene, odgovora i poruke.
   */
  rating: 1 | 2 | 3 | null;
  kind: FeedbackKind | null;
  message: string | null;
  source: FeedbackSource;
  route: string | null;
  route_label: string | null;
  /** Ruta je jedini pisac ovog polja i uvek upisuje pun objekat. */
  ctx: FeedbackCtx;
  emailed_at: string | null;
  email_error: string | null;
  created_at: string;
  updated_at: string;

  // ── F11 (0011) ───────────────────────────────────────────
  /** Ključ iz `feedback-katalog.ts`. `null` za utisak sa dugmeta. */
  prompt_key: string | null;
  /** Odgovor na pitanje, validiran šemom IZ kataloga (pravilo 16). */
  answers: Record<string, unknown>;
  status: FeedbackStatus;
  /** 1–3, izvedeno serverski iz kataloga — nikad iz tela. */
  severity: 1 | 2 | 3 | null;
  tags: string[];
  admin_note: string | null;
  resolved_at: string | null;
  notified_at: string | null;
  seen_at: string | null;
  screenshot_path: string | null;
  reward_credits: number;
  /** Obrazloženje koje vidi KORISNIK — za razliku od `admin_note` (F11.4, 0016). */
  user_note: string | null;
  /** Koliko je puta cron pokušao mejl „rešeno". Staje na 3 (F11 §9). */
  notify_attempts: number;
};

// ── F11: stanje pitanja po korisniku (0011) ────────────────

export type FeedbackPromptStatus = "prikazano" | "odgovoreno" | "odbaceno";

export type FeedbackPromptRow = {
  user_id: string;
  prompt_key: string;
  status: FeedbackPromptStatus;
  shown_at: string;
  answered_at: string | null;
  dismissed_count: number;
  feedback_id: number | null;
};

/** Beta dnevnik (0011). Sadržaj i ekran dolaze u F11.4. */
export type ChangelogRow = {
  id: number;
  title: string;
  body: string | null;
  kind: "novo" | "promena" | "popravka";
  from_feedback: number[];
  shipped_at: string;
  published: boolean;
};

/** `grant_feedback_credits` iz 0011 (F11 §4). Razlozi su na srpskom, kao u RPC-u. */
export type FeedbackGrantResult = {
  ok: boolean;
  reason: string;
  delta: number;
};

// ── F12: admin konzola (0012) ──────────────────────────────

/**
 * Jedan red dnevnika admin radnji (F12 §2).
 *
 * `actor_id` je nullable iako PRD piše `not null` — v. obrazloženje u migraciji
 * 0012: brisanje admina mora da ostavi njegove radnje u dnevniku.
 *
 * `payload` NIKAD ne sadrži lozinku, token ni ključ (pravilo 14).
 */
export type AdminAuditRow = {
  id: number;
  actor_id: string | null;
  /** `'credits.adjust'`, `'user.delete'` — imenski prostor pa radnja. */
  action: string;
  target_user: string | null;
  target_ref: string | null;
  payload: Record<string, unknown>;
  ok: boolean;
  error: string | null;
  ip: string | null;
  created_at: string;
};

/**
 * `admin_adjust_credits` iz 0012 — jedini put do negativnog iznosa (pravilo 3).
 * Razlozi su na srpskom tamo gde su pravilo proizvoda, i na engleskom tamo gde
 * su isti kao u ostalim RPC-ovima.
 */
export type AdminAdjustResult = {
  ok: boolean;
  reason: string;
  balance: number | null;
};

/** Jedan red liste korisnika iz `admin_users_page` (F12 §3.1). */
export type AdminUserRow = {
  id: string;
  email: string | null;
  plan: string;
  role: AdminRole;
  credits_balance: number;
  created_at: string;
  last_seen_at: string | null;
  unlocks_count: number;
  searches_count: number;
  feedback_count: number;
  /** Ukupan broj pogodaka pre sečenja na stranicu; isti u svakom redu. */
  ukupno: number;
};

/**
 * `admin_set_role` iz 0013 (F12 §1, „Zaštite od zaključavanja").
 *
 * Postoji zato što je „poslednji admin ostaje" provera koja mora da se desi u
 * istoj transakciji sa upisom — brojanje u dva PostgREST zahteva to nije bilo.
 * `admins` je broj admina POSLE izmene, ili broj zatečenih kad je izmena
 * odbijena.
 */
export type AdminSetRoleResult = {
  ok: boolean;
  reason: "ok" | "unchanged" | "invalid_role" | "self" | "no_user" | "last_admin";
  admins: number | null;
};

/**
 * Šest kartica sa `/admin` (F12 §3.4) — jedan poziv `admin_overview`, bez
 * ijednog spoljnog servisa.
 *
 * Oblik je 1:1 sa `jsonb_build_object` iz migracije 0013. Kad se tamo doda
 * ključ, dodaje se i ovde — `tsc` to ne može da uhvati.
 */
export type AdminOverview = {
  budzet: {
    /** LA dan (`YYYY-MM-DD`) i LA mesec — Google resetuje kvotu u 09:00 lokalno. */
    dan: string;
    mesec: string;
    dan_poziva: number;
    dan_cap: number;
    mesec_poziva: number;
    mesec_cap: number;
    iscrpljen: boolean;
    dana_do_kraja: number;
    /** Raspodela po SKU-u, npr. `{ "places:searchText": 12 }`. */
    po_vrsti: Record<string, number>;
  };
  poslovi: {
    na_cekanju: number;
    u_radu: number;
    palo_24h: number;
    /** Namerno odloženi (`run_after` u budućnosti) — ne pale crveno stanje. */
    odlozeno: number;
    /** Koliko sekundi čeka najstariji posao kome je vreme došlo. */
    najstariji_sec: number;
  };
  korisnici: {
    ukupno: number;
    novi_7d: number;
    aktivni_7d: number;
    aktivni_30d: number;
    nikad: number;
    admina: number;
  };
  krediti: {
    dodeljeno: number;
    potroseno: number;
    po_razlogu: Partial<Record<CreditReason, number>>;
  };
  utisci: {
    ukupno: number;
    novih_7d: number;
    otvoreni_bugovi: number;
    nedirnuto: number;
    pitanja: { prikazano: number; odgovoreno: number; odbaceno: number };
    /**
     * Odgovorenost razbijena po pitanju (0015).
     *
     * Zbirna brojka kaže da li mehanika radi; ova kaže KOJE pitanje ne radi.
     * `kljuc` je sirov ključ iz `feedback_prompts` — naslov dolazi iz kataloga,
     * pa i pitanje iz starije verzije kataloga i dalje izlazi u listi.
     */
    po_pitanju: {
      kljuc: string;
      prikazano: number;
      odgovoreno: number;
      odbaceno: number;
    }[];
    /**
     * Koliko traje obrada prijave: od `created_at` do `resolved_at` (0015).
     *
     * Brojka o meni, ne o korisniku. Uz prosek ide i najstarija nerešena, jer
     * prosek sam ume da laže — pet prijava rešenih za sat i jedna koja stoji tri
     * nedelje daju odličan prosek.
     */
    obrada: {
      reseno: number;
      prosek_sec: number;
      nereseno: number;
      nereseno_najstarije_sec: number;
    };
    /** Sirovi odgovori; medijanu računa `medijanaCene()` — jedini izvor istine. */
    cena_odgovori: string[];
  };
  baza: {
    biznisa: number;
    audita: number;
    otkljucano: number;
    pretraga: number;
    iz_kesa: number;
    /** Redovi kojima je Google podatak stariji od 30 dana (pravilo 1). */
    stari_google: number;
  };
  trenutak: string;
};

export type ApiBudgetRow = {
  day: string;   // LA dan, YYYY-MM-DD
  month: string; // LA mesec, YYYY-MM
  calls: number;
  exhausted_at: string | null;
  /** Raspodela poziva po SKU-u, npr. `{ "places:searchText": 12 }` (0002). */
  by_kind: Record<string, number>;
};

// ── povratne vrednosti RPC funkcija ────────────────────────
// Sve tri vraćaju `table (ok boolean, reason text)`, pa supabase-js vraća niz
// od tačno jednog reda.

export type SpendReason =
  | "unlocked"
  | "already_unlocked"
  | "insufficient_credits"
  | "no_user"
  | "no_place";

export type GrantReason =
  | "granted"
  | "already_granted"
  | "invalid_amount"
  | "invalid_reason"
  | "no_user";

export type MonthlyGrantReason =
  | "granted"
  | "already_granted"
  | "invalid_amount"
  | "missing_ref_id"
  | "no_user";

export type ExportClaimReason = "claimed" | "limit_reached" | "nothing_to_export" | "no_user";

/** `spend_credit_and_scan` iz 0009 (F9). */
export type ScanSpendReason = "charged" | "already_paid" | "insufficient_credits" | "no_user";

/** `set_lead_status` / `mark_contacted` / `set_lead_note` iz 0007. */
export type LeadStatusRpcReason =
  | "updated"
  | "contacted"
  | "saved"
  | "invalid_status"
  | "invalid_channel"
  | "not_unlocked";

export type RpcResult<R extends string> = { ok: boolean; reason: R };

/** `grant_monthly_credits` uz `ok`/`reason` vraća i upisanu razliku. */
export type MonthlyGrantResult = RpcResult<MonthlyGrantReason> & { delta: number };

/**
 * `spend_credit_and_scan` vraća i posao i stanje novčanika — ruta iz jednog
 * poziva zna šta da javi korisniku, bez naknadnog čitanja profila.
 *
 * `charged: false` uz `ok: true` je dupli klik: posao postoji i plaćen je, samo
 * ne sada. Klijent tada ne sme da javi „skinut je kredit".
 */
export type ScanSpendResult = RpcResult<ScanSpendReason> & {
  job_id: number | null;
  joined: boolean;
  charged: boolean;
  credits_left: number;
};

/** `claim_export` vraća KOLIKO redova je odobreno, ne samo da li sme. */
export type ExportClaimResult = RpcResult<ExportClaimReason> & {
  allowed: number;
  used: number;
  reset_at: string;
};

/**
 * `apply_subscription` i `apply_credit_pack` iz 0022 (S16). Zove ih isključivo
 * Paddle webhook iz S18, posle provere potpisa.
 *
 * `granted` je broj STVARNO dodeljenih kredita — 0 uz `ok: true` znači da je
 * dodela već bila obavljena (`already_granted`, ista transakcija stigla dvaput)
 * ili da događaj nije nosio naplatu (`saved`). Klijent tada ne sme da javi
 * „krediti su dodati".
 */
export type BillingApplyReason =
  | "granted"
  | "already_granted"
  | "saved"
  | "invalid_amount"
  | "invalid_status"
  | "invalid_plan"
  | "missing_ref_id"
  | "missing_subscription_id"
  | "no_user";

export type BillingApplyResult = RpcResult<BillingApplyReason> & { granted: number };

/** `claim_ai_rewrite` iz 0022 — isti oblik kao `claim_cache_miss` iz 0003. */
export type AiRewriteClaimReason = "claimed" | "limit_reached" | "no_user";

export type AiRewriteClaimResult = RpcResult<AiRewriteClaimReason> & {
  used: number;
  remaining: number;
  reset_at: string;
};
