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
// `past_due` (kartica pala pri obnovi) dobija upozorenje sa portalom iznad
// svega ostalog — to je jedino stanje u kome čovek MORA nešto da uradi da ne
// bi izgubio pristup, a portal je jedino mesto gde to može.

import Link from "next/link";
import { ArrowRight, Coins, Wallet } from "lucide-react";
import {
  formatEur,
  sledecaDodelaKredita,
  smeDaKupiPaket,
  TRIAL_DAYS,
  type Pristup,
} from "@sajtoskop/shared";
import { formatDatum, imePlana, redniDan } from "@/lib/ui-tekst";
import type { PretplataZaEkran } from "@/lib/pretplata";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AktivirajOdmah, type AktivacijaProbe } from "@/components/aktiviraj-odmah";
import { PortalDugme } from "@/components/portal-dugme";

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
  const naplataPala = pretplata?.status === "past_due";

  return (
    <section className="rounded-2xl border border-border bg-bg-elev shadow-sm">
      {/* ── 1. pretplata ──────────────────────────────────── */}
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Pretplata
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {pristup?.stanje === "proba" ? (
              <>
                <span className="text-lg font-semibold tracking-tight">
                  Proba do <span className="num">{formatDatum(pristup.probaDo)}</span>
                </span>
                <span className="text-sm text-fg-muted">
                  · {imePlana(pretplata?.plan ?? plan)}
                  {ciklus && `, ${ciklus}`}
                </span>
              </>
            ) : (
              <>
                <span className="text-lg font-semibold tracking-tight">{imePlana(plan)}</span>
                {ciklus && <span className="text-sm text-fg-muted">· {ciklus}</span>}
              </>
            )}
          </p>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-fg-muted">
            <Recenica pristup={pristup} pretplata={pretplata} aktivacija={aktivacija} />
          </p>
        </div>

        {/* Jedno primarno dugme na ekranu (§7.1). Šta ono nudi zavisi od toga
            šta nalog SME: dopunu, ili plan koji dopunu otključava. Sve ostalo
            je sekundarno — i „Aktiviraj odmah", iako naplaćuje. */}
        <div className="flex shrink-0 flex-wrap items-start gap-2">
          <Button asChild variant="primary">
            <Link href={smePaket ? "/cenovnik#paketi" : "/cenovnik"}>
              {smePaket ? "Dokupi kredite" : "Pogledaj planove"}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          {pristup?.stanje === "proba" && aktivacija && <AktivirajOdmah aktivacija={aktivacija} />}
          {imaStripeKupca ? (
            <PortalDugme>{pretplata ? "Upravljaj pretplatom" : "Računi i kartica"}</PortalDugme>
          ) : (
            // Bez Stripe kupca portal nema šta da otvori. Drugi „Pogledaj
            // planove" stoji samo kad primarno dugme nudi nešto drugo.
            smePaket && (
              <Button asChild variant="secondary">
                <Link href="/cenovnik">Pogledaj planove</Link>
              </Button>
            )
          )}
        </div>
      </div>

      {naplataPala && (
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <Alert variant="warning">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                <span className="font-medium">Naplata nije prošla. Ažuriraj karticu.</span>{" "}
                <span className="text-fg-muted">
                  Stripe pokušava ponovo narednih dana. Dok period ne istekne radi sve; posle toga
                  pristup prelazi u režim čitanja.
                </span>
              </p>
              {imaStripeKupca && <PortalDugme className="shrink-0">Ažuriraj karticu</PortalDugme>}
            </div>
          </Alert>
        </div>
      )}

      {pristup?.stanje === "grace" && !naplataPala && (
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <Alert variant="warning">
            <span className="font-medium">
              {/* [S28, O3] Nov nalog u grace-u nema plaćen rok — v. `pristup.ts`. */}
              {pristup.punDo === null ? (
                "Besplatni krediti su potrošeni."
              ) : (
                <>
                  Pristup ti je istekao <span className="num">{formatDatum(pristup.punDo)}</span>.
                </>
              )}
            </span>{" "}
            <span className="text-fg-muted">
              Do <span className="num">{formatDatum(pristup.citanjeDo)}</span> možeš da otvaraš
              svoje prospekte, vodiš pipeline i izvezeš oba CSV-a. Skeniranje i otključavanje ne
              rade dok ne uzmeš plan — krediti koje vidiš ispod te čekaju.
            </span>
          </Alert>
        </div>
      )}

      {imaStripeKupca && (
        <p className="px-5 pb-5 text-xs leading-relaxed text-fg-muted sm:px-6 sm:pb-6">
          Otkazivanje, izmena kartice, promena plana i preuzimanje računa idu kroz Stripe portal.
          Račun stiže mejlom posle svake naplate, u ime prodavca.
        </p>
      )}

      {/* ── 2. dve kase ───────────────────────────────────── */}
      <div className="border-t border-border p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Krediti
          </p>
          <p className="text-sm text-fg-muted">
            ukupno{" "}
            <span className="num text-base font-semibold text-fg">{izPretplate + dokupljeni}</span>
          </p>
        </div>

        {/* `gap-px` na `bg-border` — mreža bez dvostrukih linija (§7.2), i bez
            ugnježđene kartice: dva polja dele istu površinu. */}
        <div className="mt-3 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
          <Kasa
            ikona={<Wallet aria-hidden />}
            naslov={pristup?.stanje === "proba" ? "Probni" : "Iz pretplate"}
            iznos={izPretplate}
            objasnjenje={
              pristup?.stanje === "proba" ? (
                <>
                  Važe do kraja probe. Prvom naplatom se postavljaju na{" "}
                  <span className="num">{aktivacija?.krediti ?? mesecnaDodela}</span> kredita plana
                  — ne sabiraju se.
                </>
              ) : mesecnaDodela > 0 ? (
                <>
                  Obnavlja se{" "}
                  <span className="num">{formatDatum(sledecaDodelaKredita())}</span> — tada se
                  postavlja na <span className="num">{mesecnaDodela}</span>, ne sabira.
                  Neiskorišćeno se ne prenosi.
                </>
              ) : (
                <>Nema mesečne dodele dok nalog nema plan ni komp pristup.</>
              )
            }
          />
          <Kasa
            ikona={<Coins aria-hidden />}
            naslov="Dokupljeni"
            iznos={dokupljeni}
            objasnjenje={
              <>
                <strong className="font-medium text-fg">Ne ističu.</strong> Krediti iz paketa
                stoje dok ih ne potrošiš i mesečna dodela ih ne dira. Nov paket se kupuje uz
                aktivan plan ili komp pristup.
              </>
            }
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-fg-muted">
          Troši se prvo ono što ističe, pa dokupljeno — jedini redosled koji je u tvoju korist.
        </p>
      </div>
    </section>
  );
}

function Kasa({
  ikona,
  naslov,
  iznos,
  objasnjenje,
}: {
  ikona: React.ReactNode;
  naslov: string;
  iznos: number;
  objasnjenje: React.ReactNode;
}) {
  return (
    <div className="bg-bg-elev p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent-text [&_svg]:h-3.5 [&_svg]:w-3.5">
          {ikona}
        </span>
        <p className="text-xs font-medium text-fg-muted">{naslov}</p>
      </div>
      <p className="num mt-2 text-2xl font-semibold tracking-tight">{iznos}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{objasnjenje}</p>
    </div>
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
    return <>Stanje naloga se trenutno ne čita. Krediti ispod su poslednje što je pročitano.</>;
  }

  // Grananje ide po `pristup.stanje`, ne po kopiji te vrednosti u zasebnoj
  // promenljivoj: `Pristup` je diskriminisana unija, pa samo ovako TS zna da
  // `punDo` u grani `otkazan` NIJE `null` (v. komentar uz tip u `pristup.ts`).
  switch (pristup.stanje) {
    case "komp":
      return pristup.punDo ? (
        <>
          Komp pristup do <span className="num">{formatDatum(pristup.punDo)}</span>. Do tada radi
          sve; posle toga imaš još mesec dana da izvezeš svoj rad.
        </>
      ) : (
        <>Komp pristup, neograničeno. Krediti stižu svakog meseca dok komp traje.</>
      );

    case "proba":
      return aktivacija ? (
        <>
          {DAN_NAPLATE} dana kartica se naplaćuje{" "}
          <span className="num">{formatEur(aktivacija.eur)}</span> za {aktivacija.imePlana} i
          dobijaš <span className="num">{aktivacija.krediti}</span> kredita. Ako potrošiš probne
          kredite ranije, možeš da aktiviraš plan odmah.
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
          Proba otkazana, traje do <span className="num">{formatDatum(pristup.punDo)}</span>.
          Kartica se neće naplatiti, a do tada radi sve kao i do sada.
        </>
      ) : (
        <>
          Pretplata je otkazana i neće se obnoviti, ali traje do{" "}
          <span className="num">{formatDatum(pristup.punDo)}</span>. Do tog datuma radi sve kao i
          do sada.
        </>
      );

    case "dopuna":
      return (
        <>
          Nemaš pretplatu i radiš na kupljenim kreditima. Pristup traje dok ih ima, sa Starter
          dnevnim limitima.
        </>
      );

    case "grace":
      // Datumi stoje u upozorenju ispod — dva puta isti datum u dva susedna
      // pasusa je šum, ne naglasak.
      return <>Pristup je istekao. Detalji i rokovi su odmah ispod.</>;

    case "zakljucan":
      // Do ovog ekrana ne stiže — `zahtevajCitanje()` ga odvodi na
      // `/zakljucano`. Grana postoji da unija ostane iscrpna.
      return <>Pristup je istekao i grace period je prošao.</>;
  }
}
