// apps/web/src/app/(app)/pretraga/page.tsx
// Glavni ekran F2. Server komponenta priprema taksonomiju, klijent radi ostalo.
//
// Zašto se lista prosleđuje kao `{value, label}`, a ne se `NICHES` uvozi direktno
// u klijentsku komponentu: taksonomija nosi i `query`, `buyingPower` i
// `badSiteOdds` — interni podaci o tome koje niše love. Nemaju šta da traže u
// klijentskom bundle-u.

import type { Metadata } from "next";
import {
  CITIES,
  CITY_SLUGS,
  jeNeograniceno,
  NICHE_SLUGS,
  NICHES,
  nichePriority,
  uzrokGrace,
  type NicheGroup,
} from "@sajtoskop/shared";
import { requireSession, requireUserId } from "@/lib/auth";
import { PretragaEkran, type SamoCitanje } from "@/components/pretraga-ekran";
import type { ComboGroup } from "@/components/combobox";
import { ZaglavljeStranice } from "@/components/ui/stranica";
import { zahtevajOnboarding } from "@/lib/onboarding";
import { zahtevajCitanje } from "@/lib/pristup";
import { listaKesa } from "@/lib/search-cache";
import type { KesStavka } from "@/lib/search-types";
import { formatDatum, GROUP_LABEL } from "@/lib/ui-tekst";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pretraga" };

export default async function Page() {
  // Prva linija svake zaštićene stranice — middleware ovo više ne radi.
  await requireSession();
  const userId = await requireUserId();

  // Druga linija: kapija pristupa (S19). Zaključan nalog odlazi na
  // `/zakljucano`; ostali dobijaju stanje i strana sama odlučuje šta crta.
  // Layout ovo NE može da uradi umesto strane — ne izvršava se ponovo pri
  // klijentskoj navigaciji sa `/lista` ovamo.
  const { pristup, profile, pretplata } = await zahtevajCitanje();
  // [S30, §1.8] Treća linija: nov nalog sa pristupom ide u čarobnjak.
  zahtevajOnboarding(profile, pristup);

  // ── nalog bez punog pristupa (`grace`) ──────────────────────
  // Do posle S30 je ovde forma bila ZAMENJENA objašnjenjem. U praksi je to
  // brisalo listu koju je čovek upravo platio: poslednji kredit prebaci nalog u
  // `grace`, `router.refresh()` posle naplate ponovo crta ovu stranu, i ekran sa
  // rezultatima nestane u sekundi u kojoj su stigli.
  //
  // Sada ekran ostaje isti — i to doslovno isti element, da React ne izgubi
  // stanje liste pri osvežavanju — samo u režimu „samo plaćeno": plaćene liste
  // se otvaraju, listaju i filtriraju; ništa novo se ne nudi. Server to isto
  // brani sam (`/api/search`, `/api/unlock`); ovo je objašnjenje, ne zaštita.
  // Tekst po uzroku (§2.3) računa se ovde, jer uzrok traži pretplatu.
  let samoCitanje: SamoCitanje | null = null;
  if (pristup && !pristup.pun) {
    const uzrok = uzrokGrace(pristup, pretplata);
    const ostaje = (
      <>
        Liste koje si već platio otvaraš i dalje
        {pristup.citanjeDo && (
          <>
            {" "}
            do <span className="num">{formatDatum(pristup.citanjeDo)}</span>
          </>
        )}{" "}
        — izaberi ih iz liste ispod.
      </>
    );

    samoCitanje =
      uzrok === "besplatni"
        ? {
            naslov: "Nemaš više kredita",
            opis: <>Nove pretrage i otključavanja ne rade. {ostaje}</>,
            cta: { href: "/cenovnik", label: "Pogledaj planove" },
          }
        : uzrok === "naplata"
          ? {
              naslov: "Naplata nije prošla",
              opis: <>Nove pretrage i otključavanja ne rade dok ne ažuriraš karticu. {ostaje}</>,
              cta: { href: "/krediti", label: "Ažuriraj karticu" },
            }
          : {
              naslov: "Pristup je istekao",
              opis: <>Nove pretrage i otključavanja ne rade dok ne uzmeš plan. {ostaje}</>,
              cta: { href: "/cenovnik", label: "Uzmi plan" },
            };
  }

  // Registar keša ide u prvi render, a ne u zahtev iz pregledača: cena mora da
  // stoji ispod forme čim se strana otvori, pre ijednog klika. Ne sme da obori
  // stranu — bez njega pretraga radi, jer server proverava cenu na svakom
  // zahtevu. Balans dolazi iz profila koji je kapija već pročitala.
  const kes = await listaKesa(userId).catch((err: unknown) => {
    console.error("[pretraga] registar keša:", err);
    return [] as KesStavka[];
  });

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

  // [S30, §4.2] „Kad izabereš, nišu i grad pamtim kao podrazumevane za pretragu."
  // Samo slug koji i dalje postoji u taksonomiji — preimenovana niša ne sme da
  // napuni formu vrednošću koju combobox ne ume da prikaže.
  const podrazumevaniGrad =
    profile?.onboarding_city && (CITY_SLUGS as readonly string[]).includes(profile.onboarding_city)
      ? profile.onboarding_city
      : null;
  const podrazumevanaNisa =
    profile?.onboarding_niche && (NICHE_SLUGS as readonly string[]).includes(profile.onboarding_niche)
      ? profile.onboarding_niche
      : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Pretraga prospekata"
        opis="Biznisi poređani po tome koliko im sajt loše stoji. Prvo oni koji sajt uopšte nemaju. Sve što je u kešu stiže odmah, po istoj ceni; plaćen pristup važi 30 dana."
      />

      <PretragaEkran
        cities={cities}
        niches={[...byGroup.values()]}
        cityLabels={cityLabels}
        nicheLabels={nicheLabels}
        pocetniKes={kes}
        // Zbir OBE kase (0022): potrošnja prazni prvo `credits_balance`, pa
        // `credits_topup`, i `/api/search` proverava zbir. Prikazati ovde samo
        // balans značilo bi da modal kaže „nemaš dovoljno" čoveku koji ima
        // kupljen paket — a server bi mu isto skeniranje mirno naplatio.
        pocetniKrediti={(profile?.credits_balance ?? 0) + (profile?.credits_topup ?? 0)}
        // [0029] Admin: dugmad bez cene, bez „nemaš dovoljno".
        neograniceno={jeNeograniceno(pristup)}
        samoCitanje={samoCitanje}
        podrazumevaniGrad={podrazumevaniGrad}
        podrazumevanaNisa={podrazumevanaNisa}
      />
    </div>
  );
}
