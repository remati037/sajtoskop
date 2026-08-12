"use client";

// Kontekst teme. Drži izbor („tamna" / „svetla") i održava klasu `.dark` na <html>.
//
// Prvo stanje se čita iz DOM-a, ne iz `localStorage`-a: skripta iz <head>-a je
// klasu već postavila, pa čitanje iz DOM-a garantuje da se server i klijent
// slažu i da nema ni bleska ni skoka.
//
// Otkad je „sistem" izbačen (v. `lib/tema.ts`), ovde nema više ni `matchMedia`
// osluškivača ni razrešavanja — izbor JESTE tema.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { jeTema, PODRAZUMEVANA_TEMA, TEMA_KLJUC, type Tema } from "@/lib/tema";

type Kontekst = {
  tema: Tema;
  postaviTemu: (t: Tema) => void;
};

const TemaKontekst = createContext<Kontekst | null>(null);

function primeni(tema: Tema) {
  const koren = document.documentElement;
  koren.classList.toggle("dark", tema === "tamna");
  koren.style.colorScheme = tema === "tamna" ? "dark" : "light";
}

export function TemaProvider({ children }: { children: React.ReactNode }) {
  // Server sme da pretpostavi samo podrazumevanu vrednost; stvarnu čita efekat
  // ispod, iz klase koju je skripta iz <head>-a već postavila.
  const [tema, setTema] = useState<Tema>(PODRAZUMEVANA_TEMA);

  useEffect(() => {
    const sacuvana = (() => {
      try {
        return localStorage.getItem(TEMA_KLJUC);
      } catch {
        return null;
      }
    })();

    // Stara vrednost „sistem" ne prolazi kroz `jeTema` i pada na tamnu — isto
    // što radi i skripta iz <head>-a, pa se prikaz i stanje ne razilaze.
    setTema(jeTema(sacuvana) ? sacuvana : PODRAZUMEVANA_TEMA);
  }, []);

  const postaviTemu = useCallback((sledeca: Tema) => {
    setTema(sledeca);

    try {
      localStorage.setItem(TEMA_KLJUC, sledeca);
    } catch {
      // Privatni režim. Tema radi do osvežavanja stranice — to je prihvatljivo.
    }

    primeni(sledeca);
  }, []);

  const vrednost = useMemo(() => ({ tema, postaviTemu }), [tema, postaviTemu]);

  return <TemaKontekst.Provider value={vrednost}>{children}</TemaKontekst.Provider>;
}

export function useTema(): Kontekst {
  const k = useContext(TemaKontekst);
  if (!k) throw new Error("useTema mora da stoji unutar <TemaProvider>.");
  return k;
}
