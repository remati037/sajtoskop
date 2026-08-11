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
        neutral: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
        outline: "text-muted-foreground ring-1 ring-inset ring-border",
        primary: "bg-primary-soft text-accent-foreground ring-1 ring-inset ring-primary/20",
        success: "bg-success-soft text-success-foreground ring-1 ring-inset ring-success/25",
        warning: "bg-warning-soft text-warning-foreground ring-1 ring-inset ring-warning/25",
        danger: "bg-danger-soft text-danger-foreground ring-1 ring-inset ring-danger/25",
        info: "bg-info-soft text-info-foreground ring-1 ring-inset ring-info/25",
        "jak-success": "bg-success text-white shadow-xs",
        "jak-warning": "bg-warning text-[oklch(0.25_0.06_70)] shadow-xs",
        "jak-info": "bg-info text-white shadow-xs",
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
