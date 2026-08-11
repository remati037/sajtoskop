// apps/web/src/app/(app)/layout.tsx
// Okvir zaštićenog dela aplikacije: pretraga, lista, pipeline, krediti,
// kontrolna tabla.
//
// Grupa `(app)` ne menja nijedan URL — `/dashboard` je i dalje `/dashboard`.
// Postoji zbog zajedničkog okvira i zbog toga što rezervni put za kreiranje
// profila sada stoji na jednom mestu, a ne u svakoj stranici posebno.
//
// VAŽNO: ovaj layout NIJE zaštita. Layout se ne izvršava ponovo pri klijentskoj
// navigaciji između sestrinskih ruta, pa svaka stranica ispod i dalje zove
// `requireSession()` kao prvu liniju (vidi `src/lib/auth.ts`).
//
// Od redizajna je navigacija bočna traka, a ne header. Razlog nije moda: pet
// ekrana, balans kredita, prekidač teme i meni naloga u jednoj traci od 56 px
// nisu stali bez skupljanja svega na ikonice. Sidebar usput drži i kontekst —
// uvek se vidi gde si u toku rada, a `pipeline` dobija punu širinu ekrana.

import { planFor } from "@sajtoskop/shared";
import { currentUser } from "@clerk/nextjs/server";
import { requireSession } from "@/lib/auth";
import { ensureProfile, getOwnProfile } from "@/lib/profile";
import { OkvirAplikacije } from "@/components/okvir-aplikacije";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireSession();

  let profile = await getOwnProfile();

  // Webhook ne stiže do localhost-a bez tunela; RPC je idempotentan.
  if (!profile) {
    const user = await currentUser();
    await ensureProfile(userId, user?.primaryEmailAddress?.emailAddress ?? null);
    profile = await getOwnProfile();
  }

  const plan = planFor(profile?.plan);

  return (
    // Balans je uvek vidljiv (F4 §4) i vodi na izvod iz knjige. Broj se osvežava
    // kroz `router.refresh()` posle svakog otključavanja — ovaj layout je server
    // komponenta i sam od sebe ne zna za klik.
    <OkvirAplikacije
      krediti={profile ? profile.credits_balance : null}
      mesecniKrediti={plan.monthlyCredits}
    >
      {children}
    </OkvirAplikacije>
  );
}
