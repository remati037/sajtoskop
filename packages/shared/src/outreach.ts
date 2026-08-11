// packages/shared/src/outreach.ts
// Generator outreach poruka na šablonima (F7 §2). Čista funkcija — bez mreže,
// bez baze, bez Claude poziva. AI varijanta („Napiši drugačije") je zaseban,
// opcioni korak i prolazi kroz istu proveru (`proveriPoruku`).
//
// ── tri kanala, tri oblika, ne tri varijante istog teksta ──
// Mejl sme link i ima subject. Viber ne sme link i staje u 50 reči. Instagram je
// dvostepen: prva poruka bez ponude, jer duga prva poruka na IG-u ide u zahteve
// i tamo umire.
//
// ── zašto je sve u prezentu ────────────────────────────────
// Srpski perfekat je rodno obeležen: „tražio sam" / „tražila sam". Pol korisnika
// alata ne znamo i nećemo ga tražiti da bismo sastavili rečenicu. Prezent
// („vidim", „ne mogu da nađem", „javljam se") nema taj problem i zvuči
// neposrednije. Isto važi i za `AiIssue.evidence` iz F6 — model piše u prezentu.
//
// ── šta NIKAD ne izlazi iz ovog fajla ──────────────────────
// Naziv alata, Ugly Score, „automatski sam analizirao", `Signal.points`,
// emodži, velika slova, uzvičnik. Poslednja rečenica uvek skida pritisak.

import { gradLokativ, nisaAkuzativ } from "./sklonidba";
import type { AiIssue, AiSeverity, PhoneKind, Signal, SiteStatus } from "./types";

// ─────────────────────────────────────────────────────────────
// Javni tipovi
// ─────────────────────────────────────────────────────────────

/** Kanali za koje generator pravi tekst. `poziv` je kanal kontakta, ne poruke. */
export type MessageChannel = "mejl" | "viber" | "instagram";

/** Sve što `lead_status.channel` sme da bude — uključuje i telefonski poziv. */
export type ContactChannel = MessageChannel | "poziv";

export type OutreachInput = {
  name: string;
  citySlug: string | null;
  nicheSlug: string | null;
  siteStatus: SiteStatus | null;
  websiteUrl: string | null;
  /**
   * Signali iz Ugly Score-a. Ulazi ceo `Signal`, jer se kopi bira po `key`-u —
   * `points` se ovde SAMO čita za redosled i nikad ne završava u tekstu.
   */
  signals: Signal[];
  aiIssues: AiIssue[] | null;
  /**
   * `true` → model je sajt proglasio urednim i poruka se ne piše.
   * `null` → AI nije ni pozvan; tada odlučuju `siteStatus` i signali (0006).
   */
  aiSolidan: boolean | null;
  phoneType: PhoneKind | null;
  /**
   * Google ocena i broj ocena.
   *
   * Ovo je jedina stvar u celom ulazu koja je nesumnjivo o NJIMA. Status sajta
   * deli 125 firmi u bazi, niša i grad još stotine — „imate 4,8 sa 157 ocena"
   * ne deli niko. Za firmu sa dobrim ocenama i bez sajta to je i cela poenta
   * poruke: reputaciju su zaradili, a nemaju gde da pošalju čoveka koji je vidi.
   */
  rating: number | null;
  reviewCount: number | null;
  /** Ime pošiljaoca za potpis. Bez njega poruka ide bez potpisa, ne sa prazninom. */
  senderName: string | null;
};

export type Poruka = {
  channel: MessageChannel;
  /** Samo mejl. Ostali kanali nemaju naslov. */
  subject?: string;
  body: string;
  /** Druga poruka na Instagramu — šalje se tek na odgovor (F7 §2). */
  followUp?: string;
  /** Broj reči u `body`. UI ga ne prikazuje; postoji za proveru i testove. */
  words: number;
};

export type OutreachOk = {
  ok: true;
  poruke: Record<MessageChannel, Poruka>;
  /** Predlog kanala iz `phone_type`: mobilni → viber, fiksni → poziv, nema → mejl. */
  predlog: ContactChannel;
  /** Odakle je došla prva rečenica — za „zašto baš ovo piše" u UI-u. */
  izvor: "status" | "ai" | "signal";
};

export type OutreachSkip = {
  ok: false;
  /** `solidan` — sajt je proveren i uredan. `nema_osnova` — nema konkretnog problema. */
  razlog: "solidan" | "nema_osnova";
  /** Rečenica koja ide pravo u UI. */
  poruka: string;
};

export type OutreachResult = OutreachOk | OutreachSkip;

/** Granice iz F7 §2. Prekoračenje nije greška izvršavanja, nego nalaz testa. */
export const GRANICE: Record<MessageChannel, { min?: number; max: number }> = {
  mejl: { min: 60, max: 90 },
  viber: { max: 50 },
  instagram: { max: 20 },
};

// ─────────────────────────────────────────────────────────────
// Kuka — konkretan problem koji nosi prvu rečenicu
// ─────────────────────────────────────────────────────────────

type Kuka = {
  /** Puna rečenica u prezentu, prvo lice. Prva rečenica mejla i Vibera. */
  izjava: string;
  /**
   * Isti problem u najkraćem obliku — za Instagram, gde cela prva poruka staje
   * u 20 reči. Nije skraćenica `izjave` nego zasebno napisana rečenica: mašinsko
   * skraćivanje srpske rečenice daje tekst koji se odmah prepozna kao mašinski.
   */
  kratko: string;
  /** Posledica po vlasnika. Samo mejl — Viber nema mesta za nju. */
  posledica: string;
  izvor: "status" | "ai" | "signal";
  /** Sajt postoji ali je loš (`popravi`) ili ga praktično nema (`napravi`). */
  ponuda: "popravi" | "napravi";
};

const STATUS_KUKE: Record<Exclude<SiteStatus, "ok">, Omit<Kuka, "izvor">> = {
  nema_sajt: {
    izjava: "Ne mogu da nađem vaš sajt, na internetu vas ima samo na Google Mapama.",
    kratko: "Ne mogu da nađem vaš sajt nigde osim na Google Mapama.",
    posledica: "Ko vas ne zna, tu ne vidi šta radite ni koliko košta, pa zove sledećeg sa spiska",
    ponuda: "napravi",
  },
  samo_drustvene: {
    izjava: "Umesto sajta nalazim samo profil na društvenoj mreži.",
    kratko: "Ne mogu da nađem vaš sajt, samo profil na mreži.",
    posledica: "Ko vas traži preko Googlea tako vas ne nađe, a sve što objavite stoji na tuđoj platformi",
    ponuda: "napravi",
  },
  mrtav: {
    izjava: "Vaš sajt se ne otvara, umesto stranice dobijam grešku.",
    kratko: "Vaš sajt se ne otvara.",
    posledica: "Svako ko klikne na link iz Google pretrage tu odustane",
    ponuda: "napravi",
  },
};

/**
 * Kopi po ključu signala.
 *
 * Nemaju svi signali svoju kuku i to je namerno: nedostatak favicona ili Open
 * Grapha nije razlog da se čoveku javiš. Signal koji nije ovde ne može da nosi
 * prvu rečenicu, a lead bez ijedne kuke se preskače (v. `nema_osnova`).
 * `{godina}` i `{sekunde}` se popunjavaju iz teksta signala.
 */
const SIGNAL_KUKE: Record<string, Omit<Kuka, "izvor" | "ponuda">> = {
  no_viewport: {
    izjava: "Vaš sajt se na telefonu ne prikazuje kako treba, tekst mora da se zumira da bi se pročitao.",
    kratko: "Vaš sajt se na telefonu mora zumirati da bi se pročitao.",
    posledica: "Većina ljudi vas danas traži baš sa telefona",
  },
  no_https: {
    izjava: "Vaš sajt nema HTTPS, pa ga Chrome posetiocu označi kao nebezbedan.",
    kratko: "Chrome vaš sajt označava kao nebezbedan.",
    posledica: "Taj natpis dosta ljudi shvati kao da je sa sajtom nešto ozbiljno pogrešno",
  },
  copyright_ancient: {
    izjava: "U dnu vašeg sajta i dalje stoji {godina}. godina.",
    kratko: "U dnu vašeg sajta i dalje stoji {godina}. godina.",
    posledica: "Ko to vidi, pretpostavi da firma više ne radi ili da se sajtom niko ne bavi",
  },
  frames: {
    izjava: "Vaš sajt je napravljen frejmovima, tehnikom koja se ne koristi već petnaestak godina.",
    kratko: "Vaš sajt je pravljen tehnikom starom petnaestak godina.",
    posledica: "Na telefonu se takva stranica praktično ne može koristiti",
  },
  flash: {
    izjava: "Na vašem sajtu ima Flash sadržaja, koji nijedan današnji pregledač više ne prikazuje.",
    kratko: "Deo vašeg sajta je u Flashu i više se ne prikazuje.",
    posledica: "Taj deo sajta posetilac vidi kao prazan prostor",
  },
  marquee: {
    izjava: "Na vašem sajtu se tekst pomera levo-desno.",
    kratko: "Na vašem sajtu se tekst pomera levo-desno.",
    posledica: "To je efekat iz devedesetih i danas ostavlja utisak zapuštenog sajta",
  },
  table_layout: {
    izjava: "Vaš sajt je složen tabelama, kako se radilo pre dvadesetak godina.",
    kratko: "Vaš sajt je složen tabelama i na telefonu se raspada.",
    posledica: "Zbog toga se na telefonu raspada i mora da se pomera levo-desno",
  },
  no_title: {
    izjava: "Vaša stranica nema naslov, pa je Google u rezultatima prikazuje bez imena.",
    kratko: "Google vašu stranicu prikazuje bez imena.",
    posledica: "U spisku rezultata to izgleda kao greška i ljudi je preskoče",
  },
  thin: {
    izjava: "Na vašem sajtu skoro da nema sadržaja, stranica je gotovo prazna.",
    kratko: "Vaša stranica je skoro prazna.",
    posledica: "Posetilac tu ne nađe ni ponudu ni razlog da vas pozove",
  },
  very_slow: {
    izjava: "Vaš sajt se otvara oko {sekunde} sekundi.",
    kratko: "Vaš sajt se otvara oko {sekunde} sekundi.",
    posledica: "Veliki deo ljudi zatvori stranicu pre nego što se učita",
  },
};

const SEVERITY_RANG: Record<AiSeverity, number> = { visoka: 3, srednja: 2, niska: 1 };

// ─────────────────────────────────────────────────────────────
// Pomoćne
// ─────────────────────────────────────────────────────────────

/**
 * Broj reči. Tokeni bez ijednog slova ili cifre se ne broje — samostalna crta u
 * „sajt — greška" nije reč, a granica od 20 reči je preuska da bi se na
 * interpunkciji gubila po dva mesta.
 */
export function brojReci(text: string): number {
  return text.trim().split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:rs|com|net|org|co\.rs|info|eu)\b/gi;

/** Viber ne sme link. Sve što liči na adresu ide van, i iz AI teksta takođe. */
function bezLinkova(text: string): string {
  return text.replace(URL_RE, "vaš sajt").replace(/\s{2,}/g, " ");
}

/** `https://autodavid.rs/kontakt` → `autodavid.rs`. Za subject i telo mejla. */
export function domen(url: string | null): string | null {
  if (!url) return null;
  const bez = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const host = bez.split(/[/?#]/)[0];
  return host && host.includes(".") ? host.toLowerCase() : null;
}

function recenica(text: string): string {
  const t = text.trim();
  return /[.?!]$/.test(t) ? t : `${t}.`;
}

/** „Dobar dan. Otvorim sajt…" — spaja rečenice bez duplih tačaka i razmaka. */
function spoji(...delovi: (string | null)[]): string {
  return delovi.filter((d): d is string => !!d && d.trim().length > 0).join(" ").replace(/\s{2,}/g, " ").trim();
}

// ─────────────────────────────────────────────────────────────
// Izbor kuke
// ─────────────────────────────────────────────────────────────

function izKuke(input: OutreachInput): Kuka | null {
  // 1. Status sajta je najjači i najkonkretniji razlog — nema sajta, mrtav domen,
  //    samo društvene. To su i najbolji leadovi na ovom tržištu (00-kontekst §1).
  if (input.siteStatus && input.siteStatus !== "ok") {
    return { ...STATUS_KUKE[input.siteStatus], izvor: "status" };
  }

  // 2. Claude analiza (F6). Uzima se `evidence`, jedino polje pisano za vlasnika
  //    sajta; `detail` je pisan za korisnika alata i u poruci strancu zvuči kao
  //    kopiran izveštaj. `evidence` fali kod zapisa od pre F6 (v. types.ts).
  const najgori = [...(input.aiIssues ?? [])]
    .filter((i) => typeof i.evidence === "string" && i.evidence.trim().length > 0)
    .sort((a, b) => SEVERITY_RANG[b.severity] - SEVERITY_RANG[a.severity])[0];

  if (najgori) {
    const nalaz = recenica(najgori.evidence);
    return {
      izjava: nalaz,
      // Model piše `evidence` kratko po definiciji (jedna rečenica o tome šta
      // vlasnik vidi), pa je isti tekst i najkraći oblik. Ako ipak ne stane u
      // Instagram granicu, `instagram()` pada na neutralno pitanje.
      kratko: nalaz,
      posledica: "To je prvo što čovek vidi kad vas nađe preko telefona",
      izvor: "ai",
      ponuda: "popravi",
    };
  }

  // 3. HTML heuristika. `points` određuje redosled, ne tekst; sortiranje je
  //    stabilno, pa zapisi kod kojih su težine nule zadržavaju redosled iz
  //    `scoreSite`, koji je već po jačini.
  // `find` po skupu ključeva pa ponovno traženje u mapi daje `T | undefined`
  // pod `noUncheckedIndexedAccess`. Ovako se šablon vadi jednom i tip ga prati.
  const jak = [...input.signals]
    .sort((a, b) => b.points - a.points)
    .map((s) => ({ signal: s, sablon: SIGNAL_KUKE[s.key] }))
    .find((k): k is { signal: Signal; sablon: Omit<Kuka, "izvor" | "ponuda"> } => !!k.sablon);

  if (jak) {
    const { signal, sablon } = jak;
    // Godina i sekunde stoje samo u tekstu signala („Copyright 2019 — nije diran
    // 7 godina"), ne kao zasebno polje. Ako ih nema, rečenica sa prazninom je
    // gora od nikakve — tada se signal preskače.
    const godina = /(\d{4})/.exec(signal.label)?.[1] ?? "";
    const sekunde = /(\d+[.,]?\d*)\s*s/.exec(signal.label)?.[1]?.replace(".", ",") ?? "";
    const nedostaje =
      (sablon.izjava.includes("{godina}") && !godina) ||
      (sablon.izjava.includes("{sekunde}") && !sekunde);

    if (!nedostaje) {
      const popuni = (t: string) => t.replace("{godina}", godina).replace("{sekunde}", sekunde);
      return {
        izjava: popuni(sablon.izjava),
        kratko: popuni(sablon.kratko),
        posledica: sablon.posledica,
        izvor: "signal",
        ponuda: "popravi",
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Delovi koji se ponavljaju kroz kanale
// ─────────────────────────────────────────────────────────────

/** „Radim sajtove za auto placeve u Kraljevu" — oba dela otpadaju ako fale oblici. */
function sta_radim(input: OutreachInput): string {
  const nisa = nisaAkuzativ(input.nicheSlug);
  const grad = gradLokativ(input.citySlug);

  if (nisa && grad) return `Radim sajtove za ${nisa} u ${grad}`;
  if (nisa) return `Radim sajtove za ${nisa}`;
  if (grad) return `Radim sajtove za male firme u ${grad}`;
  return "Radim sajtove za male firme";
}

function ponuda(kuka: Kuka): string {
  return kuka.ponuda === "napravi"
    ? "i mogu da vam napravim jednostavan sajt koji radi na telefonu"
    : "i to je posao od nekoliko dana";
}

/**
 * Prag ispod koga se ocena ne pominje.
 *
 * 4,5 sa dvadeset ocena je stvarna reputacija i vredi je pomenuti. Ista ocena sa
 * tri ocene je slučajnost, a pominjanje slabe ocene („imate 3,2") je uvreda
 * upakovana u ponudu. Ako ne prolazi prag, rečenica jednostavno ne postoji —
 * ćutanje je bolje od natezanja.
 */
const OCENA_PRAG = 4.5;
const OCENA_MIN_BROJ = 20;

/** 1 ocena · 2 ocene · 5 ocena. */
function ocena(n: number): string {
  const d1 = n % 10;
  const d2 = n % 100;
  if (d1 === 1 && d2 !== 11) return "ocenom";
  if (d1 >= 2 && d1 <= 4 && !(d2 >= 12 && d2 <= 14)) return "ocene";
  return "ocena";
}

type Dokaz = { dug: string; kratak: string };

/**
 * Rečenica o njihovoj reputaciji, ili `null`.
 *
 * `dug` menja `posledicu` u mejlu, ne dodaje se na nju: obe odgovaraju na isto
 * pitanje („zašto me ovo košta"), a mejl ima 90 reči i nema mesta za oba
 * odgovora. Konkretan uvek pobeđuje opšti.
 */
function dokazOReputaciji(input: OutreachInput, kuka: Kuka): Dokaz | null {
  const { rating, reviewCount } = input;

  // `typeof`, a ne `=== null`: polje stiže iz `jsonb`-a i iz starijih zapisa u
  // kojima ga jednostavno nema, pa je `undefined` jednako stvarno stanje kao
  // `null`. Isti razlog zbog kog `AiIssue.evidence` mora da izdrži `undefined`.
  if (typeof rating !== "number" || typeof reviewCount !== "number") return null;
  if (rating < OCENA_PRAG || reviewCount < OCENA_MIN_BROJ) return null;

  const broj = rating.toFixed(1).replace(".", ",");

  // Bez „na Google Mapama" — kuka za firmu bez sajta tu frazu već nosi, pa se u
  // Viberu, gde nema mesta ni za šta suvišno, pojavljivala dvaput u dve rečenice.
  const kratak = `Imate ${broj} sa ${reviewCount} ${ocena(reviewCount)}.`;

  // Kratko je ovde uslov opstanka, ne stil: `dug` menja `posledicu`, a mejl ima
  // 90 reči. Prva verzija je imala 21 reč i mejl je zbog nje prelazio granicu —
  // pa je lestvica popuštanja izbacivala baš ovu rečenicu, jedinu koja je o njima.
  const dug =
    kuka.ponuda === "napravi"
      ? `Imate ${broj} sa ${reviewCount} ${ocena(reviewCount)}, a onaj ko to pročita nema gde dalje da ode.`
      : `Imate ${broj} sa ${reviewCount} ${ocena(reviewCount)}, a sajt to ne prati.`;

  return { dug, kratak };
}

/** Poslednja rečenica u svakom kanalu. Ona podiže stopu odgovora (F7 §2). */
const BEZ_PRITISKA = "Ako vas ne zanima, slobodno ignorišite ovu poruku.";

const CTA = "Ako vam ovo ima smisla, javite se pa da vidimo šta vam treba.";

/**
 * ZZPL: vlasnik ima pravo da zna odakle mu kontakt i kako da ga skine. Rečenica
 * je namerno kratka — sa 90 reči ukupno, pravni rep koji uzme trećinu poruke
 * pojede upravo onaj deo u kome piše šta se čoveku nudi.
 */
const OPT_OUT =
  "Vaš kontakt je javan na Google Mapama; ako ne želite poruke od mene, odgovorite sa „ne“ i brišem ga.";

/**
 * Instagram poruka koja ne stane u 20 reči zameni se ovim pitanjem.
 *
 * Ne skraćuje se konkretan nalaz — polovina rečenice o problemu je gora od
 * poštenog opšteg pitanja, a granica od 20 reči nije preporuka: duga prva
 * poruka na Instagramu ide u zahteve i tamo umire (F7 §2).
 */
const IG_REZERVA = "Dobar dan. Da li ste skoro gledali kako vam sajt izgleda na telefonu?";

/**
 * Zabrana velikih slova cilja vikanje, ne skraćenice. „HTTPS" i „PVC" su deo
 * normalne rečenice na ovom tržištu — provera koja i njih prijavljuje javlja
 * grešku na svakoj drugoj poruci i posle nedelju dana se prestane čitati.
 */
const SKRACENICE = new Set(["HTTPS", "HTTP", "PVC", "SEO", "HTML", "CSS", "DM", "PDF", "ALU"]);

// ─────────────────────────────────────────────────────────────
// Kanali
// ─────────────────────────────────────────────────────────────

function mejl(input: OutreachInput, kuka: Kuka): Poruka {
  const d = domen(input.websiteUrl);

  // Subject nosi činjenicu, ne obećanje. Sa domenom kad ga ima — vlasnik svoj
  // domen prepoznaje u spisku i to je jedina „personalizacija" koja nešto znači.
  const subject =
    kuka.izvor === "status" && input.siteStatus === "nema_sajt"
      ? `${input.name} — na Google Mapama vas ima, sajta nema`
      : d
        ? `Nešto ne valja sa ${d}`
        : `Nešto ne valja sa sajtom — ${input.name}`;

  // Mejl je jedini kanal u kome domen sme da stoji, i jedina „personalizacija"
  // koja nešto znači: vlasnik svoj domen prepoznaje. Kad ga rečenica već pominje
  // opisno („Vaš sajt…"), domen ide na to mesto; kad ga ne pominje — a to je
  // slučaj sa nalazom iz analize — dodaje se kratak uvod ispred.
  const uvod = d
    ? kuka.izjava.includes("Vaš sajt")
      ? kuka.izjava.replace("Vaš sajt", d)
      : spoji(`Javljam se zbog sajta ${d}.`, kuka.izjava)
    : kuka.izjava;

  const sastavi = (prvi: string) =>
    [
      "Poštovani,",
      "",
      prvi,
      "",
      spoji(`${sta_radim(input)} ${ponuda(kuka)}.`, CTA),
      "",
      `${OPT_OUT} ${BEZ_PRITISKA}`,
      input.senderName ? `\n${input.senderName}` : null,
    ]
      .filter((r): r is string => r !== null)
      .join("\n")
      .trim();

  // Konkretan dokaz gura opštu posledicu iz poruke, ne staje pored nje.
  const dokaz = dokazOReputaciji(input, kuka);
  const drugaRecenica = dokaz ? dokaz.dug : kuka.posledica;

  const pun = sastavi(spoji(recenica(uvod), recenica(drugaRecenica)));

  // Duga niša i dug grad („agencije za nekretnine u Beogradu") umeju da prebace
  // 90 reči. Otpada posledica: nalaz je razlog zbog kog čovek čita, ponuda je
  // razlog zbog kog odgovara, a posledica je jedino objašnjenje — bez nje mejl i
  // dalje stoji. Skraćivanje ostane iznad donje granice od 60 reči.
  const body = brojReci(pun) <= GRANICE.mejl.max ? pun : sastavi(recenica(uvod));

  return { channel: "mejl", subject, body, words: brojReci(body) };
}

function viber(input: OutreachInput, kuka: Kuka): Poruka {
  // Bez linka i bez domena: link od nepoznatog broja se u Viberu ne otvara i
  // podiže sumnju (F7 §2). Zato ovde ni `posledica` ne staje — 50 reči je 50 reči.
  const predstavljanje = input.senderName ? `Dobar dan, zovem se ${input.senderName}.` : "Dobar dan.";

  const dokaz = dokazOReputaciji(input, kuka);

  const sastavi = (problem: string, sta: string, sOcenom: boolean) =>
    spoji(
      predstavljanje,
      bezLinkova(recenica(problem)),
      sOcenom ? (dokaz?.kratak ?? null) : null,
      `${sta} ${ponuda(kuka)}.`,
      BEZ_PRITISKA,
    );

  // Lestvica popuštanja, od najvrednijeg ka najmanje vrednom. Ocena je ispred
  // niše i grada: „imate 4,8 sa 157 ocena" je o njima, „u Kruševcu" je o mapi.
  const varijante = [
    sastavi(kuka.izjava, sta_radim(input), true),
    sastavi(kuka.kratko, sta_radim(input), true),
    sastavi(kuka.kratko, "Radim sajtove", true),
    sastavi(kuka.izjava, sta_radim(input), false),
    sastavi(kuka.kratko, "Radim sajtove", false),
  ];

  const body =
    varijante.find((v) => brojReci(v) <= GRANICE.viber.max) ?? varijante[varijante.length - 1]!;

  return { channel: "viber", body, words: brojReci(body) };
}

function instagram(input: OutreachInput, kuka: Kuka): Poruka {
  // Prva poruka: bez ponude, bez linka, kratko, i završava pitanjem — poruka od
  // nepoznatog naloga ide u zahteve, a odgovor je jedino što je odatle izvlači.
  const pun = spoji("Dobar dan.", bezLinkova(recenica(kuka.kratko)), "Da li ste za to znali?");
  const body = brojReci(pun) <= GRANICE.instagram.max ? pun : IG_REZERVA;

  // Ponuda i rečenica koja skida pritisak žive ovde, u drugoj poruci — u prvoj
  // ponuda ubija odgovor, a rečenica bez ponude nema šta da relativizuje.
  const followUp = spoji(`${sta_radim(input)} ${ponuda(kuka)}.`, CTA, BEZ_PRITISKA);

  return { channel: "instagram", body, followUp, words: brojReci(body) };
}

// ─────────────────────────────────────────────────────────────
// Ulaz
// ─────────────────────────────────────────────────────────────

function predlogKanala(phoneType: PhoneKind | null): ContactChannel {
  if (phoneType === "mobilni") return "viber";
  if (phoneType === "fiksni" || phoneType === "besplatni") return "poziv";
  return "mejl";
}

/**
 * Tri poruke za jedan otključan lead, ili obrazložen odbijen zahtev.
 *
 * Odbija u dva slučaja, oba namerna:
 * — `solidan`: model je sajt proglasio urednim (F6). Poruka bi morala da izmisli
 *   problem, a izmišljen problem je jedina stvar koja outreach ubija odmah.
 * — `nema_osnova`: nema nijednog konkretnog nalaza koji nosi prvu rečenicu.
 *   Alat koji u toj situaciji ipak nešto napiše, napisao je opšte obećanje.
 */
export function napisiPoruke(input: OutreachInput): OutreachResult {
  if (input.aiSolidan === true) {
    return {
      ok: false,
      razlog: "solidan",
      poruka:
        "Sajt je proveren i uredan je. Poruka bi morala da izmisli problem — preskoči ovaj prospekt.",
    };
  }

  const kuka = izKuke(input);
  if (!kuka) {
    return {
      ok: false,
      razlog: "nema_osnova",
      poruka:
        "Na ovom sajtu nema nalaza koji je dovoljno konkretan za prvu rečenicu. Otključaj analizu ili preskoči prospekt.",
    };
  }

  return {
    ok: true,
    izvor: kuka.izvor,
    predlog: predlogKanala(input.phoneType),
    poruke: {
      mejl: mejl(input, kuka),
      viber: viber(input, kuka),
      instagram: instagram(input, kuka),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// AI varijanta — sastavljanje
// ─────────────────────────────────────────────────────────────

/**
 * Koliko reči zauzima fiksni završetak poruke po kanalu.
 *
 * Model piše samo promenljivi deo; ovo je ostatak budžeta koji mu se u promptu
 * saopštava kao granica. Računa se, a ne prepisuje ručno — inače se razilazi sa
 * tekstom `OPT_OUT`-a prvi put kad se taj tekst skrati.
 */
export function repZauzima(kanal: MessageChannel): number {
  if (kanal === "mejl") return brojReci(OPT_OUT) + brojReci(BEZ_PRITISKA) + 1;
  if (kanal === "viber") return brojReci(BEZ_PRITISKA);
  return 0;
}

/**
 * Sastavi AI varijantu od tela koje je napisao model.
 *
 * ── zašto model NE piše završne rečenice ──────────────────
 * Prva verzija je od modela tražila da doslovno reprodukuje „Ako vas ne zanima,
 * slobodno ignorišite ovu poruku." i pravnu rečenicu o poreklu kontakta. Model
 * ih je svaki put malo preformulisao — i `proveriPoruku` je odbacivala izlaz.
 * Rezultat: tri plaćena poziva ka Anthropicu, tri puta upisan šablon, i dugme
 * koje korisniku izgleda pokvareno.
 *
 * Rečenice koje MORAJU da glase tačno ovako ne traže se od modela, nego se
 * dodaju ovde. Model dobija posao u kome ne može da pogreši, a poruka dobija
 * pravnu i taktičku obavezu koja ne zavisi od raspoloženja modela.
 *
 * Instagram nema šta da se doda: rečenica koja skida pritisak tamo živi u drugoj
 * poruci, a nju model ne piše.
 */
export function sastaviVarijantu(
  kanal: MessageChannel,
  telo: string,
  potpis: string | null,
  original: Poruka,
): Poruka {
  const t = telo.trim();

  const body =
    kanal === "mejl"
      ? [t, "", `${OPT_OUT} ${BEZ_PRITISKA}`, potpis ? `\n${potpis}` : null]
          .filter((r): r is string => r !== null)
          .join("\n")
          .trim()
      : kanal === "viber"
        ? spoji(recenica(t), BEZ_PRITISKA)
        : t;

  return {
    channel: kanal,
    subject: kanal === "mejl" ? (original.subject ?? undefined) : undefined,
    body,
    // Druga Instagram poruka se ne prepisuje — model piše samo prvu.
    followUp: original.followUp,
    words: brojReci(body),
  };
}

// ─────────────────────────────────────────────────────────────
// Provera
// ─────────────────────────────────────────────────────────────

/**
 * Pravila kopija iz F7 §2, kao provera nad gotovim tekstom.
 *
 * Šabloni ovo prolaze po konstrukciji. Postoji zbog AI varijante („Napiši
 * drugačije"): Claude izlaz prolazi kroz istu kapiju kao i šablon, pa model ne
 * može da uvede emodži, uzvičnik ni link u Viber poruku.
 */
export function proveriPoruku(p: Poruka): string[] {
  const greske: string[] = [];
  const granica = GRANICE[p.channel];
  // Ceo tekst koji korisnik zaista šalje: na Instagramu su to obe poruke, jer
  // rečenica koja skida pritisak stoji u drugoj.
  const ceo = `${p.body}\n${p.followUp ?? ""}`;

  if (p.words > granica.max) greske.push(`predugačko: ${p.words} reči, granica je ${granica.max}`);
  if (granica.min && p.words < granica.min) greske.push(`prekratko: ${p.words} reči, minimum je ${granica.min}`);

  // Rodno obeležen perfekat u prvom licu: „probao sam", „tražila sam".
  //
  // Šabloni ovo ne mogu da prekrše — pisani su u prezentu. Provera postoji zbog
  // modela, koji je uprkos izričitom pravilu u promptu napisao „Probao sam da
  // pronađem vaš sajt". Pravilo bez kapije je molba, a ovde greši u rodu
  // korisnika pred strancem kome se prvi put javlja.
  const perfekat =
    /\b\p{L}+(?:ao|io|ala|ila|ela|la)\s+sam\b/iu.exec(ceo) ??
    /\bsam\s+\p{L}+(?:ao|io|ala|ila|ela|la)\b/iu.exec(ceo);
  if (perfekat) greske.push(`rodno obeležen perfekat: „${perfekat[0].trim()}“`);

  if (/\p{Extended_Pictographic}/u.test(ceo)) greske.push("sadrži emodži");
  if (ceo.includes("!")) greske.push("sadrži uzvičnik");
  const vika = [...ceo.matchAll(/\b[A-ZČĆŠĐŽ]{2,}\b/gu)]
    .map((m) => m[0])
    .filter((r) => !SKRACENICE.has(r));
  if (vika.length) greske.push(`sadrži reč velikim slovima: ${[...new Set(vika)].join(", ")}`);
  // `URL_RE` je globalan i `test` nad njim pamti poziciju — nad kopijom bez `g`
  // provera je bez stanja i ne zavisi od toga ko ga je pozvao pre nas.
  if (p.channel === "viber" && new RegExp(URL_RE.source, "i").test(ceo)) {
    greske.push("Viber poruka sadrži link");
  }
  if (!ceo.includes(BEZ_PRITISKA)) greske.push("nema rečenicu koja skida pritisak");

  return greske;
}
