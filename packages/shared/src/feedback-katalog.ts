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
//
// S29 briše pitanje o ceni (naplata postoji, opsezi u RSD su mrtva brojka),
// zamenjuje `KRAJ_BETE` rokom koji ne govori o beti i dodaje `nps-7`, `fali` i
// treći korak na `prvi-potpisan`.

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
   * Pod kojim ključem prvi odgovor ulazi u `answers`. Podrazumevano `odgovor`.
   *
   * Postoji zbog `nps-7`: ocena 0–10 je broj koji `admin_nps()` sabira, pa
   * mora da stoji pod svojim imenom (`ocena`), a ne pod istim ključem pod kojim
   * stoje i `jeste` i `presudno`. Sve ostalo i dalje piše u `odgovor` — jedno
   * pravilo za `opisOdgovora()` umesto devet.
   */
  kljucOdgovora?: string;
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
   * Treći korak, isti put kao drugi. Postoji samo na `prvi-potpisan`: pošto je
   * čovek rekao da bi preporučio, jedino što još fali je pravo da se to
   * citira. Otvara se SAMO posle „Da" — tražiti citat od nekoga ko je rekao
   * „Ne" je pitanje na koje ne postoji dobar odgovor.
   */
  treciKorak?: {
    naslov: string;
    kljucOdgovora: string;
    /** Vrednost drugog koraka posle koje se treći uopšte otvara. */
    kadDrugi: string;
    opcije: Opcija[];
  };
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
   * Postojalo je zbog `cene` (odluka 8); od S29 ga nosi `nps-7`, iz istog
   * razloga: plaćena ocena je pokvarena ocena. Rečenica uz nju je deo istog
   * odgovora, pa ni ona ne donosi kredit.
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
 * Rok koji nose sva pitanja u katalogu.
 *
 * Bio je `KRAJ_BETE`, i to je bila greška u imenu, ne u datumu: pitanja nisu
 * postojala zbog bete nego zbog toga što na njih još nemam odgovor. Proizvod
 * koji se naplaćuje i dalje ima šta da pita, pa rok ostaje — ništa u katalogu
 * ne sme da živi bez roka (§9) — ali više ne tvrdi da se nešto završava.
 *
 * Menja se ovde i nigde više.
 */
export const ROK_PITANJA = "2027-12-31";

// ── šeme odgovora ────────────────────────────────────────────
// `strictObject`: nepoznat ključ je greška, ne šum. `answers` ulazi u bazu kakav
// jeste, pa je ovo poslednje mesto na kom se može odbiti.
//
// Ključ prvog odgovora je `odgovor` svuda osim na `nps-7`, gde je `ocena` —
// tamo je vrednost broj koji se sabira, pa mora da stoji pod svojim imenom.
// Zahvaljujući tom pravilu `opisOdgovora()` (mejl, admin lista) ima dva
// slučaja umesto devet.

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

/**
 * Treći korak (`citat`) sme da postoji SAMO uz `preporuka: 'da'`.
 *
 * Bez ove provere bi zapis mogao da tvrdi „ne bih preporučio" i uz to nosi
 * dozvolu da se citira na sajtu — a to je tačno onaj citat koji ne smem da
 * objavim. Kapija je ovde, a ne u komponenti: drugi i treći korak idu kroz
 * `PATCH`, pa ih klijent može poslati i mimo redosleda.
 */
const semaPrviPotpisan = z
  .strictObject({
    odgovor: z.enum(["presudno", "pomoglo", "malo"]),
    preporuka: z.enum(["da", "mozda", "ne"]).optional(),
    citat: z.enum(["da-ime", "da-bez", "ne"]).optional(),
  })
  .refine((v) => v.citat === undefined || v.preporuka === "da", {
    error: "Dozvola za citat ide samo uz preporuku „da”.",
  });

/**
 * NPS, 0–10 (§5.3 A).
 *
 * `coerce`: kartica šalje vrednost opcije, a vrednost opcije je string. Broj je
 * ono što `admin_nps()` sabira, pa se pretvara ovde — na granici, jednom, a ne
 * u svakom kasnijem upitu nad jsonb-om.
 */
const semaNps = z.strictObject({
  ocena: z.coerce
    .number()
    .int({ error: "Ocena je ceo broj." })
    .min(0, { error: "Ocena ide od 0 do 10." })
    .max(10, { error: "Ocena ide od 0 do 10." }),
});

/**
 * „Šta ti ovde fali" (§5.3 C) — jedino pitanje bez ijedne ponuđene opcije i bez
 * uslova nad nalogom. Okida ga ekran koji NEMA šta da pokaže, pa je tekst jedini
 * mogući odgovor: klik tu ne bi nosio nijednu informaciju.
 *
 * `query` je ono što je korisnik tražio kad je pretraga vratila nulu (combobox
 * niša). Nije obavezno — prazno stanje `/liste` i `/pipeline` ga nemaju.
 */
const semaFali = z.strictObject({
  tekst: z
    .string()
    .trim()
    .min(2, { error: "Napiši bar dve reči." })
    .max(200, { error: "Do 200 karaktera." }),
  query: z.string().trim().max(120).optional(),
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
    do: ROK_PITANJA,
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
    do: ROK_PITANJA,
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
    do: ROK_PITANJA,
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
    do: ROK_PITANJA,
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
    do: ROK_PITANJA,
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
    // Treći korak (§5.3 B): pitanje za dozvolu, ne za tekst. Tekst je već tu —
    // dopuna ispod je ono što se citira. Otvara se samo posle „Da", jer je
    // svaki drugi odgovor već rekao da citata nema.
    treciKorak: {
      naslov: "Smem li to da citiram?",
      kljucOdgovora: "citat",
      kadDrugi: "da",
      opcije: [
        { vrednost: "da-ime", label: "Da, sa imenom" },
        { vrednost: "da-bez", label: "Da, bez imena" },
        { vrednost: "ne", label: "Radije ne" },
      ],
    },
    dopuna: { placeholder: "Šta bi rekao kolegi o Sajtoskopu?", obavezna: false },
    sema: semaPrviPotpisan,
  },
  {
    // §5.3 A. Zamenjuje pitanje o ceni: cena više nije pretpostavka nego
    // cenovnik, pa jedina kampanjska brojka koja još nedostaje je ta da li bi
    // ovo iko preporučio. F11 odluka 13 je NPS odbila jer proizvod tada nije
    // imao cenu — sada je ima, pa razlog više ne stoji (§5.2).
    kljuc: "nps-7",
    sloj: "kampanja",
    oblik: "kartica",
    prioritet: 40,
    uvod: "Jedno pitanje, jedan klik.",
    naslov: "Koliko je verovatno da bi Sajtoskop preporučio kolegi?",
    kljucOdgovora: "ocena",
    do: ROK_PITANJA,
    sufiks: "0 = nikako · 10 = sigurno",
    napomena: "Iskrena ocena mi je vrednija od lepe. Ovo ne menja tvoj pristup ni cenu.",
    opcije: Array.from({ length: 11 }, (_, i) => ({
      vrednost: String(i),
      label: String(i),
    })),
    dopuna: { placeholder: "Šta bi morao da uradi za devetku?", obavezna: false },
    // Isti razlog kao nekad kod cene (odluka 8): plaćena ocena je pokvarena
    // ocena, a rečenica uz nju je deo istog odgovora.
    bezNagrade: true,
    // Sedam dana i bar jedno otključavanje — dovoljno da čovek zna šta ocenjuje.
    uslov: (u) => u.danaOdRegistracije >= 7 && u.otkljucano >= 1,
    sema: semaNps,
  },
  {
    // §5.3 C. Jedino pitanje koje okida PRAZNO stanje, i jedino bez uslova nad
    // nalogom: ekran koji nema šta da pokaže je isti ekran i prvog i stotog
    // dana. Ponavlja se na 24 h iz istog razloga iz kog i `posao-pao` — prazna
    // lista koja se ponovi sutra je nova prazna lista.
    kljuc: "fali",
    sloj: "kontekst",
    oblik: "mikro",
    prioritet: 58,
    naslov: "Šta ti ovde fali?",
    do: ROK_PITANJA,
    opcije: [],
    tekstPrvi: true,
    ponovi: { naSati: 24 },
    dopuna: { placeholder: "npr. filter po broju recenzija", obavezna: false },
    sema: semaFali,
  },
  {
    kljuc: "zasto-ne-vracas",
    sloj: "kampanja",
    oblik: "mikro",
    prioritet: 45,
    naslov: "Nisi bio 10 dana. Šta te je zaustavilo?",
    do: ROK_PITANJA,
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
    do: ROK_PITANJA,
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

  // Ključ prvog odgovora je `odgovor` svuda osim na `nps-7` (`ocena`). Ocena je
  // broj i ostaje broj — labela `9` i vrednost `9` su ista stvar, pa se ne
  // prevodi nego ispisuje uz skalu, da se u inboksu ne čita kao „ocena 9/3".
  const kljucPrvog = pitanje.kljucOdgovora ?? "odgovor";
  const odgovor = answers[kljucPrvog];
  if (typeof odgovor === "number") delovi.push(`${odgovor}/10`);
  else if (typeof odgovor === "string") delovi.push(label(pitanje.opcije, odgovor));

  // Drugi i treći korak i čipovi su deo istog odgovora, pa i jedan red u inboksu.
  const drugi = pitanje.drugiKorak;
  if (drugi) {
    const v = answers[drugi.kljucOdgovora];
    if (typeof v === "string") delovi.push(`${drugi.naslov} ${label(drugi.opcije, v)}`);
  }

  const treci = pitanje.treciKorak;
  if (treci) {
    const v = answers[treci.kljucOdgovora];
    if (typeof v === "string") delovi.push(`${treci.naslov} ${label(treci.opcije, v)}`);
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

  // Šta je čovek tražio kad je pretraga vratila nulu (`fali` iz combobox-a).
  const upit = answers.query;
  if (typeof upit === "string" && upit.trim()) delovi.push(`tražio: ${upit.trim()}`);

  const jobId = answers.jobId;
  if (typeof jobId === "number") delovi.push(`posao #${jobId}`);

  return delovi.join(" · ") || "—";
}
