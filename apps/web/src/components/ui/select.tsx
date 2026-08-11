"use client";

// apps/web/src/components/ui/select.tsx
// Zamena za `<select>` u filterima. Nativni select se ne može stilizovati, a u
// tamnoj temi na Windows-u ume da se otvori kao bela lista na crnoj stranici.
//
// `Izbor` ispod je omotač koji pokriva jedini oblik koji nam treba: etiketa,
// stavka „sve", pa lista opcija.

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Label } from "./input";

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex h-10 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-2 focus:ring-primary/25 data-[placeholder]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        className={cn(
          "z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-pop data-[state=open]:animate-uklizi",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-0">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-hover data-[state=checked]:font-medium",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-primary" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

/**
 * Filter po jednoj koloni: „Svi gradovi" + lista.
 *
 * Prazan string je u Radix Select-u nedozvoljena vrednost stavke, pa se „sve"
 * interno vodi kao `__sve__`, a napolje i dalje izlazi prazan string — tako
 * pozivaoci ostaju isti kao sa nativnim `<select>`-om.
 */
const SVE = "__sve__";

export function Izbor({
  naziv,
  vrednost,
  postavi,
  opcije,
  sve,
  className,
}: {
  naziv: string;
  vrednost: string;
  postavi: (v: string) => void;
  opcije: { slug: string; label: string }[];
  sve: string;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <Label>{naziv}</Label>
      <Select value={vrednost || SVE} onValueChange={(v) => postavi(v === SVE ? "" : v)}>
        <SelectTrigger className="w-full min-w-[9rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SVE}>{sve}</SelectItem>
          {opcije.map((o) => (
            <SelectItem key={o.slug} value={o.slug}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
