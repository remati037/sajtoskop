"use client";

// Detalj otključanog prospekta (F5 §4 i §5, F6 §4).
//
// Do F6 je ovaj preklop bio samo galerija snimaka. Sad je i jedino mesto gde se
// vidi rezultat analize, jer je to isti ekran i isti klik — dva snimka gore,
// ispod njih ono što treba da ide u poruku vlasniku.
//
// Mobilni snimak je ovde važniji od desktop snimka i zato stoji prvi u pregledu:
// na njemu se vidi da sajt nije responsive, a to je pola vrednosti proizvoda
// (F5 §4). Desktop je kontrola — „ovako izgleda kad radi".
//
// Sajt koji se ne otvara NEMA snimak i to nije rupa u prikazu nego poruka:
// prazan sajt je najjači argument u poruci vlasniku (F5 §5).
//
// URL-ovi su potpisani i traju 15 minuta. Kartica koja stoji otvorena duže od
// toga dobija 403 na slici — zato `onError` prelazi na poruku o osvežavanju,
// umesto na slomljenu ikonicu.
//
// ── zašto „Kopiraj rečenicu" ima svoje dugme ───────────────
// `aiVerdict` je jedna rečenica bez žargona koju korisnik doslovno lepi u Viber
// poruku vlasniku. To je funkcija zbog koje se vraća (F6 §4), pa ne sme da bude
// tekst koji se selektuje mišem preko tri reda.

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, ImageOff } from "lucide-react";
import type { AiSeverity } from "@sajtoskop/shared";
import type { PublicLead } from "@/lib/search-types";
import { cn } from "@/lib/cn";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { NaslovSekcije } from "./ui/stranica";
import { formatLcp, psiBand, SEVERITY_LABEL } from "@/lib/ui-tekst";

type Otkljucan = Extract<PublicLead, { isUnlocked: true }>;

const VARIJANTE = [
  { kljuc: "mobile", naslov: "Mobilni", sirina: "max-w-[15rem]" },
  { kljuc: "desktop", naslov: "Desktop", sirina: "max-w-full" },
] as const;

const SEVERITY_STIL: Record<AiSeverity, string> = {
  visoka: "border-danger/30 bg-danger-wash text-danger",
  srednja: "border-warn/30 bg-warn-wash text-warn-text",
  niska: "border-border bg-bg-subtle text-fg-muted",
};

const PSI_STIL = {
  dobar: { traka: "bg-accent", tekst: "text-accent-text" },
  osrednji: { traka: "bg-warn", tekst: "text-warn-text" },
  los: { traka: "bg-danger", tekst: "text-danger" },
} as const;

/**
 * Dugme u redu tabele. Otvara preklop sa snimcima i analizom.
 *
 * Stanje drži sam, pa ga tabele ubacuju bez ijednog propa osim leada.
 */
export function SnimakDugme({ lead }: { lead: Otkljucan }) {
  const [otvoren, setOtvoren] = useState(false);

  if (!lead.screenshot) return <NemaSnimka lead={lead} />;

  const prikaz = lead.screenshot.mobile ?? lead.screenshot.desktop;

  return (
    <>
      <button
        type="button"
        onClick={() => setOtvoren(true)}
        title="Otvori snimke i analizu sajta"
        className="group flex items-center gap-2.5 rounded-lg border border-transparent p-1 text-left transition-colors hover:border-border-strong hover:bg-bg-subtle"
      >
        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border shadow-sm transition-colors group-hover:border-accent">
          {/* eslint-disable-next-line @next/next/no-img-element -- potpisan URL sa
              tuđeg hosta i rokom od 15 min; next/image bi ga keširao i optimizovao
              posle isteka potpisa, pa bi prikaz pucao nasumično. */}
          <img
            src={prikaz ?? ""}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
        </span>

        {/* Natpis, a ne gola sličica. Analiza je najvredniji deo F6, a stajala je
            iza slike od 40×40 bez ijedne reči — u koloni koja se zvala „Snimak".
            Niko ne klikne ono za šta ne zna da postoji. */}
        <Oznaka lead={lead} />
      </button>

      {otvoren && <Preklop lead={lead} onClose={() => setOtvoren(false)} />}
    </>
  );
}

/** Šta se krije iza dugmeta, u dve reči. */
function Oznaka({ lead }: { lead: Otkljucan }) {
  const broj = lead.aiIssues?.length ?? null;

  if (broj === null) {
    return (
      <span className="whitespace-nowrap text-xs text-fg-muted underline decoration-dotted underline-offset-2">
        Snimci
      </span>
    );
  }

  if (broj === 0) {
    return (
      <span className="whitespace-nowrap text-xs font-medium text-accent-text">
        Bez zamerki
      </span>
    );
  }

  return (
    <span className="whitespace-nowrap text-xs font-medium underline decoration-dotted underline-offset-2 group-hover:text-accent-text">
      {/* Najviše je 5 stavki (Zod granica), pa je „nalaz / nalaza" dovoljno. */}
      {broj} {broj === 1 ? "nalaz" : "nalaza"}
    </span>
  );
}

/**
 * Nema snimka. Za mrtav sajt i sajt kog nema to je poruka, ne greška —
 * doslovno tekst iz F5 §5. Za sve ostalo je „još se pravi".
 */
function NemaSnimka({ lead }: { lead: Otkljucan }) {
  const dobarLead =
    lead.siteStatus === "nema_sajt" ||
    lead.siteStatus === "mrtav" ||
    lead.siteStatus === "samo_drustvene";

  if (dobarLead) {
    return (
      <span
        title="Sajt se ne otvara — to je najjači mogući argument u poruci vlasniku."
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-accent/50 text-[10px] font-semibold leading-tight text-accent-text"
      >
        nema
      </span>
    );
  }

  return (
    <span
      title="Snimak se pravi. Osveži stranicu za koji trenutak."
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-border text-fg-muted/70"
    >
      <ImageOff className="h-3.5 w-3.5" />
    </span>
  );
}

function Preklop({ lead, onClose }: { lead: Otkljucan; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl" aria-label={`Snimci sajta — ${lead.name}`}>
        <DialogHeader>
          <DialogTitle>{lead.name}</DialogTitle>
          {lead.websiteUrl && (
            <a
              href={lead.websiteUrl}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="flex items-center gap-1 truncate text-xs text-fg-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-accent-text"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {lead.websiteUrl.replace(/^https?:\/\/(www\.)?/, "")}
              </span>
            </a>
          )}
        </DialogHeader>

        <div className="p-5">
          <div className="grid gap-5 sm:grid-cols-[15rem_1fr]">
            {VARIJANTE.map((v) => (
              <figure key={v.kljuc} className={v.sirina}>
                <figcaption className="mb-2">
                  <NaslovSekcije>{v.naslov}</NaslovSekcije>
                </figcaption>
                <Slika url={lead.screenshot?.[v.kljuc] ?? null} alt={`${v.naslov} prikaz sajta`} />
              </figure>
            ))}
          </div>

          <Analiza lead={lead} />

          <p className="mt-5 text-[11px] text-fg-muted/80">
            Snimci su privatni i link ističe za 15 minuta. Osveži stranicu ako slika nestane.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── analiza ────────────────────────────────────────────────

function Analiza({ lead }: { lead: Otkljucan }) {
  const imaPsi = lead.psiMobileScore !== null;
  const imaAi = lead.aiIssues !== null && lead.aiIssues.length > 0;

  if (!imaPsi && !imaAi && lead.signals.length === 0) return null;

  return (
    <section className="mt-6 border-t border-border pt-5">
      {imaPsi && <PsiTraka score={lead.psiMobileScore as number} lcpMs={lead.psiLcpMs} />}

      {lead.aiVerdict && <Presuda tekst={lead.aiVerdict} />}

      {imaAi ? (
        <ul className="mt-4 space-y-2.5">
          {(lead.aiIssues ?? []).map((p, i) => (
            <li key={`${p.title}-${i}`} className="flex gap-3">
              <span
                className={cn(
                  "mt-0.5 h-fit shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  SEVERITY_STIL[p.severity],
                )}
              >
                {SEVERITY_LABEL[p.severity]}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.title}</span>
                <span className="block text-sm text-fg-muted">{p.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Rezerva signali={lead.signals} />
      )}
    </section>
  );
}

/**
 * PageSpeed skor kao traka sa bojom po opsegu (F6 §4).
 *
 * LCP stoji uz skor jer je jedini deo koji vlasnik razume bez objašnjenja:
 * „skor 31" ništa ne znači, „otvara se 8,2 s na telefonu" znači sve.
 */
function PsiTraka({ score, lcpMs }: { score: number; lcpMs: number | null }) {
  const stil = PSI_STIL[psiBand(score)];

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <NaslovSekcije>Brzina na telefonu</NaslovSekcije>
        <span className={cn("text-sm font-semibold num", stil.tekst)}>
          {score}
          <span className="text-xs font-normal text-fg-muted">/100</span>
          {lcpMs !== null && (
            <span className="ml-2 text-xs font-normal text-fg-muted">
              učitava se {formatLcp(lcpMs)}
            </span>
          )}
        </span>
      </div>

      <div
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="PageSpeed skor na telefonu"
        className="h-1.5 w-full overflow-hidden rounded-full bg-bg-inset"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-700", stil.traka)}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

/** Istaknuta rečenica sa dugmetom za kopiranje. */
function Presuda({ tekst }: { tekst: string }) {
  const [kopirano, setKopirano] = useState(false);

  useEffect(() => {
    if (!kopirano) return;
    const t = setTimeout(() => setKopirano(false), 2000);
    return () => clearTimeout(t);
  }, [kopirano]);

  async function kopiraj() {
    try {
      await navigator.clipboard.writeText(tekst);
      setKopirano(true);
    } catch {
      // Bez HTTPS-a ili uz odbijenu dozvolu clipboard API ne postoji. Tekst je
      // i dalje na ekranu i može ručno da se selektuje — nema smisla vikati.
      setKopirano(false);
    }
  }

  return (
    <div className="rounded-xl border border-accent/20 bg-accent-wash/70 p-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm leading-relaxed">„{tekst}"</p>
        <Button type="button" variant="outline" size="sm" onClick={kopiraj} className="shrink-0">
          {kopirano ? (
            <Check className="h-3.5 w-3.5 text-accent" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {kopirano ? "Kopirano" : "Kopiraj rečenicu"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Rezerva kad AI analize nema (F6 §4: „prikaži signale iz ugly-score kao
 * rezervu, ne prazno mesto").
 *
 * Signali su ovde već samo tekst — server šalje `label`, nikad `points`.
 */
function Rezerva({ signali }: { signali: string[] }) {
  if (signali.length === 0) return null;

  return (
    <div className="mt-4">
      <NaslovSekcije className="mb-2">Šta je našla provera sajta</NaslovSekcije>
      <ul className="space-y-1.5">
        {signali.map((s) => (
          <li key={s} className="flex gap-2 text-sm text-fg-muted">
            <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent/60" />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Slika({ url, alt }: { url: string | null; alt: string }) {
  const [pukla, setPukla] = useState(false);

  if (!url) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-xs text-fg-muted/70">
        nije napravljen
      </div>
    );
  }

  if (pukla) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border px-3 text-center text-xs text-fg-muted">
        Link je istekao. Osveži stranicu.
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- v. objašnjenje gore.
    <img
      src={url}
      alt={alt}
      onError={() => setPukla(true)}
      className="w-full rounded-xl border border-border shadow-sm"
    />
  );
}
