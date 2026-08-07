"use client";

// Tabela prospekata. `NEMA SAJT` i `MRTAV DOMEN` su vizuelno najjači bedževi —
// to su najbolji leadovi, ne greške (F2 §5). Zato zelena i žuta, a ne crvena:
// crvena se čita kao „nešto ne valja u aplikaciji".

import type { PublicLead } from "@/lib/search-types";
import { BAND_LABEL, PHONE_LABEL, STATUS_LABEL } from "@/lib/ui-tekst";

type Props = {
  leads: PublicLead[];
  cityLabels: Record<string, string>;
};

export function LeadTabela({ leads, cityLabels }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
            <th className="py-2 pl-3 font-medium">Prospekt</th>
            <th className="py-2 font-medium">Status sajta</th>
            <th className="py-2 font-medium">Grad</th>
            <th className="py-2 font-medium">Telefon</th>
            <th className="py-2 pr-3 text-right font-medium">Kontakt</th>
          </tr>
        </thead>

        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.placeId}
              className="group border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60"
            >
              <td className="py-2.5 pl-3">
                <div className="flex items-start gap-2.5">
                  <span className={`mt-1 h-8 w-[3px] shrink-0 rounded-full ${railColor(lead)}`} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{lead.name}</div>
                    <div className="truncate text-xs text-neutral-500">
                      {lead.address ?? "—"}
                      {lead.rating !== null && (
                        <span className="tabular-nums"> · {lead.rating.toFixed(1)} ★</span>
                      )}
                    </div>
                  </div>
                </div>
              </td>

              <td className="py-2.5 align-middle">
                <StatusBedz lead={lead} />
              </td>

              <td className="py-2.5 align-middle text-neutral-600 dark:text-neutral-400">
                {cityLabels[lead.citySlug] ?? lead.citySlug}
              </td>

              <td className="py-2.5 align-middle text-neutral-600 dark:text-neutral-400">
                {/* Tip telefona je javan, sam broj nije — to je mamac za otključavanje. */}
                {lead.phoneType ? PHONE_LABEL[lead.phoneType] : "—"}
              </td>

              <td className="py-2.5 pr-3 text-right align-middle">
                <button
                  type="button"
                  disabled
                  title="Otključavanje stiže u sledećoj fazi"
                  className="cursor-not-allowed rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-600"
                >
                  Otključaj
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function railColor(lead: PublicLead): string {
  switch (lead.siteStatus) {
    case "nema_sajt":
      return "bg-emerald-500";
    case "mrtav":
      return "bg-amber-500";
    case "samo_drustvene":
      return "bg-sky-400";
    default:
      return "bg-transparent";
  }
}

function StatusBedz({ lead }: { lead: PublicLead }) {
  if (!lead.siteStatus) {
    return <span className="text-xs text-neutral-400">nije analiziran</span>;
  }

  if (lead.siteStatus === "ok") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:border-neutral-800">
          {lead.uglyBand ? BAND_LABEL[lead.uglyBand] : "Ima sajt"}
        </span>
        {lead.platform && <span className="text-xs text-neutral-400">{lead.platform}</span>}
      </span>
    );
  }

  const jak =
    lead.siteStatus === "nema_sajt"
      ? "bg-emerald-500 text-emerald-950"
      : lead.siteStatus === "mrtav"
        ? "bg-amber-500 text-amber-950"
        : "bg-sky-400 text-sky-950";

  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ${jak}`}>
      {STATUS_LABEL[lead.siteStatus]}
    </span>
  );
}
