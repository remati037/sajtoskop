// apps/web/src/lib/supabase.ts
// Dva Supabase klijenta. Razlika među njima je cela bezbednosna granica ovog sloja.
//
//   userSupabase()  — anon ključ + Clerk token. RLS VAŽI. Vidi samo svoje redove.
//   adminSupabase() — service_role. RLS NE VAŽI. Vidi sve, menja sve.
//
// `import "server-only"` je tu da build pukne ako neko ikad uveze ovaj fajl u
// `"use client"` komponentu. To je P0-4 iz docs/bezbednost-i-zastita.md — jedan
// slučajan import i cela baza je javna.
//
// Pravilo: sve što korisnik sme da vidi čita se kroz `userSupabase()`.
// `adminSupabase()` se koristi SAMO tamo gde postoji server-side provera prava
// koju RLS ne može da izrazi (npr. `businesses` ima `using (false)`, pa listing
// ruta u F2 mora kroz admin klijent — i tamo sama izbacuje zaključana polja).

import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

/**
 * Klijent u ime ulogovanog korisnika. Clerk je third-party auth provider u
 * Supabase-u, pa se njegov sesijski token šalje direktno — bez JWT template-a.
 * U RLS politikama `auth.jwt() ->> 'sub'` je onda Clerk user id.
 */
export function userSupabase(): SupabaseClient {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    async accessToken() {
      return (await auth()).getToken();
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Klijent sa punim pravima. Zaobilazi RLS.
 *
 * Pre svakog poziva odgovori sebi na dva pitanja:
 *   1. Da li je `user_id` došao iz `getCurrentUserId()`, a ne iz zahteva?
 *   2. Da li odgovor izbacuje polja koja korisnik nije otključao (P0-3)?
 * Ako je odgovor na bilo koje „ne" — ovo nije pravi klijent.
 */
export function adminSupabase(): SupabaseClient {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
