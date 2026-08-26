// apps/web/src/lib/env.ts
// Serverski env, validiran Zodom na prvom čitanju — ne na import-u.
//
// Zašto lenjo: `next build` u CI-u nema prave tajne, a build MORA da prođe da bi
// se odradila grep provera iz P0-4. Validacija na import-u bi srušila build i
// tiho preskočila baš tu proveru.

import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "mora biti pun URL, npr. https://xxx.supabase.co" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  // [Faza 1, 1.4] Format se proverava da tipfeler padne ODMAH sa jasnom
  // porukom, a ne kasnije kroz nerazumljivu Clerk grešku (S4 iz revizije).
  // `NEXT_PUBLIC_*` je javan ključ — bezbedan je i u serverskoj šemi.
  CLERK_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_/, { message: "mora počinjati sa sk_test_ ili sk_live_" }),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_(test|live)_/, { message: "mora počinjati sa pk_test_ ili pk_live_" }),
});

const webhookSchema = z.object({
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),
});

/** F10: mejl sa utiskom. Odvojeno iz istog razloga kao webhook tajna. */
const feedbackMailSchema = z.object({
  RESEND_API_KEY: z.string().min(1),
  FEEDBACK_EMAIL_TO: z.email({ message: "mora biti mejl adresa" }),
  // 'Sajtoskop <feedback@sajtoskop.com>' — dakle ne gola adresa.
  FEEDBACK_EMAIL_FROM: z.string().min(3),
});

/**
 * F12: rezervni spisak admina. Odvojeno iz istog razloga kao webhook tajna —
 * aplikacija mora da se podigne i bez njega.
 *
 * Prazna vrednost NIJE greška: tada admini postoje samo u bazi, a ako ih nema
 * nijednog, `/admin` je `404` za sve (F12 §6). To je uredno stanje, ne kvar.
 */
const adminBootstrapSchema = z.object({
  ADMIN_BOOTSTRAP_IDS: z.string().optional(),
});

/**
 * F11.3: tajna kojom se predstavljaju cron rute.
 *
 * Odvojeno iz istog razloga kao webhook tajna, ali sa suprotnim ponašanjem na
 * nedostatak: `webhookSecret()` baca, a ovo vraća `null`. Razlog je što ruta bez
 * tajne ne sme ni da se izvrši ni da vikne — nepodešen `CRON_SECRET` u razvoju
 * je uredno stanje, a odgovor je isti kao i za pogrešnu tajnu (v. `lib/cron.ts`).
 *
 * Minimum od 16 znakova nije ukras: tajna od četiri slova je tajna koja se
 * pogodi, a jedina prepreka ispred rute koja šalje mejlove je baš ona.
 */
const cronSchema = z.object({
  CRON_SECRET: z.string().min(16),
});

/**
 * S18: serverski Paddle ključevi. Obe promenljive su u ISTOJ šemi i obe BACAJU
 * kad fale — po uzoru na `webhookSecret()`, ne na `cronSecret()`.
 *
 * ── zašto baca, a ne pada na `null` ─────────────────────────
 * Cron bez tajne ne uradi ništa i to je uredno stanje. Webhook bez tajne je
 * suprotno: to je javan POST endpoint koji dodeljuje kredite. Ruta koja bi
 * „preskočila proveru jer tajne nema" bila bi poklon svakome ko pogodi URL, pa
 * radije odbija da radi. Isto važi za API ključ: bez njega checkout ne može da
 * upiše `custom_data.user_id`, a kupovina bez tog podatka je novac koji je
 * stigao i ne zna se čiji je.
 *
 * ── zašto zajedno, iako ih koriste dve različite rute ───────
 * Naplata je jedna funkcija. Podešena polovično znači ili checkout koji vodi u
 * plaćanje koje niko neće obraditi, ili webhook koji čeka kupovinu koja ne može
 * da nastane. Bolje je da obe rute stanu odmah nego da jedna radi u prazno.
 *
 * Prefiksi se proveravaju iz istog razloga kao kod Clerk ključeva: pogrešno
 * nalepljen ključ inače pukne tek u Paddle-ovom odgovoru, kao `403` bez ijedne
 * druge reči. Ukrštena provera sa `NEXT_PUBLIC_PADDLE_ENV` NIJE ovde nego u
 * `lib/paddle-server.ts` — ovaj fajl ne zna za klijentsko okruženje.
 */
const paddleServerSchema = z.object({
  PADDLE_API_KEY: z
    .string()
    .regex(/^pdl_(sdbx|live)_/, {
      message: "mora počinjati sa pdl_sdbx_ (sandbox) ili pdl_live_ (produkcija)",
    }),
  PADDLE_WEBHOOK_SECRET: z
    .string()
    .regex(/^pdl_ntfset_/, { message: "mora počinjati sa pdl_ntfset_" }),
});

/**
 * `PADDLE_BETA_DISCOUNT_ID` je NAMERNO van šeme iznad i NAMERNO ne baca.
 *
 * Bez njega se popust za betu prosto ne primenjuje sam — a kod `BETA2026` i
 * dalje može ručno da se ukuca u checkout-u, jer je u Paddle-u podešen sa
 * `enabled_for_checkout: true`. Dva puta do istog popusta; nedostatak jednog
 * nije kvar naplate i ne sme da je obori.
 */
const paddleDiscountSchema = z.object({
  PADDLE_BETA_DISCOUNT_ID: z.string().regex(/^dsc_/).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

function fail(err: z.ZodError): never {
  const lines = err.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Nedostaju ili su neispravne env promenljive:\n${lines}`);
}

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) fail(parsed.error);
  cached = parsed.data;
  return cached;
}

/**
 * Odvojeno od `serverEnv()` jer je potrebno samo webhook ruti. Da je u istoj
 * šemi, cela aplikacija bi zahtevala webhook tajnu da bi se podigla lokalno.
 */
export function webhookSecret(): string {
  const parsed = webhookSchema.safeParse(process.env);
  if (!parsed.success) fail(parsed.error);
  return parsed.data.CLERK_WEBHOOK_SIGNING_SECRET;
}

/**
 * Clerk ID-jevi koji su admini bez obzira na bazu (F12 odluka 1).
 *
 * Rešava dva problema odjednom: prvog admina (nema ga ko postavi) i
 * zaključavanje (degradirao sam sam sebe u 2 ujutru). Zato se čita iz env-a, a
 * ne iz baze — spisak koji spasava od pokvarene baze ne sme da živi u njoj.
 *
 * Ne baca nikad: neispravan ili prazan env ovde znači prazan spisak, dakle
 * „admini samo iz baze". Spisak ne izlazi iz procesa i ne prikazuje se u UI-ju
 * (F12 §1).
 */
export function adminBootstrapIds(): string[] {
  const parsed = adminBootstrapSchema.safeParse(process.env);
  if (!parsed.success) return [];

  return (parsed.data.ADMIN_BOOTSTRAP_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Tajna za cron rute (F11 §8: „Cron rute odbijaju zahtev bez `CRON_SECRET`").
 *
 * `null` znači „nije podešena" — tada nijedan cron ne radi, i to je bolje od
 * crona koji radi bez ijedne prepreke. Ne baca: podizanje aplikacije ne sme da
 * zavisi od tajne koja se koristi triput dnevno.
 */
export function cronSecret(): string | null {
  const parsed = cronSchema.safeParse(process.env);
  return parsed.success ? parsed.data.CRON_SECRET : null;
}

export type FeedbackMailEnv = z.infer<typeof feedbackMailSchema>;

/**
 * Podešavanje za mejl sa utiskom (F10 §3).
 *
 * Ne baca, za razliku od `webhookSecret()`: nedostatak ključa ovde nije kvar
 * nego lokalni razvoj bez Resend naloga. Upis u `feedback` mora da prođe, mejl
 * se preskače, a razlog završi u `feedback.email_error`.
 *
 * Zato `razlog` nosi IMENA promenljivih, nikad njihove vrednosti — taj tekst ide
 * u bazu, a `RESEND_API_KEY` ne izlazi iz procesa (F10 §5).
 */
export type FeedbackMailConfig =
  | { ok: true; env: FeedbackMailEnv }
  | { ok: false; razlog: string };

export function feedbackMailEnv(): FeedbackMailConfig {
  const parsed = feedbackMailSchema.safeParse(process.env);
  if (parsed.success) return { ok: true, env: parsed.data };

  const imena = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "env")))];
  return {
    ok: false,
    razlog: `${imena.join(", ")} ${imena.length === 1 ? "nije podešen" : "nisu podešeni"}`,
  };
}

export type PaddleServerEnv = z.infer<typeof paddleServerSchema>;

/**
 * API ključ i webhook tajna, ili baciti sa razlogom (v. `paddleServerSchema`).
 *
 * Vrednosti se ne keširaju u modulu i ne loguju nigde: jedini put kojim smeju
 * da izađu iz procesa je zaglavlje ka `api.paddle.com`.
 */
export function paddleServerEnv(): PaddleServerEnv {
  const parsed = paddleServerSchema.safeParse(process.env);
  if (!parsed.success) fail(parsed.error);
  return parsed.data;
}

/**
 * ID popusta za beta korisnike, ili `null` kad nije podešen.
 *
 * Ne baca nikad — v. `paddleDiscountSchema`. Prazna vrednost i vrednost
 * pogrešnog oblika daju isti odgovor: popust se ne primenjuje sam.
 */
export function paddleBetaDiscountId(): string | null {
  const parsed = paddleDiscountSchema.safeParse(process.env);
  if (!parsed.success) return null;
  return parsed.data.PADDLE_BETA_DISCOUNT_ID ?? null;
}
