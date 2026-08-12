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
  CLERK_SECRET_KEY: z.string().min(1),
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
