"use client";

// Panel sa gotovim porukama za jedan otključan prospekt (F7 §2).
//
// Otvara se iz kanbana i iz „Moje liste". Poruke se povlače tek na otvaranje —
// generisanje je besplatno, ali 200 kartica × tri poruke je 600 tekstova koje
// niko ne čita.
//
// ── zašto se iz `@sajtoskop/shared` uvoze SAMO tipovi ──────
// `outreach.ts` sadrži sve šablone kopija. `import type` se pri prevođenju
// briše, pa u klijentski bundle ne ulazi ni jedan jedini šablon. Vrednost odatle
// (`napisiPoruke`, `GRANICE`) ovde se ne sme uvesti — poruke stižu sa servera
// gotove, kroz `/api/poruke`.

import { useEffect, useState } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import type { LeadChannel, MessageChannel, OutreachResult, Poruka } from "@sajtoskop/shared";
import type { ApiError } from "@/lib/search-types";
import { cn } from "@/lib/cn";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { UtisakMikro } from "./utisak-mikro";
import { useUtisci } from "./utisci-provider";

type Odgovor = OutreachResult & { naziv: string };

type Props = {
  placeId: string;
  naziv: string;
  /** Zatvaranje panela. */
  zatvori: () => void;
  /** Pozvano kad kopiranje pomeri lead — roditelj osvežava karticu. */
  naKontakt?: (channel: LeadChannel) => void;
};

const KANAL_LABEL: Record<MessageChannel, string> = {
  mejl: "Mejl",
  viber: "Viber",
  instagram: "Instagram",
};

const KANAL_OPIS: Record<MessageChannel, string> = {
  mejl: "Jedini kanal u kome adresa sajta nije problem.",
  viber: "Bez linka — link od nepoznatog broja se ne otvara.",
  instagram: "Prva poruka bez ponude. Druga tek kad odgovori.",
};

export function PorukePanel({ placeId, naziv, zatvori, naKontakt }: Props) {
  const [odgovor, setOdgovor] = useState<Odgovor | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [kanal, setKanal] = useState<MessageChannel>("mejl");

  useEffect(() => {
    let otkazano = false;

    (async () => {
      try {
        const res = await fetch(`/api/poruke?placeId=${encodeURIComponent(placeId)}`);
        const json = (await res.json()) as Odgovor | ApiError;

        if (otkazano) return;
        if (!res.ok) {
          setGreska((json as ApiError).greska ?? "Poruke nisu dostupne.");
          return;
        }

        const o = json as Odgovor;
        setOdgovor(o);
        // Predlog kanala iz tipa telefona: mobilni → Viber, fiksni → poziv.
        // `poziv` nema tekst, pa tab tada ostaje na mejlu.
        if (o.ok && o.predlog !== "poziv") setKanal(o.predlog);
      } catch {
        if (!otkazano) setGreska("Nema veze sa serverom.");
      }
    })();

    return () => {
      otkazano = true;
    };
  }, [placeId]);

  return (
    <Dialog open onOpenChange={(otvoren) => !otvoren && zatvori()}>
      <DialogContent aria-label={`Poruke za ${naziv}`}>
        <DialogHeader>
          <DialogTitle>{naziv}</DialogTitle>
          <DialogDescription>
            Kopiranje poruke prebacuje prospekt u „Kontaktiran".
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-5">
          {greska ? (
            <Alert variant="danger">{greska}</Alert>
          ) : !odgovor ? (
            <div className="space-y-3 py-4">
              {/* Kostur, ne spinner: modal ne sme da skače u visini kad tekst stigne. */}
              <div className="h-8 w-48 animate-puls-tanko rounded-lg bg-bg-inset" />
              <div className="h-28 animate-puls-tanko rounded-xl bg-bg-inset" />
              <p className="text-center text-sm text-fg-muted">Pišem poruke…</p>
            </div>
          ) : !odgovor.ok ? (
            // Generator je svesno odbio da piše. Ovo nije greška nego nalaz, i
            // korisniku štedi lošu poruku — zato stoji mirno, bez crvenog okvira.
            <div className="rounded-xl border border-border bg-bg-subtle px-4 py-4">
              <p className="text-sm font-medium">
                {odgovor.razlog === "solidan"
                  ? "Ovom sajtu nema šta da se zameri"
                  : "Nema osnova za poruku"}
              </p>
              <p className="mt-1 text-sm text-fg-muted">{odgovor.poruka}</p>
            </div>
          ) : (
            <Poruke
              odgovor={odgovor}
              kanal={kanal}
              setKanal={setKanal}
              placeId={placeId}
              naKontakt={naKontakt}
            />
          )}

          {/* Pitanje o kvalitetu poruke stoji ISPOD poruke (F11 §2.1) i javlja se
              tek kad je neka kopirana — pre toga korisnik nema šta da oceni. */}
          <UtisakMikro kljuc="poruka-kvalitet" className="mt-4" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Poruke({
  odgovor,
  kanal,
  setKanal,
  placeId,
  naKontakt,
}: {
  odgovor: Extract<OutreachResult, { ok: true }> & { naziv: string };
  kanal: MessageChannel;
  setKanal: (k: MessageChannel) => void;
  placeId: string;
  naKontakt?: (channel: LeadChannel) => void;
}) {
  const p = odgovor.poruke[kanal];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Segmentna traka kanala — isti jezik kao prekidač teme u sidebar-u. */}
        <div className="inline-flex rounded-full border border-border-strong bg-bg-inset/60 p-1">
          {(Object.keys(odgovor.poruke) as MessageChannel[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKanal(k)}
              aria-pressed={k === kanal}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                k === kanal
                  ? "bg-bg-elev text-fg shadow-sm ring-1 ring-border-strong"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {KANAL_LABEL[k]}
              {odgovor.predlog === k && (
                <span className="ml-1.5 text-[10px] font-normal text-accent-text">predlog</span>
              )}
            </button>
          ))}
        </div>

        {odgovor.predlog === "poziv" && (
          <span className="ml-auto text-xs text-fg-muted">
            Broj je fiksni — bolje pozovi nego da pišeš.
          </span>
        )}
      </div>

      <p className="text-xs text-fg-muted">{KANAL_OPIS[kanal]}</p>

      <PorukaBlok poruka={p} placeId={placeId} kanal={kanal} naKontakt={naKontakt} primarno />

      <AiVarijanta placeId={placeId} kanal={kanal} sablon={p} naKontakt={naKontakt} />

      {p.followUp && (
        <PorukaBlok
          poruka={{ ...p, body: p.followUp, followUp: undefined }}
          placeId={placeId}
          kanal={kanal}
          naKontakt={naKontakt}
          naslov="Druga poruka — šalje se tek kad odgovori"
        />
      )}

      <p className="border-t border-border pt-3 text-xs text-fg-muted/80">
        Prva rečenica je{" "}
        {odgovor.izvor === "ai"
          ? "iz analize snimka"
          : odgovor.izvor === "status"
            ? "iz stanja sajta"
            : "iz provere HTML-a"}
        . Pročitaj je pre slanja — ti je potpisuješ.
      </p>
    </div>
  );
}

/**
 * „Napiši drugačije" (F7 §2).
 *
 * Šablon je podrazumevan i besplatan; ovo je dugme, ne automatika — AI poziv se
 * ne troši na svaki prikaz. Posao ide u red i klijent ga polluje, jer Anthropic
 * zove worker, ne Vercel funkcija.
 */
function AiVarijanta({
  placeId,
  kanal,
  sablon,
  naKontakt,
}: {
  placeId: string;
  kanal: MessageChannel;
  sablon: Poruka;
  naKontakt?: (channel: LeadChannel) => void;
}) {
  const [stanje, setStanje] = useState<"mirno" | "cekam" | "gotovo" | "greska">("mirno");
  const [tekst, setTekst] = useState<{ body: string; words: number } | null>(null);
  const [greska, setGreska] = useState<string | null>(null);

  // Prelazak na drugi kanal poništava varijantu: tekst pisan za Viber nema šta
  // da radi ispod mejla, a granice reči su im različite.
  useEffect(() => {
    setStanje("mirno");
    setTekst(null);
    setGreska(null);
  }, [kanal]);

  async function napisi() {
    setStanje("cekam");
    setGreska(null);

    try {
      const res = await fetch("/api/poruke/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, channel: kanal }),
      });

      const json = (await res.json()) as { jobId: number } | ApiError;
      if (!res.ok) {
        setGreska((json as ApiError).greska ?? "Varijanta nije uspela.");
        setStanje("greska");
        return;
      }

      const jobId = (json as { jobId: number }).jobId;

      const ok = await sacekajPosao(jobId);
      if (!ok) {
        setGreska("Pisanje varijante nije uspelo. Šablon iznad je i dalje upotrebljiv.");
        setStanje("greska");
        return;
      }

      const gotov = await fetch(
        `/api/poruke/ai?placeId=${encodeURIComponent(placeId)}&channel=${kanal}&jobId=${jobId}`,
      );
      if (!gotov.ok) {
        // 404 ovde znači da je posao prošao, ali model nije dao ništa što prolazi
        // pravila kopija. Ruta za to vraća rečenicu koja to i kaže.
        const err = (await gotov.json()) as ApiError;
        setGreska(err.greska ?? "Varijanta nije stigla. Pokušaj ponovo.");
        setStanje("greska");
        return;
      }

      const varijanta = (await gotov.json()) as { body: string; words: number };
      setTekst(varijanta);
      setStanje("gotovo");
    } catch {
      setGreska("Nema veze sa serverom.");
      setStanje("greska");
    }
  }

  if (stanje === "gotovo" && tekst) {
    return (
      <PorukaBlok
        poruka={{ ...sablon, body: tekst.body, followUp: undefined, words: tekst.words }}
        placeId={placeId}
        kanal={kanal}
        naKontakt={naKontakt}
        izvor="ai"
        naslov="Druga verzija — pročitaj je pre nego što je pošalješ"
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void napisi()}
        disabled={stanje === "cekam"}
      >
        <Sparkles className={cn("h-3.5 w-3.5", stanje === "cekam" && "animate-puls-tanko")} />
        {stanje === "cekam" ? "Pišem…" : "Napiši drugačije"}
      </Button>

      {greska && <span className="text-xs text-fg-muted">{greska}</span>}
    </div>
  );
}

/** Isto pollovanje kao kod scana. `false` znači da posao nije završio uspešno. */
async function sacekajPosao(jobId: number): Promise<boolean> {
  const DO_KADA = Date.now() + 45_000;

  while (Date.now() < DO_KADA) {
    // [Faza 4, 4.11] Skriven tab ne troši zahteve (P5) — čeka se dok se vrati.
    while (document.hidden) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    await new Promise((r) => setTimeout(r, 1200));

    const res = await fetch(`/api/job/${jobId}`);
    if (!res.ok) return false;

    const { status } = (await res.json()) as { status: string };
    if (status === "done") return true;
    if (status === "failed") return false;
  }

  return false;
}

function PorukaBlok({
  poruka,
  placeId,
  kanal,
  naKontakt,
  naslov,
  izvor = "sablon",
  primarno = false,
}: {
  poruka: Poruka;
  placeId: string;
  kanal: MessageChannel;
  naKontakt?: (channel: LeadChannel) => void;
  naslov?: string;
  /** Šta se upisuje u `outreach_messages.source` — šablon ili AI varijanta. */
  izvor?: "sablon" | "ai";
  // [Faza 5, 5.2] Jedno primarno dugme po dijalogu — glavna (šablonska)
  // poruka; follow-up i AI varijanta su outline.
  primarno?: boolean;
}) {
  const [stanje, setStanje] = useState<"mirno" | "radim" | "kopirano" | "greska">("mirno");
  const utisci = useUtisci();

  /**
   * Kopiranje i upis idu redom, ne paralelno: tekst mora da bude u clipboardu
   * pre nego što se lead proglasi kontaktiranim. Ako `writeText` padne (stranica
   * bez fokusa, odbijena dozvola), status se ne menja — inače bi kanban tvrdio
   * da je poruka poslata, a korisnik nema šta da nalepi.
   */
  async function kopiraj() {
    setStanje("radim");
    const tekst = poruka.subject ? `${poruka.subject}\n\n${poruka.body}` : poruka.body;

    try {
      await navigator.clipboard.writeText(tekst);
    } catch {
      setStanje("greska");
      return;
    }

    try {
      const res = await fetch("/api/poruke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, channel: kanal, body: poruka.body, source: izvor }),
      });
      if (res.ok) naKontakt?.(kanal);
    } catch {
      // Tekst je u clipboardu — to je ono zbog čega je korisnik kliknuo.
      // Neuspeo upis statusa se ne pretvara u crvenu poruku preko cele poruke.
      console.error("[poruke] upis kontakta nije uspeo");
    }

    setStanje("kopirano");

    // Okidač za `poruka-kvalitet` (F11 §2.1). Motor odlučuje hoće li se pitanje
    // pojaviti, i „jednom po nalogu" je ono što od ovoga pravi PRVU kopiranu
    // poruku — ekran to ne mora da broji.
    //
    // [ODSTUPANJE od PRD §2.1, svesno] Tamo piše „prva kopirana AI poruka".
    // „Napiši drugačije" je dugme koje mnogi neće ni kliknuti, pa bi pitanje
    // stiglo do šačice ljudi. Okidač je zato svaka prva kopirana poruka, a
    // poreklo (`sablon` ili `ai`) ide u odgovor — brojka po izvoru se i dalje
    // vidi, samo se sada uopšte skuplja.
    utisci?.prijaviDogadjaj("poruka-kvalitet", { izvor, kanal });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-subtle/40">
      {naslov && (
        <p className="border-b border-border bg-bg-subtle px-4 py-2 text-xs font-medium text-fg-muted">
          {naslov}
        </p>
      )}

      {poruka.subject && (
        <p className="border-b border-border px-4 py-2.5 text-sm">
          <span className="text-xs text-fg-muted">Naslov: </span>
          {poruka.subject}
        </p>
      )}

      <pre className="whitespace-pre-wrap px-4 py-3.5 font-sans text-sm leading-relaxed">
        {poruka.body}
      </pre>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
        <span className="text-xs num text-fg-muted">{poruka.words} reči</span>

        <Button
          type="button"
          // [Faza 5, 5.2] Primarno je samo glavna poruka — ostali „Kopiraj" su
          // outline, da dijalog nema tri jednaka glavna dugmeta.
          variant={stanje === "kopirano" ? "secondary" : primarno ? "primary" : "outline"}
          size="sm"
          onClick={() => void kopiraj()}
          disabled={stanje === "radim"}
        >
          {stanje === "kopirano" ? (
            <Check className="h-3.5 w-3.5 text-accent-text" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {stanje === "kopirano"
            ? "Kopirano"
            : stanje === "greska"
              ? "Kopiranje nije uspelo"
              : stanje === "radim"
                ? "…"
                : "Kopiraj"}
        </Button>
      </div>
    </div>
  );
}
