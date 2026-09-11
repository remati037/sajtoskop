"use client";

// apps/web/src/components/pristup-baner.tsx
// Trajna traka iznad sadržaja za stanja u kojima korisnik mora da zna datum
// (LANSIRANJE §1.5).
//
//   grace    — pristup je istekao, čitanje traje još do tačnog datuma
//   otkazan  — pretplata (ili proba) je otkazana, ali plaćeni period još traje
//   proba    — SAMO kad su probni krediti potrošeni (S26, §7.4): proba traje,
//              ali se na njoj više ništa ne može uraditi dok ne dođe osmi dan
//              — ili dok čovek ne aktivira plan odmah
//
// Ostala stanja nemaju traku: `komp`, `aktivan` i `dopuna` rade normalno, proba
// sa kreditima isto, a `zakljucan` uopšte ne stiže dovde — kapija ga odvodi na
// `/zakljucano`.
//
// ── zašto traka, a ne samo modal ─────────────────────────────
// Modal se zatvori i više se ne javlja. Datum do kog čovek sme da izveze svoj
// rad je jedina informacija u proizvodu koju mora da vidi SVAKI put dok traje —
// zato stoji iznad sadržaja, na svakom ekranu, dok stanje ne prođe.
//
// Boje: `--warn` za grace (rok koji ističe i posao koji je stao) i `--info` za
// otkazanu pretplatu i potrošenu probu (obaveštenje, ne upozorenje). Crvena je
// rezervisana za greške i za Ugly Score — istekla pretplata nije kvar.

import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import type { Pristup } from "@sajtoskop/shared";
import { formatDatum } from "@/lib/ui-tekst";
import { AktivirajOdmah, type AktivacijaProbe } from "./aktiviraj-odmah";

const OKVIR_INFO = "border-b border-info/25 bg-info-wash px-4 py-3 sm:px-6 lg:px-8";
const OKVIR_WARN = "border-b border-warn/30 bg-warn-wash px-4 py-3 sm:px-6 lg:px-8";

/**
 * Link, ne dugme: traka je na svakom ekranu i uvek je uz primarno dugme te
 * strane, a dva primarna dugmeta po ekranu ne postoje (§7.1).
 */
const LINK = "shrink-0 self-start text-xs font-medium text-accent-text underline underline-offset-4 hover:no-underline";

export function PristupBaner({
  pristup,
  krediti = null,
  aktivacijaProbe = null,
  probaOtkazana = false,
}: {
  pristup: Pristup | null;
  /** Zbir obe kase. `null` = nije pročitano — tada traka probe ne izlazi. */
  krediti?: number | null;
  /** Iznos i plan za „Aktiviraj odmah". `null` = dugmeta nema, ostaje link. */
  aktivacijaProbe?: AktivacijaProbe | null;
  /** Otkazana pretplata je u stvari otkazana PROBA (status `trialing`). */
  probaOtkazana?: boolean;
}) {
  if (!pristup) return null;

  // ── proba bez kredita ─────────────────────────────────────
  if (pristup.stanje === "proba") {
    // Nula, a ne „malo": proba sa 3 kredita je proba koja radi. Traka koja bi
    // se javljala ranije bila bi prodajni pritisak na svakom ekranu.
    if (krediti !== 0) return null;

    return (
      <div role="status" className={OKVIR_INFO}>
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Info className="hidden h-4 w-4 shrink-0 text-info-text sm:block" aria-hidden />
          <p className="min-w-0 flex-1 text-xs leading-relaxed">
            <span className="font-medium text-info-text">Probni krediti su potrošeni.</span>{" "}
            <span className="text-fg-muted">
              Aktiviraj plan odmah ili sačekaj{" "}
              <span className="num">{formatDatum(pristup.probaDo)}</span>.
            </span>
          </p>
          {aktivacijaProbe ? (
            <AktivirajOdmah aktivacija={aktivacijaProbe} size="sm" className="self-start sm:self-auto" />
          ) : (
            <Link href="/krediti" className={LINK}>
              Pogledaj pretplatu
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (pristup.stanje !== "grace" && pristup.stanje !== "otkazan") return null;

  const grace = pristup.stanje === "grace";
  const Ikona = grace ? AlertTriangle : Info;

  return (
    <div role="status" className={grace ? OKVIR_WARN : OKVIR_INFO}>
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <Ikona
          className={`mt-0.5 hidden h-4 w-4 shrink-0 sm:block ${grace ? "text-warn-text" : "text-info-text"}`}
          aria-hidden
        />

        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          {grace ? (
            <>
              <p className="font-medium text-warn-text">
                {/* [S28, O3] `punDo === null` je nov nalog koji je potrošio kredite
                    dobrodošlice: nema datum jer nikad nije ni platio. */}
                {pristup.punDo === null ? (
                  "Besplatni krediti su potrošeni."
                ) : (
                  <>
                    Pristup ti je istekao{" "}
                    <span className="num">{formatDatum(pristup.punDo)}</span>.
                  </>
                )}
              </p>
              <p className="mt-1 text-fg-muted">
                Do <span className="num">{formatDatum(pristup.citanjeDo)}</span> možeš da otvaraš
                svoje prospekte, vodiš pipeline i izvezeš oba CSV-a. Pretraga, skeniranje i
                otključavanje ne rade dok ne uzmeš plan ili paket kredita.
              </p>
            </>
          ) : probaOtkazana ? (
            <>
              <p className="font-medium text-info-text">
                Proba je otkazana i traje do{" "}
                <span className="num">{formatDatum(pristup.punDo)}</span>.
              </p>
              <p className="mt-1 text-fg-muted">
                Kartica se neće naplatiti. Do tada radi sve; posle toga imaš još mesec dana da
                izvezeš svoje prospekte i pipeline.
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

        <Link href="/cenovnik" className={LINK}>
          {grace ? "Vrati pristup" : "Pogledaj planove"}
        </Link>
      </div>
    </div>
  );
}
