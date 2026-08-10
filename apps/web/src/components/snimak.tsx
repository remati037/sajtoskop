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
import type { AiSeverity } from "@sajtoskop/shared";
import type { PublicLead } from "@/lib/search-types";
import { formatLcp, psiBand, SEVERITY_LABEL } from "@/lib/ui-tekst";

type Otkljucan = Extract<PublicLead, { isUnlocked: true }>;

const VARIJANTE = [
  { kljuc: "mobile", naslov: "Mobilni", sirina: "max-w-[15rem]" },
  { kljuc: "desktop", naslov: "Desktop", sirina: "max-w-full" },
] as const;

const SEVERITY_STIL: Record<AiSeverity, string> = {
  visoka: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  srednja:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  niska:
    "border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400",
};

const PSI_STIL = {
  dobar: { traka: "bg-emerald-500", tekst: "text-emerald-700 dark:text-emerald-400" },
  osrednji: { traka: "bg-amber-500", tekst: "text-amber-700 dark:text-amber-400" },
  los: { traka: "bg-red-500", tekst: "text-red-700 dark:text-red-400" },
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
        className="group flex items-center gap-2 rounded border border-transparent px-1 py-1 text-left transition-colors hover:border-neutral-300 dark:hover:border-neutral-700"
      >
        <span className="h-10 w-10 shrink-0 overflow-hidden rounded border border-neutral-300 transition-colors group-hover:border-neutral-900 dark:border-neutral-700 dark:group-hover:border-white">
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
      <span className="whitespace-nowrap text-xs text-neutral-500 underline decoration-dotted underline-offset-2">
        Snimci
      </span>
    );
  }

  if (broj === 0) {
    return (
      <span className="whitespace-nowrap text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Bez zamerki
      </span>
    );
  }

  return (
    <span className="whitespace-nowrap text-xs font-medium text-neutral-900 underline decoration-dotted underline-offset-2 dark:text-neutral-100">
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
        className="inline-flex h-10 w-10 items-center justify-center rounded border border-dashed border-emerald-400 text-[10px] font-semibold leading-tight text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
      >
        nema
      </span>
    );
  }

  return (
    <span
      title="Snimak se pravi. Osveži stranicu za koji trenutak."
      className="inline-flex h-10 w-10 items-center justify-center rounded border border-dashed border-neutral-300 text-[10px] text-neutral-400 dark:border-neutral-700"
    >
      …
    </span>
  );
}

function Preklop({ lead, onClose }: { lead: Otkljucan; onClose: () => void }) {
  useEffect(() => {
    const naEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", naEsc);
    return () => document.removeEventListener("keydown", naEsc);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Snimci sajta — ${lead.name}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-950/70 p-4 backdrop-blur-sm sm:p-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{lead.name}</h2>
            {lead.websiteUrl && (
              <a
                href={lead.websiteUrl}
                target="_blank"
                rel="noreferrer noopener nofollow"
                className="block truncate text-xs text-neutral-500 underline decoration-dotted underline-offset-4"
              >
                {lead.websiteUrl.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zatvori"
            className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-white"
          >
            Zatvori
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-[15rem_1fr]">
          {VARIJANTE.map((v) => (
            <figure key={v.kljuc} className={v.sirina}>
              <figcaption className="mb-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
                {v.naslov}
              </figcaption>
              <Slika url={lead.screenshot?.[v.kljuc] ?? null} alt={`${v.naslov} prikaz sajta`} />
            </figure>
          ))}
        </div>

        <Analiza lead={lead} />

        <p className="mt-4 text-[11px] text-neutral-400">
          Snimci su privatni i link ističe za 15 minuta. Osveži stranicu ako slika nestane.
        </p>
      </div>
    </div>
  );
}

// ── analiza ────────────────────────────────────────────────

function Analiza({ lead }: { lead: Otkljucan }) {
  const imaPsi = lead.psiMobileScore !== null;
  const imaAi = lead.aiIssues !== null && lead.aiIssues.length > 0;

  if (!imaPsi && !imaAi && lead.signals.length === 0) return null;

  return (
    <section className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800">
      {imaPsi && <PsiTraka score={lead.psiMobileScore as number} lcpMs={lead.psiLcpMs} />}

      {lead.aiVerdict && <Presuda tekst={lead.aiVerdict} />}

      {imaAi ? (
        <ul className="mt-4 space-y-2.5">
          {(lead.aiIssues ?? []).map((p, i) => (
            <li key={`${p.title}-${i}`} className="flex gap-3">
              <span
                className={`mt-0.5 h-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_STIL[p.severity]}`}
              >
                {SEVERITY_LABEL[p.severity]}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.title}</span>
                <span className="block text-sm text-neutral-600 dark:text-neutral-400">
                  {p.detail}
                </span>
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
    <div className="mb-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500">
          Brzina na telefonu
        </span>
        <span className={`text-sm font-semibold tabular-nums ${stil.tekst}`}>
          {score}
          <span className="text-xs font-normal text-neutral-400">/100</span>
          {lcpMs !== null && (
            <span className="ml-2 text-xs font-normal text-neutral-500">
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
        className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      >
        <div className={`h-full rounded-full ${stil.traka}`} style={{ width: `${score}%` }} />
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
    <div className="rounded-lg border border-neutral-900/10 bg-neutral-50 p-4 dark:border-white/10 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm leading-relaxed">„{tekst}"</p>
        <button
          type="button"
          onClick={kopiraj}
          className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium transition-colors hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-white"
        >
          {kopirano ? "Kopirano ✓" : "Kopiraj rečenicu"}
        </button>
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
      <p className="mb-2 text-[11px] uppercase tracking-wider text-neutral-500">
        Šta je našla provera sajta
      </p>
      <ul className="space-y-1.5">
        {signali.map((s) => (
          <li key={s} className="flex gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            <span aria-hidden className="text-neutral-400">
              •
            </span>
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
      <div className="flex h-40 items-center justify-center rounded border border-dashed border-neutral-300 text-xs text-neutral-400 dark:border-neutral-700">
        nije napravljen
      </div>
    );
  }

  if (pukla) {
    return (
      <div className="flex h-40 items-center justify-center rounded border border-dashed border-neutral-300 px-3 text-center text-xs text-neutral-500 dark:border-neutral-700">
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
      className="w-full rounded border border-neutral-200 dark:border-neutral-800"
    />
  );
}
