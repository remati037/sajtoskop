"use client";

// Glavni ekran F2/F3: dva combobox-a, filteri kao toggle dugmad, sumarna traka,
// tabela. Sve ide kroz `POST /api/search` — nema direktnog Supabase upita iz
// pregledača (pravilo 10: `businesses` i `website_audits` su `using (false)`).
//
// F3 dodaje čekanje na worker: promašaj keša vraća `status: "queued"` i ID posla,
// pa se ovde polluje `GET /api/job/:id` na 3 sekunde, najviše 3 minuta. Lista se
// osvežava u hodu, kako `enrich_basic` poslovi završavaju jedan po jedan.

import { useEffect, useRef, useState } from "react";
import { Combobox, type ComboGroup } from "./combobox";
import { LeadTabela } from "./lead-tabela";
import {
  MAX_PAGE,
  type ApiError,
  type JobStatusResponse,
  type SearchFilters,
  type SearchResponse,
} from "@/lib/search-types";
import { formatDatum, plural, summaryLine } from "@/lib/ui-tekst";

type Props = {
  cities: ComboGroup[];
  niches: ComboGroup[];
  cityLabels: Record<string, string>;
};

const PRAZNI_FILTERI: SearchFilters = { onlyNoSite: false, onlySocial: false, onlyDead: false };

/** Na koliko se pita za status posla. */
const POLL_MS = 3000;

/** Posle ovoga se odustaje od čekanja — posao se svejedno završi u pozadini. */
const MAX_CEKANJE_MS = 3 * 60 * 1000;

export function PretragaEkran({ cities, niches, cityLabels }: Props) {
  const [city, setCity] = useState<string | null>(null);
  const [niche, setNiche] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(PRAZNI_FILTERI);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [ucitava, setUcitava] = useState(false);

  // Stanje čekanja na worker.
  const [posao, setPosao] = useState<JobStatusResponse | null>(null);
  const [predugo, setPredugo] = useState(false);

  // Svako novo pretraživanje poništava prethodno pollovanje. Bez ovoga bi dve
  // pretrage u nizu naizmenično prepisivale istu tabelu.
  const pollToken = useRef(0);
  useEffect(() => () => void (pollToken.current += 1), []);

  /** Jedan poziv pretrage. Vraća odgovor da bi pozivalac mogao da nastavi. */
  async function trazi(f: SearchFilters, page: number): Promise<SearchResponse | null> {
    if (!city || !niche) {
      setGreska("Izaberi i grad i nišu.");
      return null;
    }

    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city, niche, filters: f, page }),
    });

    const json: SearchResponse | ApiError = await res.json();

    if (!res.ok) {
      setGreska("greska" in json ? json.greska : "Pretraga nije uspela.");
      setData(null);
      return null;
    }

    const odgovor = json as SearchResponse;
    setData(odgovor);
    return odgovor;
  }

  async function pretrazi(f: SearchFilters, page: number) {
    const token = ++pollToken.current;

    setUcitava(true);
    setGreska(null);
    setPosao(null);
    setPredugo(false);

    try {
      const odgovor = await trazi(f, page);
      if (!odgovor || token !== pollToken.current) return;

      if (odgovor.status === "queued" && odgovor.job) {
        setPosao({ id: odgovor.job.id, status: "pending", progress: null, greska: null });
        void pratiPosao(odgovor.job.id, token, f, page);
      }
    } catch {
      setGreska("Nema veze sa serverom. Proveri internet pa pokušaj ponovo.");
      setData(null);
    } finally {
      setUcitava(false);
    }
  }

  /**
   * Prati posao dok ne završi ili dok ne istekne strpljenje.
   *
   * Lista se osvežava svaki put kad se broj analiziranih promeni — korisnik vidi
   * kako se popunjava, umesto da gleda spinner pa dobije sve odjednom.
   */
  async function pratiPosao(jobId: number, token: number, f: SearchFilters, page: number) {
    const kraj = Date.now() + MAX_CEKANJE_MS;
    let poslednjeAnalizirano = -1;

    while (token === pollToken.current && Date.now() < kraj) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (token !== pollToken.current) return;

      let stanje: JobStatusResponse;
      try {
        const res = await fetch(`/api/job/${jobId}`, { cache: "no-store" });
        if (!res.ok) return; // 404 posle brisanja posla nije razlog za crvenu poruku
        stanje = (await res.json()) as JobStatusResponse;
      } catch {
        continue; // prolazan mrežni prekid — probaj opet za 3s
      }

      if (token !== pollToken.current) return;
      setPosao(stanje);

      if (stanje.greska) {
        setGreska(stanje.greska);
        return;
      }

      const analizirano = stanje.progress?.analyzed ?? 0;
      const nadjeno = stanje.progress?.found ?? 0;

      if (analizirano !== poslednjeAnalizirano && nadjeno > 0) {
        poslednjeAnalizirano = analizirano;
        await trazi(f, page);
        if (token !== pollToken.current) return;
      }

      // Gotovo je tek kad je i scan završio i svi sajtovi analizirani.
      if (stanje.status === "done" && nadjeno > 0 && analizirano >= nadjeno) {
        setPosao(null);
        return;
      }
      if (stanje.status === "failed") return;
    }

    if (token === pollToken.current) setPredugo(true);
  }

  // Promena filtera ili strane ne traži novi klik na „Pretraži" — ali ni ne puca
  // pre prve pretrage, jer tada još ne znamo šta korisnik traži.
  function primeniFiltere(sledeci: SearchFilters) {
    setFilters(sledeci);
    if (data) void pretrazi(sledeci, 1);
  }

  const strana = data?.page ?? 1;
  const strana_ukupno = data ? Math.min(Math.ceil(data.total / data.pageSize) || 1, MAX_PAGE) : 1;
  const ceka = posao !== null && !predugo;

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
          disabled={ucitava || ceka}
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

      {ceka && <TrakaPosla posao={posao} />}

      {predugo && (
        <Poruka
          naslov="Traje duže nego obično."
          telo="Skeniranje se nastavlja u pozadini. Rezultat će biti ovde kad se vratiš — ova pretraga tada ide iz keša, besplatno i bez čekanja."
        />
      )}

      {data && (
        <section className="space-y-4">
          <FilterTraka filters={filters} onChange={primeniFiltere} disabled={ucitava} />

          {data.total === 0 && !ceka && !predugo ? (
            <Poruka
              naslov={
                data.status === "cache"
                  ? "Nijedan prospekt ne odgovara filterima."
                  : "Ova kombinacija još nije skenirana."
              }
              telo={
                data.status === "cache"
                  ? "Baza za ovaj grad i nišu nije prazna — filteri su preuski. Isključi neki toggle iznad."
                  : "Skeniranje je pokrenuto. Ako se ništa ne pojavi, Google za ovu kombinaciju nema nijednu firmu."
              }
            />
          ) : data.total === 0 ? null : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-800">
                <p className="text-sm tabular-nums">{summaryLine(data.total, data.summary)}</p>
                {data.freshness && (
                  <p
                    className={`text-xs ${data.freshness.stale ? "text-amber-600 dark:text-amber-400" : "text-neutral-500"}`}
                  >
                    {data.freshness.stale
                      ? `Podaci stariji od 30 dana (${formatDatum(data.freshness.refreshedAt)}) — osvežavanje je pokrenuto u pozadini.`
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

      {!data && !greska && !ceka && (
        <p className="text-sm text-neutral-500">
          Izaberi grad i nišu. Pretraga iz keša je besplatna, neograničena i ne troši kredite.
        </p>
      )}
    </div>
  );
}

/** Stanje posla: `pending` → `running` → broj analiziranih. */
function TrakaPosla({ posao }: { posao: JobStatusResponse | null }) {
  if (!posao) return null;

  const nadjeno = posao.progress?.found ?? 0;
  const analizirano = posao.progress?.analyzed ?? 0;
  const procenat = nadjeno > 0 ? Math.round((analizirano / nadjeno) * 100) : 0;

  const tekst =
    nadjeno === 0
      ? posao.status === "pending"
        ? "U redu za skeniranje…"
        : "Tražim firme na Google Maps-u…"
      : `Nađeno ${nadjeno} ${plural(nadjeno, "prospekt", "prospekta", "prospekata")} · ` +
        `analizirano ${analizirano}`;

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{tekst}</p>
        {nadjeno > 0 && (
          <span className="text-xs tabular-nums text-neutral-500">{procenat}%</span>
        )}
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className={`h-full bg-neutral-900 transition-all duration-500 dark:bg-white ${nadjeno === 0 ? "animate-pulse" : ""}`}
          style={{ width: nadjeno === 0 ? "15%" : `${Math.max(procenat, 4)}%` }}
        />
      </div>

      <p className="text-xs text-neutral-500">
        Prva pretraga ove kombinacije traje do dva minuta. Sledeći put ide iz keša — instant.
      </p>
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
