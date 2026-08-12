"use client";

// apps/web/src/components/kes-lista.tsx
// Lista besplatnih pretraga (F9 §4.3).
//
// Ovo je „izlog" proizvoda: sve što je bilo ko već platio, svima je besplatno
// narednih 30 dana. Zato red nosi i broj prospekata bez sajta — to je jedina
// cifra koja govori ima li tu posla, a ne samo koliko ima firmi.
//
// Dva stanja, po tome da li na strani već stoje rezultati:
//   pre pretrage  — puna lista sa uvodnim tekstom, ovo je glavna stvar na ekranu
//   posle nje     — jedan sklopljen red; tabela je glavna stvar, lista je pri ruci
//
// Filter ide kroz `foldForSearch` iz shared paketa, isto kao combobox: „Krusevac"
// nalazi „Kruševac", „nis" nalazi „Niš". Korisnik ne sme da mora da kuca kvačice
// da bi našao svoj grad.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, Sparkles } from "lucide-react";
import { foldForSearch } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import type { KesStavka } from "@/lib/search-types";
import { daniDo, formatDatumKratko, plural } from "@/lib/ui-tekst";

/** Ispod ovoga rok prestaje da bude sitan podatak i postaje upozorenje. */
const USKORO_DANA = 3;

/** Od koliko redova naviše filter ima smisla. */
const FILTER_OD = 6;

type Props = {
  stavke: KesStavka[];
  cityLabels: Record<string, string>;
  nicheLabels: Record<string, string>;
  /** Klik na red popunjava formu i odmah pokreće besplatnu pretragu. */
  onIzaberi: (city: string, niche: string) => void;
  /** Na strani već stoje rezultati — lista se povlači u jedan red. */
  sazeto?: boolean;
  disabled?: boolean;
};

export function KesLista({
  stavke,
  cityLabels,
  nicheLabels,
  onIzaberi,
  sazeto = false,
  disabled,
}: Props) {
  const [filter, setFilter] = useState("");
  const [otvorena, setOtvorena] = useState(!sazeto);

  // Rezultati su stigli → lista se sklapa; nova pretraga sa praznim ekranom →
  // ponovo se otvara. Korisnikov ručni klik važi do sledeće promene stanja.
  useEffect(() => setOtvorena(!sazeto), [sazeto]);

  // Istekle kombinacije stižu u istom nizu (traci cene trebaju), ali u listi
  // besplatnih pretraga nemaju šta da traže — po kliku bi tražile kredit.
  const besplatne = useMemo(() => stavke.filter((s) => s.fresh), [stavke]);

  const { moje, ostalo } = useMemo(() => {
    const q = foldForSearch(filter.trim());

    const vidljivo = q
      ? besplatne.filter((s) => {
          const grad = foldForSearch(cityLabels[s.city] ?? s.city);
          const nisa = foldForSearch(nicheLabels[s.niche] ?? s.niche);
          return grad.includes(q) || nisa.includes(q);
        })
      : besplatne;

    return {
      moje: vidljivo.filter((s) => s.mine),
      ostalo: vidljivo.filter((s) => !s.mine),
    };
  }, [besplatne, filter, cityLabels, nicheLabels]);

  const ukupno = besplatne.length;

  // Sklopljena lista bez ijedne stavke nije ni traka ni poruka — samo šum.
  if (sazeto && ukupno === 0) return null;

  if (sazeto && !otvorena) {
    return (
      <button
        type="button"
        onClick={() => setOtvorena(true)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-bg-elev px-4 py-3 text-left shadow-sm transition-colors hover:border-border-strong hover:bg-bg-hover"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-accent-text" aria-hidden />
          Besplatne pretrage
          <span className="num text-fg-muted">· {ukupno}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
          Prikaži
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
      </button>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-accent-text" aria-hidden />
            {sazeto ? "Besplatne pretrage" : "Izaberi grad i nišu."}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            {ukupno === 0 ? (
              <>
                U kešu još nema nijedne kombinacije. Prva pretraga bilo koje košta 1 kredit — i
                posle nje je ta kombinacija besplatna svima 30 dana.
              </>
            ) : (
              <>
                Sve što je već u kešu je besplatno i neograničeno — klik na red otvara pretragu
                bez ijednog kredita. Kombinacija koje nema, ili koja je starija od 30 dana, košta
                1 kredit.
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {ukupno >= FILTER_OD && (
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtriraj po gradu ili niši"
              aria-label="Filtriraj keširane pretrage"
              className="w-full sm:w-56"
            />
          )}

          {sazeto && (
            <button
              type="button"
              onClick={() => setOtvorena(false)}
              aria-label="Sklopi listu"
              className="inline-flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              <ChevronDown className="h-4 w-4 rotate-180" />
            </button>
          )}
        </div>
      </div>

      {ukupno > 0 &&
        (moje.length === 0 && ostalo.length === 0 ? (
          <p className="mt-4 text-xs text-fg-muted">
            Nijedna keširana pretraga ne odgovara filteru.
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            <Blok
              naslov="Tvoje pretrage"
              stavke={moje}
              cityLabels={cityLabels}
              nicheLabels={nicheLabels}
              onIzaberi={onIzaberi}
              disabled={disabled}
            />
            <Blok
              naslov={moje.length > 0 ? "Ostalo u kešu" : "U kešu"}
              stavke={ostalo}
              cityLabels={cityLabels}
              nicheLabels={nicheLabels}
              onIzaberi={onIzaberi}
              disabled={disabled}
            />
          </div>
        ))}
    </Card>
  );
}

function Blok({
  naslov,
  stavke,
  cityLabels,
  nicheLabels,
  onIzaberi,
  disabled,
}: {
  naslov: string;
  stavke: KesStavka[];
  cityLabels: Record<string, string>;
  nicheLabels: Record<string, string>;
  onIzaberi: (city: string, niche: string) => void;
  disabled?: boolean;
}) {
  if (stavke.length === 0) return null;

  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">{naslov}</h3>

      <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
        {stavke.map((s) => (
          <li key={`${s.city}:${s.niche}`}>
            <Red
              stavka={s}
              cityLabel={cityLabels[s.city] ?? s.city}
              nicheLabel={nicheLabels[s.niche] ?? s.niche}
              onIzaberi={onIzaberi}
              disabled={disabled}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Red({
  stavka,
  cityLabel,
  nicheLabel,
  onIzaberi,
  disabled,
}: {
  stavka: KesStavka;
  cityLabel: string;
  nicheLabel: string;
  onIzaberi: (city: string, niche: string) => void;
  disabled?: boolean;
}) {
  const dana = daniDo(stavka.expiresAt);
  const uskoro = dana <= USKORO_DANA;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onIzaberi(stavka.city, stavka.niche)}
      className={cn(
        "flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5 text-left transition-colors",
        "hover:bg-bg-hover disabled:opacity-50 disabled:hover:bg-transparent",
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Search className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
        <span className="truncate font-medium">{cityLabel}</span>
        <span className="text-fg-muted" aria-hidden>
          ·
        </span>
        <span className="truncate text-fg-muted">{nicheLabel}</span>
      </span>

      <span className="flex items-center gap-3 text-xs">
        {stavka.empty ? (
          <span className="text-fg-muted">Google nema nijednu firmu</span>
        ) : (
          <span className="num text-fg-muted">
            {stavka.total} {plural(stavka.total, "prospekt", "prospekta", "prospekata")}
            {stavka.noSite > 0 && ` · ${stavka.noSite} bez sajta`}
          </span>
        )}

        <span className={cn("num whitespace-nowrap", uskoro ? "text-warn-text" : "text-fg-muted")}>
          {uskoro
            ? dana <= 0
              ? "ističe danas"
              : `još ${dana} ${plural(dana, "dan", "dana", "dana")}`
            : `besplatno do ${formatDatumKratko(stavka.expiresAt)}`}
        </span>
      </span>
    </button>
  );
}
