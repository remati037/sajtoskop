// apps/web/src/lib/feedback-mail.ts
// Mejl sa utiskom, kroz Resend (F10 §3).
//
// Sastavljanje poruke je ovde; samo slanje je u `lib/mail.ts`, zajedno sa
// tajmautom, čišćenjem ključa iz greške i proverom `Reply-To` adrese. Do F12.3
// je taj `fetch` stajao ovde — izdvojen je kad je stigla i pošta koja ide
// drugim ljudima (pozivnica, poruka korisniku).
//
// Preko `job_queue` bi značilo da mi mejl stiže tek kad worker povuče red, a
// poenta cele faze je da bug vidim odmah.
//
// Baza je izvor istine, mejl je obaveštenje (odluka 3). Zato nijedna funkcija
// odavde ne baca: pad se vraća kao `{ ok: false, greska }` i završi u
// `feedback.email_error`, a korisnik i dalje vidi „Poslato".

import "server-only";
import type { FeedbackCtx, FeedbackKind, FeedbackSource } from "@sajtoskop/shared";
import { opisOdgovora, pitanjeZaKljuc } from "@sajtoskop/shared";
import { feedbackMailEnv } from "./env";
import { escapeHtml, posaljiMejl, type MejlIshod } from "./mail";
import { plural } from "./ui-tekst";

/** Emodži postoji SAMO ovde — subject je moj inboks i nije pod dizajn sistemom. */
const OCENA_EMODZI: Record<1 | 2 | 3, string> = { 1: "😕", 2: "😐", 3: "🤩" };
const OCENA_LABEL: Record<1 | 2 | 3, string> = { 1: "Loše", 2: "Ok", 3: "Odlično" };

const TIP_LABEL: Record<FeedbackKind, string> = {
  bug: "Bug",
  ideja: "Ideja",
  pohvala: "Pohvala",
  drugo: "Drugo",
};

const CRTA = "————————————————————————————";

export type UtisakZaMejl = {
  id: number;
  /** `null` od F11: odgovor na pitanje nema ocenu, ima odgovor. */
  rating: 1 | 2 | 3 | null;
  kind: FeedbackKind | null;
  message: string | null;
  source: FeedbackSource;
  route: string | null;
  routeLabel: string | null;
  ctx: FeedbackCtx;
  createdAt: string;
  /** F11: ključ pitanja iz kataloga, i odgovor na njega. */
  promptKey?: string | null;
  answers?: Record<string, unknown> | null;
  severity?: 1 | 2 | 3 | null;
  /**
   * Putanja slike u privatnom bucketu — NIKAD potpisan URL (F11 §4). Potpis
   * živi 10 minuta i pravi se u adminu; potpis u pošti je tajna koja živi koliko
   * i mejl.
   */
  screenshotPath?: string | null;
  /**
   * Adresa aplikacije, za link na `/admin/utisci/<id>` (F11 §7).
   *
   * Stigla je tek u F11.3: do konzole je nije bilo gde odvesti (v. „S1 — šta se
   * razišlo", tačka 3). U mejl ide LINK NA EKRAN, nikad potpisan URL slike —
   * potpis živi 10 minuta, a mejl zauvek.
   */
  konzola?: string | null;
  /** Ime i mejl iz Clerk sesije, čitani na serveru. Oba umeju da budu `null`. */
  korisnik: { ime: string | null; email: string | null };
  /** `true` za drugi mejl, onaj uz dopunu tekstom (F10 §2). */
  dopuna: boolean;
};

export type { MejlIshod };

/**
 * Pošalji utisak na moj inboks.
 *
 * Bez ključa se ne šalje ništa i to nije greška nego lokalni razvoj — razlog se
 * svejedno vraća, da bi stajao u bazi umesto u logu koji niko ne čita.
 */
export async function posaljiUtisak(utisak: UtisakZaMejl): Promise<MejlIshod> {
  const podesavanje = feedbackMailEnv();
  if (!podesavanje.ok) return { ok: false, greska: podesavanje.razlog };

  return posaljiMejl({
    za: [podesavanje.env.FEEDBACK_EMAIL_TO],
    subject: subject(utisak),
    text: tekstTelo(utisak),
    html: htmlTelo(utisak),
    // Odgovor u jednom kliku. Ako adresa ne prođe proveru, mejl svejedno ide —
    // samo bez `Reply-To` (F10 §5).
    replyTo: utisak.korisnik.email,
  });
}

// ── subject ──────────────────────────────────────────────────
// `ocena · tip · ekran · ko` — tako se iz liste u inboksu vidi šta je hitno bez
// otvaranja. Kad tipa nema, srednji deo se izostavlja.

function subject(u: UtisakZaMejl): string {
  if (u.dopuna) return `↳ dopuna uz utisak #${u.id}`;

  // Odgovor na pitanje nema ocenu, pa nema ni emodži: u glavi subjecta stoji
  // ključ pitanja, jer je to ono po čemu se ti mejlovi grupišu u inboksu.
  const glava =
    u.rating === null
      ? `▸ ${u.promptKey ?? "pitanje"}`
      : `${OCENA_EMODZI[u.rating]} ${
          u.kind ? TIP_LABEL[u.kind].toLowerCase() : OCENA_LABEL[u.rating].toLowerCase()
        }`;

  return [glava, u.routeLabel ?? "Sajtoskop", u.korisnik.email ?? "bez mejla"].join(" · ");
}

// ── telo ─────────────────────────────────────────────────────
// `text` i `html` nose isti sadržaj. Moj klijent renderuje HTML, ali tekstualna
// verzija je ono što stigne u notifikaciju na telefonu.

function redovi(u: UtisakZaMejl): { labela: string; vrednost: string }[] {
  const nalog = [
    `plan ${u.ctx.plan}`,
    `${u.ctx.credits} ${plural(u.ctx.credits, "kredit", "kredita", "kredita")}`,
    `${u.ctx.unlocks} ${plural(u.ctx.unlocks, "otključan", "otključana", "otključanih")}`,
  ].join(" · ");

  const ekran = u.routeLabel
    ? u.route
      ? `${u.routeLabel} (${u.route})`
      : u.routeLabel
    : (u.route ?? "nepoznat");

  const ko = [u.korisnik.ime, u.korisnik.email ?? "bez mejla"].filter(Boolean).join(" · ");

  // Pitanje i odgovor stoje na vrhu, tamo gde je kod ocene stajala ocena — to je
  // ono što se čita prvo. Labele odgovora dolaze iz kataloga, ne iz baze: u
  // `answers` je `'delimicno'`, a u inboksu treba da piše „Delimično".
  const pitanje = u.promptKey ? pitanjeZaKljuc(u.promptKey) : null;

  const zaglavlje: { labela: string; vrednost: string }[] = [
    ...(u.rating !== null
      ? [{ labela: "Ocena", vrednost: `${OCENA_LABEL[u.rating]} (${u.rating}/3)` }]
      : []),
    ...(u.promptKey
      ? [
          { labela: "Pitanje", vrednost: `${pitanje?.naslov ?? "?"} [${u.promptKey}]` },
          {
            labela: "Odgovor",
            vrednost: pitanje
              ? opisOdgovora(pitanje, u.answers ?? {})
              : JSON.stringify(u.answers ?? {}),
          },
        ]
      : []),
    ...(u.kind ? [{ labela: "Tip", vrednost: TIP_LABEL[u.kind] }] : []),
    ...(u.severity ? [{ labela: "Težina", vrednost: `${u.severity}/3` }] : []),
    ...(u.screenshotPath ? [{ labela: "Slika", vrednost: u.screenshotPath }] : []),
  ];

  return [
    ...zaglavlje,
    { labela: "Ekran", vrednost: ekran },
    { labela: "Korisnik", vrednost: ko },
    { labela: "Nalog", vrednost: nalog },
    { labela: "Uređaj", vrednost: `${u.ctx.viewport || "?"} · ${uredjaj(u.ctx.ua)}` },
    // Dnevnik postoji samo uz prijavu kvara (F11 odluka 10) i staje u jedan red
    // po grešci: „TypeError · /pretraga · 14:22 · poruka". Bez steka i bez query
    // stringa — tako je i upisan.
    ...(u.ctx.errors?.length
      ? [
          {
            labela: "Greške",
            vrednost: u.ctx.errors
              .map((g) => `${g.tip} · ${g.ruta} · ${vremeSamo(g.vreme)} · ${g.poruka}`)
              .join("\n"),
          },
        ]
      : []),
    {
      labela: "Zapis",
      vrednost: [
        `#${u.id}`,
        ...(u.source === "podsetnik" ? ["podsetnik"] : []),
        formatTrenutak(u.createdAt),
      ].join(" · "),
    },
    // Poslednji red je jedini koji vodi negde: status, oznake i nagrada se
    // postavljaju tamo, a ne odgovorom na ovaj mejl.
    ...(u.konzola ? [{ labela: "Konzola", vrednost: `${u.konzola}/admin/utisci/${u.id}` }] : []),
  ];
}

/**
 * Gde se poruka ubacuje: odmah iza zaglavlja (ocena / pitanje / tip), a pre
 * metapodataka. Traži se po labeli, a ne po broju redova — od F11 zaglavlje ima
 * promenljivu dužinu, pa bi fiksan `slice(0, 3)` presekao red „Odgovor".
 */
function granicaPoruke(svi: { labela: string }[]): number {
  const i = svi.findIndex((r) => r.labela === "Ekran");
  return i === -1 ? svi.length : i;
}

function tekstTelo(u: UtisakZaMejl): string {
  const svi = redovi(u);
  const poruka = u.message?.trim();

  // Poruka stoji odmah ispod tipa, kao u F10 §3 — to je jedini deo koji se čita
  // pažljivo, pa ne sme na dno ispod metapodataka.
  const granica = granicaPoruke(svi);
  const gore = svi.slice(0, granica);
  const dole = svi.slice(granica);

  const linija = (r: { labela: string; vrednost: string }) =>
    `${r.labela.padEnd(13)}${r.vrednost}`;

  const blokPoruke = poruka
    ? [
        `${"Poruka".padEnd(13)}${CRTA}`,
        ...poruka.split("\n").map((red) => `${" ".repeat(13)}${red}`),
        `${" ".repeat(13)}${CRTA}`,
      ]
    : [`${"Poruka".padEnd(13)}—`];

  return [...gore.map(linija), ...blokPoruke, "", ...dole.map(linija)].join("\n");
}

function htmlTelo(u: UtisakZaMejl): string {
  const svi = redovi(u);
  const poruka = u.message?.trim();
  const granica = granicaPoruke(svi);

  const red = (r: { labela: string; vrednost: string }) =>
    `<tr><td style="padding:3px 16px 3px 0;color:#6c757f;white-space:nowrap;vertical-align:top">${esc(r.labela)}</td>` +
    // `white-space:pre-wrap` je tu zbog dnevnika grešaka: on je jedan red po
    // grešci, a bez ovoga bi se pet redova slilo u jednu rečenicu.
    `<td style="padding:3px 0;vertical-align:top;white-space:pre-wrap">${esc(r.vrednost)}</td></tr>`;

  // `message` je korisnički tekst i u HTML mejlu je izvršni sadržaj kao i svuda
  // drugde (F10 §5). Escape-uje se pre nego što uđe, bez izuzetka.
  const blokPoruke = poruka
    ? `<tr><td style="padding:10px 16px 10px 0;color:#6c757f;vertical-align:top">Poruka</td>` +
      `<td style="padding:10px 0"><div style="white-space:pre-wrap;border-left:3px solid #adee2e;padding-left:12px">${esc(poruka)}</div></td></tr>`
    : `<tr><td style="padding:3px 16px 3px 0;color:#6c757f">Poruka</td><td style="padding:3px 0">—</td></tr>`;

  return [
    `<div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a0b0c">`,
    `<table style="border-collapse:collapse">`,
    ...svi.slice(0, granica).map(red),
    blokPoruke,
    `<tr><td colspan="2" style="height:12px"></td></tr>`,
    ...svi.slice(granica).map(red),
    `</table></div>`,
  ].join("");
}

// ── pomoćno ──────────────────────────────────────────────────

const esc = escapeHtml;

/** „Chrome 141 / macOS" — dovoljno da znam gde da tražim, bez biblioteke. */
export function uredjaj(ua: string): string {
  if (!ua) return "nepoznat uređaj";

  const pregledac =
    /Edg\/(\d+)/.exec(ua) ??
    /OPR\/(\d+)/.exec(ua) ??
    /Firefox\/(\d+)/.exec(ua) ??
    /Chrome\/(\d+)/.exec(ua) ??
    /Version\/(\d+).*Safari/.exec(ua);

  const ime = !pregledac
    ? "nepoznat pregledač"
    : pregledac[0].startsWith("Edg")
      ? `Edge ${pregledac[1]}`
      : pregledac[0].startsWith("OPR")
        ? `Opera ${pregledac[1]}`
        : pregledac[0].startsWith("Firefox")
          ? `Firefox ${pregledac[1]}`
          : pregledac[0].startsWith("Chrome")
            ? `Chrome ${pregledac[1]}`
            : `Safari ${pregledac[1]}`;

  const sistem = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "nepoznat sistem";

  return `${ime} / ${sistem}`;
}

/** Samo sat i minut, za redove dnevnika grešaka — datum stoji u redu „Zapis". */
function vremeSamo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";

  return new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** „12.08.2026. u 14:22", po domaćem vremenu — mejl čitam ovde, ne u Kaliforniji. */
function formatTrenutak(iso: string): string {
  const d = new Date(iso);
  const delovi = new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const uzmi = (tip: string) => delovi.find((p) => p.type === tip)?.value ?? "";
  return `${uzmi("day")}.${uzmi("month")}.${uzmi("year")}. u ${uzmi("hour")}:${uzmi("minute")}`;
}
