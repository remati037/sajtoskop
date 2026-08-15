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
