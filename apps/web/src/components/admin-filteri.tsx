"use client";

// Filteri i paginacija za `/admin/korisnici` i `/admin/revizija`.
//
// ── zašto URL, a ne `useState` ───────────────────────────────
// Stanje liste je u adresi, pa se filtrirani prikaz može poslati sebi u poruku,
// osvežiti i vratiti dugmetom „nazad". Sa lokalnim stanjem bi svaki od ta tri
// slučaja vratio praznu listu — a najčešća radnja u konzoli je baš „otvori
// korisnika pa se vrati na isto mesto u listi".
//
// Server komponenta iznad čita iste te parametre, pa filtriranje radi baza, a ne
// pregledač. To je i jedini način da paginacija bude tačna: klijent koji filtrira
// 25 dobijenih redova ne zna koliko ih ima iza.

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./ui/button";
import { poljeKlase } from "./ui/input";

/**
 * Jedan izmenjen parametar, ostali netaknuti. Prazna vrednost briše parametar —
 * `?q=&filter=svi` u adresi je šum koji ništa ne znači.
 *
 * Svaka izmena vraća na prvu stranu, osim same promene strane: filter primenjen
 * dok si na strani 4 obično nema četiri strane rezultata, pa bi te ostavio na
 * praznom prikazu.
 */
function saParametrom(
  trenutni: URLSearchParams,
  izmene: Record<string, string>,
): string {
  const p = new URLSearchParams(trenutni.toString());

  for (const [kljuc, vrednost] of Object.entries(izmene)) {
    if (vrednost) p.set(kljuc, vrednost);
    else p.delete(kljuc);
  }

  if (!("strana" in izmene)) p.delete("strana");

  const upit = p.toString();
  return upit ? `?${upit}` : "";
}

export function PoljePretrage({
  naziv,
  kljuc = "q",
  placeholder,
}: {
  naziv: string;
  kljuc?: string;
  placeholder: string;
}) {
  const router = useRouter();
  const putanja = usePathname();
  const params = useSearchParams();
  const [ceka, prenesi] = useTransition();

  const izAdrese = params.get(kljuc) ?? "";
  const [tekst, setTekst] = useState(izAdrese);

  // Adresa je izvor istine. Klik na „nazad" ili na `✕` menja nju, a polje mora
  // da ga prati — bez ovoga bi ostao stari upit u polju uz novu listu.
  useEffect(() => setTekst(izAdrese), [izAdrese]);

  function posalji(vrednost: string) {
    prenesi(() => {
      router.push(`${putanja}${saParametrom(params, { [kljuc]: vrednost.trim() })}`);
    });
  }

  return (
    <form
      className="relative min-w-0 flex-1 sm:max-w-xs"
      onSubmit={(e) => {
        e.preventDefault();
        posalji(tekst);
      }}
    >
      <label className="sr-only" htmlFor={`pretraga-${kljuc}`}>
        {naziv}
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
      />
      <input
        id={`pretraga-${kljuc}`}
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        placeholder={placeholder}
        className={cn(poljeKlase, "pl-8.5 pr-8")}
      />
      {(tekst || izAdrese) && (
        <button
          type="button"
          aria-label="Obriši pretragu"
          onClick={() => {
            setTekst("");
            posalji("");
          }}
          className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg"
        >
          {ceka ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
      )}
    </form>
  );
}

/**
 * Segmentni prekidač filtera. Ne `<select>`: filtera je četiri i svi staju u red,
 * a jedan klik je jedan klik.
 */
export function TrakaFiltera({
  kljuc,
  opcije,
  podrazumevano,
}: {
  kljuc: string;
  opcije: { vrednost: string; label: string }[];
  podrazumevano: string;
}) {
  const router = useRouter();
  const putanja = usePathname();
  const params = useSearchParams();
  const [, prenesi] = useTransition();

  const aktivna = params.get(kljuc) || podrazumevano;

  return (
    <div
      role="group"
      aria-label="Filter"
      className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border-strong bg-bg-inset/60 p-1"
    >
      {opcije.map((o) => {
        const izabrana = o.vrednost === aktivna;

        return (
          <button
            key={o.vrednost}
            type="button"
            aria-pressed={izabrana}
            onClick={() =>
              prenesi(() => {
                router.push(
                  `${putanja}${saParametrom(params, {
                    [kljuc]: o.vrednost === podrazumevano ? "" : o.vrednost,
                  })}`,
                );
              })
            }
            className={cn(
              "h-8 rounded-md px-2.5 text-xs font-medium transition-colors",
              izabrana
                ? "bg-bg-elev text-fg shadow-sm ring-1 ring-border-strong"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Zaglavlje kolone po kojoj se sortira.
 *
 * Klik na aktivnu kolonu okreće smer, klik na drugu je postavlja sa
 * podrazumevanim smerom. Strelica se crta samo na aktivnoj — tri strelice u
 * zaglavlju ne kažu ništa.
 */
export function SortKolona({
  kljuc,
  label,
  podrazumevaniSmer = "desc",
  className,
}: {
  kljuc: string;
  label: string;
  podrazumevaniSmer?: "asc" | "desc";
  className?: string;
}) {
  const router = useRouter();
  const putanja = usePathname();
  const params = useSearchParams();
  const [, prenesi] = useTransition();

  const aktivnaKolona = params.get("sort") ?? "created_at";
  const smer = params.get("smer") === "asc" ? "asc" : "desc";
  const aktivna = aktivnaKolona === kljuc;
  const sledeciSmer = aktivna ? (smer === "asc" ? "desc" : "asc") : podrazumevaniSmer;

  return (
    <button
      type="button"
      onClick={() =>
        prenesi(() => {
          router.push(
            `${putanja}${saParametrom(params, { sort: kljuc, smer: sledeciSmer })}`,
          );
        })
      }
      aria-label={`Sortiraj po: ${label}`}
      className={cn(
        "inline-flex items-center gap-1 transition-colors hover:text-fg",
        aktivna && "text-fg",
        className,
      )}
    >
      {label}
      {aktivna && (
        <span aria-hidden className="text-[9px] leading-none">
          {smer === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

export function Paginacija({
  strana,
  strana_max,
  ukupno,
  imenica,
}: {
  strana: number;
  strana_max: number;
  ukupno: number;
  /** Množina za brojač: „korisnika", „radnji". */
  imenica: string;
}) {
  const router = useRouter();
  const putanja = usePathname();
  const params = useSearchParams();
  const [ceka, prenesi] = useTransition();

  function idi(nova: number) {
    prenesi(() => {
      router.push(`${putanja}${saParametrom(params, { strana: nova > 1 ? String(nova) : "" })}`);
    });
  }

  if (strana_max <= 1) {
    return (
      <p className="mt-4 text-xs text-fg-muted">
        <span className="num">{ukupno}</span> {imenica}
      </p>
    );
  }

  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <p className="text-xs text-fg-muted">
        Strana <span className="num">{strana}</span> od{" "}
        <span className="num">{strana_max}</span> · <span className="num">{ukupno}</span>{" "}
        {imenica}
      </p>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Prethodna strana"
          disabled={strana <= 1 || ceka}
          onClick={() => idi(strana - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Sledeća strana"
          disabled={strana >= strana_max || ceka}
          onClick={() => idi(strana + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
