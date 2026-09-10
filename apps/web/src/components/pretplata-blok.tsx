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
// ── iznos u evrima ──────────────────────────────────────────
// [S25] Iznos plana SME da se prikaže: dolazi iz `plans.ts` po `lookup_key`
// pretplate (`pretplata.eur`), ne iz Stripe-a, i to je cena koja se stvarno
// naplaćuje — popusta više nema (pozivnica „prvi mesec" je 100% samo na prvoj
// fakturi). Blok probe i „Aktiviraj odmah" su K2 (S26); ovde je samo tekst.

import Link from "next/link";
import { ArrowRight, Coins, Wallet } from "lucide-react";
import { formatEur, sledecaDodelaKredita, smeDaKupiPaket, type Pristup } from "@sajtoskop/shared";
import { formatDatum, imePlana } from "@/lib/ui-tekst";
import type { PretplataZaEkran } from "@/lib/pretplata";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PortalDugme } from "@/components/portal-dugme";

const CIKLUS_REC = { month: "mesečno", year: "godišnje" } as const;

export function PretplataBlok({
  pristup,
  plan,
  pretplata,
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

  return (
    <section className="rounded-2xl border border-border bg-bg-elev shadow-sm">
      {/* ── 1. pretplata ──────────────────────────────────── */}
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Pretplata
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-lg font-semibold tracking-tight">{imePlana(plan)}</span>
            {ciklus && <span className="text-sm text-fg-muted">· {ciklus}</span>}
          </p>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-fg-muted">
            <Recenica pristup={pristup} pretplata={pretplata} />
          </p>
        </div>

        {/* Jedno primarno dugme na ekranu (§7.1). Šta ono nudi zavisi od toga
            šta nalog SME: dopunu, ili plan koji dopunu otključava. */}
        <div className="flex shrink-0 flex-wrap items-start gap-2">
          <Button asChild variant="primary">
            <Link href={smePaket ? "/cenovnik#paketi" : "/cenovnik"}>
              {smePaket ? "Dokupi kredite" : "Pogledaj planove"}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          {imaStripeKupca ? (
            <PortalDugme>{pretplata ? "Upravljaj pretplatom" : "Računi i kartica"}</PortalDugme>
          ) : (
            <Button asChild variant="secondary">
              <Link href="/cenovnik">Pogledaj planove</Link>
            </Button>
          )}
        </div>
      </div>

      {pristup?.stanje === "grace" && (
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <Alert variant="warning">
            <span className="font-medium">
              Pristup ti je istekao <span className="num">{formatDatum(pristup.punDo)}</span>.
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
            naslov="Iz pretplate"
            iznos={izPretplate}
            objasnjenje={
              mesecnaDodela > 0 ? (
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
}: {
  pristup: Pristup | null;
  pretplata: PretplataZaEkran | null;
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
        <>Komp pristup bez roka. Krediti stižu svakog meseca dok komp traje.</>
      );

    case "proba":
      return (
        <>
          Proba do <span className="num">{formatDatum(pristup.probaDo)}</span>. Tada se kartica
          naplaćuje{pretplata?.eur !== null && pretplata?.eur !== undefined ? <> <span className="num">{formatEur(pretplata.eur)}</span></> : null}{" "}
          i dobijaš pune kredite plana.
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
      return (
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
