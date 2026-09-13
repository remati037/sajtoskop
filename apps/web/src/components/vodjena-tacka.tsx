"use client";

// apps/web/src/components/vodjena-tacka.tsx
// Balon uz element — jedna od četiri tačke vođenog prolaza (S30, §4.5).
//
// Oblik po §4.5: `bg-bg-elev`, `border-border-accent`, strelica ka elementu,
// 260 px; na telefonu puna širina ISPOD elementa, nikad preko njega. Bez
// zatamnjenja, bez „Dalje", bez brojača.
//
// Ova komponenta ne odlučuje da li se balon prikazuje — samo se nudi kao mesto
// (`registruj`). Koji element i kad, bira `OnboardingProvider`: najviše jedna
// tačka odjednom, nikad preko modala, posla ili pitanja.

import { useEffect, useId } from "react";
import { TACKA_JASNO, TACKE, type HintKljuc } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { useOnboarding } from "./onboarding-provider";
import { Button } from "./ui/button";

export function VodjenaTacka({
  hint,
  kandidat = true,
  children,
  className,
}: {
  hint: HintKljuc;
  /**
   * Da li se ovaj element uopšte nudi. Lista od 20 kartica ima jednu karticu
   * koja nosi tačku 1 — ostale prosleđuju `false` i ne prijavljuju se.
   */
  kandidat?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const onboarding = useOnboarding();
  const id = useId();
  const registruj = onboarding?.registruj;

  useEffect(() => {
    if (!registruj || !kandidat) return;
    return registruj(hint, id);
  }, [registruj, hint, id, kandidat]);

  const prikazi = !!onboarding && kandidat && onboarding.jeAktivna(hint, id);
  const tekst = TACKE[hint];

  return (
    <div className={cn("relative", className)}>
      {children}

      {prikazi && (
        <div
          role="note"
          aria-live="polite"
          className="relative z-20 mt-2.5 w-full animate-uklizi rounded-xl border border-border-accent bg-bg-elev p-3 text-left shadow-card sm:absolute sm:left-0 sm:top-full sm:w-[260px]"
        >
          {/* Strelica ka elementu. Ista ivica i podloga kao balon, pa se ne vidi šav. */}
          <span
            aria-hidden
            className="absolute -top-[6px] left-6 h-2.5 w-2.5 rotate-45 border-l border-t border-border-accent bg-bg-elev"
          />
          <p className="text-[13px] leading-snug">
            <strong className="font-semibold text-fg">{tekst.naslov}</strong>{" "}
            <span className="text-fg-muted">{tekst.telo}</span>
          </p>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onboarding.zatvori(hint)}
            >
              {TACKA_JASNO}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
