// apps/web/src/lib/billing-mejl.ts
// Dva mejla koja okida Stripe webhook (naplata-stripe.md §6.1, §7.5 — „P4"):
//
//   invoice.payment_failed   KORISNIKU: naplata nije prošla, do kad traje
//                            pristup, dugme na `/krediti` (portal se otvara
//                            odatle — link na portal u mejlu bi bio sesija koja
//                            ističe za nekoliko minuta).
//   charge.dispute.created   MENI: iznos, `dp_…`, link na Stripe Dashboard.
//
// Odluka KADA se šalje je u `billing.ts`; ovde je samo sastavljanje i slanje,
// kao `feedback-mail.ts` i `admin-mail.ts`. Ništa odavde ne baca — pad se
// vraća kao `{ ok: false, greska }` (v. `lib/mail.ts`).
//
// ── šta NE ulazi u mejl o sporu ─────────────────────────────
// Spor nosi `evidence` (adresa, mejl kupca) i `payment_method_details` (brend,
// poslednje četiri cifre kartice). Ništa od toga se ne čita: ulaz je uzak tip
// `SporZaMejl`, a ne `Stripe.Dispute`, pa ga ni kasnija izmena teksta ne može
// slučajno ubaciti. Sve ostalo je na Dashboard-u, iza prijave.

import "server-only";
import { feedbackMailEnv } from "./env";
import { dugmeHtml, escapeHtml, okvirHtml, posaljiMejl, redHtml, type MejlIshod } from "./mail";

const POTPIS = "Marko · Sajtoskop";

/** Adresa na koju stižu odgovori — ista ona na koju stižu i utisci. */
function mojaAdresa(): string | null {
  const p = feedbackMailEnv();
  return p.ok ? p.env.FEEDBACK_EMAIL_TO : null;
}

// ── naplata pala ─────────────────────────────────────────────

export type NaplataPalaZaMejl = {
  za: string;
  /** `in_…` — ključ idempotencije i kod Resend-a. */
  fakturaId: string;
  /** `amount_due`, u najmanjoj jedinici valute. */
  iznos: number;
  valuta: string;
  /** Pun pristup (`plan_expires_at`) — `null` ili prošlost znači da je već istekao. */
  punDo: string | null;
  /** Do kad sme da čita i izveze svoje (`citanjeDoZa(punDo)`). */
  citanjeDo: string | null;
  /** `invoice.next_payment_attempt` — `null` kad Stripe više ne pokušava. */
  sledeciPokusaj: string | null;
  /** Trenutak događaja; po njemu se odlučuje da li je `punDo` još ispred. */
  sada: string;
  /** Apsolutni URL `/krediti`. */
  kreditiUrl: string;
};

export async function posaljiNaplataPala(p: NaplataPalaZaMejl): Promise<MejlIshod> {
  const { subject, text, html } = mejlNaplataPala(p);
  return posaljiMejl({
    za: [p.za],
    subject,
    text,
    html,
    replyTo: mojaAdresa(),
    kljucIdempotencije: `naplata_pala:${p.fakturaId}`,
  });
}

/** Izdvojeno od slanja da bi test mogao da pročita tekst bez mreže. */
export function mejlNaplataPala(p: NaplataPalaZaMejl): { subject: string; text: string; html: string } {
  const uvod = `Pokušali smo da naplatimo tvoj Sajtoskop plan (${iznosTekst(p.iznos, p.valuta)}), ali naplata nije prošla.`;

  // Datum je onaj koji kapija pristupa stvarno primenjuje (`stanjePristupa`):
  // `past_due` je pun pristup dok `plan_expires_at` ne prođe, pa grace.
  const punJos = p.punDo !== null && Date.parse(p.punDo) > Date.parse(p.sada);
  const pristup = punJos
    ? `Pristup ti traje do ${datum(p.punDo!)}.` +
      (p.citanjeDo
        ? ` Ako do tada ne ažuriraš karticu, skeniranje i otključavanje staju, a do ${datum(p.citanjeDo)} i dalje možeš da otvaraš svoje prospekte i izvezeš ih.`
        : "")
    : p.citanjeDo
      ? `Pristup ti traje do ${datum(p.citanjeDo)}, ali samo za ono što već imaš: do tada možeš da otvaraš svoje prospekte, vodiš pipeline i izvezeš CSV. Skeniranje i otključavanje stoje dok naplata ne prođe.`
      : "Skeniranje i otključavanje stoje dok naplata ne prođe.";

  const pokusaj = p.sledeciPokusaj
    ? `Sledeći pokušaj naplate je ${datum(p.sledeciPokusaj)}. Ako karticu ažuriraš pre toga, plan se nastavlja bez prekida.`
    : "Ako ažuriraš karticu, plan se nastavlja.";

  const kako = "Na stranici Krediti otvaraš portal za plaćanje i tamo menjaš karticu.";
  const rep = "Ako si karticu već promenio, zanemari ovaj mejl. Pitanje? Samo odgovori na njega.";

  const text = [
    uvod,
    "",
    pristup,
    "",
    pokusaj,
    "",
    `Ažuriraj karticu: ${p.kreditiUrl}`,
    kako,
    "",
    rep,
    "",
    POTPIS,
  ].join("\n");

  const html = okvirHtml([
    `<p style="margin:0 0 14px">${escapeHtml(uvod)}</p>`,
    `<p style="margin:0 0 14px">${escapeHtml(pristup)}</p>`,
    `<p style="margin:0 0 18px">${escapeHtml(pokusaj)}</p>`,
    dugmeHtml(p.kreditiUrl, "Ažuriraj karticu"),
    `<p style="margin:12px 0 0;font-size:13px;color:#6c757f">${escapeHtml(kako)}</p>`,
    `<p style="margin:16px 0 0;font-size:13px;color:#6c757f">${escapeHtml(rep)}<br>— ${escapeHtml(POTPIS)}</p>`,
  ]);

  return { subject: "Naplata za Sajtoskop nije prošla", text, html };
}

// ── spor ─────────────────────────────────────────────────────

/** Tačno ono što sme u mejl — v. zaglavlje. */
export type SporZaMejl = {
  sporId: string;
  naplataId: string | null;
  iznos: number;
  valuta: string;
  /** Stripe `reason` (`fraudulent`, `product_not_received`, …) — kod, ne tekst kupca. */
  razlog: string | null;
  /** `evidence_details.due_by` — posle toga Stripe odlučuje bez mene. */
  rokZaDokaze: string | null;
  dashboardUrl: string;
};

export async function posaljiSporAdminu(p: SporZaMejl): Promise<MejlIshod> {
  const podesavanje = feedbackMailEnv();
  if (!podesavanje.ok) return { ok: false, greska: podesavanje.razlog };

  const { subject, text, html } = mejlSpor(p);
  return posaljiMejl({
    za: [podesavanje.env.FEEDBACK_EMAIL_TO],
    subject,
    text,
    html,
    kljucIdempotencije: `spor:${p.sporId}`,
  });
}

export function mejlSpor(p: SporZaMejl): { subject: string; text: string; html: string } {
  const iznos = iznosTekst(p.iznos, p.valuta);
  const redovi: [string, string][] = [
    ["Iznos", iznos],
    ["Spor", p.sporId],
    ...(p.naplataId ? ([["Naplata", p.naplataId]] as [string, string][]) : []),
    ["Razlog", p.razlog ?? "—"],
    ["Rok za dokaze", p.rokZaDokaze ? datum(p.rokZaDokaze) : "—"],
  ];
  const napomena = "Krediti se ne diraju dok Stripe ne odluči. Izgubljen spor ih skida sam (charge.dispute.closed).";

  const text = [
    "Otvoren je spor nad naplatom.",
    "",
    ...redovi.map(([l, v]) => `${l.padEnd(15)}${v}`),
    "",
    `Dashboard: ${p.dashboardUrl}`,
    "",
    napomena,
  ].join("\n");

  const html = okvirHtml([
    `<p style="margin:0 0 14px">Otvoren je spor nad naplatom.</p>`,
    `<table style="border-collapse:collapse;font-size:14px;margin:0 0 18px">`,
    ...redovi.map(([l, v]) => redHtml(l, v)),
    `</table>`,
    dugmeHtml(p.dashboardUrl, "Otvori u Stripe-u"),
    `<p style="margin:16px 0 0;font-size:13px;color:#6c757f">${escapeHtml(napomena)}</p>`,
  ]);

  return { subject: `Spor otvoren: ${iznos} · ${p.sporId}`, text, html };
}

// ── pomoćno ──────────────────────────────────────────────────

/**
 * „59,00 €". Iznos stiže u najmanjoj jedinici; jedina valuta kataloga je EUR
 * (dve decimale), pa deljenje sa 100 ne treba tabelu valuta bez decimala.
 */
export function iznosTekst(iznos: number, valuta: string): string {
  try {
    return new Intl.NumberFormat("sr-Latn-RS", {
      style: "currency",
      currency: valuta.toUpperCase(),
    }).format(iznos / 100);
  } catch {
    return `${(iznos / 100).toFixed(2)} ${valuta.toUpperCase()}`;
  }
}

/** „12. oktobar 2026." po beogradskom vremenu — mejl ne zna zonu servera. */
export function datum(iso: string): string {
  return new Date(iso).toLocaleDateString("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
