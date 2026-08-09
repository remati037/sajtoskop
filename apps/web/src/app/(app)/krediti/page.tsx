// apps/web/src/app/(app)/krediti/page.tsx
// Stanje kredita i izvod iz knjige (F4 §4).
//
// Ovo je ekran koji odgovara na „gde mi je otišao kredit". Zato je izvod
// doslovan — svaka stavka iz `credit_ledger`, sa razlogom i nazivom prospekta.

import Link from "next/link";
import { creditMonth, planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { getIstorijaKredita, type StavkaKnjige } from "@/lib/krediti";
import { getOwnProfile } from "@/lib/profile";
import { formatDatum, plural } from "@/lib/ui-tekst";

export const dynamic = "force-dynamic";

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

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Krediti</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Kredit se troši samo na otključavanje prospekta. Pretraga iz keša je besplatna i
          neograničena.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kartica
          naslov="Stanje"
          vrednost={profile ? String(profile.credits_balance) : "—"}
          podnaslov={`od ${plan.monthlyCredits} mesečno`}
        />
        <Kartica
          naslov="Nova skeniranja"
          vrednost={`${profile?.cache_miss_count ?? 0} / ${plan.cacheMissPerDay}`}
          podnaslov="danas, van keša"
        />
        <Kartica
          naslov="Izvezeno u CSV"
          vrednost={`${profile?.export_count ?? 0} / ${plan.exportPerDay}`}
          podnaslov="redova danas"
        />
      </dl>

      {/* Beta status — obećanje se daje eksplicitno, sa rokom (00-kontekst §2). */}
      <p className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 px-5 py-4 text-sm dark:border-neutral-800 dark:bg-neutral-900/50">
        <span className="font-medium">Beta je besplatna dok traje.</span>{" "}
        <span className="text-neutral-500">
          Dobijaš {plan.monthlyCredits} kredita prvog u mesecu, bez prenošenja neiskorišćenih
          u sledeći mesec. Kad uvedem planove, javljam ti unapred — nikad neće biti tako da
          jednog jutra ne možeš da uđeš.
        </span>
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Istorija
        </h2>

        {istorija.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            Knjiga je prazna. Prva stavka se pojavljuje kad otključaš prvi prospekt —{" "}
            <Link href="/pretraga" className="underline underline-offset-4">
              idi na pretragu
            </Link>
            .
          </p>
        ) : (
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                <th className="py-2 font-medium">Datum</th>
                <th className="py-2 font-medium">Razlog</th>
                <th className="py-2 font-medium">Prospekt</th>
                <th className="py-2 text-right font-medium">Promena</th>
              </tr>
            </thead>
            <tbody>
              {istorija.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="py-2.5 text-neutral-500">{formatDatum(s.createdAt)}</td>
                  <td className="py-2.5">{RAZLOG[s.reason]}</td>
                  <td className="py-2.5 text-neutral-500">
                    <span className="block max-w-[18rem] truncate">{s.lead ?? "—"}</span>
                  </td>
                  <td
                    className={`py-2.5 text-right font-medium tabular-nums ${
                      s.delta > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : s.delta < 0
                          ? "text-neutral-900 dark:text-neutral-100"
                          : "text-neutral-400"
                    }`}
                  >
                    {s.delta > 0 ? `+${s.delta}` : s.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="mt-8 text-xs text-neutral-500">
        Sledeća dodela: prvog dana narednog meseca. Tekući mesec u knjizi je{" "}
        <span className="tabular-nums">{creditMonth()}</span>. Neiskorišćeni krediti se ne
        prenose — balans se postavlja na {plan.monthlyCredits}, ne sabira.
      </p>
    </main>
  );
}

function Kartica({
  naslov,
  vrednost,
  podnaslov,
}: {
  naslov: string;
  vrednost: string;
  podnaslov: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{naslov}</dt>
      <dd className="mt-1 text-xl font-medium tabular-nums">{vrednost}</dd>
      <dd className="text-xs text-neutral-500">{podnaslov}</dd>
    </div>
  );
}
