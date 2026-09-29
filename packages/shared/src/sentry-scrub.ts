// packages/shared/src/sentry-scrub.ts
// `beforeSend` za Sentry — jedan izvor istine za web i worker (checklista 2.1).
//
// Sentry je treća strana koja vidi naše greške. Greška u ovoj aplikaciji ume da
// nosi tuđ kontakt: poruka iz `fetch-site` sa URL-om sajta prospekta, Clerk
// webhook sa mejlom korisnika, breadcrumb sa `console.log`-om u kome stoji
// telefon. ZZPL (bezbednost.md, P1) kaže da se pun kontakt ne loguje — a
// Sentry je log koji živi na tuđem serveru.
//
// ── šta se briše ────────────────────────────────────────────
//   - telo zahteva (`request.data`), kolačići, query string
//   - SVA zaglavlja osim uske liste bezopasnih — dakle i `authorization`,
//     `cookie`, `stripe-signature`, `svix-*` (Clerk), `x-clerk-*`. Lista je
//     dozvoljena, ne zabranjena: novo zaglavlje koje sutra doda Stripe ili Clerk
//     ne sme da prođe samo zato što ga niko nije upisao.
//   - mejl, telefon i URL/domen u SVAKOM stringu događaja (poruka, vrednost
//     izuzetka, breadcrumbs, extra, contexts, tagovi, promenljive okvira)
//   - vrednosti polja čije ime kaže da je kontakt (`email`, `phone`, `website_url`…)
//   - `user` ostaje samo sa `id` (Clerk ID; nije kontakt)
//
// ── šta ostaje ──────────────────────────────────────────────
// Stek (putanje fajlova, imena funkcija, linije izvora), tip izuzetka, putanja
// naše rute bez query stringa, i hostovi naše infrastrukture (Supabase, Stripe,
// Clerk, Google API…) — bez njih se ne vidi KOJI spoljni servis je pao, a oni
// nisu ničiji lični podatak.
//
// Funkcija je čista i generička (nema `@sentry/*` tipova), jer ovaj paket ne
// zavisi od Sentry-ja i učitava ga i edge runtime (v. pravilo u `index.ts`).

const REDIGOVAN_MEJL = "[mejl]";
const REDIGOVAN_TELEFON = "[telefon]";
const REDIGOVAN_URL = "[url]";
const REDIGOVANO = "[redigovano]";

/** Zaglavlja koja smeju da ostanu. Sve ostalo se briše. */
const ZAGLAVLJA = ["accept", "content-length", "content-type", "host", "user-agent", "x-vercel-id"];
const DOZVOLJENA_ZAGLAVLJA = new Set(ZAGLAVLJA);

/**
 * `dataCollection` za `Sentry.init` — PRVA linija; `beforeSend` je druga.
 *
 * Sentry 10.x je `sendDefaultPii` proglasio zastarelim u korist ovog objekta
 * (u v11 ga više nema), a podrazumevano on skuplja SVE: tela zahteva i odgovora, kolačiće, zaglavlja, query string i
 * vrednosti lokalnih promenljivih u okvirima steka. Za aplikaciju čije tela
 * nose `placeId`, a promenljive u workeru URL sajta i telefon prospekta, to je
 * pogrešan podrazumevani izbor, pa se gasi eksplicitno i na jednom mestu.
 *
 * Oblik je strukturno isti kao Sentry-jev `DataCollection`; ovaj paket ne
 * zavisi od `@sentry/*`, pa se tip ne uvozi. `httpBodies: []` je `never[]`,
 * što se dodeljuje nizu bilo kog tipa. Pošto objekat stiže iz funkcije, TS ne
 * javlja polje koje SDK ne poznaje — pri nadogradnji Sentry-ja uporedi ključeve
 * sa `DataCollection` iz `@sentry/core`.
 */
export function sentryPrikupljanje() {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: [...ZAGLAVLJA] }, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
  };
}

/**
 * Imena polja čija je vrednost kontakt sama po sebi, bez obzira na oblik.
 * Poređenje ide nad imenom bez `_`/`-` i malim slovima.
 */
const KONTAKT_POLJA = new Set([
  "email",
  "emails",
  "emailaddress",
  "emailaddresses",
  "mail",
  "phone",
  "phones",
  "phonenumber",
  "telefon",
  "nationalphonenumber",
  "internationalphonenumber",
  "website",
  "websiteurl",
  "websiteuri",
  "sajt",
  "ipaddress",
]);

/**
 * Polja koja se ne diraju: struktura steka i metapodaci SDK-a. U njima nema
 * korisničkog podatka, a `[url]` umesto `abs_path` bi stek učinio beskorisnim.
 */
const NETAKNUTA_POLJA = new Set([
  "abs_path",
  "context_line",
  "debug_meta",
  "environment",
  "event_id",
  "filename",
  "function",
  "module",
  "modules",
  "platform",
  "post_context",
  "pre_context",
  "release",
  "sdk",
  "server_name",
  "start_timestamp",
  "timestamp",
  "type",
]);

/**
 * Naša infrastruktura. Host sa ove liste ostaje (bez query stringa); sve ostalo
 * je potencijalno sajt prospekta i postaje `[url]`.
 */
const INFRA_HOST =
  /(^|\.)(supabase\.co|supabase\.in|stripe\.com|clerk\.com|clerk\.accounts\.dev|googleapis\.com|anthropic\.com|resend\.com|sentry\.io|sajtoskop\.com|vercel\.app|localhost)$/i;

const MEJL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

// Šema, pa sve do razmaka, navodnika ili zatvorene zagrade.
const URL_SA_SEMOM = /\b(?:https?|wss?|ftp):\/\/[^\s"'<>`)\]]+/gi;

// Goli domen: `primer.rs`, `www.firma.co.rs/kontakt`. Lista TLD-ova je namerno
// zatvorena — otvoren obrazac bi pojeo i `supabase.rpc` i `route.ts`.
const TLD =
  "rs|srb|com|net|org|info|biz|eu|io|co|me|ba|hr|mk|si|al|bg|ro|hu|de|at|ch|uk|online|site|shop|store|app|dev|xyz|pro|top";
const GOLI_DOMEN = new RegExp(
  `\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLD})\\b(?:/[^\\s"'<>\`)\\]]*)?`,
  "gi",
);

// Kandidat za telefon: počinje sa `+` ili `0`, pa cifre sa razmacima, crticama,
// kosim crtama i zagradama. Da li jeste telefon odlučuje broj cifara (v.
// `jeTelefon`) — sam obrazac bi pojeo i datum `09-29 12`.
const TELEFON_KANDIDAT = /(?:\+|\b0)\d[\d\s\-/().]{5,20}\d/g;

function jeTelefon(kandidat: string): boolean {
  const cifre = kandidat.replace(/\D/g, "").length;
  // Srpski brojevi imaju 8–10 cifara bez pozivnog, do 12 sa +381. Duži niz je
  // ID ili UUID, ne broj koji neko bira.
  return cifre >= 8 && cifre <= 13;
}

function uUrl(tekst: string): URL | null {
  try {
    return new URL(tekst.includes("://") ? tekst : `https://${tekst}`);
  } catch {
    return null;
  }
}

/** Infrastruktura ostaje kao origin + putanja; sve ostalo je `[url]`. */
function zameniUrl(tekst: string): string {
  const u = uUrl(tekst);
  if (!u || !INFRA_HOST.test(u.hostname)) return REDIGOVAN_URL;
  // Putanja ostaje i u golom obliku: `GOLI_DOMEN` ide PREKO izlaza `URL_SA_SEMOM`
  // i u `https://x.supabase.co/rest/v1/…` ponovo nađe `x.supabase.co/rest/v1/…`.
  const putanja = u.pathname === "/" ? "" : u.pathname;
  return tekst.includes("://") ? `${u.origin}${putanja}` : `${u.hostname}${putanja}`;
}

/** Mejl, URL, goli domen i telefon iz slobodnog teksta. Redosled je bitan. */
export function ocistiTekst(tekst: string): string {
  return (
    tekst
      // Mejl prvi: domen mejla bi inače pojeo `GOLI_DOMEN` i ostavio `ime@[url]`.
      .replace(MEJL, REDIGOVAN_MEJL)
      .replace(URL_SA_SEMOM, zameniUrl)
      .replace(GOLI_DOMEN, zameniUrl)
      .replace(TELEFON_KANDIDAT, (k) => (jeTelefon(k) ? REDIGOVAN_TELEFON : k))
  );
}

function kljucPolja(ime: string): string {
  return ime.toLowerCase().replace(/[_-]/g, "");
}

function jeObjekat(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Dubina je ograničena: Sentry sam seče na 3–5 nivoa, ovo je samo osigurač. */
function ocistiVrednost(v: unknown, dubina: number): unknown {
  if (typeof v === "string") return ocistiTekst(v);
  if (dubina > 12) return v;
  if (Array.isArray(v)) return v.map((x) => ocistiVrednost(x, dubina + 1));
  if (jeObjekat(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "headers") out[k] = ocistiZaglavlja(x);
      else if (NETAKNUTA_POLJA.has(k)) out[k] = x;
      else if (KONTAKT_POLJA.has(kljucPolja(k))) out[k] = x == null ? x : REDIGOVANO;
      else out[k] = ocistiVrednost(x, dubina + 1);
    }
    return out;
  }
  return v;
}

function ocistiZaglavlja(z: unknown): Record<string, unknown> {
  if (!jeObjekat(z)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(z)) {
    if (DOZVOLJENA_ZAGLAVLJA.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/** Putanja naše rute bez query stringa i hash-a — isto pravilo kao `dnevnik-gresaka.ts`. */
function golaPutanja(url: unknown): unknown {
  if (typeof url !== "string") return url;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

function ocistiZahtev(req: unknown): unknown {
  if (!jeObjekat(req)) return undefined;
  const out: Record<string, unknown> = {};
  if (req.method !== undefined) out.method = req.method;
  if (req.url !== undefined) out.url = golaPutanja(req.url);
  out.headers = ocistiZaglavlja(req.headers);
  // `data`, `cookies`, `query_string`, `env` se ne prepisuju — nestaju.
  return out;
}

function ocistiKorisnika(u: unknown): unknown {
  if (!jeObjekat(u)) return undefined;
  return typeof u.id === "string" || typeof u.id === "number" ? { id: u.id } : undefined;
}

/**
 * `beforeSend` / `beforeSendTransaction`. Vraća NOV objekat; ulaz se ne menja.
 *
 * Tip je generički da bi ga web (`@sentry/nextjs`) i worker (`@sentry/node`)
 * pozvali sa svojim `ErrorEvent`-om bez kastovanja na pozivajućoj strani.
 */
export function ocistiSentryDogadjaj<T extends object>(dogadjaj: T): T {
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(dogadjaj)) {
    if (k === "request") {
      const r = ocistiZahtev(v);
      if (r !== undefined) out.request = r;
    } else if (k === "user") {
      const u = ocistiKorisnika(v);
      if (u !== undefined) out.user = u;
    } else if (NETAKNUTA_POLJA.has(k)) out[k] = v;
    else out[k] = ocistiVrednost(v, 0);
  }

  return out as T;
}
