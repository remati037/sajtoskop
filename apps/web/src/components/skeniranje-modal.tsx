"use client";

// apps/web/src/components/skeniranje-modal.tsx
// Potvrda pre nego što se skine kredit za skeniranje (F9 §4.2).
//
// Isti obrazac kao otključavanje: korisnik vidi šta plaća, koliko ima i koliko
// mu ostaje, pre nego što se ijedan kredit pomeri.
//
// Četiri razloga zbog kojih se ovaj modal otvara imaju četiri različita teksta,
// i to nije ukras (F9, odluka 8): „nije u kešu" i „bilo je besplatno, isteklo
// je" su za korisnika različite vesti, treće — ručno osvežavanje nečega što još
// važi — mora jasno da kaže da plaća nešto što bi inače imao badava, a četvrto
// je od S17: kombinacija JESTE u kešu i JESTE sveža, ali plića od tražene
// dubine. To je jedini slučaj u kome korisnik plaća a podaci nisu stari, pa mu
// se mora reći tačno šta kupuje — stranice, ne svežinu.
//
// [S17] Nijedan naslov ni dugme više ne piše „1 kredit". Cena dolazi iz
// `predlog.cost` (1 / 2 / 3, po izabranoj dubini) i prolazi kroz `plural` —
// „2 kredita", ne „2 kredit".

import { Layers, RefreshCw, Search, Zap } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { formatDatum, plural } from "@/lib/ui-tekst";

export type SkeniranjeRazlog = "prvo" | "isteklo" | "rucno" | "plice";

export type SkeniranjePredlog = {
  razlog: SkeniranjeRazlog;
  /** Cena izabrane dubine u kreditima: 1 „Brzo", 2 „Standardno", 3 „Duboko". */
  cost: number;
  /** Šta piše na dugmetu dubine — „Brzo" / „Standardno" / „Duboko". */
  dubinaLabela: string;
  /** Do koliko prospekata izabrana dubina ide (20 / 40 / 60). */
  maxRezultata: number;
  /**
   * [S17] Koliko je stranica u kešu, kad je razlog `plice`. `null` inače.
   * Ovo je jedini broj koji objašnjava zašto se plaća nešto što nije staro.
   */
  kesiranaDubina: number | null;
  /** Kad je kombinacija poslednji put skenirana. `null` za prvo skeniranje. */
  lastScannedAt: string | null;
  creditsLeft: number;
  cityLabel: string;
  nicheLabel: string;
};

type Props = {
  predlog: SkeniranjePredlog | null;
  ceka: boolean;
  onPotvrdi: () => void;
  onOdustani: () => void;
};

/** „2 kredita", nikad „2 kredit". Jedna funkcija za naslov, dugme i tabelu. */
function kredita(n: number): string {
  return `${n} ${plural(n, "kredit", "kredita", "kredita")}`;
}

const RADNJA: Record<SkeniranjeRazlog, string> = {
  prvo: "Skeniranje",
  isteklo: "Osvežavanje",
  rucno: "Ponovno skeniranje",
  plice: "Dublje skeniranje",
};

const POTVRDA_GLAGOL: Record<SkeniranjeRazlog, string> = {
  prvo: "Skeniraj",
  isteklo: "Osveži",
  rucno: "Skeniraj ponovo",
  plice: "Skeniraj dublje",
};

export function SkeniranjeModal({ predlog, ceka, onPotvrdi, onOdustani }: Props) {
  if (!predlog) return null;

  const { razlog } = predlog;
  const dovoljno = predlog.creditsLeft >= predlog.cost;
  const posle = predlog.creditsLeft - predlog.cost;
  const datum = predlog.lastScannedAt ? formatDatum(predlog.lastScannedAt) : null;

  const Ikona =
    razlog === "prvo" ? Search
    : razlog === "isteklo" ? Zap
    : razlog === "plice" ? Layers
    : RefreshCw;

  return (
    <Dialog open onOpenChange={(o) => !o && onOdustani()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {RADNJA[razlog]} košta <span className="num">{kredita(predlog.cost)}</span>
          </DialogTitle>
          <DialogDescription>
            {predlog.cityLabel} · {predlog.nicheLabel} ·{" "}
            <span className="num">{predlog.dubinaLabela}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4 text-sm">
          <p className="text-fg-muted">
            {razlog === "prvo" && (
              <>Ova kombinacija još nije u kešu. Google se poziva uživo i to traje do dva minuta.</>
            )}
            {razlog === "isteklo" && (
              <>
                Podaci su poslednji put povučeni <span className="num">{datum}</span> i stariji su
                od 30 dana, pa se više ne prikazuju. Google se poziva iznova.
              </>
            )}
            {razlog === "rucno" && (
              <>
                Podaci su od <span className="num">{datum}</span> i još važe — ovo skeniranje nije
                neophodno. Povlači sveže stanje sa Google Maps-a i pomera rok za novih 30 dana.
              </>
            )}
            {razlog === "plice" && (
              <>
                Ova kombinacija JESTE u kešu i podaci nisu stari — skenirana je{" "}
                <span className="num">{datum}</span>, ali samo{" "}
                <span className="num">
                  {predlog.kesiranaDubina ?? 1}{" "}
                  {plural(predlog.kesiranaDubina ?? 1, "stranicu", "stranice", "stranica")}
                </span>
                . Za{" "}
                <span className="num">
                  {predlog.dubinaLabela.toLowerCase()} (do {predlog.maxRezultata} prospekata)
                </span>{" "}
                Google mora da se pozove ponovo, i to se plaća.
              </>
            )}{" "}
            Posle skeniranja je ova kombinacija besplatna svima narednih 30 dana —
            do te dubine.
          </p>

          <dl className="grid grid-cols-2 gap-y-2 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-xs">
            <dt className="text-fg-muted">Dubina</dt>
            <dd className="num text-right font-medium">
              {predlog.dubinaLabela} · do {predlog.maxRezultata}
            </dd>

            <dt className="text-fg-muted">
              Cena{" "}
              <span className="text-[11px]">
                ({predlog.cost} {plural(predlog.cost, "stranica", "stranice", "stranica")})
              </span>
            </dt>
            <dd className="num text-right font-medium">{kredita(predlog.cost)}</dd>

            <dt className="text-fg-muted">Imaš</dt>
            <dd className="num text-right font-medium">{predlog.creditsLeft}</dd>

            <dt className="text-fg-muted">Posle skeniranja</dt>
            <dd className="num text-right font-medium">{dovoljno ? posle : "—"}</dd>
          </dl>

          {!dovoljno ? (
            <p className="text-xs text-danger">
              Nemaš dovoljno kredita za ovu dubinu
              {predlog.cost > 1 ? " — probaj plići izbor" : ""}. Pretrage iz keša su i dalje
              besplatne.
            </p>
          ) : (
            <p className="text-xs text-fg-muted">
              Ako Google ne nađe nijednu firmu,{" "}
              {predlog.cost === 1 ? "kredit ti se vraća" : `sva ${predlog.cost} kredita ti se vraćaju`}.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" onClick={onOdustani} disabled={ceka}>
            Odustani
          </Button>
          <Button type="button" variant="primary" onClick={onPotvrdi} disabled={ceka || !dovoljno}>
            <Ikona className="h-4 w-4" />
            {ceka ? "Pokrećem…" : `${POTVRDA_GLAGOL[razlog]} za ${kredita(predlog.cost)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
