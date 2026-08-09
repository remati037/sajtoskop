// apps/web/src/app/(app)/lista/page.tsx
// Otključani prospekti (F4 §3). Ovo je jedini ekran na kome korisnik vidi ono
// za šta je platio kredite — i jedini iz kog izlazi CSV.

import Link from "next/link";
import { CITIES, planFor } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { getMojaLista } from "@/lib/moja-lista";
import { getOwnProfile } from "@/lib/profile";
import { MojaListaEkran } from "@/components/moja-lista-ekran";
import { VezaGreska } from "@/components/veza-greska";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Prva linija svake zaštićene stranice — ni middleware ni layout ovo ne rade.
  await requireSession();

  const [leads, profile] = await Promise.all([getMojaLista(), getOwnProfile()]);
  const plan = planFor(profile?.plan);
  const cityLabels = Object.fromEntries(CITIES.map((c) => [c.slug, c.label]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Moja lista</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Prospekti koje si otključao. Ostaju ti zauvek — otključan lead se nikad ne
          naplaćuje drugi put.
        </p>
      </header>

      {/* Redosled je bitan: prvo se isključuje mogućnost da je lista prazna zato
          što RLS ne prepoznaje korisnika, pa tek onda ide prijateljsko prazno
          stanje. Obrnuto bi značilo da pokvarena veza izgleda kao „nemaš ništa". */}
      {!profile ? (
        <VezaGreska sta="Otključani prospekti" />
      ) : leads.length === 0 ? (
        <PraznoStanje />
      ) : (
        <MojaListaEkran
          leads={leads}
          cityLabels={cityLabels}
          exportPerDay={plan.exportPerDay}
          exportedToday={profile.export_count}
        />
      )}
    </main>
  );
}

/**
 * Prazno stanje sa jasnim uputstvom, ne praznom tabelom (F4 §3).
 * Korisnik koji ovde stigne pre prvog otključavanja treba da zna tačno šta dobija
 * za kredit i gde se to radi.
 */
function PraznoStanje() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-5 py-6 dark:border-neutral-800 dark:bg-neutral-900/50">
      <p className="font-medium">Još nemaš nijedan otključan prospekt.</p>
      <p className="mt-1 max-w-xl text-sm text-neutral-500">
        Otključavanje troši jedan kredit i otvara telefon, mejl, adresu sajta i pun Ugly
        Score. Kad otključaš prvi, ovde se pojavljuje tabela koju možeš da izvezeš u CSV
        i zalepiš u svoj Sheet.
      </p>
      <Link href="/pretraga" className="mt-4 inline-block text-sm underline underline-offset-4">
        Idi na pretragu
      </Link>
    </div>
  );
}
