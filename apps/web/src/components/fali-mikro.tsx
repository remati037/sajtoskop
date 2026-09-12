"use client";

// apps/web/src/components/fali-mikro.tsx
// „Šta ti ovde fali?" ispod praznog stanja (S29 §5.3 C).
//
// ── zašto omotač, a ne `UtisakMikro` direktno ────────────────
// `UtisakMikro` crta pitanje koje je motor VEĆ pustio; nekome mora da ostane
// posao da motoru javi da se prazno stanje desilo. Do S29 je to radio ekran
// sam, ali `fali` stoji na četiri mesta — od kojih su tri server komponente —
// pa bi to značilo četiri `useEffect`-a sa istim telom i četiri prilike da se
// jedan zaboravi.
//
// ── ekran prijavljuje, motor odlučuje ────────────────────────
// Ovde nema nijedne provere cooldowna, ćutanja ni istorije. Sve to je u
// `odluci()` (F11 §3.2), i tamo mora da ostane: ekran koji sam odlučuje da je
// „sad zgodan trenutak" je peti takav ekran koji se ne slaže sa ostala četiri.
//
// Jedini uslov koji JESTE ovde je `posleDana`, i to zato što nije pravilo motora
// nego svojstvo MESTA: prazna lista trećeg dana je normalna (čovek još nije
// stigao da otključa), a prazna lista desetog dana je pitanje. Prazna pretraga
// nema taj problem i zato nema ni uslov.

import { useEffect } from "react";
import { useUtisci } from "./utisci-provider";
import { UtisakMikro } from "./utisak-mikro";

export function FaliMikro({
  /**
   * Šta je korisnik tražio kad je rezultat bio prazan. Ulazi u `answers.query`
   * i time u admin listu — spisak niša koje ljudi traže a ja ih nemam.
   */
  query,
  /**
   * Pitanje se javlja tek posle ovoliko dana od registracije. `0` znači odmah.
   *
   * Prag je nad `uslovi` koje motor ionako čita sa servera, pa ovo ne košta
   * nijedan dodatan upit (F11 §3.3).
   */
  posleDana = 0,
  className,
}: {
  query?: string;
  posleDana?: number;
  className?: string;
}) {
  const utisci = useUtisci();
  const dana = utisci?.uslovi.danaOdRegistracije ?? 0;
  const prijavi = utisci?.prijaviDogadjaj;
  const dovoljnoStar = dana >= posleDana;

  useEffect(() => {
    if (!prijavi || !dovoljnoStar) return;
    // Upit se prosleđuje kao dodatak uz odgovor; motor ga ne gleda, a šema iz
    // kataloga ga propušta samo uz tekst (pravilo 16).
    prijavi("fali", query ? { query } : undefined);
  }, [prijavi, dovoljnoStar, query]);

  if (!dovoljnoStar) return null;
  return <UtisakMikro kljuc="fali" {...(className ? { className } : {})} />;
}
