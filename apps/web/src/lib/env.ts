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
