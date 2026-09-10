// apps/web/src/app/page.tsx
// Početna strana app-a JESTE ulaz u nalog — prijava ili registracija, sa
// prekidačem između njih.
//
// Marketinški landing (hero, brojke iz seed izveštaja, FAQ) živi na prodajnom
// domenu, VAN ovog repozitorijuma. Držati privremenu verziju i ovde značilo bi
// dva izvora istine za istu kopiju, pa je ovde nema.
//
// ── S24: ovo je poddomen, ne ceo sajt ──────────────────────
// Aplikacija stoji na `app.` poddomenu, a prodajna strana na golom domenu
// (`docs/LANSIRANJE.md` §1.7). Ova strana je zato jedini ekran koji nije
// dostupan sa landinga preko loga, pa mora sama da ponudi put nazad — i logo i
// jedan diskretan link ispod forme. Bez toga je forma za prijavu ćorsokak za
// nekoga ko je kliknuo „Prijavi se" iz radoznalosti.
//
// Raspored: levo brend i jedna rečenica šta alat radi, desno forma. Na telefonu
// ostaje samo desna kolona sa znakom iznad forme.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Filter, MessageSquareText, Phone } from "lucide-react";
import { getCurrentUserId } from "@/lib/auth";
import { LANDING_URL } from "@/lib/veze";
import { AuthEkran, type Rezim } from "@/components/auth-ekran";
import { Futer } from "@/components/futer";
import { PrekidacTemeDugme } from "@/components/prekidac-teme";
import { ZnakSaImenom } from "@/components/znak";

const SVOJSTVA = [
  {
    Ikona: Filter,
    naslov: 'Filter „nema sajt"',
    opis: "Najbolji lead je firma koja sajt uopšte nema — ne firma sa ružnim sajtom.",
  },
  {
    Ikona: Phone,
    naslov: "Tip telefona iz prefiksa",
    opis: "Znaš unapred da li ide Viber ili poziv, pre nego što otvoriš broj.",
  },
  {
    Ikona: MessageSquareText,
    naslov: "Poruka po kanalu",
    opis: "Mejl, Viber i Instagram — svaki sa svojim tonom i svojom dužinom.",
  },
];

/**
 * `?nazad=` → putanja na koju se sme vratiti posle ulaska, ili `null`.
 *
 * Ovo NIJE ukras nego jedina brana ispred otvorene redirekcije: neprovereno
 * `?nazad=https://zla-strana.example` pretvorilo bi našu stranu za prijavu u
 * odskočnu dasku za phishing, i to sa pravim domenom u adresnoj traci.
 *
 * Zato prolazi samo APSOLUTNA INTERNA putanja: mora da počne jednom kosom
 * crtom, a `//host` i `/\host` se odbijaju — pregledač ih čita kao adresu sa
 * drugog domena, iako počinju kosom crtom.
 */
function internaPutanja(vrednost: string | undefined): string | null {
  if (!vrednost || !vrednost.startsWith("/")) return null;
  if (vrednost.startsWith("//") || vrednost.startsWith("/\\")) return null;
  return vrednost;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ nalog?: string; nazad?: string }>;
}) {
  // `/registracija` preusmerava ovamo sa `?nalog=nov`, pa stari linkovi i dalje
  // otvaraju pravu karticu.
  const { nalog, nazad } = await searchParams;
  const pocetni: Rezim = nalog === "nov" ? "registracija" : "prijava";
  const posle = internaPutanja(nazad);

  // Ulogovan korisnik na početnoj nema šta da traži — forma bi mu bila ćorsokak.
  // Ako je stigao sa `?nazad=`, vodi ga tamo: to je čovek koji je već prijavljen
  // u drugom tabu i kliknuo „Uzmi plan" — `/pretraga` bi mu progutalo nameru.
  if (await getCurrentUserId()) redirect(posle ?? "/pretraga");

  return (
    // Dva sloja: gornji drži dve kolone i zauzima bar ceo ekran, futer stoji
    // ispod njega. `flex-1` na gornjem sloju znači da se na visokom prozoru
    // rasteže on, a ne futer — i da se na `/` ne dobija suvišan skrol.
    <div className="flex min-h-screen flex-col">
      <div className="relative flex flex-1 flex-col lg:grid lg:grid-cols-[1.05fr_1fr]">
        <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
          <PrekidacTemeDugme />
        </div>

        {/* ── brend, samo desktop ──────────────────────────────── */}
        <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-bg-subtle/60 p-10 lg:flex xl:p-14">
          <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0" />

          <a href={LANDING_URL} className="relative inline-flex rounded-lg">
            <ZnakSaImenom imeKlase="text-base" />
          </a>

          <div className="relative max-w-md">
            <h1 className="text-3xl font-semibold leading-[1.12] tracking-tight xl:text-4xl">
              Biznisi u Srbiji kojima sajt ne valja —{" "}
              {/* Istaknuta reč u naslovu ide kroz `--accent-text`, ne kroz
                  `--accent` — zelena kao tekst na `--bg` pada na kontrastu u
                  svetloj temi (dizajn sistem, pravilo 3). */}
              <span className="text-accent-text">ili ga uopšte nema.</span>
            </h1>

            <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">
              Izabereš grad i nišu. Alat prođe kroz Google Maps, oceni svaki sajt i vrati ti
              kontakt, listu konkretnih problema i pripremljenu poruku — spremno za slanje.
            </p>

            {/* Lista, ne kartice: kartica u koloni koja već ima svoju podlogu je
                kartica u kartici (dizajn sistem §7.2). */}
            <ul className="mt-9 space-y-5">
              {SVOJSTVA.map(({ Ikona, naslov, opis }) => (
                <li key={naslov} className="flex gap-3.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent-text">
                    <Ikona className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{naslov}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{opis}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative max-w-sm text-xs leading-relaxed text-fg-muted">
            Podaci su javni, sa Google Maps-a, preko zvaničnog API-ja.
          </p>
        </aside>

        {/* ── forma ────────────────────────────────────────────── */}
        <main className="relative flex flex-1 flex-col items-center justify-center gap-7 overflow-hidden px-5 py-14 sm:px-8">
          <div
            aria-hidden
            className="pozadina-aure pointer-events-none absolute inset-0 opacity-70 lg:hidden"
          />

          <a href={LANDING_URL} className="relative inline-flex rounded-lg lg:hidden">
            <ZnakSaImenom />
          </a>

          <AuthEkran key={pocetni} pocetni={pocetni} {...(posle ? { posle } : {})} />

          {/* ‼️ Do 27.8. je ovde stajalo „Beta je besplatna dok traje. 30 kredita
              mesečno, bez kartice." — netačno od S16 i S20: naplata ide od prvog
              dana, beta je RUČAN izuzetak iz konzole, a nov nalog dobija plan
              `dopuna` i nula kredita.

              Iznos u evrima se ne pominje ni ovde: cena stoji na `/cenovnik`, iz
              `plans.ts`, i to je jedino mesto na kome se ispisuje. */}
          <p className="relative max-w-[25rem] text-center text-xs leading-relaxed text-fg-muted">
            Nalog otvaraš odmah i besplatno. Za skeniranje i otključavanje prospekata treba
            plan —{" "}
            <Link
              href="/cenovnik"
              className="font-medium text-accent-text underline underline-offset-4"
            >
              pogledaj cenovnik
            </Link>
            .
          </p>

          {/* Put nazad na prodajnu stranu (S24). Diskretno i bez akcenta: ovo
              je izlaz, a jedino primarno dugme na ekranu je ono u formi. Domen
              se ne ispisuje — stoji u `lib/veze.ts` i menja se kroz env. */}
          <a
            href={LANDING_URL}
            className="relative inline-flex items-center gap-1.5 rounded-lg text-xs text-fg-muted transition-colors hover:text-fg"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Nazad na početnu
          </a>
        </main>
      </div>

      <Futer />
    </div>
  );
}
