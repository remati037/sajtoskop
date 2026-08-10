"use client";

// Prikaz screenshotova otključanog prospekta (F5 §4 i §5).
//
// Mobilni snimak je ovde važniji od desktop snimka i zato stoji prvi u pregledu:
// na njemu se vidi da sajt nije responsive, a to je pola vrednosti proizvoda
// (PRD §4). Desktop je kontrola — „ovako izgleda kad radi".
//
// Sajt koji se ne otvara NEMA snimak i to nije rupa u prikazu nego poruka:
// prazan sajt je najjači argument u poruci vlasniku (PRD §5).
//
// URL-ovi su potpisani i traju 15 minuta. Kartica koja stoji otvorena duže od
// toga dobija 403 na slici — zato `onError` prelazi na poruku o osvežavanju,
// umesto na slomljenu ikonicu.

import { useEffect, useState } from "react";
import type { PublicLead } from "@/lib/search-types";

type Otkljucan = Extract<PublicLead, { isUnlocked: true }>;

const VARIJANTE = [
  { kljuc: "mobile", naslov: "Mobilni", sirina: "max-w-[15rem]" },
  { kljuc: "desktop", naslov: "Desktop", sirina: "max-w-full" },
] as const;

/**
 * Dugme u redu tabele. Otvara preklop sa oba snimka.
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
        title="Pogledaj kako sajt izgleda"
        className="group relative h-10 w-10 overflow-hidden rounded border border-neutral-300 transition-colors hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- potpisan URL sa
            tuđeg hosta i rokom od 15 min; next/image bi ga keširao i optimizovao
            posle isteka potpisa, pa bi prikaz pucao nasumično. */}
        <img
          src={prikaz ?? ""}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover object-top"
        />
      </button>

      {otvoren && <Preklop lead={lead} onClose={() => setOtvoren(false)} />}
    </>
  );
}

/**
 * Nema snimka. Za mrtav sajt i sajt kog nema to je poruka, ne greška —
 * doslovno tekst iz PRD-a §5. Za sve ostalo je „još se pravi".
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

        <p className="mt-4 text-[11px] text-neutral-400">
          Snimci su privatni i link ističe za 15 minuta. Osveži stranicu ako slika nestane.
        </p>
      </div>
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
