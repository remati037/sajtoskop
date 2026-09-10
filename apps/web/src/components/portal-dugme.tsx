"use client";

// apps/web/src/components/portal-dugme.tsx
// „Upravljaj pretplatom" / „Računi i kartica" — Stripe Customer Portal (S21,
// naplata-stripe.md §8). Tekst bira pozivalac: nalog sa pretplatom upravlja
// pretplatom, nalog koji je kupio samo paket ide na račune i karticu, a
// upozorenje o paloj naplati (S26) kaže „Ažuriraj karticu".
//
// Klijentska je zato što link mora da se traži tek na KLIK: Stripe portal
// sesija je jednokratna i vremenski ograničena, pa link napravljen pri
// renderovanju strane bude mrtav do trenutka kad ga neko pritisne. Iz istog
// razloga ovde nema keširanja i nema `prefetch`-a.
//
// Redirekcija ide `window.location.assign`, ne `router.push`: cilj je
// `billing.stripe.com`, a Next-ov ruter zna samo za sopstvene rute.

import { useCallback, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "./ui/button";

type Props = {
  /** Šta piše na dugmetu. Kupac bez pretplate ide na račune, ne na pretplatu. */
  children: React.ReactNode;
  className?: string;
};

export function PortalDugme({ children, className }: Props) {
  const [uToku, setUToku] = useState(false);
  const [greska, setGreska] = useState<string | null>(null);

  const otvori = useCallback(async () => {
    if (uToku) return;
    setUToku(true);
    setGreska(null);

    try {
      const odgovor = await fetch("/api/billing/portal", { method: "POST" });

      if (odgovor.status === 401) {
        // Sesija je istekla između učitavanja strane i klika.
        window.location.assign("/");
        return;
      }

      const telo = (await odgovor.json().catch(() => ({}))) as { url?: string; greska?: string };

      if (!odgovor.ok || !telo.url) throw new Error(telo.greska ?? `HTTP ${odgovor.status}`);

      // Bez `finally` koje gasi čekanje: strana se u ovom trenutku već menja, a
      // dugme koje se vrati u mirno stanje pre nego što redirekcija stigne
      // izgleda kao da klik nije prošao.
      window.location.assign(telo.url);
    } catch (err) {
      console.error("[portal]", err);
      setGreska("Portal se trenutno ne otvara. Pokušaj za koji minut.");
      setUToku(false);
    }
  }, [uToku]);

  return (
    <div className={className}>
      <Button variant="secondary" disabled={uToku} onClick={() => void otvori()}>
        {uToku ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            Otvaram portal
          </>
        ) : (
          <>
            {children}
            <ExternalLink aria-hidden />
          </>
        )}
      </Button>

      {greska && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {greska}
        </p>
      )}
    </div>
  );
}
