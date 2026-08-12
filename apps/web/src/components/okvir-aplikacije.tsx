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
import { AlertTriangle, ChevronLeft, ChevronRight, Coins, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { NAVIGACIJA, naslovZaPutanju, type NavStavka } from "@/lib/navigacija";
import { PrekidacTeme, PrekidacTemeDugme } from "./prekidac-teme";
import { UtisakDugme } from "./utisak-dugme";
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
  children: React.ReactNode;
};

export function OkvirAplikacije({
  krediti,
  mesecniKrediti,
  greska,
  traziUtisak = false,
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

        {/* Donji razmak postoji zbog plutajućeg dugmeta: bez njega ono stoji
            preko poslednjeg reda tabele na kratkim ekranima. */}
        <main className="flex-1 pb-20">{children}</main>
      </div>

      {/* Dugme „Utisak" — na svakom ekranu unutar okvira, nikad na prijavi. */}
      <UtisakDugme traziUtisak={traziUtisak} />
    </TooltipProvider>
  );
}

// ── sadržaj bočne trake ──────────────────────────────────────

function SadrzajTrake({
  skupljen,
  putanja,
  krediti,
  mesecniKrediti,
}: {
  skupljen: boolean;
  putanja: string;
  krediti: number | null;
  mesecniKrediti: number;
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
        <KarticaKredita krediti={krediti} mesecni={mesecniKrediti} skupljen={skupljen} />

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
 * Balans kredita (F4 §4: uvek vidljiv).
 *
 * Traka pokazuje koliko je od mesečne dodele ostalo — broj bez konteksta ne
 * govori ništa. Skupljen sidebar zadržava broj, jer je to jedini podatak koji
 * korisnik proverava između dva otključavanja.
 */
function KarticaKredita({
  krediti,
  mesecni,
  skupljen,
}: {
  krediti: number | null;
  mesecni: number;
  skupljen: boolean;
}) {
  const procenat =
    krediti === null || mesecni <= 0 ? 0 : Math.min(100, Math.round((krediti / mesecni) * 100));

  if (skupljen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/krediti"
            className="flex flex-col items-center gap-0.5 rounded-lg border border-border-strong bg-bg-elev py-2 text-center transition-colors hover:border-fg-muted"
          >
            <Coins className="h-4 w-4 text-accent-text" />
            <span className="text-xs font-semibold num">{krediti ?? "—"}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {krediti ?? "—"} od {mesecni} kredita
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href="/krediti"
      title="Krediti se troše na otključavanje prospekata"
      className="block rounded-xl border border-border-strong bg-bg-elev p-3 shadow-sm transition-colors hover:border-fg-muted"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Coins className="h-3.5 w-3.5 text-accent-text" />
          Krediti
        </span>
        <span className="text-sm font-semibold num">
          {krediti ?? "—"}
          <span className="text-xs font-normal text-fg-muted">/{mesecni}</span>
        </span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-inset">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${procenat}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] leading-tight text-fg-muted">
        Obnavlja se prvog u mesecu. Keš je besplatan, novo skeniranje 1 kredit.
      </p>
    </Link>
  );
}
