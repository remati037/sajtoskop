import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Gauge, KanbanSquare, ListChecks, Newspaper, Radar, Search } from "lucide-react";
import { planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { zahtevajCitanje } from "@/lib/pristup";
import { userSupabase } from "@/lib/supabase";
import { citajDnevnik } from "@/lib/dnevnik";
import { porukaKompa } from "@/lib/pozivnice-schema";
import { VezaGreska } from "@/components/veza-greska";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatKartica } from "@/components/ui/stat";
import { NaslovSekcije, ZaglavljeStranice } from "@/components/ui/stranica";
import { formatDatumKratko, imePlana } from "@/lib/ui-tekst";
import type { StanjeId } from "@sajtoskop/shared";

/**
 * Jedna reč ispod imena plana (S21).
 *
 * Namerno NIJE `STANJE_PRISTUPA[...].label` iz `lib/ui-tekst.ts`: taj spisak je
 * za admin konzolu i sadrži „Grace" i „Zaključan" — imena stanja iz
 * dokumentacije, koja korisniku ne znače ništa. Ovde stoji šta stanje znači za
 * njegov nalog. Ceo tekst sa datumima je na `/krediti`.
 */
const PODNASLOV_STANJA: Record<StanjeId, string> = {
  komp: "komp pristup",
  proba: "proba, kartica se naplaćuje na kraju probe",
  aktivan: "pretplata aktivna",
  otkazan: "otkazana, traje do kraja perioda",
  dopuna: "bez pretplate, radi na kreditima",
  grace: "pristup istekao — samo čitanje",
  zakljucan: "pristup istekao",
};

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
    opis: "Grad i niša — sve što je u kešu je besplatno, novo skeniranje 1–3 kredita po dubini.",
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

export default async function Page({
  searchParams,
}: {
  /** `?pozivnica=komp` — stiže sa `/pozivnica/[code]` posle prihvatanja (S27). */
  searchParams: Promise<{ pozivnica?: string }>;
}) {
  // Prva linija svake zaštićene stranice — ni middleware ni layout ovo ne rade.
  const userId = await requireSession();
  const { pozivnica } = await searchParams;

  // Dnevnik ne sme da obori dashboard: bez njega strana radi, samo bez poslednjih
  // stavki. Isti obrazac kao registar keša na pretrazi.
  //
  // S19: kapija pristupa uz podatak, ne u layout-u — layout se ne izvršava
  // ponovo pri klijentskoj navigaciji. Zaključan nalog ide na `/zakljucano`;
  // `grace` PROLAZI, jer je čitanje svog rada ceo smisao grace perioda (§1.5).
  //
  // Ide u isti `Promise.all` i vraća profil koji je ionako trebao ovoj strani —
  // dakle kapija ne košta nijedan dodatan upit nad `profiles`. `redirect()` iz
  // nje se kroz `Promise.all` uredno propagira.
  const [{ profile, pristup }, dnevnik] = await Promise.all([
    zahtevajCitanje(),
    citajDnevnik(userId).catch((err: unknown) => {
      console.error("[dashboard] beta dnevnik:", err);
      return null;
    }),
  ]);
  const plan = planFor(profile?.plan);

  // [Faza 4, 4.7] „Prvi koraci" stoji dok nema nijednog otključanog prospekta.
  // Broj se čita kroz RLS „own unlocks" — isti put kao svuda u aplikaciji.
  let otkljucano = 0;
  try {
    const { count, error } = await userSupabase()
      .from("unlocks")
      .select("place_id", { count: "exact", head: true });
    if (!error) otkljucano = count ?? 0;
  } catch {
    // Bez broja se onboarding jednostavno ne prikazuje — statistika ostaje.
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Kontrolna tabla"
        opis="Stanje naloga i limiti plana. Sve brojke se resetuju po pravilima iz plana, ne po osećaju."
      />

      {/* S27 (naplata-stripe.md §9.4): potvrda posle komp pozivnice. Query samo
          kaže DA se prikaže; tekst je iz profila koji je strana ionako
          pročitala, i stoji samo ako nalog stvarno jeste komp — ručno otkucan
          `?pozivnica=komp` ne tvrdi ništa što nije tačno. */}
      {pozivnica === "komp" && profile?.plan === "komp" && (
        <Alert variant="success" className="mb-6">
          {porukaKompa(profile.komp_expires_at, profile.credits_balance + profile.credits_topup)}
        </Alert>
      )}

      {profile ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* S21: ZBIR obe kase. Traka napunjenosti se crta samo kad mesečna
              dodela postoji — nalog bez plana (`dopuna`) ima dodelu 0, pa bi
              traka stajala na nuli i nad punim novčanikom kupljenih kredita. */}
          <StatKartica
            naslov="Krediti"
            vrednost={String(profile.credits_balance + profile.credits_topup)}
            podnaslov={
              profile.credits_topup > 0
                ? `${profile.credits_balance} iz pretplate · ${profile.credits_topup} dokupljeno`
                : plan.monthlyCredits > 0
                  ? `od ${plan.monthlyCredits} mesečno`
                  : "bez mesečne dodele"
            }
            ikona={<Coins />}
            odUkupno={
              plan.monthlyCredits > 0
                ? [profile.credits_balance, plan.monthlyCredits]
                : undefined
            }
          />
          {/* Ime plana, ne sirova vrednost kolone: `dopuna` je interno ime
              stanja i korisniku ne znači ništa (v. `PLAN_IME`). Podnaslov je do
              S21 bio zakucan na „beta" — tačno dok su svi nalozi bili beta. */}
          <StatKartica
            naslov="Plan"
            vrednost={imePlana(profile.plan)}
            podnaslov={pristup ? PODNASLOV_STANJA[pristup.stanje] : "stanje se ne čita"}
            ikona={<Gauge />}
            num={false}
          />
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

      {/* [Faza 4, 4.7] Onboarding: tri koraka do prve poruke, dok korisnik nema
          nijedan otključan prospekt (F8 §2, preliminarna verzija). */}
      {otkljucano === 0 && (
        <section className="mt-6 rounded-2xl border border-border bg-bg-elev p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Prvi koraci</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              {
                korak: "1",
                naslov: "Izaberi grad i nišu",
                opis: "Prva pretraga kombinacije koja nije u kešu košta 1 kredit po stranici rezultata (1–3, biraš dubinu) — posle toga je besplatna svima 30 dana.",
                href: "/pretraga",
              },
              {
                korak: "2",
                naslov: "Otključaj prvi prospekt",
                opis: "Kredit po prospektu. Tada vidiš telefon, mejl, sajt i analizu — i screenshot sajta.",
                href: "/pretraga",
              },
              {
                korak: "3",
                naslov: "Napiši prvu poruku",
                opis: "Generisana poruka za vlasnika, pa je status u kanbanu odvede do potpisa.",
                href: "/pipeline",
              },
            ].map((k) => (
              <li key={k.korak}>
                <Link href={k.href} className="group block h-full rounded-xl border border-border bg-bg-subtle/60 p-3.5 transition-colors hover:border-accent/40 hover:bg-bg-subtle">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink num">
                    {k.korak}
                  </span>
                  <p className="mt-2.5 text-sm font-semibold">{k.naslov}</p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">{k.opis}</p>
                </Link>
              </li>
            ))}
          </ol>
        </section>
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
