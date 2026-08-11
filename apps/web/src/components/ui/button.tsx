// apps/web/src/components/ui/button.tsx
// Jedno dugme za ceo proizvod. Varijante nose značenje, ne ukus:
//   primary   — jedina radnja koja košta kredit ili pravi posao
//   secondary — obična radnja na površini kartice
//   outline   — radnja u tabeli i pored teksta
//   ghost     — ikonice u trakama
//   danger    — nepovratno
//
// Sve varijante dele istu visinu i isti radijus, jer se u ovom proizvodu
// najčešće nalaze jedna do druge u istom redu.

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const dugmeVarijante = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,border-color,transform] duration-150 outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:h-4 [&_svg:not([class*='size-'])]:w-4 active:translate-y-px",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-sm hover:brightness-110 hover:shadow-glow",
        secondary:
          "bg-surface text-foreground ring-1 ring-inset ring-border hover:bg-surface-hover hover:ring-border-strong",
        outline:
          "border border-border bg-card text-foreground shadow-xs hover:border-border-strong hover:bg-surface",
        ghost: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
        danger: "bg-danger text-white shadow-sm hover:brightness-110",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-11 px-5",
        icon: "h-9 w-9 p-0",
        "icon-sm": "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type DugmeProps = React.ComponentProps<"button"> &
  VariantProps<typeof dugmeVarijante> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: DugmeProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(dugmeVarijante({ variant, size }), className)} {...props} />;
}

export { dugmeVarijante };
