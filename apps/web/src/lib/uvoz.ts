// apps/web/src/lib/uvoz.ts
// Uvoz postojećeg `pipeline-biznisi` Sheeta u kanban (F7 §4).
//
// ═══════════════════════════════════════════════════════════
// ZAŠTO UVOZ NE OTKLJUČAVA BESPLATNO — čitaj pre nego što ovo „popraviš"
// ═══════════════════════════════════════════════════════════
// `lead_status` ima strani ključ na `unlocks` (migracija 0007), pa red za
// neotključan lead ne može da nastane. Očigledna „popravka" je da uvoz sam upiše
// red u `unlocks` za sve što je upario, bez skidanja kredita.
//
// To je rupa kroz koju procuri ceo proizvod. Zaključan lead u pretrazi javno
// pokazuje NAZIV i GRAD — to je mamac i mora da bude vidljivo. Uvoz koji upari
// po nazivu i gradu i onda otključa besplatno znači da bilo ko prekopira
// rezultate pretrage u CSV, uveze ga, i dobije telefone, mejlove i celu analizu
// za nula kredita. Nijedan cap to ne zatvara, jer je izvor podataka sama
// aplikacija.
//
// Zato uvoz radi u dva režima, oba unutar postojećeg kreditnog modela:
//
//   podrazumevano — postavlja status SAMO onome što je korisnik već otključao.
//                   Ostalo se ne dira i prebroji se u izveštaju.
//   uz `trosiKredite` — za uparene a neotključane redove zove
//                   `spend_credit_and_unlock`, isti put kao dugme „Otključaj".
//                   Nema zaobilaznice, nema nove funkcije, nema nove rupe.
//
// Za sopstvenu istoriju od par stotina redova put je `grant_credits` sa
// `service_role` — to je admin operacija koja već postoji od F1, i namerno nije
// izložena kroz ovu rutu.

import "server-only";
import { CITIES, fromCsv, foldForSearch, slugify } from "@sajtoskop/shared";
import type { BusinessRow, LeadStatusValue } from "@sajtoskop/shared";
import { adminSupabase, userSupabase } from "./supabase";
import { unlockLead } from "./unlock";

/** Gornja granica jednog uvoza. Sheet od par stotina redova je stvarni slučaj. */
const MAX_REDOVA = 2000;

/** Koliko biznisa se učitava za uparivanje. Zaštita od uvoza sa 50 gradova. */
const MAX_KANDIDATA = 20_000;

/**
 * Nazivi kolona koje uvoz prepoznaje, po nameni.
 *
 * Više varijanti po namerno: Sheet je pisan rukom kroz dve godine i kolone se u
 * njemu zovu kako su se tog dana zvale. Uvoz koji traži tačno jedan naziv
 * proglasiće ispravan fajl neispravnim.
 */
const KOLONE = {
  naziv: ["naziv", "ime", "firma", "biznis", "name"],
  telefon: ["telefon", "tel", "broj", "phone", "kontakt"],
  grad: ["grad", "mesto", "city"],
  status: ["status", "faza", "stanje"],
  beleska: ["beleska", "beleška", "napomena", "komentar", "note"],
  kanal: ["kanal", "channel", "nacin", "način"],
} as const;

/**
 * Vrednosti statusa iz Sheeta → status u aplikaciji.
 *
 * Ključevi su prošli kroz `foldForSearch`, pa „Odgovorio" i „odgovorio" i
 * ćirilično „Одговорио" padaju na isti ključ.
 */
const STATUS_MAPA: Record<string, LeadStatusValue> = {
  nekontaktiran: "nekontaktiran",
  novo: "nekontaktiran",
  kontaktiran: "kontaktiran",
  poslato: "kontaktiran",
  javljeno: "kontaktiran",
  odgovorio: "odgovorio",
  "javio se": "odgovorio",
  odgovoreno: "odgovorio",
  potpisan: "potpisan",
  posao: "potpisan",
  klijent: "potpisan",
  nezainteresovan: "nezainteresovan",
  odbio: "nezainteresovan",
  ne: "nezainteresovan",
};

const KANAL_MAPA: Record<string, "mejl" | "viber" | "instagram" | "poziv"> = {
  mejl: "mejl",
  mail: "mejl",
  email: "mejl",
  viber: "viber",
  instagram: "instagram",
  ig: "instagram",
  poziv: "poziv",
  telefon: "poziv",
};

export type UvozIzvestaj = {
  procitano: number;
  /** Redovi kojima je status upisan. */
  uvezeno: number;
  /** Upareni, ali nisu otključani — bez `trosiKredite` se ne diraju. */
  zakljucano: number;
  /** Upareni i neotključani, a kredita je nestalo usput. */
  bezKredita: number;
  /** Nijedan biznis u bazi ne odgovara redu. */
  nenadjeno: number;
  /** Više od jednog biznisa odgovara — uvoz ne pogađa koji. */
  dvosmisleno: number;
  /** Prvih nekoliko neuparenih naziva, da se odmah vidi zašto. */
  primeriNenadjenih: string[];
  /** Upozorenja o samom fajlu (nedostaje kolona i slično). */
  upozorenja: string[];
};

export type UvozIshod =
  | { ok: true; izvestaj: UvozIzvestaj }
  | { ok: false; greska: string };

type Kandidat = Pick<BusinessRow, "place_id" | "name" | "city_slug" | "phone">;

/** Poslednjih osam cifara — pouzdanije od punog broja koji ume da nosi +381 ili 0. */
function telefonKljuc(raw: string | null): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
}

function nazivKljuc(name: string, citySlug: string): string {
  return `${citySlug}::${foldForSearch(name).replace(/[^a-z0-9]+/g, "")}`;
}

/** Prvo polje iz reda koje odgovara nekom od dozvoljenih naziva kolone. */
function polje(red: Record<string, string>, imena: readonly string[]): string {
  for (const [k, v] of Object.entries(red)) {
    if (imena.includes(foldForSearch(k).trim()) && v.trim()) return v.trim();
  }
  return "";
}

/** „Šabac", „sabac", „ŠABAC" → `sabac`. Prazno kad grad nije iz taksonomije. */
function gradSlug(raw: string): string | null {
  if (!raw) return null;
  const trazeno = slugify(raw);
  const grad = CITIES.find((c) => c.slug === trazeno || slugify(c.label) === trazeno);
  return grad?.slug ?? null;
}

export async function uveziPipeline(
  userId: string,
  csv: string,
  trosiKredite: boolean,
): Promise<UvozIshod> {
  let redovi: Record<string, string>[];
  try {
    redovi = fromCsv(csv);
  } catch {
    return { ok: false, greska: "Fajl nije ispravan CSV." };
  }

  if (redovi.length === 0) return { ok: false, greska: "CSV nema nijedan red." };
  if (redovi.length > MAX_REDOVA) {
    return { ok: false, greska: `CSV ima ${redovi.length} redova, granica je ${MAX_REDOVA}.` };
  }

  const upozorenja: string[] = [];

  // Redovi se prvo svode na ono što uvoz koristi. Sve ostalo iz Sheeta se
  // namerno ignoriše — uvoz postavlja status, ne prepisuje bazu.
  const stavke = redovi.map((r) => ({
    naziv: polje(r, KOLONE.naziv),
    telefon: polje(r, KOLONE.telefon),
    grad: gradSlug(polje(r, KOLONE.grad)),
    status: STATUS_MAPA[foldForSearch(polje(r, KOLONE.status))] ?? null,
    beleska: polje(r, KOLONE.beleska),
    kanal: KANAL_MAPA[foldForSearch(polje(r, KOLONE.kanal))] ?? null,
  }));

  const gradovi = [...new Set(stavke.flatMap((s) => (s.grad ? [s.grad] : [])))];

  if (gradovi.length === 0) {
    return {
      ok: false,
      greska:
        "Nijedan red nema prepoznat grad. Dodaj kolonu „grad“ sa nazivom iz liste gradova " +
        "(npr. Šabac, Novi Sad) — bez nje uvoz ne zna gde da traži prospekt.",
    };
  }

  const bezGrada = stavke.filter((s) => !s.grad).length;
  if (bezGrada > 0) upozorenja.push(`${bezGrada} redova nema prepoznat grad i preskočeno je.`);

  const kandidati = await ucitajKandidate(gradovi);
  if (kandidati.length >= MAX_KANDIDATA) {
    upozorenja.push(
      `Učitano je ${MAX_KANDIDATA} prospekata za uparivanje — suzi CSV na manje gradova.`,
    );
  }

  // Dva indeksa, i oba čuvaju SVE pogotke, ne prvi. Naziv „Restoran Park" ume da
  // postoji u dva grada; bez brojanja pogodaka uvoz bi tiho upisao status
  // pogrešnoj firmi, a to je greška koja se otkrije tek kad neko dobije poruku.
  const poTelefonu = new Map<string, string[]>();
  const poNazivu = new Map<string, string[]>();

  for (const k of kandidati) {
    const t = telefonKljuc(k.phone);
    if (t) dodaj(poTelefonu, t, k.place_id);
    dodaj(poNazivu, nazivKljuc(k.name, k.city_slug), k.place_id);
  }

  const otkljucani = await ucitajOtkljucane();

  const izvestaj: UvozIzvestaj = {
    procitano: stavke.length,
    uvezeno: 0,
    zakljucano: 0,
    bezKredita: 0,
    nenadjeno: 0,
    dvosmisleno: 0,
    primeriNenadjenih: [],
    upozorenja,
  };

  const db = adminSupabase();
  let kreditiPresli = false;

  for (const s of stavke) {
    if (!s.grad) continue;

    // Telefon prvi: broj je jedinstven, naziv nije. Uparivanje po nazivu je
    // rezerva za redove u kojima telefona nema.
    const t = telefonKljuc(s.telefon);
    const pogoci = (t && poTelefonu.get(t)) || poNazivu.get(nazivKljuc(s.naziv, s.grad)) || [];

    if (pogoci.length === 0) {
      izvestaj.nenadjeno++;
      if (izvestaj.primeriNenadjenih.length < 5 && s.naziv) {
        izvestaj.primeriNenadjenih.push(s.naziv);
      }
      continue;
    }

    if (pogoci.length > 1) {
      izvestaj.dvosmisleno++;
      continue;
    }

    const placeId = pogoci[0]!;

    if (!otkljucani.has(placeId)) {
      if (!trosiKredite || kreditiPresli) {
        izvestaj[trosiKredite ? "bezKredita" : "zakljucano"]++;
        continue;
      }

      // Isti put kao dugme „Otključaj", ne direktan RPC: `unlockLead` uz kredit
      // upisuje i `enrich_full` posao. Bez toga bi uvezeni prospekt ostao bez
      // screenshota, PageSpeed skora i analize — dakle bez svega zbog čega je
      // kredit i skinut, i to bi se primetilo tek kad mu se otvori kartica.
      const ishod = await unlockLead(userId, placeId);
      if (!ishod.ok) {
        izvestaj.bezKredita++;
        // Samo prazan balans zaustavlja ostatak uvoza: svaki dalji poziv bi
        // vratio isto, a petlja ume da ima dve hiljade koraka. Red koji je pao
        // iz drugog razloga (`no_place` — biznis obrisan između uparivanja i
        // otključavanja) je greška tog jednog reda i ne sme da obori uvoz.
        if (ishod.reason === "insufficient_credits") kreditiPresli = true;
        continue;
      }
      otkljucani.add(placeId);
    }

    const { error } = await db.rpc("set_lead_status", {
      p_user: userId,
      p_place: placeId,
      // Red u pipeline Sheetu znači da je kontakt bio — to je jedini razlog zbog
      // kog je red tamo. `nekontaktiran` bi obrisao upravo ono što se uvozi.
      p_status: s.status ?? "kontaktiran",
      p_channel: s.kanal,
    });

    if (error) throw new Error(`Uvoz statusa nije uspeo: ${error.message}`);

    if (s.beleska) {
      const { error: nErr } = await db.rpc("set_lead_note", {
        p_user: userId,
        p_place: placeId,
        p_note: s.beleska,
      });
      if (nErr) console.error("[uvoz] beleška nije upisana:", nErr.message);
    }

    izvestaj.uvezeno++;
  }

  return { ok: true, izvestaj };
}

function dodaj(mapa: Map<string, string[]>, kljuc: string, id: string) {
  const p = mapa.get(kljuc);
  if (p) p.push(id);
  else mapa.set(kljuc, [id]);
}

async function ucitajKandidate(gradovi: string[]): Promise<Kandidat[]> {
  const { data, error } = await adminSupabase()
    .from("businesses")
    .select("place_id, name, city_slug, phone")
    .in("city_slug", gradovi)
    .limit(MAX_KANDIDATA)
    .returns<Kandidat[]>();

  if (error) throw new Error(`Čitanje prospekata za uparivanje nije uspelo: ${error.message}`);
  return data ?? [];
}

/** Kroz RLS — ista brava kao svuda gde se čita šta je korisnik otključao. */
async function ucitajOtkljucane(): Promise<Set<string>> {
  const { data, error } = await userSupabase()
    .from("unlocks")
    .select("place_id")
    .returns<{ place_id: string }[]>();

  if (error) throw new Error(`Čitanje otključanih prospekata nije uspelo: ${error.message}`);
  return new Set((data ?? []).map((r) => r.place_id));
}

