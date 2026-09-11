// apps/web/src/app/(app)/pretraga/page.tsx
// Glavni ekran F2. Server komponenta priprema taksonomiju, klijent radi ostalo.
//
// Zašto se lista prosleđuje kao `{value, label}`, a ne se `NICHES` uvozi direktno
// u klijentsku komponentu: taksonomija nosi i `query`, `buyingPower` i
// `badSiteOdds` — interni podaci o tome koje niše love. Nemaju šta da traže u
// klijentskom bundle-u.

import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { CITIES, NICHES, nichePriority, type NicheGroup } from "@sajtoskop/shared";
import { requireSession, requireUserId } from "@/lib/auth";
import { PretragaEkran } from "@/components/pretraga-ekran";
import type { ComboGroup } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { PraznoStanje, ZaglavljeStranice } from "@/components/ui/stranica";
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
  const { pristup, profile } = await zahtevajCitanje();

  // Ovo je JEDINI ekran na kome se troše krediti — i pretraga, i skeniranje, i
  // otključavanje su ovde. Zato je i jedini na kome `grace` menja sadržaj: forma
  // se ne crta onemogućena, nego zamenjuje objašnjenjem. Onemogućen combobox uz
  // onemogućeno dugme uz onemogućen prekidač dubine je tri mrtve kontrole i
  // nijedna rečenica o tome zašto.
  //
  // Server svejedno odbija svaki zahtev (v. `odbijenica()` u `/api/search` i
  // `/api/unlock`) — ovo je objašnjenje, ne zaštita.
  if (pristup && !pristup.pun) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <ZaglavljeStranice naslov="Pretraga prospekata" />
        <PraznoStanje
          ikona={<Lock aria-hidden />}
          naslov="Pretraga i skeniranje su stali"
          opis={
            // [S28, O3] Dva razloga za isto stanje, dve rečenice: nalog kome je
            // plan istekao ima datum, nov nalog koji je potrošio kredite
            // dobrodošlice ga nema (`punDo === null`) — i njemu „pristup ti je
            // istekao" ne znači ništa, jer ga nikad nije ni platio.
            pristup.stanje === "grace" ? (
              pristup.punDo === null ? (
                <>
                  Besplatni krediti su potrošeni. Do{" "}
                  <span className="num">{formatDatum(pristup.citanjeDo)}</span> tvoji prospekti,
                  pipeline i oba izvoza rade normalno — nova lista, skeniranje i otključavanje ne.
                </>
              ) : (
                <>
                  Pristup ti je istekao{" "}
                  <span className="num">{formatDatum(pristup.punDo)}</span>. Do{" "}
                  <span className="num">{formatDatum(pristup.citanjeDo)}</span> tvoji prospekti,
                  pipeline i oba izvoza rade normalno — pretraga, skeniranje i otključavanje ne.
                </>
              )
            ) : (
              "Nalog trenutno nema pristup pretrazi. Otključani prospekti i pipeline su netaknuti."
            )
          }
        >
          <Button asChild variant="primary">
            <Link href="/cenovnik">Uzmi plan</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/cenovnik#paketi">Dokupi kredite</Link>
          </Button>
        </PraznoStanje>
      </div>
    );
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
      />
    </div>
  );
}
