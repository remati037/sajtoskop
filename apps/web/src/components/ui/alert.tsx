// apps/web/src/components/ui/alert.tsx
// Poruka korisniku. Do redizajna je svaki ekran imao svoju verziju istog
// crvenog/zelenog pravougaonika — pet kopija istih klasa.
//
// Ikonica je deo poruke, ne ukras: crvena i zelena se ne razlikuju kod svakog
// desetog muškarca, pa oblik mora da nosi isto značenje kao boja.

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const alertVarijante = cva(
  "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4",
  {
    variants: {
      variant: {
        info: "border-info/25 bg-info-wash text-info-text",
        success: "border-accent/25 bg-accent-wash text-accent-text",
        warning: "border-warn/30 bg-warn-wash text-warn-text",
        danger: "border-danger/25 bg-danger-wash text-danger",
        neutral: "border-border bg-bg-subtle text-fg",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const IKONA = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: Info,
} as const;

export type AlertProps = React.ComponentProps<"div"> &
  VariantProps<typeof alertVarijante> & {
    /** Isključi ikonicu kad poruka stoji unutar uže kartice. */
    bezIkonice?: boolean;
  };

export function Alert({ className, variant, bezIkonice, children, ...props }: AlertProps) {
  const Ikona = IKONA[variant ?? "info"];

  return (
    // [Faza 4, 4.8] Danger se najavljuje ODMah (`role="alert"`), sve ostalo
    // „uljudno" (`role="status"`) — čitač ekrana ne sme da pročita grešku
    // kao obaveštenje (nalaz 7.3.1).
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={cn(alertVarijante({ variant }), className)}
      {...props}
    >
      {!bezIkonice && <Ikona className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
