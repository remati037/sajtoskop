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
}: {
  naslov: string;
  vrednost: string;
  podnaslov?: string;
  ikona?: React.ReactNode;
  /** `[iskorišćeno, granica]` — crta traku napunjenosti. */
  odUkupno?: [number, number];
  className?: string;
}) {
  const procenat =
    odUkupno && odUkupno[1] > 0
      ? Math.min(100, Math.max(0, Math.round((odUkupno[0] / odUkupno[1]) * 100)))
      : null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {naslov}
        </dt>
        {ikona && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:h-3.5 [&_svg]:w-3.5">
            {ikona}
          </span>
        )}
      </div>

      <dd className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{vrednost}</dd>
      {podnaslov && <dd className="mt-0.5 text-xs text-muted-foreground">{podnaslov}</dd>}

      {procenat !== null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,oklch(0.62_0.2_290),oklch(0.5_0.19_275))] transition-[width] duration-500"
            style={{ width: `${procenat}%` }}
          />
        </div>
      )}
    </div>
  );
}
