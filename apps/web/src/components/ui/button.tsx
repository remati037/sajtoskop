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
        // §7.1: akcentna podloga, `--accent-ink` tekst, `--shadow-accent` stalno
        // (ne tek na hover) — primarno dugme je jedino koje sme da svetli.
        // Hover menja podlogu na `--accent-hover`, ne `brightness`: filter bi
        // razvukao i senku.
        // `disabled:shadow-none` je obavezno: `opacity` ne dira box-shadow, pa
        // isključeno dugme inače i dalje svetli zeleno kao da poziva na klik.
        primary:
          "bg-accent text-accent-ink shadow-accent hover:bg-accent-hover disabled:shadow-none",
        secondary:
          "bg-bg-subtle text-fg ring-1 ring-inset ring-border hover:bg-bg-hover hover:ring-border-strong",
        outline:
          "border border-border bg-bg-elev text-fg shadow-sm hover:border-border-strong hover:bg-bg-subtle",
        ghost: "text-fg-muted hover:bg-bg-hover hover:text-fg",
        // §7.1: destruktivna radnja je ghost dugme sa `--danger` tekstom, nikad
        // crveni fill. Crveni pravougaonik na ekranu vuče oko jače nego radnja
        // koja se stvarno traži od korisnika.
        danger: "text-danger hover:bg-danger-wash",
        link: "text-accent-text underline-offset-4 hover:underline",
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
