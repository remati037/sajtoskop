"use client";

// apps/web/src/components/ui/tooltip.tsx
// Postoji zbog skupljenog sidebar-a: kad ostane samo ikonica, natpis mora negde
// da se pojavi. `title` atribut kasni sekundu i po i ne poštuje temu.

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md data-[state=delayed-open]:animate-pojavi",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
