// apps/web/src/components/znak.tsx
// Znak proizvoda: lupa u kojoj stoji prozor sajta. Doslovno ono što alat radi —
// gleda tuđi sajt izbliza.
//
// Inline SVG, ne slika: znak stoji u sidebar-u, na landing-u i na ekranima za
// prijavu, mora da nasledi boju i da ostane oštar na svakom ekranu.

import { cn } from "@/lib/cn";

export function Znak({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-white shadow-glow",
        "bg-[linear-gradient(140deg,oklch(0.62_0.2_290),oklch(0.48_0.19_275))]",
        className,
      )}
    >
      {/* Tanka svetla ivica po gornjoj strani — znak deluje kao dugme od stakla,
          ne kao obojen kvadrat. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/25"
      />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="h-[55%] w-[55%]"
        strokeWidth={2.1}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="10.5" cy="10.5" r="7" />
        <path d="M4.4 7.8h12.2" />
        <path d="M15.8 15.8 21 21" />
      </svg>
    </span>
  );
}

export function ZnakSaImenom({
  className,
  imeKlase,
}: {
  className?: string;
  imeKlase?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Znak />
      <span className={cn("text-[15px] font-semibold tracking-tight", imeKlase)}>
        Sajtoskop
      </span>
    </span>
  );
}
