// apps/web/src/lib/feedback-mail.ts
// Mejl sa utiskom, kroz Resend (F10 §3).
//
// Jedan `fetch` na jedan API, sa tajmautom. Pravilo 7 iz CLAUDE.md zabranjuje
// Playwright i LANČANI HTTP fetch u Vercel funkciji — ovo nije ni jedno ni
// drugo. Preko `job_queue` bi značilo da mi mejl stiže tek kad worker povuče
// red, a poenta cele faze je da bug vidim odmah.
//
// Baza je izvor istine, mejl je obaveštenje (odluka 3). Zato nijedna funkcija
// odavde ne baca: pad se vraća kao `{ ok: false, greska }` i završi u
// `feedback.email_error`, a korisnik i dalje vidi „Poslato".

import "server-only";
import type { FeedbackCtx, FeedbackKind, FeedbackSource } from "@sajtoskop/shared";
import { feedbackMailEnv } from "./env";
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
const TAJMAUT_MS = 8_000;

export type UtisakZaMejl = {
  id: number;
  rating: 1 | 2 | 3;
  kind: FeedbackKind | null;
  message: string | null;
  source: FeedbackSource;
  route: string | null;
  routeLabel: string | null;
  ctx: FeedbackCtx;
  createdAt: string;
  /** Ime i mejl iz Clerk sesije, čitani na serveru. Oba umeju da budu `null`. */
  korisnik: { ime: string | null; email: string | null };
  /** `true` za drugi mejl, onaj uz dopunu tekstom (F10 §2). */
  dopuna: boolean;
};

export type MejlIshod = { ok: true } | { ok: false; greska: string };

/**
 * Pošalji utisak na moj inboks.
 *
 * Bez ključa se ne šalje ništa i to nije greška nego lokalni razvoj — razlog se
 * svejedno vraća, da bi stajao u bazi umesto u logu koji niko ne čita.
 */
export async function posaljiUtisak(utisak: UtisakZaMejl): Promise<MejlIshod> {
  const podesavanje = feedbackMailEnv();
  if (!podesavanje.ok) return { ok: false, greska: podesavanje.razlog };

  const { RESEND_API_KEY, FEEDBACK_EMAIL_TO, FEEDBACK_EMAIL_FROM } = podesavanje.env;

  const telo: Record<string, unknown> = {
    from: FEEDBACK_EMAIL_FROM,
    to: [FEEDBACK_EMAIL_TO],
    subject: subject(utisak),
    text: tekstTelo(utisak),
    html: htmlTelo(utisak),
  };

  // Header injection: `reply_to` se postavlja samo ako adresa prođe proveru
  // (F10 §5). Ako ne prođe, mejl svejedno ide — samo bez odgovora u jednom kliku.
  const odgovorNa = bezbedanReplyTo(utisak.korisnik.email);
  if (odgovorNa) telo.reply_to = odgovorNa;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(telo),
      signal: AbortSignal.timeout(TAJMAUT_MS),
    });

    if (!res.ok) {
      const detalj = (await res.text().catch(() => "")).slice(0, 400);
      // Ključ ne izlazi ni u jedan odgovor ni u `email_error` (F10 §5). Resend ga
      // ne vraća, ali cena ove linije je nula, a cena greške je tajna u bazi.
      const cist = detalj.replaceAll(RESEND_API_KEY, "***");
      return { ok: false, greska: `Resend ${res.status}: ${cist}`.trim() };
    }

    return { ok: true };
  } catch (err) {
    const poruka = err instanceof Error ? err.message : String(err);
    return { ok: false, greska: poruka.replaceAll(RESEND_API_KEY, "***").slice(0, 400) };
  }
}

// ── subject ──────────────────────────────────────────────────
// `ocena · tip · ekran · ko` — tako se iz liste u inboksu vidi šta je hitno bez
// otvaranja. Kad tipa nema, srednji deo se izostavlja.

function subject(u: UtisakZaMejl): string {
  if (u.dopuna) return `↳ dopuna uz utisak #${u.id}`;

  return [
    `${OCENA_EMODZI[u.rating]} ${u.kind ? TIP_LABEL[u.kind].toLowerCase() : OCENA_LABEL[u.rating].toLowerCase()}`,
    u.routeLabel ?? "Sajtoskop",
    u.korisnik.email ?? "bez mejla",
  ].join(" · ");
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

  return [
    { labela: "Ocena", vrednost: `${OCENA_LABEL[u.rating]} (${u.rating}/3)` },
    ...(u.kind ? [{ labela: "Tip", vrednost: TIP_LABEL[u.kind] }] : []),
    { labela: "Ekran", vrednost: ekran },
    { labela: "Korisnik", vrednost: ko },
    { labela: "Nalog", vrednost: nalog },
    { labela: "Uređaj", vrednost: `${u.ctx.viewport || "?"} · ${uredjaj(u.ctx.ua)}` },
    {
      labela: "Zapis",
      vrednost: [
        `#${u.id}`,
        ...(u.source === "podsetnik" ? ["podsetnik"] : []),
        formatTrenutak(u.createdAt),
      ].join(" · "),
    },
  ];
}

function tekstTelo(u: UtisakZaMejl): string {
  const svi = redovi(u);
  const poruka = u.message?.trim();

  // Poruka stoji odmah ispod tipa, kao u F10 §3 — to je jedini deo koji se čita
  // pažljivo, pa ne sme na dno ispod metapodataka.
  const gore = svi.slice(0, u.kind ? 3 : 2);
  const dole = svi.slice(u.kind ? 3 : 2);

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
  const granica = u.kind ? 3 : 2;

  const red = (r: { labela: string; vrednost: string }) =>
    `<tr><td style="padding:3px 16px 3px 0;color:#6c757f;white-space:nowrap;vertical-align:top">${esc(r.labela)}</td>` +
    `<td style="padding:3px 0;vertical-align:top">${esc(r.vrednost)}</td></tr>`;

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

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Adresa sme u `reply_to` samo ako je stvarno adresa i ako u sebi nema prelom
 * reda. `\r` ili `\n` u toj vrednosti je klasična header injekcija — Resend ga
 * verovatno odbija i sam, ali „verovatno" nije provera.
 */
function bezbedanReplyTo(email: string | null): string | null {
  if (!email) return null;
  if (/[\r\n]/.test(email)) return null;
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email) ? email : null;
}

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
