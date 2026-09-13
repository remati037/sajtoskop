"use client";

// Ekran „Moja lista" (F4 §3). Svi otključani prospekti korisnika, sa punim
// podacima i izvozom u CSV.
//
// Pretraga i filtriranje rade u pregledaču, nad već učitanom listom. Razlog nije
// lenjost nego budžet i osećaj: lista je ograničena na ono što je korisnik
// platio kreditima, pa je i najveći slučaj par stotina redova. Server upit po
// svakom otkucanom slovu bio bi sporiji i skuplji od filtera u memoriji.
//
// [S30, O5] Kartice prospekta umesto tabele — ista komponenta kao na
// `/pretraga`, sa snimcima, problemima i porukom na samoj kartici. Panel poruka
// odavde više ne treba; ostaje u kanbanu.
//
// Kartice se crtaju po 30: svaka povlači svoju poruku kad uđe u vidokrug, a
// lista od nekoliko stotina kartica odjednom je spor ekran bez ijednog razloga.

import { useCallback, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { foldForSearch } from "@sajtoskop/shared";
import type { PipelineKartica } from "@/lib/pipeline-tipovi";
import type { ApiError, UnlockedLead } from "@/lib/search-types";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/ui-tekst";
import { KarticaProspekta } from "./kartica-prospekta";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input, Label } from "./ui/input";
import { Izbor } from "./ui/select";
import { PraznoStanje } from "./ui/stranica";

/** Koliko kartica se crta odjednom. */
const PO_STRANI = 30;

type Props = {
  leads: PipelineKartica[];
  cityLabels: Record<string, string>;
  /** Dnevni cap iz plana — samo za tekst uz dugme za izvoz. */
  exportPerDay: number;
  exportedToday: number;
  /** [S30, §7.4] Živ posao analize po `place_id` — kartica crta „u toku". */
  enrichJobs: Record<string, number>;
};

export function MojaListaEkran({ leads, cityLabels, exportPerDay, exportedToday, enrichJobs }: Props) {
  const [redovi, setRedovi] = useState(leads);
  const [upit, setUpit] = useState("");
  const [grad, setGrad] = useState<string>("");
  const [samoBezSajta, setSamoBezSajta] = useState(false);
  const [izvozim, setIzvozim] = useState(false);
  const [poruka, setPoruka] = useState<string | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [prikazano, setPrikazano] = useState(PO_STRANI);

  // Gradovi koji stvarno postoje u listi — prazan filter nema smisla nuditi.
  const gradovi = useMemo(() => {
    const skup = new Set(redovi.map((l) => l.citySlug));
    return [...skup]
      .map((slug) => ({ slug, label: cityLabels[slug] ?? slug }))
      .sort((a, b) => a.label.localeCompare(b.label, "sr-Latn-RS"));
  }, [redovi, cityLabels]);

  const vidljivi = useMemo(() => {
    // `foldForSearch` skida dijakritiku i prevodi ćirilicu — „sabac" nalazi
    // „Šabac", a „Ђорђе" nalazi „Đorđe". Bez toga je pretraga po domaćim
    // nazivima beskorisna.
    const trazeno = foldForSearch(upit.trim());

    return redovi.filter((l) => {
      if (grad && l.citySlug !== grad) return false;
      if (samoBezSajta && l.siteStatus === "ok") return false;
      if (!trazeno) return true;

      const seno = foldForSearch(
        [l.name, l.address ?? "", l.email ?? "", l.phone ?? "", l.websiteUrl ?? ""].join(" "),
      );
      return seno.includes(trazeno);
    });
  }, [redovi, upit, grad, samoBezSajta]);

  /** Kartica je posle završene analize dobila pun lead. */
  const zameni = useCallback((novi: UnlockedLead) => {
    setRedovi((pre) => pre.map((r) => (r.placeId === novi.placeId ? { ...r, ...novi } : r)));
  }, []);

  /** „Sledeći prospekt" (§4.7) — na listi su svi otključani, pa je to prosto sledeća kartica. */
  function sledeci(placeId: string) {
    const od = vidljivi.findIndex((l) => l.placeId === placeId);
    const s = vidljivi[od + 1];
    if (!s) return;
    document.getElementById(`kartica-${s.placeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * Izvoz ide kroz `fetch`, a ne kroz običan `<a download>`.
   *
   * Sa linkom bi odbijenica zbog dnevnog capa otvorila novi tab sa sirovim
   * JSON-om. Ovako se status kod pročita i greška se prikaže kao poruka na
   * srpskom, tu gde korisnik gleda.
   */
  async function izvezi() {
    setIzvozim(true);
    setPoruka(null);
    setGreska(null);

    try {
      const params = new URLSearchParams();
      if (grad) params.set("city", grad);
      const res = await fetch(`/api/export?${params}`);

      if (!res.ok) {
        const json = (await res.json()) as ApiError;
        setGreska(json.greska ?? "Izvoz nije uspeo.");
        return;
      }

      const blob = await res.blob();
      const ime =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "sajtoskop.csv";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ime;
      a.click();
      URL.revokeObjectURL(url);

      const redova = Number(res.headers.get("X-Sajtoskop-Rows") ?? 0);
      const odsecno = Number(res.headers.get("X-Sajtoskop-Truncated") ?? 0);

      setPoruka(
        odsecno > 0
          ? `Izvezeno ${redova} ${plural(redova, "red", "reda", "redova")}. ` +
              `${odsecno} ${plural(odsecno, "red je", "reda su", "redova je")} preskočeno — dnevni limit je ${exportPerDay}.`
          : `Izvezeno ${redova} ${plural(redova, "red", "reda", "redova")}.`,
      );
    } catch {
      setGreska("Nema veze sa serverom. Pokušaj ponovo za koji minut.");
    } finally {
      setIzvozim(false);
    }
  }

  const naEkranu = vidljivi.slice(0, prikazano);

  return (
    <div className="space-y-5">
      <Card className="overflow-visible p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[min(15rem,100%)] flex-1">
            <Label>Pretraži svoju listu</Label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              />
              <Input
                type="search"
                value={upit}
                onChange={(e) => {
                  setUpit(e.target.value);
                  setPrikazano(PO_STRANI);
                }}
                placeholder="naziv, adresa, mejl ili telefon"
                className="pl-9"
              />
            </div>
          </label>

          {gradovi.length > 1 && (
            <Izbor
              naziv="Grad"
              vrednost={grad}
              postavi={(g) => {
                setGrad(g);
                setPrikazano(PO_STRANI);
              }}
              opcije={gradovi}
              sve="Svi gradovi"
            />
          )}

          <button
            type="button"
            aria-pressed={samoBezSajta}
            onClick={() => setSamoBezSajta((v) => !v)}
            className={cn(
              "h-10 rounded-lg border px-3.5 text-xs font-medium transition-all",
              samoBezSajta
                ? "border-accent bg-accent text-accent-ink"
                : "border-border-strong bg-bg-elev text-fg-muted hover:border-fg-muted hover:text-fg",
            )}
          >
            Bez funkcionalnog sajta
          </button>

          <Button
            type="button"
            variant="primary"
            onClick={() => void izvezi()}
            disabled={izvozim || redovi.length === 0}
            title={`Izvozi otključane prospekte${grad ? " iz izabranog grada" : ""}. Dnevni limit: ${exportPerDay} redova.`}
            className="ml-auto"
          >
            <Download className="h-4 w-4" />
            {izvozim ? "Pravim CSV…" : "Izvezi CSV"}
          </Button>
        </div>
      </Card>

      {greska && <Alert variant="danger">{greska}</Alert>}
      {poruka && <Alert variant="success">{poruka}</Alert>}

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p className="num">
          {vidljivi.length === redovi.length
            ? `${redovi.length} otključanih ${plural(redovi.length, "prospekt", "prospekta", "prospekata")}`
            : `${vidljivi.length} od ${redovi.length} prospekata`}
        </p>
        <p className="text-xs num text-fg-muted">
          izvezeno danas: {exportedToday} od {exportPerDay}
        </p>
      </div>

      {vidljivi.length === 0 ? (
        <PraznoStanje
          ikona={<Search />}
          naslov="Nijedan prospekt ne odgovara pretrazi."
          opis="Skloni filtere ili promeni upit."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {naEkranu.map((l) => (
              <KarticaProspekta
                key={l.placeId}
                lead={l}
                cityLabel={cityLabels[l.citySlug] ?? l.citySlug}
                krediti={0}
                enrichJobId={enrichJobs[l.placeId] ?? null}
                pipelineStatus={l.uPipelineu ? l.status : null}
                onZameni={zameni}
                onSledeci={() => sledeci(l.placeId)}
              />
            ))}
          </div>

          {vidljivi.length > prikazano && (
            <div className="flex justify-center">
              <Button type="button" variant="secondary" onClick={() => setPrikazano((n) => n + PO_STRANI)}>
                Prikaži još{" "}
                <span className="num">{Math.min(PO_STRANI, vidljivi.length - prikazano)}</span>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
