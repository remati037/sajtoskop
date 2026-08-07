"use client";

// Glavni ekran F2: dva combobox-a, filteri kao toggle dugmad, sumarna traka,
// tabela. Sve ide kroz `POST /api/search` — nema direktnog Supabase upita iz
// pregledača (pravilo 10: `businesses` i `website_audits` su `using (false)`).

import { useState } from "react";
import { Combobox, type ComboGroup } from "./combobox";
import { LeadTabela } from "./lead-tabela";
import { MAX_PAGE, type ApiError, type SearchFilters, type SearchResponse } from "@/lib/search-types";
import { formatDatum, summaryLine } from "@/lib/ui-tekst";

type Props = {
  cities: ComboGroup[];
  niches: ComboGroup[];
  cityLabels: Record<string, string>;
};

const PRAZNI_FILTERI: SearchFilters = { onlyNoSite: false, onlySocial: false, onlyDead: false };

export function PretragaEkran({ cities, niches, cityLabels }: Props) {
  const [city, setCity] = useState<string | null>(null);
  const [niche, setNiche] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(PRAZNI_FILTERI);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [ucitava, setUcitava] = useState(false);

  async function pretrazi(f: SearchFilters, page: number) {
    if (!city || !niche) {
      setGreska("Izaberi i grad i nišu.");
      return;
    }

    setUcitava(true);
    setGreska(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, niche, filters: f, page }),
      });

      const json: SearchResponse | ApiError = await res.json();

      if (!res.ok) {
        setGreska("greska" in json ? json.greska : "Pretraga nije uspela.");
        setData(null);
        return;
      }

      setData(json as SearchResponse);
    } catch {
      setGreska("Nema veze sa serverom. Proveri internet pa pokušaj ponovo.");
      setData(null);
    } finally {
      setUcitava(false);
    }
  }

  // Promena filtera ili strane ne traži novi klik na „Pretraži" — ali ni ne puca
  // pre prve pretrage, jer tada još ne znamo šta korisnik traži.
  function primeniFiltere(sledeci: SearchFilters) {
    setFilters(sledeci);
    if (data) void pretrazi(sledeci, 1);
  }

  const strana = data?.page ?? 1;
  const strana_ukupno = data ? Math.min(Math.ceil(data.total / data.pageSize) || 1, MAX_PAGE) : 1;

  return (
    <div className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void pretrazi(filters, 1);
        }}
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <Combobox
          label="Grad"
          placeholder="npr. Šabac"
          groups={cities}
          value={city}
          onChange={setCity}
        />
        <Combobox
          label="Niša"
          placeholder="npr. PVC stolarija"
          groups={niches}
          value={niche}
          onChange={setNiche}
        />
        <button
          type="submit"
          disabled={ucitava}
          className="h-[42px] rounded-lg bg-neutral-900 px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {ucitava ? "Tražim…" : "Pretraži"}
        </button>
      </form>

      {greska && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {greska}
        </p>
      )}

      {data && (
        <section className="space-y-4">
          <FilterTraka filters={filters} onChange={primeniFiltere} disabled={ucitava} />

          {data.status === "not_scanned" ? (
            <Poruka
              naslov="Ova kombinacija još nije skenirana."
              telo="Nema nijednog prospekta u bazi za taj grad i nišu. Skeniranje uživo dolazi u sledećoj fazi — kad proradi, ovde će stajati dugme koje pokreće posao."
            />
          ) : data.total === 0 ? (
            <Poruka
              naslov="Nijedan prospekt ne odgovara filterima."
              telo="Baza za ovaj grad i nišu nije prazna — filteri su preuski. Isključi neki toggle iznad."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-800">
                <p className="text-sm tabular-nums">{summaryLine(data.total, data.summary)}</p>
                {data.freshness && (
                  <p
                    className={`text-xs ${data.freshness.stale ? "text-amber-600 dark:text-amber-400" : "text-neutral-500"}`}
                  >
                    {data.freshness.stale
                      ? `Podaci stariji od 30 dana (${formatDatum(data.freshness.refreshedAt)}) — osvežavanje u pripremi.`
                      : `Osveženo ${formatDatum(data.freshness.refreshedAt)}.`}
                  </p>
                )}
              </div>

              <LeadTabela leads={data.results} cityLabels={cityLabels} />

              {strana_ukupno > 1 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500 tabular-nums">
                    Strana {strana} od {strana_ukupno}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={strana <= 1 || ucitava}
                      onClick={() => void pretrazi(filters, strana - 1)}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700"
                    >
                      Prethodna
                    </button>
                    <button
                      type="button"
                      disabled={strana >= strana_ukupno || ucitava}
                      onClick={() => void pretrazi(filters, strana + 1)}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700"
                    >
                      Sledeća
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {!data && !greska && (
        <p className="text-sm text-neutral-500">
          Izaberi grad i nišu. Pretraga iz keša je besplatna, neograničena i ne troši kredite.
        </p>
      )}
    </div>
  );
}

function FilterTraka({
  filters,
  onChange,
  disabled,
}: {
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
  disabled: boolean;
}) {
  const toggles: { key: keyof SearchFilters; label: string }[] = [
    { key: "onlyNoSite", label: "Bez sajta" },
    { key: "onlyDead", label: "Mrtav domen" },
    { key: "onlySocial", label: "Samo društvene" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {toggles.map((t) => {
        const on = filters[t.key] === true;
        return (
          <button
            key={t.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...filters, [t.key]: !on })}
            aria-pressed={on}
            className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
              on
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400"
            }`}
          >
            {t.label}
          </button>
        );
      })}

      {/* Odvojeno: skor postoji samo za žive sajtove, pa ovaj filter po definiciji
          isključuje `nema sajt` i `mrtav domen`. Zato stoji iza crte, ne uz njih. */}
      <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-800" />
      <button
        type="button"
        disabled={disabled}
        aria-pressed={filters.minScore !== undefined}
        title="Ugly Score 45+ (band Ružan i Katastrofa). Sajtovi kojih nema nemaju skor, pa ispadaju iz rezultata."
        onClick={() =>
          onChange({ ...filters, minScore: filters.minScore === undefined ? 45 : undefined })
        }
        className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
          filters.minScore !== undefined
            ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
            : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400"
        }`}
      >
        Ugly Score 45+
      </button>
    </div>
  );
}

function Poruka({ naslov, telo }: { naslov: string; telo: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-5 py-6 dark:border-neutral-800 dark:bg-neutral-900/50">
      <p className="font-medium">{naslov}</p>
      <p className="mt-1 max-w-xl text-sm text-neutral-500">{telo}</p>
    </div>
  );
}
