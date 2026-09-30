"use client";

// apps/web/src/components/ui/info-savet.tsx
// Ikonica „i" pored naslova; objašnjenje stoji u oblačiću, ne na ekranu.
//
// Ekran pokazuje šta je šta, a zašto i kako se čita na zahtev. Pravilo: ovde
// ide sve što korisnik pročita jednom (podnaslovi, pravila o kreditima,
// fusnote). Greška i upozorenje koje traže radnju NIKAD ne idu ovde —
// sakriven razlog je razlog koji niko ne vidi.
//
// Radix tooltip se otvara samo na hover i fokus, a telefon hover nema. Zato je
// stanje kontrolisano i klik ga prebacuje; `preventDefault` gasi Radix-ov
// ugrađeni „zatvori na klik" (composeEventHandlers preskače svoj handler kad
// je događaj već preventovan). Dodir van oblačića ga zatvara kroz onOpenChange.

import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

export function InfoSavet({
  children,
  label = "Objašnjenje",
  side = "bottom",
  className,
}: {
  /** Tekst u oblačiću. */
  children: React.ReactNode;
  /** Ime dugmeta za čitač ekrana. */
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  const [otvoren, setOtvoren] = useState(false);

  return (
    // Sopstveni provider: savet se koristi i van okvira aplikacije (modal,
    // početak), a ugnežđeni provider je bezopasan.
    <TooltipProvider delayDuration={150}>
      <Tooltip open={otvoren} onOpenChange={setOtvoren}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              setOtvoren((o) => !o);
            }}
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full align-middle text-fg-faint transition-colors hover:text-fg focus-visible:text-fg",
              className,
            )}
          >
            <Info className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align="start"
          collisionPadding={16}
          className="max-w-[18rem] text-left text-xs font-normal leading-relaxed text-fg-muted"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
