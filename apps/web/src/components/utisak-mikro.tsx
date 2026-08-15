"use client";

// apps/web/src/components/utisak-mikro.tsx
// Mikro-traka: kontekstualno pitanje u toku sadržaja (F11 §6.1).
//
// ── zašto traka, a ne modal ──────────────────────────────────
// Nijedno pitanje ne blokira ekran (odluka 3). Traka stoji u toku sadržaja, ima
// 44 px, nema senku — nije kartica nego red između dva bloka. Jedini modal u
// životu naloga ostaje podsetnik na dan 3, koji je F10 već isporučio.
//
// ── prvi klik je već poslat utisak ───────────────────────────
// Klik na odgovor odmah upisuje red (F10 odluka 2, F11 odluka 5). Sve posle toga
// — čipovi „šta nije štimalo", rečenica dopune — je dodatak koji sme da izostane:
// traka se posle 6 s sama sklanja i ništa se ne gubi.
//
// Boje idu isključivo kroz tokene iz `globals.css` (nijedan hex u JSX-u), a
// jedina animacija je `opacity + y`, sa brend krivom iz dizajn sistema §8.
// `prefers-reduced-motion` gasi trajanje globalno, pa se sadržaj vidi odmah.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { pitanjeZaKljuc } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { Button } from "./ui/button";
import { useUtisci } from "./utisci-provider";

/** Koliko traka stoji posle odgovora ako se ne dopuni (§6.1). */
const NESTAJE_MS = 6_000;
const MAX_PORUKA = 2000;

/** Potvrda bez nagrade i potvrda sa njom (F11 §6.7). */
const HVALA = "Zabeleženo. Hvala.";
const HVALA_SA_KREDITOM = "Poslato. Hvala — dodao sam ti 1 kredit.";

type Korak = "pitanje" | "cipovi" | "dopuna" | "hvala" | "greska";

export function UtisakMikro({ kljuc, className }: { kljuc: string; className?: string }) {
  const utisci = useUtisci();
  const pitanje = pitanjeZaKljuc(kljuc);

  const [korak, setKorak] = useState<Korak>("pitanje");
  const [id, setId] = useState<number | null>(null);
  const [tekst, setTekst] = useState("");
  const [izabraniCipovi, setIzabraniCipovi] = useState<string[]>([]);
  const [hvalaTekst, setHvalaTekst] = useState(HVALA);
  const [ceka, setCeka] = useState(false);
  /** Ulazak: `opacity + y(8px)`, 0,34 s. Visina je rezervisana pre toga. */
  const [usao, setUsao] = useState(false);

  const tajmer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otkazi = useCallback(() => {
    if (tajmer.current) clearTimeout(tajmer.current);
    tajmer.current = null;
  }, []);

  const jeAktivno = utisci?.aktivno === kljuc;

  useEffect(() => {
    if (!jeAktivno) return;

    // Sledeći kadar, da prelaz uopšte ima odakle da krene.
    const t = requestAnimationFrame(() => setUsao(true));
    return () => cancelAnimationFrame(t);
  }, [jeAktivno]);

  // Traka se u životu jednog ekrana pojavljuje jednom, ali stanje se resetuje da
  // bi drugi prikaz (npr. `posao-pao` sutradan) krenuo od pitanja.
  useEffect(() => {
    if (jeAktivno) return;
    setKorak("pitanje");
    setId(null);
    setTekst("");
    setIzabraniCipovi([]);
    setHvalaTekst(HVALA);
    setUsao(false);
  }, [jeAktivno]);

  useEffect(() => otkazi, [otkazi]);

  if (!utisci || !pitanje || !jeAktivno) return null;

  /** Kraj puta: potvrda, pa traka odlazi. */
  function zavrsi(poruka: string) {
    setHvalaTekst(poruka);
    setKorak("hvala");
    tajmer.current = setTimeout(() => utisci?.zatvori(), 2_400);
  }

  function padni() {
    setKorak("greska");
    tajmer.current = setTimeout(() => utisci?.zatvori(), 4_000);
  }

  async function posalji(answers: Record<string, unknown>) {
    if (ceka || !utisci || !pitanje) return;
    setCeka(true);

    try {
      const odgovor = await utisci.posalji(kljuc, answers);
      setId(odgovor.id);

      // Čipovi se otvaraju samo za odgovore koji su ih i pozvali („Ponešto",
      // „Netačno"). Uz „Sve tačno" nema šta da se pokaže prstom.
      const cipovi = pitanje.cipovi;
      const traziCipove =
        cipovi !== undefined &&
        typeof answers.odgovor === "string" &&
        cipovi.kadOdgovor.includes(answers.odgovor) &&
        odgovor.id !== null;

      if (traziCipove) {
        setKorak("cipovi");
        tajmer.current = setTimeout(() => utisci.zatvori(), NESTAJE_MS);
        return;
      }

      // Server odlučuje da li se traži i tekst. Bez dopune traka odmah zahvali i
      // sklanja se — korisnik ne saznaje ni za jedan limit (F10 odluka 6).
      if (odgovor.dopuna && pitanje.dopuna && !pitanje.tekstPrvi) {
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

  /** Drugi korak: čipovi idu kroz `PATCH` sa `answers`, pa se spajaju sa prvim. */
  async function posaljiCipove() {
    const cipovi = pitanje?.cipovi;
    if (!cipovi || id === null || ceka || !utisci) return;

    otkazi();
    setCeka(true);

    try {
      await utisci.dopuniOdgovor(id, { [cipovi.kljucOdgovora]: izabraniCipovi });

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
    // Odbacivanje se broji samo dok je pitanje još pitanje. Zatvaranje posle
    // odgovora je „hvala, dosta" — ne kažnjava se (§3.1).
    if (korak === "pitanje") utisci.odbaci(kljuc);
    else utisci.zatvori();
  };

  return (
    // Visina je rezervisana pre nego što se sadržaj pojavi: tabela ispod ne sme
    // da poskoči kad traka „uđe" (§6.1). Zato `min-h-11` stoji na omotaču, a
    // animira se samo sadržaj.
    <div className={cn("min-h-11", className)}>
      <div
        className={cn(
          "relative flex min-h-11 flex-col gap-2 rounded-xl border border-border bg-bg-subtle px-3 py-2 pr-11 transition-[opacity,transform] duration-340 ease-[cubic-bezier(0.22,1,0.36,1)] sm:flex-row sm:items-center sm:gap-3 sm:py-0 sm:pr-2",
          usao ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {korak === "pitanje" && (
          <>
            <p className="min-w-0 flex-1 text-[13px] font-medium text-fg">{pitanje.naslov}</p>

            {pitanje.tekstPrvi ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md"
                onSubmit={(e) => {
                  e.preventDefault();
                  const upisano = tekst.trim();
                  if (upisano.length >= 2) void posalji({ tekst: upisano });
                }}
              >
                <input
                  value={tekst}
                  maxLength={200}
                  disabled={ceka}
                  onChange={(e) => setTekst(e.target.value)}
                  placeholder={pitanje.dopuna?.placeholder ?? ""}
                  aria-label={pitanje.naslov}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-bg-elev px-2.5 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-border-accent"
                />
                <Button type="submit" variant="outline" size="sm" disabled={ceka || tekst.trim().length < 2}>
                  {ceka && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Pošalji
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {pitanje.opcije.map((o) => (
                  <Button
                    key={o.vrednost}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={ceka}
                    onClick={() => void posalji({ odgovor: o.vrednost })}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}

        {korak === "cipovi" && pitanje.cipovi && (
          <>
            <p
              role="status"
              aria-live="polite"
              className="flex min-w-0 shrink-0 items-center gap-1.5 text-[13px] text-fg-muted"
            >
              <Check className="h-3.5 w-3.5 text-accent-text" strokeWidth={3} aria-hidden />
              {pitanje.cipovi.naslov}
            </p>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {pitanje.cipovi.opcije.map((o) => {
                const ukljucen = izabraniCipovi.includes(o.vrednost);

                return (
                  <button
                    key={o.vrednost}
                    type="button"
                    aria-pressed={ukljucen}
                    disabled={ceka}
                    onClick={() => {
                      otkazi();
                      setIzabraniCipovi((prev) =>
                        prev.includes(o.vrednost)
                          ? prev.filter((v) => v !== o.vrednost)
                          : [...prev, o.vrednost],
                      );
                    }}
                    className={cn(
                      "inline-flex h-8 items-center rounded-lg border border-border-strong bg-bg-elev px-2.5 text-xs font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg disabled:opacity-45",
                      ukljucen && "border-border-accent bg-accent-wash text-accent-text",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={ceka || izabraniCipovi.length === 0}
                onClick={() => void posaljiCipove()}
              >
                {ceka && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Pošalji
              </Button>
            </div>
          </>
        )}

        {korak === "dopuna" && (
          <>
            <p
              role="status"
              aria-live="polite"
              className="flex min-w-0 shrink-0 items-center gap-1.5 text-[13px] text-fg-muted"
            >
              <Check className="h-3.5 w-3.5 text-accent-text" strokeWidth={3} aria-hidden />
              Hvala. Hoćeš da dodaš rečenicu?
            </p>

            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void posaljiDopunu();
              }}
            >
              <input
                autoFocus
                value={tekst}
                maxLength={MAX_PORUKA}
                disabled={ceka}
                // Traka nestaje posle 6 s — ali ne dok neko kuca u nju.
                onFocus={otkazi}
                onChange={(e) => {
                  otkazi();
                  setTekst(e.target.value);
                }}
                placeholder={pitanje.dopuna?.placeholder ?? "Dopiši rečenicu…"}
                aria-label="Dopuna uz odgovor"
                className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-bg-elev px-2.5 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-border-accent"
              />
              <Button type="submit" variant="outline" size="sm" disabled={ceka || !tekst.trim()}>
                {ceka && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Pošalji
              </Button>
            </form>
          </>
        )}

        {korak === "hvala" && (
          <p
            role="status"
            aria-live="polite"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-fg-muted"
          >
            <Check className="h-3.5 w-3.5 text-accent-text" strokeWidth={3} aria-hidden />
            {hvalaTekst}
          </p>
        )}

        {korak === "greska" && (
          <p role="alert" className="min-w-0 flex-1 text-[13px] text-danger">
            Nije prošlo. Utisak možeš da pošalješ dugmetom u ćošku.
          </p>
        )}

        {/* Meta 32×32 i na telefonu; ikonica je `--fg-faint` dok miruje. */}
        <button
          type="button"
          onClick={zatvoriKlikom}
          aria-label="Zatvori pitanje"
          className="absolute right-2 top-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg sm:static sm:-mr-1"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
