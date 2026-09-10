"use client";

// apps/web/src/components/aktiviraj-odmah.tsx
// „Aktiviraj odmah" — dugme i modal potvrde (naplata-stripe.md §7.4, S26).
//
// Stoji na dva mesta: u bloku pretplate na `/krediti` i u traci iznad sadržaja
// kad su probni krediti potrošeni. Na oba je SEKUNDARNO dugme — §7.1 daje jedno
// primarno po ekranu, a ono pripada strani ispod (i ionako nije dobro da
// dugme koje naplaćuje karticu vuče oko jače od svega ostalog).
//
// ── zašto modal ─────────────────────────────────────────────
// Klik naplaćuje pravu karticu, odmah. Iznos i posledica („plan počinje danas",
// krediti se postavljaju, ne sabiraju) moraju da stoje pred čovekom PRE nego
// što novac krene — ne u mejlu posle.
//
// ── posle uspeha ────────────────────────────────────────────
// Ruta vrati `200` čim Stripe prihvati naplatu; krediti i status stižu tek
// webhookom, sekund-dva kasnije. Zato modal kaže „stižu za koji sekund" i
// strana se osvežava dvaput — odmah i posle kratke pauze — umesto da prvo
// osvežavanje pokaže staru probu i ostavi utisak da klik nije prošao.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Loader2, Zap } from "lucide-react";
import { formatEur } from "@sajtoskop/shared";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

/** Šta modal mora da zna da bi rekao koliko i šta. Sve iz `plans.ts`, ne iz Stripe-a. */
export type AktivacijaProbe = {
  /** Iznos koji se naplaćuje sada. */
  eur: number;
  /** „Starter", „Pro", „Advanced". */
  imePlana: string;
  /** Mesečna dodela plana — na nju se balans POSTAVLJA (A1). */
  krediti: number;
};

type Faza = "mir" | "ceka" | "gotovo";

/** Koliko posle uspeha strana čeka pre drugog osvežavanja. Webhook obično stigne za 1–2 s. */
const DRUGO_OSVEZAVANJE_MS = 3000;

export function AktivirajOdmah({
  aktivacija,
  size = "md",
  className,
}: {
  aktivacija: AktivacijaProbe;
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const [otvoren, setOtvoren] = useState(false);
  const [faza, setFaza] = useState<Faza>("mir");
  const [greska, setGreska] = useState<string | null>(null);
  const tajmer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (tajmer.current) clearTimeout(tajmer.current);
  }, []);

  const iznos = formatEur(aktivacija.eur);

  const potvrdi = useCallback(async () => {
    if (faza !== "mir") return;
    setFaza("ceka");
    setGreska(null);

    try {
      const odgovor = await fetch("/api/billing/aktiviraj", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Prazno, i to je pravilo, ne lenjost: ruta pretplatu nalazi po sesiji.
        body: "{}",
      });

      if (odgovor.status === 401) {
        window.location.assign("/");
        return;
      }

      const telo = (await odgovor.json().catch(() => ({}))) as { ok?: boolean; greska?: string };
      if (!odgovor.ok || !telo.ok) {
        // 402 (kartica) i 409 (nije u probi / otkazana) nose rečenicu sa
        // servera koja kaže šta dalje — ona ide na ekran.
        setGreska(telo.greska ?? "Aktivacija trenutno ne radi. Pokušaj ponovo za koji minut.");
        setFaza("mir");
        return;
      }

      setFaza("gotovo");
      router.refresh();
      tajmer.current = setTimeout(() => router.refresh(), DRUGO_OSVEZAVANJE_MS);
    } catch (err) {
      console.error("[aktiviraj]", err);
      setGreska(`Veza je pukla pre odgovora. Proveri stanje na strani „Krediti" pre nego što pokušaš ponovo.`);
      setFaza("mir");
    }
  }, [faza, router]);

  const zatvori = useCallback(() => {
    // Dok naplata traje, modal se ne zatvara: zatvoren modal nad zahtevom koji
    // još ide izgleda kao odustajanje, a kartica se svejedno naplati.
    if (faza === "ceka") return;
    setOtvoren(false);
    setGreska(null);
    if (faza === "gotovo") setFaza("mir");
  }, [faza]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        className={className}
        onClick={() => setOtvoren(true)}
      >
        <Zap aria-hidden />
        Aktiviraj odmah
      </Button>

      <Dialog open={otvoren} onOpenChange={(o) => !o && zatvori()}>
        <DialogContent className="max-w-md" showClose={faza !== "ceka"}>
          <DialogHeader>
            <DialogTitle>Aktiviraj {aktivacija.imePlana} odmah</DialogTitle>
            <DialogDescription>Proba se završava danas.</DialogDescription>
          </DialogHeader>

          {faza === "gotovo" ? (
            <div className="flex items-start gap-3 px-5 py-4 text-sm">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
              <p className="text-fg-muted">
                <span className="font-medium text-fg">Naplata je prošla.</span> Plan i{" "}
                <span className="num">{aktivacija.krediti}</span> kredita stižu za koji sekund —
                strana se sama osvežava. Račun stiže mejlom.
              </p>
            </div>
          ) : (
            <div className="space-y-3 px-5 py-4 text-sm">
              <p className="font-medium">
                Naplaćuje se <span className="num">{iznos}</span> sada, plan počinje danas.
              </p>
              <p className="text-fg-muted">
                Umesto preostalih probnih kredita dobijaš{" "}
                <span className="num">{aktivacija.krediti}</span> kredita plana — ne sabiraju se.
                Obračunski period kreće od danas, pa se i sledeća naplata računa od danas.
              </p>
              {greska && (
                <p role="alert" className="text-xs text-danger">
                  {greska}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            {faza === "gotovo" ? (
              <Button type="button" variant="secondary" onClick={zatvori}>
                Zatvori
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={zatvori} disabled={faza === "ceka"}>
                  Odustani
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void potvrdi()}
                  disabled={faza === "ceka"}
                >
                  {faza === "ceka" ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden />
                      Naplaćujem
                    </>
                  ) : (
                    <>Plati {iznos}</>
                  )}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
