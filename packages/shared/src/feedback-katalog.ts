// packages/shared/src/feedback-katalog.ts
// Katalog pitanja za utiske (F11 §2).
//
// Ovo je jedini izvor istine za web (prikaz), API (validacija) i admin (naziv u
// listi). Pitanje koje nije ovde NE POSTOJI (pravilo 16): ruta odbija nepoznat
// `prompt_key` sa 400, a `answers` se validira šemom IZ kataloga, po ključu —
// nikad generičkim `z.record`. Bez toga je `answers` jsonb kanta u koju svako
// upisuje šta hoće.
//
// Katalog je kod, ne CMS (F11 odluka 2). Novo pitanje = commit. Za 20 korisnika
// CRUD nad pitanjima je alat koji se pravi umesto proizvoda.
//
// F11.1 je doneo tri pitanja sa `/pretrage`. F11.2 dodaje preostala četiri iz
// §2.1 i §2.3 i uvodi `do:` — datum posle kog pitanje za motor ne postoji.

import { z } from "zod";
import type { FeedbackKind } from "./db";

/** Kako se pitanje pojavljuje. Nijedan oblik ne blokira ekran (odluka 3). */
export type Oblik = "mikro" | "kartica" | "panel";

/** Kom sloju pripada — određuje prioritet i pravo prolaza kroz cooldown. */
export type Sloj = "kontekst" | "kampanja" | "incident";

export type Opcija = { vrednost: string; label: string };

/**
 * Stanje naloga koje motor ne može da izvede iz okidača.
 *
 * Kampanjsko pitanje se ne javlja zato što se nešto desilo nego zato što je
 * nalog dogurao dokle treba: „7 dana i 5 otključanih" nije događaj u aplikaciji
 * i ne postoji trenutak u kom bi ga neki ekran mogao „prijaviti". Zato se čita
 * sa servera jednom po punom učitavanju i ulazi u odluku kao podatak.
 */
export type Uslovi = {
  danaOdRegistracije: number;
  otkljucano: number;
  /** Dužina prekida PRE ovog dolaska. `0` kad prethodne aktivnosti nema. */
  danaPauze: number;
};

export type Pitanje = {
  /** `'prva-lista'` — ide u `feedback.prompt_key`. */
  kljuc: string;
  sloj: Sloj;
  oblik: Oblik;
  /** Veći pobeđuje kad se dva pitanja poklope u istoj sekundi (§9). */
  prioritet: number;
  /** Srpski, latinica, sa dijakritikom. */
  naslov: string;
  opcije: Opcija[];
  /**
   * Poslednji dan važenja, `YYYY-MM-DD`. Posle njega pitanje za motor ne
   * postoji (§9: „Beta se završila, a pitanja ostala").
   *
   * Obavezno je, i to namerno: pitanje bez roka je pitanje koje će nekome iskočiti
   * i godinu dana pošto je odgovor prestao da znači išta.
   */
  do: string;
  /** Uvodni red iznad naslova. Samo kartica ima mesta za njega. */
  uvod?: string;
  /** Rečenica ispod opcija — objašnjenje, nikad molba. */
  napomena?: string;
  /** Sufiks uz red opcija, npr. jedinica mere. */
  sufiks?: string;
  /**
   * Tekst je PRVI korak, ne dopuna posle klika. Samo `prazan-rezultat`: klik bez
   * teksta tu ne nosi nijednu informaciju (F11 §2.1).
   */
  tekstPrvi?: boolean;
  /** Traži li se tekst posle klika i sa kojim placeholderom. */
  dopuna?: { placeholder: string; obavezna: false };
  /**
   * Pitanje koje se pojavljuje TEK posle prvog odgovora, u istom obliku.
   *
   * Odgovor ide kroz `PATCH /api/feedback/[id]` sa `answers`, pa se spaja sa
   * prvim i ponovo proverava istom šemom — drugi korak ne sme da zaobiđe kapiju.
   */
  drugiKorak?: { naslov: string; kljucOdgovora: string; opcije: Opcija[] };
  /**
   * Višestruki izbor koji se otvara samo za neke odgovore („Ponešto", „Netačno").
   * Isti put kao `drugiKorak`.
   */
  cipovi?: {
    naslov: string;
    kljucOdgovora: string;
    kadOdgovor: string[];
    opcije: Opcija[];
  };
  /**
   * Izuzetak od pravila „isto pitanje 1× po nalogu, zauvek" (§3.1). Samo
   * `posao-pao`: kvar koji se ponovi je nov kvar, ali ne češće od 24 h.
   */
  ponovi?: { naSati: number };
  /**
   * Kad je odgovor baš ovaj, zapis je prijava kvara. `kind` i `severity` server
   * IZVODI odavde — nikad ih ne prima iz tela (pravilo 8, F11 §5).
   */
  prijava?: { odgovor: string; kind: FeedbackKind; severity: 1 | 2 | 3 };
  /**
   * Odgovor se NIKAD ne nagrađuje kreditima, ni kad nosi poruku.
   *
   * Postoji zbog `cene` i samo zbog nje (odluka 8): plaćena brojka o ceni je
   * pokvarena brojka, a dopisana rečenica uz nju je deo istog odgovora.
   */
  bezNagrade?: true;
  /**
   * Uslov nad stanjem naloga, uz okidač. Pitanje bez ovog polja zavisi samo od
   * događaja koji ga je prijavio.
   */
  uslov?: (u: Uslovi) => boolean;
  /** Zod šema za `answers` — bez nje jsonb postaje kanta. */
  sema: z.ZodType;
};

/**
 * Kraj bete — jedini datum koji nose sva pitanja koja postoje zbog nje.
 *
 * Menja se ovde i nigde više. Beta koja se produži je jedna izmena reda, a ne
 * sedam raštrkanih datuma od kojih se dva zaborave.
 */
export const KRAJ_BETE = "2026-12-31";

/**
 * Incident nije kampanja: `posao-pao` je usluga korisniku (§2.2) i preživljava
 * kraj bete. Rok svejedno ima — ništa u katalogu ne sme da živi bez roka.
 */
const KRAJ_INCIDENTA = "2027-12-31";

// ── cena: opsezi i medijana ──────────────────────────────────
// Odgovori su opsezi, ne slobodno polje. Slobodno polje daje „pa ne znam,
// zavisi", a opseg daje broj koji ulazi u medijanu (F11 §2.3).

export type CenaOpseg = { vrednost: string; label: string; sredina: number };

/** Šest opsega u RSD mesečno. `sredina` je ono što ulazi u medijanu. */
export const CENA_OPSEZI: readonly CenaOpseg[] = [
  { vrednost: "ne-bih", label: "Ne bih plaćao", sredina: 0 },
  { vrednost: "do-990", label: "do 990", sredina: 700 },
  { vrednost: "990-1990", label: "990–1.990", sredina: 1490 },
  { vrednost: "1990-3900", label: "1.990–3.900", sredina: 2945 },
  { vrednost: "3900-6900", label: "3.900–6.900", sredina: 5400 },
  { vrednost: "6900-plus", label: "6.900+", sredina: 8500 },
];

/**
 * Prag iz `00-kontekst.md` §2. Ispod ovoga je alat interni alat za Remati.
 * Stoji uz opsege, jer je jedini razlog zbog kog se medijana uopšte računa.
 */
export const PRAG_CENE_RSD = 1500;

const CENA_SREDINA = new Map(CENA_OPSEZI.map((o) => [o.vrednost, o.sredina]));

/**
 * Medijana iz sredina opsega.
 *
 * Živi uz katalog, a ne uz admin ekran, zato što je i sam raspored opsega ovde:
 * kad se opsezi ikad promene, medijana se menja u istom fajlu ili nikako.
 *
 * Nepoznata vrednost se preskače — zapis iz starije verzije kataloga ne sme da
 * obori ceo izveštaj.
 */
export function medijanaCene(odgovori: readonly string[]): number | null {
  const iznosi = odgovori
    .map((o) => CENA_SREDINA.get(o))
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);

  if (iznosi.length === 0) return null;

  const sredina = iznosi.length >> 1;
  const gornji = iznosi[sredina] ?? 0;
  if (iznosi.length % 2 === 1) return gornji;

  const donji = iznosi[sredina - 1] ?? 0;
  return Math.round((donji + gornji) / 2);
}

// ── šeme odgovora ────────────────────────────────────────────
// `strictObject`: nepoznat ključ je greška, ne šum. `answers` ulazi u bazu kakav
// jeste, pa je ovo poslednje mesto na kom se može odbiti.
//
// Ključ prvog odgovora je svuda `odgovor` — i tamo gde bi „opseg" ili „ocena"
// zvučalo prirodnije. Zahvaljujući tome `opisOdgovora()` (mejl, admin lista)
// ima jedno pravilo umesto sedam.

const semaPrvaLista = z.strictObject({
  odgovor: z.enum(["jeste", "delimicno", "nije"]),
});

const semaPrazanRezultat = z.strictObject({
  tekst: z
    .string()
    .trim()
    .min(2, { error: "Napiši bar dve reči." })
    .max(200, { error: "Do 200 karaktera." }),
});

const semaPosaoPao = z.strictObject({
  odgovor: z.enum(["dnevnik", "ne-treba"]),
  /** ID posla koji je pao. Bez njega se ne zna nad čim je pukao worker. */
  jobId: z.number().int().positive().max(2_147_483_647).optional(),
});

/**
 * `netacno` sme da postoji samo uz odgovor koji nije „sve tačno".
 *
 * Bez ove provere bi zapis mogao da tvrdi „sve tačno" i istovremeno nabroji tri
 * netačna polja, pa bi svaki kasniji izveštaj morao da bira kome da veruje.
 */
const semaTacnostPodataka = z
  .strictObject({
    odgovor: z.enum(["sve-tacno", "ponesto", "netacno"]),
    netacno: z
      .array(z.enum(["telefon", "mejl", "sajt", "ugly-score", "snimak"]))
      .max(5)
      .optional(),
  })
  .refine((v) => v.odgovor !== "sve-tacno" || !v.netacno?.length, {
    error: "Odgovor sve-tacno ne ide uz spisak netačnih polja.",
  });

const semaPorukaKvalitet = z.strictObject({
  odgovor: z.enum(["poslao", "izmene", "ne-bih"]),
  /** Šablon ili AI varijanta — ista poruka, dva porekla i dva zaključka. */
  izvor: z.enum(["sablon", "ai"]).optional(),
  kanal: z.enum(["mejl", "viber", "instagram"]).optional(),
});

const semaPrviPotpisan = z.strictObject({
  odgovor: z.enum(["presudno", "pomoglo", "malo"]),
  preporuka: z.enum(["da", "mozda", "ne"]).optional(),
});

const semaCena = z.strictObject({
  odgovor: z.enum(CENA_OPSEZI.map((o) => o.vrednost) as [string, ...string[]]),
});

const semaZastoNeVracas = z.strictObject({
  odgovor: z.enum([
    "nemam-vremena",
    "malo-prospekata",
    "netacni-podaci",
    "resio-drugacije",
    "drugo",
  ]),
});

// ── katalog ──────────────────────────────────────────────────

/**
 * Prioriteti: incident > kontekstualno > kampanjsko (F11 §1).
 *
 * Unutar konteksta redosled je po tome koliko je trenutak redak: prvi potpisan
 * posao se dešava jednom u životu naloga, prazna lista svaki drugi dan. Dva
 * pitanja se u praksi retko poklope — ali kad se poklope, ovaj broj je odluka, a
 * ne slučaj.
 */
export const KATALOG: readonly Pitanje[] = [
  {
    kljuc: "prva-lista",
    sloj: "kontekst",
    oblik: "mikro",
    prioritet: 50,
    naslov: "Je l' ti ova lista upotrebljiva?",
    do: KRAJ_BETE,
    opcije: [
      { vrednost: "jeste", label: "Jeste" },
      { vrednost: "delimicno", label: "Delimično" },
      { vrednost: "nije", label: "Nije" },
    ],
    dopuna: { placeholder: "Šta bi ti trebalo da bude upotrebljivija?", obavezna: false },
    sema: semaPrvaLista,
  },
  {
    kljuc: "prazan-rezultat",
    sloj: "kontekst",
    oblik: "mikro",
    prioritet: 60,
    naslov: "Šta si tražio?",
    do: KRAJ_BETE,
    opcije: [],
    tekstPrvi: true,
    // Odgovor je spisak niša i gradova koje ljudi traže a ja ih nemam — direktan
    // ulaz u taksonomiju (F11 §2.1).
    dopuna: { placeholder: "npr. bravar u Loznici", obavezna: false },
    sema: semaPrazanRezultat,
  },
  {
    kljuc: "tacnost-podataka",
    sloj: "kontekst",
    oblik: "mikro",
    prioritet: 55,
    naslov: "Drže li podaci vodu?",
    do: KRAJ_BETE,
    opcije: [
      { vrednost: "sve-tacno", label: "Sve tačno" },
      { vrednost: "ponesto", label: "Ponešto" },
      { vrednost: "netacno", label: "Netačno" },
    ],
    // Čipovi se otvaraju samo kad ima šta da se pokaže prstom. „Sve tačno" je
    // pun odgovor sam za sebe i tu se traka gasi.
    cipovi: {
      naslov: "Šta nije štimalo?",
      kljucOdgovora: "netacno",
      kadOdgovor: ["ponesto", "netacno"],
      opcije: [
        { vrednost: "telefon", label: "Telefon" },
        { vrednost: "mejl", label: "Mejl" },
        { vrednost: "sajt", label: "Sajt" },
        { vrednost: "ugly-score", label: "Ugly Score" },
        { vrednost: "snimak", label: "Snimak" },
      ],
    },
    dopuna: { placeholder: "Šta tačno nije bilo tačno?", obavezna: false },
    sema: semaTacnostPodataka,
  },
  {
    kljuc: "poruka-kvalitet",
    sloj: "kontekst",
    oblik: "mikro",
    prioritet: 52,
    naslov: "Bi li je poslao ovakvu?",
    do: KRAJ_BETE,
    opcije: [
      { vrednost: "poslao", label: "Poslao bih" },
      { vrednost: "izmene", label: "Uz sitne izmene" },
      { vrednost: "ne-bih", label: "Ne bih" },
    ],
    dopuna: { placeholder: "Šta bi promenio u njoj?", obavezna: false },
    sema: semaPorukaKvalitet,
  },
  {
    kljuc: "prvi-potpisan",
    sloj: "kontekst",
    oblik: "kartica",
    prioritet: 70,
    uvod: "Prvi potpisan preko Sajtoskopa.",
    naslov: "Koliko je alat pomogao?",
    do: KRAJ_BETE,
    opcije: [
      { vrednost: "presudno", label: "Presudno" },
      { vrednost: "pomoglo", label: "Pomoglo" },
      { vrednost: "malo", label: "Malo" },
    ],
    // Jedino mesto na kom se uopšte pita za preporuku — i to tek pošto je čovek
    // zaradio novac, ne na dan 3 (odluka 13: bez NPS skale).
    drugiKorak: {
      naslov: "Bi li ga preporučio kolegi?",
      kljucOdgovora: "preporuka",
      opcije: [
        { vrednost: "da", label: "Da" },
        { vrednost: "mozda", label: "Možda" },
        { vrednost: "ne", label: "Ne" },
      ],
    },
    sema: semaPrviPotpisan,
  },
  {
    kljuc: "cena",
    sloj: "kampanja",
    oblik: "kartica",
    prioritet: 40,
    uvod: "Beta se jednom završava",
    naslov: "Koliko bi ti Sajtoskop mesečno vredeo?",
    do: KRAJ_BETE,
    sufiks: "RSD/mes",
    napomena: "Iskren odgovor mi je vredniji od lepog. Ovo ne menja tvoj pristup u beti.",
    opcije: CENA_OPSEZI.map((o) => ({ vrednost: o.vrednost, label: o.label })),
    dopuna: { placeholder: "Šta bi morao da uradi za tu cenu?", obavezna: false },
    // Odluka 8, doslovno: plaćena brojka o ceni je pokvarena brojka. Ni odgovor
    // ni rečenica uz njega ne donose kredit.
    bezNagrade: true,
    uslov: (u) => u.danaOdRegistracije >= 7 && u.otkljucano >= 5,
    sema: semaCena,
  },
  {
    kljuc: "zasto-ne-vracas",
    sloj: "kampanja",
    oblik: "mikro",
    prioritet: 45,
    naslov: "Nisi bio 10 dana. Šta te je zaustavilo?",
    do: KRAJ_BETE,
    opcije: [
      { vrednost: "nemam-vremena", label: "Nemam trenutno vremena" },
      { vrednost: "malo-prospekata", label: "Nisam našao dovoljno prospekata" },
      { vrednost: "netacni-podaci", label: "Podaci mi nisu bili tačni" },
      { vrednost: "resio-drugacije", label: "Rešio sam to drugačije" },
      { vrednost: "drugo", label: "Nešto drugo" },
    ],
    dopuna: { placeholder: "Šta bi te vratilo?", obavezna: false },
    uslov: (u) => u.danaPauze >= 10,
    sema: semaZastoNeVracas,
  },
  {
    kljuc: "posao-pao",
    sloj: "incident",
    oblik: "mikro",
    prioritet: 100,
    naslov: "Skeniranje nije prošlo. Da vidim šta se desilo?",
    do: KRAJ_INCIDENTA,
    opcije: [
      { vrednost: "dnevnik", label: "Pošalji mi dnevnik" },
      { vrednost: "ne-treba", label: "Ne treba" },
    ],
    ponovi: { naSati: 24 },
    // Jedino mesto gde je pitanje usluga korisniku, a ne molba — zato sme preko
    // cooldowna (F11 §2.2). Uz „Pošalji mi dnevnik" ide i dnevnik poslednjih pet
    // klijentskih grešaka; server ga prima samo zato što je ovde `kind: 'bug'`.
    prijava: { odgovor: "dnevnik", kind: "bug", severity: 2 },
    sema: semaPosaoPao,
  },
];

const PO_KLJUCU = new Map(KATALOG.map((p) => [p.kljuc, p]));

/** Svi ključevi iz kataloga. Ono što nije ovde, za motor i rutu ne postoji. */
export const PITANJE_KLJUCEVI: readonly string[] = KATALOG.map((p) => p.kljuc);

/** Pitanje po ključu, ili `null`. Ruta na `null` vraća 400 (pravilo 16). */
export function pitanjeZaKljuc(kljuc: string): Pitanje | null {
  return PO_KLJUCU.get(kljuc) ?? null;
}

/**
 * Važi li pitanje u datom trenutku (`do:`).
 *
 * `do` je POSLEDNJI dan važenja, pa se poredi sa krajem tog dana. Vreme je UTC:
 * dva sata razlike prema Beogradu ovde ne menjaju ništa što bi neko primetio, a
 * lokalna zona bi značila da isti katalog na serveru i u pregledaču ume da da
 * dva različita odgovora.
 */
export function vaziPitanje(pitanje: Pitanje, sada: number): boolean {
  const kraj = Date.parse(`${pitanje.do}T23:59:59.999Z`);
  return Number.isNaN(kraj) ? false : sada <= kraj;
}

/**
 * `answers` provereno šemom IZ kataloga, po ključu.
 *
 * Vraća pročišćen objekat, ne ulaz: u bazu ide ono što je šema propustila, sa
 * odsečenim razmacima i bez ijednog nepoznatog ključa.
 */
export type OdgovorIshod =
  | { ok: true; pitanje: Pitanje; answers: Record<string, unknown> }
  | { ok: false; greska: string; detalji?: string[] };

export function proveriOdgovor(kljuc: string, answers: unknown): OdgovorIshod {
  const pitanje = pitanjeZaKljuc(kljuc);
  if (!pitanje) return { ok: false, greska: "Nepoznato pitanje." };

  const ishod = pitanje.sema.safeParse(answers ?? {});
  if (!ishod.success) {
    return {
      ok: false,
      greska: "Odgovor ne odgovara pitanju.",
      detalji: ishod.error.issues.map((i) => `${i.path.join(".") || "answers"}: ${i.message}`),
    };
  }

  return { ok: true, pitanje, answers: ishod.data as Record<string, unknown> };
}

/**
 * Ljudska oznaka odgovora — za mejl i za admin listu.
 *
 * Vrednosti u `answers` su ključevi (`'delimicno'`), a ja u inboksu čitam
 * labele (`'Delimično'`). Prevod živi uz katalog, ne uz mejl.
 */
export function opisOdgovora(pitanje: Pitanje, answers: Record<string, unknown>): string {
  const delovi: string[] = [];

  const label = (opcije: readonly Opcija[], vrednost: string) =>
    opcije.find((o) => o.vrednost === vrednost)?.label ?? vrednost;

  const odgovor = answers.odgovor;
  if (typeof odgovor === "string") delovi.push(label(pitanje.opcije, odgovor));

  // Drugi korak i čipovi su deo istog odgovora, pa i jedan red u inboksu.
  const drugi = pitanje.drugiKorak;
  if (drugi) {
    const v = answers[drugi.kljucOdgovora];
    if (typeof v === "string") delovi.push(`${drugi.naslov} ${label(drugi.opcije, v)}`);
  }

  const cipovi = pitanje.cipovi;
  if (cipovi) {
    const v = answers[cipovi.kljucOdgovora];
    if (Array.isArray(v) && v.length > 0) {
      delovi.push(
        v
          .filter((x): x is string => typeof x === "string")
          .map((x) => label(cipovi.opcije, x))
          .join(", "),
      );
    }
  }

  const tekst = answers.tekst;
  if (typeof tekst === "string" && tekst.trim()) delovi.push(tekst.trim());

  const jobId = answers.jobId;
  if (typeof jobId === "number") delovi.push(`posao #${jobId}`);

  return delovi.join(" · ") || "—";
}
