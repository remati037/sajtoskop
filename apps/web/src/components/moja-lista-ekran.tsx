"use client";

// Ekran „Moja lista" (F4 §3). Svi otključani prospekti korisnika, sa punim
// podacima i izvozom u CSV.
//
// Pretraga i filtriranje rade u pregledaču, nad već učitanom listom. Razlog nije
// lenjost nego budžet i osećaj: lista je ograničena na ono što je korisnik
// platio kreditima (beta: 30 mesečno), pa je i najveći slučaj par stotina redova.
// Server upit po svakom otkucanom slovu bio bi sporiji i skuplji od filtera u memoriji.

import { useMemo, useState } from "react";
import { Download, ExternalLink, PenLine, Search } from "lucide-react";
import type { MojLead } from "@/lib/moja-lista";
import { TelefonLink } from "./lead-tabela";
import { PorukePanel } from "./poruke-panel";
import { SnimakDugme } from "./snimak";
import { cn } from "@/lib/cn";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input, Label } from "./ui/input";
import { Izbor } from "./ui/select";
import { PraznoStanje } from "./ui/stranica";
import { BAND_LABEL, formatDatum, plural, STATUS_LABEL } from "@/lib/ui-tekst";
import type { ApiError } from "@/lib/search-types";
import { foldForSearch } from "@sajtoskop/shared";

type Props = {
  leads: MojLead[];
  cityLabels: Record<string, string>;
  /** Dnevni cap iz plana — samo za tekst uz dugme za izvoz. */
  exportPerDay: number;
  exportedToday: number;
};

export function MojaListaEkran({ leads, cityLabels, exportPerDay, exportedToday }: Props) {
  const [upit, setUpit] = useState("");
  const [grad, setGrad] = useState<string>("");
  const [samoBezSajta, setSamoBezSajta] = useState(false);
  const [izvozim, setIzvozim] = useState(false);
  const [poruka, setPoruka] = useState<string | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  /** Prospekt čije su poruke otvorene. Isti panel kao u kanbanu (F7 §2). */
  const [otvoren, setOtvoren] = useState<MojLead | null>(null);

  // Gradovi koji stvarno postoje u listi — prazan filter nema smisla nuditi.
  const gradovi = useMemo(() => {
    const skup = new Set(leads.map((l) => l.citySlug));
    return [...skup]
      .map((slug) => ({ slug, label: cityLabels[slug] ?? slug }))
      .sort((a, b) => a.label.localeCompare(b.label, "sr-Latn-RS"));
  }, [leads, cityLabels]);

  const vidljivi = useMemo(() => {
    // `foldForSearch` skida dijakritiku i prevodi ćirilicu — „sabac" nalazi
    // „Šabac", a „Ђорђе" nalazi „Đorđe". Bez toga je pretraga po domaćim
    // nazivima beskorisna.
    const trazeno = foldForSearch(upit.trim());

    return leads.filter((l) => {
      if (grad && l.citySlug !== grad) return false;
      if (samoBezSajta && l.siteStatus === "ok") return false;
      if (!trazeno) return true;

      const seno = foldForSearch(
        [l.name, l.address ?? "", l.email ?? "", l.phone ?? "", l.websiteUrl ?? ""].join(" "),
      );
      return seno.includes(trazeno);
    });
  }, [leads, upit, grad, samoBezSajta]);

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

  return (
    <div className="space-y-5">
      <Card className="overflow-visible p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[15rem] flex-1">
            <Label>Pretraži svoju listu</Label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={upit}
                onChange={(e) => setUpit(e.target.value)}
                placeholder="naziv, adresa, mejl ili telefon"
                className="pl-9"
              />
            </div>
          </label>

          {gradovi.length > 1 && (
            <Izbor
              naziv="Grad"
              vrednost={grad}
              postavi={setGrad}
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
                ? "border-primary bg-primary text-primary-foreground shadow-glow"
                : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            Bez funkcionalnog sajta
          </button>

          <Button
            type="button"
            variant="primary"
            onClick={() => void izvezi()}
            disabled={izvozim || leads.length === 0}
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
        <p className="tabular-nums">
          {vidljivi.length === leads.length
            ? `${leads.length} otključanih ${plural(leads.length, "prospekt", "prospekta", "prospekata")}`
            : `${vidljivi.length} od ${leads.length} prospekata`}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
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
        <Tabela leads={vidljivi} cityLabels={cityLabels} otvoriPoruke={setOtvoren} />
      )}

      {otvoren && (
        <PorukePanel
          placeId={otvoren.placeId}
          naziv={otvoren.name}
          zatvori={() => setOtvoren(null)}
        />
      )}
    </div>
  );
}

function Tabela({
  leads,
  cityLabels,
  otvoriPoruke,
}: {
  leads: MojLead[];
  cityLabels: Record<string, string>;
  otvoriPoruke: (l: MojLead) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[58rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface/70 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2.5 pl-4 font-medium">Prospekt</th>
              <th className="py-2.5 font-medium">Status</th>
              <th className="py-2.5 font-medium">Snimak</th>
              <th className="py-2.5 font-medium">Telefon</th>
              <th className="py-2.5 font-medium">Mejl</th>
              <th className="py-2.5 font-medium">Sajt</th>
              <th className="py-2.5 text-right font-medium">Score</th>
              <th className="py-2.5 text-right font-medium">Otključano</th>
              <th className="py-2.5 pr-4 text-right font-medium">Poruka</th>
            </tr>
          </thead>

          <tbody>
            {leads.map((l) => (
              <tr
                key={l.placeId}
                className="border-b border-border/70 transition-colors last:border-0 hover:bg-surface/60"
              >
                <td className="py-3 pl-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {cityLabels[l.citySlug] ?? l.citySlug}
                      {l.address && ` · ${l.address}`}
                    </div>
                  </div>
                </td>

                <td className="py-3 align-middle text-xs">
                  {l.siteStatus === "ok" ? (
                    <Badge variant="outline">
                      {l.uglyBand ? BAND_LABEL[l.uglyBand] : "Ima sajt"}
                    </Badge>
                  ) : l.siteStatus ? (
                    <Badge
                      variant={
                        l.siteStatus === "nema_sajt"
                          ? "success"
                          : l.siteStatus === "mrtav"
                            ? "warning"
                            : "info"
                      }
                      className="font-semibold"
                    >
                      {STATUS_LABEL[l.siteStatus]}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>

                <td className="py-3 align-middle">
                  <SnimakDugme lead={l} />
                </td>

                <td className="py-3 align-middle">
                  <TelefonLink phone={l.phone} tip={l.phoneType} />
                </td>

                <td className="py-3 align-middle">
                  {l.email ? (
                    <a
                      href={`mailto:${l.email}`}
                      className="block max-w-[14rem] truncate text-xs underline decoration-dotted underline-offset-4 transition-colors hover:text-primary"
                    >
                      {l.email}
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  )}
                </td>

                <td className="py-3 align-middle">
                  {l.websiteUrl ? (
                    <a
                      href={l.websiteUrl}
                      target="_blank"
                      rel="noreferrer noopener nofollow"
                      className="flex max-w-[12rem] items-center gap-1 truncate text-xs underline decoration-dotted underline-offset-4 transition-colors hover:text-primary"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {l.websiteUrl.replace(/^https?:\/\/(www\.)?/, "")}
                      </span>
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  )}
                </td>

                <td className="py-3 text-right align-middle font-medium tabular-nums">
                  {l.uglyScore ?? <span className="text-muted-foreground/60">—</span>}
                </td>

                <td className="py-3 text-right align-middle text-xs text-muted-foreground">
                  {l.unlockedAt ? formatDatum(l.unlockedAt) : "—"}
                </td>

                <td className="py-3 pr-4 text-right align-middle">
                  <Button type="button" variant="outline" size="sm" onClick={() => otvoriPoruke(l)}>
                    <PenLine className="h-3 w-3" />
                    Napiši
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
