"use client";

// apps/web/src/components/pristup-baner.tsx
// Trajna traka iznad sadržaja za stanja u kojima korisnik mora da zna datum
// (LANSIRANJE §1.5, tok-i-onboarding §1.12, §2.2, §2.3).
//
//   dopuna   — [S30, §1.12] SAMO bez ijednog kupljenog paketa: nalog koji je
//              dobio kredite dobrodošlice i nema plan
//   grace    — pristup je istekao, čitanje traje još do tačnog datuma; tekst po
//              UZROKU (§2.3): pala naplata, potrošeni besplatni krediti, istek
//   otkazan  — pretplata (ili proba) je otkazana, ali plaćeni period još traje
//   proba    — SAMO kad su probni krediti potrošeni (S26, §7.4)
//
// Ostala stanja nemaju traku: `komp` i `aktivan` rade normalno, proba sa
// kreditima isto, `dopuna` sa kupljenim paketom isto, a `zakljucan` uopšte ne
// stiže dovde — kapija ga odvodi na `/zakljucano`.
//
// ── zašto traka, a ne samo modal ─────────────────────────────
// Modal se zatvori i više se ne javlja. Datum do kog čovek sme da izveze svoj
// rad je jedina informacija u proizvodu koju mora da vidi SVAKI put dok traje —
// zato stoji iznad sadržaja, na svakom ekranu, dok stanje ne prođe.
//
// Boje: `--warn` za grace (rok koji ističe i posao koji je stao) i `--info` za
// otkazanu pretplatu, potrošenu probu i nalog bez plana (obaveštenje, ne
// upozorenje). Crvena je rezervisana za greške i za Ugly Score — istekla
// pretplata nije kvar.

import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import {
  ONBOARDING_CREDITS,
  TRIAL_CREDITS,
  TRIAL_DAYS,
  type Pristup,
  type UzrokGrace,
} from "@sajtoskop/shared";
import { formatDatum, plural, redniDan } from "@/lib/ui-tekst";
import { AktivirajOdmah, type AktivacijaProbe } from "./aktiviraj-odmah";
import { PortalDugme } from "./portal-dugme";

const OKVIR_INFO = "border-b border-info/25 bg-info-wash px-4 py-3 sm:px-6 lg:px-8";
const OKVIR_WARN = "border-b border-warn/30 bg-warn-wash px-4 py-3 sm:px-6 lg:px-8";

/**
 * Link, ne dugme: traka je na svakom ekranu i uvek je uz primarno dugme te
 * strane, a dva primarna dugmeta po ekranu ne postoje (§7.1).
 */
const LINK = "shrink-0 self-start text-xs font-medium text-accent-text underline underline-offset-4 hover:no-underline";

/** Generički ulaz na planove sa landinga i iz onboardinga (§1.2, §1.12). */
const PLANOVI_PRO = "/cenovnik?plan=pro&ciklus=mesecno";

/** „7 dana probe i 10 kredita, kartica se naplaćuje tek osmog dana" — iz kataloga, ne rukom. */
const PROBA_UKRATKO = `${TRIAL_DAYS} dana probe i ${TRIAL_CREDITS} kredita, kartica se naplaćuje tek ${redniDan(TRIAL_DAYS + 1)} dana`;

export function PristupBaner({
  pristup,
  krediti = null,
  aktivacijaProbe = null,
  probaOtkazana = false,
  uzrokGrace = null,
  dopunaBezPaketa = false,
}: {
  pristup: Pristup | null;
  /** Zbir obe kase. `null` = nije pročitano — tada traka probe ne izlazi. */
  krediti?: number | null;
  /** Iznos i plan za „Aktiviraj odmah". `null` = dugmeta nema, ostaje link. */
  aktivacijaProbe?: AktivacijaProbe | null;
  /** Otkazana pretplata je u stvari otkazana PROBA (status `trialing`). */
  probaOtkazana?: boolean;
  /** [S30] Uzrok grace-a (§2.3). `null` van grace-a. */
  uzrokGrace?: UzrokGrace | null;
  /** [S30] `dopuna` bez ijednog `credit_pack` reda (§1.12). */
  dopunaBezPaketa?: boolean;
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

  // ── [S30, §1.12] nalog bez plana, na kreditima dobrodošlice ─
  if (pristup.stanje === "dopuna") {
    if (!dopunaBezPaketa) return null;

    return (
      <div role="status" className={OKVIR_INFO}>
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <Info className="mt-0.5 hidden h-4 w-4 shrink-0 text-info-text sm:block" aria-hidden />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-muted">
            Nemaš plan. Dobio si{" "}
            <span className="num">{ONBOARDING_CREDITS}</span>{" "}
            {plural(ONBOARDING_CREDITS, "kredit", "kredita", "kredita")} da probaš: jedna lista,
            jedan prospekt.{" "}
            <strong className="font-semibold text-fg">Plan počinje sa {PROBA_UKRATKO}.</strong>
          </p>
          <Link href={PLANOVI_PRO} className={LINK}>
            Pogledaj planove
          </Link>
        </div>
      </div>
    );
  }

  if (pristup.stanje !== "grace" && pristup.stanje !== "otkazan") return null;

  // ── grace, po uzroku (§2.3) ─────────────────────────────────
  if (pristup.stanje === "grace") {
    const citanjeDo = pristup.citanjeDo ? formatDatum(pristup.citanjeDo) : null;

    return (
      <div role="status" className={OKVIR_WARN}>
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <AlertTriangle className="mt-0.5 hidden h-4 w-4 shrink-0 text-warn-text sm:block" aria-hidden />

          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            {uzrokGrace === "naplata" ? (
              // §2.2, dan 8.
              <p className="text-fg-muted">
                <span className="font-medium text-warn-text">Naplata nije prošla.</span>{" "}
                {pristup.punDo && (
                  <>
                    Kartica je odbijena <span className="num">{formatDatum(pristup.punDo)}</span>.{" "}
                  </>
                )}
                Ažuriraj karticu i plan se nastavlja
                {citanjeDo ? (
                  <>
                    ; do <span className="num">{citanjeDo}</span> možeš da čitaš svoje prospekte.
                  </>
                ) : (
                  "."
                )}
              </p>
            ) : uzrokGrace === "besplatni" ? (
              // §1.12, posle oba kredita dobrodošlice. [posle S30] Prvo ono što
              // se desilo (kredita nema), pa šta NE radi, pa šta ostaje — bez
              // prodaje u istoj rečenici; put dalje je link desno.
              <p className="text-fg-muted">
                <span className="font-medium text-warn-text">Nemaš više kredita.</span>{" "}
                Nove pretrage, skeniranja i otključavanja ne rade
                {citanjeDo ? (
                  <>
                    ; liste i prospekti koje si već otvorio ostaju ti do{" "}
                    <span className="num">{citanjeDo}</span>.
                  </>
                ) : (
                  "."
                )}
              </p>
            ) : (
              // §2.3, „sve ostalo". Izlaz je plan — paket se u grace-u ne kupuje.
              <>
                <p className="font-medium text-warn-text">
                  Pristup ti je istekao
                  {pristup.punDo ? (
                    <>
                      {" "}
                      <span className="num">{formatDatum(pristup.punDo)}</span>.
                    </>
                  ) : (
                    "."
                  )}
                </p>
                {citanjeDo && (
                  <p className="mt-1 text-fg-muted">
                    Do <span className="num">{citanjeDo}</span> možeš da otvaraš svoje prospekte,
                    vodiš pipeline i izvezeš oba CSV-a. Pretraga, skeniranje i otključavanje ne rade
                    dok ne uzmeš plan.
                  </p>
                )}
              </>
            )}
          </div>

          {uzrokGrace === "naplata" ? (
            <PortalDugme className="shrink-0 self-start">Ažuriraj karticu</PortalDugme>
          ) : uzrokGrace === "besplatni" ? (
            <Link href={PLANOVI_PRO} className={LINK}>
              Pogledaj planove
            </Link>
          ) : (
            <Link href="/cenovnik" className={LINK}>
              Vrati pristup
            </Link>
          )}
        </div>
      </div>
    );
  }

  // ── otkazan ─────────────────────────────────────────────────
  return (
    <div role="status" className={OKVIR_INFO}>
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <Info className="mt-0.5 hidden h-4 w-4 shrink-0 text-info-text sm:block" aria-hidden />

        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          {probaOtkazana ? (
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
          Pogledaj planove
        </Link>
      </div>
    </div>
  );
}
