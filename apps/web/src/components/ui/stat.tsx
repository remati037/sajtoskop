// apps/web/src/components/ui/stat.tsx
// Brojka sa kontekstom. Isti oblik na kontrolnoj tabli i na kreditima, jer to
// jesu isti podaci gledani iz dva ugla.
//
// Traka ispod broja se crta samo kad postoji granica: „12 kredita" ništa ne
// znači, „12 od 30" i tri četvrtine prazne trake znače sve.

import { cn } from "@/lib/cn";

export function StatKartica({
  naslov,
  vrednost,
  podnaslov,
  ikona,
  odUkupno,
  className,
  num = true,
}: {
  naslov: string;
  vrednost: string;
  podnaslov?: string;
  ikona?: React.ReactNode;
  /** `[iskorišćeno, granica]` — crta traku napunjenosti. */
  odUkupno?: [number, number];
  className?: string;
  // [Faza 5, 5.5] Vrednost koja NIJE broj (npr. „beta") ne sme da nosi .num —
  // cifre dobijaju istu širinu, reči ne smeju (D7).
  num?: boolean;
}) {
  const procenat =
    odUkupno && odUkupno[1] > 0
      ? Math.min(100, Math.max(0, Math.round((odUkupno[0] / odUkupno[1]) * 100)))
      : null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-bg-elev p-4 shadow-sm transition-shadow hover:shadow-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
          {naslov}
        </dt>
        {ikona && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent-text [&_svg]:h-3.5 [&_svg]:w-3.5">
            {ikona}
          </span>
        )}
      </div>

      <dd className={cn("mt-2 text-2xl font-semibold tracking-tight", num && "num")}>
        {vrednost}
      </dd>
      {podnaslov && <dd className="mt-0.5 text-xs text-fg-muted">{podnaslov}</dd>}

      {procenat !== null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-bg-inset">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${procenat}%` }}
          />
        </div>
      )}
    </div>
  );
}
