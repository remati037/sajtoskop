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

import { useCallback, useEffect, useState } from "react";
import {
  initializePaddle,
  type Paddle,
  type PricePreviewParams,
  type PricePreviewResponse,
} from "@paddle/paddle-js";
import { Check, Coins, Infinity as Beskonacno, Loader2, TriangleAlert } from "lucide-react";
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
import { paddleKonfig } from "@/lib/paddle-okruzenje";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useTema } from "@/components/tema-provider";

/** `pri_…` → gotov, formatiran iznos iz Paddle-a. */
type Cene = Record<string, string>;

type Stanje = "ucitavanje" | "spremno" | "greska";

/**
 * Gde gost ide sa dugmeta „Uzmi plan".
 *
 * `/registracija` je redirekcija na `/?nalog=nov`, pa se ide direktno na cilj;
 * `nazad` je putanja na koju Clerk vraća posle ulaska. Vrednost se na serveru
 * proverava (mora biti interna putanja) — v. `app/page.tsx`.
 */
const NA_REGISTRACIJU = "/?nalog=nov&nazad=%2Fcenovnik";

export function CenovnikEkran({
  drzava,
  prijavljen,
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
}) {
  const { tema } = useTema();
  const [ciklus, setCiklus] = useState<Ciklus>("month");
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
    async (priceId: string) => {
      if (!paddle || uToku) return;

      // Gost: nema `user_id`, pa nema ni čime da se poveže kupovina. Umesto
      // checkout-a koji bi primio novac bez naloga — registracija, pa nazad.
      if (!prijavljen) {
        window.location.href = NA_REGISTRACIJU;
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
          window.location.href = NA_REGISTRACIJU;
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
            naKlik={() => void otvoriCheckout(tier.priceId[ciklus])}
          />
        ))}
      </div>

      <SekcijaPaketa
        cene={cene}
        spremno={spremno}
        uToku={uToku}
        naKlik={(priceId) => void otvoriCheckout(priceId)}
      />

      <p className="mt-8 text-center text-xs text-fg-muted">
        Cene su za tvoju zemlju i uključuju porez tamo gde se on obračunava. Naplatu vodi Paddle
        kao prodavac od koga kupuješ (Merchant of Record) — račun i PDV stižu od njih.
      </p>
    </div>
  );
}

// ── paketi kredita ──────────────────────────────────────────
// LANSIRANJE §1.4. Sekundaran blok, namerno DRUGAČIJEG oblika od tri kartice
// iznad: da su paketi četvrta i peta kartica u istom redu, čitali bi se kao
// jeftiniji planovi — a oni su po kreditu SKUPLJI od svakog plana, i to je
// cela poenta ponude. Zato jedna površina (`--bg-subtle`), dva reda unutar nje,
// i dugmad koja nisu primarna: §7.1 daje jedno primarno dugme po ekranu, a ono
// je gore, na istaknutom planu.

function SekcijaPaketa({
  cene,
  spremno,
  uToku,
  naKlik,
}: {
  cene: Cene;
  spremno: boolean;
  uToku: string | null;
  naKlik: (priceId: string) => void;
}) {
  return (
    // `id` je odredište linkova `/cenovnik#paketi` iz modala pristupa i sa
    // strane `/zakljucano` — oni postoje od S19 i do S21 nisu vodili nikuda.
    // `scroll-mt` postoji jer strana ima lepljivo zaglavlje na `/` putanjama;
    // bez njega sidro završi tačno ispod njega.
    <section id="paketi" className="mt-14 scroll-mt-24 sm:mt-16">
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
            <Beskonacno className="h-3.5 w-3.5 text-accent-text" aria-hidden />
            Bez roka trajanja
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
              naKlik={() => naKlik(paket.priceId)}
            />
          ))}
        </div>

        {/* Dve rečenice koje moraju da stoje, i to ovim redom (§1.4):
            1. paket NIJE jeftinija zamena za plan — po kreditu je skuplji;
            2. paket se sme kupiti i BEZ pretplate, i to je podržan slučaj.
            Bez prve, paket kanibalizuje pretplatu i cenovnik laže o tome šta je
            povoljnije. Bez druge, beta korisnik koji neće mesečnu karticu misli
            da za njega nema izlaza. */}
        <div className="mt-6 space-y-2 border-t border-border pt-5 text-xs leading-relaxed text-fg-muted">
          <p>
            <strong className="font-semibold text-fg">Paket nije zamena za plan.</strong> Po
            kreditu je skuplji od svake pretplate — ko radi redovno, prolazi jeftinije sa planom.
            Paket je tu za povremenu potrebu i za mesec u kome posao krene jače nego što je plan
            predviđao.
          </p>
          <p>
            <strong className="font-semibold text-fg">Pretplata nije uslov.</strong> Paket se
            kupuje i bez plana; krediti iz njega sami vraćaju pun pristup aplikaciji, sa Starter
            dnevnim limitima.
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
  naKlik,
}: {
  paket: Paket;
  cena: string | undefined;
  spremno: boolean;
  ceka: boolean;
  zakljucano: boolean;
  naKlik: () => void;
}) {
  return (
    // Bez `shadow`: kartica stoji UNUTAR panela, a §7.2 traži jednu senku po
    // elementu i zabranjuje kartice u karticama. Razdvaja je podloga i linija.
    <div className="flex flex-col rounded-xl border border-border bg-bg-elev p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{paket.name}</h3>
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
  naKlik: () => void;
}) {
  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-bg-elev p-6 shadow-card sm:p-7",
        // Istaknut plan se izdvaja linijom i blagim podizanjem, ne drugom bojom
        // podloge — §7.1: jedan akcenat, i on je rezervisan za jedno dugme.
        tier.featured ? "border-border-accent lg:-mt-3 lg:pb-9" : "border-border",
      )}
    >
      {tier.featured && (
        <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-accent-ink">
          Najčešći izbor
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
        variant={tier.featured ? "primary" : "secondary"}
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
