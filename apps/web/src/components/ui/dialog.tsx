"use client";

// apps/web/src/components/ui/dialog.tsx
// Modal preko Radix-a — zbog onoga što ručni `<div className="fixed inset-0">`
// nikad nije radio: hvatanje fokusa, Escape, `aria-modal`, zaključavanje skrola
// ispod i vraćanje fokusa na dugme koje je modal otvorilo.

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-[oklch(0.15_0.02_272/0.55)] backdrop-blur-sm data-[state=open]:animate-pojavi",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      {/* Modal se u ovom proizvodu često puni snimcima i tabelama, pa ne stoji
          centriran po vertikali nego klizi odozgo i sam skroluje. */}
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <DialogPrimitive.Content
          className={cn(
            "relative my-auto w-full max-w-2xl rounded-2xl border border-border bg-card text-card-foreground shadow-pop outline-none data-[state=open]:animate-uklizi",
            className,
          )}
          {...props}
        >
          {children}

          {showClose && (
            <DialogPrimitive.Close
              aria-label="Zatvori"
              className="absolute right-3.5 top-3.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1 border-b border-border px-5 py-4 pr-14", className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("truncate text-base font-semibold", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
