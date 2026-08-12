"use client";

// apps/web/src/components/utisak-dugme.tsx
// Plutajuće dugme „Utisak" i modal iza njega (F10 §4).
//
// ── zašto plutajuće dugme, a ne stavka u meniju ───────────────
// Utisak se javlja u trenutku frustracije, a tada korisnik ne traži meni. Dugme
// stoji na svakom ekranu unutar `(app)` okvira i otvara se u jednom kliku.
//
// ── prvi klik je već poslat utisak ───────────────────────────
// Klik na ocenu odmah upisuje red u bazu. Tekst i tip su dopuna, ne uslov —
// forma koja traži tri polja pre slanja u beti ne skuplja ništa. Zato korak 2
// sme da se zatvori bilo kako: `✕`, `Esc`, klik van modala i „Ne treba" rade
// istu stvar i ništa se ne gubi.
//
// Ocene su ikonice iz `lucide-react`, ne emodži (dizajn sistem §7.7). Emodži
// postoji samo u subjectu mejla, koji nije pod dizajn sistemom.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Frown, Loader2, Meh, MessageSquare, Smile } from "lucide-react";
import type { FeedbackKind, FeedbackSource } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import type { UtisakOdgovor } from "@/lib/feedback-schema";
import { naslovZaPutanju } from "@/lib/navigacija";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

type Korak = "ocena" | "dopuna" | "hvala" | "greska";
type Ocena = 1 | 2 | 3;

const OCENE: { vrednost: Ocena; label: string; Ikona: typeof Frown }[] = [
  { vrednost: 1, label: "Loše", Ikona: Frown },
  { vrednost: 2, label: "Ok", Ikona: Meh },
  { vrednost: 3, label: "Odlično", Ikona: Smile },
];

// „Drugo" postoji u šemi, ali ne i u formi: tri ponuđena tipa pokrivaju sve što
// mi u beti menja redosled posla, a četvrti bi bio kutija u koju sve pada.
const TIPOVI: { vrednost: FeedbackKind; label: string }[] = [
  { vrednost: "bug", label: "Bug" },
  { vrednost: "ideja", label: "Ideja" },
  { vrednost: "pohvala", label: "Pohvala" },
];

const MAX_PORUKA = 2000;
/** Brojač se pojavljuje tek kad počne da znači nešto. */
const BROJAC_OD = 200;
/** Ne odmah: prekidati korisnika dok ekran tek sedne znači zatvoren prozor. */
const PODSETNIK_KASNJENJE_MS = 4_000;
const ZATVARANJE_MS = 1_200;

export function UtisakDugme({ traziUtisak }: { traziUtisak: boolean }) {
  const putanja = usePathname();

  const [otvoren, setOtvoren] = useState(false);
  const [izvor, setIzvor] = useState<FeedbackSource>("dugme");
  const [korak, setKorak] = useState<Korak>("ocena");
  const [greskaNa, setGreskaNa] = useState<"ocena" | "dopuna">("ocena");
  const [id, setId] = useState<number | null>(null);
  /** Kratko „Hvala" vs. potvrda posle stvarno poslate dopune. */
  const [hvalaKopi, setHvalaKopi] = useState<"kratko" | "poslato">("kratko");
  const [ocena, setOcena] = useState<Ocena | null>(null);
  const [tip, setTip] = useState<FeedbackKind | null>(null);
  const [tekst, setTekst] = useState("");
  const [ceka, setCeka] = useState(false);

  /** Ručno otvaranje pobeđuje: posle njega podsetnik ne iskače (F10 §6). */
  const rucno = useRef(false);
  const tajmer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (tajmer.current) clearTimeout(tajmer.current); }, []);

  const resetuj = useCallback(() => {
    setKorak("ocena");
    setId(null);
    setHvalaKopi("kratko");
    setOcena(null);
    setTip(null);
    setTekst("");
    setCeka(false);
  }, []);

  // ── podsetnik posle tri dana ────────────────────────────────
  // `traziUtisak` je izračunat serverski, iz profila koji `(app)/layout.tsx`
  // ionako čita. `podsetnik-vidjen` se šalje čim se prozor pojavi, ne kad se
  // odgovori — korisnik koji ga zatvori ne sme da ga vidi ponovo.
  useEffect(() => {
    if (!traziUtisak) return;

    const t = setTimeout(() => {
      if (rucno.current) return;
      setIzvor("podsetnik");
      setOtvoren(true);
      void fetch("/api/feedback/podsetnik-vidjen", { method: "POST" }).catch(() => {
        // Neuspeh znači samo da će podsetnik doći još jednom. Nema šta da se javi.
      });
    }, PODSETNIK_KASNJENJE_MS);

    return () => clearTimeout(t);
  }, [traziUtisak]);

  function otvoriRucno() {
    rucno.current = true;
    resetuj();
    setIzvor("dugme");
    setOtvoren(true);
  }

  function promeniOtvoren(sledeci: boolean) {
    setOtvoren(sledeci);
    if (sledeci) return;

    // Reset ide tek posle animacije zatvaranja, da se sadržaj ne promeni pred
    // očima dok modal još klizi.
    if (tajmer.current) clearTimeout(tajmer.current);
    tajmer.current = setTimeout(resetuj, 220);
  }

  function zatvoriPosleTrenutka() {
    if (tajmer.current) clearTimeout(tajmer.current);
    tajmer.current = setTimeout(() => promeniOtvoren(false), ZATVARANJE_MS);
  }

  // ── korak 1: ocena ──────────────────────────────────────────
  // Klik = POST, bez potvrde. Modal odmah prelazi na korak 2, optimistično: ako
  // POST padne, korak 2 se pretvara u poruku greške.

  async function posaljiOcenu(vrednost: Ocena) {
    if (ceka) return; // dupli klik se ignoriše dok prvi zahtev traje

    setOcena(vrednost);
    setCeka(true);
    setKorak("dopuna");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: vrednost,
          source: izvor,
          route: putanja,
          // Jedini podatak o uređaju koji server ne zna sam.
          viewport: `${window.innerWidth}×${window.innerHeight}`,
        }),
      });

      if (!res.ok) throw new Error(String(res.status));

      const telo = (await res.json()) as UtisakOdgovor;
      setId(telo.id);

      // Server odlučuje da li se traži i tekst. `dopuna: false` je ili tvrd
      // plafon (nema zapisa) ili utisak preko dnevnog limita za mejl — u oba
      // slučaja ide samo „Hvala", bez ijedne reči o limitu (odluka 6).
      if (!telo.dopuna) {
        setHvalaKopi("kratko");
        setKorak("hvala");
        zatvoriPosleTrenutka();
      }
    } catch {
      setGreskaNa("ocena");
      setKorak("greska");
    } finally {
      setCeka(false);
    }
  }

  // ── korak 2: dopuna ─────────────────────────────────────────

  async function posaljiDopunu() {
    const poruka = tekst.trim();
    if (id === null) return;

    // Prazna dopuna se ne šalje uopšte — nema šta da se piše.
    if (!poruka && !tip) {
      promeniOtvoren(false);
      return;
    }

    setCeka(true);

    try {
      const res = await fetch(`/api/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(tip ? { kind: tip } : {}),
          ...(poruka ? { message: poruka } : {}),
        }),
      });

      if (!res.ok) throw new Error(String(res.status));

      setHvalaKopi("poslato");
      setKorak("hvala");
      zatvoriPosleTrenutka();
    } catch {
      setGreskaNa("dopuna");
      setKorak("greska");
    } finally {
      setCeka(false);
    }
  }

  function ponovi() {
    if (greskaNa === "dopuna") {
      setKorak("dopuna");
      void posaljiDopunu();
      return;
    }

    setKorak("ocena");
    if (ocena) void posaljiOcenu(ocena);
  }

  const ekran = naslovZaPutanju(putanja);
  const preostalo = MAX_PORUKA - tekst.length;

  const naslov =
    korak === "dopuna"
      ? "Zabeleženo, hvala."
      : korak === "hvala"
        ? hvalaKopi === "kratko"
          ? "Hvala. Zabeleženo."
          : "Poslato."
        : korak === "greska"
          ? "Nije uspelo."
          : izvor === "podsetnik"
            ? "Tri dana si u Sajtoskopu"
            : "Kako ti ide?";

  const podnaslov =
    korak === "ocena" && izvor === "podsetnik" ? "Kako ti ide? Jedan klik je dovoljan." : ekran;

  return (
    <>
      {/* `z-30` je ispod mobilne fioke (`z-50`) i ispod modala — dugme ne sme da
          stoji preko otvorenog menija. Na telefonu je meta 44×44, bez teksta. */}
      <button
        type="button"
        onClick={otvoriRucno}
        title="Pošalji utisak — stiže direktno meni"
        className="fixed bottom-4 right-4 z-30 inline-flex h-11 w-11 items-center justify-center gap-2 rounded-full border border-border-strong bg-bg-elev text-sm font-medium text-fg shadow-sm transition-colors hover:border-fg-muted sm:bottom-5 sm:right-5 sm:h-10 sm:w-auto sm:px-4"
      >
        <MessageSquare className="h-4 w-4 text-accent-text" strokeWidth={2.2} />
        <span className="sr-only sm:not-sr-only">Utisak</span>
      </button>

      <Dialog open={otvoren} onOpenChange={promeniOtvoren}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{naslov}</DialogTitle>
            <DialogDescription>{podnaslov}</DialogDescription>
          </DialogHeader>

          {korak === "ocena" && (
            <div className="space-y-3 px-5 py-5">
              <div className="grid grid-cols-3 gap-2">
                {OCENE.map(({ vrednost, label, Ikona }) => (
                  <button
                    key={vrednost}
                    type="button"
                    disabled={ceka}
                    onClick={() => void posaljiOcenu(vrednost)}
                    // Boja označava IZBOR, ne vrednost: crvena za „loše" bi bila
                    // dekoracija, a crvena je rezervisana za Ugly Score i greške.
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border border-border-strong bg-bg-elev px-2 py-4 text-xs font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg disabled:pointer-events-none disabled:opacity-45",
                      ocena === vrednost && "border-border-accent bg-accent-wash text-accent-text",
                    )}
                  >
                    <Ikona className="h-7 w-7" strokeWidth={1.8} />
                    {label}
                  </button>
                ))}
              </div>

              <p className="text-xs text-fg-muted">Utisak stiže direktno meni.</p>
            </div>
          )}

          {korak === "dopuna" && (
            <>
              <div className="space-y-3 px-5 py-4">
                <p className="text-sm text-fg-muted">Hoćeš da dodaš rečenicu?</p>

                <textarea
                  rows={3}
                  autoFocus
                  value={tekst}
                  maxLength={MAX_PORUKA}
                  onChange={(e) => setTekst(e.target.value)}
                  placeholder="Šta te muči, šta fali, šta bi izbacio…"
                  className="w-full resize-none rounded-xl border border-border-strong bg-bg-elev px-3 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-border-accent"
                />

                {preostalo <= BROJAC_OD && (
                  <p className="num -mt-1 text-right text-[11px] text-fg-muted">{preostalo}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {TIPOVI.map(({ vrednost, label }) => (
                    <button
                      key={vrednost}
                      type="button"
                      aria-pressed={tip === vrednost}
                      onClick={() => setTip((p) => (p === vrednost ? null : vrednost))}
                      className={cn(
                        "inline-flex h-8 items-center rounded-lg border border-border-strong bg-bg-elev px-3 text-xs font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg",
                        tip === vrednost && "border-border-accent bg-accent-wash text-accent-text",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                {/* „Ne treba" ne šalje ništa i ništa se ne gubi: ocena je
                    upisana, a mejl je otišao u koraku 1. */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => promeniOtvoren(false)}
                  disabled={ceka}
                >
                  Ne treba
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void posaljiDopunu()}
                  disabled={ceka || id === null || (!tekst.trim() && !tip)}
                >
                  {ceka && <Loader2 className="h-4 w-4 animate-spin" />}
                  Pošalji
                </Button>
              </div>
            </>
          )}

          {korak === "hvala" && (
            <div className="px-5 py-5">
              <p role="status" className="text-sm text-fg-muted">
                {hvalaKopi === "kratko"
                  ? "Utisak je stigao. Hvala."
                  : "Poslato. Javljam se ako bude potrebe."}
              </p>
            </div>
          )}

          {korak === "greska" && (
            <>
              <div className="px-5 py-5">
                <p role="alert" className="text-sm text-danger">
                  Nije uspelo. Pokušaj ponovo za koji trenutak.
                </p>
              </div>

              <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => promeniOtvoren(false)}
                  disabled={ceka}
                >
                  Odustani
                </Button>
                <Button type="button" variant="primary" onClick={ponovi} disabled={ceka}>
                  {ceka && <Loader2 className="h-4 w-4 animate-spin" />}
                  Pokušaj ponovo
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
