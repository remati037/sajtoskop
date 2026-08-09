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
