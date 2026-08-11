// apps/web/src/components/ui/input.tsx
// Polje za unos i etiketa uz njega. Fokus se vidi kao prsten u boji brenda —
// isti prsten kao na dugmadima, da ceo obrazac deluje kao jedan sistem.

import { cn } from "@/lib/cn";

export const poljeKlase =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(poljeKlase, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(poljeKlase, "h-auto py-2 leading-relaxed", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("mb-1.5 block text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}
