// apps/web/src/lib/analitika.ts
// Klijentska polovina analitike (PostHog): pregledi strana i identitet.
//
// Imenovani događaji (pretraga, otključavanje, naplata…) NE idu odavde nego sa
// servera, iz ruta koje tu radnju i rade — v. `lib/analitika-server.ts`. Razlog
// su blokatori reklama i to što ruta jedina zna da je radnja stvarno uspela.
//
// ── šta je namerno ugašeno ──────────────────────────────────
//   persistence: "memory"   ništa se ne piše u kolačiće ni u localStorage, pa
//                           nema ni banera za pristanak. Cena: anonimna poseta
//                           se ne spaja preko dva učitavanja strane.
//   autocapture             hvata tekst kliknutog elementa — dakle i naziv i
//                           telefon otključanog prospekta.
//   snimci sesija, heatmape isto, samo sa celim ekranom.
//   flagovi, ankete, ture   ne koriste se; svaki je i zahtev ka PostHogu.
//   spoljne skripte         `disable_external_dependency_loading` — CSP ostaje
//                           bez ijednog PostHog hosta, sve ide iz našeg bundle-a.
//
// Bez `NEXT_PUBLIC_POSTHOG_KEY` ništa se ne podiže i svaka funkcija je no-op.
// To je uredno stanje (lokalni razvoj, preview), ne greška.

import posthog from "posthog-js";
import { ocistiSvojstva } from "./analitika-zajednicko";

/** Putanja koju `next.config.ts` prepisuje na PostHog (EU). */
const PROXY = "/ingest";

let podignuto = false;
/** Admin se ne meri. Postavlja se pre ili posle podizanja — važi u oba slučaja. */
let iskljuceno = false;
let naCekanju: Record<string, string> | null = null;
/** Nalog za koji je PostHog trenutno vezan; `null` je anoniman posetilac. */
let povezan: string | null = null;

/**
 * Podiže PostHog, najviše jednom. `userId` iz Clerk-a ide kao početni identitet,
 * da i prvi pregled strane bude vezan za nalog, a ne za anonimnog posetioca.
 */
export function pokreniAnalitiku(userId: string | null): void {
  const kljuc = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (podignuto || iskljuceno || !kljuc || typeof window === "undefined") return;
  podignuto = true;
  povezan = userId;

  posthog.init(kljuc, {
    api_host: PROXY,
    ui_host: "https://eu.posthog.com",
    defaults: "2026-01-30",
    persistence: "memory",
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    autocapture: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    ...(userId ? { bootstrap: { distinctID: userId, isIdentifiedID: true } } : {}),
    before_send: (dogadjaj) => {
      if (iskljuceno || !dogadjaj) return null;
      ocistiSvojstva(dogadjaj.properties);
      ocistiSvojstva(dogadjaj.$set);
      ocistiSvojstva(dogadjaj.$set_once);
      return dogadjaj;
    },
  });

  if (naCekanju) {
    posthog.setPersonProperties(naCekanju);
    naCekanju = null;
  }
}

/** Prijava posle podizanja (gost koji se upravo ulogovao). */
export function poveziKorisnika(userId: string): void {
  if (!podignuto || iskljuceno || povezan === userId) return;
  posthog.identify(userId);
  povezan = userId;
}

/** Odjava: sledeći korisnik na istom pregledaču ne nasleđuje identitet. */
export function odveziKorisnika(): void {
  iskljuceno = false;
  naCekanju = null;
  if (podignuto && povezan) posthog.reset();
  povezan = null;
}

/** Plan i stanje pristupa na osobi u PostHogu. Ništa drugo o korisniku ne ide. */
export function opisiKorisnika(opis: { plan: string; stanje: string }): void {
  if (iskljuceno) return;
  if (podignuto) posthog.setPersonProperties(opis);
  else naCekanju = opis;
}

/** Admin nalog: od ovog poziva nijedan događaj ne izlazi iz pregledača. */
export function iskljuciAnalitiku(): void {
  iskljuceno = true;
  naCekanju = null;
}
