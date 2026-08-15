// apps/web/src/lib/slika.ts
// Slika uz utisak (F11 odluka 9 i §4 „Storage").
//
// Korisnik nosi sliku: nalepi je (`Ctrl+V`) ili prevuče u panel. Bez
// `html2canvas`, bez snimanja ekrana, bez ijednog kilobajta biblioteke u
// bundle-u — a to je i bio jedini razlog zbog kog je F10 §8 screenshot odbio.
//
// ── zašto magični bajtovi, a ne `Content-Type` ───────────────
// `Content-Type` u multipart telu piše klijent. `image/png` uz `.php` sadržaj je
// jedan red koda za onoga ko to hoće. Tip se zato čita iz prvih bajtova fajla, a
// ime se ne koristi uopšte — putanja je `<user_id>/<uuid>.<ext>` (F11 §8).
//
// Bucket `feedback` je privatan i BEZ ijedne politike. Admin ga vidi kroz
// potpisan URL sa rokom od 10 minuta, generisan u trenutku otvaranja (F11.3).

import "server-only";
import { adminSupabase } from "./supabase";

export const SLIKA_BUCKET = "feedback";

/** Preko ovoga ide `413`. Dva megabajta su snimak ekrana, ne fotografija. */
export const SLIKA_MAX_BAJTOVA = 2 * 1024 * 1024;

/** Rate limit iz F11 §8. Broji se nad bucketom, pa hvata i neiskorišćene otpreme. */
export const SLIKA_DNEVNI_LIMIT = 10;

const DAN_MS = 24 * 60 * 60 * 1000;

export type VrstaSlike = { ext: "png" | "jpg" | "webp"; mime: string };

/**
 * Je li ova putanja u bucketu korisnikova.
 *
 * `screenshot_path` je jedino polje koje putuje kroz pregledač između dve rute,
 * pa je i jedino koje klijent može da zameni tuđim. Prvi segment putanje je
 * `user_id`, pa je provera jedno poređenje — bez nje bi ručno sastavljen zahtev
 * zakačio tuđu sliku uz svoj utisak i time je pokazao u adminu.
 */
export function mojaPutanja(userId: string, path: string): boolean {
  return path.startsWith(`${userId}/`) && !path.includes("..");
}

/**
 * Vrsta slike iz prvih bajtova. `null` znači „ovo nije png, jpeg ni webp".
 *
 * Tri potpisa i ništa više. Svaki dodatni format je dodatna površina za parser
 * koji ga posle otvara — a meni uz prijavu kvara treba snimak ekrana.
 */
export function prepoznajSliku(bajtovi: Uint8Array): VrstaSlike | null {
  const b = (i: number): number => bajtovi[i] ?? -1;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 &&
    b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }

  // JPEG: FF D8 FF
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }

  // WEBP: 'RIFF' …4 bajta dužine… 'WEBP'
  if (
    b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
    b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50
  ) {
    return { ext: "webp", mime: "image/webp" };
  }

  return null;
}

export type OtpremaIshod =
  | { ok: true; path: string }
  | { ok: false; razlog: "limit" | "storage"; poruka: string };

/**
 * Otprema u privatan bucket.
 *
 * `userId` je uvek iz verifikovane sesije (pravilo 8) i uvek je prvi segment
 * putanje — čak i da bucket ikad dobije politiku, ona ima po čemu da razdvoji
 * vlasnike.
 *
 * Ime fajla je `uuid`, ne korisnikovo: ime koje je stiglo iz pregledača ne ulazi
 * ni u putanju ni u bazu ni u mejl.
 */
export async function otpremiSliku(
  userId: string,
  bajtovi: Uint8Array,
  vrsta: VrstaSlike,
): Promise<OtpremaIshod> {
  const db = adminSupabase();

  const dozvoljeno = await preostaloDanas(userId);
  if (dozvoljeno <= 0) {
    return {
      ok: false,
      razlog: "limit",
      poruka: "Danas si poslao dovoljno slika. Utisak i dalje možeš da pošalješ bez nje.",
    };
  }

  const path = `${userId}/${crypto.randomUUID()}.${vrsta.ext}`;

  const { error } = await db.storage.from(SLIKA_BUCKET).upload(path, bajtovi, {
    contentType: vrsta.mime,
    // Ime je uuid, pa sudara nema — a `upsert: false` znači da ga ni slučajno
    // ne može biti.
    upsert: false,
  });

  if (error) {
    console.error("[slika] otprema:", error.message);
    return {
      ok: false,
      razlog: "storage",
      poruka: "Slika trenutno ne može da se sačuva. Utisak možeš da pošalješ i bez nje.",
    };
  }

  return { ok: true, path };
}

// ═══════════════════════════════════════════════════════════
// ADMIN: POTPISAN URL (F11.3, §4 „Storage")
// ═══════════════════════════════════════════════════════════

/**
 * Koliko živi potpis. Deset minuta je taman toliko da se slika pogleda, i
 * premalo da bi adresa iz istorije pregledača ikom išta značila.
 */
export const POTPIS_TRAJANJE_SEC = 10 * 60;

/**
 * Potpisan URL, generisan U TRENUTKU otvaranja detalja.
 *
 * Nikad unapred i nikad u mejlu (§4): potpis u pošti je tajna koja živi koliko i
 * mejl, a mejl živi zauvek. Zato digest i instant mejl nose samo putanju i link
 * na `/admin/utisci/<id>`, a potpis nastaje tek kad neko taj ekran otvori.
 *
 * `null` znači „nije uspelo" i prikazuje se kao stanje, ne kao prazna slika:
 * bucket koji još nije napravljen rukom (v. „S2 — ručni korak") daje isti ishod
 * kao i istekla veza sa Storage-om.
 */
export async function potpisanUrlSlike(path: string): Promise<string | null> {
  const { data, error } = await adminSupabase()
    .storage.from(SLIKA_BUCKET)
    .createSignedUrl(path, POTPIS_TRAJANJE_SEC);

  if (error) {
    console.error("[slika] potpisan URL:", error.message);
    return null;
  }

  return data?.signedUrl ?? null;
}

// ═══════════════════════════════════════════════════════════
// SIROTANI (F11 §9: „Slika se otpremi, utisak se ne pošalje")
// ═══════════════════════════════════════════════════════════

/** Mlađe od ovoga se ne dira — utisak uz sliku možda još nastaje. */
const SIROTAN_ROK_MS = 24 * 60 * 60 * 1000;

/** Gornja granica po prolazu. Cron je nedeljni, pa se ostatak briše sledeći put. */
const SIROTAN_PLAFON = 500;

export type SirotaniIshod = {
  /** Koliko fajlova je stvarno obrisano. */
  obrisano: number;
  /** Koliko je pregledano (svi stariji od 24 h, i vezani i nevezani). */
  pregledano: number;
  /** `true` kad je udareno u plafon — ostatak ide sledeći put. */
  odseceno: boolean;
  /** Rečenica o tome zašto ništa nije obrisano, kad Storage ne odgovara. */
  greska: string | null;
};

/**
 * Brisanje slika koje nijedan utisak ne pominje (nedeljni cron).
 *
 * Sirotan nastaje kad se slika otpremi pa se utisak nikad ne pošalje — otprema i
 * slanje su dva zahteva, a između njih stoji čovek koji sme da se predomisli.
 * Bez ovog posla bucket raste od svakog takvog predomišljanja.
 *
 * ── zašto rok od 24 h, a ne od pet minuta ────────────────────
 * Panel drži putanju u stanju komponente dok se piše tekst. Rok mora da bude
 * duži od najduže sesije pisanja, a ne od tehničkog prozora između dva zahteva.
 *
 * Sumnja uvek ide u korist fajla: sve što se ne može pouzdano proglasiti
 * sirotanom (Storage ne odgovara, upit nad `feedback` padne) ostaje na disku.
 * Obrisana slika uz živu prijavu se ne vraća.
 */
export async function obrisiSirotanskeSlike(sada = Date.now()): Promise<SirotaniIshod> {
  const db = adminSupabase();
  const prazan: SirotaniIshod = { obrisano: 0, pregledano: 0, odseceno: false, greska: null };

  // Koren bucketa nosi po jednu „fasciklu" po korisniku (`<user_id>/…`).
  const { data: fascikle, error: greskaKorena } = await db.storage
    .from(SLIKA_BUCKET)
    .list("", { limit: 1000 });

  if (greskaKorena) {
    console.error("[slika] listanje bucketa:", greskaKorena.message);
    return { ...prazan, greska: `Storage nije odgovorio: ${greskaKorena.message}` };
  }

  const granica = sada - SIROTAN_ROK_MS;
  const kandidati: string[] = [];
  let odseceno = false;

  for (const f of fascikle ?? []) {
    // Supabase u listi vraća i fajlove i prefikse; prefiks nema `id`.
    if (f.id !== null || !f.name) continue;
    if (kandidati.length >= SIROTAN_PLAFON) {
      odseceno = true;
      break;
    }

    const { data: fajlovi, error } = await db.storage
      .from(SLIKA_BUCKET)
      .list(f.name, { limit: 1000 });

    if (error) {
      console.error(`[slika] listanje ${f.name}:`, error.message);
      // Jedna fascikla koja ne odgovara ne sme da zaustavi ostale, ali ni da se
      // proglasi praznom.
      continue;
    }

    for (const fajl of fajlovi ?? []) {
      if (fajl.id === null || !fajl.name) continue;
      if (Date.parse(fajl.created_at ?? "") >= granica) continue;
      if (kandidati.length >= SIROTAN_PLAFON) {
        odseceno = true;
        break;
      }
      kandidati.push(`${f.name}/${fajl.name}`);
    }
  }

  if (kandidati.length === 0) return { ...prazan, odseceno };

  // Ko je od njih vezan za utisak. Upit ide nad putanjama koje SU nađene, ne nad
  // celom tabelom — spisak je najviše `SIROTAN_PLAFON` dugačak.
  const vezane = new Set<string>();

  for (let i = 0; i < kandidati.length; i += 100) {
    const deo = kandidati.slice(i, i + 100);
    const { data, error } = await db
      .from("feedback")
      .select("screenshot_path")
      .in("screenshot_path", deo)
      .returns<{ screenshot_path: string | null }[]>();

    if (error) {
      console.error("[slika] provera veza sa utiscima:", error.message);
      return {
        ...prazan,
        pregledano: kandidati.length,
        greska: `Veze sa utiscima se ne mogu pročitati, pa ništa nije obrisano: ${error.message}`,
      };
    }

    for (const red of data ?? []) if (red.screenshot_path) vezane.add(red.screenshot_path);
  }

  const zaBrisanje = kandidati.filter((p) => !vezane.has(p));
  let obrisano = 0;

  for (let i = 0; i < zaBrisanje.length; i += 100) {
    const deo = zaBrisanje.slice(i, i + 100);
    const { data, error } = await db.storage.from(SLIKA_BUCKET).remove(deo);

    if (error) {
      console.error("[slika] brisanje sirotana:", error.message);
      return {
        obrisano,
        pregledano: kandidati.length,
        odseceno,
        greska: `Brisanje je stalo posle ${obrisano}: ${error.message}`,
      };
    }

    obrisano += data?.length ?? deo.length;
  }

  return { obrisano, pregledano: kandidati.length, odseceno, greska: null };
}

/**
 * Koliko slika korisniku ostaje danas.
 *
 * Broji se nad bucketom, a ne nad `feedback.screenshot_path`: slika koja je
 * otpremljena pa utisak nikad poslat (§9, „sirotan u Storage-u") mora da se
 * računa, inače je limit od 10 zapravo neograničen.
 *
 * Sumnja ide u korist korisnika: ako listanje padne, otprema prolazi. Gornja
 * granica i dalje postoji — 2 MB po fajlu i Vercel-ov limit tela zahteva.
 */
async function preostaloDanas(userId: string): Promise<number> {
  const { data, error } = await adminSupabase()
    .storage.from(SLIKA_BUCKET)
    .list(userId, { limit: 100, sortBy: { column: "created_at", order: "desc" } });

  if (error) {
    console.error("[slika] brojanje dnevne kvote:", error.message);
    return SLIKA_DNEVNI_LIMIT;
  }

  const od = Date.now() - DAN_MS;
  const danas = (data ?? []).filter((f) => Date.parse(f.created_at ?? "") >= od).length;

  return SLIKA_DNEVNI_LIMIT - danas;
}
