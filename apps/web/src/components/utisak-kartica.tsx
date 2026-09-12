"use client";

// apps/web/src/components/utisak-kartica.tsx
// Kampanjska kartica (F11 §6.3) — oblik „kartica" iz kataloga.
//
// ── zašto je ovo jedina kartica sa akcentom ──────────────────
// Zelena ivica i zelena podloga su u ovom proizvodu rezervisane za jednu stvar:
// „ovde ima para" (dizajn sistem §3.3). Kartica koja to pozajmi mora da vredi
// koliko i lead bez sajta — a to su tačno dva trenutka u životu naloga: NPS, od
// kog zavisi da li se proizvod uopšte prepričava, i prvi potpisan posao. Oba se
// dešavaju jednom. Treće takve kartice ne sme da bude.
//
// ── prvi klik je već poslat utisak ───────────────────────────
// Isto pravilo kao kod mikro-trake (F10 odluka 2): klik na opseg upisuje red.
// Drugi korak („bi li ga preporučio kolegi"), treći („smem li to da citiram")
// i rečenica dopune idu kroz `PATCH`, pa se odgovor na serveru spaja sa prvim i
// PONOVO proverava šemom iz kataloga — nijedan korak posle prvog nije rupa u
// kapiji (pravilo 16).
//
// Nijedan hex u JSX-u; iznosi su `.num`, jer su brojevi koji se porede.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Info, Loader2, Trophy, X } from "lucide-react";
import { pitanjeZaKljuc, type Opcija } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { Button } from "./ui/button";
import { useUtisci } from "./utisci-provider";

/** Koliko kartica stoji posle poslednjeg koraka. Duže od trake — više je teksta. */
const NESTAJE_MS = 8_000;
const MAX_PORUKA = 2000;

const HVALA = "Zabeleženo. Hvala.";
const HVALA_SA_KREDITOM = "Poslato. Hvala — dodao sam ti 1 kredit.";

type Korak = "pitanje" | "drugi" | "treci" | "dopuna" | "hvala" | "greska";

export function UtisakKartica({ kljuc, className }: { kljuc: string; className?: string }) {
  const utisci = useUtisci();
  const pitanje = pitanjeZaKljuc(kljuc);

  const [korak, setKorak] = useState<Korak>("pitanje");
  const [id, setId] = useState<number | null>(null);
  const [izabrano, setIzabrano] = useState<string | null>(null);
  const [tekst, setTekst] = useState("");
  const [hvalaTekst, setHvalaTekst] = useState(HVALA);
  const [ceka, setCeka] = useState(false);
  const [usao, setUsao] = useState(false);

  const tajmer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otkazi = useCallback(() => {
    if (tajmer.current) clearTimeout(tajmer.current);
    tajmer.current = null;
  }, []);

  const jeAktivno = utisci?.aktivno === kljuc;

  useEffect(() => {
    if (!jeAktivno) return;
    const t = requestAnimationFrame(() => setUsao(true));
    return () => cancelAnimationFrame(t);
  }, [jeAktivno]);

  useEffect(() => {
    if (jeAktivno) return;
    setKorak("pitanje");
    setId(null);
    setIzabrano(null);
    setTekst("");
    setHvalaTekst(HVALA);
    setUsao(false);
  }, [jeAktivno]);

  useEffect(() => otkazi, [otkazi]);

  if (!utisci || !pitanje || !jeAktivno) return null;

  function zavrsi(poruka: string) {
    setHvalaTekst(poruka);
    setKorak("hvala");
    tajmer.current = setTimeout(() => utisci?.zatvori(), 3_000);
  }

  function padni() {
    setKorak("greska");
    tajmer.current = setTimeout(() => utisci?.zatvori(), 4_000);
  }

  async function odgovori(vrednost: string) {
    if (ceka || !utisci || !pitanje) return;

    setIzabrano(vrednost);
    setCeka(true);

    try {
      // Ključ prvog odgovora dolazi iz kataloga: `nps-7` piše u `ocena`, sve
      // ostalo u `odgovor`. Kartica ga ne bira i ne zna zašto je takav.
      const odgovor = await utisci.posalji(kljuc, {
        [pitanje.kljucOdgovora ?? "odgovor"]: vrednost,
      });
      setId(odgovor.id);

      if (pitanje.drugiKorak && odgovor.id !== null) {
        setKorak("drugi");
        tajmer.current = setTimeout(() => utisci.zatvori(), NESTAJE_MS);
        return;
      }

      if (odgovor.dopuna && pitanje.dopuna) {
        setKorak("dopuna");
        tajmer.current = setTimeout(() => utisci.zatvori(), NESTAJE_MS);
      } else {
        zavrsi(HVALA);
      }
    } catch {
      padni();
    } finally {
      setCeka(false);
    }
  }

  async function odgovoriDrugi(vrednost: string) {
    const drugi = pitanje?.drugiKorak;
    if (!drugi || id === null || ceka || !utisci) return;

    otkazi();
    setCeka(true);

    try {
      await utisci.dopuniOdgovor(id, { [drugi.kljucOdgovora]: vrednost });

      // Treći korak se otvara SAMO posle odgovora koji ga je i pozvao („Da").
      // Tražiti dozvolu za citat od nekoga ko je rekao „Ne" je pitanje na koje
      // ne postoji dobar odgovor — a šema takav zapis ionako ne bi primila.
      const treci = pitanje?.treciKorak;
      if (treci && vrednost === treci.kadDrugi) {
        setKorak("treci");
        tajmer.current = setTimeout(() => utisci.zatvori(), NESTAJE_MS);
        return;
      }

      if (pitanje?.dopuna) {
        setKorak("dopuna");
        tajmer.current = setTimeout(() => utisci.zatvori(), NESTAJE_MS);
      } else {
        zavrsi(HVALA);
      }
    } catch {
      padni();
    } finally {
      setCeka(false);
    }
  }

  async function odgovoriTreci(vrednost: string) {
    const treci = pitanje?.treciKorak;
    if (!treci || id === null || ceka || !utisci) return;

    otkazi();
    setCeka(true);

    try {
      await utisci.dopuniOdgovor(id, { [treci.kljucOdgovora]: vrednost });

      if (pitanje?.dopuna) {
        setKorak("dopuna");
        tajmer.current = setTimeout(() => utisci.zatvori(), NESTAJE_MS);
      } else {
        zavrsi(HVALA);
      }
    } catch {
      padni();
    } finally {
      setCeka(false);
    }
  }

  async function posaljiDopunu() {
    const poruka = tekst.trim();
    if (!poruka || id === null || ceka || !utisci) return;

    otkazi();
    setCeka(true);

    try {
      const ishod = await utisci.dopuni(id, poruka);
      zavrsi(ishod.nagrada ? HVALA_SA_KREDITOM : HVALA);
    } catch {
      padni();
    } finally {
      setCeka(false);
    }
  }

  const zatvoriKlikom = () => {
    otkazi();
    if (korak === "pitanje") utisci.odbaci(kljuc);
    else utisci.zatvori();
  };

  const Ikona = pitanje.sloj === "kampanja" ? Info : Trophy;

  return (
    <div
      className={cn(
        "rounded-xl border border-border-accent bg-accent-wash p-4 shadow-sm transition-[opacity,transform] duration-340 ease-[cubic-bezier(0.22,1,0.36,1)] sm:p-5",
        usao ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Ikona className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" strokeWidth={2.2} aria-hidden />

        <div className="min-w-0 flex-1">
          {pitanje.uvod && (
            <p className="text-[13px] font-medium text-accent-text">{pitanje.uvod}</p>
          )}

          {korak === "pitanje" || korak === "drugi" || korak === "treci" ? (
            <p className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-fg">
              {korak === "drugi"
                ? pitanje.drugiKorak?.naslov
                : korak === "treci"
                  ? pitanje.treciKorak?.naslov
                  : pitanje.naslov}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={zatvoriKlikom}
          aria-label="Zatvori pitanje"
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {korak === "pitanje" && (
        <RedOpcija
          opcije={pitanje.opcije}
          izabrano={izabrano}
          sufiks={pitanje.sufiks}
          ceka={ceka}
          brojevi
          // Skala 0–10 ne sme da se prelama kako padne: na telefonu ide 6 + 5
          // (dakle 0–5 pa 6–10), a ne „devetka sama u trećem redu".
          skala={pitanje.opcije.length === 11}
          onIzbor={(v) => void odgovori(v)}
        />
      )}

      {korak === "drugi" && pitanje.drugiKorak && (
        <RedOpcija
          opcije={pitanje.drugiKorak.opcije}
          izabrano={null}
          ceka={ceka}
          onIzbor={(v) => void odgovoriDrugi(v)}
        />
      )}

      {korak === "treci" && pitanje.treciKorak && (
        <RedOpcija
          opcije={pitanje.treciKorak.opcije}
          izabrano={null}
          ceka={ceka}
          onIzbor={(v) => void odgovoriTreci(v)}
        />
      )}

      {/* Rečenica koja MORA da stoji ispod pitanja o ceni (F11 §2.3). */}
      {pitanje.napomena && (korak === "pitanje" || korak === "drugi" || korak === "treci") && (
        <p className="mt-3 max-w-[62ch] text-xs leading-relaxed text-fg-muted">
          {pitanje.napomena}
        </p>
      )}

      {korak === "dopuna" && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void posaljiDopunu();
          }}
        >
          <p
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-1.5 text-[13px] text-fg-muted"
          >
            <Check className="h-3.5 w-3.5 text-accent-text" strokeWidth={3} aria-hidden />
            {HVALA}
          </p>

          <input
            autoFocus
            value={tekst}
            maxLength={MAX_PORUKA}
            disabled={ceka}
            onFocus={otkazi}
            onChange={(e) => {
              otkazi();
              setTekst(e.target.value);
            }}
            placeholder={pitanje.dopuna?.placeholder ?? "Dopiši rečenicu…"}
            aria-label={pitanje.dopuna?.placeholder ?? "Dopuna uz odgovor"}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border-strong bg-bg-elev px-3 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-border-accent"
          />

          <Button type="submit" variant="outline" size="sm" disabled={ceka || !tekst.trim()}>
            {ceka && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Pošalji
          </Button>
        </form>
      )}

      {korak === "hvala" && (
        <p
          role="status"
          aria-live="polite"
          className="mt-1 flex items-center gap-1.5 text-[13px] text-fg-muted"
        >
          <Check className="h-3.5 w-3.5 text-accent-text" strokeWidth={3} aria-hidden />
          {hvalaTekst}
        </p>
      )}

      {korak === "greska" && (
        <p role="alert" className="mt-1 text-[13px] text-danger">
          Nije prošlo. Utisak možeš da pošalješ dugmetom u ćošku.
        </p>
      )}
    </div>
  );
}

/**
 * Red opcija. `brojevi` uključuje `.num` — brojevi koji se porede po vrednosti
 * moraju u tabular figure (dizajn sistem §4).
 *
 * ── zašto skala ima svoj raspored ────────────────────────────
 * `flex-wrap` je dobar za tri reči različite dužine, a loš za jedanaest brojeva:
 * prelom pada gde stigne, pa na 390 px ispadne 7 + 4, a sutra 8 + 3 kad se
 * promeni padding. Skala je red koji se ČITA s leva na desno („koliko od 10"),
 * i prelom koji ne pada na sredini je prelom koji laže.
 *
 * Zato `grid`: 6 kolona na telefonu (0–5 gore, 6–10 dole) i svih 11 u jednom
 * redu od `sm` naviše. Ćelije su jednake širine, pa je i meta za prst jednaka
 * za svaku ocenu — a to je jedina stvar koja kod skale sme da bude ista.
 */
function RedOpcija({
  opcije,
  izabrano,
  sufiks,
  ceka,
  brojevi = false,
  skala = false,
  onIzbor,
}: {
  opcije: readonly Opcija[];
  izabrano: string | null;
  sufiks?: string;
  ceka: boolean;
  brojevi?: boolean;
  /** Jedanaest brojeva u nizu (0–10), ne tri reči — v. gore. */
  skala?: boolean;
  onIzbor: (vrednost: string) => void;
}) {
  return (
    <div className={cn("mt-3", !skala && "flex flex-wrap items-center gap-2")}>
      <div
        className={cn(
          skala ? "grid grid-cols-6 gap-1.5 sm:grid-cols-11 sm:gap-1" : "contents",
        )}
      >
        {opcije.map((o) => (
          <button
            key={o.vrednost}
            type="button"
            disabled={ceka}
            onClick={() => onIzbor(o.vrednost)}
            className={cn(
              "inline-flex h-9 items-center rounded-lg border border-border-strong bg-bg-elev text-[13px] font-medium text-fg transition-colors hover:border-fg-muted disabled:pointer-events-none disabled:opacity-45",
              skala ? "justify-center px-0" : "px-3",
              brojevi && "num",
              izabrano === o.vrednost && "border-border-accent bg-accent-wash text-accent-text",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {sufiks && (
        <span className={cn("num text-xs text-fg-muted", skala && "mt-2 block")}>{sufiks}</span>
      )}
    </div>
  );
}
