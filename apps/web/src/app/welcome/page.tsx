// apps/web/src/app/welcome/page.tsx
// Odredište posle uspešnog plaćanja (`settings.successUrl` u `cenovnik-ekran.tsx`).
//
// ‼️ OVA STRANA NE DODELJUJE NIŠTA. Ne upisuje pretplatu, ne dodaje kredite i ne
//    menja plan. Redirekcija je samo UX: korisnik ume da zatvori tab pre nego
//    što stigne dovde, da izgubi vezu ili da otvori ovaj URL rukom. Izvor istine
//    su Paddle webhookovi (`transaction.completed`, `subscription.created`) —
//    v. `app/api/billing/webhook/route.ts`.
//
// Zbog toga i kopija namerno ne kaže „plan ti je aktiviran": u trenutku kad se
// ova strana prikaže, webhook možda još nije stigao. Kaže da je plaćanje primljeno.
//
// Putanja je `/welcome`, a ne `/dobrodosli`, jer je tako i u Paddle podešavanju
// checkout-a — ako se menja, menja se na oba mesta.

import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { getCurrentUserId } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ZnakSaImenom } from "@/components/znak";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hvala",
  // Potvrda kupovine nema šta da traži u pretrazi.
  robots: { index: false, follow: false },
};

export default async function Page() {
  // Kupac ume da plati i pre nego što napravi nalog — tada ga vodimo na
  // registraciju, a ne u aplikaciju u koju ne može da uđe.
  const ulogovan = (await getCurrentUserId()) !== null;

  return (
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[28rem]" />

      <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center px-5 sm:px-7 lg:px-8">
        <Link href="/" className="rounded-lg">
          <ZnakSaImenom imeKlase="text-base" />
        </Link>
      </header>

      <main className="relative mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-5 pb-24 text-center sm:px-7">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-wash text-accent-text">
          <CircleCheck className="h-6 w-6" strokeWidth={1.75} />
        </div>

        <h1 className="h2 mt-6">Plaćanje je primljeno</h1>

        <p className="lede mt-4">
          Hvala. Račun ti stiže mejlom od Paddle-a, koji vodi naplatu. Plan se aktivira čim njihova
          potvrda stigne do nas — obično za nekoliko sekundi.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {ulogovan ? (
            <>
              <Button variant="primary" size="lg" asChild>
                <Link href="/pretraga">Nastavi na pretragu</Link>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <Link href="/krediti">Stanje kredita</Link>
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" asChild>
              <Link href="/?nalog=nov">Napravi nalog</Link>
            </Button>
          )}
        </div>

        <p className="mt-8 text-xs text-fg-muted">
          Ako se plan ne pojavi u roku od nekoliko minuta, piši mi na{" "}
          <a
            href="mailto:podrska@sajtoskop.com"
            className="font-medium text-accent-text underline underline-offset-4"
          >
            podrska@sajtoskop.com
          </a>{" "}
          — imaj pri ruci broj računa iz mejla.
        </p>
      </main>
    </div>
  );
}
