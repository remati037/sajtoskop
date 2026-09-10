// apps/web/src/app/(app)/krediti/page.tsx
// Stanje kredita i izvod iz knjige (F4 §4), sa blokom pretplate iznad (S21).
//
// Ovo je ekran koji odgovara na „gde mi je otišao kredit". Zato je izvod
// doslovan — svaka stavka iz `credit_ledger`, sa razlogom i nazivom prospekta.
//
// ── šta je S21 promenio ─────────────────────────────────────
// 1. Stanje je ZBIR obe kase, kao i svuda drugde u proizvodu. Do sada je ovde
//    stajao samo `credits_balance`, pa je korisnik koji je kupio paket video
//    manji broj nego što stvarno ima — a `/api/search` je naplaćivao iz zbira.
// 2. Iznad izvoda stoji blok pretplate: stanje naloga, datumi, obe kase
//    razdvojene i objašnjene, i dva izlaza (portal i cenovnik).
// 3. Bezuslovna poruka „Beta je besplatna dok traje" je otišla. Bila je tačna
//    dok su svi nalozi bili beta; od S16 postoji naplata, pa je pretplatniku
//    govorila neistinu o njegovom nalogu.

import type { Metadata } from "next";
import Link from "next/link";
import { Download, Radar } from "lucide-react";
import { creditMonth, planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { zahtevajCitanje } from "@/lib/pristup";
import { aktivacijaZa, citajPretplatuZaEkran } from "@/lib/pretplata";
import { getIstorijaKredita } from "@/lib/krediti";
import { formatDatum, RAZLOG_KREDITA } from "@/lib/ui-tekst";
import { cn } from "@/lib/cn";
import { VezaGreska } from "@/components/veza-greska";
import { PretplataBlok } from "@/components/pretplata-blok";
import { StatKartica } from "@/components/ui/stat";
import { NaslovSekcije, ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Krediti" };

export default async function Page() {
  const userId = await requireSession();

  // Kvar veze daje `profile === null`, a odmah ispod stoji `VezaGreska` — pa
  // prazna knjiga u tom slučaju nikad ne stigne do ekrana kao „nemaš stavki".
  //
  // S19: kapija pristupa uz podatak, ne u layout-u — layout se ne izvršava
  // ponovo pri klijentskoj navigaciji. Zaključan nalog ide na `/zakljucano`;
  // `grace` PROLAZI, jer je čitanje svog rada ceo smisao grace perioda (§1.5).
  //
  // Ide u isti `Promise.all` i vraća profil koji je ionako trebao ovoj strani —
  // dakle kapija ne košta nijedan dodatan upit nad `profiles`. `redirect()` iz
  // nje se kroz `Promise.all` uredno propagira.
  //
  // S21: uz to ide i čitanje pretplate za ekran. Nije isti upit kao onaj koji
  // hrani kapiju (`citajPretplatu`) — ovaj vraća i `lookup_key`, iz kog se
  // izvode ciklus i iznos. Razlog za dva čitača stoji u `lib/pretplata.ts`.
  const [{ profile, pristup }, pretplata, istorija] = await Promise.all([
    zahtevajCitanje(),
    citajPretplatuZaEkran(userId),
    getIstorijaKredita().catch((err: unknown) => {
      console.error("[krediti] čitanje knjige:", err);
      return [];
    }),
  ]);
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
        opis="Kredit se troši na otključavanje prospekta i na pristup kombinaciji — iz keša odmah, ili skeniranjem. Plaćen pristup važi 30 dana bez daljih kredita."
      />

      <PretplataBlok
        pristup={pristup}
        plan={profile.plan}
        pretplata={pretplata}
        // S26: iznos, plan i dodela za „Aktiviraj odmah" — iz `plans.ts` po
        // `lookup_key` pretplate (datum probe i otkazivanje su već u `pretplata`).
        aktivacija={aktivacijaZa(pretplata)}
        imaStripeKupca={profile.stripe_customer_id !== null}
        izPretplate={profile.credits_balance}
        dokupljeni={profile.credits_topup}
        mesecnaDodela={plan.monthlyCredits}
      />

      {/* Dnevni osigurači. Stanje kredita NIJE ovde — ono je gore, razbijeno na
          dve kase; treći prikaz istog broja bi bio treće mesto koje ume da se
          raziđe sa druga dva. */}
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <th className="py-2.5 font-medium">Na šta</th>
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
                        {/* Faza 5, 5.3: datum je broj — .num ga drži u istoj širini. */}
                        <span className="num">{formatDatum(s.createdAt)}</span>
                      </td>
                      <td className="py-2.5">{RAZLOG_KREDITA[s.reason]}</td>
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
        Tekući mesec u knjizi je <span className="num">{creditMonth()}</span>. Izvod pokazuje obe
        kase u istom nizu — „Kupljen paket" puni onu koja ne ističe, sve ostalo onu koja se
        obnavlja.
      </p>
    </div>
  );
}
