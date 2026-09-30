// apps/web/src/components/pretplata-blok.tsx
// Stanje pretplate i obe kase kredita, iznad izvoda iz knjige (S21).
//
// ── zašto OBE KASE odvojeno ─────────────────────────────────
// `credits_balance` se prvog u mesecu POSTAVLJA na dodelu plana, ne sabira
// (migracija 0004, „bez rollovera"), a `credits_topup` se ne dira nikad
// (LANSIRANJE §1.4). Korisnik koji vidi jedan broj i zatekne ga manjim prvog u
// mesecu ima tačno jedno objašnjenje na raspolaganju — „nestali su mi krediti
// koje sam platio". Zato ovaj blok razbija zbir na dva reda i uz svaki piše šta
// se s njim dešava. Svuda drugde u proizvodu stoji ZBIR, jer se troši iz oba.
//
// ── proba (S26, naplata-stripe.md §7) ───────────────────────
// U stanju `proba` naslov je datum kraja probe, a rečenica kaže koliko se i za
// šta naplaćuje osmog dana. Iznos dolazi iz `plans.ts` po `lookup_key`
// pretplate (`pretplata.eur`) — to je cena koja se stvarno naplaćuje.
// „Aktiviraj odmah" je SEKUNDARNO dugme: §7.1 daje jedno primarno po ekranu,
// i ono ostaje „Dokupi kredite" / „Pogledaj planove".
//
// Otkazana proba je `otkazan` (ne `proba`, v. `stanjePristupa`), ali rečenica
// je njena: „Proba otkazana, traje do …" — korisnik koji je otkazao probu nije
// otkazao pretplatu u svojoj glavi, i ne sme da pomisli da će mu kartica biti
// naplaćena.
//
// `past_due` (kartica pala pri obnovi) dobija upozorenje sa portalom — to je
// jedino stanje u kome čovek MORA nešto da uradi da ne bi izgubio pristup, a
// portal je jedino mesto gde to može. Kad pređe u grace, upozorenje nosi traka
// na vrhu (`PristupBaner`), ne ovaj blok.
//
// [čišćenje UI-a] Raspored: gore ukupno kredita i podela (mesečni / kupljeni),
// dugmad desno, pa pretplata. Pravila kasa su u oblačiću „i".

import Link from "next/link";
import { ArrowRight, Coins, Wallet } from "lucide-react";
import {
  formatEur,
  sledecaDodelaKredita,
  jeNeograniceno,
  smeDaKupiPaket,
  TRIAL_DAYS,
  type Pristup,
} from "@sajtoskop/shared";
import { formatDatum, imePlana, redniDan } from "@/lib/ui-tekst";
import type { PretplataZaEkran } from "@/lib/pretplata";
import { Alert } from "@/components/ui/alert";
import { InfoSavet } from "@/components/ui/info-savet";
import { Button } from "@/components/ui/button";
import { AktivirajOdmah, type AktivacijaProbe } from "@/components/aktiviraj-odmah";
import { PortalDugme } from "@/components/portal-dugme";
import { PrijaviGresku } from "@/components/prijavi-gresku";

const CIKLUS_REC = { month: "mesečno", year: "godišnje" } as const;

/** „Osmog" — dan prve naplate, izveden iz `TRIAL_DAYS`, sa velikim slovom. */
const DAN_NAPLATE = (() => {
  const d = redniDan(TRIAL_DAYS + 1);
  return d.charAt(0).toUpperCase() + d.slice(1);
})();

export function PretplataBlok({
  pristup,
  plan,
  pretplata,
  aktivacija,
  imaStripeKupca,
  izPretplate,
  dokupljeni,
  mesecnaDodela,
}: {
  /** `null` = stanje se ne čita (kvar veze). Tada blok samo prikazuje kase. */
  pristup: Pristup | null;
  /** `profiles.plan`. */
  plan: string;
  pretplata: PretplataZaEkran | null;
  /**
   * Iznos, plan i dodela za „Aktiviraj odmah" — iz `aktivacijaZa()`. `null` van
   * probe, ili kad iznos nije poznat; tada dugmeta nema.
   */
  aktivacija: AktivacijaProbe | null;
  /** Ima li nalog `stripe_customer_id`, dakle ima li portal šta da otvori. */
  imaStripeKupca: boolean;
  /** `credits_balance` — kasa koja se resetuje. */
  izPretplate: number;
  /** `credits_topup` — kasa koja ne ističe. */
  dokupljeni: number;
  /** Koliko kredita plan dodeljuje mesečno. `0` za nalog bez plana. */
  mesecnaDodela: number;
}) {
  const ciklus = pretplata?.ciklus ? CIKLUS_REC[pretplata.ciklus] : null;
  // Odluka 26.8.: paket traži aktivan plan, komp ili probu. Ko ne sme, ne dobija dugme
  // koje bi ga odvelo u `403` — dobija ono koje ga vodi na planove.
  const smePaket = smeDaKupiPaket(pristup);
  // [0029] Admin nalog: ni plan ni paket nemaju šta da mu ponude.
  const neograniceno = jeNeograniceno(pristup);
  const naplataPala = pretplata?.status === "past_due";

  // [čišćenje UI-a] Pravila kasa stoje u oblačiću, ne na ekranu: pročitaju se
  // jednom, a broj se gleda svaki put.
  const infoKrediti = (
    <>
      {pristup?.stanje === "proba" ? (
        <>
          Probni krediti važe do kraja probe. Prvom naplatom postaje ih tačno{" "}
          <span className="num">{aktivacija?.krediti ?? mesecnaDodela}</span>, ne sabiraju se.
        </>
      ) : mesecnaDodela > 0 ? (
        <>
          Mesečni krediti se obnavljaju{" "}
          <span className="num">{formatDatum(sledecaDodelaKredita())}</span>: tada ih ima tačno{" "}
          <span className="num">{mesecnaDodela}</span>, ne sabiraju se sa ostatkom.
        </>
      ) : (
        <>Mesečnih kredita nema dok nalog nema plan ili besplatan pristup.</>
      )}{" "}
      Kupljeni krediti ne ističu i obnova ih ne dira. Prvo se troše{" "}
      {pristup?.stanje === "proba" ? "probni" : "mesečni"}, pa kupljeni.
    </>
  );

  return (
    <section className="rounded-2xl border border-border bg-bg-elev shadow-sm">
      {/* ── 1. krediti: jedan broj, pa podela ─────────────────── */}
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Krediti
            </p>
            {!neograniceno && <InfoSavet label="Objašnjenje: Krediti">{infoKrediti}</InfoSavet>}
          </div>
          <p className="mt-1 text-3xl font-semibold tracking-tight">
            {neograniceno ? "Neograničeno" : <span className="num">{izPretplate + dokupljeni}</span>}
          </p>
          {!neograniceno && (
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <div className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-accent-text" aria-hidden />
                <dt className="text-fg-muted">{pristup?.stanje === "proba" ? "Probni" : "Mesečni"}</dt>
                <dd className="num font-medium">{izPretplate}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-accent-text" aria-hidden />
                <dt className="text-fg-muted">Kupljeni</dt>
                <dd className="num font-medium">{dokupljeni}</dd>
              </div>
            </dl>
          )}
        </div>

        {/* Jedno primarno dugme na ekranu (§7.1). Šta ono nudi zavisi od toga
            šta nalog SME: dopunu, ili plan koji dopunu otključava. Sve ostalo
            je sekundarno — i „Aktiviraj odmah", iako naplaćuje. */}
        <div className="flex shrink-0 flex-wrap items-start gap-2">
          {!neograniceno && (
            <Button asChild variant="primary">
              <Link href={smePaket ? "/cenovnik#paketi" : "/cenovnik"}>
                {smePaket ? "Dokupi kredite" : "Pogledaj planove"}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          )}
          {pristup?.stanje === "proba" && aktivacija && <AktivirajOdmah aktivacija={aktivacija} />}
          {imaStripeKupca ? (
            <PortalDugme>{pretplata ? "Upravljaj pretplatom" : "Računi i kartica"}</PortalDugme>
          ) : (
            // Bez Stripe kupca portal nema šta da otvori. Drugi „Pogledaj
            // planove" stoji samo kad primarno dugme nudi nešto drugo.
            smePaket && !neograniceno && (
              <Button asChild variant="secondary">
                <Link href="/cenovnik">Pogledaj planove</Link>
              </Button>
            )
          )}
        </div>
      </div>

      {/* ── 2. pretplata: ime plana i jedna rečenica ──────────── */}
      <div className="border-t border-border p-5 sm:p-6">
        <div className="flex items-center gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Pretplata
          </p>
          {imaStripeKupca && (
            <InfoSavet label="Objašnjenje: Pretplata">
              Otkazivanje, promenu kartice ili plana i račune menjaš na stranici za plaćanje. Račun
              stiže mejlom posle svake naplate.
            </InfoSavet>
          )}
        </div>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {pristup?.stanje === "proba" ? (
            <>
              <span className="text-base font-semibold tracking-tight">
                Proba do <span className="num">{formatDatum(pristup.probaDo)}</span>
              </span>
              <span className="text-sm text-fg-muted">
                · {imePlana(pretplata?.plan ?? plan)}
                {ciklus && `, ${ciklus}`}
              </span>
            </>
          ) : (
            <>
              <span className="text-base font-semibold tracking-tight">
                {neograniceno ? "Admin nalog" : imePlana(plan)}
              </span>
              {ciklus && <span className="text-sm text-fg-muted">· {ciklus}</span>}
            </>
          )}
        </p>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-fg-muted">
          <Recenica pristup={pristup} pretplata={pretplata} aktivacija={aktivacija} />
        </p>

        {/* [čišćenje UI-a, F] Grace (pala naplata, istek, potrošeni besplatni
            krediti) ima traku na vrhu svakog ekrana (`PristupBaner`) i ovde se
            više ne ponavlja. Ostaje samo `past_due` dok period još traje:
            stanje je tada `aktivan`, pa traka ćuti, a čovek MORA da ažurira
            karticu da ne bi izgubio pristup. */}
        {naplataPala && pristup?.stanje !== "grace" && (
          <Alert variant="warning" className="mt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                <span className="font-medium">Naplata nije prošla. Ažuriraj karticu.</span>{" "}
                <span className="text-fg-muted">
                  Pokušaćemo ponovo narednih dana. Ako ne uspe, moći ćeš samo da gledaš i izvoziš
                  svoj rad.
                </span>
              </p>
              {imaStripeKupca && <PortalDugme className="shrink-0">Ažuriraj karticu</PortalDugme>}
            </div>
            {/* [S29 §5.3 D] Kartica ume da padne i kad je sve u redu sa njom.
                Stanje naloga uz prijavu dopisuje server (`pristup.stanje`) — ne
                ovaj ekran (pravilo 8). Odavde ide samo ono što je čovek video. */}
            <PrijaviGresku ctx={{ greska: "Naplata nije prošla." }} className="mt-2" />
          </Alert>
        )}
      </div>
    </section>
  );
}

/**
 * Jedna rečenica o stanju naloga, sa datumom kad ga ima.
 *
 * Ime stanja se korisniku NE ispisuje (v. `STANJE_PRISTUPA` u `lib/ui-tekst.ts`):
 * „ti si u stanju grace" nije odgovor ni na jedno pitanje koje on postavlja.
 * Ime stanja postoji za admin konzolu; ovde stoji šta to znači i do kad.
 */
function Recenica({
  pristup,
  pretplata,
  aktivacija,
}: {
  pristup: Pristup | null;
  pretplata: PretplataZaEkran | null;
  aktivacija: AktivacijaProbe | null;
}) {
  if (!pristup) {
    return <>Stanje naloga trenutno ne možemo da pročitamo. Krediti su po poslednjem čitanju.</>;
  }

  // Grananje ide po `pristup.stanje`, ne po kopiji te vrednosti u zasebnoj
  // promenljivoj: `Pristup` je diskriminisana unija, pa samo ovako TS zna da
  // `punDo` u grani `otkazan` NIJE `null` (v. komentar uz tip u `pristup.ts`).
  switch (pristup.stanje) {
    case "komp":
      return pristup.punDo ? (
        <>
          Besplatan pristup do <span className="num">{formatDatum(pristup.punDo)}</span>. Posle
          toga imaš još mesec dana da izvezeš svoj rad.
        </>
      ) : pristup.admin ? (
        <>
          Skeniranje i otključavanje ne troše kredite. Dnevna ograničenja su kao na Advanced
          planu.
        </>
      ) : (
        <>Besplatan pristup bez roka. Krediti stižu svakog meseca.</>
      );

    case "proba":
      return aktivacija ? (
        <>
          {DAN_NAPLATE} dana kartica se naplaćuje{" "}
          <span className="num">{formatEur(aktivacija.eur)}</span> za {aktivacija.imePlana} i
          dobijaš <span className="num">{aktivacija.krediti}</span> kredita. Plan možeš da
          aktiviraš i ranije.
        </>
      ) : (
        // Ključ pretplate van kataloga (ručno napravljena u panelu): iznos se
        // ne izmišlja, a bez iznosa se ne nudi ni „Aktiviraj odmah".
        <>
          {DAN_NAPLATE} dana kartica se naplaćuje po ceni plana i dobijaš pune kredite plana.
        </>
      );

    case "aktivan":
      return (
        <>
          Pretplata je aktivna. Sledeća naplata{" "}
          <span className="num">
            {formatDatum(pretplata?.currentPeriodEnd ?? pristup.punDo)}
          </span>
          {pretplata?.eur !== null && pretplata?.eur !== undefined ? (
            <>
              , <span className="num">{formatEur(pretplata.eur)}</span>
            </>
          ) : null}
          .
        </>
      );

    case "otkazan":
      return pretplata?.status === "trialing" ? (
        <>
          Proba otkazana, važi do <span className="num">{formatDatum(pristup.trajeDo)}</span>.
          Kartica se neće naplatiti.
        </>
      ) : (
        <>
          Pretplata je otkazana i važi do{" "}
          <span className="num">{formatDatum(pristup.trajeDo)}</span>. Do tada radi sve.
        </>
      );

    case "dopuna":
      return (
        <>
          Nemaš pretplatu, trošiš kupljene kredite. Dnevna ograničenja su kao na Starter planu.
        </>
      );

    case "grace":
      // Datumi i put dalje stoje u traci na vrhu ekrana (`PristupBaner`) —
      // dva puta isti datum na istom ekranu je šum, ne naglasak.
      return <>Pristup je istekao.</>;

    case "zakljucan":
      // Do ovog ekrana ne stiže — `zahtevajCitanje()` ga odvodi na
      // `/zakljucano`. Grana postoji da unija ostane iscrpna.
      return <>Pristup je istekao.</>;
  }
}
