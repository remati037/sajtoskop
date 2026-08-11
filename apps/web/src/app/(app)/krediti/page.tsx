// apps/web/src/app/(app)/krediti/page.tsx
// Stanje kredita i izvod iz knjige (F4 §4).
//
// Ovo je ekran koji odgovara na „gde mi je otišao kredit". Zato je izvod
// doslovan — svaka stavka iz `credit_ledger`, sa razlogom i nazivom prospekta.

import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Download, Radar } from "lucide-react";
import { creditMonth, planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { getIstorijaKredita, type StavkaKnjige } from "@/lib/krediti";
import { getOwnProfile } from "@/lib/profile";
import { formatDatum } from "@/lib/ui-tekst";
import { cn } from "@/lib/cn";
import { VezaGreska } from "@/components/veza-greska";
import { Alert } from "@/components/ui/alert";
import { StatKartica } from "@/components/ui/stat";
import { NaslovSekcije, ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Krediti" };

const RAZLOG: Record<StavkaKnjige["reason"], string> = {
  unlock: "Otključavanje",
  monthly_grant: "Mesečna dodela",
  admin: "Ručna izmena",
  refund: "Povraćaj",
};

export default async function Page() {
  await requireSession();

  const [profile, istorija] = await Promise.all([getOwnProfile(), getIstorijaKredita()]);
  const plan = planFor(profile?.plan);

  // Prazna knjiga i pokvarena veza izgledaju isto kroz RLS — v. `veza-greska.tsx`.
  // Na ovom ekranu je razlika najveća: „nemaš nijednu stavku" i „ne mogu da
  // pročitam tvoje stavke" su suprotne poruke o istom novcu.
  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <ZaglavljeStranice naslov="Krediti" />
        <VezaGreska sta="Stanje i istorija kredita" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Krediti"
        opis="Kredit se troši samo na otključavanje prospekta. Pretraga iz keša je besplatna i neograničena."
      />

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatKartica
          naslov="Stanje"
          vrednost={String(profile.credits_balance)}
          podnaslov={`od ${plan.monthlyCredits} mesečno`}
          ikona={<Coins />}
          odUkupno={[profile.credits_balance, plan.monthlyCredits]}
        />
        <StatKartica
          naslov="Nova skeniranja"
          vrednost={`${profile.cache_miss_count} / ${plan.cacheMissPerDay}`}
          podnaslov="danas, van keša"
          ikona={<Radar />}
          odUkupno={[profile.cache_miss_count, plan.cacheMissPerDay]}
        />
        <StatKartica
          naslov="Izvezeno u CSV"
          vrednost={`${profile.export_count} / ${plan.exportPerDay}`}
          podnaslov="redova danas"
          ikona={<Download />}
          odUkupno={[profile.export_count, plan.exportPerDay]}
        />
      </dl>

      {/* Beta status — obećanje se daje eksplicitno, sa rokom (00-kontekst §2). */}
      <Alert variant="neutral" className="mt-4">
        <span className="font-medium">Beta je besplatna dok traje.</span>{" "}
        <span className="text-fg-muted">
          Dobijaš {plan.monthlyCredits} kredita prvog u mesecu, bez prenošenja neiskorišćenih u
          sledeći mesec. Kad uvedem planove, javljam ti unapred — nikad neće biti tako da jednog
          jutra ne možeš da uđeš.
        </span>
      </Alert>

      <section className="mt-9">
        <NaslovSekcije>Istorija</NaslovSekcije>

        {istorija.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">
            Knjiga je prazna. Prva stavka se pojavljuje kad otključaš prvi prospekt —{" "}
            <Link href="/pretraga" className="font-medium text-accent-text underline underline-offset-4">
              idi na pretragu
            </Link>
            .
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-subtle/70 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                    <th className="py-2.5 pl-4 font-medium">Datum</th>
                    <th className="py-2.5 font-medium">Razlog</th>
                    <th className="py-2.5 font-medium">Prospekt</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Promena</th>
                  </tr>
                </thead>
                <tbody>
                  {istorija.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-border/70 transition-colors last:border-0 hover:bg-bg-subtle/60"
                    >
                      <td className="py-2.5 pl-4 text-fg-muted">
                        {formatDatum(s.createdAt)}
                      </td>
                      <td className="py-2.5">{RAZLOG[s.reason]}</td>
                      <td className="py-2.5 text-fg-muted">
                        <span className="block max-w-[18rem] truncate">{s.lead ?? "—"}</span>
                      </td>
                      <td
                        className={cn(
                          "py-2.5 pr-4 text-right font-semibold num",
                          s.delta > 0
                            ? "text-accent-text"
                            : s.delta < 0
                              ? "text-fg"
                              : "text-fg-muted",
                        )}
                      >
                        {s.delta > 0 ? `+${s.delta}` : s.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-fg-muted">
        Sledeća dodela: prvog dana narednog meseca. Tekući mesec u knjizi je{" "}
        <span className="num">{creditMonth()}</span>. Neiskorišćeni krediti se ne prenose
        — balans se postavlja na {plan.monthlyCredits}, ne sabira.
      </p>
    </div>
  );
}
