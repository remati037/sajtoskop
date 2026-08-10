"use client";

// Tabela prospekata. `NEMA SAJT` i `MRTAV DOMEN` su vizuelno najjači bedževi —
// to su najbolji leadovi, ne greške (F2 §5). Zato zelena i žuta, a ne crvena:
// crvena se čita kao „nešto ne valja u aplikaciji".
//
// F4: dugme „Otključaj" radi. Otključan red menja dve ćelije — telefon postaje
// pozivni link, a kolona sa dugmetom postaje mejl i Ugly Score. Red se NE
// premešta i ne menja boju: korisnik treba da nastavi da čita listu odozgo
// nadole, a ne da traži gde mu je otišao lead koji je upravo platio.

import type { PublicLead } from "@/lib/search-types";
import { SnimakDugme } from "./snimak";
import { BAND_LABEL, PHONE_LABEL, STATUS_LABEL, telefonHref } from "@/lib/ui-tekst";

type Props = {
  leads: PublicLead[];
  cityLabels: Record<string, string>;
  onUnlock: (placeId: string) => void;
  /** `place_id` reda koji se upravo otključava, ili `null`. */
  otkljucavam: string | null;
  /** Bez kredita se dugme ne gasi — poruka je korisnija od mrtvog dugmeta. */
  disabled?: boolean;
};

export function LeadTabela({ leads, cityLabels, onUnlock, otkljucavam, disabled }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
            <th className="py-2 pl-3 font-medium">Prospekt</th>
            <th className="py-2 font-medium">Status sajta</th>
            <th className="py-2 font-medium">Snimak</th>
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

              <td className="py-2.5 align-middle">
                {lead.isUnlocked ? (
                  <SnimakDugme lead={lead} />
                ) : (
                  // Zaključan lead ne dobija ni umanjeni prikaz. Snimak je deo
                  // onoga što se plaća kreditom, a CSS blur nije bezbednost.
                  <span className="text-xs text-neutral-400">—</span>
                )}
              </td>

              <td className="py-2.5 align-middle text-neutral-600 dark:text-neutral-400">
                {cityLabels[lead.citySlug] ?? lead.citySlug}
              </td>

              <td className="py-2.5 align-middle text-neutral-600 dark:text-neutral-400">
                {lead.isUnlocked ? (
                  <TelefonLink phone={lead.phone} tip={lead.phoneType} />
                ) : (
                  // Tip telefona je javan, sam broj nije — to je mamac za otključavanje.
                  (lead.phoneType && PHONE_LABEL[lead.phoneType]) || "—"
                )}
              </td>

              <td className="py-2.5 pr-3 text-right align-middle">
                {lead.isUnlocked ? (
                  <OtkljucanKontakt lead={lead} />
                ) : (
                  <button
                    type="button"
                    disabled={disabled || otkljucavam !== null}
                    onClick={() => onUnlock(lead.placeId)}
                    className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-300 disabled:hover:bg-transparent disabled:hover:text-inherit dark:border-neutral-700 dark:hover:border-white dark:hover:bg-white dark:hover:text-neutral-900"
                  >
                    {otkljucavam === lead.placeId ? "Otključavam…" : "Otključaj · 1 kredit"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mobilni → Viber, fiksni → poziv (F4 §3). */
export function TelefonLink({ phone, tip }: { phone: string | null; tip: string | null }) {
  if (!phone) return <span className="text-neutral-400">—</span>;

  return (
    <a
      href={telefonHref(phone, tip)}
      className="tabular-nums underline decoration-dotted underline-offset-4 hover:decoration-solid"
      title={tip === "mobilni" ? "Otvori Viber" : "Pozovi"}
    >
      {phone}
    </a>
  );
}

function OtkljucanKontakt({ lead: l }: { lead: Extract<PublicLead, { isUnlocked: true }> }) {
  return (
    <div className="flex flex-col items-end gap-0.5 text-xs">
      {l.email ? (
        <a
          href={`mailto:${l.email}`}
          className="max-w-[14rem] truncate underline decoration-dotted underline-offset-4 hover:decoration-solid"
        >
          {l.email}
        </a>
      ) : (
        <span className="text-neutral-400">bez mejla</span>
      )}

      <span className="flex items-center gap-2 text-neutral-500">
        {l.websiteUrl && (
          <a
            href={l.websiteUrl}
            target="_blank"
            rel="noreferrer noopener nofollow"
            className="max-w-[10rem] truncate underline decoration-dotted underline-offset-4"
          >
            {l.websiteUrl.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        )}
        {l.uglyScore !== null && (
          <span className="tabular-nums" title="Ugly Score">
            {l.uglyScore}
          </span>
        )}
      </span>
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
