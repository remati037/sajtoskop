// scripts/lib/next-stubs.ts
// Zamene za tri modula koja postoje samo unutar Next runtime-a. Učitava ih
// `route-harness.ts` kroz resolve hook — vidi tamo zašto.
//
// Ovde je JEDINA laž u celom testu: identitet. Sve ostalo — parsiranje tela,
// RPC poziv, prava Supabase baza, prave transakcije — je stvarno.

/** Postavlja ga `route-harness.ts`. `null` = nema sesije, ruta mora dati 401. */
type SessionHolder = { current: string | null };

const holder: SessionHolder = ((globalThis as Record<string, unknown>).__sajtoskopSession ??= {
  current: null,
}) as SessionHolder;

/** Zamena za `auth()` iz `@clerk/nextjs/server`. */
export async function auth(): Promise<{
  userId: string | null;
  getToken: () => Promise<string | null>;
}> {
  return {
    userId: holder.current,
    // `userSupabase()` bi ovim tokenom pao na anon rolu i udario u RLS. To je
    // tačno ponašanje: putanja otključavanja ne sme da ga koristi.
    getToken: async () => null,
  };
}

/** Zamena za `redirect()` iz `next/navigation` — API rute ga ne zovu. */
export function redirect(url: string): never {
  throw new Error(`redirect(${url}) u API ruti — ruta bi trebalo da vrati status kod.`);
}

/**
 * Zamena za `notFound()` iz `next/navigation`.
 *
 * Zašto je ovde iako otključavanje nema veze sa adminom: `api/unlock/route.ts`
 * uvozi `lib/rate-limit.ts` (P0 zaštita od navale), koji uzima `ipZahteva` iz
 * `lib/admin.ts`, a `lib/admin.ts` uvozi `notFound` — pravilo 13 iz CLAUDE.md
 * traži da onaj ko nije admin dobije 404, ne 403. Statički ESM uvoz se izvršava
 * i kad se funkcija nikad ne pozove, pa bez ovog stuba ceo `pnpm check:f4`
 * pukne pri učitavanju rute, pre nego što ijedan test krene.
 *
 * Baca, kao i `redirect`: API ruta koja bi ovo pozvala treba da vrati 404 status
 * kod, a ne da diže Next-ov izuzetak koji van Next runtime-a niko ne hvata.
 */
export function notFound(): never {
  throw new Error("notFound() u API ruti — ruta bi trebalo da vrati 404 status kod.");
}

/** Zamena za `currentUser()` — testovi bez Clerk profila. */
export async function currentUser(): Promise<null> {
  return null;
}

/**
 * Zamena za `clerkClient()` iz `@clerk/nextjs/server`.
 *
 * Isti razlog kao kod `notFound()`: statički ESM uvoz se izvršava i kad se
 * funkcija nikad ne pozove, pa `lib/admin-radnje.ts` bez ovog stuba ne može ni
 * da se učita van Next runtime-a — a `apps/web/test/admin-beta.ts` iz njega
 * proverava odbijanje plana `beta`, do koga se dolazi PRE ijednog spoljnog
 * poziva.
 *
 * Baca, i to je namerno: test koji bi stvarno pozvao Clerk radi nad mrežom, a
 * ovde je jedina dozvoljena laž identitet — ne i ponašanje tuđeg servisa.
 */
export async function clerkClient(): Promise<never> {
  throw new Error("clerkClient() u testu — ova putanja ne sme da dodiruje Clerk.");
}
