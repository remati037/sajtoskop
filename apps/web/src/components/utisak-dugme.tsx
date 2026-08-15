"use client";

// apps/web/src/components/utisak-dugme.tsx
// Plutajuće dugme „Utisak" i panel iza njega (F10 §4, prerađeno u F11 §6.2).
//
// ── zašto panel, a ne modal ──────────────────────────────────
// Bug se prijavljuje DOK se gleda ono što ne radi. Modal preko ekrana sakriva
// baš to — čovek zatvori prozor da proveri šta je hteo da napiše, i utisak
// nestane s njim. Panel je usidren uz dugme, širok 360 px i ostavlja ekran
// vidljiv.
//
// Jedini modal koji ostaje je podsetnik na dan 3 (F10, odluka 3 iz F11): on
// PREKIDA namerno, jer ne prati nijednu radnju korisnika. Oba oblika dele isto
// telo forme, pa se kopi i logika ne mogu razići.
//
// ── prvi klik je već poslat utisak ───────────────────────────
// Klik na ocenu odmah upisuje red (F10 odluka 2). Tekst, tip i slika su dopuna:
// panel sme da se zatvori bilo kako — `✕`, `Esc`, klik van njega — i ništa se ne
// gubi.
//
// Ocene su ikonice iz `lucide-react`, ne emodži (dizajn sistem §7.7). Emodži
// postoji samo u subjectu mejla, koji nije pod dizajn sistemom.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Frown,
  ImagePlus,
  Loader2,
  Meh,
  MessageSquare,
  Smile,
  X,
} from "lucide-react";
import type { FeedbackKind, FeedbackSource } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import { procitajDnevnik } from "@/lib/dnevnik-gresaka";
import type { DopunaOdgovor, SlikaOdgovor, UtisakOdgovor } from "@/lib/feedback-schema";
import { naslovZaPutanju } from "@/lib/navigacija";
import type { ApiError } from "@/lib/search-types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { useUtisci } from "./utisci-provider";

type Ocena = 1 | 2 | 3;

const OCENE: { vrednost: Ocena; label: string; Ikona: typeof Frown }[] = [
  { vrednost: 1, label: "Loše", Ikona: Frown },
  { vrednost: 2, label: "Ok", Ikona: Meh },
  { vrednost: 3, label: "Odlično", Ikona: Smile },
];

// „Drugo" postoji u šemi, ali ne i u formi: tri ponuđena tipa pokrivaju sve što
// mi u beti menja redosled posla, a četvrti bi bio kutija u koju sve pada.
const TIPOVI: { vrednost: FeedbackKind; label: string }[] = [
  { vrednost: "bug", label: "Bug" },
  { vrednost: "ideja", label: "Ideja" },
  { vrednost: "pohvala", label: "Pohvala" },
];

const MAX_PORUKA = 2000;
/** Brojač se pojavljuje tek kad počne da znači nešto. */
const BROJAC_OD = 200;
/** Ne odmah: prekidati korisnika dok ekran tek sedne znači zatvoren prozor. */
const PODSETNIK_KASNJENJE_MS = 4_000;
const ZATVARANJE_MS = 1_600;

export function UtisakDugme({
  traziUtisak,
  neprocitano = 0,
}: {
  traziUtisak: boolean;
  /** Rešenih prijava koje korisnik nije pogledao — tačka na dugmetu (F11.4). */
  neprocitano?: number;
}) {
  const utisci = useUtisci();

  const [panel, setPanel] = useState(false);
  const [podsetnik, setPodsetnik] = useState(false);

  const dugme = useRef<HTMLButtonElement>(null);
  const okvir = useRef<HTMLDivElement>(null);
  /** Ručno otvaranje pobeđuje: posle njega podsetnik ne iskače (F10 §6). */
  const rucno = useRef(false);

  // ── podsetnik posle tri dana ────────────────────────────────
  // `traziUtisak` je izračunat serverski, iz profila koji `(app)/layout.tsx`
  // ionako čita. `podsetnik-vidjen` se šalje čim se prozor pojavi, ne kad se
  // odgovori — korisnik koji ga zatvori ne sme da ga vidi ponovo.
  useEffect(() => {
    if (!traziUtisak) return;

    const t = setTimeout(() => {
      if (rucno.current) return;
      setPodsetnik(true);
      void fetch("/api/feedback/podsetnik-vidjen", { method: "POST" }).catch(() => {
        // Neuspeh znači samo da će podsetnik doći još jednom. Nema šta da se javi.
      });
    }, PODSETNIK_KASNJENJE_MS);

    return () => clearTimeout(t);
  }, [traziUtisak]);

  const zatvoriPanel = useCallback(() => {
    setPanel(false);
    // Fokus se vraća na dugme (§6.2). Bez ovoga tastatura ostaje na `<body>`-ju i
    // korisnik koji je došao prečicom mora ponovo da tabuje kroz celu stranu.
    dugme.current?.focus();
  }, []);

  // ── otvoren sloj preko ekrana = motor ćuti (F11 §3.1) ───────
  const otvoren = panel || podsetnik;
  useEffect(() => {
    utisci?.postaviMir("panel", !otvoren);
  }, [utisci, otvoren]);

  // ── prečica Ctrl/⌘ + Shift + U ──────────────────────────────
  // `e.code`, ne `e.key`: na srpskom rasporedu `key` uz Shift nije uvek „U", a
  // prečica koja radi samo na engleskoj tastaturi nije prečica.
  useEffect(() => {
    function naTaster(e: KeyboardEvent) {
      if (!e.shiftKey || !(e.metaKey || e.ctrlKey) || e.code !== "KeyU") return;
      e.preventDefault();
      rucno.current = true;
      setPanel((p) => !p);
    }

    window.addEventListener("keydown", naTaster);
    return () => window.removeEventListener("keydown", naTaster);
  }, []);

  // ── Esc i klik van panela ───────────────────────────────────
  useEffect(() => {
    if (!panel) return;

    function naEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        zatvoriPanel();
      }
    }

    function naKlik(e: PointerEvent) {
      const cilj = e.target as Node;
      if (okvir.current?.contains(cilj) || dugme.current?.contains(cilj)) return;
      // Ocena je već poslata, pa zatvaranje klikom van ništa ne gubi (F10 §4).
      setPanel(false);
    }

    document.addEventListener("keydown", naEsc);
    document.addEventListener("pointerdown", naKlik);
    return () => {
      document.removeEventListener("keydown", naEsc);
      document.removeEventListener("pointerdown", naKlik);
    };
  }, [panel, zatvoriPanel]);

  // ── focus trap ──────────────────────────────────────────────
  // Ručno, u dvadesetak linija, umesto biblioteke: panel ima jedan nivo i nema
  // ugnježdene slojeve, a nijedna nova biblioteka ne sme u bundle (F11 §11).
  useEffect(() => {
    if (!panel) return;

    const cvor = okvir.current;
    if (!cvor) return;

    const fokusabilni = () =>
      [
        ...cvor.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);

    fokusabilni()[0]?.focus();

    function naTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const meta = fokusabilni();
      const prvi = meta[0];
      const poslednji = meta[meta.length - 1];
      if (!prvi || !poslednji) return;

      if (e.shiftKey && document.activeElement === prvi) {
        e.preventDefault();
        poslednji.focus();
      } else if (!e.shiftKey && document.activeElement === poslednji) {
        e.preventDefault();
        prvi.focus();
      }
    }

    cvor.addEventListener("keydown", naTab);
    return () => cvor.removeEventListener("keydown", naTab);
  }, [panel]);

  return (
    <>
      {/* Omotač je `fixed`, a ne dugme: tačka je LINK do „Moje prijave", i link
          ne sme da stoji UNUTAR dugmeta (interaktivno u interaktivnom). `z-30`
          je ispod mobilne fioke (`z-50`) i ispod modala — dugme ne sme da stoji
          preko otvorenog menija. Na telefonu je meta 44×44, bez teksta. */}
      <span className="fixed bottom-4 right-4 z-30 sm:bottom-5 sm:right-5">
        <button
          ref={dugme}
          type="button"
          aria-expanded={panel}
          aria-haspopup="dialog"
          onClick={() => {
            rucno.current = true;
            setPanel((p) => !p);
          }}
          title="Pošalji utisak — stiže direktno meni (Ctrl/⌘ + Shift + U)"
          className="inline-flex h-11 w-11 items-center justify-center gap-2 rounded-full border border-border-strong bg-bg-elev text-sm font-medium text-fg shadow-sm transition-colors hover:border-fg-muted sm:h-10 sm:w-auto sm:px-4"
        >
          <MessageSquare className="h-4 w-4 text-accent-text" strokeWidth={2.2} />
          <span className="sr-only sm:not-sr-only">Utisak</span>
        </button>

        {/* F11.4: tačka kad postoji rešena prijava koju korisnik nije pogledao.
            Broj ide u tačku (§9: „brojač tačke ide na 5") i vodi na spisak
            prijava, ne u panel — panel šalje utiske, a ovde treba da se PROČITA
            ishod. */}
        {neprocitano > 0 && (
          <Link
            href="/utisci"
            aria-label={`${neprocitano} ${neprocitano === 1 ? "rešena prijava koju nisi pogledao" : "rešene prijave koje nisi pogledao"} — otvori`}
            title="Rešeno je nešto što si prijavio"
            className="num absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-bg bg-accent px-0.5 text-[10px] font-semibold leading-none text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
          >
            {neprocitano > 9 ? "9+" : neprocitano}
          </Link>
        )}
      </span>

      {panel && (
        <div
          ref={okvir}
          role="dialog"
          aria-modal="false"
          aria-label="Utisak"
          // 360 px, usidren uz dugme (§6.2). Na telefonu se lepi za obe ivice —
          // 360 px na ekranu od 390 px bi ostavilo 15 px sa svake strane.
          className="fixed bottom-16 left-4 right-4 z-40 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-border bg-bg-elev shadow-card sm:bottom-17 sm:left-auto sm:right-5 sm:w-90"
        >
          <UtisakForma izvor="dugme" naZatvori={zatvoriPanel} />
        </div>
      )}

      {/* Podsetnik na dan 3 ostaje modal: on jedini ne prati nijednu radnju
          korisnika, pa mora da prekine da bi ga iko video (odluka 3). */}
      <Dialog open={podsetnik} onOpenChange={setPodsetnik}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tri dana si u Sajtoskopu</DialogTitle>
            <DialogDescription>Kako ti ide? Jedan klik je dovoljan.</DialogDescription>
          </DialogHeader>

          <UtisakForma izvor="podsetnik" naZatvori={() => setPodsetnik(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── telo forme ───────────────────────────────────────────────
// Jedno telo za panel i za podsetnik. Razlika je samo u okviru koji ga nosi.

type Slika = { path: string; pregled: string };

function UtisakForma({
  izvor,
  naZatvori,
}: {
  izvor: FeedbackSource;
  naZatvori: () => void;
}) {
  const putanja = usePathname();

  const [ocena, setOcena] = useState<Ocena | null>(null);
  const [id, setId] = useState<number | null>(null);
  const [traziDopunu, setTraziDopunu] = useState(false);
  const [nagrada, setNagrada] = useState(false);
  const [tip, setTip] = useState<FeedbackKind | null>(null);
  const [tekst, setTekst] = useState("");
  const [slika, setSlika] = useState<Slika | null>(null);
  const [slikaCeka, setSlikaCeka] = useState(false);
  const [slikaGreska, setSlikaGreska] = useState<string | null>(null);
  const [ceka, setCeka] = useState(false);
  const [greska, setGreska] = useState<string | null>(null);
  const [potvrda, setPotvrda] = useState<string | null>(null);
  const [nadZonom, setNadZonom] = useState(false);

  const tajmer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (tajmer.current) clearTimeout(tajmer.current);
    },
    [],
  );

  // Objekat-URL sličice se oslobađa kad slika ode ili panel nestane — inače
  // ostaje u memoriji taba do sledećeg punog učitavanja.
  useEffect(() => {
    const pregled = slika?.pregled;
    return () => {
      if (pregled) URL.revokeObjectURL(pregled);
    };
  }, [slika?.pregled]);

  function zatvoriPosleTrenutka() {
    if (tajmer.current) clearTimeout(tajmer.current);
    tajmer.current = setTimeout(naZatvori, ZATVARANJE_MS);
  }

  // ── korak 1: ocena ──────────────────────────────────────────
  // Klik = POST, bez potvrde. Odgovor donosi i to hoće li uz polje za tekst
  // stajati čip „+1 kredit" — kvota je stanje baze, ne stanje ekrana.

  async function posaljiOcenu(vrednost: Ocena) {
    if (ceka) return; // dupli klik se ignoriše dok prvi zahtev traje

    setOcena(vrednost);
    setCeka(true);
    setGreska(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: vrednost,
          source: izvor,
          route: putanja,
          // Jedini podatak o uređaju koji server ne zna sam.
          viewport: `${window.innerWidth}×${window.innerHeight}`,
        }),
      });

      if (!res.ok) throw new Error(String(res.status));

      const telo = (await res.json()) as UtisakOdgovor;
      setId(telo.id);
      setTraziDopunu(telo.dopuna);
      setNagrada(telo.nagrada);

      // `dopuna: false` je ili tvrd plafon (nema zapisa) ili utisak preko dnevnog
      // limita za mejl — u oba slučaja ide samo „Hvala", bez ijedne reči o limitu
      // (odluka 6).
      if (!telo.dopuna) {
        setPotvrda("Utisak je stigao. Hvala.");
        zatvoriPosleTrenutka();
      }
    } catch {
      setGreska("Nije uspelo. Pokušaj ponovo za koji trenutak.");
    } finally {
      setCeka(false);
    }
  }

  // ── korak 2: dopuna ─────────────────────────────────────────

  async function posaljiDopunu() {
    const poruka = tekst.trim();
    if (id === null || ceka) return;

    // Prazna dopuna se ne šalje uopšte — nema šta da se piše.
    if (!poruka && !tip && !slika) {
      naZatvori();
      return;
    }

    setCeka(true);
    setGreska(null);

    try {
      const res = await fetch(`/api/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(tip ? { kind: tip } : {}),
          ...(poruka ? { message: poruka } : {}),
          ...(slika ? { screenshot_path: slika.path } : {}),
          // Dnevnik klijentskih grešaka ide samo uz bug (F11 odluka 10). Server
          // istu proveru ponavlja — ovo je udobnost, ne odbrana.
          ...(tip === "bug" ? { errors: procitajDnevnik() } : {}),
        }),
      });

      if (!res.ok) throw new Error(String(res.status));

      const telo = (await res.json()) as DopunaOdgovor;

      // Kad je kvota potrošena, potvrda je obična — bez ijedne reči o kvoti
      // (F11 §6.7, isti razlog iz kog F10 ne kaže „dosta si mi rekao").
      setPotvrda(
        telo.nagrada
          ? "Poslato. Hvala — dodao sam ti 1 kredit."
          : "Poslato. Javljam se ako bude potrebe.",
      );
      zatvoriPosleTrenutka();
    } catch {
      setGreska("Nije uspelo. Pokušaj ponovo za koji trenutak.");
    } finally {
      setCeka(false);
    }
  }

  // ── slika: nalepi ili prevuci ───────────────────────────────
  // Korisnik nosi sliku (odluka 9). Bez `html2canvas`, bez snimanja ekrana, bez
  // ijednog kilobajta biblioteke — `FormData` je u pregledaču.

  async function otpremi(fajl: File) {
    if (slikaCeka) return;

    setSlikaCeka(true);
    setSlikaGreska(null);

    try {
      const forma = new FormData();
      forma.append("slika", fajl);

      const res = await fetch("/api/feedback/slika", { method: "POST", body: forma });
      const json = (await res.json()) as SlikaOdgovor | ApiError;

      if (!res.ok) {
        setSlikaGreska((json as ApiError).greska ?? "Slika nije prošla.");
        return;
      }

      setSlika({ path: (json as SlikaOdgovor).path, pregled: URL.createObjectURL(fajl) });
    } catch {
      setSlikaGreska("Slika nije prošla. Utisak i dalje možeš da pošalješ.");
    } finally {
      setSlikaCeka(false);
    }
  }

  /**
   * Prvi fajl iz `paste`-a ili `drop`-a.
   *
   * `files` je prazan u Safariju za nalepljen snimak ekrana, pa se pada na
   * `items` — tamo slika stiže kao stavka tipa `file`. Vrsta se ovde ne
   * proverava: to radi server, po magičnim bajtovima (F11 §8).
   */
  function izDogadjaja(lista: FileList | null | undefined, stavke?: DataTransferItemList) {
    if (lista?.[0]) return lista[0];
    if (!stavke) return null;

    for (let i = 0; i < stavke.length; i += 1) {
      const stavka = stavke[i];
      if (stavka?.kind !== "file") continue;
      const fajl = stavka.getAsFile();
      if (fajl) return fajl;
    }

    return null;
  }

  const preostalo = MAX_PORUKA - tekst.length;
  const ekran = naslovZaPutanju(putanja);
  const otvorenaDopuna = id !== null && traziDopunu;

  if (potvrda) {
    return (
      <div className="px-4 py-5 sm:px-5">
        <p role="status" aria-live="polite" className="text-sm text-fg-muted">
          {potvrda}
        </p>
      </div>
    );
  }

  return (
    <div
      onPaste={(e) => {
        if (!otvorenaDopuna) return;
        const fajl = izDogadjaja(e.clipboardData.files, e.clipboardData.items);
        if (fajl) {
          e.preventDefault();
          void otpremi(fajl);
        }
      }}
      onDragOver={(e) => {
        if (!otvorenaDopuna) return;
        e.preventDefault();
        setNadZonom(true);
      }}
      onDragLeave={() => setNadZonom(false)}
      onDrop={(e) => {
        setNadZonom(false);
        if (!otvorenaDopuna) return;
        e.preventDefault();
        const fajl = izDogadjaja(e.dataTransfer.files, e.dataTransfer.items);
        if (fajl) void otpremi(fajl);
      }}
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">
            {otvorenaDopuna ? "Zabeleženo, hvala." : "Kako ti ide?"}
          </p>
          <p className="truncate text-xs text-fg-muted">{ekran} · beta</p>
        </div>

        {izvor === "dugme" && (
          <button
            type="button"
            onClick={naZatvori}
            aria-label="Zatvori"
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="grid grid-cols-3 gap-2">
          {OCENE.map(({ vrednost, label, Ikona }) => (
            <button
              key={vrednost}
              type="button"
              disabled={ceka || id !== null}
              onClick={() => void posaljiOcenu(vrednost)}
              // Boja označava IZBOR, ne vrednost: crvena za „loše" bi bila
              // dekoracija, a crvena je rezervisana za Ugly Score i greške.
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border border-border-strong bg-bg-elev px-2 py-3 text-xs font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg disabled:pointer-events-none",
                ocena === vrednost
                  ? "border-border-accent bg-accent-wash text-accent-text"
                  : "disabled:opacity-45",
              )}
            >
              <Ikona className="h-6 w-6" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>

        {!otvorenaDopuna && (
          <p className="text-xs text-fg-muted">
            Klik na ocenu je već poslat utisak. Ostalo je dopuna.
          </p>
        )}

        {otvorenaDopuna && (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">Hoćeš da dodaš rečenicu?</p>

              {/* Čip stoji uz polje za tekst, jer se nagrada dobija za PORUKU, ne
                  za ocenu — obećanje uz ocenu bi bilo laž (§2.4). Pojavljuje se
                  samo kad je nagrada zaista dostupna. */}
              {nagrada && (
                <span
                  title="Za utisak sa porukom od bar 20 znakova."
                  className="num inline-flex h-6 shrink-0 items-center rounded-full border border-border-accent bg-accent-wash px-2 text-[11px] font-medium text-accent-text"
                >
                  +1 kredit
                </span>
              )}
            </div>

            <textarea
              rows={3}
              autoFocus
              value={tekst}
              maxLength={MAX_PORUKA}
              onChange={(e) => setTekst(e.target.value)}
              placeholder="Šta te muči, šta fali, šta bi izbacio…"
              className="w-full resize-none rounded-xl border border-border-strong bg-bg-elev px-3 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-border-accent"
            />

            {preostalo <= BROJAC_OD && (
              <p className="num -mt-1 text-right text-[11px] text-fg-muted">{preostalo}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {TIPOVI.map(({ vrednost, label }) => (
                <button
                  key={vrednost}
                  type="button"
                  aria-pressed={tip === vrednost}
                  onClick={() => setTip((p) => (p === vrednost ? null : vrednost))}
                  className={cn(
                    "inline-flex h-8 items-center rounded-lg border border-border-strong bg-bg-elev px-3 text-xs font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg",
                    tip === vrednost && "border-border-accent bg-accent-wash text-accent-text",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <ZonaSlike
              slika={slika}
              ceka={slikaCeka}
              greska={slikaGreska}
              nadZonom={nadZonom}
              ukloni={() => {
                setSlika(null);
                setSlikaGreska(null);
              }}
            />
          </>
        )}

        {greska && (
          <p role="alert" className="text-xs text-danger">
            {greska}
          </p>
        )}
      </div>

      {otvorenaDopuna && (
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          {/* „Ne treba" ne šalje ništa i ništa se ne gubi: ocena je upisana, a
              mejl je otišao u koraku 1. */}
          <Button type="button" variant="ghost" onClick={naZatvori} disabled={ceka}>
            Ne treba
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void posaljiDopunu()}
            disabled={ceka || (!tekst.trim() && !tip && !slika)}
          >
            {ceka && <Loader2 className="h-4 w-4 animate-spin" />}
            Pošalji
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Zona za sliku. Bez slike zauzima jedan red teksta (§6.2); sa slikom prikazuje
 * sličicu od 64 px sa `✕`.
 *
 * Nema `<input type="file">` dugmeta namerno: snimak ekrana se u ovom trenutku
 * već nalazi u clipboardu (Cmd+Shift+4, PrtSc), a birač fajlova bi tražio da se
 * prvo negde snimi.
 */
function ZonaSlike({
  slika,
  ceka,
  greska,
  nadZonom,
  ukloni,
}: {
  slika: { path: string; pregled: string } | null;
  ceka: boolean;
  greska: string | null;
  nadZonom: boolean;
  ukloni: () => void;
}) {
  if (slika) {
    return (
      <div className="flex items-center gap-2.5">
        {/* Sličica je lokalni objekat-URL, ne potpisan link iz bucketa: bucket je
            privatan i potpis postoji samo u adminu (F11 §4). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slika.pregled}
          alt="Priložena slika"
          className="h-16 w-16 rounded-lg border border-border object-cover"
        />
        <button
          type="button"
          onClick={ukloni}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
          Ukloni sliku
        </button>
      </div>
    );
  }

  return (
    <div>
      <p
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-2 text-xs transition-colors",
          nadZonom ? "border-border-accent text-accent-text" : "border-border text-fg-faint",
        )}
      >
        {ceka ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <ImagePlus className="h-3.5 w-3.5" aria-hidden />
        )}
        {ceka ? "Šaljem sliku…" : "Nalepi sliku (Ctrl+V) ili je prevuci ovde"}
      </p>

      {greska && (
        <p role="alert" className="mt-1 text-[11px] text-danger">
          {greska}
        </p>
      )}
    </div>
  );
}
