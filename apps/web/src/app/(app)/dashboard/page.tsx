import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Gauge, KanbanSquare, ListChecks, Newspaper, Radar, Search } from "lucide-react";
import { planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { getOwnProfile } from "@/lib/profile";
import { citajDnevnik } from "@/lib/dnevnik";
import { VezaGreska } from "@/components/veza-greska";
import { Card } from "@/components/ui/card";
import { StatKartica } from "@/components/ui/stat";
import { NaslovSekcije, ZaglavljeStranice } from "@/components/ui/stranica";
import { formatDatumKratko } from "@/lib/ui-tekst";

/** Tip stavke dnevnika, onako kako ga korisnik čita (F11 §6.5). */
const TIP_DNEVNIKA = {
  novo: "novo",
  promena: "promena",
  popravka: "popravka",
} as const;

// Kontrolna tabla dokazuje da lanac Clerk → Supabase JWT → RLS radi: broj kredita
// ispod je pročitan kroz RLS politiku „own profile", ne kroz service_role.
//
// Rezervni put za kreiranje profila je od F2 u `(app)/layout.tsx` — ovde je bio
// dupliran čim je pretraga dobila isti problem.

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Kontrolna tabla" };

const PRECICE = [
  {
    href: "/pretraga",
    naslov: "Pretraga prospekata",
    opis: "Grad i niša — sve što je u kešu je besplatno, novo skeniranje 1 kredit.",
    Ikona: Search,
  },
  {
    href: "/lista",
    naslov: "Moja lista",
    opis: "Sve što si otključao, sa izvozom u CSV.",
    Ikona: ListChecks,
  },
  {
    href: "/pipeline",
    naslov: "Pipeline",
    opis: "Od nekontaktiranog do potpisanog, u pet kolona.",
    Ikona: KanbanSquare,
  },
];

export default async function Page() {
  // Prva linija svake zaštićene stranice — ni middleware ni layout ovo ne rade.
  const userId = await requireSession();

  // Dnevnik ne sme da obori dashboard: bez njega strana radi, samo bez poslednjih
  // stavki. Isti obrazac kao registar keša na pretrazi.
  const [profile, dnevnik] = await Promise.all([
    getOwnProfile(),
    citajDnevnik(userId).catch((err: unknown) => {
      console.error("[dashboard] beta dnevnik:", err);
      return null;
    }),
  ]);
  const plan = planFor(profile?.plan);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Kontrolna tabla"
        opis="Stanje naloga i limiti plana. Sve brojke se resetuju po pravilima iz plana, ne po osećaju."
      />

      {profile ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatKartica
            naslov="Krediti"
            vrednost={String(profile.credits_balance)}
            podnaslov={`od ${plan.monthlyCredits} mesečno`}
            ikona={<Coins />}
            odUkupno={[profile.credits_balance, plan.monthlyCredits]}
          />
          <StatKartica naslov="Plan" vrednost={profile.plan} podnaslov="beta" ikona={<Gauge />} />
          <StatKartica
            naslov="Pretraga van keša"
            vrednost={`${profile.cache_miss_count} / ${plan.cacheMissPerDay}`}
            podnaslov="danas"
            ikona={<Radar />}
            odUkupno={[profile.cache_miss_count, plan.cacheMissPerDay]}
          />
        </dl>
      ) : (
        <VezaGreska sta="Podaci naloga" />
      )}

      {/* Beta dnevnik (F11.4 §6.5): poslednjih 5 stavki ispod statistike.
          Oznaka „iz tvog utiska" je jedina rečenica koja stvarno traži sledeći
          utisak od istog čoveka — zato stoji ovde, ne u mejlu. */}
      {dnevnik && dnevnik.ukupno > 0 && (
        <section className="mt-9">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <NaslovSekcije>Beta dnevnik</NaslovSekcije>
            {dnevnik.izUtisaka > 0 && (
              <p className="num text-xs text-fg-muted">
                {dnevnik.izUtisaka} od {dnevnik.ukupno} promena iz utisaka
              </p>
            )}
          </div>

          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
            {dnevnik.stavke.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3"
              >
                <span className="num text-xs text-fg-muted">{formatDatumKratko(s.shipped_at)}</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  {TIP_DNEVNIKA[s.kind]}
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium">{s.title}</span>
                {s.izTvogUtiska && (
                  <span
                    title="Ova promena je nastala iz tvoje prijave."
                    className="inline-flex items-center gap-1 rounded-full border border-border-accent bg-accent-wash px-2 py-0.5 text-[11px] font-medium text-accent-text"
                  >
                    <Newspaper className="h-3 w-3" aria-hidden />
                    iz tvog utiska
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PRECICE.map(({ href, naslov, opis, Ikona }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full p-4 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-accent/40 group-hover:shadow-card">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-wash text-accent-text">
                <Ikona className="h-4 w-4" />
              </span>
              <p className="mt-3 text-sm font-semibold">{naslov}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{opis}</p>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
