"use client";

// Glavni ekran F2/F3/F9: dva combobox-a, filteri kao toggle dugmad, sumarna
// traka, tabela — i, od F9, cena. Sve ide kroz `POST /api/search` — nema
// direktnog Supabase upita iz pregledača (pravilo 10).
//
// F3 dodaje čekanje na worker: promašaj keša vraća `status: "queued"` i ID posla,
// pa se ovde polluje `GET /api/job/:id` na 3 sekunde, najviše 3 minuta.
//
// F9 dodaje jedno pravilo koje drži ceo ekran: **nijedan zahtev bez `pay: true`
// ne može da skine kredit.** Sve pollovanje, svako listanje strana i svaka
// promena filtera idu bez `pay`, pa su po konstrukciji besplatni. Kredit se
// skida isključivo iz `potvrdiSkeniranje`, posle modala.
//
// Da li nešto košta zna se pre klika, iz registra keša (`kes`): red koji postoji
// i `fresh` je — besplatno; red koji postoji a nije svež — osvežavanje; reda
// nema — prvo skeniranje. Server tu odluku ponovo proverava i on je poslednja
// reč; ovo je samo da korisnik unapred vidi cenu.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Combobox, type ComboGroup } from "./combobox";
import { KesLista } from "./kes-lista";
import { LeadTabela } from "./lead-tabela";
import { SkeniranjeModal, type SkeniranjePredlog } from "./skeniranje-modal";
import { UtisakKartica } from "./utisak-kartica";
import { UtisakMikro } from "./utisak-mikro";
import { useUtisci } from "./utisci-provider";
import { cn } from "@/lib/cn";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { PraznoStanje } from "./ui/stranica";
import {
  MAX_PAGE,
  type ApiError,
  type JobStatusResponse,
  type KesStavka,
  type SearchFilters,
  type SearchResponse,
  type UnlockResponse,
} from "@/lib/search-types";
import { daniDo, formatDatum, formatDatumKratko, plural, summaryLine } from "@/lib/ui-tekst";

type Props = {
  cities: ComboGroup[];
  niches: ComboGroup[];
  cityLabels: Record<string, string>;
  nicheLabels: Record<string, string>;
  /** Registar keša sa servera — i sveže i istekle kombinacije (F9 §3). */
  pocetniKes: KesStavka[];
  /** Balans u trenutku renderovanja strane. Modal ga prikazuje pre naplate. */
  pocetniKrediti: number;
};

const PRAZNI_FILTERI: SearchFilters = { onlyNoSite: false, onlySocial: false, onlyDead: false };

/** Na koliko se pita za status posla. */
const POLL_MS = 3000;

/**
 * Koliko se čeka pošto tabela sedne pre nego što se javi motoru pitanja.
 *
 * F11 §2.1: pitanje o listi ima smisla tek kad je korisnik listu VIDEO. Tri
 * sekunde su dovoljne da pročita prva dva reda, a prekratke da ode sa ekrana.
 */
const PITANJE_O_LISTI_MS = 3000;

/**
 * Kad se javlja kampanjsko pitanje (cena, „nisi bio 10 dana").
 *
 * Motor ionako ćuti prvih 60 s od učitavanja (`MOTOR.NAJRANIJE_MS`) — pitanje na
 * prvom ekranu je pitanje pre iskustva. Ovaj tajmer postoji da bi se posle tog
 * praga uopšte javio DOGAĐAJ: kampanjsko pitanje nema okidač u radu korisnika,
 * pa bez njega ne bi imalo ko da pokuca na motor.
 */
const KAMPANJA_MS = 62_000;

/** Treće otključavanje pita da li podaci drže vodu (F11 §2.1). */
const OTKLJUCANIH_ZA_PITANJE = 3;

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

/** Šta jedan klik na „Pretraži" traži od servera. */
type Zahtev = {
  city: string;
  niche: string;
  f: SearchFilters;
  page: number;
  /** Bez ovoga se kredit ne može skinuti, ni greškom. */
  pay?: boolean;
  /** Ponovo skeniraj i kad je keš svež (dugme „Osveži za 1 kredit"). */
  force?: boolean;
};

/** Cena kombinacije, izračunata iz registra keša pre ijednog zahteva. */
type Cena =
  | { vrsta: "besplatno"; scannedAt: string; expiresAt: string; prazno: boolean }
  | { vrsta: "prvo" }
  | { vrsta: "isteklo"; scannedAt: string };

export function PretragaEkran({
  cities,
  niches,
  cityLabels,
  nicheLabels,
  pocetniKes,
  pocetniKrediti,
}: Props) {
  const router = useRouter();
  // Motor pitanja (F11). Ekran mu javlja SAMO da je okidač pukao — hoće li se
  // pitanje pojaviti odlučuje motor, i najčešći ishod je da neće.
  const utisci = useUtisci();
  const [city, setCity] = useState<string | null>(null);
  const [niche, setNiche] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(PRAZNI_FILTERI);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [ucitava, setUcitava] = useState(false);

  // Registar keša i balans stižu sa servera i osvežavaju se posle svakog posla.
  const [kes, setKes] = useState<KesStavka[]>(pocetniKes);
  const [krediti, setKrediti] = useState(pocetniKrediti);

  useEffect(() => setKes(pocetniKes), [pocetniKes]);
  useEffect(() => setKrediti(pocetniKrediti), [pocetniKrediti]);

  // Poslednji zahtev, da listanje strana i promena filtera ne moraju da ga
  // sastavljaju iz stanja koje se u međuvremenu promenilo.
  const [poslednji, setPoslednji] = useState<Zahtev | null>(null);

  // Stanje čekanja na worker.
  const [posao, setPosao] = useState<JobStatusResponse | null>(null);
  const [predugo, setPredugo] = useState(false);

  /**
   * ID posla koji nije prošao — okidač za `posao-pao` (F11 §2.2).
   *
   * Zašto stanje, a ne poziv motoru odmah na mestu pada: `setPosao(null)` još
   * nije stigao do ekrana u trenutku kad pad postane poznat, pa bi motor video
   * posao u toku i pitanje bi tiho otpalo. Ovako se javlja iz efekta, kad je
   * ekran stvarno miran.
   */
  const [paoPosao, setPaoPosao] = useState<number | null>(null);

  // Potvrda naplate. `predlog` je ono što modal prikazuje, `naplata` je zahtev
  // koji se šalje kad korisnik potvrdi.
  const [predlog, setPredlog] = useState<SkeniranjePredlog | null>(null);
  const naplata = useRef<Zahtev | null>(null);
  const [obavestenje, setObavestenje] = useState<string | null>(null);

  // Otključavanje: `place_id` reda u toku, i poruka posle uspeha.
  const [otkljucavam, setOtkljucavam] = useState<string | null>(null);
  const [otkljucano, setOtkljucano] = useState<string | null>(null);

  /**
   * Koliko je prospekata otključano OTKAD je strana učitana.
   *
   * Ukupan broj stiže sa servera (`utisci.uslovi.otkljucano`) i menja se samo na
   * punom učitavanju, pa bi sam po sebi promašio baš treće otključavanje — ono
   * koje se upravo desilo.
   */
  const [otkljucanoSad, setOtkljucanoSad] = useState(0);

  // Svako novo pretraživanje poništava prethodno pollovanje. Bez ovoga bi dve
  // pretrage u nizu naizmenično prepisivale istu tabelu.
  const pollToken = useRef(0);
  useEffect(() => () => void (pollToken.current += 1), []);

  const kesMapa = useMemo(
    () => new Map(kes.map((s) => [`${s.city}:${s.niche}`, s])),
    [kes],
  );

  /** Cena za par (grad, niša) — ono što piše u traci ispod forme. */
  const cenaZa = useCallback(
    (c: string, n: string): Cena => {
      const stavka = kesMapa.get(`${c}:${n}`);
      if (!stavka) return { vrsta: "prvo" };
      if (!stavka.fresh) return { vrsta: "isteklo", scannedAt: stavka.scannedAt };
      return {
        vrsta: "besplatno",
        scannedAt: stavka.scannedAt,
        expiresAt: stavka.expiresAt,
        prazno: stavka.empty,
      };
    },
    [kesMapa],
  );

  const cena = city && niche ? cenaZa(city, niche) : null;

  /** Registar se menja tek kad posao završi, pa se dovlači samo tada. */
  async function osveziKes() {
    try {
      const res = await fetch("/api/search/kes", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { stavke: KesStavka[] };
      setKes(json.stavke);
    } catch {
      // Lista je pomoćna. Ako ne stigne, sledeći `router.refresh()` je donese.
    }
  }

  /**
   * Jedan poziv pretrage. Vraća odgovor da bi pozivalac mogao da nastavi.
   *
   * `token` se proverava i posle `await`-a: bez toga zakasnela runda pollovanja
   * stare pretrage prepiše tabelu koju je nova već popunila.
   */
  async function trazi(z: Zahtev, token: number): Promise<SearchResponse | null> {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        city: z.city,
        niche: z.niche,
        filters: z.f,
        page: z.page,
        pay: z.pay === true,
        force: z.force === true,
      }),
    });

    const json: SearchResponse | ApiError = await res.json();

    if (token !== pollToken.current) return null;

    if (!res.ok) {
      setGreska("greska" in json ? json.greska : "Pretraga nije uspela.");
      setData(null);
      return null;
    }

    const odgovor = json as SearchResponse;

    // Naplata je jedini put kojim se balans menja mimo otključavanja.
    if (typeof odgovor.creditsLeft === "number") setKrediti(odgovor.creditsLeft);
    if (odgovor.scan) setKrediti(odgovor.scan.creditsLeft);

    // `needs_scan` nije rezultat nego račun — tabela ostaje prazna dok se ne plati.
    setData(odgovor);
    return odgovor;
  }

  /**
   * Klik korisnika. `interaktivno` znači „ovo je tražio čovek", pa sme da otvori
   * modal; pollovanje i osvežavanja liste to ne smeju.
   */
  async function pretrazi(z: Zahtev, interaktivno = true) {
    const token = ++pollToken.current;

    setUcitava(true);
    setGreska(null);
    setPosao(null);
    setPredugo(false);
    setPaoPosao(null);
    setPoslednji(z);

    try {
      const odgovor = await trazi(z, token);
      if (!odgovor || token !== pollToken.current) return;

      if (odgovor.status === "needs_scan" && odgovor.scan) {
        // Server kaže da ovo košta, a klijent je mislio da je besplatno (npr.
        // keš je istekao u međuvremenu). Modal ide iz odgovora, ne iz procene.
        if (interaktivno) {
          naplata.current = { ...z, pay: true };
          setPredlog({
            razlog: odgovor.scan.kind === "osvezavanje" ? "isteklo" : "prvo",
            cost: odgovor.scan.cost,
            lastScannedAt: odgovor.scan.lastScannedAt,
            creditsLeft: odgovor.scan.creditsLeft,
            cityLabel: cityLabels[z.city] ?? z.city,
            nicheLabel: nicheLabels[z.niche] ?? z.niche,
          });
        }
        return;
      }

      if (odgovor.charged) {
        setObavestenje(
          `Skinut je 1 kredit za skeniranje. Ostalo ti je ${odgovor.creditsLeft} ` +
            `${plural(odgovor.creditsLeft ?? 0, "kredit", "kredita", "kredita")}.`,
        );
        // Balans u bočnoj traci crta serverski layout.
        router.refresh();
      }

      // Bez ispravnog ID-ja nema šta da se prati. Traka se tada NE prikazuje —
      // bolje odmah pokazati listu kakva jeste nego vrteti spinner nad poslom o
      // kome ne možemo ništa da saznamo.
      const jobId = odgovor.status === "queued" ? odgovor.job?.id : undefined;

      if (typeof jobId === "number" && Number.isInteger(jobId) && jobId > 0) {
        setPosao({ id: jobId, status: "pending", progress: null, greska: null });
        void pratiPosao(jobId, token, z);
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
   * kako se popunjava, umesto da gleda spinner pa dobije sve odjednom. Sva ta
   * osvežavanja idu bez `pay`, pa ne mogu da skinu kredit ni u jednom ishodu;
   * server ih prepoznaje kao „posao koji je ovaj korisnik već platio" i servira
   * keš besplatno dok scan traje.
   *
   * Pravilo bez izuzetka: svaki izlaz iz ove funkcije skida traku (`setPosao(null)`)
   * ili je zamenjuje porukom.
   */
  async function pratiPosao(jobId: number, token: number, z: Zahtev) {
    const kraj = Date.now() + MAX_CEKANJE_MS;
    let poslednjeAnalizirano = -1;
    let mirnihKrugova = 0;

    /** Poslednje osvežavanje liste, pa skidanje trake i osvežavanje registra. */
    async function zavrsi(osveziPrvo: boolean) {
      if (osveziPrvo) await trazi({ ...z, pay: false, force: false }, token);
      if (token === pollToken.current) setPosao(null);
      // Kombinacija je od sada u kešu i besplatna — registar i balans (moguć
      // povraćaj) se osvežavaju tek ovde, kad ima šta da se promeni.
      await osveziKes();
      router.refresh();
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
        setGreska(`${stanje.greska} Kredit za ovo skeniranje ti je vraćen.`);
        setPosao(null);
        setPaoPosao(jobId);
        router.refresh();
        return;
      }

      const analizirano = stanje.progress?.analyzed ?? 0;
      const nadjeno = stanje.progress?.found ?? 0;
      const pomak = nadjeno > 0 && analizirano !== poslednjeAnalizirano;

      if (pomak) {
        poslednjeAnalizirano = analizirano;
        mirnihKrugova = 0;
        await trazi({ ...z, pay: false, force: false }, token);
        if (token !== pollToken.current) return;
      } else {
        mirnihKrugova += 1;
      }

      if (stanje.status === "failed") {
        setGreska("Skeniranje nije uspelo. Kredit za njega ti je vraćen.");
        setPosao(null);
        setPaoPosao(jobId);
        router.refresh();
        return;
      }

      if (stanje.status === "done") {
        // Scan je gotov; ostaje da `enrich_basic` poslovi popune audite. Izlazi su
        // tri: nema šta da se nađe, sve je analizirano, ili je brojač stao (audit
        // koji nikad neće doći — v. MIRNIH_KRUGOVA_DO_KRAJA).
        const gotovo =
          nadjeno === 0 || analizirano >= nadjeno || mirnihKrugova >= MIRNIH_KRUGOVA_DO_KRAJA;

        if (gotovo) {
          await zavrsi(true);
          return;
        }
      }
    }

    if (token === pollToken.current) {
      setPosao(null);
      setPredugo(true);
      // „Polling istekao" je za F11 isto što i pad: korisnik je ostao bez
      // rezultata koji je tražio (§2.2). Posao se u pozadini možda i završi.
      setPaoPosao(jobId);
    }
  }

  // ── ulazne tačke iz UI-ja ────────────────────────────────

  /** Klik na „Pretraži". Besplatno ide odmah, plaćeno kroz modal. */
  function posalji(f: SearchFilters, page: number) {
    if (!city || !niche) {
      setGreska("Izaberi i grad i nišu.");
      return;
    }

    setObavestenje(null);
    const c = cenaZa(city, niche);

    if (c.vrsta === "besplatno") {
      void pretrazi({ city, niche, f, page });
      return;
    }

    naplata.current = { city, niche, f, page, pay: true };
    setPredlog({
      razlog: c.vrsta === "isteklo" ? "isteklo" : "prvo",
      cost: 1,
      lastScannedAt: c.vrsta === "isteklo" ? c.scannedAt : null,
      creditsLeft: krediti,
      cityLabel: cityLabels[city] ?? city,
      nicheLabel: nicheLabels[niche] ?? niche,
    });
  }

  /** Dugme „Osveži za 1 kredit" nad kombinacijom koja je i dalje sveža. */
  function ponoviSkeniranje() {
    if (!city || !niche) return;
    const c = cenaZa(city, niche);

    setObavestenje(null);
    naplata.current = { city, niche, f: filters, page: 1, pay: true, force: true };
    setPredlog({
      razlog: "rucno",
      cost: 1,
      lastScannedAt: c.vrsta === "besplatno" ? c.scannedAt : null,
      creditsLeft: krediti,
      cityLabel: cityLabels[city] ?? city,
      nicheLabel: nicheLabels[niche] ?? niche,
    });
  }

  function potvrdiSkeniranje() {
    const z = naplata.current;
    if (!z) return;
    naplata.current = null;
    setPredlog(null);
    void pretrazi(z);
  }

  /** Klik na red u listi besplatnih pretraga. */
  function izKesa(c: string, n: string) {
    setCity(c);
    setNiche(n);
    setObavestenje(null);
    void pretrazi({ city: c, niche: n, f: filters, page: 1 });
  }

  /**
   * Otključavanje jednog prospekta.
   *
   * Lista se NE traži ponovo posle uspeha: `/api/unlock` vraća pun otključan
   * lead, pa se menja samo taj jedan red.
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

      // Ponovljeno otključavanje nije novo otključavanje — kredit se ne skida i
      // brojač se ne pomera.
      if (!odgovor.alreadyUnlocked) setOtkljucanoSad((n) => n + 1);

      setKrediti(odgovor.creditsLeft);
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

  // Promena filtera ili strane ne traži novi klik na „Pretraži", i ne može da
  // košta: `poslednji` se ponavlja bez `pay`.
  function primeniFiltere(sledeci: SearchFilters) {
    setFilters(sledeci);
    if (poslednji) void pretrazi({ ...poslednji, f: sledeci, page: 1, pay: false, force: false });
  }

  function naStranu(page: number) {
    if (poslednji) void pretrazi({ ...poslednji, page, pay: false, force: false });
  }

  const strana = data?.page ?? 1;
  const strana_ukupno = data ? Math.min(Math.ceil(data.total / data.pageSize) || 1, MAX_PAGE) : 1;
  const ceka = posao !== null && !predugo;
  const imaRezultat = data !== null && data.status !== "needs_scan";

  // ── motor pitanja: šta je ovaj ekran dužan da javi ────────
  // Tri pitanja iz F11.1 žive ovde, jer su sva tri o istoj stvari: da li je ono
  // što je korisnik upravo dobio upotrebljivo.

  /** Dok posao radi ili je modal otvoren — nikad (F11 §3.1). */
  useEffect(() => {
    utisci?.postaviMir("pretraga", !ceka && !ucitava && predlog === null);
  }, [utisci, ceka, ucitava, predlog]);

  /** Prva pretraga koja vrati bar jedan prospekt, 3 s pošto tabela sedne. */
  useEffect(() => {
    if (!utisci || !imaRezultat || ceka || !data || data.total === 0) return;

    const t = setTimeout(() => utisci.prijaviDogadjaj("prva-lista"), PITANJE_O_LISTI_MS);
    return () => clearTimeout(t);
  }, [utisci, imaRezultat, ceka, data]);

  /** Skeniranje je obavljeno i Google nije vratio nijednu firmu. */
  useEffect(() => {
    if (!utisci || ceka || predugo) return;
    if (!data?.emptyScan || data.total > 0) return;

    utisci.prijaviDogadjaj("prazan-rezultat");
  }, [utisci, ceka, predugo, data]);

  /** Posao je pao ili je čekanje isteklo. Jedino pitanje koje seče cooldown. */
  useEffect(() => {
    if (!utisci || paoPosao === null || ceka || ucitava || predlog !== null) return;

    utisci.prijaviDogadjaj("posao-pao", { jobId: paoPosao });
  }, [utisci, paoPosao, ceka, ucitava, predlog]);

  /**
   * Treće otključavanje (F11 §2.1). Traka staje uz potvrdu o otključavanju — tu
   * su i podaci o kojima pita, red koji je upravo dobio telefon i mejl.
   */
  useEffect(() => {
    if (!utisci || otkljucanoSad === 0 || otkljucavam !== null) return;
    if (utisci.uslovi.otkljucano + otkljucanoSad < OTKLJUCANIH_ZA_PITANJE) return;

    utisci.prijaviDogadjaj("tacnost-podataka");
  }, [utisci, otkljucanoSad, otkljucavam]);

  /**
   * Kampanjska pitanja (F11 §2.3). Uslov — sedam dana i pet otključanih, odnosno
   * pauza od deset dana — proverava MOTOR, iz kataloga. Ekran samo javlja da je
   * prošlo dovoljno vremena od učitavanja da pitanje ne bude pitanje pre
   * iskustva.
   */
  useEffect(() => {
    if (!utisci) return;

    const t = setTimeout(() => {
      utisci.prijaviDogadjaj("zasto-ne-vracas");
      utisci.prijaviDogadjaj("cena");
    }, KAMPANJA_MS);

    return () => clearTimeout(t);
  }, [utisci]);

  return (
    <div className="space-y-6">
      {/* Kampanjska kartica ide na vrh ekrana, iznad forme (F11 §2.3): pitanje o
          ceni se postavlja jednom u životu naloga i ne sme da se traži skrolom.
          Traka „nisi bio 10 dana" stoji tu iz istog razloga. */}
      <UtisakKartica kljuc="cena" />
      <UtisakMikro kljuc="zasto-ne-vracas" />

      <Card className="overflow-visible p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            posalji(filters, 1);
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
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={ucitava || ceka || (cena !== null && cena.vrsta !== "besplatno" && krediti < 1)}
          >
            <Search className="h-4 w-4" />
            {ucitava
              ? "Tražim…"
              : cena === null || cena.vrsta === "besplatno"
                ? "Pretraži"
                : cena.vrsta === "isteklo"
                  ? "Osveži za 1 kredit"
                  : "Skeniraj za 1 kredit"}
          </Button>
        </form>

        <TrakaCene cena={cena} krediti={krediti} />
      </Card>

      {/* Incident stoji uz poruku o padu, ne na dnu ekrana: pitanje je ovde
          usluga, a ne molba (F11 §2.2). */}
      <UtisakMikro kljuc="posao-pao" />

      {greska && <Alert variant="danger">{greska}</Alert>}

      {obavestenje && <Alert variant="success">{obavestenje}</Alert>}

      {otkljucano && (
        <Alert variant="success">
          {otkljucano} <a href="/lista">Moja lista</a>
        </Alert>
      )}

      {/* Pitanje o tačnosti podataka stoji uz potvrdu o otključavanju — tu su i
          podaci o kojima pita (F11 §2.1). */}
      <UtisakMikro kljuc="tacnost-podataka" />

      {ceka && <TrakaPosla posao={posao} />}

      {predugo && (
        <Alert variant="warning">
          <p className="font-medium">Traje duže nego obično.</p>
          <p className="mt-0.5 opacity-90">
            Skeniranje se nastavlja u pozadini i kredit je već plaćen. Rezultat će biti ovde kad
            se vratiš — ta pretraga tada ide iz keša, besplatno i bez čekanja.
          </p>
        </Alert>
      )}

      {/* Lista keša stoji ODMAH ispod forme dok rezultata nema — tada je ona
          glavna stvar na ekranu i nosi uvodni tekst. Čim rezultati stignu,
          sklapa se u jedan red (v. `sazeto`) i propušta tabelu napred. */}
      {!imaRezultat && (
        <KesLista
          stavke={kes}
          cityLabels={cityLabels}
          nicheLabels={nicheLabels}
          onIzaberi={izKesa}
          disabled={ucitava || ceka}
        />
      )}

      {imaRezultat && data && (
        <section className="space-y-4">
          {/* Dok scan traje a lista je još prazna, filter nema nad čim da radi. */}
          <FilterTraka
            filters={filters}
            onChange={primeniFiltere}
            disabled={ucitava || (ceka && data.total === 0)}
          />

          {data.total === 0 && !ceka && !predugo ? (
            <div className="space-y-4">
              <PraznoStanje
                ikona={<Search />}
                naslov={
                  data.emptyScan
                    ? "Google nema nijednu firmu za ovu kombinaciju."
                    : "Nijedan prospekt ne odgovara filterima."
                }
                opis={
                  data.emptyScan
                    ? "Skeniranje je obavljeno i ništa nije nađeno — ako si ga platio, kredit ti je vraćen. Probaj drugu nišu ili susedni grad."
                    : "Baza za ovaj grad i nišu nije prazna — filteri su preuski. Isključi neki toggle iznad."
                }
              />

              {/* Odgovor je spisak niša i gradova koje ljudi traže a ja ih
                  nemam — direktan ulaz u taksonomiju (F11 §2.1). */}
              <UtisakMikro kljuc="prazan-rezultat" />
            </div>
          ) : data.total === 0 ? null : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm num">{summaryLine(data.total, data.summary)}</p>

                {data.freshness && (
                  <p className="flex items-center gap-2 text-xs text-fg-muted">
                    <span className="num">
                      Osveženo {formatDatum(data.freshness.scannedAt)} · besplatno do{" "}
                      {formatDatumKratko(data.freshness.expiresAt)}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={ucitava || ceka || krediti < 1}
                      onClick={ponoviSkeniranje}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Osveži za 1 kredit
                    </Button>
                  </p>
                )}
              </div>

              {/* Traka iznad tabele (F11 §6.1). Pojavljuje se 3 s pošto tabela
                  sedne i ne pomera je više nego jednom. */}
              <UtisakMikro kljuc="prva-lista" />

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
                      onClick={() => naStranu(strana - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Prethodna
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={strana >= strana_ukupno || ucitava}
                      onClick={() => naStranu(strana + 1)}
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

      {/* Prazna kombinacija koja JESTE skenirana: izlaz je platiti novo skeniranje. */}
      {imaRezultat && data?.emptyScan && !ceka && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ucitava || krediti < 1}
            onClick={ponoviSkeniranje}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Skeniraj ipak ponovo za 1 kredit
          </Button>
        </div>
      )}

      {imaRezultat && (
        <KesLista
          stavke={kes}
          cityLabels={cityLabels}
          nicheLabels={nicheLabels}
          onIzaberi={izKesa}
          sazeto
          disabled={ucitava || ceka}
        />
      )}

      <SkeniranjeModal
        predlog={predlog}
        ceka={ucitava}
        onPotvrdi={potvrdiSkeniranje}
        onOdustani={() => {
          naplata.current = null;
          setPredlog(null);
        }}
      />
    </div>
  );
}

/**
 * Jedna rečenica ispod forme: da li ovo košta, koliko i zašto (F9 §4.1).
 *
 * Stoji i pre prve pretrage — cena mora da se vidi PRE klika, ne posle njega.
 */
function TrakaCene({ cena, krediti }: { cena: Cena | null; krediti: number }) {
  if (!cena) return null;

  if (cena.vrsta === "besplatno") {
    const dana = daniDo(cena.expiresAt);

    return (
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-xs">
        <span className="font-medium text-accent-text">U kešu — besplatno</span>
        <span className="text-fg-muted num">
          {cena.prazno
            ? `Skenirano ${formatDatum(cena.scannedAt)} — Google nema nijednu firmu.`
            : dana <= 0
              ? `Osveženo ${formatDatum(cena.scannedAt)}. Rok ističe danas — sutra skeniranje košta 1 kredit.`
              : `Osveženo ${formatDatum(cena.scannedAt)}, besplatno još ${dana} ${plural(dana, "dan", "dana", "dana")}.`}
        </span>
      </p>
    );
  }

  const nemaKredita = krediti < 1;

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-xs">
      <span className={cn("font-medium", nemaKredita ? "text-danger" : "text-warn-text")}>
        {cena.vrsta === "isteklo"
          ? "Podaci su stariji od 30 dana — osvežavanje košta 1 kredit"
          : "Nije u kešu — skeniranje košta 1 kredit"}
      </span>
      <span className="text-fg-muted num">
        {nemaKredita ? (
          <>
            Nemaš kredita. Pretrage iz keša su i dalje besplatne.{" "}
            <a href="/krediti" className="text-accent-text underline-offset-4 hover:underline">
              Vidi kredite
            </a>
          </>
        ) : cena.vrsta === "isteklo" ? (
          `Poslednje skeniranje: ${formatDatum(cena.scannedAt)}. Imaš ${krediti} ${plural(krediti, "kredit", "kredita", "kredita")}.`
        ) : (
          `Posle skeniranja je besplatna svima 30 dana. Imaš ${krediti} ${plural(krediti, "kredit", "kredita", "kredita")}.`
        )}
      </span>
    </p>
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
        Skeniranje traje do dva minuta. Posle toga je ova kombinacija u kešu — tebi i svima
        ostalima besplatna narednih 30 dana.
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
          : "border-border-strong bg-bg-elev text-fg-muted hover:border-fg-muted hover:text-fg",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
