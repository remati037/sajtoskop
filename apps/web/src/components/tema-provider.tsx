"use client";

// Kontekst teme. Drži izbor („sistem" / „svetla" / „tamna"), razrešava ga u
// stvarnu temu i održava klasu `.dark` na <html>.
//
// Prvo stanje se čita iz DOM-a, ne iz `localStorage`-a: skripta iz <head>-a je
// klasu već postavila, pa čitanje iz DOM-a garantuje da se server i klijent
// slažu i da nema ni bleska ni skoka.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { jeTema, TEMA_KLJUC, type StvarnaTema, type Tema } from "@/lib/tema";

type Kontekst = {
  tema: Tema;
  stvarna: StvarnaTema;
  postaviTemu: (t: Tema) => void;
};

const TemaKontekst = createContext<Kontekst | null>(null);

function primeni(stvarna: StvarnaTema) {
  const koren = document.documentElement;
  koren.classList.toggle("dark", stvarna === "tamna");
  koren.style.colorScheme = stvarna === "tamna" ? "dark" : "light";
}

export function TemaProvider({ children }: { children: React.ReactNode }) {
  const [tema, setTema] = useState<Tema>("sistem");
  const [stvarna, setStvarna] = useState<StvarnaTema>("svetla");

  /**
   * Da li je sačuvan izbor pročitan.
   *
   * Bez ove zastavice postoji trka koja se vidi golim okom: prvi render ima
   * `tema === "sistem"` (jedina vrednost koju server sme da pretpostavi), pa
   * efekat ispod odmah nametne sistemsku temu i pregazi ono što je skripta iz
   * <head>-a već ispravno postavila. Korisnik sa sistemom u tamnom i izborom
   * „svetla" bi posle svakog osvežavanja dobio tamnu temu.
   */
  const [ucitano, setUcitano] = useState(false);

  // Sinhronizacija sa onim što je skripta iz <head>-a već uradila.
  useEffect(() => {
    const sacuvana = (() => {
      try {
        return localStorage.getItem(TEMA_KLJUC);
      } catch {
        return null;
      }
    })();

    setTema(jeTema(sacuvana) ? sacuvana : "sistem");
    setStvarna(document.documentElement.classList.contains("dark") ? "tamna" : "svetla");
    setUcitano(true);
  }, []);

  // Promena sistemske teme mora da se vidi odmah — ali samo dok je izbor „sistem".
  useEffect(() => {
    if (!ucitano || tema !== "sistem") return;

    const upit = window.matchMedia("(prefers-color-scheme: dark)");
    const naPromenu = () => {
      const sledeca: StvarnaTema = upit.matches ? "tamna" : "svetla";
      setStvarna(sledeca);
      primeni(sledeca);
    };

    naPromenu();
    upit.addEventListener("change", naPromenu);
    return () => upit.removeEventListener("change", naPromenu);
  }, [ucitano, tema]);

  const postaviTemu = useCallback((sledeca: Tema) => {
    setTema(sledeca);

    try {
      localStorage.setItem(TEMA_KLJUC, sledeca);
    } catch {
      // Privatni režim. Tema radi do osvežavanja stranice — to je prihvatljivo.
    }

    const razresena: StvarnaTema =
      sledeca === "sistem"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "tamna"
          : "svetla"
        : sledeca;

    setStvarna(razresena);
    primeni(razresena);
  }, []);

  const vrednost = useMemo(
    () => ({ tema, stvarna, postaviTemu }),
    [tema, stvarna, postaviTemu],
  );

  return <TemaKontekst.Provider value={vrednost}>{children}</TemaKontekst.Provider>;
}

export function useTema(): Kontekst {
  const k = useContext(TemaKontekst);
  if (!k) throw new Error("useTema mora da stoji unutar <TemaProvider>.");
  return k;
}
