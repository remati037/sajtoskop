// apps/web/src/lib/admin-pozivnice.ts
// Ulazak u betu (F12 §3.3): pozivnica, otvaranje naloga i spisak poslatog.
//
// Sve živi u Clerku, ne u bazi. Pozivnica nije nalog i nema svoj red u
// `profiles` — profil nastaje tek kroz postojeći `user.created` webhook, sa 30
// kredita, isto kao i za svakog ko se prijavio sam. Zasebna tabela pozivnica bi
// bila drugi izvor istine za nešto što Clerk već vodi, uključujući i istek.
//
// ── lozinka ──────────────────────────────────────────────────
// Kod otvaranja naloga generisana lozinka se prikazuje TAČNO JEDNOM, u odgovoru
// rute, i ne upisuje se nigde: ni u bazu, ni u `admin_audit`, ni u log. Zato
// putuje kroz `Ishod.podaci`, a ne kroz `Ishod.payload` — polje koje ide u
// dnevnik je drugo polje. `upisiAudit()` ima i mrežu koja izbacuje ključeve
// nalik na lozinku, ali na tu mrežu se ne oslanjam: ona hvata grešku, a ovde
// greške nema jer put ne postoji.

import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { clerkStatus, type Ishod } from "./admin-radnje";
import { posaljiPozivnicuMejlom, posaljiPristupMejlom } from "./admin-mail";

/** Dva puta unutra. Pozivnica je podrazumevana (F12 §3.3). */
export type NacinPoziva = "pozivnica" | "nalog";

export type StatusPozivnice = "pending" | "accepted" | "revoked" | "expired";

export type PozivnicaRed = {
  id: string;
  email: string;
  status: StatusPozivnice;
  napravljena: string;
};

export type ListaPozivnica = {
  redovi: PozivnicaRed[];
  /** Rečenica zašto spiska nema. `null` kad je sve u redu. */
  greska: string | null;
};

/** Koliko pozivnica se prikazuje. Beta ih neće imati ni blizu toliko. */
const PO_STRANI = 50;

/**
 * Spisak poslatih pozivnica, najnovije prvo.
 *
 * Čita ga serverska komponenta ekrana, kao i lista korisnika — nema `GET` rute
 * pod `/api/admin/pozivnice` (isti razlog kao u „S3 — šta se razišlo", tačka 3:
 * druga vrata do istog podatka, sa istom proverom i bez ijednog pozivaoca).
 *
 * Pad Clerka se ne propagira: ekran i dalje ume da pošalje pozivnicu, samo ne
 * prikazuje šta je već poslato.
 */
export async function citajPozivnice(): Promise<ListaPozivnica> {
  try {
    const clerk = await clerkClient();
    const { data } = await clerk.invitations.getInvitationList({
      limit: PO_STRANI,
      orderBy: "-created_at",
    });

    return {
      redovi: data.map((p) => ({
        id: p.id,
        email: p.emailAddress,
        status: p.status,
        napravljena: new Date(p.createdAt).toISOString(),
      })),
      greska: null,
    };
  } catch (err) {
    console.error("[admin] spisak pozivnica:", err);
    return {
      redovi: [],
      greska:
        "Clerk trenutno ne odgovara, pa spisak poslatih pozivnica nije učitan. Slanje nove i dalje radi.",
    };
  }
}

// ── pozivnica ────────────────────────────────────────────────

/**
 * Pozivnica kroz Clerk, sa mejlom koji šaljem sam.
 *
 * `notify: false` je odstupanje od §3.3 i obrazloženo je u
 * `posaljiPozivnicuMejlom()`: Clerkov šablon je na engleskom i u njega ne ulazi
 * lična poruka iz obrasca.
 *
 * Kad mejl padne, radnja NIJE pad: pozivnica u Clerku postoji i link radi. Zato
 * se vraća `ok: true` sa linkom u `podaci` i rečenicom koja kaže šta se desilo —
 * `ok: false` bi značio da ću je poslati ponovo i dobiti „već postoji".
 */
export async function posaljiPozivnicu(
  email: string,
  poruka: string | null,
  origin: string,
): Promise<Ishod> {
  const clerk = await clerkClient();

  let pozivnica: { id: string; url?: string };
  try {
    pozivnica = await clerk.invitations.createInvitation({
      emailAddress: email,
      // Forma za registraciju je na početnoj, iza `?nalog=nov`; Clerk na taj URL
      // dopisuje `__clerk_ticket`, koji `<SignUp>` sam pokupi.
      redirectUrl: `${origin}/?nalog=nov`,
      notify: false,
    });
  } catch (err) {
    const p = clerkPad(err);
    if (p) return { ...p, payload: { email } };
    throw err instanceof Error ? err : new Error(String(err));
  }

  const link = pozivnica.url;
  if (!link) {
    // Nema šta da se pošalje, a pozivnica postoji. Opoziv je jedini uredan izlaz.
    return {
      ok: false,
      status: 502,
      poruka:
        "Clerk je napravio pozivnicu, ali nije vratio link. Opozovi je u spisku ispod, pa pokušaj ponovo.",
      ref: pozivnica.id,
      payload: { email },
    };
  }

  const mejl = await posaljiPozivnicuMejlom({ za: email, link, poruka });

  return {
    ok: true,
    poruka: mejl.ok
      ? `Pozivnica je poslata na ${email}. Link važi 30 dana.`
      : `Pozivnica je napravljena, ali mejl nije otišao (${mejl.greska}). Link je ispod — pošalji ga ručno.`,
    ref: pozivnica.id,
    payload: { email, nacin: "pozivnica", sa_porukom: Boolean(poruka), mejl_poslat: mejl.ok },
    // Link se prikazuje adminu i kad je mejl prošao: to je jedini način da ga
    // pošaljem Viberom nekome ko mejl ne otvara.
    podaci: { link, email },
  };
}

/** Opoziv (§3.3). Clerk pušta samo aktivne — opoziv opozvane je greška, ne no-op. */
export async function opoziviPozivnicu(id: string): Promise<Ishod> {
  try {
    const clerk = await clerkClient();
    const p = await clerk.invitations.revokeInvitation(id);

    return {
      ok: true,
      poruka: `Pozivnica za ${p.emailAddress} je opozvana. Link više ne radi.`,
      ref: id,
      payload: { email: p.emailAddress },
    };
  } catch (err) {
    const p = clerkPad(err);
    if (p) return { ...p, ref: id };
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ── otvaranje naloga ─────────────────────────────────────────

/**
 * Nalog odmah, sa generisanom lozinkom (§3.3, druga opcija).
 *
 * Za slučaj kad nekoga uvodim uživo i nemam vremena da čekam da otvori mejl.
 * Profil sa 30 kredita nastaje kroz `user.created` webhook, isto kao i za sve
 * ostale — ova funkcija bazu ne dodiruje.
 */
export async function otvoriNalog(
  email: string,
  poruka: string | null,
  origin: string,
): Promise<Ishod> {
  const lozinka = generisiLozinku();
  const clerk = await clerkClient();

  let korisnik: { id: string };
  try {
    korisnik = await clerk.users.createUser({
      emailAddress: [email],
      password: lozinka,
      skipLegalChecks: true,
    });
  } catch (err) {
    const p = clerkPad(err);
    if (p) return { ...p, payload: { email } };
    throw err instanceof Error ? err : new Error(String(err));
  }

  const mejl = await posaljiPristupMejlom({
    za: email,
    lozinka,
    prijava: `${origin}/`,
    poruka,
  });

  return {
    ok: true,
    poruka: mejl.ok
      ? `Nalog je otvoren i pristup je poslat na ${email}. Lozinka se vidi samo sada.`
      : `Nalog je otvoren, ali mejl nije otišao (${mejl.greska}). Prenesi lozinku ručno — vidi se samo sada.`,
    // `target` rute je mejl (naloga u `profiles` još nema), pa Clerk ID ide ovde.
    ref: korisnik.id,
    payload: { email, nacin: "nalog", sa_porukom: Boolean(poruka), mejl_poslat: mejl.ok },
    // JEDINO mesto na kom lozinka postoji posle ovog poziva. U `payload` ne ide.
    podaci: { lozinka, email },
  };
}

/**
 * Lozinka za prvu prijavu.
 *
 * Bez znakova koji se u razgovoru mešaju (`0`/`O`, `1`/`l`/`I`) — ovo se
 * ponekad čita naglas. 20 znakova iz azbuke od 56 je ~116 bita, dakle daleko
 * iznad svega što Clerkova provera traži, a i dalje se može prekucati.
 *
 * `crypto.getRandomValues`, ne `Math.random()`: ovo je pristup tuđem nalogu.
 * Bajtovi iz gornjeg, nepotpunog opsega se odbacuju, da raspodela ostane
 * ravnomerna.
 */
function generisiLozinku(duzina = 20): string {
  const AZBUKA = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const granica = 256 - (256 % AZBUKA.length);

  let izlaz = "";
  while (izlaz.length < duzina) {
    const bajtovi = new Uint8Array(duzina);
    crypto.getRandomValues(bajtovi);

    for (const b of bajtovi) {
      if (izlaz.length === duzina) break;
      if (b >= granica) continue;
      izlaz += AZBUKA[b % AZBUKA.length];
    }
  }

  return izlaz;
}

// ── greške iz Clerka ─────────────────────────────────────────

type ClerkGreska = { code?: string; message?: string; longMessage?: string };

/**
 * Clerkova greška u ishod koji admin razume.
 *
 * §6: „Pozivnica poslata dvaput na isti mejl — Clerk vraća grešku `već postoji`;
 * UI je prikazuje kao STANJE, ne kao pad." Zato ovde postoji spisak poznatih
 * kodova: bez njega bi na ekranu pisalo „duplicate_record", što je tačno i
 * beskorisno.
 *
 * `null` znači da greška nije Clerkova — ide dalje kao izuzetak, u `500` i u
 * dnevnik sa punom porukom.
 */
function clerkPad(err: unknown): { ok: false; status: number; poruka: string } | null {
  const status = clerkStatus(err);
  if (status === null) return null;

  const greske =
    typeof err === "object" && err !== null && "errors" in err
      ? ((err as { errors: unknown }).errors as ClerkGreska[] | undefined)
      : undefined;

  const kod = greske?.[0]?.code ?? "";
  const poznata = POZNATE[kod];

  return {
    ok: false,
    status: status === 422 ? 409 : status,
    poruka:
      poznata ??
      // Clerkov `longMessage` je engleski, ali je konkretan („Password has been
      // found in an online data breach"). Bolji je od moje generičke rečenice, i
      // ovo vidim samo ja.
      greske?.[0]?.longMessage ??
      greske?.[0]?.message ??
      "Clerk je odbio zahtev. Detalj stoji u reviziji.",
  };
}

const POZNATE: Record<string, string> = {
  duplicate_record: "Za taj mejl već postoji pozivnica koja čeka odgovor.",
  form_identifier_exists: "Taj mejl već ima nalog. Nema šta da se pozove.",
  invitation_account_exists: "Taj mejl već ima nalog. Nema šta da se pozove.",
  form_param_format_invalid: "Mejl adresa nije ispravnog oblika.",
  invitation_not_found: "Te pozivnice više nema — možda je već opozvana ili prihvaćena.",
  invitation_already_revoked: "Ta pozivnica je već opozvana.",
  invitation_already_accepted: "Ta pozivnica je već prihvaćena — nalog postoji.",
};
