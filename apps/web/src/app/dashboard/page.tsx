import { currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { ensureProfile, getOwnProfile } from "@/lib/profile";

// F1: prazna kontrolna tabla. Pretraga i lista su F2 — ne pravi ih ovde.
// Jedina poenta ovog ekrana je da dokaže da lanac Clerk → Supabase JWT → RLS radi:
// broj kredita ispod je pročitan kroz RLS politiku "own profile", ne kroz service_role.

export const dynamic = "force-dynamic";

export default async function Page() {
  // Prva linija svake zaštićene stranice — middleware ovo više ne radi.
  const userId = await requireSession();

  let profile = await getOwnProfile();

  // Webhook ne stiže do localhost-a bez tunela. Rezervni put je idempotentan.
  if (!profile) {
    const user = await currentUser();
    await ensureProfile(userId, user?.primaryEmailAddress?.emailAddress ?? null);
    profile = await getOwnProfile();
  }

  const plan = planFor(profile?.plan);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Kontrolna tabla</h1>
        <UserButton />
      </header>

      {profile ? (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Kartica naslov="Krediti" vrednost={String(profile.credits_balance)} />
          <Kartica naslov="Plan" vrednost={profile.plan} />
          <Kartica
            naslov="Pretraga van keša"
            vrednost={`${profile.cache_miss_count} / ${plan.cacheMissPerDay} danas`}
          />
        </dl>
      ) : (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Profil nije pronađen. Najverovatniji uzrok: Clerk nije podešen kao
          third-party auth provider u Supabase-u, pa RLS politika ne vidi tvoj
          korisnički ID.
        </p>
      )}

      <p className="mt-10 text-sm text-neutral-500">
        Pretraga prospekata stiže u sledećoj fazi.
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
