"use client";

// apps/web/src/components/auth-ekran.tsx
// Prijava i registracija na jednom mestu, sa prekidačem između njih.
//
// ── zašto `routing="hash"` ────────────────────────────────────
// Clerk unutar sebe rutira na korake (`factor-one`, `sso-callback`,
// `reset-password`). Sa `routing="path"` svaki od tih koraka traži pravu Next
// rutu, pa forma mora da živi pod catch-all segmentom — a `/` to ne može da
// bude bez gutanja svih 404 stranica. Hash rutiranje drži korak u fragmentu
// (`/#/factor-one`), pa obe forme staju na početnu stranu bez ijedne dodatne
// rute.
//
// Prekidač je naš, a ne Clerk-ov link u podnožju kartice — taj link se sklanja
// u `globals.css` da ne budu dva prekidača za istu stvar.

import { useState } from "react";
import { SignIn, SignUp } from "@clerk/nextjs";
import { cn } from "@/lib/cn";

export type Rezim = "prijava" | "registracija";

const REZIMI: { vrednost: Rezim; naziv: string }[] = [
  { vrednost: "prijava", naziv: "Prijava" },
  { vrednost: "registracija", naziv: "Registracija" },
];

/** Gde korisnik ide kad Clerk nema svoj razlog da ga pošalje drugde. */
const POSLE_ULASKA = "/pretraga";

export function AuthEkran({
  pocetni,
  posle = POSLE_ULASKA,
}: {
  pocetni: Rezim;
  /**
   * Gde se ide posle uspešnog ulaska. Postoji zbog `/cenovnik` (S18): gost koji
   * klikne „Uzmi Pro" mora da se registruje, i ako ga posle toga bacimo na
   * `/pretraga`, izgubio je i nameru i mesto na kome je bio.
   *
   * Vrednost stiže iz `?nazad=` i PROVERAVA SE NA SERVERU (v. `app/page.tsx`) —
   * neproverena bi bila otvorena redirekcija, dakle phishing sa našeg domena.
   */
  posle?: string;
}) {
  const [rezim, setRezim] = useState<Rezim>(pocetni);
  const index = REZIMI.findIndex((r) => r.vrednost === rezim);

  function prebaci(sledeci: Rezim) {
    if (sledeci === rezim) return;

    // Hash rutiranje pamti korak u fragmentu. Bez brisanja, druga forma se
    // otvara na tuđem koraku — npr. registracija na `#/factor-one` iz prijave.
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }

    setRezim(sledeci);
  }

  return (
    <div className="relative flex w-full flex-col items-center gap-6">
      <div
        role="tablist"
        aria-label="Prijava ili registracija"
        // 25rem je širina Clerk-ove kartice ispod. Poravnanje je namerno —
        // prekidač koji je uži od kartice izgleda kao da je slučajno tu.
        className="relative grid w-full max-w-[25rem] grid-cols-2 gap-0.5 rounded-full border border-border-strong bg-bg-inset/60 p-1 shadow-sm"
      >
        {/* Isti klizni indikator kao u prekidaču teme — jedan element koji se
            pomera, ne dve pozadine koje se pale. */}
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/2)] rounded-full bg-bg-elev shadow-sm ring-1 ring-border-strong transition-transform duration-200 ease-out"
          style={{ transform: `translateX(calc(${Math.max(index, 0)} * 100%))` }}
        />

        {REZIMI.map(({ vrednost, naziv }) => {
          const aktivan = vrednost === rezim;
          return (
            <button
              key={vrednost}
              type="button"
              role="tab"
              id={`tab-${vrednost}`}
              aria-selected={aktivan}
              aria-controls="auth-panel"
              tabIndex={aktivan ? 0 : -1}
              onClick={() => prebaci(vrednost)}
              className={cn(
                "relative z-10 flex h-9 items-center justify-center rounded-full text-sm font-medium transition-colors",
                aktivan ? "text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {naziv}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="auth-panel"
        aria-labelledby={`tab-${rezim}`}
        className="auth-forma flex w-full justify-center"
      >
        {/* `key` je namerno: prelaz između formi mora da bude čist montaž, da
            Clerk ne nasledi stanje prethodnog koraka. */}
        {rezim === "prijava" ? (
          <SignIn
            key="prijava"
            routing="hash"
            fallbackRedirectUrl={posle}
            signUpFallbackRedirectUrl={posle}
          />
        ) : (
          <SignUp
            key="registracija"
            routing="hash"
            fallbackRedirectUrl={posle}
            signInFallbackRedirectUrl={posle}
          />
        )}
      </div>
    </div>
  );
}
