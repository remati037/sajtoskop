// apps/web/src/app/(app)/layout.tsx
// Okvir zaštićenog dela aplikacije: pretraga, lista, kontrolna tabla.
//
// Grupa `(app)` ne menja nijedan URL — `/dashboard` je i dalje `/dashboard`.
// Postoji zbog zajedničkog headera i zbog toga što rezervni put za kreiranje
// profila sada stoji na jednom mestu, a ne u svakoj stranici posebno.
//
// VAŽNO: ovaj layout NIJE zaštita. Layout se ne izvršava ponovo pri klijentskoj
// navigaciji između sestrinskih ruta, pa svaka stranica ispod i dalje zove
// `requireSession()` kao prvu liniju (vidi `src/lib/auth.ts`).

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { requireSession } from "@/lib/auth";
import { ensureProfile, getOwnProfile } from "@/lib/profile";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireSession();

  let profile = await getOwnProfile();

  // Webhook ne stiže do localhost-a bez tunela; RPC je idempotentan.
  if (!profile) {
    const user = await currentUser();
    await ensureProfile(userId, user?.primaryEmailAddress?.emailAddress ?? null);
    profile = await getOwnProfile();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/85 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/pretraga" className="text-sm font-semibold tracking-tight">
            Sajtoskop
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <NavLink href="/pretraga">Pretraga</NavLink>
            <NavLink href="/lista">Lista</NavLink>
            <NavLink href="/dashboard">Kontrolna tabla</NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-4">
            {/* Balans je uvek vidljiv (F4 §4) i vodi na izvod iz knjige. Broj se
                osvežava kroz `router.refresh()` posle svakog otključavanja —
                ovaj layout je server komponenta i sam od sebe ne zna za klik. */}
            <Link
              href="/krediti"
              className="rounded-md px-2 py-1 text-xs tabular-nums text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
              title="Krediti se troše na otključavanje prospekata"
            >
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {profile ? profile.credits_balance : "—"}
              </span>{" "}
              kredita
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2.5 py-1.5 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
    >
      {children}
    </Link>
  );
}
