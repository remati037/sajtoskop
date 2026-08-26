// apps/web/src/lib/navigacija.ts
// Jedan spisak ruta za sidebar, mobilni meni i naslov u gornjoj traci.
//
// Redosled je redosled rada: nađi → otključaj → vodi kroz pipeline. Nalog stoji
// odvojeno, jer se tamo ne radi nego proverava.

import {
  Coins,
  CreditCard,
  Inbox,
  LayoutDashboard,
  ListChecks,
  KanbanSquare,
  Search,
} from "lucide-react";

export type NavStavka = {
  href: string;
  label: string;
  Ikona: typeof Search;
  /** Kratko objašnjenje u tooltip-u kad je sidebar skupljen. */
  opis: string;
};

export type NavGrupa = { naslov: string; stavke: NavStavka[] };

export const NAVIGACIJA: NavGrupa[] = [
  {
    naslov: "Rad",
    stavke: [
      { href: "/pretraga", label: "Pretraga", Ikona: Search, opis: "Nađi prospekte po gradu i niši" },
      { href: "/lista", label: "Moja lista", Ikona: ListChecks, opis: "Otključani prospekti i CSV" },
      { href: "/pipeline", label: "Pipeline", Ikona: KanbanSquare, opis: "Kanban od kontakta do potpisa" },
    ],
  },
  {
    naslov: "Nalog",
    stavke: [
      { href: "/krediti", label: "Krediti", Ikona: Coins, opis: "Stanje i izvod iz knjige" },
      {
        href: "/utisci",
        label: "Moje prijave",
        Ikona: Inbox,
        opis: "Tvoje prijave i njihovi ishodi",
      },
      {
        href: "/dashboard",
        label: "Kontrolna tabla",
        Ikona: LayoutDashboard,
        opis: "Plan, limiti i stanje naloga",
      },
      // S21: do ove isporuke `/cenovnik` nije bio linkovan NIOTKUDA u
      // aplikaciji — do njega se stizalo samo iz banera isteklog pristupa,
      // dakle tek kad je već kasno. Stoji u grupi „Nalog", uz kredite, jer je
      // to i pitanje na koje odgovara: „kako da ih dobijem još".
      //
      // Vodi IZVAN okvira aplikacije (`/cenovnik` je namerno van grupe `(app)`,
      // da bi radio i gostu), pa se posle klika gubi bočna traka. To je u redu:
      // ekran cena ima svoje zaglavlje i povratak u aplikaciju.
      {
        href: "/cenovnik",
        label: "Planovi i cene",
        Ikona: CreditCard,
        opis: "Pretplata i paketi kredita",
      },
    ],
  },
];

export const SVE_STAVKE: NavStavka[] = NAVIGACIJA.flatMap((g) => g.stavke);

/** Naslov za gornju traku. Najduži poklopljeni prefiks, da i podrute rade. */
export function naslovZaPutanju(putanja: string): string {
  const pogodak = SVE_STAVKE.filter(
    (s) => putanja === s.href || putanja.startsWith(`${s.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];

  return pogodak?.label ?? "Sajtoskop";
}
