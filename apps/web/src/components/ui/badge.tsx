// apps/web/src/components/ui/badge.tsx
// Bedž nosi stanje, nikad ukras.
//
// `jak` varijante su za `NEMA SAJT` i `MRTAV DOMEN` — to su najbolji leadovi i
// jedino mesto u proizvodu gde boja sme da viče (F2 §5).

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const bedzVarijante = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium leading-none transition-colors [&_svg]:h-3 [&_svg]:w-3",
  {
    variants: {
      variant: {
        neutral: "bg-bg-inset text-fg-muted ring-1 ring-inset ring-border",
        outline: "text-fg-muted ring-1 ring-inset ring-border",
        primary: "bg-accent-wash text-accent-text ring-1 ring-inset ring-accent/20",
        success: "bg-accent-wash text-accent-text ring-1 ring-inset ring-accent/25",
        warning: "bg-warn-wash text-warn-text ring-1 ring-inset ring-warn/25",
        danger: "bg-danger-wash text-danger ring-1 ring-inset ring-danger/25",
        info: "bg-info-wash text-info-text ring-1 ring-inset ring-info/25",
        "jak-success": "bg-accent text-accent-ink shadow-sm",
        "jak-warning": "bg-warn text-warn-ink shadow-sm",
        "jak-info": "bg-info text-info-ink shadow-sm",
      },
      size: {
        sm: "px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
        md: "px-2 py-1 text-[11px]",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export type BedzProps = React.ComponentProps<"span"> & VariantProps<typeof bedzVarijante>;

export function Badge({ className, variant, size, ...props }: BedzProps) {
  return <span className={cn(bedzVarijante({ variant, size }), className)} {...props} />;
}
