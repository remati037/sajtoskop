// apps/web/src/lib/auth.ts
// Jedini dozvoljen izvor `user_id` u celoj aplikaciji.
//
// Pravilo 8 iz CLAUDE.md i P0-1 (IDOR) iz docs/bezbednost-i-zastita.md:
// user_id NIKAD ne dolazi iz request body-ja, query parametra ni headera.
// Ako ikad vidiš `const { userId } = await req.json()` — to je propust, ne stil.
//
// Middleware NE štiti rute (vidi komentar u `src/middleware.ts`). Zaštita je
// ovde: svaka stranica ili ruta koja dodiruje korisničke podatke zove
// `requireSession()` kao prvu liniju.

import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/** Clerk user id iz verifikovane serverske sesije, ili `null` ako nije ulogovan. */
export async function getCurrentUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/**
 * Za stranice i layoute: vrati user id ili preusmeri na prijavu.
 * Prva linija svake zaštićene stranice.
 */
export async function requireSession(): Promise<string> {
  const userId = await getCurrentUserId();
  // Početna strana JESTE prijava — v. `app/page.tsx`.
  if (!userId) redirect("/");
  return userId;
}

/**
 * Za API rute i server akcije: vrati user id ili baci.
 * `redirect()` u ruti nema smisla — klijent očekuje status kod, ne HTML.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Nema aktivne sesije.");
  return userId;
}
