"use client";

// apps/web/src/components/kartica-prospekta.tsx
// Kartica prospekta (D12, tok-i-onboarding §7) — zamenjuje red tabele na
// `/pretraga` i `/lista` (O5).
//
// ── pet stanja, izvedena iz podataka ────────────────────────
// `stanjeKartice()` iz `lib/kartica.ts`: zaključano (§7.3), u toku (§7.4),
// greška (§7.5), nema sajt (§7.6), otključano (§7.2). Nijedan prop ne kaže
// „ovo je greška" — greška je ono što ostane kad analize nema, a nema ni posla
// koji je pravi.
//
// ── pravilo 9, doslovno ─────────────────────────────────────
// Zaključan prospekt u pregledaču NEMA telefon, mejl, sajt, skor, signale ni
// analizu — `LockedLead` te ključeve ne nosi (test `apps/web/test/kartica.ts`
// proverava JSON). Maska se crta iz `lead.isUnlocked === false`, tekstom
// `••• ••• •••`. Nigde `filter: blur()`: stvarnog podatka ovde nema.
//
// ── odstupanje od §7.3, svesno ──────────────────────────────
// §7.3 kaže „jedno primarno dugme preko bloka poruke" PO KARTICI. Na listi od
// 20 kartica to je 20 primarnih dugmadi sa akcentnom senkom, a CLAUDE.md i
// DIZAJN-SISTEM §7.1 kažu „jedno primarno dugme po ekranu". Dugme „Otključaj"
// je zato `outline` koje na hover dobija akcentnu podlogu — isto kao dugme u
// tabeli koju kartica menja (v. SESIJE.md, S30).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Globe,
  ImageOff,
  KanbanSquare,
  Loader2,
  Lock,
  LockOpen,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Star,
  TriangleAlert,
} from "lucide-react";
import {
  PLANS,
  type AiSeverity,
  type LeadStatusValue,
  type MessageChannel,
  type OutreachResult,
} from "@sajtoskop/shared";
import { napisiVarijantu } from "@/lib/ai-varijanta";
import { cn } from "@/lib/cn";
import {
  analizaStigla,
  domenIzUrl,
  jeBezSajta,
  mapaUrl,
  podrazumevaniTab,
  predlogIzTelefona,
  skratiMejl,
  smeKontaktiran,
  stanjeKartice,
  TABOVI,
  type PosaoKartice,
  type StanjeKartice,
  type TabPoruke,
} from "@/lib/kartica";
import { KOLONA_LABEL, KOLONE } from "@/lib/pipeline-tipovi";
import type {
  ApiError,
  JobStatusResponse,
  PublicLead,
  UnlockedLead,
  UnlockResponse,
} from "@/lib/search-types";
import {
  BAND_LABEL,
  formatOcena,
  kartica,
  plural,
  STATUS_LABEL,
  telefonHref,
  telefonSaKanalom,
} from "@/lib/ui-tekst";
import { useOnboarding } from "./onboarding-provider";
import { PrijaviGresku } from "./prijavi-gresku";
import { usePristup } from "./pristup-provider";
import { SnimakPreklop } from "./snimak";
import { useUtisci } from "./utisci-provider";
import { VodjenaTacka } from "./vodjena-tacka";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

/** §7.4: provera na 3 s, najviše 20 puta (60 s). */
const POLL_MS = 3000;
const MAX_PROVERA = 20;
/** §7.5: „Pokušaj ponovo" najviše dvaput, pa ostaje samo „Prijavi grešku". */
const MAX_POKUSAJA = 2;
/** Koliko dugo tost posle kopiranja stoji na kartici. */
const TOST_MS = 15_000;

/** „Ne pitaj me više danas" — jedini dozvoljen klijentski trag (§7.3). */
const BEZ_POTVRDE_KLJUC = "sajtoskop-otkljucaj-bez-potvrde";

const pauza = (ms: number) => new Promise((r) => setTimeout(r, ms));

function danas(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function bezPotvrdeDanas(): boolean {
  try {
    return window.sessionStorage.getItem(BEZ_POTVRDE_KLJUC) === danas();
  } catch {
    return false;
  }
}

function zapamtiBezPotvrde(): void {
  try {
    window.sessionStorage.setItem(BEZ_POTVRDE_KLJUC, danas());
  } catch {
    /* privatni prozor — potvrda se prosto javi ponovo */
  }
}

export type KarticaProps = {
  lead: PublicLead;
  cityLabel: string;
  /** Zbir obe kase — tekst dugmeta i modal potvrde. */
  krediti: number;
  /** §4.4, računa server. */
  prviBesplatan?: boolean;
  /** Živ posao analize kad strana stigne sa servera (§7.4, „napušta stranu usred"). */
  enrichJobId?: number | null;
  /** Mesto u pipeline-u (§7.2). `null` = nema reda, dakle „Nekontaktiran". */
  pipelineStatus?: LeadStatusValue | null;
  /** Drugi prospekt se upravo otključava — „jedan po jedan". */
  zauzeto?: boolean;
  /** Ova kartica nosi tačku 1 (prvi bedž „Nema sajt" u listi, §4.5). */
  kandidatNemaSajt?: boolean;
  /** Ova kartica nosi tačku 2 (§4.5). */
  kandidatOtkljucaj?: boolean;
  onOtkljucavanje?: (placeId: string | null) => void;
  onZameni?: (lead: UnlockedLead) => void;
  onKrediti?: (n: number) => void;
  /** Novo otključavanje — kredit je stvarno potrošen. */
  onNovoOtkljucano?: () => void;
  /** „Sledeći prospekt" iz praznog stanja „Sajt izgleda solidno" (§4.7). */
  onSledeci?: () => void;
};

export function KarticaProspekta(props: KarticaProps) {
  const {
    lead,
    cityLabel,
    krediti,
    prviBesplatan = false,
    pipelineStatus = null,
    zauzeto = false,
    kandidatNemaSajt = false,
    kandidatOtkljucaj = false,
  } = props;
  const placeId = lead.placeId;

  const router = useRouter();
  const pristupApi = usePristup();
  const onboarding = useOnboarding();

  const [otkljucavam, setOtkljucavam] = useState(false);
  const [posao, setPosao] = useState<PosaoKartice>(() => ({
    id: props.enrichJobId ?? null,
    ishod: props.enrichJobId ? "radi" : null,
  }));
  const [pokusaja, setPokusaja] = useState(0);
  const [modal, setModal] = useState<"potvrda" | "plan" | null>(null);
  const [nePitaj, setNePitaj] = useState(false);
  const [greska, setGreska] = useState<string | null>(null);
  const [obavestenje, setObavestenje] = useState<string | null>(null);
  const [preklop, setPreklop] = useState(false);
  const [status, setStatus] = useState<LeadStatusValue | null>(pipelineStatus);

  useEffect(() => setStatus(pipelineStatus), [pipelineStatus]);

  // Povratni pozivi roditelja menjaju identitet na svakom renderu liste; kartica
  // ih čita iz ref-a, da polling ne bi kretao iznova.
  const povratni = useRef(props);
  useEffect(() => {
    povratni.current = props;
  });

  const stanje = stanjeKartice(lead, posao, otkljucavam);

  // ── tačke ćute dok je modal ili preklop otvoren (§4.5) ─────
  const postaviZauzeto = onboarding?.postaviZauzeto;
  useEffect(() => {
    const izvor = `kartica:${placeId}`;
    postaviZauzeto?.(izvor, modal !== null || preklop);
    return () => postaviZauzeto?.(izvor, false);
  }, [postaviZauzeto, modal, preklop, placeId]);

  // ── posle `done`: isti POST, bez kredita, vraća pun lead (§7.4) ─
  const osveziLead = useCallback(async () => {
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId }),
      });
      if (!res.ok) {
        setPosao((p) => ({ id: p.id, ishod: "pao" }));
        return;
      }
      const o = (await res.json()) as UnlockResponse;
      povratni.current.onZameni?.(o.lead);
      setPosao({ id: o.enrichJobId, ishod: o.enrichJobId !== null ? "radi" : null });
    } catch {
      setPosao((p) => ({ id: p.id, ishod: "pao" }));
    }
  }, [placeId]);

  // ── polling posla analize (§7.4) ────────────────────────────
  useEffect(() => {
    if (posao.id === null || posao.ishod !== "radi") return;
    const jobId = posao.id;
    let ziv = true;

    void (async () => {
      let provera = 0;
      while (ziv && provera < MAX_PROVERA) {
        await pauza(POLL_MS);
        if (!ziv) return;
        // Skriven tab ne troši proveru (isto kao pretraga, Faza 4, 4.11).
        if (document.hidden) continue;
        provera++;

        let st: JobStatusResponse;
        try {
          const res = await fetch(`/api/job/${jobId}`, { cache: "no-store" });
          if (!res.ok) {
            if (ziv) setPosao({ id: jobId, ishod: "pao" });
            return;
          }
          st = (await res.json()) as JobStatusResponse;
        } catch {
          continue;
        }
        if (!ziv) return;

        if (st.status === "done") {
          await osveziLead();
          return;
        }
        if (st.status === "failed") {
          setPosao({ id: jobId, ishod: "pao" });
          return;
        }
      }
      if (ziv) setPosao({ id: jobId, ishod: "predugo" });
    })();

    return () => {
      ziv = false;
    };
  }, [posao.id, posao.ishod, osveziLead]);

  // ── otključavanje ───────────────────────────────────────────
  async function otkljucaj(ponovi = false) {
    if (otkljucavam) return;

    setModal(null);
    setGreska(null);
    setObavestenje(null);
    setOtkljucavam(true);
    povratni.current.onOtkljucavanje?.(placeId);

    // §7.3, korak 3: optimistično — čip kredita odmah −1. Ponovni pokušaj ne
    // troši kredit, pa ga ni ne skida.
    const pre = krediti;
    if (!ponovi) povratni.current.onKrediti?.(Math.max(0, krediti - 1));

    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ponovi ? { placeId, ponovi: true } : { placeId }),
      });
      const json = (await res.json()) as UnlockResponse | ApiError;

      if (!res.ok) {
        povratni.current.onKrediti?.(pre);
        // §7.3, korak 4: 402 → modal sa planovima; 403 → tekst odbijenice;
        // 500 → „Nema veze sa serverom…" uz „Prijavi grešku".
        if (res.status === 402) {
          setModal("plan");
        } else if (res.status >= 500) {
          setGreska(kartica.nemaVeze);
        } else {
          setGreska("greska" in json ? json.greska : kartica.nemaVeze);
        }
        return;
      }

      const o = json as UnlockResponse;
      povratni.current.onZameni?.(o.lead);
      povratni.current.onKrediti?.(o.creditsLeft);
      onboarding?.osvezi(o.onboardingSteps);
      // §7.3, korak 5: tačka 2 nestaje — radnja je urađena.
      onboarding?.zatvori("otkljucaj");

      if (ponovi) setPokusaja((n) => n + 1);
      setPosao({
        id: o.enrichJobId,
        ishod: o.enrichJobId !== null ? "radi" : ponovi ? "pao" : null,
      });

      if (o.alreadyUnlocked && !ponovi) setObavestenje(kartica.vecOtkljucan(o.lead.name));
      if (!o.alreadyUnlocked) {
        povratni.current.onNovoOtkljucano?.();
        // Balans u bočnoj traci crta serverski layout.
        router.refresh();
      }
    } catch {
      povratni.current.onKrediti?.(pre);
      setGreska(kartica.nemaVeze);
    } finally {
      setOtkljucavam(false);
      povratni.current.onOtkljucavanje?.(null);
    }
  }

  const graceNalog = pristupApi?.pristup ? !pristupApi.pristup.pun : false;

  function klikOtkljucaj() {
    onboarding?.zatvori("nema-sajt");
    if (graceNalog) {
      router.push("/cenovnik");
      return;
    }
    if (krediti <= 0) {
      setModal("plan");
      return;
    }
    // §7.3, korak 1: besplatno otključavanje ne otvara modal — trošak za
    // korisnika je nula.
    if (prviBesplatan || bezPotvrdeDanas()) {
      void otkljucaj();
      return;
    }
    setNePitaj(false);
    setModal("potvrda");
  }

  const labelaDugmeta = otkljucavam
    ? kartica.otkljucavam
    : graceNalog
      ? kartica.otkljucajVrati
      : krediti <= 0
        ? kartica.otkljucajPlan
        : prviBesplatan
          ? kartica.otkljucajBesplatno
          : kartica.otkljucaj;

  return (
    <article
      id={`kartica-${placeId}`}
      className="relative flex flex-col rounded-2xl border border-border bg-bg-elev shadow-sm"
    >
      {/* Rail nosi kvalitet prospekta i vidi se pre nego što se pročita ijedno slovo. */}
      <span
        aria-hidden
        className={cn("absolute inset-y-4 left-0 w-[3px] rounded-r-full", railBoja(lead.siteStatus))}
      />

      <Zaglavlje lead={lead} cityLabel={cityLabel} kandidatNemaSajt={kandidatNemaSajt} />

      <Kontakti lead={lead} />

      <Problemi
        lead={lead}
        stanje={stanje}
        predugo={posao.ishod === "predugo"}
        otvoriSnimak={() => setPreklop(true)}
        ponovo={
          lead.isUnlocked && pokusaja < MAX_POKUSAJA && !otkljucavam
            ? () => void otkljucaj(true)
            : null
        }
        ctxGreske={{
          placeId,
          ...(posao.id !== null ? { jobId: String(posao.id) } : {}),
        }}
      />

      {obavestenje && (
        <p role="status" className="mx-5 mb-3 rounded-lg bg-bg-subtle px-3 py-2 text-xs text-fg-muted">
          {obavestenje}
        </p>
      )}

      {lead.isUnlocked ? (
        <BlokPoruke
          lead={lead}
          status={status}
          promeniStatus={setStatus}
          onSledeci={props.onSledeci}
        />
      ) : (
        <section className="rounded-b-2xl border-t border-border bg-bg-subtle px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">{kartica.poruka}</p>
            {/* Tab koji bi bio podrazumevan — iz tipa telefona, koji je javan. */}
            <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-fg-faint">
              {kartica.kanal[predlogIzTelefona(lead.phoneType)]}
            </span>
          </div>

          <div aria-hidden className="mt-3 space-y-1.5 select-none">
            {["w-full", "w-11/12", "w-2/3"].map((w) => (
              <p key={w} className={cn("num truncate text-sm leading-relaxed text-fg-faint", w)}>
                •••••••••••••••••••••••••••••••••••••••••••••••••••••••••
              </p>
            ))}
          </div>

          <VodjenaTacka hint="otkljucaj" kandidat={kandidatOtkljucaj} className="mt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full hover:border-accent hover:bg-accent hover:text-accent-ink"
              disabled={otkljucavam || (zauzeto && !otkljucavam)}
              onClick={klikOtkljucaj}
            >
              {otkljucavam ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Lock aria-hidden />
              )}
              {labelaDugmeta}
            </Button>
          </VodjenaTacka>
          <p className="mt-2 text-center text-xs text-fg-muted">{kartica.otkljucajOpis}</p>

          {greska && (
            <div role="alert" className="mt-3 rounded-lg border border-danger/25 bg-danger-wash px-3 py-2 text-xs text-danger">
              {greska}{" "}
              <PrijaviGresku ctx={{ placeId, greska }} className="ml-1 align-middle" />
            </div>
          )}
        </section>
      )}

      {/* §7.3, korak 2: potvrda „1 kredit". */}
      <Dialog open={modal === "potvrda"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="mb-0 mt-auto max-w-md sm:my-auto">
          <DialogHeader>
            <DialogTitle className="whitespace-normal">{kartica.potvrdaNaslov(lead.name)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm leading-relaxed text-fg-muted">
              {kartica.potvrdaTekst(Math.max(0, krediti - 1))}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nePitaj}
                onChange={(e) => setNePitaj(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              {kartica.nePitajDanas}
            </label>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setModal(null)}>
              {kartica.odustani}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                if (nePitaj) zapamtiBezPotvrde();
                void otkljucaj();
              }}
            >
              {kartica.potvrdaDugme}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* §7.3: bez kredita → planovi. */}
      <Dialog open={modal === "plan"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="mb-0 mt-auto max-w-md sm:my-auto">
          <DialogHeader>
            <DialogTitle className="whitespace-normal">{kartica.potvrdaNaslov(lead.name)}</DialogTitle>
            <DialogDescription>{kartica.nemaKredita}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 px-5 py-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setModal(null)}>
              {kartica.odustani}
            </Button>
            <Button asChild variant="primary">
              <Link href="/cenovnik">{kartica.pogledajPlanove}</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {preklop && lead.isUnlocked && (
        <SnimakPreklop lead={lead} onClose={() => setPreklop(false)} />
      )}
    </article>
  );
}

// ═══════════════════════════════════════════════════════════
// ZAGLAVLJE
// ═══════════════════════════════════════════════════════════

function railBoja(status: PublicLead["siteStatus"]): string {
  switch (status) {
    case "nema_sajt":
      return "bg-accent";
    case "mrtav":
      return "bg-warn";
    case "samo_drustvene":
      return "bg-info";
    default:
      return "bg-transparent";
  }
}

const BEND_STIL = {
  solidan: "bg-score-ok-bg text-score-ok",
  osrednji: "bg-score-mid-bg text-score-mid",
  ruzan: "bg-score-ugly-bg text-score-ugly",
  katastrofa: "bg-score-cat-bg text-score-cat",
} as const;

function StatusBedz({ lead }: { lead: PublicLead }) {
  const ikona = lead.isUnlocked ? <LockOpen className="h-3 w-3" aria-hidden /> : null;
  const osnova =
    "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] font-medium";

  if (!lead.siteStatus) {
    return <span className={cn(osnova, "bg-bg-inset text-fg-muted")}>{ikona}—</span>;
  }

  if (lead.siteStatus === "ok") {
    return (
      <span
        className={cn(osnova, lead.uglyBand ? BEND_STIL[lead.uglyBand] : "bg-bg-inset text-fg-muted")}
      >
        {ikona}
        {lead.uglyBand ? BAND_LABEL[lead.uglyBand] : STATUS_LABEL.ok}
        {lead.platform && <span className="font-normal opacity-80">· {lead.platform}</span>}
      </span>
    );
  }

  const jak =
    lead.siteStatus === "nema_sajt"
      ? "bg-accent text-accent-ink"
      : lead.siteStatus === "mrtav"
        ? "bg-warn text-warn-ink"
        : "bg-info text-info-ink";

  return (
    <span className={cn(osnova, "font-semibold uppercase tracking-wider", jak)}>
      {ikona}
      {STATUS_LABEL[lead.siteStatus]}
    </span>
  );
}

function Zaglavlje({
  lead,
  cityLabel,
  kandidatNemaSajt,
}: {
  lead: PublicLead;
  cityLabel: string;
  kandidatNemaSajt: boolean;
}) {
  const podnaslov = [lead.nicheLabel, cityLabel].filter(Boolean).join(" · ");

  return (
    <header className="flex flex-col gap-2 pb-3 pl-5 pr-5 pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h3 className="line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.025em]">
          {lead.name}
        </h3>
        {podnaslov && <p className="mt-0.5 text-[13px] text-fg-muted">{podnaslov}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span className="num inline-flex items-center gap-1">
            {lead.rating !== null ? (
              <>
                <Star className="h-3 w-3 fill-warn text-warn" aria-hidden />
                {formatOcena(lead.rating)}
                {lead.ratingCount !== null &&
                  ` · ${lead.ratingCount} ${plural(
                    lead.ratingCount,
                    kartica.recenzija[1],
                    kartica.recenzija[2],
                    kartica.recenzija[5],
                  )}`}
              </>
            ) : (
              kartica.bezOcena
            )}
          </span>
          <a
            href={mapaUrl(lead.placeId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-4 transition-colors hover:text-fg hover:underline"
          >
            <MapPin className="h-3 w-3" aria-hidden />
            {kartica.mapa}
          </a>
        </p>
      </div>

      <VodjenaTacka
        hint="nema-sajt"
        kandidat={kandidatNemaSajt && lead.siteStatus === "nema_sajt"}
        className="self-start sm:shrink-0"
      >
        <StatusBedz lead={lead} />
      </VodjenaTacka>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════
// KONTAKTI
// ═══════════════════════════════════════════════════════════

function Polje({
  Ikona,
  naslov,
  href,
  spoljni = false,
  title,
  children,
}: {
  Ikona: typeof Phone;
  naslov: string;
  href?: string | null;
  spoljni?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  // ≤ 390 px: red sa ikonom i eyebrow-om levo, vrednošću desno, cela linija je
  // meta (≥ 44 px, §7.7). Od `sm` tri kolone, vrednost ispod labele.
  const klase =
    "flex min-h-11 items-center justify-between gap-3 px-5 py-2.5 sm:flex-col sm:items-start sm:justify-start sm:gap-1 sm:py-3";
  const sadrzaj = (
    <>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-fg-faint">
        <Ikona className="h-3 w-3" aria-hidden />
        {naslov}
      </span>
      <span className="min-w-0 text-right sm:w-full sm:text-left">{children}</span>
    </>
  );

  if (!href) return <div className={klase}>{sadrzaj}</div>;

  return (
    <a
      href={href}
      title={title}
      {...(spoljni ? { target: "_blank", rel: "noreferrer noopener nofollow" } : {})}
      className={cn(klase, "transition-colors hover:bg-bg-subtle")}
    >
      {sadrzaj}
    </a>
  );
}

function Maska({ children }: { children: string }) {
  return (
    <span aria-label="zaključano" className="num block select-none text-[15px] text-fg-faint">
      {children}
    </span>
  );
}

function Nema({ children }: { children: string }) {
  return <span className="block text-[13px] text-fg-muted">{children}</span>;
}

function Kontakti({ lead }: { lead: PublicLead }) {
  const tip = telefonSaKanalom(lead.phoneType);
  const dopuna = tip && (
    <span
      className={cn(
        "block text-[11px]",
        lead.phoneType === "mobilni" ? "text-accent-text" : "text-fg-muted",
      )}
    >
      {tip}
    </span>
  );

  // ── telefon ──
  const telefon = lead.isUnlocked ? (
    <Polje
      Ikona={Phone}
      naslov={kartica.telefon}
      href={lead.phone ? telefonHref(lead.phone, lead.phoneType) : null}
    >
      {lead.phone ? (
        <span className="num block truncate text-[15px] font-medium text-fg">{lead.phone}</span>
      ) : (
        <Nema>{kartica.nemaBroj}</Nema>
      )}
      {lead.phone && dopuna}
    </Polje>
  ) : (
    <Polje Ikona={Phone} naslov={kartica.telefon}>
      {/* Tip telefona je javan (`phone_type`); bez tipa broja nema. */}
      {lead.phoneType ? <Maska>06• ••• ••••</Maska> : <Nema>{kartica.nemaBroj}</Nema>}
      {dopuna}
    </Polje>
  );

  // ── mejl ──
  const mejl = lead.isUnlocked ? (
    <Polje
      Ikona={Mail}
      naslov={kartica.mejl}
      href={lead.email ? `mailto:${lead.email}` : null}
      title={lead.email ?? undefined}
    >
      {lead.email ? (
        <span className="num block truncate text-[15px] text-fg">{skratiMejl(lead.email)}</span>
      ) : (
        <Nema>{kartica.nemaMejl}</Nema>
      )}
    </Polje>
  ) : (
    <Polje Ikona={Mail} naslov={kartica.mejl}>
      {lead.hasEmail ? <Maska>•••••@•••••</Maska> : <Nema>{kartica.nemaMejl}</Nema>}
    </Polje>
  );

  // ── sajt ──
  let sajt: React.ReactNode;
  if (!lead.hasWebsite || lead.siteStatus === "nema_sajt") {
    sajt = (
      <Polje Ikona={Globe} naslov={kartica.sajt}>
        <Nema>{kartica.nemaDomen}</Nema>
      </Polje>
    );
  } else if (!lead.isUnlocked) {
    sajt = (
      <Polje Ikona={Globe} naslov={kartica.sajt}>
        <Maska>•••••.rs</Maska>
      </Polje>
    );
  } else if (lead.siteStatus === "samo_drustvene") {
    sajt = (
      <Polje Ikona={Globe} naslov={kartica.sajt} href={lead.websiteUrl} spoljni>
        <Nema>{kartica.samoMreze}</Nema>
      </Polje>
    );
  } else {
    const domen = lead.websiteUrl ? domenIzUrl(lead.websiteUrl) : "";
    sajt = (
      <Polje Ikona={Globe} naslov={kartica.sajt} href={lead.websiteUrl} spoljni title={lead.websiteUrl ?? undefined}>
        <span className="num block truncate text-[15px] text-fg">{domen}</span>
        {lead.siteStatus === "mrtav" && (
          <span className="block text-[11px] text-warn-text">{kartica.neOdgovara}</span>
        )}
      </Polje>
    );
  }

  return (
    <div className="grid grid-cols-1 divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {telefon}
      {mejl}
      {sajt}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PROBLEMI I SLIČICA
// ═══════════════════════════════════════════════════════════

const SEVERITY_BOJA: Record<AiSeverity, string> = {
  visoka: "text-warn-text",
  srednja: "text-warn-text",
  niska: "text-fg-muted",
};

function Red({ children, boja = "text-fg-faint" }: { children: React.ReactNode; boja?: string }) {
  return (
    <li className="flex gap-2 text-[13.5px] leading-snug text-fg-muted">
      <TriangleAlert className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", boja)} aria-hidden />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Signali({ lead, max = 4 }: { lead: UnlockedLead; max?: number }) {
  if (lead.signals.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {lead.signals.slice(0, max).map((s) => (
        <Red key={s}>{s}</Red>
      ))}
    </ul>
  );
}

function Slicica({
  lead,
  stanje,
  otvori,
}: {
  lead: PublicLead;
  stanje: StanjeKartice;
  otvori: () => void;
}) {
  const okvir = "h-16 w-10 shrink-0 overflow-hidden rounded-md border border-border";

  if (stanje === "u_toku") {
    return <span aria-hidden className={cn(okvir, "animate-puls-tanko bg-bg-inset")} />;
  }

  if (stanje === "zakljucano") {
    return (
      <span aria-hidden className={cn(okvir, "grid place-items-center bg-bg-inset text-fg-faint")}>
        <Lock className="h-3.5 w-3.5" />
      </span>
    );
  }

  if (stanje === "nema_sajt") {
    // §7.6: precrtan `Globe` u istoj dimenziji, da se raspored ne pomera.
    return (
      <span aria-hidden className={cn(okvir, "relative grid place-items-center bg-bg-inset text-fg-faint")}>
        <Globe className="h-4 w-4" />
        <span className="absolute h-px w-9 -rotate-[60deg] bg-fg-faint" />
      </span>
    );
  }

  const url = lead.isUnlocked ? (lead.screenshot?.mobile ?? lead.screenshot?.desktop ?? null) : null;

  if (url) {
    return (
      <button
        type="button"
        onClick={otvori}
        title="Otvori snimke i analizu sajta"
        className={cn(okvir, "transition-colors hover:border-accent")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- potpisan URL sa rokom
            od 15 min; next/image bi ga keširao posle isteka potpisa (v. snimak.tsx). */}
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
      </button>
    );
  }

  return (
    <span
      title={stanje === "otkljucano" ? kartica.snimakNijeSacuvan : undefined}
      className={cn(okvir, "grid place-items-center border-dashed text-fg-faint")}
    >
      <ImageOff className="h-3.5 w-3.5" aria-hidden />
      {stanje === "otkljucano" && <span className="sr-only">{kartica.snimakNijeSacuvan}</span>}
    </span>
  );
}

function Problemi({
  lead,
  stanje,
  predugo,
  otvoriSnimak,
  ponovo,
  ctxGreske,
}: {
  lead: PublicLead;
  stanje: StanjeKartice;
  predugo: boolean;
  otvoriSnimak: () => void;
  /** „Pokušaj ponovo" — `null` kad više ne sme (§7.5, najviše dvaput). */
  ponovo: (() => void) | null;
  ctxGreske: { placeId: string; jobId?: string };
}) {
  let sadrzaj: React.ReactNode;

  if (stanje === "nema_sajt" && lead.isUnlocked) {
    sadrzaj = (
      <>
        <p className="eyebrow">{kartica.zastoDobar}</p>
        <p className="mt-2 text-[13.5px] leading-snug text-fg-muted">
          <ZastoDobar lead={lead} />
        </p>
      </>
    );
  } else if (stanje === "zakljucano" || (stanje === "u_toku" && !lead.isUnlocked)) {
    const bezSajta = jeBezSajta(lead) && lead.siteStatus !== "mrtav" && lead.siteStatus !== "samo_drustvene";
    sadrzaj = (
      <>
        <p className="eyebrow">
          {kartica.problemi}
          {!bezSajta && lead.issueCount !== null && lead.issueCount > 0 && (
            <span className="num ml-2 normal-case tracking-normal text-fg-muted">
              {kartica.brojProblema(lead.issueCount)}
            </span>
          )}
        </p>
        {stanje === "u_toku" ? (
          <p className="mt-2 flex items-center gap-2 text-[13.5px] text-fg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {kartica.otkljucavam}
          </p>
        ) : bezSajta ? (
          <ul className="mt-2">
            <Red boja="text-accent-text">{kartica.nemaSajtProblem}</Red>
          </ul>
        ) : (
          // Statična maska — četiri reda različite dužine, nijedan nije podatak.
          <ul aria-hidden className="mt-2 space-y-1.5 select-none">
            {["w-10/12", "w-8/12", "w-11/12", "w-7/12"].map((w) => (
              <li key={w} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" />
                <span className={cn("num truncate text-[13.5px] text-fg-faint", w)}>
                  ••••••••••••••••••••••••••••••••••••
                </span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else if (stanje === "u_toku" && lead.isUnlocked) {
    sadrzaj = (
      <>
        <p className="eyebrow">{kartica.problemi}</p>
        <p className="mt-2 flex items-start gap-2 text-[13.5px] text-fg-muted">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          {kartica.analiziram}
        </p>
        {/* Nije laž: HTML provera (`enrich_basic`) je već prošla (§7.4). */}
        <Signali lead={lead} />
      </>
    );
  } else if (stanje === "greska" && lead.isUnlocked) {
    const tekst = predugo ? kartica.analizaDuze : kartica.analizaPala;
    sadrzaj = (
      <>
        <p className="eyebrow">{kartica.problemi}</p>
        <p className="mt-2 text-[13.5px] leading-snug text-fg">{tekst}</p>
        <Signali lead={lead} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {ponovo && (
            <Button type="button" variant="outline" size="sm" onClick={ponovo}>
              {kartica.pokusajPonovo}
            </Button>
          )}
          {/* [S29 §5.3 D] Šesto mesto za „Prijavi grešku" — kartica u stanju greške. */}
          <PrijaviGresku ctx={{ ...ctxGreske, greska: tekst }} label={kartica.prijaviGresku} />
        </div>
      </>
    );
  } else if (lead.isUnlocked) {
    // Otključano, analiza stigla (bar delimično).
    const ai = lead.aiIssues;
    sadrzaj = (
      <>
        <p className="eyebrow">{kartica.problemi}</p>
        {ai !== null ? (
          ai.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {ai.slice(0, 5).map((p, i) => (
                <Red key={`${p.title}-${i}`} boja={SEVERITY_BOJA[p.severity]}>
                  {p.title}
                </Red>
              ))}
            </ul>
          ) : (
            <Signali lead={lead} />
          )
        ) : (
          <>
            <Signali lead={lead} />
            <p className="mt-2 text-xs text-fg-muted">{kartica.aiPao}</p>
            {ponovo && (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={ponovo}>
                {kartica.pokusajPonovo}
              </Button>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <section className="flex gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">{sadrzaj}</div>
      <Slicica lead={lead} stanje={stanje} otvori={otvoriSnimak} />
    </section>
  );
}

/** §7.6 — „Zašto je ovo dobar prospekt", po statusu. */
function ZastoDobar({ lead }: { lead: UnlockedLead }) {
  if (lead.siteStatus === "mrtav" && lead.websiteUrl) {
    return (
      <>
        {kartica.zastoMrtav.pre}
        <strong className="num font-semibold text-fg">{domenIzUrl(lead.websiteUrl)}</strong>
        {kartica.zastoMrtav.posle}
      </>
    );
  }
  if (lead.siteStatus === "samo_drustvene") return <>{kartica.zastoSamoMreze}</>;
  if (lead.rating !== null && lead.ratingCount !== null) {
    return (
      <>
        {kartica.zastoNemaSajt.pre}
        <strong className="num font-semibold text-fg">
          {kartica.zastoNemaSajt.ocena(formatOcena(lead.rating), lead.ratingCount)}
        </strong>
        {kartica.zastoNemaSajt.posle}
      </>
    );
  }
  return <>{kartica.nemaSajtProblem}</>;
}

// ═══════════════════════════════════════════════════════════
// PREDLOG PORUKE
// ═══════════════════════════════════════════════════════════

type OdgovorPoruka = OutreachResult & { naziv: string };

/** Clipboard pa `execCommand` (§1.11: HTTPS i stari pregledač). */
async function uClipboard(tekst: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(tekst);
    return true;
  } catch {
    /* pada na rezervu */
  }
  try {
    const polje = document.createElement("textarea");
    polje.value = tekst;
    polje.setAttribute("readonly", "");
    polje.style.position = "fixed";
    polje.style.opacity = "0";
    document.body.appendChild(polje);
    polje.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(polje);
    return ok;
  } catch {
    return false;
  }
}

/** Poslednja rezerva: tekst ostaje selektovan, pa ga čovek kopira sam. */
function selektuj(el: HTMLElement | null): void {
  if (!el) return;
  const sel = window.getSelection();
  if (!sel) return;
  const opseg = document.createRange();
  opseg.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(opseg);
}

function BlokPoruke({
  lead,
  status,
  promeniStatus,
  onSledeci,
}: {
  lead: UnlockedLead;
  status: LeadStatusValue | null;
  promeniStatus: (s: LeadStatusValue | null) => void;
  onSledeci?: () => void;
}) {
  const onboarding = useOnboarding();
  const utisci = useUtisci();
  const pristupApi = usePristup();

  const okvir = useRef<HTMLElement>(null);
  const tekstRef = useRef<HTMLPreElement>(null);
  const trakaTabova = useRef<HTMLDivElement>(null);

  // Poruke se povlače tek kad kartica uđe u vidokrug: `/lista` ume da ima
  // stotine kartica, a generisanje je besplatno samo dok se ne radi 600 puta.
  const [vidljiv, setVidljiv] = useState(false);
  useEffect(() => {
    const el = okvir.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVidljiv(true);
      return;
    }
    const posmatrac = new IntersectionObserver(
      (unosi) => {
        if (unosi.some((u) => u.isIntersecting)) {
          setVidljiv(true);
          posmatrac.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    posmatrac.observe(el);
    return () => posmatrac.disconnect();
  }, []);

  const [odgovor, setOdgovor] = useState<OdgovorPoruka | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [tab, setTab] = useState<TabPoruke | null>(null);
  const [imaNoviju, setImaNoviju] = useState(false);
  const [varijante, setVarijante] = useState<Partial<Record<MessageChannel, string>>>({});
  const [ai, setAi] = useState<{ radi: boolean; greska: string | null }>({ radi: false, greska: null });
  const [kopirano, setKopirano] = useState(false);
  const [tost, setTost] = useState(false);
  const [upisujem, setUpisujem] = useState(false);
  const [greskaUpisa, setGreskaUpisa] = useState<string | null>(null);

  const stigla = analizaStigla(lead);
  const ucitanoSaAnalizom = useRef<boolean | null>(null);
  const kanalCarobnjaka = onboarding?.kanal ?? null;

  const ucitaj = useCallback(async () => {
    setGreska(null);
    try {
      const res = await fetch(`/api/poruke?placeId=${encodeURIComponent(lead.placeId)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as OdgovorPoruka | ApiError;
      if (!res.ok) {
        setGreska((json as ApiError).greska ?? "Poruke nisu dostupne.");
        return;
      }
      const o = json as OdgovorPoruka;
      setOdgovor(o);
      setVarijante({});
      setImaNoviju(false);
      ucitanoSaAnalizom.current = analizaStigla(lead);
      if (o.ok) setTab((t) => t ?? podrazumevaniTab(kanalCarobnjaka, lead, o.predlog));
    } catch {
      setGreska("Nema veze sa serverom.");
    }
  }, [lead, kanalCarobnjaka]);

  useEffect(() => {
    if (vidljiv && odgovor === null && greska === null) void ucitaj();
  }, [vidljiv, odgovor, greska, ucitaj]);

  // §7.4: kad AI stigne, tekst se NE menja sam — čovek možda upravo kopira.
  useEffect(() => {
    if (odgovor && ucitanoSaAnalizom.current === false && stigla) setImaNoviju(true);
  }, [odgovor, stigla]);

  useEffect(() => {
    if (!kopirano) return;
    const t = setTimeout(() => setKopirano(false), 2000);
    return () => clearTimeout(t);
  }, [kopirano]);

  useEffect(() => {
    if (!tost) return;
    const t = setTimeout(() => setTost(false), TOST_MS);
    return () => clearTimeout(t);
  }, [tost]);

  // §7.7: aktivni tab ne sme da bude van vidokruga u traci koja skroluje.
  useEffect(() => {
    trakaTabova.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const aktivni: TabPoruke = tab ?? "mejl";
  const kanalTeksta: MessageChannel = aktivni === "poziv" ? "viber" : aktivni;
  const ok = odgovor?.ok ? odgovor : null;
  const poruka = ok ? ok.poruke[kanalTeksta] : null;
  const telo = varijante[kanalTeksta] ?? poruka?.body ?? "";
  const naslovMejla = aktivni === "mejl" ? poruka?.subject : undefined;
  const aiLimit = PLANS[pristupApi?.pristup?.planLimita ?? "dopuna"].aiRewritePerDay;

  async function kopiraj() {
    const tekst = naslovMejla ? `${naslovMejla}\n\n${telo}` : telo;
    if (!(await uClipboard(tekst))) {
      selektuj(tekstRef.current);
      return;
    }
    setKopirano(true);
    setGreskaUpisa(null);
    setTost(true);
    onboarding?.prijaviKopiranje();
    onboarding?.zatvori("poruka");
    // [S29] Okidač `poruka-kvalitet` je prvo kopiranje BILO KOJE poruke.
    utisci?.prijaviDogadjaj("poruka-kvalitet", {
      izvor: varijante[kanalTeksta] ? "ai" : "sablon",
      kanal: aktivni,
    });
  }

  async function upisiStatus(novi: LeadStatusValue, kanal?: TabPoruke): Promise<boolean> {
    const pre = status;
    promeniStatus(novi);
    try {
      const res = await fetch("/api/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: lead.placeId, status: novi, ...(kanal ? { channel: kanal } : {}) }),
      });
      const json = (await res.json()) as { onboardingSteps?: Record<string, string> } | ApiError;
      if (!res.ok) {
        promeniStatus(pre);
        setGreskaUpisa("greska" in json ? json.greska : "Izmena trenutno ne radi.");
        return false;
      }
      onboarding?.osvezi("onboardingSteps" in json ? json.onboardingSteps : undefined);
      return true;
    } catch {
      promeniStatus(pre);
      setGreskaUpisa("Nema veze sa serverom.");
      return false;
    }
  }

  async function kontaktiran() {
    setUpisujem(true);
    const uspeh = await upisiStatus("kontaktiran", aktivni);
    setUpisujem(false);
    if (uspeh) {
      onboarding?.zatvori("pipeline");
      setTost(false);
    }
  }

  async function drugacije() {
    if (aktivni === "poziv") return;
    const kanal = aktivni;
    setAi({ radi: true, greska: null });
    const ishod = await napisiVarijantu(lead.placeId, kanal);
    if (ishod.ok) {
      setVarijante((v) => ({ ...v, [kanal]: ishod.body }));
      setAi({ radi: false, greska: null });
    } else {
      setAi({ radi: false, greska: ishod.status === 429 ? kartica.aiLimit(aiLimit) : ishod.greska });
    }
  }

  const solidan = odgovor !== null && !odgovor.ok && (odgovor.razlog === "solidan" || lead.aiSolidan === true);

  return (
    <section ref={okvir} className="rounded-b-2xl border-t border-border bg-bg-subtle px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">{kartica.poruka}</p>
        <div className="flex items-center gap-2">
          <label className="relative inline-flex items-center">
            <span className="sr-only">Pipeline</span>
            <KanbanSquare className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-fg-faint" aria-hidden />
            <select
              value={status ?? "nekontaktiran"}
              onChange={(e) => void upisiStatus(e.target.value as LeadStatusValue)}
              className="h-8 rounded-lg border border-border-strong bg-bg-elev pl-7 pr-2 text-xs text-fg transition-colors hover:border-fg-muted"
            >
              {KOLONE.map((k) => (
                <option key={k} value={k}>
                  {KOLONA_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {ok && (
            <Button type="button" variant="outline" size="sm" onClick={() => void kopiraj()}>
              {kopirano ? <Check className="text-accent-text" aria-hidden /> : <Copy aria-hidden />}
              {kopirano ? kartica.kopirano : kartica.kopiraj}
            </Button>
          )}
        </div>
      </div>

      {odgovor === null && greska === null && (
        <div aria-hidden className="mt-3 space-y-2">
          <div className="h-7 w-56 animate-puls-tanko rounded-full bg-bg-inset" />
          <div className="h-16 animate-puls-tanko rounded-lg bg-bg-inset" />
        </div>
      )}

      {greska && <p className="mt-3 text-sm text-fg-muted">{greska}</p>}

      {solidan && (
        <div className="mt-3 rounded-xl border border-dashed border-border bg-bg-elev px-4 py-4 text-center">
          <p className="text-sm font-medium">{kartica.solidan}</p>
          <p className="mt-1 text-sm text-fg-muted">{kartica.solidanOpis}</p>
          {onSledeci && (
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onSledeci}>
              {kartica.sledeciProspekt}
            </Button>
          )}
        </div>
      )}

      {odgovor !== null && !odgovor.ok && !solidan && (
        <p className="mt-3 text-sm text-fg-muted">{odgovor.poruka}</p>
      )}

      {ok && (
        <>
          {!lead.phone && !lead.email && (
            <div className="mt-3 rounded-xl border border-dashed border-border bg-bg-elev px-4 py-3">
              <p className="text-sm font-medium">{kartica.nemaKanala}</p>
              <p className="mt-0.5 text-sm text-fg-muted">{kartica.nemaKanalaOpis}</p>
              <Button asChild variant="secondary" size="sm" className="mt-2">
                <a href={mapaUrl(lead.placeId)} target="_blank" rel="noreferrer">
                  <MapPin aria-hidden />
                  {kartica.otvoriNaMapi}
                </a>
              </Button>
            </div>
          )}

          <VodjenaTacka hint="poruka" className="mt-3">
            <div
              ref={trakaTabova}
              role="tablist"
              aria-label={kartica.poruka}
              className="scroll-x flex gap-1 rounded-full border border-border-strong bg-bg-inset p-1"
            >
              {TABOVI.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === aktivni}
                  onClick={() => {
                    setTab(t);
                    onboarding?.zatvori("poruka");
                  }}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    t === aktivni ? "bg-bg-elev text-fg shadow-sm ring-1 ring-border-strong" : "text-fg-muted hover:text-fg",
                  )}
                >
                  {kartica.kanal[t]}
                </button>
              ))}
            </div>
          </VodjenaTacka>

          {aktivni === "poziv" && (
            <p className="mt-3 text-xs font-semibold text-fg">{kartica.staDaKazes}</p>
          )}
          {naslovMejla && (
            <p className="mt-3 text-sm">
              <span className="text-xs text-fg-muted">Naslov: </span>
              {naslovMejla}
            </p>
          )}

          <pre
            ref={tekstRef}
            className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg"
          >
            {telo}
          </pre>

          {imaNoviju && (
            <button
              type="button"
              onClick={() => void ucitaj()}
              className="mt-2 text-xs font-medium text-accent-text underline-offset-4 hover:underline"
            >
              {kartica.osvezenaPoruka}
            </button>
          )}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            {aktivni === "poziv" ? (
              lead.phone && (
                <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto">
                  <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone aria-hidden />
                    <span className="num">{lead.phone}</span>
                  </a>
                </Button>
              )
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full sm:w-auto"
                disabled={ai.radi}
                onClick={() => void drugacije()}
              >
                {ai.radi ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                {kartica.napisiDrugacije}
              </Button>
            )}
            {ai.greska && <span className="text-xs text-fg-muted">{ai.greska}</span>}
          </div>

          {tost && (
            <div
              role="status"
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-accent bg-accent-wash px-3 py-2"
            >
              <p className="text-sm text-fg">
                {smeKontaktiran(status) ? kartica.kopiranoToast : kartica.kopirano}
              </p>
              {smeKontaktiran(status) && (
                <VodjenaTacka hint="pipeline">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={upisujem}
                    onClick={() => void kontaktiran()}
                  >
                    {kartica.kontaktiran}
                  </Button>
                </VodjenaTacka>
              )}
            </div>
          )}
        </>
      )}

      {greskaUpisa && <p role="alert" className="mt-2 text-xs text-danger">{greskaUpisa}</p>}
    </section>
  );
}
