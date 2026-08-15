"use client";

// apps/web/src/components/utisak-kartica.tsx
// Kampanjska kartica (F11 §6.3) — oblik „kartica" iz kataloga.
//
// ── zašto je ovo jedina kartica sa akcentom ──────────────────
// Zelena ivica i zelena podloga su u ovom proizvodu rezervisane za jednu stvar:
// „ovde ima para" (dizajn sistem §3.3). Kartica koja to pozajmi mora da vredi
// koliko i lead bez sajta — a to su tačno dva trenutka u životu naloga: pitanje o
// ceni, od kog zavisi hoće li proizvod ikad biti naplaćen, i prvi potpisan posao.
// Oba se dešavaju jednom. Treće takve kartice ne sme da bude.
//
// ── prvi klik je već poslat utisak ───────────────────────────
// Isto pravilo kao kod mikro-trake (F10 odluka 2): klik na opseg upisuje red.
// Drugi korak („bi li ga preporučio kolegi") i rečenica dopune idu kroz
// `PATCH`, pa se odgovor na serveru spaja sa prvim i PONOVO proverava šemom iz
// kataloga — drugi korak nije rupa u kapiji (pravilo 16).
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

type Korak = "pitanje" | "drugi" | "dopuna" | "hvala" | "greska";

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
      const odgovor = await utisci.posalji(kljuc, { odgovor: vrednost });
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

          {korak === "pitanje" || korak === "drugi" ? (
            <p className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-fg">
              {korak === "drugi" ? pitanje.drugiKorak?.naslov : pitanje.naslov}
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

      {/* Rečenica koja MORA da stoji ispod pitanja o ceni (F11 §2.3). */}
      {pitanje.napomena && (korak === "pitanje" || korak === "drugi") && (
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
 * Red opcija. `brojevi` uključuje `.num` — iznosi u dinarima se porede po
 * vrednosti, pa moraju u tabular figure (dizajn sistem §4).
 */
function RedOpcija({
  opcije,
  izabrano,
  sufiks,
  ceka,
  brojevi = false,
  onIzbor,
}: {
  opcije: readonly Opcija[];
  izabrano: string | null;
  sufiks?: string;
  ceka: boolean;
  brojevi?: boolean;
  onIzbor: (vrednost: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {opcije.map((o) => (
        <button
          key={o.vrednost}
          type="button"
          disabled={ceka}
          onClick={() => onIzbor(o.vrednost)}
          className={cn(
            "inline-flex h-9 items-center rounded-lg border border-border-strong bg-bg-elev px-3 text-[13px] font-medium text-fg transition-colors hover:border-fg-muted disabled:pointer-events-none disabled:opacity-45",
            brojevi && "num",
            izabrano === o.vrednost && "border-border-accent bg-accent-wash text-accent-text",
          )}
        >
          {o.label}
        </button>
      ))}

      {sufiks && <span className="text-xs num text-fg-muted">{sufiks}</span>}
    </div>
  );
}
