"use client";

// Glavni ekran F2/F3: dva combobox-a, filteri kao toggle dugmad, sumarna traka,
// tabela. Sve ide kroz `POST /api/search` — nema direktnog Supabase upita iz
// pregledača (pravilo 10: `businesses` i `website_audits` su `using (false)`).
//
// F3 dodaje čekanje na worker: promašaj keša vraća `status: "queued"` i ID posla,
// pa se ovde polluje `GET /api/job/:id` na 3 sekunde, najviše 3 minuta. Lista se
// osvežava u hodu, kako `enrich_basic` poslovi završavaju jedan po jedan.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock, Search, SlidersHorizontal } from "lucide-react";
import { Combobox, type ComboGroup } from "./combobox";
import { LeadTabela } from "./lead-tabela";
import { cn } from "@/lib/cn";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { PraznoStanje } from "./ui/stranica";
import {
  MAX_PAGE,
  type ApiError,
  type JobStatusResponse,
  type SearchFilters,
  type SearchResponse,
  type UnlockResponse,
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

/**
 * Koliko krugova bez ijednog novog audita se toleriše POSLE završenog scana pre
 * nego što se traka skloni.
 *
 * Ne završava svaki `enrich_basic` redom u `website_audits`: sajt zabranjen
 * robots.txt-om i biznis obrisan u međuvremenu prolaze bez audita. Za takvu
 * kombinaciju `analizirano` nikad ne stigne `nađeno`, pa bez ovog izlaza traka
 * ostaje da se vrti nad gotovom listom sve do isteka strpljenja.
 */
const MIRNIH_KRUGOVA_DO_KRAJA = 15;

const pauza = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PretragaEkran({ cities, niches, cityLabels }: Props) {
  const router = useRouter();
  const [city, setCity] = useState<string | null>(null);
  const [niche, setNiche] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(PRAZNI_FILTERI);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [ucitava, setUcitava] = useState(false);

  // Stanje čekanja na worker.
  const [posao, setPosao] = useState<JobStatusResponse | null>(null);
  const [predugo, setPredugo] = useState(false);

  // Otključavanje: `place_id` reda u toku, i poruka posle uspeha.
  const [otkljucavam, setOtkljucavam] = useState<string | null>(null);
  const [otkljucano, setOtkljucano] = useState<string | null>(null);

  // Svako novo pretraživanje poništava prethodno pollovanje. Bez ovoga bi dve
  // pretrage u nizu naizmenično prepisivale istu tabelu.
  const pollToken = useRef(0);
  useEffect(() => () => void (pollToken.current += 1), []);

  /**
   * Jedan poziv pretrage. Vraća odgovor da bi pozivalac mogao da nastavi.
   *
   * `token` se proverava i posle `await`-a: bez toga zakasnela runda pollovanja
   * stare pretrage prepiše tabelu koju je nova već popunila.
   */
  async function trazi(
    f: SearchFilters,
    page: number,
    token: number,
  ): Promise<SearchResponse | null> {
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

    if (token !== pollToken.current) return null;

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
      const odgovor = await trazi(f, page, token);
      if (!odgovor || token !== pollToken.current) return;

      // Bez ispravnog ID-ja nema šta da se prati. Traka se tada NE prikazuje —
      // bolje odmah pokazati listu kakva jeste nego vrteti spinner nad poslom o
      // kome ne možemo ništa da saznamo.
      const jobId = odgovor.status === "queued" ? odgovor.job?.id : undefined;

      if (typeof jobId === "number" && Number.isInteger(jobId)) {
        setPosao({ id: jobId, status: "pending", progress: null, greska: null });
        void pratiPosao(jobId, token, f, page);
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
   *
   * Pravilo bez izuzetka: svaki izlaz iz ove funkcije skida traku (`setPosao(null)`)
   * ili je zamenjuje porukom. Ranija verzija je na `return` ostavljala `posao`
   * postavljen, pa je `ceka` zauvek bilo `true` — ekran je zaglavljivao na
   * „Prva pretraga traje do dva minuta" iako je posao odavno završio.
   */
  async function pratiPosao(jobId: number, token: number, f: SearchFilters, page: number) {
    const kraj = Date.now() + MAX_CEKANJE_MS;
    let poslednjeAnalizirano = -1;
    let mirnihKrugova = 0;

    /**
     * Poslednje osvežavanje liste pa skidanje trake.
     *
     * BUDŽET: `osveziPrvo` sme `true` samo kad u bazi već postoje redovi za ovu
     * kombinaciju. Nad praznim kešom `/api/search` nije čitanje nego nov
     * cache-miss — skine korisniku dnevnu rezervaciju i upiše nov `scan`
     * (prethodni je `done`, pa ga dedup ključ više ne pokriva), dakle do 3 nova
     * Places poziva za lice koje samo gleda spinner.
     */
    async function zavrsi(osveziPrvo: boolean) {
      if (osveziPrvo) await trazi(f, page, token);
      if (token === pollToken.current) setPosao(null);
    }

    while (token === pollToken.current && Date.now() < kraj) {
      await pauza(POLL_MS);
      if (token !== pollToken.current) return;

      let stanje: JobStatusResponse;
      try {
        const res = await fetch(`/api/job/${jobId}`, { cache: "no-store" });
        // 404 (posao obrisan) ni 400 (ID bez smisla) nisu razlog za crvenu poruku,
        // ali jesu razlog da se prestane sa čekanjem — status više neće stići.
        if (!res.ok) {
          await zavrsi(poslednjeAnalizirano >= 0);
          return;
        }
        stanje = (await res.json()) as JobStatusResponse;
      } catch {
        continue; // prolazan mrežni prekid — probaj opet za 3s
      }

      if (token !== pollToken.current) return;
      setPosao(stanje);

      if (stanje.greska) {
        setGreska(stanje.greska);
        setPosao(null);
        return;
      }

      const analizirano = stanje.progress?.analyzed ?? 0;
      const nadjeno = stanje.progress?.found ?? 0;
      const pomak = nadjeno > 0 && analizirano !== poslednjeAnalizirano;

      if (pomak) {
        poslednjeAnalizirano = analizirano;
        mirnihKrugova = 0;
        await trazi(f, page, token);
        if (token !== pollToken.current) return;
      } else {
        mirnihKrugova += 1;
      }

      if (stanje.status === "failed") {
        setPosao(null);
        return;
      }

      if (stanje.status === "done") {
        // Scan je gotov; ostaje da `enrich_basic` poslovi popune audite. Izlazi su
        // tri: nema šta da se nađe, sve je analizirano, ili je brojač stao (audit
        // koji nikad neće doći — v. MIRNIH_KRUGOVA_DO_KRAJA).
        const gotovo =
          nadjeno === 0 || analizirano >= nadjeno || mirnihKrugova >= MIRNIH_KRUGOVA_DO_KRAJA;

        if (gotovo) {
          await zavrsi(!pomak && nadjeno > 0);
          return;
        }
      }
    }

    if (token === pollToken.current) {
      setPosao(null);
      setPredugo(true);
    }
  }

  /**
   * Otključavanje jednog prospekta.
   *
   * Lista se NE traži ponovo posle uspeha: `/api/unlock` vraća pun otključan
   * lead, pa se menja samo taj jedan red. Ponovna pretraga bi nad praznim kešom
   * bila nov cache-miss, dakle nova dnevna rezervacija i do 3 Places poziva za
   * klik koji sa pretragom nema veze.
   *
   * Zato je i „jedan po jedan": `otkljucavam !== null` gasi ostala dugmad dok
   * traje zahtev. Dupli klik na dva reda sa poslednjim kreditom bi inače dao
   * jedan uspeh i jednu crvenu poruku, iako je korisnik uradio ono što je smeo.
   */
  async function otkljucaj(placeId: string) {
    if (otkljucavam) return;

    setOtkljucavam(placeId);
    setGreska(null);
    setOtkljucano(null);

    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId }),
      });

      const json: UnlockResponse | ApiError = await res.json();

      if (!res.ok) {
        setGreska("greska" in json ? json.greska : "Otključavanje nije uspelo.");
        return;
      }

      const odgovor = json as UnlockResponse;

      setData((prev) =>
        prev
          ? {
              ...prev,
              results: prev.results.map((l) => (l.placeId === placeId ? odgovor.lead : l)),
            }
          : prev,
      );

      setOtkljucano(
        odgovor.alreadyUnlocked
          ? `${odgovor.lead.name} je već bio otključan — kredit nije skinut.`
          : `${odgovor.lead.name} otključan. Ostalo ti je ${odgovor.creditsLeft} ${plural(odgovor.creditsLeft, "kredit", "kredita", "kredita")}.`,
      );

      // Balans u bočnoj traci crta serverski layout, pa ga osvežava samo ovo.
      router.refresh();
    } catch {
      setGreska("Nema veze sa serverom. Prospekt nije otključan i kredit nije skinut.");
    } finally {
      setOtkljucavam(null);
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
  const ceka = posao !== null && !predugo;

  return (
    <div className="space-y-6">
      <Card className="overflow-visible p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void pretrazi(filters, 1);
          }}
          className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
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
          <Button type="submit" variant="primary" size="lg" disabled={ucitava || ceka}>
            <Search className="h-4 w-4" />
            {ucitava ? "Tražim…" : "Pretraži"}
          </Button>
        </form>
      </Card>

      {greska && <Alert variant="danger">{greska}</Alert>}

      {otkljucano && (
        <Alert variant="success">
          {otkljucano} <a href="/lista">Moja lista</a>
        </Alert>
      )}

      {ceka && <TrakaPosla posao={posao} />}

      {predugo && (
        <Alert variant="warning">
          <p className="font-medium">Traje duže nego obično.</p>
          <p className="mt-0.5 opacity-90">
            Skeniranje se nastavlja u pozadini. Rezultat će biti ovde kad se vratiš — ova
            pretraga tada ide iz keša, besplatno i bez čekanja.
          </p>
        </Alert>
      )}

      {data && (
        <section className="space-y-4">
          {/* Dok scan traje a lista je još prazna, filter bi otišao u nov cache-miss
              (nova dnevna rezervacija, nov `scan`). Zato je zaključan tek dotle. */}
          <FilterTraka
            filters={filters}
            onChange={primeniFiltere}
            disabled={ucitava || (ceka && data.total === 0)}
          />

          {data.total === 0 && !ceka && !predugo ? (
            <PraznoStanje
              ikona={<Search />}
              naslov={
                data.status === "cache"
                  ? "Nijedan prospekt ne odgovara filterima."
                  : "Ova kombinacija još nije skenirana."
              }
              opis={
                data.status === "cache"
                  ? "Baza za ovaj grad i nišu nije prazna — filteri su preuski. Isključi neki toggle iznad."
                  : "Skeniranje je pokrenuto. Ako se ništa ne pojavi, Google za ovu kombinaciju nema nijednu firmu."
              }
            />
          ) : data.total === 0 ? null : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm num">{summaryLine(data.total, data.summary)}</p>
                {data.freshness && (
                  <p
                    className={cn(
                      "text-xs",
                      data.freshness.stale ? "text-warn-text" : "text-fg-muted",
                    )}
                  >
                    {data.freshness.stale
                      ? `Podaci stariji od 30 dana (${formatDatum(data.freshness.refreshedAt)}) — osvežavanje je pokrenuto u pozadini.`
                      : `Osveženo ${formatDatum(data.freshness.refreshedAt)}.`}
                  </p>
                )}
              </div>

              <LeadTabela
                leads={data.results}
                cityLabels={cityLabels}
                onUnlock={(placeId) => void otkljucaj(placeId)}
                otkljucavam={otkljucavam}
              />

              {strana_ukupno > 1 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-fg-muted num">
                    Strana {strana} od {strana_ukupno}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={strana <= 1 || ucitava}
                      onClick={() => void pretrazi(filters, strana - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Prethodna
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={strana >= strana_ukupno || ucitava}
                      onClick={() => void pretrazi(filters, strana + 1)}
                    >
                      Sledeća
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {!data && !greska && !ceka && (
        <PraznoStanje
          ikona={<Search />}
          naslov="Izaberi grad i nišu."
          opis="Pretraga iz keša je besplatna, neograničena i ne troši kredite. Kredit se skida tek kad otključaš prospekt."
        />
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
    <Card className="space-y-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Clock className={cn("h-4 w-4 text-accent-text", nadjeno === 0 && "animate-puls-tanko")} />
          {tekst}
        </p>
        {nadjeno > 0 && (
          <span className="text-xs font-medium num text-fg-muted">
            {procenat}%
          </span>
        )}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-bg-inset">
        <div
          className={cn(
            "h-full rounded-full bg-accent transition-[width] duration-500",
            nadjeno === 0 && "animate-puls-tanko",
          )}
          style={{ width: nadjeno === 0 ? "15%" : `${Math.max(procenat, 4)}%` }}
        />
      </div>

      <p className="text-xs text-fg-muted">
        Prva pretraga ove kombinacije traje do dva minuta. Sledeći put ide iz keša — instant.
      </p>
    </Card>
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
      <SlidersHorizontal className="h-3.5 w-3.5 text-fg-muted" aria-hidden />

      {toggles.map((t) => (
        <Cip
          key={t.key}
          ukljucen={filters[t.key] === true}
          disabled={disabled}
          onClick={() => onChange({ ...filters, [t.key]: !(filters[t.key] === true) })}
        >
          {t.label}
        </Cip>
      ))}

      {/* Odvojeno: skor postoji samo za žive sajtove, pa ovaj filter po definiciji
          isključuje `nema sajt` i `mrtav domen`. Zato stoji iza crte, ne uz njih. */}
      <span className="mx-1 h-4 w-px bg-border" />
      <Cip
        ukljucen={filters.minScore !== undefined}
        disabled={disabled}
        title="Ugly Score 45+ (band Ružan i Katastrofa). Sajtovi kojih nema nemaju skor, pa ispadaju iz rezultata."
        onClick={() =>
          onChange({ ...filters, minScore: filters.minScore === undefined ? 45 : undefined })
        }
      >
        Ugly Score 45+
      </Cip>
    </div>
  );
}

function Cip({
  ukljucen,
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { ukljucen: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={ukljucen}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 disabled:opacity-50",
        ukljucen
          ? "border-accent bg-accent text-accent-ink shadow-accent"
          : "border-border bg-bg-elev text-fg-muted hover:border-border-strong hover:text-fg",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
