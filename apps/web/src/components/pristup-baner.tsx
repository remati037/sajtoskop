"use client";

// apps/web/src/components/pristup-baner.tsx
// Trajna traka iznad sadržaja za dva stanja u kojima korisnik mora da zna datum
// (LANSIRANJE §1.5).
//
//   grace    — pristup je istekao, čitanje traje još do tačnog datuma
//   otkazan  — pretplata je otkazana, ali plaćeni period još traje
//
// Ostala četiri stanja nemaju traku: `beta`, `aktivan` i `dopuna` rade normalno,
// a `zakljucan` uopšte ne stiže dovde — kapija ga odvodi na `/zakljucano`.
//
// ── zašto traka, a ne samo modal ─────────────────────────────
// Modal se zatvori i više se ne javlja. Datum do kog čovek sme da izveze svoj
// rad je jedina informacija u proizvodu koju mora da vidi SVAKI put dok traje —
// zato stoji iznad sadržaja, na svakom ekranu, dok stanje ne prođe.
//
// Boje: `--warn` za grace (rok koji ističe i posao koji je stao) i `--info` za
// otkazanu pretplatu koja još traje (obaveštenje, ne upozorenje). Crvena je
// rezervisana za greške i za Ugly Score — istekla pretplata nije kvar.

import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import type { Pristup } from "@sajtoskop/shared";
import { formatDatum } from "@/lib/ui-tekst";

export function PristupBaner({ pristup }: { pristup: Pristup | null }) {
  if (!pristup) return null;
  if (pristup.stanje !== "grace" && pristup.stanje !== "otkazan") return null;

  const grace = pristup.stanje === "grace";
  const Ikona = grace ? AlertTriangle : Info;

  return (
    <div
      role="status"
      className={
        grace
          ? "border-b border-warn/30 bg-warn-wash px-4 py-3 sm:px-6 lg:px-8"
          : "border-b border-info/25 bg-info-wash px-4 py-3 sm:px-6 lg:px-8"
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <Ikona
          className={`mt-0.5 hidden h-4 w-4 shrink-0 sm:block ${grace ? "text-warn-text" : "text-info-text"}`}
          aria-hidden
        />

        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          {grace ? (
            <>
              <p className="font-medium text-warn-text">
                Pristup ti je istekao{" "}
                <span className="num">{formatDatum(pristup.punDo)}</span>.
              </p>
              <p className="mt-1 text-fg-muted">
                Do <span className="num">{formatDatum(pristup.citanjeDo)}</span> možeš da otvaraš
                svoje prospekte, vodiš pipeline i izvezeš oba CSV-a. Pretraga, skeniranje i
                otključavanje ne rade dok ne uzmeš plan ili paket kredita.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-info-text">
                Pretplata je otkazana i traje do{" "}
                <span className="num">{formatDatum(pristup.punDo)}</span>.
              </p>
              <p className="mt-1 text-fg-muted">
                Do tada radi sve kao i do sada. Posle toga imaš još mesec dana da izvezeš svoje
                prospekte i pipeline.
              </p>
            </>
          )}
        </div>

        {/* Link, ne dugme: na svakom je ekranu i uvek je uz primarno dugme te
            strane, a dva primarna dugmeta po ekranu ne postoje (§7.1). */}
        <Link
          href="/cenovnik"
          className="shrink-0 self-start text-xs font-medium text-accent-text underline underline-offset-4 hover:no-underline"
        >
          {grace ? "Vrati pristup" : "Pogledaj planove"}
        </Link>
      </div>
    </div>
  );
}
