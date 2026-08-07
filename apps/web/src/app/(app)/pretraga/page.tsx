// apps/web/src/app/(app)/pretraga/page.tsx
// Glavni ekran F2. Server komponenta priprema taksonomiju, klijent radi ostalo.
//
// Zašto se lista prosleđuje kao `{value, label}`, a ne se `NICHES` uvozi direktno
// u klijentsku komponentu: taksonomija nosi i `query`, `buyingPower` i
// `badSiteOdds` — interni podaci o tome koje niše love. Nemaju šta da traže u
// klijentskom bundle-u.

import { CITIES, NICHES, nichePriority, type NicheGroup } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { PretragaEkran } from "@/components/pretraga-ekran";
import type { ComboGroup } from "@/components/combobox";
import { GROUP_LABEL } from "@/lib/ui-tekst";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Prva linija svake zaštićene stranice — middleware ovo više ne radi.
  await requireSession();

  // Gradovi: jedna grupa, tier pa abeceda. Veliki gradovi imaju najviše u kešu.
  const cities: ComboGroup[] = [
    {
      label: "Gradovi",
      options: [...CITIES]
        .sort((a, b) => a.tier - b.tier || a.label.localeCompare(b.label, "sr-Latn-RS"))
        .map((c) => ({ value: c.slug, label: c.label })),
    },
  ];

  // Niše: grupisane po `NicheGroup`, unutar grupe sortirane po `nichePriority`
  // opadajuće — najisplativije niše prve (F2 §5).
  const byGroup = new Map<NicheGroup, ComboGroup>();
  for (const niche of [...NICHES].sort(
    (a, b) => nichePriority(b) - nichePriority(a) || a.label.localeCompare(b.label, "sr-Latn-RS"),
  )) {
    const group = byGroup.get(niche.group) ?? { label: GROUP_LABEL[niche.group], options: [] };
    group.options.push({ value: niche.slug, label: niche.label });
    byGroup.set(niche.group, group);
  }

  const cityLabels = Object.fromEntries(CITIES.map((c) => [c.slug, c.label]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Pretraga prospekata</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Biznisi poređani po tome koliko im sajt loše stoji. Prvo oni koji sajt uopšte nemaju.
        </p>
      </header>

      <PretragaEkran cities={cities} niches={[...byGroup.values()]} cityLabels={cityLabels} />
    </main>
  );
}
