"use client";

// Tabela prospekata. `NEMA SAJT` i `MRTAV DOMEN` su vizuelno najjači bedževi —
// to su najbolji leadovi, ne greške (F2 §5). Zato zelena i žuta, a ne crvena:
// crvena se čita kao „nešto ne valja u aplikaciji".
//
// F4: dugme „Otključaj" radi. Otključan red menja dve ćelije — telefon postaje
// pozivni link, a kolona sa dugmetom postaje mejl i Ugly Score. Red se NE
// premešta i ne menja boju: korisnik treba da nastavi da čita listu odozgo
// nadole, a ne da traži gde mu je otišao lead koji je upravo platio.

import { ExternalLink, Lock, Star } from "lucide-react";
import type { PublicLead } from "@/lib/search-types";
import { cn } from "@/lib/cn";
import { SnimakDugme } from "./snimak";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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
    <div className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-subtle/70 text-left text-[11px] uppercase tracking-wider text-fg-muted">
              <th className="py-2.5 pl-4 font-medium">Prospekt</th>
              <th className="py-2.5 font-medium">Status sajta</th>
              {/* Zvala se „Snimak" do F6. Iza tog dugmeta sad stoji i cela analiza
                  sa rečenicom za poruku — ime kolone je govorilo da tamo nema šta
                  da se traži. */}
              <th className="py-2.5 font-medium">Analiza</th>
              <th className="py-2.5 font-medium">Grad</th>
              <th className="py-2.5 font-medium">Telefon</th>
              <th className="py-2.5 pr-4 text-right font-medium">Kontakt</th>
            </tr>
          </thead>

          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.placeId}
                className="group border-b border-border/70 transition-colors last:border-0 hover:bg-bg-subtle/60"
              >
                <td className="relative py-3 pl-4">
                  {/* Šipka nosi kvalitet leada i vidi se pre nego što se pročita
                      ijedno slovo. */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-0 top-1/2 h-9 w-[3px] -translate-y-1/2 rounded-r-full",
                      railColor(lead),
                    )}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{lead.name}</div>
                    <div className="flex items-center gap-1.5 truncate text-xs text-fg-muted">
                      <span className="truncate">{lead.address ?? "—"}</span>
                      {lead.rating !== null && (
                        <span className="flex shrink-0 items-center gap-0.5 num">
                          <Star className="h-3 w-3 fill-warn text-warn" />
                          {lead.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                <td className="py-3 align-middle">
                  <StatusBedz lead={lead} />
                </td>

                <td className="py-3 align-middle">
                  {lead.isUnlocked ? (
                    <SnimakDugme lead={lead} />
                  ) : (
                    // Zaključan lead ne dobija ni umanjeni prikaz. Snimak je deo
                    // onoga što se plaća kreditom, a CSS blur nije bezbednost.
                    <span className="text-xs text-fg-muted/60">—</span>
                  )}
                </td>

                <td className="py-3 align-middle text-fg-muted">
                  {cityLabels[lead.citySlug] ?? lead.citySlug}
                </td>

                <td className="py-3 align-middle text-fg-muted">
                  {lead.isUnlocked ? (
                    <TelefonLink phone={lead.phone} tip={lead.phoneType} />
                  ) : (
                    // Tip telefona je javan, sam broj nije — to je mamac za otključavanje.
                    (lead.phoneType && PHONE_LABEL[lead.phoneType]) || "—"
                  )}
                </td>

                <td className="py-3 pr-4 text-right align-middle">
                  {lead.isUnlocked ? (
                    <OtkljucanKontakt lead={lead} />
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled || otkljucavam !== null}
                      onClick={() => onUnlock(lead.placeId)}
                      className="hover:border-accent hover:bg-accent hover:text-accent-ink hover:shadow-accent"
                    >
                      <Lock className="h-3 w-3" />
                      {otkljucavam === lead.placeId ? "Otključavam…" : "Otključaj · 1 kredit"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Mobilni → Viber, fiksni → poziv (F4 §3). */
export function TelefonLink({ phone, tip }: { phone: string | null; tip: string | null }) {
  if (!phone) return <span className="text-fg-muted/60">—</span>;

  return (
    <a
      href={telefonHref(phone, tip)}
      className="font-medium num text-fg underline decoration-dotted decoration-fg-muted underline-offset-4 transition-colors hover:text-accent-text hover:decoration-accent-text"
      title={tip === "mobilni" ? "Otvori Viber" : "Pozovi"}
    >
      {phone}
    </a>
  );
}

function OtkljucanKontakt({ lead: l }: { lead: Extract<PublicLead, { isUnlocked: true }> }) {
  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      {l.email ? (
        <a
          href={`mailto:${l.email}`}
          className="max-w-[14rem] truncate underline decoration-dotted underline-offset-4 transition-colors hover:text-accent-text"
        >
          {l.email}
        </a>
      ) : (
        <span className="text-fg-muted/60">bez mejla</span>
      )}

      <span className="flex items-center gap-2 text-fg-muted">
        {l.websiteUrl && (
          <a
            href={l.websiteUrl}
            target="_blank"
            rel="noreferrer noopener nofollow"
            className="flex max-w-[10rem] items-center gap-1 truncate underline decoration-dotted underline-offset-4 transition-colors hover:text-accent-text"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{l.websiteUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
          </a>
        )}
        {l.uglyScore !== null && (
          <Badge variant="neutral" size="md" className="num" title="Ugly Score">
            {l.uglyScore}
          </Badge>
        )}
      </span>
    </div>
  );
}

function railColor(lead: PublicLead): string {
  switch (lead.siteStatus) {
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

function StatusBedz({ lead }: { lead: PublicLead }) {
  if (!lead.siteStatus) {
    return <span className="text-xs text-fg-muted/60">nije analiziran</span>;
  }

  if (lead.siteStatus === "ok") {
    return (
      <span className="inline-flex items-center gap-2">
        <Badge variant="outline">
          {lead.uglyBand ? BAND_LABEL[lead.uglyBand] : "Ima sajt"}
        </Badge>
        {lead.platform && (
          <span className="text-xs text-fg-muted/70">{lead.platform}</span>
        )}
      </span>
    );
  }

  const jak =
    lead.siteStatus === "nema_sajt"
      ? "jak-success"
      : lead.siteStatus === "mrtav"
        ? "jak-warning"
        : "jak-info";

  return (
    <Badge variant={jak} size="sm" className="font-semibold">
      {STATUS_LABEL[lead.siteStatus]}
    </Badge>
  );
}
