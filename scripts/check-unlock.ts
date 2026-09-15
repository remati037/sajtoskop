// scripts/check-unlock.ts
// Bezbednosne provere otključavanja iz F4 §7. Pokretanje: `pnpm check:f4`
//
// Ovo nije unit test. Priča sa PRAVOM bazom i poziva PRAVI route handler, jer se
// baš to i proverava: zaključavanje reda u Postgresu ne postoji u TypeScriptu i
// ne može se mockovati. Trka se dokazuje pokretanjem, ne pretpostavkom.
//
// Razlika u odnosu na `pnpm check:f1`: tamo se `spend_credit_and_unlock` zove
// direktno, dakle proverava se SQL funkcija. Ovde ide ceo put — telo zahteva,
// sesija, ruta, funkcija — jer se kredit može izgubiti i iznad SQL-a: dovoljno
// je da ruta jednog dana „optimizuje" pa pročita balans pre RPC-a.
//
// Skripta pravi privremene profile i briše ih na kraju (`on delete cascade`
// počisti unlocks, credit_ledger i job_subscribers).

import type { SupabaseClient } from "@supabase/supabase-js";
// Uvoz harnessa MORA biti pre uvoza rute — on registruje resolve hook.
import { loadRoute, postJson, setSessionUser, type RouteHandler } from "./lib/route-harness";
// Relativno, ne kroz `@sajtoskop/worker/lib`: koren monorepoa nema taj paket
// među zavisnostima, isto kao u `validate-migrations.ts`.
import { loadRootEnv, supabaseAdmin, supabaseAnon } from "../apps/worker/src/lib/index";

loadRootEnv();

const PARALLEL = 20;

let failed = 0;

function check(ok: boolean, line: string, detail?: string): void {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
  if (detail) console.log(`   ${detail}`);
}

function naslov(text: string): void {
  console.log(`\n${text}`);
}

// ── priprema ───────────────────────────────────────────────

async function makeProfile(db: SupabaseClient, id: string, credits: number): Promise<void> {
  const { error } = await db.rpc("create_profile_with_grant", {
    p_user: id,
    p_email: null,
    p_credits: credits,
    p_ref_id: `test:${id}`,
  });
  if (error) throw new Error(`Pravljenje test profila nije uspelo: ${error.message}`);
}

async function balance(db: SupabaseClient, id: string): Promise<number> {
  const { data } = await db
    .from("profiles")
    .select("credits_balance")
    .eq("id", id)
    .maybeSingle<{ credits_balance: number }>();
  return data?.credits_balance ?? -1;
}

/** Obe kase odjednom — od S16 je stanje kredita ZBIR, ne jedna kolona. */
async function kase(db: SupabaseClient, id: string): Promise<{ b: number; t: number }> {
  const { data } = await db
    .from("profiles")
    .select("credits_balance, credits_topup")
    .eq("id", id)
    .maybeSingle<{ credits_balance: number; credits_topup: number }>();
  return { b: data?.credits_balance ?? -1, t: data?.credits_topup ?? -1 };
}

async function countRows(db: SupabaseClient, table: string, userId: string): Promise<number> {
  const { count } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  return count ?? 0;
}

async function placeIds(db: SupabaseClient, n: number): Promise<string[]> {
  const { data, error } = await db.from("businesses").select("place_id").limit(n);
  if (error) throw new Error(`Čitanje businesses nije uspelo: ${error.message}`);
  return ((data ?? []) as { place_id: string }[]).map((r) => r.place_id);
}

// ── 1. bez sesije ──────────────────────────────────────────

async function checkNoSession(POST: RouteHandler, place: string): Promise<void> {
  naslov("Sesija — zahtev bez prijave");

  setSessionUser(null);
  const res = await postJson(POST, "/api/unlock", { placeId: place });

  check(res.status === 401, `bez sesije → 401  (dobijeno: ${res.status})`, String(res.body.greska ?? ""));
}

// ── 2. trka: 20 paralelnih otključavanja sa 1 kreditom ─────

/**
 * Ista trka, ali sa jedinim kreditom u DRUGOJ kasi (S16, migracija 0022).
 *
 * Zašto zaseban test, kad `checkRace` već dokazuje `for update`: ta trka drži
 * kredit u `credits_balance`, pa pogađa granu u kojoj je `v_iz_balansa = 1` —
 * dakle skoro isti kod kao pre S16. Grana koja skida iz `credits_topup` je nova
 * i pod konkurencijom nije bila pokrivena nigde, a greška u njoj se ne vidi kao
 * pad nego kao dvadeset besplatnih otključavanja.
 *
 * Tri stvari koje samo ovaj test može da uhvati:
 *   1. da provera „ima li dovoljno" gleda ZBIR obe kase, ne samo balans
 *   2. da se skine tačno jedan kredit, i to iz kase u kojoj stvarno jeste
 *   3. da nova invarijanta `sum(delta) = balans + dopuna` drži i pod trkom
 */
async function checkRaceTopup(
  db: SupabaseClient,
  POST: RouteHandler,
  ids: string[],
): Promise<string> {
  naslov(`Trka — ${ids.length} paralelnih otključavanja sa 1 kreditom U DOPUNI`);

  const user = `user_f4topup_${Date.now()}`;
  // Profil bez ijednog kredita, pa se jedini kredit stavlja u drugu kasu kroz
  // `grant_credits('credit_pack')` — RAZLOG bira kasu, pa je i to usput
  // provereno nad pravom bazom, ne samo u PGlite-u.
  await makeProfile(db, user, 0);
  const { error: packErr } = await db.rpc("grant_credits", {
    p_user: user,
    p_amount: 1,
    p_reason: "credit_pack",
    p_ref_id: `txn_test_${user}`,
  });
  if (packErr) throw new Error(`Punjenje dopune nije uspelo: ${packErr.message}`);

  const pre = await kase(db, user);
  check(
    pre.b === 0 && pre.t === 1,
    `kredit je u dopuni, balans prazan  (balans ${pre.b}, dopuna ${pre.t})`,
  );

  setSessionUser(user);
  const started = Date.now();
  const responses = await Promise.all(
    ids.map((placeId) => postJson(POST, "/api/unlock", { placeId })),
  );
  const trajanje = Date.now() - started;

  const uspesni = responses.filter((r) => r.status === 200);
  const bezKredita = responses.filter((r) => r.status === 402);
  console.log(`   ${uspesni.length}× 200, ${bezKredita.length}× 402   (${trajanje} ms)`);

  check(uspesni.length === 1, `tačno jedan 200  (dobijeno: ${uspesni.length})`);
  check(
    bezKredita.length === ids.length - 1,
    `ostali 402 „nemaš kredita"  (dobijeno: ${bezKredita.length}/${ids.length - 1})`,
  );

  const posle = await kase(db, user);
  check(posle.t === 0, `dopuna ispražnjena  (dobijeno: ${posle.t})`);
  check(
    posle.b === 0,
    `balans NIJE otišao u minus dok je dopuna imala kredit  (dobijeno: ${posle.b})`,
  );

  const unlocks = await countRows(db, "unlocks", user);
  check(unlocks === 1, `tačno jedan red u unlocks  (dobijeno: ${unlocks})`);

  // Invarijanta iz F4 §8, proširena na dve kase (S16).
  const { data: rows } = await db
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", user)
    .returns<{ delta: number }[]>();
  const zbir = (rows ?? []).reduce((s, r) => s + r.delta, 0);
  check(
    zbir === posle.b + posle.t,
    `sum(delta) = balans + dopuna  (${zbir} = ${posle.b + posle.t})`,
  );

  return user;
}

async function checkRace(db: SupabaseClient, POST: RouteHandler, ids: string[]): Promise<string> {
  naslov(`Trka — ${ids.length} paralelnih POST /api/unlock sa 1 kreditom`);

  const user = `user_f4race_${Date.now()}`;
  await makeProfile(db, user, 1);
  setSessionUser(user);

  // Svih 20 kreće istovremeno — bez `for await`, inače nema trke.
  const started = Date.now();
  const responses = await Promise.all(
    ids.map((placeId) => postJson(POST, "/api/unlock", { placeId })),
  );
  const trajanje = Date.now() - started;

  const uspesni = responses.filter((r) => r.status === 200);
  const bezKredita = responses.filter((r) => r.status === 402);
  const ostali = responses.filter((r) => r.status !== 200 && r.status !== 402);

  const raspodela = new Map<number, number>();
  for (const r of responses) raspodela.set(r.status, (raspodela.get(r.status) ?? 0) + 1);
  const opis = [...raspodela.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([status, n]) => `${n}× ${status}`)
    .join(", ");

  console.log(`   ${opis}   (${trajanje} ms)`);

  check(uspesni.length === 1, `tačno jedan 200  (dobijeno: ${uspesni.length})`);
  check(
    bezKredita.length === ids.length - 1,
    `ostali 402 „nemaš kredita"  (dobijeno: ${bezKredita.length}/${ids.length - 1})`,
  );
  if (ostali.length > 0) {
    check(false, `neočekivani statusi: ${ostali.map((r) => r.status).join(", ")}`,
      JSON.stringify(ostali[0]?.body).slice(0, 200));
  }

  const bal = await balance(db, user);
  check(bal === 0, `stanje kredita je 0  (dobijeno: ${bal})`);

  const unlocks = await countRows(db, "unlocks", user);
  check(unlocks === 1, `tačno jedan red u unlocks  (dobijeno: ${unlocks})`);

  const { count: ledger } = await db
    .from("credit_ledger")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user)
    .eq("reason", "unlock");
  check(ledger === 1, `tačno jedan 'unlock' u credit_ledger  (dobijeno: ${ledger})`);

  // Invarijanta iz F4 §8: balans nije mogao da se promeni mimo knjige.
  const { data: rows } = await db
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", user)
    .returns<{ delta: number }[]>();
  const zbir = (rows ?? []).reduce((s, r) => s + r.delta, 0);
  check(zbir === bal, `sum(delta) = credits_balance  (${zbir} = ${bal})`);

  // Otključan lead mora da nosi kontakt — inače je kredit potrošen ni za šta.
  const lead = uspesni[0]?.body.lead as Record<string, unknown> | undefined;
  check(
    lead !== undefined && lead.isUnlocked === true && "phone" in lead && "websiteUrl" in lead,
    "odgovor nosi otključan lead sa kontakt poljima",
  );
  check(
    uspesni[0]?.body.creditsLeft === 0,
    `odgovor javlja creditsLeft = 0  (dobijeno: ${uspesni[0]?.body.creditsLeft})`,
  );

  return user;
}

// ── 3. ponovljeno otključavanje je besplatno ───────────────

async function checkAlreadyUnlocked(
  db: SupabaseClient,
  POST: RouteHandler,
  user: string,
): Promise<void> {
  naslov("Ponovljeno otključavanje — pravilo 4");

  const { data } = await db
    .from("unlocks")
    .select("place_id")
    .eq("user_id", user)
    .maybeSingle<{ place_id: string }>();

  if (!data) {
    check(false, "nema otključanog leada iz prethodnog koraka");
    return;
  }

  // Korisnik je na 0 kredita. Da se ponovljeni unlock naplaćuje, ovo bi bilo 402.
  setSessionUser(user);
  const res = await postJson(POST, "/api/unlock", { placeId: data.place_id });

  check(res.status === 200, `isti lead drugi put → 200  (dobijeno: ${res.status})`);
  check(res.body.alreadyUnlocked === true, "odgovor kaže alreadyUnlocked: true");

  const bal = await balance(db, user);
  check(bal === 0, `kredit nije skinut drugi put  (stanje: ${bal})`);

  const unlocks = await countRows(db, "unlocks", user);
  check(unlocks === 1, `i dalje jedan red u unlocks  (dobijeno: ${unlocks})`);
}

// ── 4. userId iz tela zahteva se ignoriše ──────────────────

async function checkBodyUserIdIgnored(
  db: SupabaseClient,
  POST: RouteHandler,
  place: string,
): Promise<string[]> {
  naslov("IDOR — userId u telu zahteva (P0-1, pravilo 8)");

  const napadac = `user_f4attacker_${Date.now()}`;
  const zrtva = `user_f4victim_${Date.now()}`;
  await makeProfile(db, napadac, 1);
  await makeProfile(db, zrtva, 5);

  setSessionUser(napadac);
  const res = await postJson(POST, "/api/unlock", { placeId: place, userId: zrtva });

  check(res.status === 200, `zahtev prolazi, telo se ne poštuje  (status: ${res.status})`);

  // `makeProfile` puni kroz `create_profile_with_grant`, a od 0026 razlog
  // `onboarding` ide u `credits_topup` — zato zbir obe kase, ne samo balans.
  const zrtvaKase = await kase(db, zrtva);
  check(
    zrtvaKase.b + zrtvaKase.t === 5,
    `žrtvi nije skinut kredit  (balans ${zrtvaKase.b}, dopuna ${zrtvaKase.t})`,
  );

  const unlocksZrtve = await countRows(db, "unlocks", zrtva);
  check(unlocksZrtve === 0, `žrtva nema nijedan unlock  (dobijeno: ${unlocksZrtve})`);

  const napadacKase = await kase(db, napadac);
  check(
    napadacKase.b + napadacKase.t === 0,
    `kredit je skinut sa sesije, ne sa tela  (balans ${napadacKase.b}, dopuna ${napadacKase.t})`,
  );

  const unlocksNapadaca = await countRows(db, "unlocks", napadac);
  check(unlocksNapadaca === 1, `unlock je upisan napadaču  (dobijeno: ${unlocksNapadaca})`);

  return [napadac, zrtva];
}

// ── 5. dnevni cap na export pod paralelnim zahtevima ───────

async function checkExportCap(db: SupabaseClient): Promise<string> {
  naslov(`Export — ${PARALLEL} paralelnih rezervacija sa capom od 10 redova`);

  const user = `user_f4export_${Date.now()}`;
  await makeProfile(db, user, 0);

  const CAP = 10;
  const PO_ZAHTEVU = 3;

  // Svaki zahtev traži 3 reda uz cap od 10. Ispravno je ukupno tačno 10, ma kako
  // se poklopili — dakle tri puna zahteva, jedan delimičan i ostali odbijeni.
  const rezultati = await Promise.all(
    Array.from({ length: PARALLEL }, () =>
      db
        .rpc("claim_export", { p_user: user, p_limit: CAP, p_wanted: PO_ZAHTEVU })
        .then((r) => {
          if (r.error) return { allowed: -1, reason: "rpc_error" };
          const row = ((r.data ?? []) as { allowed: number; reason: string }[])[0];
          return row ?? { allowed: -1, reason: "no_result" };
        }),
    ),
  );

  const odobreno = rezultati.reduce((s, r) => s + Math.max(0, r.allowed), 0);
  const greske = rezultati.filter((r) => r.allowed === -1).length;

  console.log(
    `   odobreno ukupno ${odobreno} redova · ` +
      `${rezultati.filter((r) => r.reason === "claimed").length} rezervacija, ` +
      `${rezultati.filter((r) => r.reason === "limit_reached").length}× limit_reached`,
  );

  check(greske === 0, `nijedan poziv nije pukao  (grešaka: ${greske})`);
  check(odobreno === CAP, `zbir odobrenog je tačno cap  (${odobreno} = ${CAP})`);

  const { data } = await db
    .from("profiles")
    .select("export_count")
    .eq("id", user)
    .maybeSingle<{ export_count: number }>();
  check(
    data?.export_count === CAP,
    `brojač u bazi se poklapa sa odobrenim  (${data?.export_count})`,
  );

  // F4 §7: `?limit=99999`. Ruta prosleđuje cap kao `p_limit`, a korisnikov broj
  // ulazi samo kroz `Math.min` — dakle sme da smanji, nikad da poveća.
  const preterano = await db.rpc("claim_export", {
    p_user: user,
    p_limit: CAP,
    p_wanted: 99999,
  });
  const row = ((preterano.data ?? []) as { allowed: number; reason: string }[])[0];
  check(
    row?.allowed === 0 && row.reason === "limit_reached",
    `traženo 99999 posle iscrpljenog capa → 0 redova  (${row?.allowed}, ${row?.reason})`,
  );

  return user;
}

// ── 6. mesečna dodela bez rollovera ────────────────────────

async function checkMonthlyGrant(db: SupabaseClient): Promise<string> {
  naslov("Mesečna dodela — reset bez rollovera");

  const user = `user_f4grant_${Date.now()}`;
  // Profil bez ijednog kredita, pa se 30 upisuje u `credits_balance` kroz samu
  // mesečnu dodelu. `makeProfile` bi ih od 0026 stavio u `credits_topup`
  // (razlog `onboarding`), a `grant_monthly_credits` POSTAVLJA balans i dopunu
  // ne gleda — sa kreditima u dopuni test ne bi merio ni „bez rollovera" ni
  // „delta je razlika", jer bi balans pre dodele uvek bio 0.
  await makeProfile(db, user, 0);
  const { error: seedErr } = await db.rpc("grant_monthly_credits", {
    p_user: user,
    p_target: 30,
    p_ref_id: `seed-${Date.now()}`,
  });
  if (seedErr) throw new Error(`Punjenje balansa nije uspelo: ${seedErr.message}`);

  const mesec = `test-${Date.now()}`;

  // Korisnik potroši deo od 30 kroz stvarna otključavanja. Poslednji place_id
  // se namerno OSTAVLJA neotključan — treba nam kasnije, za trošenje posle dodele.
  const sviIds = await placeIds(db, 26);
  const rezerva = sviIds.at(-1) ?? "";
  const ids = sviIds.slice(0, -1);

  for (const placeId of ids) {
    await db.rpc("spend_credit_and_unlock", { p_user: user, p_place: placeId });
  }

  const preDodele = await balance(db, user);
  check(preDodele === 30 - ids.length, `potrošeno ${ids.length}, stanje ${preDodele}`);

  type Grant = { ok: boolean; reason: string; delta: number };
  const dodeli = async (ref: string): Promise<Grant | undefined> => {
    const { data } = await db.rpc("grant_monthly_credits", {
      p_user: user,
      p_target: 30,
      p_ref_id: ref,
    });
    return ((data ?? []) as Grant[])[0];
  };

  const prva = await dodeli(mesec);
  check(prva?.reason === "granted", `prva dodela → granted  (${prva?.reason})`);
  check(prva?.delta === ids.length, `delta je razlika, ne pun iznos  (${prva?.delta})`);
  check((await balance(db, user)) === 30, "stanje postavljeno na 30");

  // Rollover bi ovde dao 60 — zato dodela postavlja, a ne sabira.
  const druga = await dodeli(mesec);
  check(druga?.reason === "already_granted", `ponovljen isti mesec → already_granted  (${druga?.reason})`);
  check((await balance(db, user)) === 30, "ponovljena dodela ne daje 60");

  // Najopasniji scenario: posao se ponovi POSLE trošenja. Kredit se ne sme vratiti.
  // Trošak mora da bude nad NEotključanim leadom — `already_unlocked` ne naplaćuje,
  // pa bi provera nad već otključanim prošla prazna.
  const { data: trosak } = await db.rpc("spend_credit_and_unlock", {
    p_user: user,
    p_place: rezerva,
  });
  const razlogTroska = ((trosak ?? []) as { reason: string }[])[0]?.reason;
  check(razlogTroska === "unlocked", `kredit je stvarno potrošen  (${razlogTroska})`);

  const posle = await balance(db, user);
  check(posle === 29, `stanje posle trošenja je 29  (${posle})`);

  await dodeli(mesec);
  check(
    (await balance(db, user)) === posle,
    `ponovljen posao posle trošenja ne vraća kredite  (${posle})`,
  );

  const { data: rows } = await db
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", user)
    .returns<{ delta: number }[]>();
  const zbir = (rows ?? []).reduce((s, r) => s + r.delta, 0);
  const posleKase = await kase(db, user);
  check(
    zbir === posleKase.b + posleKase.t,
    `sum(delta) = balans + dopuna  (${zbir} = ${posleKase.b} + ${posleKase.t})`,
  );

  return user;
}

// ── 6b. trka: 20 paralelnih skeniranja iste kombinacije ────

/**
 * P2 od 16. septembra 2026: `ref_id` skeniranja nosi timestamp
 * (`kes:RS:grad:nisa:<vreme>`), pa `credit_ledger_grant_idem_idx` NE pokriva
 * `scan` redove. Pitanje je bilo može li dva paralelna zahteva za istu pretragu
 * oba da prođu proveru i naplate korisnika dvaput.
 *
 * Ne mogu, i ovo je dokaz: `spend_credit_and_scan` PRVOM naredbom uzima
 * `for update` nad redom profila, pre svake provere. Pozivi istog korisnika se
 * time serijalizuju, a drugi tek posle otključavanja čita `search_access` —
 * nova naredba, dakle svež snapshot u `read committed` — i vidi red koji je
 * prvi upisao (`already_paid`, cena 0). `pnpm check:sql` ovo ne može da pokaže:
 * PGlite ima jednu konekciju.
 *
 * Gađa se KEŠ grana, namerno. Grana koja upisuje `scan` posao bi ostavila posao
 * koji živ worker pokupi i plati pravom Places kvotom (CLAUDE.md, „Budžet").
 * Keš grana prolazi kroz isto zaključavanje i istu naplatu, bez tog rizika.
 */
async function checkRaceScan(db: SupabaseClient): Promise<string> {
  naslov(`Trka — ${PARALLEL} paralelnih skeniranja iste kombinacije (keš)`);

  const user = `user_f4scan_${Date.now()}`;
  const grad = "nis";
  const nisa = `f4race-${Date.now()}`;

  // Kredita ima za SVIH 20. Ako zaključavanje popusti, test to vidi kao 20
  // naplata i praznu kasu — ne kao pad.
  await makeProfile(db, user, PARALLEL);

  const { error: cacheErr } = await db.from("search_cache").insert({
    country_code: "RS",
    city_slug: grad,
    niche_slug: nisa,
    last_scanned_at: new Date().toISOString(),
    last_results_count: 20,
    scan_count: 1,
    pages: 1,
    partial: false,
  });
  if (cacheErr) throw new Error(`Priprema keša nije uspela: ${cacheErr.message}`);

  type Scan = { ok: boolean; reason: string; charged: boolean; cost: number; job_id: number | null };

  try {
    const started = Date.now();
    const rezultati = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        db
          .rpc("spend_credit_and_scan", {
            p_user: user,
            p_country: "RS",
            p_city: grad,
            p_niche: nisa,
            p_max_results: 20,
            p_ttl_days: 30,
          })
          .then((r) => {
            if (r.error) return { ok: false, reason: `rpc_error: ${r.error.message}`, charged: false, cost: -1, job_id: null };
            return (
              ((r.data ?? []) as Scan[])[0] ??
              { ok: false, reason: "no_result", charged: false, cost: -1, job_id: null }
            );
          }),
      ),
    );
    const trajanje = Date.now() - started;

    const naplaceni = rezultati.filter((r) => r.charged);
    const vecPlaceni = rezultati.filter((r) => r.reason === "already_paid");
    const greske = rezultati.filter((r) => r.cost === -1);

    console.log(
      `   ${naplaceni.length}× naplaćeno, ${vecPlaceni.length}× already_paid, ` +
        `${greske.length}× greška   (${trajanje} ms)`,
    );

    check(greske.length === 0, `nijedan poziv nije pukao  (grešaka: ${greske.length})`,
      greske[0]?.reason);
    check(naplaceni.length === 1, `tačno JEDNA naplata  (dobijeno: ${naplaceni.length})`);
    check(
      naplaceni[0]?.cost === 1 && naplaceni[0].reason === "cached",
      `naplaćena je jedna stranica iz keša  (cena ${naplaceni[0]?.cost}, ${naplaceni[0]?.reason})`,
    );
    check(
      vecPlaceni.length === PARALLEL - 1 && vecPlaceni.every((r) => r.cost === 0),
      `ostali su besplatni already_paid  (dobijeno: ${vecPlaceni.length}/${PARALLEL - 1})`,
    );
    check(
      rezultati.every((r) => r.job_id === null),
      "nijedan poziv nije upisao scan posao (keš grana, bez Places poziva)",
    );

    const posle = await kase(db, user);
    check(
      posle.b + posle.t === PARALLEL - 1,
      `skinut je tačno jedan kredit  (ostalo ${posle.b} + ${posle.t}, očekivano ${PARALLEL - 1})`,
    );

    const { count: scanRedovi } = await db
      .from("credit_ledger")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user)
      .eq("reason", "scan");
    check(scanRedovi === 1, `tačno jedan 'scan' red u knjizi  (dobijeno: ${scanRedovi})`);

    const { data: pristup } = await db
      .from("search_access")
      .select("pages")
      .eq("user_id", user)
      .returns<{ pages: number }[]>();
    check(
      (pristup ?? []).length === 1 && pristup?.[0]?.pages === 1,
      `jedan red u search_access, dubina 1  (dobijeno: ${(pristup ?? []).length})`,
    );

    const { data: rows } = await db
      .from("credit_ledger")
      .select("delta")
      .eq("user_id", user)
      .returns<{ delta: number }[]>();
    const zbir = (rows ?? []).reduce((z, r) => z + r.delta, 0);
    check(
      zbir === posle.b + posle.t,
      `sum(delta) = balans + dopuna  (${zbir} = ${posle.b + posle.t})`,
    );
  } finally {
    // `search_cache` nema FK ka profilu, pa ga brisanje naloga ne počisti.
    await db
      .from("search_cache")
      .delete()
      .eq("country_code", "RS")
      .eq("city_slug", grad)
      .eq("niche_slug", nisa);
  }

  return user;
}

// ── 7. tuđi credit_ledger anon ključem ─────────────────────

async function checkLedgerRls(anon: SupabaseClient, users: string[]): Promise<void> {
  naslov("RLS — tuđi credit_ledger anon ključem");

  for (const user of users) {
    const { data, error } = await anon.from("credit_ledger").select("*").eq("user_id", user);
    const n = data?.length ?? 0;
    check(n === 0, `credit_ledger korisnika ${user.slice(0, 22)}… → ${n} redova`,
      error ? `(${error.message})` : undefined);
  }
}

// ── main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const anon = supabaseAnon();
  const POST = await loadRoute("api/unlock/route.ts");

  const ids = await placeIds(db, PARALLEL);
  if (ids.length < 2) {
    console.log(`\nU bazi ima ${ids.length} biznisa — pokreni prvo \`pnpm seed\`.\n`);
    process.exit(1);
  }
  if (ids.length < PARALLEL) {
    console.log(`(u bazi ima ${ids.length} biznisa, test radi sa toliko)`);
  }

  // Poslovi koje test upiše brišu se po ID-u većem od ovog vodostaja.
  const { data: last } = await db
    .from("job_queue")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: number }>();
  const jobWatermark = last?.id ?? 0;

  const profili: string[] = [];

  try {
    await checkNoSession(POST, ids[0]!);

    const raceUser = await checkRace(db, POST, ids);
    profili.push(raceUser);

    await checkAlreadyUnlocked(db, POST, raceUser);

    profili.push(await checkRaceTopup(db, POST, ids));

    const idorUsers = await checkBodyUserIdIgnored(db, POST, ids[0]!);
    profili.push(...idorUsers);

    profili.push(await checkRaceScan(db));

    profili.push(await checkExportCap(db));
    profili.push(await checkMonthlyGrant(db));

    await checkLedgerRls(anon, profili);
  } finally {
    for (const id of profili) await db.from("profiles").delete().eq("id", id);
    await db.from("job_queue").delete().eq("type", "enrich_full").gt("id", jobWatermark);
  }

  naslov("Nije provereno u ovoj skripti");
  console.log(
    "· `GET /api/export` kroz celu rutu — čita `unlocks` kroz Clerk↔Supabase token,\n" +
      "  koji van pregledača ne postoji. Cap je proveren na nivou `claim_export`,\n" +
      "  gde se i primenjuje. Kroz rutu proveri iz pregledača:\n" +
      "  /api/export?limit=99999 → najviše `PLANS.beta.exportPerDay` redova.",
  );

  console.log(failed === 0 ? "\nSve prošlo." : `\n${failed} provera palo.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
