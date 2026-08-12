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
import { trebaPodsetnik } from "@/lib/feedback";
import { citajProfil, ensureProfile } from "@/lib/profile";
import { OkvirAplikacije } from "@/components/okvir-aplikacije";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireSession();

  /**
   * Ovaj layout ne sme da padne ni na jednoj grešci.
   *
   * Stoji iznad svake strane u `(app)`, pa jedan izuzetak ovde znači da korisnik
   * ne vidi ni navigaciju, ni temu, ni objašnjenje — samo Next-ov crveni ekran.
   * A kvar koji ga izaziva (pokvarena Clerk↔Supabase veza) ima jasno ime i jasno
   * rešenje, pa je jedino ispravno da aplikacija ostane na nogama i da ga ispiše.
   */
  let { profile, greska } = await citajProfil();

  // Webhook ne stiže do localhost-a bez tunela; RPC je idempotentan.
  // Ide kroz admin klijent, dakle radi i kad je korisnikov token pokvaren —
  // zato se pokušava i posle greške u čitanju.
  if (!profile) {
    try {
      const user = await currentUser();
      await ensureProfile(userId, user?.primaryEmailAddress?.emailAddress ?? null);
      ({ profile, greska } = await citajProfil());
    } catch (err) {
      console.error("[layout] kreiranje profila nije uspelo:", err);
      greska ??= err instanceof Error ? err.message : String(err);
    }
  }

  const plan = planFor(profile?.plan);

  return (
    // Balans je uvek vidljiv (F4 §4) i vodi na izvod iz knjige. Broj se osvežava
    // kroz `router.refresh()` posle svakog otključavanja — ovaj layout je server
    // komponenta i sam od sebe ne zna za klik.
    <OkvirAplikacije
      krediti={profile ? profile.credits_balance : null}
      mesecniKrediti={plan.monthlyCredits}
      greska={greska}
      // F10 §4.4: podsetnik posle tri dana. Izvedeno iz profila koji je već
      // pročitan — nijedan dodatan upit po učitavanju strane.
      traziUtisak={trebaPodsetnik(profile, plan.monthlyCredits)}
    >
      {children}
    </OkvirAplikacije>
  );
}
