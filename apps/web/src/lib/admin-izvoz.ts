// apps/web/src/lib/admin-izvoz.ts
// Izvoz korisnika u CSV (F12 §4, red `/api/admin/izvoz`).
//
// Ovo je jedini put kojim PII izlazi iz sistema u fajl, pa je i jedina radnja
// pod `/api/admin` koja ništa ne menja a ipak ostavlja red u dnevniku (§5:
// „Izvoz korisnika (PII) upisuje red u audit sa brojem redova"). Broj redova je
// tu bitniji od same radnje: „izvezao sam listu" i „izvezao sam listu od 380
// ljudi" nisu isti događaj.
//
// Bez ijednog poziva Clerku. Ime i poslednja prijava bi tražili drugi servis za
// podatke koje ionako nemam gde da upotrebim u tabeli — a svaki spoljni poziv
// ovde znači da izvoz ume da padne zato što je Clerk spor.

import "server-only";
import { toCsv, type AdminUserRow } from "@sajtoskop/shared";
import { adminSupabase } from "./supabase";

/**
 * Gornja granica izvoza.
 *
 * Nije dnevni cap (to je `claim_export` za korisnički izvoz, F4) nego brana od
 * fajla koji se pravi minut. Kad se dosegne, ruta to KAŽE — tiho odsečen fajl je
 * fajl na osnovu koga se donese pogrešan zaključak.
 */
export const IZVOZ_MAX = 5_000;

/** `admin_users_page` ima svoj plafon od 100 po pozivu (0012). */
const PO_POZIVU = 100;

export type IzvozKorisnika = {
  csv: string;
  redova: number;
  /** `true` kad je stalo na `IZVOZ_MAX`, pa u fajlu nisu svi. */
  odseceno: boolean;
  filename: string;
};

const KOLONE = [
  "clerk_id",
  "mejl",
  "plan",
  "uloga",
  "krediti",
  "otkljucano",
  "pretraga",
  "utisaka",
  "registrovan",
  "poslednji_put",
];

/**
 * Cela lista, kroz istu funkciju kroz koju ide i ekran.
 *
 * Kroz `admin_users_page`, a ne kroz `select * from profiles`, iz jednog
 * razloga: brojevi otključanih, pretraga i utisaka u fajlu moraju da budu isti
 * oni koje sam gledao na ekranu. Drugi upit sa istim namerama je drugi upit koji
 * jednog dana broji drugačije.
 *
 * Cena je petlja po stranicama od 100 — na obimu bete jedan poziv, a na obimu na
 * kom bi ih bilo deset ovaj ekran ionako više ne bi bio jedina konzola.
 */
export async function izveziKorisnike(): Promise<IzvozKorisnika> {
  const db = adminSupabase();
  const redovi: AdminUserRow[] = [];
  let odseceno = false;

  for (let offset = 0; offset < IZVOZ_MAX; offset += PO_POZIVU) {
    const { data, error } = await db.rpc("admin_users_page", {
      p_q: null,
      p_filter: "svi",
      p_plan: null,
      p_sort: "created_at",
      p_dir: "desc",
      p_limit: PO_POZIVU,
      p_offset: offset,
    });

    if (error) throw new Error(`Čitanje korisnika za izvoz nije uspelo: ${error.message}`);

    const strana = (data ?? []) as AdminUserRow[];
    redovi.push(...strana);

    if (strana.length < PO_POZIVU) break;
    if (redovi.length >= IZVOZ_MAX) {
      odseceno = redovi[0] ? redovi[0].ukupno > redovi.length : false;
      break;
    }
  }

  return {
    csv: toCsv(
      [...KOLONE],
      redovi.map((r) => [
        r.id,
        r.email ?? "",
        r.plan,
        r.role,
        r.credits_balance,
        r.unlocks_count,
        r.searches_count,
        r.feedback_count,
        r.created_at,
        r.last_seen_at ?? "",
      ]),
    ),
    redova: redovi.length,
    odseceno,
    filename: `sajtoskop-korisnici-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}
