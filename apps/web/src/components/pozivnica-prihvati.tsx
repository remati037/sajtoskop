"use client";

// apps/web/src/components/pozivnica-prihvati.tsx
// Dugme „Prihvati" na `/pozivnica/[code]` (S27, naplata-stripe.md §9.4).
//
// Kod ide u telo, identitet NE — ruta ga uzima iz sesije (pravilo 8). Posle
// uspeha ruta kaže kuda: komp na kontrolnu tablu, prvi mesec na cenovnik.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { ArrowRight, Loader2 } from "lucide-react";
import type { PrihvatiOdgovor } from "@/lib/pozivnice-schema";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

export function PozivnicaPrihvati({ code, email }: { code: string; email: string | null }) {
  const router = useRouter();
  const [radi, setRadi] = useState(false);
  const [greska, setGreska] = useState<string | null>(null);
  const [uspeh, setUspeh] = useState<string | null>(null);

  async function prihvati() {
    setRadi(true);
    setGreska(null);

    try {
      const res = await fetch("/api/pozivnice/prihvati", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      let telo: PrihvatiOdgovor | { greska?: string } | null = null;
      try {
        telo = (await res.json()) as PrihvatiOdgovor | { greska?: string };
      } catch {
        telo = null;
      }

      if (res.ok && telo && "ok" in telo) {
        setUspeh(telo.poruka);
        router.push(telo.dalje);
        // `radi` ostaje uključen: drugi klik dok redirekcija traje bi dao
        // „već iskoristio" preko poruke o uspehu.
        return;
      }

      setGreska(
        (telo && "greska" in telo && telo.greska) ||
          (res.status === 401
            ? "Sesija je istekla. Osveži stranu i prijavi se ponovo."
            : "Pozivnica nije prihvaćena. Pokušaj ponovo."),
      );
    } catch (err) {
      console.error("[pozivnica-prihvati]", err);
      setGreska("Veza sa serverom nije uspela. Pokušaj ponovo.");
    }

    setRadi(false);
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={radi}
        onClick={() => void prihvati()}
      >
        {radi ? (
          <Loader2 className="animate-spin" />
        ) : (
          <>
            Prihvati
            <ArrowRight strokeWidth={2.2} />
          </>
        )}
      </Button>

      {uspeh && (
        <Alert variant="success" className="w-full">
          {uspeh}
        </Alert>
      )}
      {greska && (
        <Alert variant="danger" className="w-full">
          {greska}
        </Alert>
      )}

      <p className="text-center text-xs text-fg-muted">
        {email ? (
          <>
            Prijavljen nalog: <span className="num text-fg">{email}</span>.{" "}
          </>
        ) : null}
        Nije pravi nalog?{" "}
        <SignOutButton redirectUrl={`/pozivnica/${code}`}>
          <button
            type="button"
            className="font-medium text-accent-text underline underline-offset-4"
          >
            Odjavi se
          </button>
        </SignOutButton>
      </p>
    </div>
  );
}
