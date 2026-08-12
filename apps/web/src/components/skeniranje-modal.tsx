"use client";

// apps/web/src/components/skeniranje-modal.tsx
// Potvrda pre nego što se skine kredit za skeniranje (F9 §4.2).
//
// Isti obrazac kao otključavanje: korisnik vidi šta plaća, koliko ima i koliko
// mu ostaje, pre nego što se ijedan kredit pomeri.
//
// Tri razloga zbog kojih se ovaj modal otvara imaju tri različita teksta, i to
// nije ukras (F9, odluka 8): „nije u kešu" i „bilo je besplatno, isteklo je" su
// za korisnika različite vesti, a treće — ručno osvežavanje nečega što još važi
// — mora jasno da kaže da plaća nešto što bi inače imao badava.

import { RefreshCw, Search, Zap } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { formatDatum, plural } from "@/lib/ui-tekst";

export type SkeniranjeRazlog = "prvo" | "isteklo" | "rucno";

export type SkeniranjePredlog = {
  razlog: SkeniranjeRazlog;
  cost: number;
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

const NASLOV: Record<SkeniranjeRazlog, string> = {
  prvo: "Skeniranje košta 1 kredit",
  isteklo: "Osvežavanje košta 1 kredit",
  rucno: "Ponovno skeniranje košta 1 kredit",
};

const POTVRDA: Record<SkeniranjeRazlog, string> = {
  prvo: "Skeniraj za 1 kredit",
  isteklo: "Osveži za 1 kredit",
  rucno: "Skeniraj ponovo za 1 kredit",
};

export function SkeniranjeModal({ predlog, ceka, onPotvrdi, onOdustani }: Props) {
  if (!predlog) return null;

  const { razlog } = predlog;
  const dovoljno = predlog.creditsLeft >= predlog.cost;
  const posle = predlog.creditsLeft - predlog.cost;
  const datum = predlog.lastScannedAt ? formatDatum(predlog.lastScannedAt) : null;

  const Ikona = razlog === "prvo" ? Search : razlog === "isteklo" ? Zap : RefreshCw;

  return (
    <Dialog open onOpenChange={(o) => !o && onOdustani()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{NASLOV[razlog]}</DialogTitle>
          <DialogDescription>
            {predlog.cityLabel} · {predlog.nicheLabel}
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
            )}{" "}
            Posle skeniranja je ova kombinacija besplatna svima narednih 30 dana.
          </p>

          <dl className="grid grid-cols-2 gap-y-2 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-xs">
            <dt className="text-fg-muted">Cena</dt>
            <dd className="num text-right font-medium">
              {predlog.cost} {plural(predlog.cost, "kredit", "kredita", "kredita")}
            </dd>

            <dt className="text-fg-muted">Imaš</dt>
            <dd className="num text-right font-medium">{predlog.creditsLeft}</dd>

            <dt className="text-fg-muted">Posle skeniranja</dt>
            <dd className="num text-right font-medium">{dovoljno ? posle : "—"}</dd>
          </dl>

          {!dovoljno ? (
            <p className="text-xs text-danger">
              Nemaš dovoljno kredita. Pretrage iz keša su i dalje besplatne.
            </p>
          ) : (
            <p className="text-xs text-fg-muted">
              Ako Google ne nađe nijednu firmu, kredit ti se vraća.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" onClick={onOdustani} disabled={ceka}>
            Odustani
          </Button>
          <Button type="button" variant="primary" onClick={onPotvrdi} disabled={ceka || !dovoljno}>
            <Ikona className="h-4 w-4" />
            {ceka ? "Pokrećem…" : POTVRDA[razlog]}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
