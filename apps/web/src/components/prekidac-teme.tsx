"use client";

// Prekidač teme. Dve pojave istog stanja:
//   `PrekidacTeme`        — segmentna traka sa dva polja, stoji u sidebar-u
//   `PrekidacTemeDugme`   — jedno dugme, za gornju traku na telefonu
//
// Od izbacivanja stanja „sistem" (v. `lib/tema.ts`) polja su dva, pa dugme na
// telefonu više ne otvara meni nego prosto prebacuje temu — meni sa dve stavke
// od kojih je jedna već aktivna je dva klika za ono što je jedan.
//
// Klizni indikator iza aktivnog polja je jedini deo koji nije čisti CSS hover:
// prelaz od 200 ms je razlika između „prekidača" i „dugmadi koja se pale".

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { TEME, type Tema } from "@/lib/tema";
import { useTema } from "./tema-provider";

const OPCIJE: Record<Tema, { naziv: string; Ikona: typeof Sun }> = {
  tamna: { naziv: "Tamna", Ikona: Moon },
  svetla: { naziv: "Svetla", Ikona: Sun },
};

export function PrekidacTeme({ className }: { className?: string }) {
  const { tema, postaviTemu } = useTema();
  const index = Math.max(TEME.indexOf(tema), 0);

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      // [Faza 4, 4.8] Roving tabindex: Tab ulazi u celu grupu, a strelice
      // pomeraju izbor (nalaz 7.3.4). Tastatura menja temu isto kao klik.
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const trenutni = Math.max(TEME.indexOf(tema), 0);
        const sledeci =
          e.key === "ArrowRight"
            ? (trenutni + 1) % TEME.length
            : (trenutni - 1 + TEME.length) % TEME.length;
        postaviTemu(TEME[sledeci] ?? TEME[0]);
      }}
      className={cn(
        // Segmentni prekidač je kontrola: i staza i klizač idu `--border-strong`
        // (§3.2.1). Podloga `--bg-inset/60` je 1.1:1 prema strani, pa oblik nosi
        // isključivo linija.
        "relative grid grid-cols-2 gap-0.5 rounded-full border border-border-strong bg-bg-inset/60 p-1",
        className,
      )}
    >
      {/* Indikator je jedan element koji klizi, ne dve pozadine koje se pale.
          Pomeraj uključuje i razmak (`gap-0.5` = 0.125rem), inače drugo polje
          promaši za tu širinu — sa dva polja se to vidi. */}
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc((100%-0.625rem)/2)] rounded-full bg-bg-elev shadow-sm ring-1 ring-border-strong transition-transform duration-200 ease-out"
        style={{ transform: `translateX(calc(${index} * (100% + 0.125rem)))` }}
      />

      {TEME.map((vrednost) => {
        const { naziv, Ikona } = OPCIJE[vrednost];
        const aktivna = vrednost === tema;

        return (
          <button
            key={vrednost}
            type="button"
            role="radio"
            aria-checked={aktivna}
            // [Faza 4, 4.8] Roving tabindex: samo aktivno polje je u Tab redu.
            tabIndex={aktivna ? 0 : -1}
            title={naziv}
            onClick={() => postaviTemu(vrednost)}
            className={cn(
              "relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-colors",
              aktivna ? "text-fg" : "text-fg-muted hover:text-fg",
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

/**
 * Jedno dugme koje prebacuje temu. Ikonica pokazuje temu na koju se prelazi, ne
 * trenutnu — dugme obećava radnju, a ne stanje.
 */
export function PrekidacTemeDugme({ className }: { className?: string }) {
  const { tema, postaviTemu } = useTema();
  const sledeca: Tema = tema === "tamna" ? "svetla" : "tamna";
  const { naziv, Ikona } = OPCIJE[sledeca];

  return (
    <button
      type="button"
      onClick={() => postaviTemu(sledeca)}
      aria-label={`Uključi ${naziv.toLowerCase()} temu`}
      title={`${naziv} tema`}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg",
        className,
      )}
    >
      <Ikona className="h-4 w-4" />
    </button>
  );
}
