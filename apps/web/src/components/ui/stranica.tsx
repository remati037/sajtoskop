// apps/web/src/components/ui/stranica.tsx
// Okvir jedne stranice: naslov, rečenica ispod, radnje desno — i prazno stanje
// koje izgleda isto na svih pet ekrana.
//
// Ovo je jedini razlog zbog kog ekrani mogu da budu kratki: svaki od njih je do
// redizajna imao svoj `<header>` sa istim, ali malo drugačijim klasama.

import { cn } from "@/lib/cn";

export function ZaglavljeStranice({
  naslov,
  opis,
  children,
  className,
}: {
  naslov: string;
  opis?: React.ReactNode;
  /** Radnje sa desne strane naslova. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn("mb-7 flex flex-wrap items-start justify-between gap-4", className)}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{naslov}</h1>
        {opis && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{opis}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function PraznoStanje({
  ikona,
  naslov,
  opis,
  children,
  className,
}: {
  ikona?: React.ReactNode;
  naslov: string;
  opis?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center",
        className,
      )}
    >
      {ikona && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-accent-foreground [&_svg]:h-5 [&_svg]:w-5">
          {ikona}
        </div>
      )}
      <p className="text-base font-medium">{naslov}</p>
      {opis && <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">{opis}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** Sekcija sa naslovom u tabelama i knjigama — manja od naslova stranice. */
export function NaslovSekcije({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
