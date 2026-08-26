// apps/web/src/lib/admin-radnje-schema.ts
// Ugovor tela za rute pod `/api/admin/korisnici/[id]/*` (F12 §4).
//
// Odvojeno od ruta iz istog razloga kao `pipeline-schema.ts` i
// `feedback-schema.ts`: šema se proverava bez podizanja Next-a, a ruta ostaje
// tanka.
//
// ── čega ovde NEMA i ne sme da bude ──────────────────────────
// `actor`, `userId`, `role` aktera, `balance`. Akter je uvek
// `requireAdminRoute()`, a cilj je uvek segment putanje (§4: „Nijedna admin ruta
// ne uzima identitet aktera iz tela"). Telo nosi isključivo ono što admin
// STVARNO kuca u obrazac.
//
// Bez `import "server-only"`: tip odgovora uvozi i klijentska komponenta sa
// radnjama.

import { z } from "zod";
import { BETA_DEFAULT_DAYS, DEFAULT_PLAN, PLANS } from "@sajtoskop/shared";

/**
 * Ono što vraća svaka uspela mutacija: rečenica, i skoro nikad ništa više —
 * klijent osvežava stranu.
 *
 * `podaci` postoji zbog dve stvari iz §3.3 koje se prikazuju TAČNO JEDNOM i
 * nigde se ne upisuju: generisane lozinke i linka iz pozivnice. One ne mogu
 * kroz osvežavanje strane, jer ih posle odgovora više nema nigde.
 */
export type RadnjaOdgovor = {
  ok: true;
  /** Jedna rečenica koja se prikazuje pored obrasca. Već na srpskom. */
  poruka: string;
  podaci?: { lozinka?: string; link?: string; email?: string };
};

/**
 * Korekcija kredita.
 *
 * `refId` generiše SERVER pri otvaranju forme i klijent ga vraća netaknutog
 * (F12 §2). Oblik je `adm:<uuid>` i proverava se ovde, a ne samo u RPC-u: klijent
 * koji pošalje `scan:12` bi inače upisao stavku u knjigu sa tuđim prostorom
 * imena, i idempotencija dve različite radnje bi se sudarila.
 *
 * Granica ±500 stoji i u RPC-u. Ovde je zbog poruke: „iznos van granica" iz baze
 * je tačan, ali stiže tek posle punog kruga kroz Postgres.
 */
export const kreditiBodySchema = z.strictObject({
  delta: z
    .number()
    .int({ error: "Iznos mora da bude ceo broj." })
    .refine((v) => v !== 0, { error: "Iznos 0 ne menja ništa." })
    .refine((v) => Math.abs(v) <= 500, { error: "Iznos je van granica (najviše 500)." }),
  // Beleška je obavezna (§3.2). Korekcija bez razloga je red u knjizi na koji za
  // mesec dana niko ne ume da odgovori — a ceo dnevnik postoji zbog tog pitanja.
  napomena: z
    .string()
    .trim()
    .min(3, { error: "Beleška je obavezna — upiši zašto." })
    .max(200, { error: "Beleška je duža od 200 karaktera." }),
  refId: z
    .string()
    .regex(/^adm:[0-9a-f-]{36}$/, { error: "Ključ forme nije ispravan. Osveži stranu." }),
});

/**
 * Plan. Vrednost mora da postoji u `PLANS` — plan koji ne postoji u kodu je plan
 * po kome `planFor()` tiho pada na podrazumevani, pa bi konzola tvrdila jedno a
 * proizvod radio drugo.
 *
 * ‼️ `beta` je IZBAČEN iz spiska, i to je odluka D1 (LANSIRANJE §1.1), a ne
 *    previd. Beta nalog nije plan nego tri stvari odjednom — plan, rok i krediti
 *    — pa ide isključivo kroz „Otvori beta nalog" (`POST .../beta`), gde se sve
 *    tri upisuju u jednoj transakciji. Padajući spisak koji nudi `beta` bi
 *    dozvolio pola otvorenog naloga: plan bez roka, dakle NEOGRANIČENU betu.
 *
 * Ovo je prvi od tri sloja; drugi je provera u `promeniPlan()`, treći je triger
 * u bazi (0024) koji drži i kad se aplikacija zaobiđe.
 */
export const PLAN_OPCIJE: string[] = Object.keys(PLANS).filter((p) => p !== "beta");

export const planBodySchema = z.strictObject({
  plan: z.enum(PLAN_OPCIJE as [string, ...string[]], {
    error: `Nepoznat plan. Dozvoljeni su: ${PLAN_OPCIJE.join(", ")}. Beta ide kroz „Otvori beta nalog".`,
  }),
});

export const PODRAZUMEVANI_PLAN: string = DEFAULT_PLAN;

/**
 * Rok bete, u oba obrasca: `null` je NEOGRANIČENO (LANSIRANJE §1.5).
 *
 * `null` je vrednost koja se šalje, ne izostavljeno polje — zato `.nullable()`, a
 * ne `.optional()`. Razlika je stvarna: `{}` bi značilo „ne diraj rok", a to
 * nijedan od dva obrasca ne nudi i ne sme tiho da postane neograničena beta.
 *
 * Rok u PROŠLOSTI je dozvoljen i namerno se ne proverava — tako se beta gasi
 * rukom (§1.5). Potvrdu za taj slučaj traži UI, jer je to jedino mesto gde se
 * zna da li je datum omaška ili odluka.
 *
 * Gornja granica postoji zbog omaške u godini: `2226` umesto `2026` je u praksi
 * neograničena beta upisana kao datum, dakle tačno ono što se ovde sprečava.
 */
const MAX_GODINA_UNAPRED = 5;

const betaRok = z
  .iso
  .datetime({ error: "Rok mora da bude ISO datum, ili `null` za neograničeno." })
  .refine(
    (v) => Date.parse(v) < Date.now() + MAX_GODINA_UNAPRED * 365 * 24 * 60 * 60 * 1000,
    { error: `Rok je više od ${MAX_GODINA_UNAPRED} godina unapred — ako je to namera, izaberi „neograničeno".` },
  )
  .nullable();

/** `PATCH /api/admin/korisnici/[id]/beta` — samo rok. */
export const betaRokBodySchema = z.strictObject({ do: betaRok });

/**
 * `POST /api/admin/korisnici/[id]/beta` — „Otvori beta nalog".
 *
 * Tri polja jer su tri izmene, i sve tri idu u jednom pozivu (§1.1). `krediti`
 * sme da bude 0: nalog kome se beta samo produžava ne mora da dobije nov paket.
 *
 * `refId` generiše SERVER pri otvaranju forme i klijent ga vraća netaknutog —
 * isti obrazac i isti prostor imena kao kod korekcije kredita (F12 §2), jer je
 * to ista knjiga i ista idempotencija. Dvostruki klik zato ne daje dva paketa.
 */
export const betaNalogBodySchema = z.strictObject({
  do: betaRok,
  krediti: z
    .number()
    .int({ error: "Broj kredita mora da bude ceo broj." })
    .min(0, { error: "Broj kredita ne može da bude negativan." })
    .max(500, { error: "Najviše 500 kredita po radnji." }),
  refId: z
    .string()
    .regex(/^adm:[0-9a-f-]{36}$/, { error: "Ključ forme nije ispravan. Osveži stranu." }),
});

/** Predlog koji obrazac popuni: 50 kredita, rok 30 dana (odluka P6). */
export const BETA_PREDLOG = {
  krediti: PLANS.beta.monthlyCredits,
  dana: BETA_DEFAULT_DAYS,
} as const;

export const ulogaBodySchema = z.strictObject({
  role: z.enum(["user", "admin"], { error: "Uloga može da bude samo `user` ili `admin`." }),
});

export const blokadaBodySchema = z.strictObject({
  blokiran: z.boolean({ error: "Nedostaje `blokiran`." }),
});

/**
 * Brisanje naloga.
 *
 * `potvrda` je mejl koji admin RUČNO otkuca. Server ga poredi sa stvarnim mejlom
 * iz Clerka (§5) — dakle poređenje je serversko i klijent ne može da ga preskoči
 * praznim poljem. Ovde je samo granica dužine i oblik, jer greška „nije mejl" ne
 * treba da čeka pun krug kroz Clerk.
 */
export const brisanjeBodySchema = z.strictObject({
  potvrda: z.string().trim().min(3).max(320),
});

/**
 * Pozivanje u betu (F12 §3.3).
 *
 * `nacin` je jedno polje sa dve vrednosti, a ne `otvoriOdmah: boolean`: dve
 * radnje koje se razlikuju po tome ko postavlja lozinku ne smeju da se
 * razlikuju po jednom `true`. Podrazumevana je pozivnica.
 *
 * Poruka je opciona i ide u mejl. Nije `Reply-To`, nije zaglavlje i nema je u
 * subjectu — dakle mesto na kom prelom reda ne znači ništa; svejedno ima gornju
 * granicu, jer mejl nije skladište.
 */
export const pozivnicaBodySchema = z.strictObject({
  email: z
    .email({ error: "Mejl adresa nije ispravnog oblika." })
    .max(254, { error: "Mejl adresa je predugačka." })
    .transform((v) => v.trim().toLowerCase()),
  poruka: z
    .string()
    .trim()
    .max(1000, { error: "Poruka je duža od 1000 karaktera." })
    .optional()
    .transform((v) => (v ? v : null)),
  nacin: z.enum(["pozivnica", "nalog"], {
    error: "Način može da bude samo `pozivnica` ili `nalog`.",
  }),
});

/** Opoziv pozivnice. `id` je Clerkov (`inv_…`), ne naš. */
export const opozivBodySchema = z.strictObject({
  id: z.string().trim().min(3).max(120),
});

/**
 * Pojedinačna poruka korisniku (F12 §3.2).
 *
 * Naslov ide u `Subject`, dakle u zaglavlje mejla — zato prelom reda ovde nije
 * dozvoljen. `lib/mail.ts` ga svejedno seče, iz istog razloga iz kog je i ovde
 * zabranjen: jedna provera koja se zaobiđe je nijedna provera.
 */
export const porukaBodySchema = z.strictObject({
  naslov: z
    .string()
    .trim()
    .min(3, { error: "Naslov je obavezan." })
    .max(120, { error: "Naslov je duži od 120 karaktera." })
    .refine((v) => !/[\r\n]/.test(v), { error: "Naslov ne sme da sadrži prelom reda." }),
  poruka: z
    .string()
    .trim()
    .min(10, { error: "Poruka je prekratka — napiši bar rečenicu." })
    .max(4000, { error: "Poruka je duža od 4000 karaktera." }),
});

export type BetaRokBody = z.infer<typeof betaRokBodySchema>;
export type BetaNalogBody = z.infer<typeof betaNalogBodySchema>;
export type KreditiBody = z.infer<typeof kreditiBodySchema>;
export type PozivnicaBody = z.infer<typeof pozivnicaBodySchema>;
export type OpozivBody = z.infer<typeof opozivBodySchema>;
export type PorukaBody = z.infer<typeof porukaBodySchema>;
export type PlanBody = z.infer<typeof planBodySchema>;
export type UlogaBody = z.infer<typeof ulogaBodySchema>;
export type BlokadaBody = z.infer<typeof blokadaBodySchema>;
export type BrisanjeBody = z.infer<typeof brisanjeBodySchema>;

/**
 * Stavka Beta dnevnika (F11.4 §6.5) — telo za `POST /api/admin/dnevnik` i
 * `PATCH /api/admin/dnevnik/[id]`.
 *
 * Ime je `stavkaBodySchema`, ne `dnevnikBodySchema`: to ime već nosi šema za
 * VEZIVANJE prijave sa stavkom (`admin-utisci-schema.ts`), a dve šeme istog
 * imena u dva fajla bi se lako pomešale pri uvozu.
 *
 * `from_feedback` se ovde NE menja: veza prijave sa stavkom ide kroz
 * „poveži sa stavkom" u `/admin/utisci` — jedan izvor za jednu vrstu veze.
 */
export const stavkaBodySchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(3, { error: "Naslov je prekratak." })
    .max(120, { error: "Naslov je duži od 120 karaktera." }),
  kind: z.enum(["novo", "promena", "popravka"], { error: "Nepoznat tip stavke." }),
  body: z
    .string()
    .trim()
    .max(2000, { error: "Tekst je duži od 2000 karaktera." })
    .optional()
    .transform((v) => (v ? v : null)),
  published: z.boolean({ error: "Nedostaje `published`." }).default(true),
});

export type StavkaBody = z.infer<typeof stavkaBodySchema>;

/**
 * Ključ idempotencije za korekciju kredita.
 *
 * Zove ga SERVERSKA komponenta pri renderu detalja korisnika, dakle pri
 * OTVARANJU forme (F12 §2). Zato dvostruki klik na „Dodaj 30 kredita" nosi isti
 * ključ i drugi poziv izlazi kao `already_applied` — a ne kao drugih 30 kredita.
 *
 * Generisanje pri slanju bi svaki klik učinilo novom radnjom, i cela zaštita bi
 * bila `disabled` atribut na dugmetu, dakle ništa.
 */
export function noviRefId(): string {
  return `adm:${crypto.randomUUID()}`;
}
