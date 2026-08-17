"use client";

// apps/web/src/components/utisci-provider.tsx
// Motor pitanja u pregledaču (F11 §3).
//
// ── zašto kontekst, a ne `if` u komponenti ───────────────────
// Pitanja su raspoređena po pet ekrana i tri stanja posla. Bez jednog mesta koje
// odlučuje, dva pitanja se pojave u istoj minuti — a korisnik tada ne vidi dva
// pitanja nego anketu, i zatvara sve što liči na nju do kraja bete.
//
// ── šta je gde ───────────────────────────────────────────────
// Pravila su čiste funkcije u `@sajtoskop/shared/feedback-motor` i ovde se samo
// pozivaju. Stanje stiže sa servera kroz `(app)/layout.tsx` — profil se ionako
// čita, a `feedback_prompts` je jedan upit po PUNOM učitavanju. Klijentska
// navigacija `/pretraga → /lista` ne košta ništa jer se layout ne izvršava
// ponovo (F11 §3.3).
//
// Jedino stanje koje sme da bude u pregledaču je sesija — `sessionStorage`,
// jer „sesija" i jeste pojam pregledača. Sve ostalo je u bazi, da preživi odjavu
// i drugi računar.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  odluci,
  pitanjeZaKljuc,
  posleOdbacivanja,
  posleOdgovora,
  poslePrikaza,
  type MotorStanje,
  type StanjePitanja,
  type Uslovi,
} from "@sajtoskop/shared";
import { pratiGreske, procitajDnevnik } from "@/lib/dnevnik-gresaka";
import type { DopunaOdgovor, UtisakOdgovor } from "@/lib/feedback-schema";

/** Sesija je po tabu — i to je namerno (F11 §9: dva taba, jedan cooldown). */
const SESIJA_KLJUC = "sajtoskop-utisak-sesija";

export type UtisciApi = {
  /** Ključ pitanja koje je trenutno na ekranu, ili `null`. */
  aktivno: string | null;
  /**
   * Stanje naloga u trenutku poslednjeg punog učitavanja.
   *
   * Ekranu treba samo za okidače koji broje („treće otključavanje"): motor sam
   * proverava `uslov` iz kataloga i ekran mu u tome ne pomaže.
   */
  uslovi: Uslovi;
  /**
   * Okidač je pukao („lista je popunjena", „posao je pao"). Motor odlučuje hoće
   * li se pitanje pojaviti — najčešći ishod je da neće, i to je u redu.
   *
   * `dodatak` ulazi u `answers` uz odgovor (npr. `{ jobId }`).
   */
  prijaviDogadjaj: (kljuc: string, dodatak?: Record<string, unknown>) => void;
  /**
   * Miran ekran = nema posla u toku, nema otvorenog modala ni panela.
   *
   * `izvor` postoji zato što nemirnih stvari ume da bude više odjednom: skeniranje
   * na `/pretraga`, panel iza plutajućeg dugmeta i modal sa porukama su tri
   * nezavisna razloga. Sa jednim booleanom bi zatvaranje panela proglasilo ekran
   * mirnim usred skeniranja — poslednji koji javi pobeđuje. Ovako se broje
   * razlozi, a ekran je miran tek kad ih nema nijedan.
   */
  postaviMir: (izvor: string, miran: boolean) => void;
  /** Odgovor na pitanje. Prvi klik je već poslat utisak (F10 odluka 2). */
  posalji: (kljuc: string, answers: Record<string, unknown>) => Promise<UtisakOdgovor>;
  /** Dopuna tekstom, kroz postojeću `PATCH /api/feedback/[id]`. */
  dopuni: (id: number, message: string) => Promise<DopunaOdgovor>;
  /**
   * Drugi korak odgovora: „bi li ga preporučio kolegi", čipovi „šta nije
   * štimalo". Ide istim `PATCH`-om, pa se na serveru spaja sa prvim odgovorom i
   * ponovo proverava šemom iz kataloga (pravilo 16).
   */
  dopuniOdgovor: (id: number, answers: Record<string, unknown>) => Promise<void>;
  /** Klik na `✕`. */
  odbaci: (kljuc: string) => void;
  /** Traka je odradila svoje i sklanja se. Ne dira nijedan brojač. */
  zatvori: () => void;
};

const Ctx = createContext<UtisciApi | null>(null);

/**
 * Van `UtisciProvider`-a pitanja prosto nema.
 *
 * Namerno ne baca: mikro-traka sme da stoji na ekranu koji nije unutar `(app)`
 * okvira (npr. u budućem javnom prikazu) i tamo je ispravno ponašanje da se ne
 * pojavi, a ne da strana pukne.
 */
export function useUtisci(): UtisciApi | null {
  return useContext(Ctx);
}

const kasniji = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
};

/**
 * Tiho stanje dok server odgovor još nije stigao (Faza 3, 3.6).
 *
 * Layout više ne šalje stanje motora pre prvog bajta; provider ga povlači sa
 * `/api/utisci/stanje` posle prikaza. Dok stiže, odluke se ne donose uopšte
 * (`ucitanoSaServera` kapija u `prijaviDogadjaj`), pa ni jedno pitanje ne može
 * da se pojavi na osnovu praznog stanja — nema bljeska ni ponovljenog pitanja.
 */
const TIHO_STANJE: MotorStanje = {
  cooldownUntil: null,
  mutedUntil: null,
  dismissStreak: 0,
  poPitanju: {},
};

const TIHI_USLOVI: Uslovi = { danaOdRegistracije: 0, otkljucano: 0, danaPauze: 0 };

export function UtisciProvider({
  stanje,
  uslovi,
  children,
}: {
  /** `null` od Faze 3 (3.6): stanje se povlači klijentski posle prvog prikaza. */
  stanje: MotorStanje | null;
  /** Isti put kao `stanje` (3.6). */
  uslovi: Uslovi | null;
  children: React.ReactNode;
}) {
  const putanja = usePathname();
  const [aktivno, setAktivno] = useState<string | null>(null);

  // [Faza 3, 3.6] Server stanje živi u state-u: kada dođe kroz prop (stari
  // put), odmah; inače se povlači jednom posle montiranja.
  const [serverStanje, setServerStanje] = useState<MotorStanje | null>(stanje);
  const [serverUslovi, setServerUslovi] = useState<Uslovi | null>(uslovi);
  const [ucitanoSaServera, setUcitanoSaServera] = useState(stanje !== null && uslovi !== null);

  useEffect(() => {
    if (stanje !== null && uslovi !== null) return;
    let ziv = true;
    fetch("/api/utisci/stanje", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ stanje: MotorStanje; uslovi: Uslovi }>) : null))
      .then((telo) => {
        if (!ziv || !telo) return;
        setServerStanje(telo.stanje);
        setServerUslovi(telo.uslovi);
        setUcitanoSaServera(true);
      })
      .catch(() => {
        // Bez veze sa serverom nema ni pitanja — sledeći pun učitaj pokušava
        // ponovo. Ćutanje je ispravnije od pitanja na osnovu praznog stanja.
      });
    return () => {
      ziv = false;
    };
  }, [stanje, uslovi]);

  // Dnevnik klijentskih grešaka se puni od prvog trenutka, a šalje se samo uz
  // prijavu kvara (F11 odluka 10). Ovde je zato što je ovaj provider jedina
  // komponenta koja sigurno stoji iznad svega unutar `(app)` okvira.
  useEffect(() => pratiGreske(), []);

  /** Trenutak punog učitavanja — pravilo „ne pre 60 s" meri se odavde. */
  const ucitano = useRef(Date.now());
  /** Razlozi zbog kojih ekran nije miran. Prazan skup = miran. */
  const nemir = useRef(new Set<string>());
  const uToku = useRef(false);
  const aktivnoRef = useRef<string | null>(null);
  const dodatak = useRef<Record<string, unknown>>({});

  /**
   * Ono što se dogodilo POSLE poslednjeg učitavanja.
   *
   * Ne prepisuje se propovima: `router.refresh()` ume da donese stanje starije
   * od klika koji se upravo desio, a pitanje koje se zbog toga pojavi drugi put
   * je tačno ono što ceo motor postoji da spreči. Server je izvor istine, ali
   * spajanje ide u korist strožeg — kasniji cooldown, viđeno pitanje ostaje
   * viđeno.
   */
  const lokalno = useRef<Record<string, StanjePitanja>>({});
  const lokalniCooldown = useRef<string | null>(null);
  const lokalniMute = useRef<string | null>(null);
  const lokalniStreak = useRef<number | null>(null);

  useEffect(() => {
    aktivnoRef.current = aktivno;
  }, [aktivno]);

  const trenutnoStanje = useCallback(
    (): MotorStanje => {
      const izServera = serverStanje ?? TIHO_STANJE;
      return {
        cooldownUntil: kasniji(izServera.cooldownUntil, lokalniCooldown.current),
        mutedUntil: kasniji(izServera.mutedUntil, lokalniMute.current),
        dismissStreak: lokalniStreak.current ?? izServera.dismissStreak,
        poPitanju: { ...izServera.poPitanju, ...lokalno.current },
      };
    },
    [serverStanje],
  );

  const postaviMir = useCallback((izvor: string, sledeci: boolean) => {
    if (sledeci) nemir.current.delete(izvor);
    else nemir.current.add(izvor);
  }, []);

  const prijaviDogadjaj = useCallback(
    (kljuc: string, dodatniOdgovor?: Record<string, unknown>) => {
      // [Faza 3, 3.6] Dok server stanje ne stigne, odluke se ne donose — pitanje
      // na osnovu praznog stanja bi bilo ponovljeno ili preko cooldown-a.
      if (!ucitanoSaServera) return;
      if (uToku.current || aktivnoRef.current !== null) return;

      const pitanje = pitanjeZaKljuc(kljuc);
      if (!pitanje) return;

      const odluka = odluci(
        trenutnoStanje(),
        {
          pitanoUSesiji: procitajSesiju(),
          ekranMiran: nemir.current.size === 0,
          odUcitavanjaMs: Date.now() - ucitano.current,
          uslovi: serverUslovi ?? TIHI_USLOVI,
        },
        [pitanje],
      );

      if (!odluka.pitanje) return;

      uToku.current = true;

      void (async () => {
        try {
          // Prikaz se UPISUJE, pa tek onda računa kao viđen (§3.2). Pad upisa
          // znači da se pitanje ne prikazuje — bolje propušteno nego dvaput
          // postavljeno. 409 je drugi tab koji je isto pitanje već upisao.
          const res = await fetch(
            `/api/feedback/pitanje/${encodeURIComponent(kljuc)}/prikazano`,
            { method: "POST" },
          );
          if (!res.ok) return;

          const sada = Date.now();
          lokalno.current[kljuc] = { status: "prikazano", shownAt: new Date(sada).toISOString() };
          lokalniCooldown.current = kasniji(
            lokalniCooldown.current,
            poslePrikaza(sada).cooldownUntil,
          );
          upisiSesiju();
          dodatak.current = dodatniOdgovor ?? {};
          setAktivno(kljuc);
        } catch {
          // Bez veze sa serverom nema ni pitanja. Sledeći događaj pokušava opet.
        } finally {
          uToku.current = false;
        }
      })();
    },
    [trenutnoStanje, serverUslovi, ucitanoSaServera],
  );

  const posalji = useCallback(
    async (kljuc: string, answers: Record<string, unknown>): Promise<UtisakOdgovor> => {
      const spojeni = { ...dodatak.current, ...answers };

      // Dnevnik grešaka ide uz odgovor koji je prijava kvara — dakle uz „Pošalji
      // mi dnevnik" kod `posao-pao`, i nigde drugde (F11 odluka 10). Server istu
      // odluku donosi ponovo, iz kataloga, pa ovo nije jedina brana.
      const pitanje = pitanjeZaKljuc(kljuc);
      const prijava =
        pitanje?.prijava && spojeni.odgovor === pitanje.prijava.odgovor ? pitanje.prijava : null;

      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_key: kljuc,
          answers: spojeni,
          route: putanja,
          // Jedini podatak o uređaju koji server ne zna sam.
          viewport: `${window.innerWidth}×${window.innerHeight}`,
          ...(prijava ? { errors: procitajDnevnik() } : {}),
        }),
      });

      if (!res.ok) throw new Error(String(res.status));

      const sada = Date.now();
      lokalno.current[kljuc] = { status: "odgovoreno", shownAt: new Date(sada).toISOString() };
      const posle = posleOdgovora(sada);
      lokalniCooldown.current = kasniji(lokalniCooldown.current, posle.cooldownUntil);
      lokalniStreak.current = posle.dismissStreak;

      return (await res.json()) as UtisakOdgovor;
    },
    [putanja],
  );

  const dopuni = useCallback(async (id: number, message: string): Promise<DopunaOdgovor> => {
    const res = await fetch(`/api/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as DopunaOdgovor;
  }, []);

  const dopuniOdgovor = useCallback(
    async (id: number, answers: Record<string, unknown>): Promise<void> => {
      const res = await fetch(`/api/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });

      if (!res.ok) throw new Error(String(res.status));
    },
    [],
  );

  const odbaci = useCallback((kljuc: string) => {
    const sada = Date.now();
    lokalno.current[kljuc] = { status: "odbaceno", shownAt: new Date(sada).toISOString() };

    const posle = posleOdbacivanja(lokalniStreak.current ?? 0, sada);
    lokalniStreak.current = posle.dismissStreak;
    lokalniMute.current = kasniji(lokalniMute.current, posle.mutedUntil);

    setAktivno(null);

    // Streak i ćutanje računa server iz svog brojača — ovaj lokalni je samo da
    // se pitanje ne vrati pre sledećeg učitavanja.
    void fetch(`/api/feedback/pitanje/${encodeURIComponent(kljuc)}/odbaceno`, {
      method: "POST",
    }).catch(() => {
      // Neuspeh znači da streak ostaje gde je bio. Nema šta da se javi.
    });
  }, []);

  const zatvori = useCallback(() => setAktivno(null), []);

  const api = useMemo<UtisciApi>(
    () => ({
      aktivno,
      uslovi: serverUslovi ?? TIHI_USLOVI,
      prijaviDogadjaj,
      postaviMir,
      posalji,
      dopuni,
      dopuniOdgovor,
      odbaci,
      zatvori,
    }),
    [aktivno, serverUslovi, prijaviDogadjaj, postaviMir, posalji, dopuni, dopuniOdgovor, odbaci, zatvori],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

// ── sesija ───────────────────────────────────────────────────
// Najviše jedno pitanje po sesiji. `sessionStorage` je po tabu, pa dva taba vide
// dve sesije — ali cooldown je u bazi i on ih spaja (F11 §9).

function procitajSesiju(): boolean {
  try {
    return sessionStorage.getItem(SESIJA_KLJUC) === "da";
  } catch {
    // Bez `sessionStorage`-a (privatan režim, zabranjen storage) ostaje samo
    // cooldown iz baze. Jedno pitanje više po sesiji je prihvatljiva cena.
    return false;
  }
}

function upisiSesiju(): void {
  try {
    sessionStorage.setItem(SESIJA_KLJUC, "da");
  } catch {
    /* prazno */
  }
}
