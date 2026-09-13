"use client";

// apps/web/src/components/onboarding-traka.tsx
// Traka „Prvih pet minuta" u bočnoj traci (S30, §4.6).
//
// Ispod navigacije, iznad čipa kredita. Nikad primarno dugme — isti razlog kao
// poziv na dokup u S21: bočna traka stoji preko svih ekrana, i njeno dugme bi se
// tuklo sa primarnim dugmetom svakog od njih.
//
// Svaki neurađen korak je link na ekran gde se radi. Skupljena bočna traka
// dobija prsten `2/4` sa tooltipom.

import Link from "next/link";
import { Check } from "lucide-react";
import { KORACI, TRAKA, uradjeniKoraci, type KorakKljuc } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { useOnboarding } from "./onboarding-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Kuda vodi neurađen korak (§4.6). */
function linkKoraka(korak: KorakKljuc, grad: string | null, nisa: string | null): string {
  switch (korak) {
    case "pretraga":
      // Prva lista iz čarobnjaka je plaćena na dubini „Brzo" — bez `dubina` bi
      // pretraga tražila „Standardno" i videla cenu umesto liste.
      return grad && nisa
        ? `/pretraga?grad=${encodeURIComponent(grad)}&nisa=${encodeURIComponent(nisa)}&dubina=brzo`
        : "/pretraga";
    case "otkljucavanje":
      return "/pretraga";
    case "poruka":
      return "/lista";
    case "pipeline":
      return "/pipeline";
  }
}

export function OnboardingTraka({ skupljen }: { skupljen: boolean }) {
  const onboarding = useOnboarding();
  if (!onboarding?.trakaPrikaz) return null;

  const uradjeni = uradjeniKoraci(onboarding.koraci);
  const broj = uradjeni.length;
  const ukupno = KORACI.length;

  if (skupljen) {
    // Prsten: obim kruga r=9 je ~56.5; popunjen deo nosi broj urađenih.
    const obim = 2 * Math.PI * 9;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={linkKoraka(
              KORACI.find((k) => !uradjeni.includes(k.kljuc))?.kljuc ?? "pipeline",
              onboarding.grad,
              onboarding.nisa,
            )}
            aria-label={`${TRAKA.naslov}: ${broj} od ${ukupno}`}
            className="flex flex-col items-center gap-0.5 rounded-lg border border-border-strong bg-bg-elev py-2 transition-colors hover:border-fg-muted"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="none" stroke="var(--bg-inset)" strokeWidth="3" />
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(obim * broj) / ukupno} ${obim}`}
              />
            </svg>
            <span className="num text-[11px] font-semibold">
              {broj}/{ukupno}
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span className="font-semibold">{TRAKA.naslov}</span>
          <span className="num ml-2 font-normal text-fg-muted">
            {broj}/{ukupno}
          </span>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <section
      aria-label={TRAKA.naslov}
      className="rounded-xl border border-border bg-bg-elev p-3 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold">{TRAKA.naslov}</p>
        <p className="num text-xs text-fg-muted">
          {broj}/{ukupno}
        </p>
      </div>

      {onboarding.zavrsenoUpravo ? (
        <p role="status" className="mt-2 text-xs font-medium text-accent-text">
          {TRAKA.gotovo}
        </p>
      ) : (
        <>
          <ul className="mt-2 space-y-1.5">
            {KORACI.map((k) => {
              const uradjen = uradjeni.includes(k.kljuc);
              const uputstvo = TRAKA.uputstvo[k.kljuc];

              const sadrzaj = (
                <span className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border",
                      uradjen
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-border-strong bg-bg-elev",
                    )}
                  >
                    {uradjen && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-xs", uradjen ? "text-fg-muted" : "font-medium text-fg")}>
                      {k.naslov}
                    </span>
                    {!uradjen && uputstvo && (
                      <span className="block text-[11px] italic leading-snug text-fg-muted">
                        {uputstvo}
                      </span>
                    )}
                  </span>
                </span>
              );

              return (
                <li key={k.kljuc}>
                  {uradjen ? (
                    <span className="block px-1 py-0.5">
                      <span className="sr-only">Urađeno: </span>
                      {sadrzaj}
                    </span>
                  ) : (
                    <Link
                      href={linkKoraka(k.kljuc, onboarding.grad, onboarding.nisa)}
                      className="block rounded-md px-1 py-0.5 transition-colors hover:bg-bg-hover"
                    >
                      {sadrzaj}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={onboarding.sakrijTraku}
            className="mt-2 text-[11px] font-medium text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
          >
            {TRAKA.sakrij}
          </button>
        </>
      )}
    </section>
  );
}
