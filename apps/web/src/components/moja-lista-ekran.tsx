"use client";

// Ekran „Moja lista" (F4 §3). Svi otključani prospekti korisnika, sa punim
// podacima i izvozom u CSV.
//
// Pretraga i filtriranje rade u pregledaču, nad već učitanom listom. Razlog nije
// lenjost nego budžet i osećaj: lista je ograničena na ono što je korisnik
// platio kreditima (beta: 30 mesečno), pa je i najveći slučaj par stotina redova.
// Server upit po svakom otkucanom slovu bio bi sporiji i skuplji od filtera u memoriji.

import { useMemo, useState } from "react";
import type { MojLead } from "@/lib/moja-lista";
import { TelefonLink } from "./lead-tabela";
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

  // Gradovi koji stvarno postoje u listi — prazan filter nema smisla nuditi.
  const gradovi = useMemo(() => {
    const skup = new Set(leads.map((l) => l.citySlug));
    return [...skup].sort((a, b) =>
      (cityLabels[a] ?? a).localeCompare(cityLabels[b] ?? b, "sr-Latn-RS"),
    );
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
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[16rem]">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Pretraži svoju listu
          </span>
          <input
            type="search"
            value={upit}
            onChange={(e) => setUpit(e.target.value)}
            placeholder="naziv, adresa, mejl ili telefon"
            className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-white"
          />
        </label>

        {gradovi.length > 1 && (
          <label>
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Grad
            </span>
            <select
              value={grad}
              onChange={(e) => setGrad(e.target.value)}
              className="h-10 rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-white"
            >
              <option value="">Svi gradovi</option>
              {gradovi.map((slug) => (
                <option key={slug} value={slug}>
                  {cityLabels[slug] ?? slug}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          aria-pressed={samoBezSajta}
          onClick={() => setSamoBezSajta((v) => !v)}
          className={`h-10 rounded-lg border px-3 text-xs transition-colors ${
            samoBezSajta
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
              : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400"
          }`}
        >
          Bez funkcionalnog sajta
        </button>

        <button
          type="button"
          onClick={() => void izvezi()}
          disabled={izvozim || leads.length === 0}
          title={`Izvozi otključane prospekte${grad ? " iz izabranog grada" : ""}. Dnevni limit: ${exportPerDay} redova.`}
          className="ml-auto h-10 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {izvozim ? "Pravim CSV…" : "Izvezi CSV"}
        </button>
      </div>

      {greska && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {greska}
        </p>
      )}

      {poruka && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          {poruka}
        </p>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-3 text-sm dark:border-neutral-800">
        <p className="tabular-nums">
          {vidljivi.length === leads.length
            ? `${leads.length} otključanih ${plural(leads.length, "prospekt", "prospekta", "prospekata")}`
            : `${vidljivi.length} od ${leads.length} prospekata`}
        </p>
        <p className="text-xs text-neutral-500 tabular-nums">
          izvezeno danas: {exportedToday} od {exportPerDay}
        </p>
      </div>

      {vidljivi.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          Nijedan prospekt ne odgovara pretrazi.
        </p>
      ) : (
        <Tabela leads={vidljivi} cityLabels={cityLabels} />
      )}
    </div>
  );
}

function Tabela({ leads, cityLabels }: { leads: MojLead[]; cityLabels: Record<string, string> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
            <th className="py-2 pl-3 font-medium">Prospekt</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">Telefon</th>
            <th className="py-2 font-medium">Mejl</th>
            <th className="py-2 font-medium">Sajt</th>
            <th className="py-2 text-right font-medium">Score</th>
            <th className="py-2 pr-3 text-right font-medium">Otključano</th>
          </tr>
        </thead>

        <tbody>
          {leads.map((l) => (
            <tr
              key={l.placeId}
              className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60"
            >
              <td className="py-2.5 pl-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.name}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {cityLabels[l.citySlug] ?? l.citySlug}
                    {l.address && ` · ${l.address}`}
                  </div>
                </div>
              </td>

              <td className="py-2.5 align-middle text-xs">
                {l.siteStatus === "ok" ? (
                  <span className="text-neutral-500">
                    {l.uglyBand ? BAND_LABEL[l.uglyBand] : "Ima sajt"}
                  </span>
                ) : l.siteStatus ? (
                  <span className="font-semibold">{STATUS_LABEL[l.siteStatus]}</span>
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </td>

              <td className="py-2.5 align-middle">
                <TelefonLink phone={l.phone} tip={l.phoneType} />
              </td>

              <td className="py-2.5 align-middle">
                {l.email ? (
                  <a
                    href={`mailto:${l.email}`}
                    className="block max-w-[14rem] truncate text-xs underline decoration-dotted underline-offset-4"
                  >
                    {l.email}
                  </a>
                ) : (
                  <span className="text-xs text-neutral-400">—</span>
                )}
              </td>

              <td className="py-2.5 align-middle">
                {l.websiteUrl ? (
                  <a
                    href={l.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener nofollow"
                    className="block max-w-[12rem] truncate text-xs underline decoration-dotted underline-offset-4"
                  >
                    {l.websiteUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : (
                  <span className="text-xs text-neutral-400">—</span>
                )}
              </td>

              <td className="py-2.5 text-right align-middle tabular-nums">
                {l.uglyScore ?? <span className="text-neutral-400">—</span>}
              </td>

              <td className="py-2.5 pr-3 text-right align-middle text-xs text-neutral-500">
                {l.unlockedAt ? formatDatum(l.unlockedAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
