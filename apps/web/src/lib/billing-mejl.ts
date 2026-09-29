// apps/web/src/lib/billing-mejl.ts
// Mejlovi koje okida Stripe webhook (naplata-stripe.md §6.1, §7.5 — „P4";
// checklista 2.6):
//
//   invoice.payment_failed   KORISNIKU: naplata nije prošla, do kad traje
//                            pristup, dugme na `/krediti` (portal se otvara
//                            odatle — link na portal u mejlu bi bio sesija koja
//                            ističe za nekoliko minuta).
//   customer.subscription.   KORISNIKU: proba se završava — datum, iznos prve
//     trial_will_end         naplate, krediti koji tada stižu, dugme na `/krediti`.
//   invoice.paid, paket      KORISNIKU: uplata primljena — iznos, plan ili paket,
//                            krediti. Stripe-ova potvrda uplate nema srpski
//                            (checklista 2.6, korak 2), pa je ovo zamena za nju.
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

// ── proba se završava ────────────────────────────────────────

export type ProbaIsticeZaMejl = {
  za: string;
  /** `sub_…` — ključ idempotencije: jedan mejl po pretplati. */
  pretplataId: string;
  /** „Starter", „Pro"… — `imePlana()`. */
  plan: string;
  ciklus: "month" | "year";
  /** `trial_end` — tada Stripe naplaćuje. */
  naplataDana: string;
  /**
   * Iznos prve naplate u najmanjoj jedinici, sa cene na pretplati. `null` kad
   * se iz objekta ne može pouzdano izračunati (popust, cena bez iznosa) — tada
   * mejl ne navodi iznos, jer je pogrešan iznos gori od nikakvog (roadmap §5.0).
   */
  iznos: number | null;
  valuta: string;
  /** `PLANS[plan].monthlyCredits` — na koliko se balans postavlja tog dana. */
  krediti: number;
  kreditiUrl: string;
};

export async function posaljiProbaIstice(p: ProbaIsticeZaMejl): Promise<MejlIshod> {
  const { subject, text, html } = mejlProbaIstice(p);
  return posaljiMejl({
    za: [p.za],
    subject,
    text,
    html,
    replyTo: mojaAdresa(),
    kljucIdempotencije: `proba_istice:${p.pretplataId}`,
  });
}

export function mejlProbaIstice(p: ProbaIsticeZaMejl): { subject: string; text: string; html: string } {
  const dan = datum(p.naplataDana);
  const planTekst = `${p.plan}, ${p.ciklus === "year" ? "godišnje" : "mesečno"}`;

  const uvod = `Tvoja proba Sajtoskopa se završava ${dan}. Tog dana počinje plan ${planTekst}.`;
  const naplata =
    (p.iznos !== null
      ? `Sa kartice koju si uneo pri probi naplaćujemo ${iznosTekst(p.iznos, p.valuta)}`
      : `Sa kartice koju si uneo pri probi naplaćujemo cenu plana ${p.plan}`) +
    `, a balans se postavlja na ${p.krediti} kredita. Preostali krediti iz probe se ne sabiraju sa njima.`;
  const otkaz = `Ako ne želiš da nastaviš, otkaži pre ${dan}: na stranici Krediti otvaraš portal za pretplatu. Do tada sve radi kao i sada, a otključani prospekti i pipeline ostaju tvoji.`;
  const rep = "Pitanje? Samo odgovori na ovaj mejl.";

  const redovi: [string, string][] = [
    ["Plan", planTekst],
    ["Naplata", dan],
    ...(p.iznos !== null ? ([["Iznos", iznosTekst(p.iznos, p.valuta)]] as [string, string][]) : []),
    ["Krediti", String(p.krediti)],
  ];

  const text = [
    uvod,
    "",
    naplata,
    "",
    otkaz,
    "",
    `Upravljaj pretplatom: ${p.kreditiUrl}`,
    "",
    rep,
    "",
    POTPIS,
  ].join("\n");

  const html = okvirHtml([
    `<p style="margin:0 0 14px">${escapeHtml(uvod)}</p>`,
    `<table style="border-collapse:collapse;font-size:14px;margin:0 0 14px">`,
    ...redovi.map(([l, v]) => redHtml(l, v)),
    `</table>`,
    `<p style="margin:0 0 14px">${escapeHtml(naplata)}</p>`,
    `<p style="margin:0 0 18px">${escapeHtml(otkaz)}</p>`,
    dugmeHtml(p.kreditiUrl, "Upravljaj pretplatom"),
    `<p style="margin:16px 0 0;font-size:13px;color:#6c757f">${escapeHtml(rep)}<br>— ${escapeHtml(POTPIS)}</p>`,
  ]);

  return { subject: `Proba se završava ${dan}`, text, html };
}

// ── uplata primljena ─────────────────────────────────────────

export type UplataZaMejl = {
  za: string;
  /** `in_…` za pretplatu, `pi_…` za paket — ključ idempotencije. */
  ref: string;
  /** Stvarno naplaćeno (`amount_paid` / `amount_total`), najmanja jedinica. */
  iznos: number;
  valuta: string;
  /** Plan (`imePlana()`) ili paket. */
  stavka: { vrsta: "plan"; ime: string } | { vrsta: "paket" };
  krediti: number;
  /** Trenutak događaja — datum uplate. */
  dana: string;
  /** `invoice.hosted_invoice_url` — račun i potvrda za preuzimanje; paket ga nema. */
  racunUrl: string | null;
  kreditiUrl: string;
};

export async function posaljiUplatuPrimljenu(p: UplataZaMejl): Promise<MejlIshod> {
  const { subject, text, html } = mejlUplataPrimljena(p);
  return posaljiMejl({
    za: [p.za],
    subject,
    text,
    html,
    replyTo: mojaAdresa(),
    kljucIdempotencije: `uplata:${p.ref}`,
  });
}

export function mejlUplataPrimljena(p: UplataZaMejl): { subject: string; text: string; html: string } {
  const iznos = iznosTekst(p.iznos, p.valuta);
  const uvod = `Primili smo tvoju uplatu od ${iznos}. Hvala!`;
  const krediti =
    p.stavka.vrsta === "plan"
      ? `Balans je postavljen na ${p.krediti} kredita za ovaj period plana ${p.stavka.ime}.`
      : `Na nalog je leglo ${p.krediti} kredita. Krediti iz paketa ne ističu.`;
  const redovi: [string, string][] = [
    ["Iznos", iznos],
    [p.stavka.vrsta === "plan" ? "Plan" : "Paket", p.stavka.vrsta === "plan" ? p.stavka.ime : `${p.krediti} kredita`],
    ["Krediti", p.stavka.vrsta === "plan" ? String(p.krediti) : `+${p.krediti}`],
    ["Datum", datum(p.dana)],
    ["Broj uplate", p.ref],
  ];
  const racun = p.racunUrl ? `Račun i potvrdu uplate preuzimaš ovde: ${p.racunUrl}` : null;
  const rep = "Pitanje? Samo odgovori na ovaj mejl.";

  const text = [
    uvod,
    "",
    ...redovi.map(([l, v]) => `${l.padEnd(13)}${v}`),
    "",
    krediti,
    ...(racun ? ["", racun] : []),
    "",
    `Krediti: ${p.kreditiUrl}`,
    "",
    rep,
    "",
    POTPIS,
  ].join("\n");

  const html = okvirHtml([
    `<p style="margin:0 0 14px">${escapeHtml(uvod)}</p>`,
    `<table style="border-collapse:collapse;font-size:14px;margin:0 0 14px">`,
    ...redovi.map(([l, v]) => redHtml(l, v)),
    `</table>`,
    `<p style="margin:0 0 ${racun ? 14 : 18}px">${escapeHtml(krediti)}</p>`,
    ...(p.racunUrl
      ? [
          `<p style="margin:0 0 18px">Račun i potvrdu uplate preuzimaš ` +
            `<a href="${escapeHtml(p.racunUrl)}" style="color:#0a0b0c">ovde</a>.</p>`,
        ]
      : []),
    dugmeHtml(p.kreditiUrl, "Pogledaj kredite"),
    `<p style="margin:16px 0 0;font-size:13px;color:#6c757f">${escapeHtml(rep)}<br>— ${escapeHtml(POTPIS)}</p>`,
  ]);

  return { subject: `Uplata primljena: ${iznos}`, text, html };
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
