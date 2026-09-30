"use client";

// apps/web/src/components/ui/obavestenja.tsx
// Kratak oblačić posle uspele radnje („Skinut 1 kredit, lista je tu"), koji
// nestane sam.
//
// Do čišćenja ekrana je svaka potvrda bila zeleni `Alert` između forme i
// rezultata, pa se na pretrazi slagalo pet traka jedna ispod druge. Pravilo:
// ovde ide samo POTVRDA, dakle vest koju korisnik ne mora da pročita da bi
// nastavio. Greška i upozorenje koje traže radnju ostaju `Alert` na ekranu.
//
// Stoji dole u sredini: desni donji ugao drži dugme „Utisak".

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

type Obavestenje = { id: number; poruka: React.ReactNode };

const TRAJANJE_MS = 6000;

const ObavestenjaContext = createContext<((poruka: React.ReactNode) => void) | null>(null);

export function ObavestenjaProvider({ children }: { children: React.ReactNode }) {
  const [lista, setLista] = useState<Obavestenje[]>([]);
  const sledeciId = useRef(0);

  const zatvori = useCallback((id: number) => {
    setLista((l) => l.filter((o) => o.id !== id));
  }, []);

  const obavesti = useCallback((poruka: React.ReactNode) => {
    const id = ++sledeciId.current;
    // Najviše dva odjednom: treći bi opet bio gomila.
    setLista((l) => [...l.slice(-1), { id, poruka }]);
  }, []);

  return (
    <ObavestenjaContext.Provider value={obavesti}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col items-center gap-2 sm:bottom-6"
      >
        {lista.map((o) => (
          <Stavka key={o.id} obavestenje={o} zatvori={zatvori} />
        ))}
      </div>
    </ObavestenjaContext.Provider>
  );
}

function Stavka({
  obavestenje,
  zatvori,
}: {
  obavestenje: Obavestenje;
  zatvori: (id: number) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => zatvori(obavestenje.id), TRAJANJE_MS);
    return () => clearTimeout(t);
  }, [obavestenje.id, zatvori]);

  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full max-w-md animate-uklizi items-start gap-2.5 rounded-xl border border-border bg-bg-elev px-3.5 py-2.5 text-sm shadow-card"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
      <div className="min-w-0 flex-1">{obavestenje.poruka}</div>
      <button
        type="button"
        onClick={() => zatvori(obavestenje.id)}
        aria-label="Zatvori"
        className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * `obavesti("Izvezeno 40 redova.")`. Van provajdera (npr. strana bez okvira
 * aplikacije) vraća no-op, pa komponenta ne mora da zna gde je montirana.
 */
export function useObavestenje(): (poruka: React.ReactNode) => void {
  return useContext(ObavestenjaContext) ?? noop;
}

function noop() {}
