// apps/web/src/lib/admin-mail.ts
// Pošta koja ide DRUGIM ljudima (F12 §3.2 i §3.3) — pozivnica u betu i
// pojedinačna poruka korisniku.
//
// Razlika u odnosu na `feedback-mail.ts` je jedina koja je ovde bitna: taj mejl
// ide meni, a ovaj ide nekome van sistema. Zato oba imaju `Reply-To` na mene i
// oba potpisuju ko piše — čovek koji dobije mejl od alata za koji se prijavio
// mora u prvom redu da vidi ko mu piše i kako da odgovori.
//
// Slanje, tajmaut, čišćenje ključa iz greške i zajednički okvir tela (dugme,
// red tabele) su u `lib/mail.ts`.

import "server-only";
import { feedbackMailEnv } from "./env";
import { dugmeHtml, escapeHtml, okvirHtml, posaljiMejl, redHtml, type MejlIshod } from "./mail";

/** Adresa na koju stižu odgovori. Ista ona na koju stižu i utisci. */
function mojaAdresa(): string | null {
  const p = feedbackMailEnv();
  return p.ok ? p.env.FEEDBACK_EMAIL_TO : null;
}

const POTPIS = "Marko · Sajtoskop";

// ── pozivnica ────────────────────────────────────────────────

/**
 * Mejl sa linkom iz Clerk pozivnice.
 *
 * [ODSTUPANJE od F12 §3.3, namerno] PRD kaže „Clerk šalje mejl". Clerk to ume
 * (`notify: true`), ali njegov šablon je na engleskom i u njega ne ulazi lična
 * poruka iz obrasca — a upravo je ta poruka razlog zbog kog polje postoji.
 * Zato se pozivnica pravi sa `notify: false`, a mejl šaljem sam, kroz isti
 * Resend kroz koji ionako ide sve ostalo.
 *
 * Cena odstupanja: ako Resend padne, pozivnica postoji a mejl nije otišao. Zato
 * `posaljiPozivnicu()` u tom slučaju vraća link adminu, da može da ga pošalje
 * ručno — v. tamo.
 */
export async function posaljiPozivnicuMejlom(opts: {
  za: string;
  link: string;
  poruka: string | null;
}): Promise<MejlIshod> {
  const uvod = "Pozivam te u Sajtoskop — alat koji pronalazi biznise u Srbiji sa lošim ili nepostojećim sajtom i priprema materijal za kontakt.";
  const rok = "Link važi 30 dana. Nalog otvaraš sam, lozinku biraš sam.";

  const tekst = [
    uvod,
    ...(opts.poruka ? ["", opts.poruka] : []),
    "",
    "Otvori nalog:",
    opts.link,
    "",
    rok,
    "",
    "Nemam nijedan tvoj podatak o plaćanju.",
    "Ako te ovo ne zanima, samo obriši mejl — nema drugog podsetnika.",
    "",
    POTPIS,
  ].join("\n");

  const html = [
    okvirHtml([
      `<p style="margin:0 0 14px">${escapeHtml(uvod)}</p>`,
      ...(opts.poruka
        ? [
            `<div style="margin:0 0 18px;white-space:pre-wrap;border-left:3px solid #adee2e;padding-left:12px">${escapeHtml(opts.poruka)}</div>`,
          ]
        : []),
      dugmeHtml(opts.link, "Otvori nalog"),
      `<p style="margin:16px 0 0;font-size:13px;color:#6c757f">${escapeHtml(rok)}</p>`,
      `<p style="margin:10px 0 0;font-size:13px;color:#6c757f">Nemam nijedan tvoj podatak o plaćanju. Ako te ovo ne zanima, samo obriši mejl — nema drugog podsetnika.</p>`,
    ]),
  ].join("");

  return posaljiMejl({
    za: [opts.za],
    subject: "Poziv u Sajtoskop",
    text: tekst,
    html,
    replyTo: mojaAdresa(),
  });
}

/**
 * Mejl sa pristupom za nalog koji je otvoren odmah (§3.3, druga opcija).
 *
 * Lozinka ide korisniku i adminu na ekran — i nigde više. U bazu, u
 * `admin_audit` i u log ne ulazi (v. `otvoriNalog()`).
 */
export async function posaljiPristupMejlom(opts: {
  za: string;
  lozinka: string;
  prijava: string;
  poruka: string | null;
}): Promise<MejlIshod> {
  const uvod = "Otvorio sam ti nalog u zatvorenoj beti Sajtoskopa. Podaci za prvu prijavu su ispod.";
  const savet = "Promeni lozinku posle prve prijave — ovu je generisao server i nigde nije zapisana.";

  const tekst = [
    uvod,
    ...(opts.poruka ? ["", opts.poruka] : []),
    "",
    `Prijava:   ${opts.prijava}`,
    `Mejl:      ${opts.za}`,
    `Lozinka:   ${opts.lozinka}`,
    "",
    savet,
    "",
    POTPIS,
  ].join("\n");

  const html = okvirHtml([
    `<p style="margin:0 0 14px">${escapeHtml(uvod)}</p>`,
    ...(opts.poruka
      ? [
          `<div style="margin:0 0 18px;white-space:pre-wrap;border-left:3px solid #adee2e;padding-left:12px">${escapeHtml(opts.poruka)}</div>`,
        ]
      : []),
    `<table style="border-collapse:collapse;font-size:14px;margin:0 0 18px">`,
    redHtml("Mejl", opts.za),
    redHtml("Lozinka", opts.lozinka),
    `</table>`,
    dugmeHtml(opts.prijava, "Prijavi se"),
    `<p style="margin:16px 0 0;font-size:13px;color:#6c757f">${escapeHtml(savet)}</p>`,
  ]);

  return posaljiMejl({
    za: [opts.za],
    subject: "Tvoj pristup Sajtoskopu",
    text: tekst,
    html,
    replyTo: mojaAdresa(),
  });
}

// ── pojedinačna poruka ───────────────────────────────────────

/**
 * Poruka koju sam otkucao u konzoli (§3.2).
 *
 * Nema šablona, nema promotivnog repa i nema odjave: ovo je pismo jednom
 * čoveku, a ne kampanja (F12 §9). Jedino što se dodaje je potpis i rečenica o
 * tome zašto mejl stiže — bez nje izgleda kao da ga je poslao alat sam od sebe.
 */
export async function posaljiPorukuKorisniku(opts: {
  za: string;
  naslov: string;
  telo: string;
}): Promise<MejlIshod> {
  const rep = "Ovo je lična poruka, ne obaveštenje iz aplikacije. Odgovor stiže pravo meni.";

  const tekst = [opts.telo, "", "—", POTPIS, rep].join("\n");

  const html = okvirHtml([
    `<div style="white-space:pre-wrap">${escapeHtml(opts.telo)}</div>`,
    `<p style="margin:20px 0 0;font-size:13px;color:#6c757f">— ${escapeHtml(POTPIS)}<br>${escapeHtml(rep)}</p>`,
  ]);

  return posaljiMejl({
    za: [opts.za],
    subject: opts.naslov,
    text: tekst,
    html,
    replyTo: mojaAdresa(),
  });
}
