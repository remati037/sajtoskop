"use client";

// apps/web/src/components/kes-lista.tsx
// Lista keša (F9 §4.3, S25 D10).
//
// Ovo je „izlog" proizvoda: sve što je bilo ko već skenirao stiže ODMAH, bez
// čekanja na Google — po istoj ceni kao skeniranje (manje kad firmi ima manje),
// za pristup od 30 dana. Besplatno je samo ono što je OVAJ korisnik već platio
// (blok „Tvoji pristupi"). Zato red nosi i broj prospekata bez sajta — to je
// jedina cifra koja govori ima li tu posla, a ne samo koliko ima firmi.
//
// [S17] Red nosi i DUBINU do koje je kombinacija skenirana. Bez nje korisnik ne
// zna zašto jedna pretraga stiže odmah a druga traži Google: red skeniran na
// jednu stranicu pokriva „Brzo", a za „Duboko" mora ponovo. Klik na red zato i
// spušta izabranu dubinu na keširanu (v. `izKesa`).
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
import { DUBINA_OPIS, dubinaZaRezultate, foldForSearch, PLACES_PAGE_SIZE } from "@sajtoskop/shared";
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
  /** Klik na red popunjava formu: plaćen pristup otvara listu, ostalo ide kroz modal sa cenom. */
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
  // keša nemaju šta da traže — po kliku bi tražile Google ponovo.
  const sveze = useMemo(() => stavke.filter((s) => s.fresh), [stavke]);

  const { placeno, ostalo } = useMemo(() => {
    const q = foldForSearch(filter.trim());

    const vidljivo = q
      ? sveze.filter((s) => {
          const grad = foldForSearch(cityLabels[s.city] ?? s.city);
          const nisa = foldForSearch(nicheLabels[s.niche] ?? s.niche);
          return grad.includes(q) || nisa.includes(q);
        })
      : sveze;

    // [S25] „Tvoji pristupi" = ono što je ovaj korisnik PLATIO i još važi —
    // jedini blok koji se otvara bez kredita. `mine` (tražio ranije) više nije
    // dovoljan razlog za zaseban blok: ranija pretraga bez važećeg pristupa
    // košta isto kao tuđa.
    const sada = Date.now();
    const imaPristup = (s: KesStavka) => s.pristup !== null && Date.parse(s.pristup.expiresAt) > sada;

    return {
      placeno: vidljivo.filter(imaPristup),
      ostalo: vidljivo.filter((s) => !imaPristup(s)),
    };
  }, [sveze, filter, cityLabels, nicheLabels]);

  const ukupno = sveze.length;

  // Sklopljena lista bez ijedne stavke nije ni traka ni poruka — samo šum.
  if (sazeto && ukupno === 0) return null;

  if (sazeto && !otvorena) {
    return (
      <button
        type="button"
        onClick={() => setOtvorena(true)}
        // [Faza 4, 4.8] Čitač ekrana čuje da li je lista sklopljena ili
        // raširena (nalaz 7.3.3).
        aria-expanded={otvorena}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-bg-elev px-4 py-3 text-left shadow-sm transition-colors hover:border-border-strong hover:bg-bg-hover"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-accent-text" aria-hidden />
          U kešu
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
            {sazeto ? "U kešu" : "Izaberi grad i nišu."}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            {ukupno === 0 ? (
              <>
                U kešu još nema nijedne kombinacije. Skeniranje košta{" "}
                <span className="num">1–3 kredita</span>, po izabranoj dubini — i daje ti pristup
                toj kombinaciji 30 dana.
              </>
            ) : (
              <>
                Sve što je u kešu stiže odmah, po istoj ceni —{" "}
                <span className="num">1 kredit po stranici rezultata</span>, do dubine koja piše
                uz red, i manje kad firmi ima manje. Plaćen pristup važi 30 dana: listanje,
                filteri i osvežavanje su tada bez kredita. Kombinacija koje nema, koja je starija
                od 30 dana, ili koju tražiš dublje nego što je skenirana, traži Google ponovo.
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
              aria-label="Filtriraj kombinacije u kešu"
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
        (placeno.length === 0 && ostalo.length === 0 ? (
          <p className="mt-4 text-xs text-fg-muted">
            Nijedna kombinacija u kešu ne odgovara filteru.
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            <Blok
              naslov="Tvoji pristupi"
              stavke={placeno}
              cityLabels={cityLabels}
              nicheLabels={nicheLabels}
              onIzaberi={onIzaberi}
              disabled={disabled}
            />
            <Blok
              naslov={placeno.length > 0 ? "Ostalo u kešu" : "U kešu"}
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

      {/* [Faza 5, 5.6] Bez ugnježđenog okvira: spoljna kartica nosi ivicu, lista
          je samo razdelnici (divide-y) — kartica u kartici (D8). */}
      <ul className="mt-2 divide-y divide-border">
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
  // [S25] Plaćen pristup ima svoj rok (kraći ili jednak roku keša); neplaćen
  // red pokazuje do kad je u kešu. Različit tekst, isti broj dana.
  const pristup = stavka.pristup && Date.parse(stavka.pristup.expiresAt) > Date.now() ? stavka.pristup : null;
  const rok = pristup ? pristup.expiresAt : stavka.expiresAt;
  const dana = daniDo(rok);
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

        {/* [S17] Do koje dubine je ovaj red besplatan. Naziv ponude, ne broj
            stranica: „Brzo" je ono što piše na prekidaču iznad, pa je veza
            između reda i izbora očigledna bez ijednog objašnjenja. */}
        <span
          title={
            `Skenirano do ${DUBINA_OPIS[dubinaZaRezultate(stavka.pages * PLACES_PAGE_SIZE)].maxResults} prospekata ` +
            `(${stavka.pages} ${plural(stavka.pages, "stranica", "stranice", "stranica")}). ` +
            (pristup
              ? `Plaćen pristup do ${pristup.pages} ${plural(pristup.pages, "stranice", "stranice", "stranica")}; dublje traži Google ponovo.`
              : `Iz keša stiže odmah do te dubine; dublje traži Google ponovo.`)
          }
          className="num rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-medium text-fg-muted"
        >
          {DUBINA_OPIS[dubinaZaRezultate(stavka.pages * PLACES_PAGE_SIZE)].labela}
        </span>

        {/* [Faza 6, 6.4] Parcijalan scan — budžet je stao usred skeniranja, pa
            kombinacija možda nije potpuna (B5). */}
        {stavka.partial && (
          <span
            title="Skeniranje je prekinuto (budžet). Rezultat možda nije potpun — ponovo skeniranje vraća punu listu."
            className="rounded-full border border-warn/30 bg-warn-wash px-2 py-0.5 text-[10px] font-medium text-warn-text"
          >
            delimično
          </span>
        )}

        <span className={cn("num whitespace-nowrap", uskoro ? "text-warn-text" : pristup ? "text-accent-text" : "text-fg-muted")}>
          {uskoro
            ? dana <= 0
              ? "ističe danas"
              : `još ${dana} ${plural(dana, "dan", "dana", "dana")}`
            : pristup
              ? `plaćeno do ${formatDatumKratko(rok)}`
              : `u kešu do ${formatDatumKratko(rok)}`}
        </span>
      </span>
    </button>
  );
}
