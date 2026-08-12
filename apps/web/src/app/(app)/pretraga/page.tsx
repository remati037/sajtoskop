// apps/web/src/app/(app)/pretraga/page.tsx
// Glavni ekran F2. Server komponenta priprema taksonomiju, klijent radi ostalo.
//
// Zašto se lista prosleđuje kao `{value, label}`, a ne se `NICHES` uvozi direktno
// u klijentsku komponentu: taksonomija nosi i `query`, `buyingPower` i
// `badSiteOdds` — interni podaci o tome koje niše love. Nemaju šta da traže u
// klijentskom bundle-u.

import type { Metadata } from "next";
import { CITIES, NICHES, nichePriority, type NicheGroup } from "@sajtoskop/shared";
import { requireSession, requireUserId } from "@/lib/auth";
import { PretragaEkran } from "@/components/pretraga-ekran";
import type { ComboGroup } from "@/components/combobox";
import { ZaglavljeStranice } from "@/components/ui/stranica";
import { getOwnProfile } from "@/lib/profile";
import { listaKesa } from "@/lib/search-cache";
import type { KesStavka } from "@/lib/search-types";
import { GROUP_LABEL } from "@/lib/ui-tekst";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pretraga" };

export default async function Page() {
  // Prva linija svake zaštićene stranice — middleware ovo više ne radi.
  await requireSession();
  const userId = await requireUserId();

  // Registar keša i balans idu u prvi render, a ne u zahtev iz pregledača:
  // cena mora da stoji ispod forme čim se strana otvori, pre ijednog klika.
  //
  // Nijedan od ova dva poziva ne sme da obori stranu. Bez liste keša pretraga i
  // dalje radi (server proverava cenu na svakom zahtevu), a bez balansa modal
  // prikaže 0 i korisnik vidi „nemaš kredita" umesto belog ekrana.
  const [kes, profile] = await Promise.all([
    listaKesa(userId).catch((err: unknown) => {
      console.error("[pretraga] registar keša:", err);
      return [] as KesStavka[];
    }),
    getOwnProfile().catch(() => null),
  ]);

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
  const nicheLabels = Object.fromEntries(NICHES.map((n) => [n.slug, n.label]));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Pretraga prospekata"
        opis="Biznisi poređani po tome koliko im sajt loše stoji. Prvo oni koji sajt uopšte nemaju. Sve što je već u kešu je besplatno."
      />

      <PretragaEkran
        cities={cities}
        niches={[...byGroup.values()]}
        cityLabels={cityLabels}
        nicheLabels={nicheLabels}
        pocetniKes={kes}
        pocetniKrediti={profile?.credits_balance ?? 0}
      />
    </div>
  );
}
