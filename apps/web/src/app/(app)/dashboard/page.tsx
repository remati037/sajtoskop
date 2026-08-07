import Link from "next/link";
import { planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { getOwnProfile } from "@/lib/profile";

// Kontrolna tabla dokazuje da lanac Clerk → Supabase JWT → RLS radi: broj kredita
// ispod je pročitan kroz RLS politiku „own profile", ne kroz service_role.
//
// Rezervni put za kreiranje profila je od F2 u `(app)/layout.tsx` — ovde je bio
// dupliran čim je pretraga dobila isti problem.

export const dynamic = "force-dynamic";

export default async function Page() {
  // Prva linija svake zaštićene stranice — ni middleware ni layout ovo ne rade.
  await requireSession();

  const profile = await getOwnProfile();
  const plan = planFor(profile?.plan);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Kontrolna tabla</h1>

      {profile ? (
        <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kartica naslov="Krediti" vrednost={String(profile.credits_balance)} />
          <Kartica naslov="Plan" vrednost={profile.plan} />
          <Kartica
            naslov="Pretraga van keša"
            vrednost={`${profile.cache_miss_count} / ${plan.cacheMissPerDay} danas`}
          />
        </dl>
      ) : (
        <p className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Profil nije pronađen. Najverovatniji uzrok: Clerk nije podešen kao
          third-party auth provider u Supabase-u, pa RLS politika ne vidi tvoj
          korisnički ID.
        </p>
      )}

      <p className="mt-10 text-sm text-neutral-500">
        <Link href="/pretraga" className="underline underline-offset-4">
          Pretraži prospekte
        </Link>{" "}
        — pretraga iz keša je besplatna i neograničena.
      </p>
    </main>
  );
}

function Kartica({ naslov, vrednost }: { naslov: string; vrednost: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{naslov}</dt>
      <dd className="mt-1 text-xl font-medium tabular-nums">{vrednost}</dd>
    </div>
  );
}
