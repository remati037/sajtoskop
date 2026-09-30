"use client";

// apps/web/src/components/skeniranje-modal.tsx
// Potvrda pre nego što se skine kredit za skeniranje (F9 §4.2).
//
// Isti obrazac kao otključavanje: korisnik vidi šta plaća, koliko ima i koliko
// mu ostaje, pre nego što se ijedan kredit pomeri.
//
// Pet razloga zbog kojih se ovaj modal otvara imaju pet različitih tekstova,
// i to nije ukras (F9, odluka 8): „nije u kešu" i „isteklo je" su za korisnika
// različite vesti, treće — ručno osvežavanje nečega što još važi — mora jasno
// da kaže da plaća Google ponovo, četvrto je od S17 (u kešu, sveže, ali pliće
// od tražene dubine — plaća stranice, ne svežinu), a peto je od S25 (D10):
// kombinacija JESTE u kešu, sveža i dovoljno duboka — plaća PRISTUP, stiže
// odmah, bez čekanja, i košta po broju stranica koje stvarno postoje.
//
// [S17] Nijedan naslov ni dugme više ne piše „1 kredit". Cena dolazi iz
// `predlog.cost` (1 / 2 / 3, po izabranoj dubini) i prolazi kroz `plural` —
// „2 kredita", ne „2 kredit".

import { FolderOpen, Layers, RefreshCw, Search, Zap } from "lucide-react";
import { PLACES_PAGE_SIZE } from "@sajtoskop/shared";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { formatDatum, plural } from "@/lib/ui-tekst";

export type SkeniranjeRazlog = "prvo" | "isteklo" | "rucno" | "plice" | "kes";

export type SkeniranjePredlog = {
  razlog: SkeniranjeRazlog;
  /** Cena izabrane dubine u kreditima: 1 „Brzo", 2 „Standardno", 3 „Duboko". */
  cost: number;
  /**
   * Natpis izabrane veličine liste („40 firmi"). Modal ga od čišćenja UI-a ne
   * crta (crta `maxRezultata`), ali ga ekran i dalje šalje.
   */
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
  /**
   * [0029] Admin: krediti se ne troše. Modal i dalje postoji — potvrđuje
   * Google poziv, koji je stvaran novac i za admina — ali bez cene u kreditima.
   */
  neograniceno?: boolean;
};

/** „2 kredita", nikad „2 kredit". Jedna funkcija za naslov, dugme i tabelu. */
function kredita(n: number): string {
  return `${n} ${plural(n, "kredit", "kredita", "kredita")}`;
}

const RADNJA: Record<SkeniranjeRazlog, string> = {
  prvo: "Nova lista",
  isteklo: "Osvežavanje liste",
  rucno: "Ponovno skeniranje",
  plice: "Veća lista",
  kes: "Gotova lista",
};

const POTVRDA_GLAGOL: Record<SkeniranjeRazlog, string> = {
  prvo: "Skeniraj",
  isteklo: "Osveži",
  rucno: "Skeniraj ponovo",
  plice: "Skeniraj",
  kes: "Otvori",
};

export function SkeniranjeModal({
  predlog,
  ceka,
  onPotvrdi,
  onOdustani,
  neograniceno = false,
}: Props) {
  if (!predlog) return null;

  const { razlog } = predlog;
  const dovoljno = neograniceno || predlog.creditsLeft >= predlog.cost;
  const posle = predlog.creditsLeft - predlog.cost;
  const datum = predlog.lastScannedAt ? formatDatum(predlog.lastScannedAt) : null;

  const Ikona =
    razlog === "prvo" ? Search
    : razlog === "isteklo" ? Zap
    : razlog === "plice" ? Layers
    : razlog === "kes" ? FolderOpen
    : RefreshCw;

  return (
    <Dialog open onOpenChange={(o) => !o && onOdustani()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {neograniceno ? (
              RADNJA[razlog]
            ) : (
              <>
                {RADNJA[razlog]} košta <span className="num">{kredita(predlog.cost)}</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {predlog.cityLabel} · {predlog.nicheLabel} ·{" "}
            <span className="num">do {predlog.maxRezultata} firmi</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4 text-sm">
          <p className="text-fg-muted">
            {razlog === "prvo" && (
              <>Ova lista još ne postoji. Sajtoskop je sada skenira uživo na Google Maps, obično za manje od minuta.</>
            )}
            {razlog === "isteklo" && (
              <>
                Poslednje skeniranje je bilo <span className="num">{datum}</span>, pre više od 30
                dana. Zato skeniramo ponovo.
              </>
            )}
            {razlog === "rucno" && (
              <>
                Podaci su od <span className="num">{datum}</span> i još važe. Novo skeniranje donosi
                sveže stanje i produžava pristup za 30 dana.
              </>
            )}
            {razlog === "plice" && (
              <>
                Gotova lista od <span className="num">{datum}</span> ima samo do{" "}
                <span className="num">{(predlog.kesiranaDubina ?? 1) * PLACES_PAGE_SIZE} firmi</span>. Za listu do{" "}
                <span className="num">{predlog.maxRezultata} firmi</span> skeniramo ponovo.
              </>
            )}
            {razlog === "kes" && (
              <>
                Lista je skenirana <span className="num">{datum}</span> i stiže odmah, bez čekanja.
              </>
            )}
          </p>

          <dl className="grid grid-cols-2 gap-y-2 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-xs">
            <dt className="text-fg-muted">Veličina liste</dt>
            <dd className="num text-right font-medium">do {predlog.maxRezultata} firmi</dd>

            {!neograniceno && (
              <>
                <dt className="text-fg-muted">Cena</dt>
                <dd className="num text-right font-medium">{kredita(predlog.cost)}</dd>

                <dt className="text-fg-muted">Imaš</dt>
                <dd className="num text-right font-medium">{predlog.creditsLeft}</dd>

                <dt className="text-fg-muted">Ostaje ti</dt>
                <dd className="num text-right font-medium">{dovoljno ? posle : "nedovoljno"}</dd>
              </>
            )}
          </dl>

          {neograniceno ? (
            <p className="text-xs text-fg-muted">
              Admin nalog, krediti se ne troše. Dnevni limit skeniranja i Google budžet važe i
              dalje.
            </p>
          ) : !dovoljno ? (
            <p className="text-xs text-danger">
              Nemaš dovoljno kredita za ovu listu.
              {predlog.cost > 1 ? " Probaj manju listu." : ""} Liste koje si već platio otvaraš i
              dalje.
            </p>
          ) : razlog === "kes" ? (
            <p className="text-xs text-fg-muted">
              Lista ti je otvorena 30 dana bez novih kredita.
            </p>
          ) : (
            <p className="text-xs text-fg-muted">
              Lista ti je otvorena 30 dana. Ako nađemo manje firmi nego što tražiš, razliku
              vraćamo.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" onClick={onOdustani} disabled={ceka}>
            Odustani
          </Button>
          <Button type="button" variant="primary" onClick={onPotvrdi} disabled={ceka || !dovoljno}>
            <Ikona className="h-4 w-4" />
            {ceka
              ? "Pokrećem…"
              : neograniceno
                ? POTVRDA_GLAGOL[razlog]
                : `${POTVRDA_GLAGOL[razlog]} za ${kredita(predlog.cost)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
