// apps/worker/src/lib/supabase.ts
// Supabase klijent za Node procese: worker, seed, skripte za proveru.
//
// Uvek `service_role` — worker nema korisničku sesiju, on je taj koji piše u
// `businesses`, `website_audits` i `job_queue`, a te tabele imaju RLS `using (false)`.
//
// Ovo NIKAD ne ide u apps/web. Web ima svoj klijent u `src/lib/supabase.ts`, gde
// postoji i korisnička varijanta pod RLS-om. Ovde je nema jer joj nema ko da da token.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * [Faza 0, 0.3] Mrtav Supabase ne sme zauvek da blokira slot (V2).
 *
 * Bez timeouta zakačen RPC drži radnika u nedogled, a žetva posle 15 minuta
 * proglasi posao zaglavljenim i duplira ga — dupla Google kvota, dupli novac.
 * Sa timeoutom se RPC završi greškom, posao ide na retry kroz `fail_job` i
 * backoff, a slot se odmah oslobađa.
 */
const SUPABASE_TIMEOUT_MS = 30_000;

function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
  // `signal` se svesno pregazi: ovaj klijent ne koristi otkazivanje po zahtevu,
  // a bez toga bi poziv koji visi prošao pored timeouta.
  return fetch(input, { ...init, signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Nedostaje env promenljiva ${name}.\n` +
        `Prepiši .env.example u .env i popuni je vrednostima iz Supabase konzole ` +
        `(Project Settings → API).`,
    );
  }
  return value;
}

/**
 * Klijent sa punim pravima nad bazom. Zaobilazi RLS.
 * Ključ nikad ne sme da završi u nečemu što se šalje pregledaču (P0-4).
 */
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout },
    },
  );
  return cached;
}

/**
 * Klijent sa anon ključem, bez sesije — dakle rola `anon`.
 * Postoji samo da bi se RLS mogao proveriti spolja: ako ovim klijentom uspeš
 * da pročitaš `businesses`, politika `using (false)` ne radi.
 */
export function supabaseAnon(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout },
    },
  );
}
