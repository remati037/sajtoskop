"use client";

// apps/web/src/components/onboarding-provider.tsx
// Stanje prvog prolaza u pregledaču: koraci, traka, vođene tačke (S30, §4.5–§4.8).
//
// ── odakle stanje ───────────────────────────────────────────
// Početno stanje daje `(app)/layout.tsx` iz profila koji ionako čita — nula
// dodatnih upita (§4.6). Posle radnje ruta u odgovoru vraća `onboardingSteps`,
// a ekran ga predaje ovde kroz `osvezi()`: traka se pomera bez reload-a.
//
// ── zašto tačke žive ovde, a ne u komponenti uz element ─────
// §4.5: „najviše jedna odjednom, nikad dok je otvoren modal, dok posao radi ili
// dok utisak-motor pokazuje pitanje". Pravilo „najviše jedna" ne može da drži
// komponenta koja zna samo za sebe — dvadeset kartica bi dalo dvadeset balona.
// Zato se svaka tačka ovde PRIJAVLJUJE kao kandidat, a provider bira jednu.
//
// Isti obrazac kao `postaviMir` u `UtisciProvider`-u: nemirnih stvari ume da
// bude više odjednom, pa se broje izvori, a ne jedan boolean.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HINT_KLJUCEVI,
  sviKoraciUradjeni,
  TRAKA_SKRIVENA,
  trakaVidljiva,
  type HintKljuc,
} from "@sajtoskop/shared";
import type { KorakOdgovor, OnboardingPocetno } from "@/lib/onboarding-schema";
import { useUtisci } from "./utisci-provider";

/** Koliko dugo traka pokazuje „Sva četiri…" pre nego što nestane (§4.6). */
const GOTOVO_MS = 2000;
/** Tačka 2 dolazi 3 s posle tačke 1 (§4.5). */
const POSLE_PRVE_MS = 3000;

export type OnboardingApi = {
  koraci: Record<string, string>;
  doneAt: string | null;
  /** Traka stoji u bočnoj traci — ili upravo pokazuje „Sva četiri". */
  trakaPrikaz: boolean;
  /** Četvrti korak je upravo seo; traka 2 s pokazuje završnu rečenicu. */
  zavrsenoUpravo: boolean;
  /** Odgovori čarobnjaka — podrazumevana pretraga i podrazumevan tab poruke. */
  grad: string | null;
  nisa: string | null;
  kanal: string | null;

  /** Koraci iz odgovora rute. `undefined`/`null` ne menja ništa. */
  osvezi: (steps: Record<string, string> | null | undefined) => void;
  /** „Kopiraj" na kartici — jedini korak koji prijavljuje pregledač (§4.3). */
  prijaviKopiranje: () => void;
  /** „Sakrij" u traci (§4.6). */
  sakrijTraku: () => void;

  /** Element se nudi kao mesto za tačku. Vraća odjavu. */
  registruj: (hint: HintKljuc, id: string) => () => void;
  /** Da li baš ovaj element sad nosi tačku. */
  jeAktivna: (hint: HintKljuc, id: string) => boolean;
  /** „Jasno", ili je radnja urađena — tačka se ne vraća (§4.5). */
  zatvori: (hint: HintKljuc) => void;
  /** „Pokaži mi" iz vodiča — jedini put kojim viđena tačka sme da se vrati (§4.8). */
  pokazi: (hint: HintKljuc) => void;
  /** Modal, posao ili preklop je otvoren — tačke ćute. */
  postaviZauzeto: (izvor: string, zauzeto: boolean) => void;
};

const Ctx = createContext<OnboardingApi | null>(null);

/** Van okvira aplikacije onboardinga nema — i ne sme da pukne strana. */
export function useOnboarding(): OnboardingApi | null {
  return useContext(Ctx);
}

export function OnboardingProvider({
  pocetno,
  children,
}: {
  /** `null` = profil nije pročitan (kvar veze). Tada nema ni trake ni tačaka. */
  pocetno: OnboardingPocetno | null;
  children: React.ReactNode;
}) {
  const utisci = useUtisci();
  const pitanjeOtvoreno = utisci?.aktivno ?? null;

  const [koraci, setKoraci] = useState<Record<string, string>>(pocetno?.steps ?? {});
  const [doneAt, setDoneAt] = useState<string | null>(pocetno?.doneAt ?? null);
  const [vidjene, setVidjene] = useState<ReadonlySet<string>>(
    () => new Set(pocetno?.hintsSeen ?? []),
  );
  const [zavrsenoUpravo, setZavrsenoUpravo] = useState(false);
  const [forsirana, setForsirana] = useState<HintKljuc | null>(null);

  // Kandidati i zauzetost su u ref-ovima (menjaju se iz efekata dece), a verzija
  // u stanju je ono što natera provider da ponovo izabere tačku.
  const kandidati = useRef(new Map<HintKljuc, string[]>());
  const zauzeto = useRef(new Set<string>());
  const [verzija, setVerzija] = useState(0);
  const prvaZatvorenaU = useRef<number | null>(null);

  // Novo puno učitavanje (drugi nalog, `router.refresh()` posle radnje) nosi
  // svež profil — ali lokalno stanje je strože: korak koji je upravo seo ne sme
  // da nestane zato što je layout pročitao profil pre klika.
  useEffect(() => {
    if (!pocetno) return;
    setKoraci((pre) => ({ ...pocetno.steps, ...pre }));
    setDoneAt((pre) => pre ?? pocetno.doneAt);
    setVidjene((pre) => new Set([...pre, ...pocetno.hintsSeen]));
  }, [pocetno]);

  const koraciRef = useRef(koraci);
  useEffect(() => {
    koraciRef.current = koraci;
  }, [koraci]);

  const osvezi = useCallback((steps: Record<string, string> | null | undefined) => {
    if (!steps) return;
    const pre = koraciRef.current;
    const sledeci = { ...pre, ...steps };
    koraciRef.current = sledeci;
    setKoraci(sledeci);

    // Četvrti korak je upravo seo: traka 2 s kaže „Sva četiri…" pa nestaje (§4.6).
    if (!sviKoraciUradjeni(pre) && sviKoraciUradjeni(sledeci)) {
      setDoneAt((d) => d ?? new Date().toISOString());
      setZavrsenoUpravo(true);
      setTimeout(() => setZavrsenoUpravo(false), GOTOVO_MS);
    }
  }, []);

  const prijaviKopiranje = useCallback(() => {
    if (koraciRef.current.poruka) return;
    void fetch("/api/onboarding/korak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ korak: "poruka" }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<KorakOdgovor>) : null))
      .then((telo) => {
        if (telo) osvezi(telo.onboardingSteps);
      })
      .catch(() => {
        // Traka ostaje korak iza. Sledeće kopiranje pokušava ponovo.
      });
  }, [osvezi]);

  const sakrijTraku = useCallback(() => {
    setVidjene((pre) => new Set([...pre, TRAKA_SKRIVENA]));
    void fetch("/api/onboarding/preskoci", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gde: "traka" }),
    }).catch(() => {
      // Bez upisa se traka vrati na sledećem punom učitavanju. Nema šta da se javi.
    });
  }, []);

  const registruj = useCallback((hint: HintKljuc, id: string) => {
    const lista = kandidati.current.get(hint) ?? [];
    if (!lista.includes(id)) kandidati.current.set(hint, [...lista, id]);
    setVerzija((v) => v + 1);

    return () => {
      const ostali = (kandidati.current.get(hint) ?? []).filter((x) => x !== id);
      if (ostali.length > 0) kandidati.current.set(hint, ostali);
      else kandidati.current.delete(hint);
      setVerzija((v) => v + 1);
    };
  }, []);

  const postaviZauzeto = useCallback((izvor: string, jeste: boolean) => {
    const imao = zauzeto.current.has(izvor);
    if (jeste === imao) return;
    if (jeste) zauzeto.current.add(izvor);
    else zauzeto.current.delete(izvor);
    setVerzija((v) => v + 1);
  }, []);

  // Poslednje viđene tačke u ref-u: `zatvori` odlučuje o upisu PRE `setState`,
  // jer React u razvoju updater zove dvaput — a upis u bazu ne sme dvaput.
  const vidjeneRef = useRef(vidjene);
  useEffect(() => {
    vidjeneRef.current = vidjene;
  }, [vidjene]);

  const zatvori = useCallback((hint: HintKljuc) => {
    setForsirana((f) => (f === hint ? null : f));
    if (vidjeneRef.current.has(hint)) return;

    vidjeneRef.current = new Set([...vidjeneRef.current, hint]);
    setVidjene(vidjeneRef.current);

    if (hint === "nema-sajt") {
      prvaZatvorenaU.current = Date.now();
      setTimeout(() => setVerzija((v) => v + 1), POSLE_PRVE_MS + 50);
    }
    void fetch("/api/onboarding/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hint }),
    }).catch(() => {
      // Neupisana tačka se vrati na drugom uređaju. Na ovom je već zatvorena.
    });
  }, []);

  const pokazi = useCallback((hint: HintKljuc) => setForsirana(hint), []);

  // ── izbor jedne tačke ─────────────────────────────────────
  const aktivna = useMemo((): { hint: HintKljuc; id: string } | null => {
    if (zauzeto.current.size > 0 || pitanjeOtvoreno !== null) return null;

    if (forsirana) {
      const id = kandidati.current.get(forsirana)?.[0];
      return id ? { hint: forsirana, id } : null;
    }

    if (doneAt !== null) return null;

    for (const hint of HINT_KLJUCEVI) {
      const id = kandidati.current.get(hint)?.[0];
      if (!id || vidjene.has(hint)) continue;

      if (hint === "otkljucaj") {
        // Tačka 2 čeka tačku 1 kad je lista ima (§4.5) — pa još 3 s posle nje.
        if (kandidati.current.has("nema-sajt") && !vidjene.has("nema-sajt")) continue;
        const prva = prvaZatvorenaU.current;
        if (prva !== null && Date.now() - prva < POSLE_PRVE_MS) continue;
      }

      return { hint, id };
    }
    return null;
    // `verzija` je okidač za promene u ref-ovima (kandidati, zauzeto, tajmer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verzija, forsirana, doneAt, vidjene, pitanjeOtvoreno]);

  const jeAktivna = useCallback(
    (hint: HintKljuc, id: string) => aktivna?.hint === hint && aktivna.id === id,
    [aktivna],
  );

  const trakaPrikaz =
    pocetno !== null &&
    (zavrsenoUpravo || trakaVidljiva({ doneAt, hintsSeen: [...vidjene] }));

  const api = useMemo<OnboardingApi>(
    () => ({
      koraci,
      doneAt,
      trakaPrikaz,
      zavrsenoUpravo,
      grad: pocetno?.grad ?? null,
      nisa: pocetno?.nisa ?? null,
      kanal: pocetno?.kanal ?? null,
      osvezi,
      prijaviKopiranje,
      sakrijTraku,
      registruj,
      jeAktivna,
      zatvori,
      pokazi,
      postaviZauzeto,
    }),
    [
      koraci,
      doneAt,
      trakaPrikaz,
      zavrsenoUpravo,
      pocetno,
      osvezi,
      prijaviKopiranje,
      sakrijTraku,
      registruj,
      jeAktivna,
      zatvori,
      pokazi,
      postaviZauzeto,
    ],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
