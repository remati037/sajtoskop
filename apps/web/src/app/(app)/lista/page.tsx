// apps/web/src/app/(app)/lista/page.tsx
// Otključani prospekti (F4 §3). Ovo je jedini ekran na kome korisnik vidi ono
// za šta je platio kredite — i jedini iz kog izlazi CSV.

import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { CITIES, planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { ziviEnrichPoslovi } from "@/lib/jobs";
import { analizaStigla, jeBezSajta } from "@/lib/kartica";
import { zahtevajOnboarding } from "@/lib/onboarding";
import { getPipeline } from "@/lib/pipeline";
import type { PipelineKartica } from "@/lib/pipeline-tipovi";
import { zahtevajCitanje } from "@/lib/pristup";
import { MojaListaEkran } from "@/components/moja-lista-ekran";
import { VezaGreska } from "@/components/veza-greska";
import { Button } from "@/components/ui/button";
import { PraznoStanje, ZaglavljeStranice } from "@/components/ui/stranica";
import { FaliMikro } from "@/components/fali-mikro";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moja lista" };

/**
 * [S30, §7.4] Živ posao analize za otključane bez analize — kartica koja je
 * napuštena usred analize crta „u toku" i posle povratka na listu. Pad upita
 * svodi se na „nema posla", pa kartica ponudi ponovni pokušaj.
 */
async function posloviAnalize(
  userId: string,
  kartice: PipelineKartica[],
): Promise<Record<string, number>> {
  const bez = kartice.filter((k) => !jeBezSajta(k) && !analizaStigla(k)).map((k) => k.placeId);
  if (bez.length === 0) return {};
  try {
    return Object.fromEntries(await ziviEnrichPoslovi(userId, bez));
  } catch (err) {
    console.error("[lista] poslovi analize:", err instanceof Error ? err.message : err);
    return {};
  }
}

export default async function Page() {
  // Prva linija svake zaštićene stranice — ni middleware ni layout ovo ne rade.
  const userId = await requireSession();

  // Pokvarena veza sa bazom ne sme da obori stranu — `profile` je tada `null`,
  // pa se ionako prikazuje `VezaGreska`, a ne prazna tabela. Zato prazan niz
  // ovde nije laž: do njega se stiže samo kad se poruka o kvaru već prikazuje.
  //
  // S19: kapija pristupa uz podatak, ne u layout-u — layout se ne izvršava
  // ponovo pri klijentskoj navigaciji. Zaključan nalog ide na `/zakljucano`;
  // `grace` PROLAZI, jer je čitanje svog rada ceo smisao grace perioda (§1.5).
  //
  // Ide u isti `Promise.all` i vraća profil koji je ionako trebao ovoj strani —
  // dakle kapija ne košta nijedan dodatan upit nad `profiles`. `redirect()` iz
  // nje se kroz `Promise.all` uredno propagira.
  //
  // [S30] `getPipeline`, ne `getMojaLista`: kartica nosi i mesto u pipeline-u
  // (§7.2). To je isti skup prospekata plus jedan upit nad `lead_status`.
  const [leads, { profile, pristup }] = await Promise.all([
    getPipeline().catch((err: unknown) => {
      console.error("[lista] čitanje otključanih prospekata:", err);
      return [];
    }),
    zahtevajCitanje(),
  ]);
  // Dnevni cap izvoza po planu iz kapije: stanje `dopuna` ima Starter limite,
  // a `profiles.plan` bi dao limite plana koji je istekao (§1.3). Isto računa i
  // `/api/export`, pa se broj uz dugme i broj koji server primeni ne razilaze.
  // [S30, §1.8] Treća linija: nov nalog sa pristupom ide u čarobnjak.
  zahtevajOnboarding(profile, pristup);

  const plan = planFor(pristup?.planLimita ?? profile?.plan);
  const enrichJobs = profile && leads.length > 0 ? await posloviAnalize(userId, leads) : {};

  // [S30, §4.7] „Otključaj prvi prospekt" vodi na listu iz čarobnjaka, ako je ima.
  const listaIzCarobnjaka =
    profile?.onboarding_city && profile.onboarding_niche
      ? `/pretraga?grad=${encodeURIComponent(profile.onboarding_city)}&nisa=${encodeURIComponent(profile.onboarding_niche)}&dubina=brzo`
      : "/pretraga";
  const cityLabels = Object.fromEntries(CITIES.map((c) => [c.slug, c.label]));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Moja lista"
        opis="Prospekti koje si otključao. Ostaju ti zauvek — otključan lead se nikad ne naplaćuje drugi put."
      />

      {/* Redosled je bitan: prvo se isključuje mogućnost da je lista prazna zato
          što RLS ne prepoznaje korisnika, pa tek onda ide prijateljsko prazno
          stanje. Obrnuto bi značilo da pokvarena veza izgleda kao „nemaš ništa". */}
      {!profile ? (
        <VezaGreska sta="Otključani prospekti" />
      ) : leads.length === 0 ? (
        <>
        <PraznoStanje
          ikona={<ListChecks />}
          naslov="Ovde stoji sve što otključaš"
          opis="Otključan prospekt ostaje tvoj zauvek: telefon, mejl, snimci, problemi i poruka. Odavde ide i CSV za tvoj Sheet."
        >
          <Button asChild variant="primary">
            <Link href={listaIzCarobnjaka}>Otključaj prvi prospekt</Link>
          </Button>
        </PraznoStanje>

          {/* [S29 §5.3 C] Prazno posle nedelju dana više nije „nisam stigao"
              nego „nešto ne valja". Prag je u komponenti, jer je svojstvo ovog
              mesta, a ne pravilo motora. */}
          <FaliMikro posleDana={7} className="mx-auto mt-4 w-full max-w-lg" />
        </>
      ) : (
        <MojaListaEkran
          leads={leads}
          cityLabels={cityLabels}
          exportPerDay={plan.exportPerDay}
          exportedToday={profile.export_count}
          enrichJobs={enrichJobs}
        />
      )}
    </div>
  );
}
