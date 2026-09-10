// apps/web/src/lib/ui-tekst.ts
// Srpski tekst za UI — latinica, sa dijakritikom (CLAUDE.md, sekcija Jezik).
// Bez `server-only`: ovo uvoze i klijentske komponente.
//
// Terminologija je iz tabele u CLAUDE.md: lead → prospekt, unlock → otključaj,
// band → Solidan / Osrednji / Ružan / Katastrofa, Ugly Score se ne prevodi.

import type {
  AiSeverity,
  CreditReason,
  NicheGroup,
  PlanId,
  SiteStatus,
  StanjeId,
  UglyBand,
} from "@sajtoskop/shared";
import type { SearchSummary } from "./search-types";

/**
 * Razlog stavke u knjizi kredita, na srpskom.
 *
 * „Skeniranje", ne „Pretraga" (F9, odluka 8): plaća se poziv Google-u, a ne čin
 * pretraživanja — pretraga po kešu je i dalje besplatna.
 *
 * Stoji ovde, a ne uz ekran `/krediti`, jer isti izvod čita i korisnik i admin
 * (F12 §3.2). Dve kopije istog spiska bi značile da nov razlog u knjizi u jednom
 * od dva prikaza ostane neprevede.
 */
export const RAZLOG_KREDITA: Record<CreditReason, string> = {
  unlock: "Otključavanje",
  scan: "Skeniranje",
  monthly_grant: "Mesečna dodela",
  admin: "Ručna izmena",
  refund: "Povraćaj",
  // F11: nagrada za utisak. Uvek pozitivna i uvek kroz `grant_feedback_credits`.
  feedback: "Nagrada za utisak",
  // S16 (0022). „Mesečna dodela" je zauzeta za `monthly_grant`, a razlika je
  // vidljiva korisniku: ovo je dodela koju je pokrenula NAPLATA, ne cron.
  subscription_grant: "Dodela uz pretplatu",
  // Jedini razlog koji puni kasu koja ne ističe — zato „Kupljen paket", ne
  // „Dopuna": izvod mora da kaže odakle su krediti, ne šta rade.
  credit_pack: "Kupljen paket",
  onboarding: "Dobrodošlica",
  // S20 (0024). Istorijski redovi — od S25 ovaj razlog niko ne piše.
  beta_grant: "Beta paket",
  // S25 (0025). Komp paket je nasledio ulogu beta paketa; proba i istek su
  // Stripe životni ciklus — izvod mora da kaže odakle su krediti došli i kuda
  // su otišli.
  komp_grant: "Komp paket",
  trial_grant: "Probni krediti",
  expire: "Istek pretplate",
};

/**
 * Sedam stanja pristupa (LANSIRANJE §1.5, naplata-stripe.md §7) u obliku u kom
 * ih čita čovek.
 *
 * Koristi ih ISKLJUČIVO admin konzola: kolona na `/admin/korisnici` i blok
 * „Pristup" na detalju. Korisnik svoje stanje nikad ne vidi kao ime — njemu ide
 * baner sa datumom i rečenicom šta može, jer „ti si u stanju grace" nije
 * odgovor ni na jedno pitanje koje on postavlja.
 *
 * `opis` ide u `title`: ime stanja bez objašnjenja je isto što i šifra.
 */
export const STANJE_PRISTUPA: Record<
  StanjeId,
  { label: string; variant: "primary" | "success" | "info" | "neutral" | "warning" | "danger"; opis: string }
> = {
  komp: {
    label: "Komp",
    variant: "primary",
    opis: "Komp nalog — pun pristup bez Stripe-a dok rok traje. Prazan rok znači neograničeno.",
  },
  proba: {
    label: "Proba",
    variant: "info",
    opis: "Proba: kartica je uzeta, prva naplata je na kraju probe. Pun pristup, 10 probnih kredita.",
  },
  aktivan: { label: "Aktivan", variant: "success", opis: "Pretplata je aktivna." },
  otkazan: {
    label: "Otkazan",
    variant: "info",
    opis: "Pretplata je otkazana, ali plaćeni period još traje — pun pristup do tog datuma.",
  },
  dopuna: {
    label: "Dopuna",
    variant: "neutral",
    opis: "Bez pretplate, ali ima kupljene kredite — pun pristup sa Starter dnevnim limitima.",
  },
  // „Grace" ostaje neprevedeno namerno: tako se stanje zove u LANSIRANJE §1.5 i u
  // svakom komentaru u kodu, a ovaj ekran čita samo onaj ko te dokumente i piše.
  // Prevod ovde bi značio dva imena za istu stvar.
  grace: {
    label: "Grace",
    variant: "warning",
    opis: "Rok je istekao — može da čita svoje i izvozi još 30 dana, ne može da troši.",
  },
  zakljucan: {
    label: "Zaključan",
    variant: "danger",
    opis: "I grace je istekao — ulaz vodi na cenovnik. Ništa nije obrisano.",
  },
};

/**
 * Ime plana onako kako ga vidi KORISNIK (S21).
 *
 * Razlikuje se od `profiles.plan` na tačno jednom mestu, i to namerno:
 * `dopuna` je interno ime stanja „nema pretplatu, ima kupljene kredite", a
 * korisniku „Dopuna" ne znači ništa — on nikad nije kupio proizvod koji se tako
 * zove. Vidi „Bez pretplate", što je tačan opis njegovog naloga.
 *
 * Ostala četiri imena su ista kao u katalogu, jer su to imena koja je i kupio.
 */
export const PLAN_IME: Record<PlanId, string> = {
  komp: "Komp",
  dopuna: "Bez pretplate",
  starter: "Starter",
  pro: "Pro",
  advanced: "Advanced",
};

/** Nepoznata vrednost iz baze ne sme da ispiše praznu ćeliju. */
export function imePlana(plan: string | null | undefined): string {
  return plan && plan in PLAN_IME ? PLAN_IME[plan as PlanId] : "Bez pretplate";
}

export const STATUS_LABEL: Record<SiteStatus, string> = {
  nema_sajt: "NEMA SAJT",
  mrtav: "MRTAV DOMEN",
  samo_drustvene: "SAMO DRUŠTVENE",
  ok: "IMA SAJT",
};

export const BAND_LABEL: Record<UglyBand, string> = {
  solidan: "Solidan",
  osrednji: "Osrednji",
  ruzan: "Ružan",
  katastrofa: "Katastrofa",
};

export const GROUP_LABEL: Record<NicheGroup, string> = {
  zdravstvo: "Zdravstvo",
  lepota: "Lepota",
  fitnes: "Fitnes",
  auto: "Auto",
  majstori: "Majstori i građevina",
  ugostiteljstvo: "Ugostiteljstvo",
  usluge: "Profesionalne usluge",
  trgovina: "Trgovina",
  obrazovanje: "Obrazovanje",
  turizam: "Turizam",
};

/** Bedž uz svaki problem iz Claude analize (F6 §4). */
export const SEVERITY_LABEL: Record<AiSeverity, string> = {
  visoka: "Visoko",
  srednja: "Srednje",
  niska: "Nisko",
};

/**
 * Opseg PageSpeed skora, po Googleovim pragovima (0–49 loše, 50–89 osrednje,
 * 90–100 dobro). Stoji ovde, a ne u komponenti, jer ista podela treba i
 * generatoru poruka u F7.
 */
export function psiBand(score: number): "dobar" | "osrednji" | "los" {
  if (score >= 90) return "dobar";
  if (score >= 50) return "osrednji";
  return "los";
}

/** „8,2 s" — LCP u obliku koji ide pravo u rečenicu vlasniku. */
export function formatLcp(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export const PHONE_LABEL: Record<string, string> = {
  mobilni: "Mobilni",
  fiksni: "Fiksni",
  besplatni: "Besplatni",
  nepoznat: "Nepoznat",
};

/**
 * Ista rečenica koju CLI ispisuje posle scana, samo sa `prospekata` umesto
 * `biznisa`. Prag „ružnog" ne stoji ovde kao broj — server ga računa iz
 * `ugly_band`, dakle iz `packages/shared/src/ugly-score.ts`.
 */
export function summaryLine(total: number, s: SearchSummary): string {
  return [
    `${total} ${plural(total, "prospekt", "prospekta", "prospekata")}`,
    `${s.noSite} bez sajta`,
    `${s.social} samo društvene`,
    `${s.dead} nedostupnih`,
    `${s.ugly} ružnih`,
    `${s.ok} solidnih`,
  ].join(" · ");
}

/** Srpski ima tri oblika množine: 1 prospekt, 2-4 prospekta, 5+ prospekata. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Link za pozivanje. Mobilni broj vodi na Viber, fiksni na klasičan poziv.
 *
 * Sitnica koju domaći korisnik odmah primeti (F4 §3): outreach na mobilni broj
 * se ovde radi preko Vibera, a ne pozivom. Viber traži broj bez razmaka i sa
 * pozivnim brojem, pa se `06x` prevodi u `+3816x`.
 */
export function telefonHref(broj: string, tip: string | null): string {
  const cist = broj.replace(/[^\d+]/g, "");
  if (tip !== "mobilni") return `tel:${cist}`;

  const medjunarodni = cist.startsWith("+")
    ? cist
    : cist.startsWith("0")
      ? `+381${cist.slice(1)}`
      : `+381${cist}`;

  return `viber://chat?number=${encodeURIComponent(medjunarodni)}`;
}

export function formatDatum(iso: string): string {
  return new Date(iso).toLocaleDateString("sr-Latn-RS", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const REDNI_GENITIV = [
  "",
  "prvog",
  "drugog",
  "trećeg",
  "četvrtog",
  "petog",
  "šestog",
  "sedmog",
  "osmog",
  "devetog",
  "desetog",
  "jedanaestog",
  "dvanaestog",
  "trinaestog",
  "četrnaestog",
  "petnaestog",
] as const;

/**
 * `8` → „osmog" — za „prva naplata osmog dana" (S26).
 *
 * Postoji zato što se dan prve naplate IZVODI iz `TRIAL_DAYS`, a ne piše rukom:
 * kad proba jednog dana postane 14 dana, rečenica na cenovniku i na `/krediti`
 * mora da kaže „petnaestog" bez ijedne izmene teksta. Van tabele pada na „15."
 * — tačno, samo manje lepo.
 */
export function redniDan(n: number): string {
  return REDNI_GENITIV[n] ?? `${n}.`;
}

/**
 * „11.09." — za listu besplatnih pretraga, gde datum stoji u svakom redu i pun
 * oblik bi ga razvukao preko pola širine (F9 §4.3).
 */
export function formatDatumKratko(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

/**
 * „pre 2 sata", „juče", „pre 9 dana" — kolona „Poslednji put" u admin konzoli
 * (F12 §3.1).
 *
 * Tačan datum tamo ne pomaže: pitanje koje se postavlja gledajući listu je „ko
 * se odavno nije javio", a ne „kog je datuma bio". Pun datum stoji u `title`
 * atributu, za slučaj kad odgovor ipak treba.
 *
 * `null` ulaz je „nikad" i to je stvarno stanje: `last_seen_at` je uveden u
 * migraciji 0012, pa ga korisnik koji od tada nije došao nema.
 */
export function vremeUnazad(iso: string | null): string {
  if (!iso) return "nikad";

  const proslo = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(proslo)) return "nikad";

  const minuta = Math.floor(proslo / 60_000);
  if (minuta < 1) return "upravo sad";
  if (minuta < 60) return `pre ${minuta} ${plural(minuta, "minut", "minuta", "minuta")}`;

  const sati = Math.floor(minuta / 60);
  if (sati < 24) return `pre ${sati} ${plural(sati, "sat", "sata", "sati")}`;

  const dana = Math.floor(sati / 24);
  if (dana === 1) return "juče";
  if (dana < 30) return `pre ${dana} ${plural(dana, "dan", "dana", "dana")}`;

  const meseci = Math.floor(dana / 30);
  return `pre ${meseci} ${plural(meseci, "mesec", "meseca", "meseci")}`;
}

/**
 * Koliko celih dana ostaje do `iso`. Negativno znači da je rok prošao.
 *
 * Računa se po kalendarskim danima, ne po 24h razmacima: korisniku „ističe za 2
 * dana" znači prekosutra, bez obzira na to koliko je sati sada.
 */
export function daniDo(iso: string): number {
  const dan = 86_400_000;
  const kraj = new Date(iso).setHours(0, 0, 0, 0);
  const danas = new Date().setHours(0, 0, 0, 0);
  return Math.round((kraj - danas) / dan);
}
