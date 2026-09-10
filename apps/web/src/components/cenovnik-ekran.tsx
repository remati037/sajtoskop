"use client";

// apps/web/src/components/cenovnik-ekran.tsx
// Ekran cena: tri plana, prekidač mesečno/godišnje, paketi — i dugme koje vodi
// na Stripe hosted Checkout.
//
// ── odakle dolazi cifra ─────────────────────────────────────
// Iz `plans.ts` (`PLAN_PRICES`, `CREDIT_PACKS`), kroz `formatEur()`. Stripe
// hosted Checkout prikazuje iznos na svojoj strani; ovaj ekran ga mora
// prikazati PRE toga i čita ga iz jedinog izvora u kodu. Stripe katalog se
// proverava naspram tog fajla (`pnpm stripe:doktor`), ne obrnuto. Cene su u
// evrima, bez PDV-a (odluka D1: bez Stripe Tax).
//
// Godišnja cena nosi i mesečni ekvivalent („€290 / godišnje (€24,17
// mesečno)"), izračunat deljenjem sa 12 u `mesecnoOdGodisnje()` — bez `Intl`,
// zbog hydration-a.
//
// ── klik ────────────────────────────────────────────────────
// `POST /api/billing/checkout { vrsta, plan, ciklus } | { vrsta, paket }` →
// `{ url }` → `window.location.assign(url)`. Nema klijentskog SDK-a i nema
// nijednog Stripe skripta u dokumentu: identitet kupca (`client_reference_id`)
// upisuje server iz Clerk sesije (pravilo 8), a pregledač samo ode na Stripe.
//   · gost ne može u checkout — bez sesije nema `user_id`, pa dugme vodi na
//     registraciju sa povratkom na SVOJ izbor (`naRegistraciju`).
//   · svako dugme ima svoje stanje čekanja: između klika i redirekcije stoji
//     jedan mrežni poziv ka nama.
//   · `409` nosi `kod` (S26): „ima_plan" dobija poruku i link na `/krediti`
//     (promena plana ide kroz portal), „komp" samo poruku.
//
// ── proba i pozivnica (S26) ─────────────────────────────────
// Rečenica o probi stoji iznad kartica SAMO kad je nalog stvarno dobija
// (`probaDostupna`, izvedeno na serveru istom funkcijom koju zove checkout).
// Pozivnica „prvi mesec gratis" (`gratisMesec`) menja cenu na kartici u bedž
// „Prvi mesec €0" + „od drugog meseca €X" — i isključuje tekst probe, jer
// checkout uz kupon probu ne daje. Kupon važi samo uz mesečni ciklus.
//
// ── namera sa landinga (S24) ────────────────────────────────
// `/cenovnik?plan=pro&ciklus=godisnje` / `?paket=200` preselektuje: prekidač
// kreće od ciklusa iz linka; izabran plan nosi akcenat, primarno dugme i bedž
// „Tvoj izbor" (jedan akcenat po ekranu, §7.1); `?paket=` doskroluje.
//
// ‼️ Checkout se NAMERNO ne otvara sam na osnovu `?plan=`: to je Stripe sesija
//    po svakom učitavanju strane, uključujući osvežavanje, „nazad" iz istorije
//    i svakog bota. Namera preselektuje; klik ostaje čovekov.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Coins,
  CreditCard,
  Infinity as Beskonacno,
  Loader2,
  Lock,
  TriangleAlert,
} from "lucide-react";
import {
  CIKLUS_LABELA,
  CIKLUS_SUFIKS,
  CIKLUSI,
  formatEur,
  GODISNJI_BONUS,
  mesecnoOdGodisnje,
  PAKETI,
  PROBA_RECENICA,
  TIERS,
  type Ciklus,
  type Paket,
  type Tier,
} from "@/lib/cenovnik";
import type { PaketId } from "@sajtoskop/shared";
import type { CheckoutBody } from "@/lib/billing-schema";
import {
  naRegistraciju,
  putanjaZaPaket,
  putanjaZaPlan,
  type Namera,
} from "@/lib/cenovnik-namera";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * Gde gost ide sa dugmeta „Uzmi plan" kad nemamo ništa konkretnije.
 *
 * Od S24 se svaki klik vraća na SVOJ izbor (v. `naRegistraciju()` iz
 * `lib/cenovnik-namera.ts`); ovo je rezerva za slučaj kad se sesija izgubi pre
 * nego što se zna šta je kliknuto.
 */
const NA_REGISTRACIJU = naRegistraciju("/cenovnik");

/** Ključ dugmeta koje čeka — jedno po ekranu, redirekcija je jedna. */
function kljucKupovine(telo: CheckoutBody): string {
  return telo.vrsta === "plan" ? `${telo.plan}:${telo.ciklus}` : telo.paket;
}

/** Poruka iznad kartica, sa izlazom kad ga ima. */
type Greska = { poruka: string; link?: { href: string; tekst: string } };

export function CenovnikEkran({
  prijavljen,
  smePaket,
  namera,
  prodavac,
  gratisMesec,
  probaDostupna,
}: {
  /** Ima li posetilac Clerk sesiju. Bez nje nema `user_id`, dakle ni kupovine. */
  prijavljen: boolean;
  /**
   * Sme li ovaj nalog da kupi PAKET (odluka 26.8.: paket je dopuna, ne ulaz).
   *
   * Izvedeno na serveru kroz `smeDaKupiPaket()` iz shared paketa — istu funkciju
   * zove i `/api/billing/checkout`. Ovde je samo prikaz: dugme koje se ne vidi
   * nije kapija, pa provera koja stvarno drži stoji u ruti.
   */
  smePaket: boolean;
  /**
   * Šta je posetilac izabrao NA LANDINGU (`?plan=`, `?ciklus=`, `?paket=`).
   *
   * Pročitano na serveru i već očišćeno: nepoznata vrednost je stigla dovde kao
   * `null`, pa ovde nema nijedne provere ispravnosti (`lib/cenovnik-namera-schema.ts`).
   */
  namera: Namera;
  /** Ime prodavca (LLC, odluka A4) — iz env-a, na serveru. */
  prodavac: string;
  /**
   * Nalog ima neiskorišćenu pozivnicu „prvi mesec gratis" (`profiles.invite_id`).
   * Checkout tada dodaje 100% kupon na prvu MESEČNU fakturu i ne daje probu.
   */
  gratisMesec: boolean;
  /**
   * Nalog bi u checkout-u dobio probu. `false` za nalog koji je već imao probu,
   * za komp i uz pozivnicu — rečenica o probi je obećanje, pa se ne ispisuje
   * onome kome checkout neće dati probu.
   */
  probaDostupna: boolean;
}) {
  // Ciklus iz linka je POČETNA vrednost, ne zaključana: prekidač ostaje živ i
  // čovek koji je sa landinga stigao na „godišnje" sme da se predomisli.
  const [ciklus, setCiklus] = useState<Ciklus>(namera.ciklus ?? "month");
  const [greska, setGreska] = useState<Greska | null>(null);
  /** Kupovina čije se dugme trenutno čeka. Jedno po ekranu — redirekcija je jedna. */
  const [uToku, setUToku] = useState<string | null>(null);

  // ── checkout ──────────────────────────────────────────────
  // Prima slug iz kataloga, ne ID cene: `lookup_key` i `price_` izvodi server
  // iz `plans.ts` i Stripe-a. Nijedan Stripe ID ne postoji u pregledaču.
  const otvoriCheckout = useCallback(
    async (telo: CheckoutBody, nazad?: string) => {
      if (uToku) return;

      // Gost: nema `user_id`, pa nema ni čime da se poveže kupovina. Umesto
      // checkout-a koji bi primio novac bez naloga — registracija, pa nazad na
      // TAČNO ono što je kliknuto.
      if (!prijavljen) {
        window.location.href = nazad ? naRegistraciju(nazad) : NA_REGISTRACIJU;
        return;
      }

      setUToku(kljucKupovine(telo));
      setGreska(null);

      try {
        const odgovor = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(telo),
        });

        if (odgovor.status === 401) {
          // Sesija je istekla između učitavanja strane i klika.
          window.location.href = nazad ? naRegistraciju(nazad) : NA_REGISTRACIJU;
          return;
        }

        const odg = (await odgovor.json().catch(() => ({}))) as {
          url?: string;
          greska?: string;
          kod?: string;
        };

        if (!odgovor.ok || !odg.url) {
          // 403 (paket bez plana) i 409 (već ima plan / komp) nose rečenicu sa
          // servera koja kaže ŠTA da se uradi — ona ide na ekran, ne opšta.
          // Kvar (5xx, mreža) ide u `catch` i dobija opštu.
          if (odgovor.status === 403 || odgovor.status === 409) {
            setGreska({
              poruka: odg.greska ?? "Ovu kupovinu nalog trenutno ne može da napravi.",
              link:
                odg.kod === "ima_plan"
                  ? { href: "/krediti", tekst: "Otvori stranu „Krediti“" }
                  : undefined,
            });
            setUToku(null);
            return;
          }
          throw new Error(odg.greska ?? `HTTP ${odgovor.status}`);
        }

        // Bez `finally` koje gasi čekanje: strana se u ovom trenutku već menja, a
        // dugme koje se vrati u mirno stanje pre nego što redirekcija stigne
        // izgleda kao da klik nije prošao.
        window.location.assign(odg.url);
      } catch (err) {
        console.error("[cenovnik] checkout:", err);
        setGreska({
          poruka:
            err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message)
              ? err.message
              : "Plaćanje se trenutno ne može otvoriti.",
        });
        setUToku(null);
      }
    },
    [prijavljen, uToku],
  );

  return (
    <div>
      <PrekidacCiklusa vrednost={ciklus} promeni={setCiklus} />

      {/* Proba (D2): jedna rečenica, ne kartica — ista je za sva tri plana. */}
      {probaDostupna && !gratisMesec && (
        <p className="mx-auto mt-6 flex max-w-xl items-start justify-center gap-2 text-center text-sm text-fg-muted">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
          <span>{PROBA_RECENICA}.</span>
        </p>
      )}

      {greska && (
        <div
          role="alert"
          className="mx-auto mt-8 flex max-w-xl items-start gap-2.5 rounded-xl border border-border bg-bg-elev px-4 py-3 text-sm text-fg-muted shadow-sm"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-text" />
          <p>
            <span className="font-medium text-fg">{greska.poruka}</span>{" "}
            {greska.link ? (
              <Link
                href={greska.link.href}
                className="font-medium text-accent-text underline underline-offset-4"
              >
                {greska.link.tekst}
              </Link>
            ) : (
              <>
                Ako se ponavlja, javi mi se na{" "}
                <a
                  href="mailto:podrska@sajtoskop.com"
                  className="font-medium text-accent-text underline underline-offset-4"
                >
                  podrska@sajtoskop.com
                </a>
                .
              </>
            )}
          </p>
        </div>
      )}

      <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
        {TIERS.map((tier) => (
          <KarticaPlana
            key={tier.name}
            tier={tier}
            ciklus={ciklus}
            gratisMesec={gratisMesec}
            ceka={uToku === `${tier.id}:${ciklus}`}
            zakljucano={uToku !== null}
            // Namera sa landinga pomera akcenat: izabran plan dobija primarno
            // dugme i bedž, a Pro ostaje običan. Bez namere sve je kao pre.
            izabran={namera.plan === tier.id}
            istaknut={namera.plan ? namera.plan === tier.id : tier.featured === true}
            naKlik={() =>
              void otvoriCheckout(
                { vrsta: "plan", plan: tier.id, ciklus },
                putanjaZaPlan(tier.id, ciklus),
              )
            }
          />
        ))}
      </div>

      <SekcijaPaketa
        uToku={uToku}
        smePaket={smePaket}
        prijavljen={prijavljen}
        izabran={namera.paket}
        naKlik={(paket, nazad) => void otvoriCheckout({ vrsta: "paket", paket }, nazad)}
      />

      {/* D5, A4 (§4): prodavac je LLC, račun stiže mejlom od Stripe-a u ime LLC-a. */}
      <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-fg-muted">
        Cene su u evrima, bez PDV-a. Prodavac je {prodavac}, SAD; račun stiže mejlom posle svake
        naplate. Plaćanje preko firme uz fakturu — javi se na{" "}
        <a
          href="mailto:podrska@sajtoskop.com"
          className="font-medium text-accent-text underline underline-offset-4"
        >
          podrska@sajtoskop.com
        </a>
        .
      </p>
    </div>
  );
}

// ── paketi kredita ──────────────────────────────────────────
// LANSIRANJE §1.4, izmenjen 26.8.: paket je DOPUNA uz postojeći pristup, ne
// ulaz u proizvod. Kupuju ga `aktivan`, `otkazan`, `komp` i `proba` (v.
// `smeDaKupiPaket` u shared paketu); svi ostali, uključujući gosta, vide
// sekciju ali sa objašnjenjem umesto dugmeta.
//
// ── zašto se sekcija i dalje VIDI onome ko ne sme ───────────
// Sakriti je značilo bi da posetilac ne zna da paketi postoje, pa ni da mu se
// otključavaju uz plan — a to je razlog više da uzme plan, ne manje.
//
// Sekundaran blok, namerno DRUGAČIJEG oblika od tri kartice iznad: da su paketi
// četvrta i peta kartica u istom redu, čitali bi se kao jeftiniji planovi — a
// oni su po kreditu SKUPLJI od svakog plana, i to je cela poenta ponude. Zato
// jedna površina (`--bg-subtle`), dva reda unutar nje, i dugmad koja nisu
// primarna: §7.1 daje jedno primarno dugme po ekranu, a ono je gore.

function SekcijaPaketa({
  uToku,
  smePaket,
  prijavljen,
  izabran,
  naKlik,
}: {
  uToku: string | null;
  smePaket: boolean;
  prijavljen: boolean;
  /** Paket iz `?paket=` na landingu, ili `null`. */
  izabran: PaketId | null;
  naKlik: (paket: PaketId, nazad: string) => void;
}) {
  const okvir = useRef<HTMLElement | null>(null);

  // `?paket=200` nema `#paketi` u sebi kad se sklopi bez sidra, pa sekcija mora
  // sama da se dovede u vidno polje — inače čovek stigne na vrh cenovnika i ne
  // vidi ono zbog čega je došao. Jednom, i samo ako pregledač nije već
  // odskrolovao po sidru.
  useEffect(() => {
    if (!izabran || window.location.hash === "#paketi") return;
    okvir.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [izabran]);

  return (
    // `id` je odredište linkova `/cenovnik#paketi` iz modala pristupa i sa
    // strane `/zakljucano`. `scroll-mt` zbog lepljivog zaglavlja.
    <section id="paketi" ref={okvir} className="mt-14 scroll-mt-24 sm:mt-16">
      <div className="rounded-2xl border border-border bg-bg-subtle p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold tracking-tight">Paketi kredita</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
              Jednokratna kupovina, bez pretplate i bez obnavljanja.{" "}
              <strong className="font-semibold text-fg">Krediti iz paketa ne ističu</strong> —
              stoje na nalogu dok ih ne potrošiš, i mesečna dodela ih ne dira.
            </p>
          </div>

          <p className="flex shrink-0 items-center gap-2 self-start rounded-lg border border-border bg-bg-elev px-3 py-2 text-xs font-medium text-fg-muted">
            {smePaket ? (
              <>
                <Beskonacno className="h-3.5 w-3.5 text-accent-text" aria-hidden />
                Bez roka trajanja
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
                Traži aktivan plan
              </>
            )}
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {PAKETI.map((paket) => (
            <KarticaPaketa
              key={paket.id}
              paket={paket}
              ceka={uToku === paket.id}
              zakljucano={uToku !== null}
              smePaket={smePaket}
              prijavljen={prijavljen}
              izabran={izabran === paket.id}
              naKlik={() => naKlik(paket.id, putanjaZaPaket(paket.id))}
            />
          ))}
        </div>

        {/* Dve rečenice koje moraju da stoje, i to ovim redom:
            1. paket NIJE jeftinija zamena za plan — po kreditu je skuplji;
            2. paket TRAŽI plan ili komp (odluka 26.8.). */}
        <div className="mt-6 space-y-2 border-t border-border pt-5 text-xs leading-relaxed text-fg-muted">
          <p>
            <strong className="font-semibold text-fg">Paket nije zamena za plan.</strong> Po
            kreditu je skuplji od svake pretplate — ko radi redovno, prolazi jeftinije sa planom.
            Paket je tu za mesec u kome posao krene jače nego što je plan predviđao.
          </p>
          <p>
            <strong className="font-semibold text-fg">Paket traži aktivan plan ili komp.</strong>{" "}
            Kupuje se kao dopuna postojećem pristupu, ne umesto njega. Krediti iz paketa ne ističu
            i ostaju ti i kad plan istekne — ali se novi paket tada ne može kupiti dok se plan ne
            obnovi.
          </p>
        </div>
      </div>
    </section>
  );
}

function KarticaPaketa({
  paket,
  ceka,
  zakljucano,
  smePaket,
  prijavljen,
  izabran,
  naKlik,
}: {
  paket: Paket;
  ceka: boolean;
  zakljucano: boolean;
  smePaket: boolean;
  prijavljen: boolean;
  /** Ovaj paket je došao iz `?paket=` sa landinga. */
  izabran: boolean;
  naKlik: () => void;
}) {
  return (
    // Bez `shadow`: kartica stoji UNUTAR panela, a §7.2 traži jednu senku po
    // elementu i zabranjuje kartice u karticama. Izbor sa landinga se označava
    // LINIJOM, ne drugom podlogom — akcenat na ekranu ostaje jedan (§7.1).
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-bg-elev p-5",
        izabran ? "border-border-accent" : "border-border",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {paket.name}
          {izabran && <span className="sr-only"> — tvoj izbor sa sajta</span>}
        </h3>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-wash px-2 py-1 text-xs font-medium text-accent-text">
          <Coins className="h-3.5 w-3.5" aria-hidden />
          <span className="num">{paket.credits}</span> kredita
        </span>
      </div>

      <p className="mt-1.5 min-h-9 text-xs leading-relaxed text-fg-muted">
        {paket.description}
      </p>

      <div className="mt-4 flex min-h-9 items-baseline gap-1.5">
        <span className="num text-2xl font-semibold tracking-tight">{formatEur(paket.eur)}</span>
        <span className="text-xs text-fg-muted">jednokratno</span>
      </div>

      {/* Ko ne sme, ne dobija ugašeno dugme nego rečenicu i put dalje. */}
      {smePaket ? (
        <Button variant="secondary" className="mt-4 w-full" disabled={zakljucano} onClick={naKlik}>
          {ceka ? (
            <>
              <Loader2 className="animate-spin" />
              Otvaram plaćanje
            </>
          ) : (
            `Uzmi ${paket.name}`
          )}
        </Button>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-bg-subtle px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
          <span>
            {prijavljen
              ? "Otključava se čim uzmeš plan ili dobiješ komp pristup."
              : "Dostupno uz aktivan plan ili komp — uzmi plan iznad."}
          </span>
        </p>
      )}
    </div>
  );
}

// ── prekidač mesečno / godišnje ─────────────────────────────
// Segmentna kontrola po §7.1 i §3.2.1: staza i klizač idu `--border-strong`,
// klizač je jedan element koji se pomera, ne dve pozadine koje se pale.

function PrekidacCiklusa({
  vrednost,
  promeni,
}: {
  vrednost: Ciklus;
  promeni: (c: Ciklus) => void;
}) {
  const index = Math.max(CIKLUSI.indexOf(vrednost), 0);

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div
        role="radiogroup"
        aria-label="Način plaćanja"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          promeni(vrednost === "month" ? "year" : "month");
        }}
        className="relative grid grid-cols-2 gap-0.5 rounded-full border border-border-strong bg-bg-inset/60 p-1"
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc((100%-0.625rem)/2)] rounded-full bg-bg-elev shadow-sm ring-1 ring-border-strong transition-transform duration-200 ease-out"
          style={{ transform: `translateX(calc(${index} * (100% + 0.125rem)))` }}
        />
        {CIKLUSI.map((c) => {
          const aktivan = c === vrednost;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={aktivan}
              tabIndex={aktivan ? 0 : -1}
              onClick={() => promeni(c)}
              className={cn(
                "relative z-10 flex h-8 items-center justify-center rounded-full px-5 text-sm font-medium transition-colors",
                aktivan ? "text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {CIKLUS_LABELA[c]}
            </button>
          );
        })}
      </div>

      {/* Visina se drži i na mesečnom, da kartice ispod ne poskoče pri promeni. */}
      <p className="h-4 text-xs font-medium text-accent-text">
        {vrednost === "year" ? GODISNJI_BONUS : ""}
      </p>
    </div>
  );
}

// ── kartica jednog plana ────────────────────────────────────

function KarticaPlana({
  tier,
  ciklus,
  gratisMesec,
  ceka,
  zakljucano,
  izabran,
  istaknut,
  naKlik,
}: {
  tier: Tier;
  ciklus: Ciklus;
  /** Pozivnica „prvi mesec gratis" — v. prop na `CenovnikEkran`. */
  gratisMesec: boolean;
  /** Ovo dugme čeka svoju sesiju. */
  ceka: boolean;
  /** Neko dugme čeka — ostala se gase da ne nastanu dve sesije. */
  zakljucano: boolean;
  /** Ovaj plan je stigao iz `?plan=` sa landinga. */
  izabran: boolean;
  /**
   * Ovaj plan nosi akcenat i primarno dugme.
   *
   * Bez namere je to `tier.featured` (Pro). Sa namerom je to IZABRAN plan —
   * §7.1 dozvoljava jedno primarno dugme po ekranu, a ono mora da bude ono
   * zbog kog je čovek došao, ne ono koje mi najviše prodajemo.
   */
  istaknut: boolean;
  naKlik: () => void;
}) {
  // Bedž je jedan po kartici i ne mogu oba: kad je plan izabran sa landinga,
  // „Tvoj izbor" ima prednost nad „Najčešći izbor".
  const oznaka = izabran ? "Tvoj izbor" : tier.featured ? "Najčešći izbor" : null;
  const eur = tier.cena[ciklus].eur;
  // Kupon je `once` na prvu fakturu — uz godišnji plan bi to bila godina, pa
  // ga checkout daje samo uz mesečni (v. rutu). Ekran kaže isto.
  const prviMesecGratis = gratisMesec && ciklus === "month";

  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-bg-elev p-6 shadow-card sm:p-7",
        // Istaknut plan se izdvaja linijom i blagim podizanjem, ne drugom bojom
        // podloge — §7.1: jedan akcenat, i on je rezervisan za jedno dugme.
        istaknut ? "border-border-accent lg:-mt-3 lg:pb-9" : "border-border",
      )}
    >
      {oznaka && (
        <span
          className={cn(
            "absolute -top-2.5 left-6 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            istaknut
              ? "bg-accent text-accent-ink"
              : "border border-border bg-bg-elev text-fg-muted",
          )}
        >
          {oznaka}
        </span>
      )}

      <h2 className="text-base font-semibold">{tier.name}</h2>
      {/* Fiksna visina za dva reda, da opis od jednog reda ne razbije poravnanje. */}
      <p className="mt-1.5 min-h-10 text-sm text-fg-muted">{tier.description}</p>

      <div className="mt-6 min-h-18">
        {prviMesecGratis ? (
          <>
            {/* Bedž PREKO cene (§9, pozivnica): €0 je ono što se sada plaća,
                a cifra ispod je ono što sledi — obe moraju da stoje. */}
            <span className="inline-flex items-center rounded-full bg-accent-wash px-2.5 py-1 text-xs font-semibold text-accent-text">
              Prvi mesec <span className="num ml-1">€0</span>
            </span>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="text-sm text-fg-muted">od drugog meseca</span>
              <span className="num text-2xl font-semibold tracking-tight">{formatEur(eur)}</span>
              <span className="text-sm text-fg-muted">/ {CIKLUS_SUFIKS[ciklus]}</span>
            </p>
          </>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              {/* Iz `plans.ts`, kroz `formatEur` — bez `Intl`, isti string na serveru i u pregledaču. */}
              <span className="num text-3xl font-semibold tracking-tight">{formatEur(eur)}</span>
              <span className="text-sm text-fg-muted">/ {CIKLUS_SUFIKS[ciklus]}</span>
            </p>
            {/* Visina reda se drži i na mesečnom, da kartice ne poskoče na prekidaču. */}
            <p className="mt-1 min-h-5 text-xs text-fg-muted">
              {ciklus === "year" && (
                <>
                  (<span className="num">{mesecnoOdGodisnje(eur)}</span> mesečno)
                  {gratisMesec && " · „Prvi mesec €0“ važi uz mesečno plaćanje"}
                </>
              )}
            </p>
          </>
        )}
      </div>

      <Button
        variant={istaknut ? "primary" : "secondary"}
        size="lg"
        className="mt-4 w-full"
        disabled={zakljucano}
        onClick={naKlik}
      >
        {ceka ? (
          <>
            <Loader2 className="animate-spin" />
            Otvaram plaćanje
          </>
        ) : (
          `Uzmi ${tier.name}`
        )}
      </Button>

      <ul className="mt-7 flex flex-col gap-2.5 text-sm">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" strokeWidth={2.25} />
            <span className="text-fg-muted">{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
