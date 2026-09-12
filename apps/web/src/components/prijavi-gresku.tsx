"use client";

// apps/web/src/components/prijavi-gresku.tsx
// „Prijavi grešku" — link koji otvara panel utiska sa mesta gde je greška
// nastala (S29 §5.3 D).
//
// ── zašto link, a ne svoja forma ─────────────────────────────
// Forma za prijavu kvara već postoji, iza plutajućeg dugmeta, i već ume sve što
// treba: ocenu, tekst, tip, sliku i dnevnik klijentskih grešaka. Druga forma na
// pet mesta bi značila pet kopija istog koda i pet mesta na kojima se kopi
// raziđe. Ovde se prenosi samo KONTEKST — i to isključivo identifikatori.
//
// ── šta ovaj fajl NE šalje ───────────────────────────────────
// Ni plan, ni stanje pristupa, ni status posla, ni poruku greške. Sve to čita
// server iz baze (`zabelezi_utisak`, migracija 0027) u trenutku upisa. Ekran
// koji sam prijavljuje da mu je posao pao je ekran čijoj tvrdnji nema ko da
// veruje (pravilo 8).
//
// Van `UtisciProvider`-a se ne prikazuje ništa: link koji ništa ne otvara je
// gori od odsutnog linka.

import { Bug } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUtisci, type KontekstGreske } from "./utisci-provider";

export function PrijaviGresku({
  ctx,
  className,
  label = "Prijavi grešku",
}: {
  /** Samo identifikatori: `placeId`, `jobId`, `korak`. */
  ctx: KontekstGreske;
  className?: string;
  label?: string;
}) {
  const utisci = useUtisci();
  if (!utisci) return null;

  return (
    <button
      type="button"
      onClick={() => utisci.otvoriBug(ctx)}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline",
        className,
      )}
    >
      <Bug className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
