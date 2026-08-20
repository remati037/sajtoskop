// apps/web/src/lib/paddle-okruzenje.ts
// Podešavanje Paddle.js-a, čitano iz env-a i provereno Zodom (CLAUDE.md: „Zod 4
// za sve granice ... env").
//
// Ovaj fajl NEMA `server-only` i to je namerno — jedini je modul u `lib/` koji
// se uvozi iz „use client" komponente. Sme, jer dodiruje isključivo
// `NEXT_PUBLIC_*` vrednosti: token je klijentski po definiciji (Paddle ga zove
// „client-side token", vidljiv je u svakom `view-source`). Serverski Paddle
// ključ (`pdl_sdbx_…` / `pdl_live_…`) ovde NE SME da se pojavi nikad.
//
// Vrednosti se čitaju doslovno, ne kroz `process.env[ime]`: Next ubacuje
// `NEXT_PUBLIC_*` u klijentski bundle zamenom teksta pri build-u, pa dinamički
// ključ ostane `undefined` u pregledaču iako u terminalu radi.

import { z } from "zod";

/** Paddle poznaje tačno dva okruženja. Nema trećeg i nema podrazumevanog. */
export const PADDLE_OKRUZENJA = ["sandbox", "production"] as const;
export type PaddleOkruzenje = (typeof PADDLE_OKRUZENJA)[number];

const sema = z.object({
  // `test_` je sandbox token, `live_` je produkcioni. Prefiks je jedino što ih
  // razlikuje golim okom, pa se proverava — pogrešno nalepljen ključ inače pukne
  // tek u pregledaču, kao „Paddle: invalid token" bez ijedne druge reči.
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: z
    .string()
    .regex(/^(test|live)_/, { message: "mora počinjati sa test_ (sandbox) ili live_ (produkcija)" }),
  NEXT_PUBLIC_PADDLE_ENV: z.enum(PADDLE_OKRUZENJA, {
    message: "mora biti tačno `sandbox` ili `production`",
  }),
});

export type PaddleKonfig = { token: string; okruzenje: PaddleOkruzenje };

/**
 * Konfiguracija za `initializePaddle()`, ili baciti sa razlogom.
 *
 * Baca namerno, i nikad ne pada na podrazumevanu vrednost. Tiho `?? "sandbox"`
 * znači da zaboravljena promenljiva na Vercelu otvara checkout ka POGREŠNOM
 * Paddle nalogu, a to se ne primeti dok neko ne plati — u sandboxu novac ne
 * stiže, u produkciji stiže sa testnog naloga. Bolje je da ekran cena kaže
 * „nije podešeno" nego da dugme radi u pogrešnu kasu.
 *
 * Poziva se iz `useEffect`-a, ne na vrhu modula: izuzetak pri uvozu sruši celu
 * stranu, a ovako ga komponenta uhvati i ispiše kao poruku.
 */
export function paddleKonfig(): PaddleKonfig {
  const parsed = sema.safeParse({
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
    NEXT_PUBLIC_PADDLE_ENV: process.env.NEXT_PUBLIC_PADDLE_ENV,
  });

  if (!parsed.success) {
    const redovi = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Paddle nije podešen:\n${redovi}`);
  }

  const token = parsed.data.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const okruzenje = parsed.data.NEXT_PUBLIC_PADDLE_ENV;

  // Ukrštena provera koju šema po polju ne može da uhvati. Ovo je tačno onaj
  // kvar zbog koga okruženje uopšte i čitamo iz env-a: `test_` token uz
  // `production` (ili obrnuto) je nesparen par u kome checkout ne pada nego se
  // otvori ka drugom nalogu, sa cenama kojih tamo nema.
  const ocekivaniPrefiks = okruzenje === "sandbox" ? "test_" : "live_";
  if (!token.startsWith(ocekivaniPrefiks)) {
    throw new Error(
      `Paddle token i okruženje se ne poklapaju: NEXT_PUBLIC_PADDLE_ENV je ` +
        `\`${okruzenje}\`, a token počinje sa \`${token.slice(0, 5)}\` ` +
        `(očekivano \`${ocekivaniPrefiks}\`).`,
    );
  }

  return { token, okruzenje };
}
