// apps/web/src/app/(app)/lista/page.tsx
// Otključani prospekti (F4 §3). Ovo je jedini ekran na kome korisnik vidi ono
// za šta je platio kredite — i jedini iz kog izlazi CSV.

import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { CITIES, planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { getMojaLista } from "@/lib/moja-lista";
import { getOwnProfile } from "@/lib/profile";
import { MojaListaEkran } from "@/components/moja-lista-ekran";
import { VezaGreska } from "@/components/veza-greska";
import { Button } from "@/components/ui/button";
import { PraznoStanje, ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moja lista" };

export default async function Page() {
  // Prva linija svake zaštićene stranice — ni middleware ni layout ovo ne rade.
  await requireSession();

  // Pokvarena veza sa bazom ne sme da obori stranu — `profile` je tada `null`,
  // pa se ionako prikazuje `VezaGreska`, a ne prazna tabela. Zato prazan niz
  // ovde nije laž: do njega se stiže samo kad se poruka o kvaru već prikazuje.
  const [leads, profile] = await Promise.all([
    getMojaLista().catch((err: unknown) => {
      console.error("[lista] čitanje otključanih prospekata:", err);
      return [];
    }),
    getOwnProfile(),
  ]);
  const plan = planFor(profile?.plan);
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
        <PraznoStanje
          ikona={<ListChecks />}
          naslov="Još nemaš nijedan otključan prospekt."
          opis="Otključavanje troši jedan kredit i otvara telefon, mejl, adresu sajta i pun Ugly Score. Kad otključaš prvi, ovde se pojavljuje tabela koju možeš da izvezeš u CSV i zalepiš u svoj Sheet."
        >
          <Button asChild variant="primary">
            <Link href="/pretraga">Idi na pretragu</Link>
          </Button>
        </PraznoStanje>
      ) : (
        <MojaListaEkran
          leads={leads}
          cityLabels={cityLabels}
          exportPerDay={plan.exportPerDay}
          exportedToday={profile.export_count}
        />
      )}
    </div>
  );
}
