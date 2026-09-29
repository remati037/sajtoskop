// apps/web/src/lib/mail.ts
// Jedan izlaz ka Resend-u. Sve što projekat pošalje mejlom prolazi ovuda.
//
// Postoji od F12.3, kad je pored utiska (F10) stigla i pošta koja ide DRUGIM
// ljudima — pozivnica u betu i pojedinačna poruka korisniku. Dve implementacije
// istog `fetch`-a bi značile i dva mesta na kojima se pamti da ključ ne sme da
// procuri u poruku o grešci, i dva tajmauta koja se raziđu.
//
// Pravilo 7 iz CLAUDE.md zabranjuje Playwright i LANČANI HTTP fetch u Vercel
// funkciji — ovo nije ni jedno ni drugo: jedan poziv, sa tajmautom.
//
// Ništa odavde NE BACA. Mejl je obaveštenje, a ne izvor istine: pad se vraća kao
// `{ ok: false, greska }` i pozivalac odlučuje da li je to greška radnje ili
// samo rečenica uz uspeh.

import "server-only";
import { feedbackMailEnv } from "./env";

export type MejlIshod = { ok: true } | { ok: false; greska: string };

export type Mejl = {
  za: string[];
  subject: string;
  /** Ono što stigne u notifikaciju na telefonu. Nikad prazno. */
  text: string;
  html: string;
  /** Postavlja se samo ako prođe `bezbednaAdresa()`. */
  replyTo?: string | null;
  /**
   * Resend `Idempotency-Key` (24 h): isti ključ u tom prozoru ne šalje drugi
   * mejl. Za poštu koju okida webhook — tajmaut posle kog je Resend ipak
   * primio poruku inače bi, uz ponovni pokušaj, značio dva mejla.
   */
  kljucIdempotencije?: string;
};

const TAJMAUT_MS = 8_000;

export async function posaljiMejl(m: Mejl): Promise<MejlIshod> {
  const podesavanje = feedbackMailEnv();
  if (!podesavanje.ok) return { ok: false, greska: podesavanje.razlog };

  const { RESEND_API_KEY, FEEDBACK_EMAIL_FROM } = podesavanje.env;

  const primaoci = m.za.map((a) => bezbednaAdresa(a)).filter((a): a is string => a !== null);
  if (primaoci.length === 0) return { ok: false, greska: "nema ispravne adrese primaoca" };

  const telo: Record<string, unknown> = {
    from: FEEDBACK_EMAIL_FROM,
    to: primaoci,
    subject: m.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: m.text,
    html: m.html,
  };

  const odgovorNa = bezbednaAdresa(m.replyTo ?? null);
  if (odgovorNa) telo.reply_to = odgovorNa;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(m.kljucIdempotencije ? { "Idempotency-Key": m.kljucIdempotencije.slice(0, 256) } : {}),
      },
      body: JSON.stringify(telo),
      signal: AbortSignal.timeout(TAJMAUT_MS),
    });

    if (!res.ok) {
      const detalj = (await res.text().catch(() => "")).slice(0, 400);
      // Ključ ne izlazi ni u jedan odgovor ni u bazu (F10 §5). Resend ga ne
      // vraća, ali cena ove linije je nula, a cena greške je tajna u dnevniku.
      const cist = detalj.replaceAll(RESEND_API_KEY, "***");
      return { ok: false, greska: `Resend ${res.status}: ${cist}`.trim() };
    }

    return { ok: true };
  } catch (err) {
    const poruka = err instanceof Error ? err.message : String(err);
    return { ok: false, greska: poruka.replaceAll(RESEND_API_KEY, "***").slice(0, 400) };
  }
}

/**
 * Adresa sme u zaglavlje samo ako je stvarno adresa i ako u sebi nema prelom
 * reda. `\r` ili `\n` u toj vrednosti je klasična header injekcija — Resend ga
 * verovatno odbija i sam, ali „verovatno" nije provera (F10 §5).
 */
export function bezbednaAdresa(email: string | null): string | null {
  if (!email) return null;
  const a = email.trim();
  if (/[\r\n]/.test(a)) return null;
  if (a.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(a) ? a : null;
}

/** Escape pre svakog ubacivanja u HTML telo. Bez izuzetka (F10 §5). */
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ── zajednički delovi tela ───────────────────────────────────
// Boje su ovde zakucane, i to je jedino mesto u projektu gde smeju: mejl klijent
// ne vidi `globals.css` ni jedan jedini token. Vrednosti su prepis `--accent`,
// `--fg` i `--fg-muted` iz dizajn sistema §3.1, u svetloj temi.
//
// Do P4 su živeli u `admin-mail.ts`; izdvojeni su kad je i naplata počela da
// piše korisniku (`billing-mejl.ts`), da oba mejla izgledaju isto.

export function okvirHtml(delovi: string[]): string {
  return [
    `<div style="font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a0b0c;max-width:520px">`,
    ...delovi,
    `<p style="margin:24px 0 0;font-size:12px;color:#8b9299">sajtoskop.com</p>`,
    `</div>`,
  ].join("");
}

export function dugmeHtml(href: string, tekst: string): string {
  // `href` je uvek naš link (Clerk pozivnica, sopstveni origin ili Stripe
  // Dashboard), nikad korisnički unos — ali escape ide svejedno, jer se to
  // pravilo ne pamti po izuzecima.
  return (
    `<a href="${escapeHtml(href)}" style="display:inline-block;background:#adee2e;color:#0a0b0c;` +
    `text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px">` +
    `${escapeHtml(tekst)}</a>`
  );
}

export function redHtml(labela: string, vrednost: string): string {
  return (
    `<tr><td style="padding:3px 16px 3px 0;color:#6c757f;white-space:nowrap">${escapeHtml(labela)}</td>` +
    `<td style="padding:3px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(vrednost)}</td></tr>`
  );
}
