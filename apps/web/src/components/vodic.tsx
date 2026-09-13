"use client";

// apps/web/src/components/vodic.tsx
// Vodič na zahtev — ikonica u gornjoj traci i panel ispod nje (S30, §4.8).
//
// Isti obrazac kao panel utiska (`utisak-dugme.tsx`): 360 px, `Esc` i klik van
// zatvaraju, fokus se vraća na dugme. Sadržaj su ista četiri koraka iz
// `KORACI`, sa rečenicom iz tačaka (bez „Jasno") i linkom „Pokaži mi" koji vodi
// na ekran i ponovo prikazuje tu tačku.
//
// Nikad se ne otvara sam (§4.8).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { KORACI, TACKE, VODIC, type HintKljuc } from "@sajtoskop/shared";
import { useOnboarding } from "./onboarding-provider";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Ekran na kom tačka stoji. */
function ekranTacke(hint: HintKljuc, grad: string | null, nisa: string | null): string {
  switch (hint) {
    case "nema-sajt":
    case "otkljucaj":
      return grad && nisa
        ? `/pretraga?grad=${encodeURIComponent(grad)}&nisa=${encodeURIComponent(nisa)}&dubina=brzo`
        : "/pretraga";
    case "poruka":
      return "/lista";
    case "pipeline":
      return "/pipeline";
  }
}

export function Vodic() {
  const onboarding = useOnboarding();
  const router = useRouter();
  const [otvoren, setOtvoren] = useState(false);
  const dugme = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const zatvori = useCallback((vratiFokus = true) => {
    setOtvoren(false);
    if (vratiFokus) dugme.current?.focus();
  }, []);

  // Panel preko ekrana = tačke ćute (§4.5 „nikad preko modala").
  const postaviZauzeto = onboarding?.postaviZauzeto;
  useEffect(() => {
    postaviZauzeto?.("vodic", otvoren);
  }, [postaviZauzeto, otvoren]);

  useEffect(() => {
    if (!otvoren) return;

    function naEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        zatvori();
      }
    }
    function naKlik(e: PointerEvent) {
      const cilj = e.target as Node;
      if (panel.current?.contains(cilj) || dugme.current?.contains(cilj)) return;
      zatvori(false);
    }

    document.addEventListener("keydown", naEsc);
    document.addEventListener("pointerdown", naKlik);
    panel.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      document.removeEventListener("keydown", naEsc);
      document.removeEventListener("pointerdown", naKlik);
    };
  }, [otvoren, zatvori]);

  if (!onboarding) return null;

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={dugme}
            type="button"
            aria-label={VODIC.naslov}
            aria-expanded={otvoren}
            aria-haspopup="dialog"
            onClick={() => setOtvoren((o) => !o)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border-strong text-fg-faint transition-colors hover:border-fg-muted hover:text-fg"
          >
            <CircleHelp className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{VODIC.naslov}</TooltipContent>
      </Tooltip>

      {otvoren && (
        <div
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-label={VODIC.naslov}
          className="fixed left-4 right-4 top-[4.5rem] z-40 max-h-[calc(100dvh-6rem)] animate-uklizi overflow-y-auto rounded-xl border border-border bg-bg-elev p-4 shadow-card sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px]"
        >
          <p className="eyebrow">{VODIC.naslov}</p>

          <ol className="mt-3 space-y-3">
            {KORACI.map((k, i) => {
              const tekst = TACKE[k.hint];
              return (
                <li key={k.kljuc} className="flex gap-3">
                  <span className="num mt-0.5 text-[11px] text-accent-text">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{k.naslov}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">
                      {tekst.naslov} {tekst.telo}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onboarding.pokazi(k.hint);
                        zatvori(false);
                        router.push(ekranTacke(k.hint, onboarding.grad, onboarding.nisa));
                      }}
                      className="mt-1 text-xs font-medium text-accent-text underline-offset-4 hover:underline"
                    >
                      {VODIC.pokaziMi}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 border-t border-border pt-3">
            <Button asChild variant="secondary" size="sm" className="w-full">
              <Link href="/pocetak?ponovo=1" onClick={() => zatvori(false)}>
                {VODIC.ponovi}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
