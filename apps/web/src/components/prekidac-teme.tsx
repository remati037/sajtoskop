"use client";

// Prekidač teme. Dve pojave istog stanja:
//   `PrekidacTeme`        — segmentna traka sa tri polja, stoji u sidebar-u
//   `PrekidacTemeDugme`   — jedno dugme sa menijem, za gornju traku na telefonu
//
// Klizni indikator iza aktivnog polja je jedini deo koji nije čisti CSS hover:
// prelaz od 220 ms je razlika između „prekidača" i „dugmadi koja se pale".

import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Tema } from "@/lib/tema";
import { useTema } from "./tema-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const OPCIJE: { vrednost: Tema; naziv: string; Ikona: typeof Sun }[] = [
  { vrednost: "sistem", naziv: "Sistem", Ikona: Monitor },
  { vrednost: "svetla", naziv: "Svetla", Ikona: Sun },
  { vrednost: "tamna", naziv: "Tamna", Ikona: Moon },
];

export function PrekidacTeme({ className }: { className?: string }) {
  const { tema, postaviTemu } = useTema();
  const index = OPCIJE.findIndex((o) => o.vrednost === tema);

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cn(
        "relative grid grid-cols-3 gap-0.5 rounded-full border border-border bg-muted/60 p-1",
        className,
      )}
    >
      {/* Indikator je jedan element koji klizi, ne tri pozadine koje se pale. */}
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-card shadow-sm ring-1 ring-border transition-transform duration-200 ease-out"
        style={{ transform: `translateX(calc(${Math.max(index, 0)} * 100%))` }}
      />

      {OPCIJE.map(({ vrednost, naziv, Ikona }) => {
        const aktivna = vrednost === tema;
        return (
          <button
            key={vrednost}
            type="button"
            role="radio"
            aria-checked={aktivna}
            title={naziv}
            onClick={() => postaviTemu(vrednost)}
            className={cn(
              "relative z-10 flex h-7 items-center justify-center rounded-full text-xs font-medium transition-colors",
              aktivna ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Ikona className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="sr-only">{naziv}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PrekidacTemeDugme({ className }: { className?: string }) {
  const { tema, stvarna, postaviTemu } = useTema();
  const Trenutna = stvarna === "tamna" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Promeni temu"
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground",
          className,
        )}
      >
        <Trenutna className="h-4 w-4" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-40">
        {OPCIJE.map(({ vrednost, naziv, Ikona }) => (
          <DropdownMenuItem
            key={vrednost}
            onSelect={() => postaviTemu(vrednost)}
            className={cn(vrednost === tema && "text-accent-foreground")}
          >
            <Ikona className="h-4 w-4" />
            {naziv}
            {vrednost === tema && <span className="ml-auto text-xs">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
