// apps/web/src/lib/cn.ts
// Spajanje Tailwind klasa: `clsx` rešava uslovne klase, `twMerge` rešava sudare
// (`px-3` posle `px-2` mora da pobedi, inače varijante komponenti ne rade).

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
