"use client";

// apps/web/src/components/cenovnik-ekran.tsx
// Ekran cena: tri plana, prekidač mesečno/godišnje i overlay checkout.
//
// ── odakle dolazi cifra ─────────────────────────────────────
// Isključivo iz Paddle-a, kroz `PricePreview()`, kao `formattedTotals.total` —
// gotov string („€29.00", „€1,190.00"), u valuti posetioca i sa porezom njegove
// zemlje. Ovde se ne množi, ne deli, ne zaokružuje i ne prepakuje kroz
// `Intl.NumberFormat`. Paddle je već formatirao; drugo formatiranje bi bilo
// duplo (npr. „€€29,00") i, još gore, mogla bi da ispadne druga cifra od one
// koja se naplaćuje.
//
// Nemački posetilac vidi €29.00 sa uračunatih 19% PDV-a, srpski €29.00 bez
// poreza, i to je ISTI `pri_` ID. Zato u `lib/cenovnik.ts` nema nijednog iznosa.
//
// ── jedan poziv, ne šest ────────────────────────────────────
// `PricePreview()` prima svih šest cena odjednom, pa prekidač mesečno/godišnje
// ne pravi nikakav mrežni saobraćaj — obe cifre su već tu. Ponovo se poziva samo
// kad se promeni zemlja.
//
// ── šta je promenio S18 ─────────────────────────────────────
// Checkout se više ne otvara sa `items`, nego sa `transactionId` koji napravi
// `/api/billing/checkout`. Razlog je jedan i nepregovarljiv: transakcija mora da
// nosi `custom_data.user_id`, a taj ID sme da dođe samo iz serverske Clerk
// sesije (pravilo 8). Posledice koje se vide u ovom fajlu:
//
//   · `customer: { email }` je otpao — kupca određuje transakcija, ne pregledač.
//     Mejl za prijavljenog korisnika ionako više nije potreban: vezivanje ide po
//     `user_id`, pa kupovina sa druge adrese završi na pravom nalogu.
//   · gost više ne može da otvori checkout. Bez sesije nema `user_id`, dakle
//     nema čime da se poveže ono što plati — pa dugme vodi na registraciju sa
//     povratkom ovamo.
//   · svako dugme ima svoje stanje čekanja: između klika i otvaranja modala
//     stoji jedan mrežni poziv ka nama, pa ekran ne sme da izgleda mrtvo.
//
// ── šta je promenio S24 ─────────────────────────────────────
// Ekran prima NAMERU sa landinga (`?plan=`, `?ciklus=`, `?paket=` — §1.7).
// Posledice:
//
//   · prekidač kreće od ciklusa iz linka, ne uvek od „Mesečno";
//   · izabran plan je onaj koji nosi akcenat, primarno dugme i bedž „Tvoj
//     izbor" — a ne više uvek Pro. Jedan akcenat po ekranu ostaje (§7.1);
//   · `?paket=` doskroluje do sekcije paketa i istakne baš taj paket;
//   · put za gosta nosi njegov izbor: `?nazad=/cenovnik?plan=pro&ciklus=…`,
//     pa se posle registracije ne bira ponovo.
//
// ‼️ Checkout se NAMERNO ne otvara sam na osnovu `?plan=`. Modal za plaćanje
//    koji iskoči bez klika je i UX koji se ne traži i Paddle transakcija po
//    svakom učitavanju strane — uključujući osvežavanje, „nazad" iz istorije i
//    svakog bota koji otvori link. Namera preselektuje; klik ostaje čovekov.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  initializePaddle,
  type Paddle,
  type PricePreviewParams,
  type PricePreviewResponse,
} from "@paddle/paddle-js";
import { Check, Coins, Infinity as Beskonacno, Loader2, Lock, TriangleAlert } from "lucide-react";
import {
  CIKLUS_LABELA,
  CIKLUS_SUFIKS,
  CIKLUSI,
  GODISNJI_BONUS,
  PAKETI,
  SVI_PRICE_ID,
  TIERS,
  type Ciklus,
  type Paket,
  type Tier,
} from "@/lib/cenovnik";
import type { PaketId } from "@sajtoskop/shared";
import {
  naRegistraciju,
  putanjaZaPaket,
  putanjaZaPlan,
  type Namera,
} from "@/lib/cenovnik-namera";
import { paddleKonfig } from "@/lib/paddle-okruzenje";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useTema } from "@/components/tema-provider";

/** `pri_…` → gotov, formatiran iznos iz Paddle-a. */
type Cene = Record<string, string>;

type Stanje = "ucitavanje" | "spremno" | "greska";

/**
 * Gde gost ide sa dugmeta „Uzmi plan" kad nemamo ništa konkretnije.
 *
 * Od S24 se svaki klik vraća na SVOJ izbor (v. `naRegistraciju()` iz
 * `lib/cenovnik-namera.ts`); ovo je rezerva za slučaj kad se sesija izgubi pre
 * nego što se zna šta je kliknuto.
 */
const NA_REGISTRACIJU = naRegistraciju("/cenovnik");

export function CenovnikEkran({
  drzava,
  prijavljen,
  smePaket,
  namera,
}: {
  /**
   * ISO 3166-1 alpha-2, izveden na serveru iz `x-vercel-ip-country`.
   *
   * `null` znači „ne znamo" i tada se `address` NE šalje — Paddle tada sam
   * pogodi zemlju po IP-u posetioca, što je tačnije od bilo koje naše
   * pretpostavke. Nema izmišljene vrednosti tipa „OTHERS": Paddle ne poznaje
   * takvu zemlju i odbio bi poziv.
   */
  drzava: string | null;
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
}) {
  const { tema } = useTema();
  // Ciklus iz linka je POČETNA vrednost, ne zaključana: prekidač ostaje živ i
  // čovek koji je sa landinga stigao na „godišnje" sme da se predomisli.
  const [ciklus, setCiklus] = useState<Ciklus>(namera.ciklus ?? "month");
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [cene, setCene] = useState<Cene>({});
  const [stanje, setStanje] = useState<Stanje>("ucitavanje");
  const [greska, setGreska] = useState<string | null>(null);
  /** `pri_` čije se dugme trenutno čeka. Jedan po ekranu — modal je jedan. */
  const [uToku, setUToku] = useState<string | null>(null);

  // ── 1. podizanje Paddle.js-a ──────────────────────────────
  useEffect(() => {
    let otkazano = false;

    // `paddleKonfig()` baca kad env nije podešen ili kad se token i okruženje ne
    // poklapaju. Hvata se ovde, a ne pušta uz stranu: neispravno podešen Paddle
    // treba da da poruku na ekranu cena, ne Next-ov crveni ekran preko svega.
    let konfig;
    try {
      konfig = paddleKonfig();
    } catch (err) {
      console.error("[cenovnik]", err);
      setGreska(err instanceof Error ? err.message : String(err));
      setStanje("greska");
      return;
    }

    initializePaddle({
      token: konfig.token,
      environment: konfig.okruzenje,
      eventCallback: (dogadjaj) => {
        // Greška u samom checkout-u ne stiže kao odbijeno obećanje nego kao
        // događaj — bez ovoga modal prosto ostane prazan i niko ne sazna zašto.
        if (dogadjaj.name === "checkout.error") {
          console.error("[cenovnik] checkout.error:", dogadjaj.data);
        }
      },
    })
      .then((p) => {
        if (otkazano) return;
        if (!p) throw new Error("Paddle.js se nije podigao.");
        setPaddle(p);
      })
      .catch((err: unknown) => {
        if (otkazano) return;
        console.error("[cenovnik] initializePaddle:", err);
        setGreska("Naplata trenutno nije dostupna.");
        setStanje("greska");
      });

    return () => {
      otkazano = true;
    };
  }, []);

  // ── 2. cene ───────────────────────────────────────────────
  useEffect(() => {
    if (!paddle) return;
    let otkazano = false;

    const parametri: PricePreviewParams = {
      items: SVI_PRICE_ID.map((priceId) => ({ priceId, quantity: 1 })),
      // Bez `address` kad zemlja nije poznata — v. komentar uz prop.
      ...(drzava ? { address: { countryCode: drzava } } : {}),
    };

    setStanje("ucitavanje");

    paddle
      .PricePreview(parametri)
      .then((odgovor: PricePreviewResponse) => {
        if (otkazano) return;
        const sledece: Cene = {};
        for (const stavka of odgovor.data.details.lineItems) {
          sledece[stavka.price.id] = stavka.formattedTotals.total;
        }
        setCene(sledece);
        setStanje("spremno");
      })
      .catch((err: unknown) => {
        if (otkazano) return;
        console.error("[cenovnik] PricePreview:", err);
        setGreska("Cene se trenutno ne mogu učitati.");
        setStanje("greska");
      });

    return () => {
      otkazano = true;
    };
  }, [paddle, drzava]);

  // ── 3. checkout ───────────────────────────────────────────
  // Prima `pri_`, ne plan: od S21 isto dugme otvara i pretplatu i paket
  // kredita. Razliku zna server — `/api/billing/checkout` je izvodi iz kataloga
  // (`kupovinaZaPriceId`), a ne iz onoga što je pregledač poslao.
  const otvoriCheckout = useCallback(
    async (priceId: string, nazad?: string) => {
      if (!paddle || uToku) return;

      // Gost: nema `user_id`, pa nema ni čime da se poveže kupovina. Umesto
      // checkout-a koji bi primio novac bez naloga — registracija, pa nazad.
      //
      // Od S24 `nazad` nosi TAČNO ono što je kliknuto, pa se posle registracije
      // ne bira ponovo. Putanju i dalje proverava server (`internaPutanja()`).
      if (!prijavljen) {
        window.location.href = nazad ? naRegistraciju(nazad) : NA_REGISTRACIJU;
        return;
      }

      setUToku(priceId);
      setGreska(null);

      try {
        const odgovor = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priceId }),
        });

        if (odgovor.status === 401) {
          // Sesija je istekla između učitavanja strane i klika.
          window.location.href = nazad ? naRegistraciju(nazad) : NA_REGISTRACIJU;
          return;
        }

        const telo = (await odgovor.json().catch(() => ({}))) as {
          transactionId?: string;
          greska?: string;
        };

        if (!odgovor.ok || !telo.transactionId) {
          throw new Error(telo.greska ?? `HTTP ${odgovor.status}`);
        }

        paddle.Checkout.open({
          // Transakciju je napravio server i ona već nosi `custom_data.user_id`,
          // izabranu cenu i — za beta nalog — popust. Stavke se ovde više ne
          // šalju: uz `transactionId` bi bile drugi izvor istine o tome šta se
          // kupuje, a Paddle ih ionako ne bi uzeo u obzir.
          transactionId: telo.transactionId,
          settings: {
            displayMode: "overlay",
            variant: "one-page",
            // Modal prati temu aplikacije. Bez ovoga tamna strana dobije beo
            // pravougaonik preko sebe.
            theme: tema === "tamna" ? "dark" : "light",
            // Apsolutan URL, sklopljen u pregledaču: radi i na localhost-u i na
            // domenu, bez još jedne env promenljive koja ume da se ne postavi.
            //
            // ‼️ Ovo je samo UX. Pretplata se NE upisuje odavde — korisnik ume
            //    da zatvori tab pre redirekcije. Izvor istine je webhook.
            successUrl: `${window.location.origin}/welcome`,
          },
        });
      } catch (err) {
        console.error("[cenovnik] checkout:", err);
        setGreska("Plaćanje se trenutno ne može otvoriti.");
      } finally {
        setUToku(null);
      }
    },
    [paddle, prijavljen, tema, uToku],
  );

  const spremno = stanje === "spremno" && paddle !== null;

  return (
    <div>
      <PrekidacCiklusa vrednost={ciklus} promeni={setCiklus} />

      {greska && (
        <p
          role="alert"
          className="mx-auto mt-8 flex max-w-xl items-start gap-2.5 rounded-xl border border-border bg-bg-elev px-4 py-3 text-sm text-fg-muted shadow-sm"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-text" />
          <span>
            <span className="font-medium text-fg">{greska}</span>{" "}
            {/* Duža rečenica ima smisla samo kad je pao PricePreview — tada
                kartice stoje bez cifara. Kad je pao checkout, cene se vide i
                „planovi se i dalje vide" bi zvučalo kao da niko ne čita ekran. */}
            {stanje === "greska"
              ? "Planovi i pogodnosti se i dalje vide, ali cena i plaćanje trenutno ne rade."
              : ""}{" "}
            Pokušaj za koji minut ili mi se javi na{" "}
            <a
              href="mailto:podrska@sajtoskop.com"
              className="font-medium text-accent-text underline underline-offset-4"
            >
              podrska@sajtoskop.com
            </a>
            .
          </span>
        </p>
      )}

      <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
        {TIERS.map((tier) => (
          <KarticaPlana
            key={tier.name}
            tier={tier}
            ciklus={ciklus}
            cena={cene[tier.priceId[ciklus]]}
            spremno={spremno}
            ceka={uToku === tier.priceId[ciklus]}
            zakljucano={uToku !== null}
            // Namera sa landinga pomera akcenat: izabran plan dobija primarno
            // dugme i bedž, a Pro ostaje običan. Bez namere sve je kao pre.
            izabran={namera.plan === tier.id}
            istaknut={namera.plan ? namera.plan === tier.id : tier.featured === true}
            naKlik={() =>
              void otvoriCheckout(tier.priceId[ciklus], putanjaZaPlan(tier.id, ciklus))
            }
          />
        ))}
      </div>

      <SekcijaPaketa
        cene={cene}
        spremno={spremno}
        uToku={uToku}
        smePaket={smePaket}
        prijavljen={prijavljen}
        izabran={namera.paket}
        naKlik={(priceId, nazad) => void otvoriCheckout(priceId, nazad)}
      />

      <p className="mt-8 text-center text-xs text-fg-muted">
        Cene su za tvoju zemlju i uključuju porez tamo gde se on obračunava. Naplatu vodi Paddle
        kao prodavac od koga kupuješ (Merchant of Record) — račun i PDV stižu od njih.
      </p>
    </div>
  );
}

// ── paketi kredita ──────────────────────────────────────────
// LANSIRANJE §1.4, izmenjen 26.8.: paket je DOPUNA uz postojeći pristup, ne
// ulaz u proizvod. Kupuju ga `aktivan`, `otkazan` i `beta` (v. `smeDaKupiPaket`
// u shared paketu); svi ostali, uključujući gosta, vide sekciju ali sa
// objašnjenjem umesto dugmeta.
//
// ── zašto se sekcija i dalje VIDI onome ko ne sme ───────────
// Sakriti je značilo bi da posetilac ne zna da paketi postoje, pa ni da mu se
// otključavaju uz plan — a to je razlog više da uzme plan, ne manje. Skrivena
// ponuda ne prodaje ništa; zaključana ponuda sa jednom rečenicom objašnjenja
// prodaje plan iznad sebe.
//
// Sekundaran blok, namerno DRUGAČIJEG oblika od tri kartice
// iznad: da su paketi četvrta i peta kartica u istom redu, čitali bi se kao
// jeftiniji planovi — a oni su po kreditu SKUPLJI od svakog plana, i to je
// cela poenta ponude. Zato jedna površina (`--bg-subtle`), dva reda unutar nje,
// i dugmad koja nisu primarna: §7.1 daje jedno primarno dugme po ekranu, a ono
// je gore, na istaknutom planu.

function SekcijaPaketa({
  cene,
  spremno,
  uToku,
  smePaket,
  prijavljen,
  izabran,
  naKlik,
}: {
  cene: Cene;
  spremno: boolean;
  uToku: string | null;
  smePaket: boolean;
  prijavljen: boolean;
  /** Paket iz `?paket=` na landingu, ili `null`. */
  izabran: PaketId | null;
  naKlik: (priceId: string, nazad: string) => void;
}) {
  const okvir = useRef<HTMLElement | null>(null);

  // `?paket=150` nema `#paketi` u sebi kad se sklopi bez sidra (npr. sa starijeg
  // dugmeta na landingu), pa sekcija mora sama da se dovede u vidno polje —
  // inače čovek stigne na vrh cenovnika i ne vidi ono zbog čega je došao.
  // Jednom, i samo ako pregledač nije već odskrolovao po sidru.
  useEffect(() => {
    if (!izabran || window.location.hash === "#paketi") return;
    okvir.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [izabran]);

  return (
    // `id` je odredište linkova `/cenovnik#paketi` iz modala pristupa i sa
    // strane `/zakljucano` — oni postoje od S19 i do S21 nisu vodili nikuda.
    // `scroll-mt` postoji jer strana ima lepljivo zaglavlje na `/` putanjama;
    // bez njega sidro završi tačno ispod njega.
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

          <p className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-bg-elev px-3 py-2 text-xs font-medium text-fg-muted">
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
              cena={cene[paket.priceId]}
              spremno={spremno}
              ceka={uToku === paket.priceId}
              zakljucano={uToku !== null}
              smePaket={smePaket}
              prijavljen={prijavljen}
              izabran={izabran === paket.id}
              naKlik={() => naKlik(paket.priceId, putanjaZaPaket(paket.id))}
            />
          ))}
        </div>

        {/* Dve rečenice koje moraju da stoje, i to ovim redom:
            1. paket NIJE jeftinija zamena za plan — po kreditu je skuplji;
            2. paket TRAŽI plan ili betu (odluka 26.8.).
            Bez prve, paket kanibalizuje pretplatu i cenovnik laže o tome šta je
            povoljnije. Bez druge, neko kupi plan očekujući da mu paket sam po
            sebi produžava pristup — pa se to otkrije tek kad plan istekne. */}
        <div className="mt-6 space-y-2 border-t border-border pt-5 text-xs leading-relaxed text-fg-muted">
          <p>
            <strong className="font-semibold text-fg">Paket nije zamena za plan.</strong> Po
            kreditu je skuplji od svake pretplate — ko radi redovno, prolazi jeftinije sa planom.
            Paket je tu za mesec u kome posao krene jače nego što je plan predviđao.
          </p>
          <p>
            <strong className="font-semibold text-fg">Paket traži aktivan plan ili betu.</strong>{" "}
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
  cena,
  spremno,
  ceka,
  zakljucano,
  smePaket,
  prijavljen,
  izabran,
  naKlik,
}: {
  paket: Paket;
  cena: string | undefined;
  spremno: boolean;
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
    // elementu i zabranjuje kartice u karticama. Razdvaja je podloga i linija.
    // Izbor sa landinga se označava LINIJOM, ne drugom podlogom — akcenat na
    // ekranu ostaje jedan i on je gore, na dugmetu istaknutog plana (§7.1).
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
        {cena ? (
          <>
            {/* Isti gotov string iz Paddle-a kao na planovima — v. vrh fajla. */}
            <span className="num text-2xl font-semibold tracking-tight">{cena}</span>
            <span className="text-xs text-fg-muted">jednokratno</span>
          </>
        ) : (
          <span aria-hidden className="h-7 w-24 animate-puls-tanko rounded-lg bg-bg-inset" />
        )}
        <span className="sr-only">{cena ? "" : "Cena se učitava"}</span>
      </div>

      {/* Ko ne sme, ne dobija ugašeno dugme nego rečenicu i put dalje.
          Ugašeno dugme ne kaže ZAŠTO je ugašeno, pa ostavlja čoveka da nagađa
          je li kvar ili pravilo — a ovde je pravilo, i ono vodi na plan iznad. */}
      {smePaket ? (
        <Button
          variant="secondary"
          className="mt-4 w-full"
          disabled={!spremno || !cena || zakljucano}
          onClick={naKlik}
        >
          {ceka ? (
            <>
              <Loader2 className="animate-spin" />
              Otvaram plaćanje
            </>
          ) : spremno && cena ? (
            `Uzmi ${paket.name}`
          ) : (
            <>
              <Loader2 className="animate-spin" />
              Učitavanje
            </>
          )}
        </Button>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-bg-subtle px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
          <span>
            {prijavljen
              ? "Otključava se čim uzmeš plan ili dobiješ betu."
              : "Dostupno uz aktivan plan ili betu — uzmi plan iznad."}
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
        // Sa dva polja obe strelice rade isto — prebace na ono drugo. Nema
        // modula ni indeksiranja: kraće je i ne može da promaši niz.
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
  cena,
  spremno,
  ceka,
  zakljucano,
  izabran,
  istaknut,
  naKlik,
}: {
  tier: Tier;
  ciklus: Ciklus;
  cena: string | undefined;
  spremno: boolean;
  /** Ovo dugme čeka svoju transakciju. */
  ceka: boolean;
  /** Neko dugme čeka — ostala se gase da ne nastanu dve transakcije. */
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
  // „Tvoj izbor" ima prednost nad „Najčešći izbor" — potvrda onoga što je čovek
  // već uradio je korisnija od naše preporuke.
  const oznaka = izabran ? "Tvoj izbor" : tier.featured ? "Najčešći izbor" : null;

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
            // Bedž neistaknutog plana (Pro kad je izabran neko drugi) ne sme da
            // nosi punu zelenu podlogu — to bi bio drugi akcenat na ekranu.
            istaknut
              ? "bg-accent text-accent-ink"
              : "border border-border bg-bg-elev text-fg-muted",
          )}
        >
          {oznaka}
        </span>
      )}

      <h2 className="text-base font-semibold">{tier.name}</h2>
      {/* Fiksna visina za dva reda: `description` se menja iz `lib/cenovnik.ts`,
          a opis od jednog reda bi inače podigao cenu i dugme te kartice i
          razbio poravnanje u redu od tri kartice. */}
      <p className="mt-1.5 min-h-[2.5rem] text-sm text-fg-muted">{tier.description}</p>

      <div className="mt-6 flex min-h-[2.75rem] items-baseline gap-1.5">
        {cena ? (
          <>
            {/* Gotov string iz Paddle-a. Ništa se ne računa i ne preformatira. */}
            <span className="num text-3xl font-semibold tracking-tight">{cena}</span>
            <span className="text-sm text-fg-muted">/ {CIKLUS_SUFIKS[ciklus]}</span>
          </>
        ) : (
          <span
            aria-hidden
            className="h-8 w-28 animate-puls-tanko rounded-lg bg-bg-inset"
          />
        )}
        <span className="sr-only">{cena ? "" : "Cena se učitava"}</span>
      </div>

      <Button
        variant={istaknut ? "primary" : "secondary"}
        size="lg"
        className="mt-6 w-full"
        disabled={!spremno || !cena || zakljucano}
        onClick={naKlik}
      >
        {ceka ? (
          <>
            <Loader2 className="animate-spin" />
            Otvaram plaćanje
          </>
        ) : spremno && cena ? (
          `Uzmi ${tier.name}`
        ) : (
          <>
            <Loader2 className="animate-spin" />
            Učitavanje
          </>
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
