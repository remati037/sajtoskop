"use client";

// Okvir zaštićenog dela aplikacije: bočna traka, gornja traka, sadržaj.
//
// ── zašto je ovo jedna klijentska komponenta ──────────────────
// Skupljanje sidebar-a menja i širinu trake i levu marginu sadržaja. Da su to
// dve komponente, stanje bi moralo u kontekst ili u URL; ovako je jedan
// `useState` i jedan prelaz koji se dešava u istom kadru.
//
// Sadržaj stiže kao `children` iz serverskog layout-a, pa ništa od stranica ne
// prelazi u klijentski bundle.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { UserButton } from "@clerk/nextjs";
import { AlertTriangle, ChevronLeft, ChevronRight, Coins, Menu, ShieldCheck, X } from "lucide-react";
import { smeDaKupiPaket, type MotorStanje, type Pristup, type Uslovi } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { NAVIGACIJA, naslovZaPutanju, type NavStavka } from "@/lib/navigacija";
import { PrekidacTeme, PrekidacTemeDugme } from "./prekidac-teme";
import { PristupBaner } from "./pristup-baner";
import { PristupProvider } from "./pristup-provider";
import { UtisakDugme } from "./utisak-dugme";
import { UtisciProvider } from "./utisci-provider";
import { Znak, ZnakSaImenom } from "./znak";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

const SKUPLJEN_KLJUC = "sajtoskop-sidebar-skupljen";

type Props = {
  /** `null` znači da profil nije pročitan — v. `veza-greska.tsx`. */
  krediti: number | null;
  mesecniKrediti: number;
  /**
   * Tehnička poruka o kvaru veze sa bazom, ako ga ima. Prikazuje se kao traka
   * iznad sadržaja na SVAKOJ strani — kvar koji obara čitanje profila obara i
   * sve ostalo, pa je poruka na jednom mestu tačnija nego pet puta po stranama.
   */
  greska?: string | null;
  /**
   * Korisniku treba pokazati podsetnik za utisak (F10 §4.4). Računa se serverski,
   * iz profila koji `(app)/layout.tsx` ionako čita — bez ijednog dodatnog upita.
   */
  traziUtisak?: boolean;
  /**
   * Stanje motora pitanja (F11 §3). Od Faze 3 (3.6) dolazi kao `null` iz
   * layout-a, a `UtisciProvider` ga povlači klijentski posle prvog prikaza —
   * prvi bajt ne čeka na feedback upite.
   */
  stanjeUtisaka: MotorStanje | null;
  /**
   * Stanje naloga za kampanjska pitanja (F11 §2.3): dana od registracije,
   * otključanih, dužina pauze. Isti put kao `stanjeUtisaka` (3.6).
   */
  usloviUtisaka: Uslovi | null;
  /**
   * Prikazati ulaz u admin konzolu (F12). Računa se serverski, iz profila koji
   * layout ionako čita.
   *
   * Nije zaštita nego navigacija: `false` ovde znači samo da linka nema, a
   * `/admin` svakog neadmina i dalje dočekuje sa `404` iz same strane
   * (pravilo 13).
   */
  admin?: boolean;
  /**
   * Rešenih prijava koje korisnik nije pogledao (F11.4 §6.4). Nula = nema
   * tačke. Iz profila koji layout ionako čita — nijedan dodatan upit.
   */
  neprocitano?: number;
  /**
   * Stanje pristupa (S19, LANSIRANJE §1.5). `null` = nepoznato, tj. profil nije
   * pročitan — tada nema ni banera ni modala, a razlog stoji u `greska`.
   *
   * Izvedeno u layout-u kroz `stanjePristupa()`; ovde se samo prikazuje.
   */
  pristup?: Pristup | null;
  children: React.ReactNode;
};

export function OkvirAplikacije({
  krediti,
  mesecniKrediti,
  greska,
  traziUtisak = false,
  stanjeUtisaka,
  usloviUtisaka,
  admin = false,
  neprocitano = 0,
  pristup = null,
  children,
}: Props) {
  const putanja = usePathname();
  const [skupljen, setSkupljen] = useState(false);
  const [mobilni, setMobilni] = useState(false);

  useEffect(() => {
    try {
      setSkupljen(localStorage.getItem(SKUPLJEN_KLJUC) === "da");
    } catch {
      // Bez pamćenja — sidebar je prosto uvek raširen.
    }
  }, []);

  // Navigacija na telefonu mora sama da zatvori fioku, inače korisnik gleda
  // meni preko stranice na koju je upravo otišao.
  useEffect(() => setMobilni(false), [putanja]);

  function prebaci() {
    setSkupljen((prethodni) => {
      const sledeci = !prethodni;
      try {
        localStorage.setItem(SKUPLJEN_KLJUC, sledeci ? "da" : "ne");
      } catch {
        /* prazno */
      }
      return sledeci;
    });
  }

  return (
    <UtisciProvider stanje={stanjeUtisaka} uslovi={usloviUtisaka}>
      <PristupProvider pristup={pristup}>
      <TooltipProvider delayDuration={200}>
      {/* Blaga aura iza svega. Prazan ekran bez ovoga izgleda kao prazan list. */}
      <div aria-hidden className="pozadina-aure pointer-events-none fixed inset-0 -z-10 opacity-70" />

      {/* ── bočna traka, desktop ─────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-bg-subtle/85 backdrop-blur-xl transition-[width] duration-200 ease-out lg:flex",
          skupljen ? "w-[4.75rem]" : "w-64",
        )}
      >
        <SadrzajTrake
          skupljen={skupljen}
          putanja={putanja}
          krediti={krediti}
          mesecniKrediti={mesecniKrediti}
          admin={admin}
          smePaket={smeDaKupiPaket(pristup)}
        />

        {/* Dugme za skupljanje stoji na ivici trake, u visini zaglavlja, i tu
            ostaje u OBA stanja. Ranije je u skupljenom stanju padalo na dno,
            ispod kartice kredita — pa se traka skupljala jednim dugmetom, a
            širila drugim, 500 piksela niže. */}
        <button
          type="button"
          onClick={prebaci}
          aria-label={skupljen ? "Raširi bočnu traku" : "Skupi bočnu traku"}
          title={skupljen ? "Raširi bočnu traku" : "Skupi bočnu traku"}
          className="absolute -right-3 top-5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-bg-elev text-fg-muted shadow-sm transition-colors hover:border-fg-muted hover:text-fg"
        >
          {skupljen ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </aside>

      {/* ── bočna traka, telefon: fioka ──────────────────────── */}
      <DialogPrimitive.Root open={mobilni} onOpenChange={setMobilni}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm data-[state=open]:animate-pojavi lg:hidden" />
          <DialogPrimitive.Content
            aria-label="Navigacija"
            className="fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-border bg-bg-elev shadow-hero outline-none data-[state=open]:animate-uklizi lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Navigacija</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Zatvori meni"
              className="absolute right-3 top-3.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>

            <SadrzajTrake
              skupljen={false}
              putanja={putanja}
              krediti={krediti}
              mesecniKrediti={mesecniKrediti}
              admin={admin}
              smePaket={smeDaKupiPaket(pristup)}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* ── sadržaj ──────────────────────────────────────────── */}
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding-left] duration-200 ease-out",
          skupljen ? "lg:pl-[4.75rem]" : "lg:pl-64",
        )}
      >
        <header className="staklo sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMobilni(true)}
            aria-label="Otvori meni"
            className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">
              {naslovZaPutanju(putanja)}
            </p>
          </div>

          <Link
            href="/krediti"
            title="Krediti se troše na otključavanje prospekata"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border-strong bg-bg-elev px-3 text-xs shadow-sm transition-colors hover:border-fg-muted lg:hidden"
          >
            <Coins className="h-3.5 w-3.5 text-accent-text" />
            <span className="font-semibold num">{krediti ?? "—"}</span>
          </Link>

          <PrekidacTemeDugme className="lg:hidden" />

          <div className="ml-1 flex items-center">
            <UserButton />
          </div>
        </header>

        {greska && <TrakaKvara poruka={greska} />}

        {/* S19: traka stoji ISPOD trake kvara i IZNAD sadržaja. Redosled je
            namerno takav — pokvarena veza sa bazom je hitnija vest od isteklog
            roka, i uz nju stanje pristupa ionako nije pouzdano. */}
        <PristupBaner pristup={pristup} />

        {/* Donji razmak postoji zbog plutajućeg dugmeta: bez njega ono stoji
            preko poslednjeg reda tabele na kratkim ekranima. */}
        <main className="flex-1 pb-20">{children}</main>
      </div>

        {/* Dugme „Utisak" — na svakom ekranu unutar okvira, nikad na prijavi. */}
        <UtisakDugme traziUtisak={traziUtisak} neprocitano={neprocitano} />
      </TooltipProvider>
      </PristupProvider>
    </UtisciProvider>
  );
}

// ── sadržaj bočne trake ──────────────────────────────────────

function SadrzajTrake({
  skupljen,
  putanja,
  krediti,
  mesecniKrediti,
  admin,
  smePaket,
}: {
  skupljen: boolean;
  putanja: string;
  krediti: number | null;
  mesecniKrediti: number;
  admin: boolean;
  /** Sme li nalog da kupi paket — određuje kuda vodi poziv na dokupljivanje. */
  smePaket: boolean;
}) {
  return (
    <>
      {/* Desno je 0.75rem praznine i kad je traka raširena — tu stoji dugme sa
          ivice, pa logo ne sme da ide do kraja. */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-border",
          skupljen ? "justify-center px-0" : "px-4 pr-6",
        )}
      >
        <Link href="/pretraga" className="flex min-w-0 items-center rounded-lg">
          {skupljen ? <Znak /> : <ZnakSaImenom />}
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAVIGACIJA.map((grupa) => (
          <div key={grupa.naslov}>
            {!skupljen && (
              <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted/80">
                {grupa.naslov}
              </p>
            )}
            <ul className="space-y-1">
              {grupa.stavke.map((s) => (
                <li key={s.href}>
                  <NavLink stavka={s} putanja={putanja} skupljen={skupljen} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-3 border-t border-border p-3">
        {/* Ulaz u konzolu stoji ispod navigacije, odvojen od nje: to nije jedan
            od ekrana proizvoda nego izlazak iz njega. Vidi ga samo admin, i to
            je udobnost — brava je `requireAdminPage()` na svakoj strani
            konzole. */}
        {admin && <LinkKonzole skupljen={skupljen} />}

        <KarticaKredita
          krediti={krediti}
          mesecni={mesecniKrediti}
          skupljen={skupljen}
          smePaket={smePaket}
        />

        {skupljen ? (
          <div className="flex justify-center">
            <PrekidacTemeDugme />
          </div>
        ) : (
          <PrekidacTeme />
        )}
      </div>
    </>
  );
}

/**
 * Ulaz u admin konzolu — vidi ga samo admin (F12).
 *
 * Do sada se `/admin` otvarao isključivo ručnim kucanjem adrese, što nije bila
 * zaštita ni od koga: neadmin i sa tačnom adresom dobija `404` iz same strane.
 * Bilo je samo neudobno meni.
 *
 * Nije u `NAVIGACIJA` (`lib/navigacija.ts`) zato što taj spisak opisuje
 * proizvod, isti za svakog korisnika, a ovo je jedina stavka koja postoji za
 * jednog čoveka. Stoji uz prekidač teme, ispod grupa, i vizuelno je ghost —
 * nikad akcenat, da ne bi vuklo oko jače od „Pretrage".
 */
function LinkKonzole({ skupljen }: { skupljen: boolean }) {
  const link = (
    <Link
      href="/admin"
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg",
        skupljen && "justify-center px-0",
      )}
    >
      <ShieldCheck className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
      <span className={cn("truncate", skupljen && "sr-only")}>Admin konzola</span>
    </Link>
  );

  if (!skupljen) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        <span className="font-semibold">Admin konzola</span>
        <span className="ml-2 font-normal text-fg-muted">Korisnici, pozivnice, revizija</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Kvar veze sa bazom, ispisan a ne prećutan.
 *
 * Do sada je ovakav kvar rušio ceo `AppLayout` i korisnik je dobijao Next-ov
 * crveni ekran greške — dakle ni aplikaciju, ni objašnjenje. Sada aplikacija
 * radi koliko može, a poruka stoji ovde: doslovna tehnička rečenica iz baze,
 * plus prevod na jezik radnje koju treba preduzeti.
 *
 * Tekst greške se namerno prikazuje neizmenjen. Ovo je alat koji koristi njegov
 * autor — „nešto je pošlo naopako" bi ovde bilo gubljenje vremena.
 */
function TrakaKvara({ poruka }: { poruka: string }) {
  // Baš ova greška ima jedan konkretan uzrok i jedno konkretno rešenje, pa se
  // prepoznaje i imenuje. Sve ostalo ide kao golo `poruka`.
  const jeVeza = /suitable key|wrong key type|JWSError|JWT/i.test(poruka);

  return (
    <div className="border-b border-danger/30 bg-danger-wash px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 text-xs leading-relaxed">
          <p className="font-medium text-danger">Baza trenutno ne prepoznaje tvoj nalog.</p>
          <p className="mt-1 break-words text-fg-muted">
            <code className="num">{poruka}</code>
          </p>
          {jeVeza && (
            <p className="mt-1.5 text-fg-muted">
              Clerk nije registrovan kao Third-Party Auth provajder u Supabase-u (ili je
              registrovan sa drugim domenom). Krediti i otključani prospekti su netaknuti — samo
              se trenutno ne mogu pročitati.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NavLink({
  stavka,
  putanja,
  skupljen,
}: {
  stavka: NavStavka;
  putanja: string;
  skupljen: boolean;
}) {
  const aktivan = putanja === stavka.href || putanja.startsWith(`${stavka.href}/`);
  const { Ikona } = stavka;

  const link = (
    <Link
      href={stavka.href}
      aria-current={aktivan ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
        skupljen && "justify-center px-0",
        aktivan
          ? "bg-accent-wash text-accent-text"
          : "text-fg-muted hover:bg-bg-hover hover:text-fg",
      )}
    >
      {/* Tanka šipka levo — aktivna stavka se prepoznaje i periferno, bez čitanja. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity",
          aktivan ? "opacity-100" : "opacity-0",
        )}
      />
      <Ikona
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          aktivan ? "text-accent-text" : "text-fg-muted group-hover:text-fg",
        )}
        strokeWidth={2}
      />
      {/* Skupljena traka ostaje samo ikonica, ali ime mora da postoji za čitač
          ekrana — inače je cela navigacija pet nenaslovljenih linkova. */}
      <span className={cn("truncate", skupljen && "sr-only")}>{stavka.label}</span>
    </Link>
  );

  if (!skupljen) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        <span className="font-semibold">{stavka.label}</span>
        <span className="ml-2 font-normal text-fg-muted">{stavka.opis}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Kad se pali poziv na dokupljivanje (S21).
 *
 * Prag je relativan pa apsolutan: desetina mesečne dodele, ali nikad ispod tri.
 * Advanced nalog sa 800 kredita bi na fiksnom pragu od 5 dobio poziv tek kad je
 * već sve stalo, a nalog bez plana (`dopuna`, `mesecni = 0`) bi ga na čisto
 * relativnom pragu dobijao uvek — i onda kad ima 150 kupljenih kredita.
 *
 * `null` (kvar veze) NIJE nisko stanje: ponuda da se kupi nešto zato što se
 * balans nije pročitao je najgori mogući oblik ovog dugmeta.
 */
function niskoStanje(krediti: number | null, mesecni: number): boolean {
  if (krediti === null) return false;
  return krediti <= Math.max(3, Math.ceil(mesecni * 0.1));
}

/**
 * Balans kredita (F4 §4: uvek vidljiv).
 *
 * Traka pokazuje koliko je od mesečne dodele ostalo — broj bez konteksta ne
 * govori ništa. Skupljen sidebar zadržava broj, jer je to jedini podatak koji
 * korisnik proverava između dva otključavanja.
 *
 * ‼️ `krediti` je ZBIR obe kase (`credits_balance + credits_topup`), isto kao
 *    na `/pretraga` i u `/api/search`. Prikazivati samo kasu koja ističe znači
 *    da korisnik koji je kupio paket vidi manji broj nego što mu se naplaćuje —
 *    a razlaz između prikazanog i naplaćenog stanja je najskuplja vrsta greške
 *    u ovom proizvodu.
 *
 * Traka se crta samo kad mesečna dodela postoji. Nalog bez plana (`dopuna`) ima
 * `mesecni = 0`, pa bi traka stajala na nuli i sa punim novčanikom kupljenih
 * kredita — dakle lagala bi u trenutku kad je čovek upravo platio.
 */
function KarticaKredita({
  krediti,
  mesecni,
  skupljen,
  smePaket,
}: {
  krediti: number | null;
  mesecni: number;
  skupljen: boolean;
  smePaket: boolean;
}) {
  const imaDodelu = mesecni > 0;
  const procenat =
    krediti === null || !imaDodelu ? 0 : Math.min(100, Math.round((krediti / mesecni) * 100));
  const nisko = niskoStanje(krediti, mesecni);
  // Od 26.8. paket traži aktivan plan ili betu, pa poziv na akciju mora da vodi
  // tamo gde nalog stvarno može nešto da uradi — inače je to link do odbijenice.
  const cilj = smePaket ? "/cenovnik#paketi" : "/cenovnik";

  if (skupljen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={nisko ? cilj : "/krediti"}
            className="flex flex-col items-center gap-0.5 rounded-lg border border-border-strong bg-bg-elev py-2 text-center transition-colors hover:border-fg-muted"
          >
            <Coins className={cn("h-4 w-4", nisko ? "text-warn-text" : "text-accent-text")} />
            <span className="text-xs font-semibold num">{krediti ?? "—"}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {nisko
            ? `Ostalo ti je ${krediti ?? "—"} kredita — ${smePaket ? "dokupi" : "uzmi plan"}`
            : imaDodelu
              ? `${krediti ?? "—"} od ${mesecni} kredita`
              : `${krediti ?? "—"} kredita, bez roka`}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="rounded-xl border border-border-strong bg-bg-elev shadow-sm">
      <Link
        href="/krediti"
        title="Krediti se troše na otključavanje prospekata i na skeniranje"
        className="block rounded-xl p-3 transition-colors hover:bg-bg-hover"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <Coins className={cn("h-3.5 w-3.5", nisko ? "text-warn-text" : "text-accent-text")} />
            Krediti
          </span>
          <span className="text-sm font-semibold num">
            {krediti ?? "—"}
            {imaDodelu && <span className="text-xs font-normal text-fg-muted">/{mesecni}</span>}
          </span>
        </div>

        {imaDodelu && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-inset">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                nisko ? "bg-warn" : "bg-accent",
              )}
              style={{ width: `${procenat}%` }}
            />
          </div>
        )}

        <p className="mt-2 text-[11px] leading-tight text-fg-muted">
          {imaDodelu
            ? "Obnavlja se prvog u mesecu. Keš je besplatan, novo skeniranje 1–3 kredita po dubini."
            : "Kupljeni krediti ne ističu. Keš je besplatan, novo skeniranje 1–3 kredita po dubini."}
        </p>
      </Link>

      {/* S21: poziv na akciju kad stanje padne nisko. Odvojen link, ne dugme —
          §7.1 daje jedno primarno dugme po ekranu, a bočna traka stoji preko
          SVIH ekrana i njeno dugme bi se tuklo sa primarnim dugmetom svakog od
          njih. Pojavljuje se tek kad je stvarno nisko, inače je stalna reklama. */}
      {nisko && (
        <Link
          href={cilj}
          className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] font-medium text-accent-text transition-colors hover:bg-bg-hover"
        >
          {smePaket ? "Dokupi kredite" : "Uzmi plan"}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
