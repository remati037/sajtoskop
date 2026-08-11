// apps/web/src/components/znak.tsx
// Znak proizvoda po `docs/DIZAJN-SISTEM.md` §2: lupa/nišan — prsten sa metom u
// centru i drškom.
//
// Inline SVG, ne slika: znak stoji u bočnoj traci, na ekranu za prijavu i u
// praznim stanjima, mora da nasledi boju teksta i da ostane oštar na svakom
// ekranu.
//
// Meta je jedini deo u akcentnoj boji — ostalo je `currentColor` da radi na obe
// teme. Nikad ne prebojavaj ceo znak u zeleno.

import { cn } from "@/lib/cn";

export function Znak({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      strokeLinecap="round"
      className={cn("h-[22px] w-[22px] shrink-0 text-fg", className)}
    >
      {/* prsten „skopa" */}
      <circle cx="10.5" cy="10.5" r="7.25" stroke="currentColor" strokeWidth="1.6" opacity="0.9" />
      <circle cx="10.5" cy="10.5" r="3.6" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      {/* nišan */}
      <path
        d="M10.5 1.6v3.1M10.5 16.3v3.1M1.6 10.5h3.1M16.3 10.5h3.1"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.55"
      />
      {/* drška */}
      <path d="M15.9 15.9 21.4 21.4" stroke="currentColor" strokeWidth="1.9" />
      {/* meta */}
      <circle cx="10.5" cy="10.5" r="1.9" fill="var(--accent)" />
    </svg>
  );
}

/**
 * Znak uz wordmark. Wordmark je **uvek mala slova** — u rečenici se piše
 * „Sajtoskop", ali logo nikad ne dobija veliko S (§2).
 *
 * Rotacija na hover je namerna sitnica; `group` stoji na samom znaku da radi i
 * kad ga pozivalac ne umota u link.
 */
export function ZnakSaImenom({
  className,
  imeKlase,
}: {
  className?: string;
  imeKlase?: string;
}) {
  return (
    <span className={cn("group inline-flex items-center gap-2.5", className)}>
      <Znak className="transition-transform duration-300 group-hover:rotate-[-12deg]" />
      <span className={cn("text-[15px] font-semibold tracking-[-0.03em] text-fg", imeKlase)}>
        sajtoskop
      </span>
    </span>
  );
}
