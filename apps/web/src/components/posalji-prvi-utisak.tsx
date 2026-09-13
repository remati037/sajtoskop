"use client";

// apps/web/src/components/posalji-prvi-utisak.tsx
// „Pošalji prvi utisak" na praznom „Moje prijave" (S30, §4.7).
//
// Otvara ISTI panel iza plutajućeg dugmeta — ne svoju formu. Strana `/utisci`
// je server komponenta, pa joj treba ovaj mali klijentski most do provider-a.

import { useUtisci } from "./utisci-provider";
import { Button } from "./ui/button";

export function PosaljiPrviUtisak() {
  const utisci = useUtisci();
  if (!utisci) return null;

  return (
    <Button type="button" variant="primary" onClick={utisci.otvoriUtisak}>
      Pošalji prvi utisak
    </Button>
  );
}
