import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { ArrowRight, Camera, Filter, MessageSquareText, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrekidacTemeDugme } from "@/components/prekidac-teme";
import { ZnakSaImenom } from "@/components/znak";

// Privremena javna stranica. Pravi landing sa brojkama iz seed izveštaja
// dolazi u F8 — ovde nema nijedne izmišljene brojke, samo ono što alat stvarno
// radi. Vizuelni jezik je isti kao u aplikaciji, da prelaz sa landing-a na
// proizvod ne izgleda kao dva različita sajta.

const SVOJSTVA = [
  {
    Ikona: Filter,
    naslov: 'Filter „nema sajt"',
    opis: "Kod nas je najbolji lead firma koja sajt uopšte nema — ne firma sa ružnim sajtom.",
  },
  {
    Ikona: Phone,
    naslov: "Tip telefona iz prefiksa",
    opis: "Znaš unapred da li ide Viber ili poziv, pre nego što otvoriš broj.",
  },
  {
    Ikona: Camera,
    naslov: "Snimak i analiza",
    opis: "Mobilni i desktop prikaz, Ugly Score i lista konkretnih problema na srpskom.",
  },
  {
    Ikona: MessageSquareText,
    naslov: "Poruka po kanalu",
    opis: "Mejl, Viber i Instagram — svaki sa svojim tonom i svojom dužinom.",
  },
];

export default function Page() {
  return (
    <div className="relative min-h-screen">
      <div aria-hidden className="pozadina-aure pointer-events-none fixed inset-0 -z-10" />

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <ZnakSaImenom />
        <div className="flex items-center gap-2">
          <PrekidacTemeDugme />
          <Show when="signed-out">
            <Button asChild variant="ghost" size="sm">
              <Link href="/prijava">Prijavi se</Link>
            </Button>
          </Show>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 pb-24 pt-10 sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Beta je besplatna dok traje — ne zauvek.
        </span>

        <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          Biznisi u Srbiji kojima sajt ne valja —{" "}
          <span className="bg-[linear-gradient(100deg,oklch(0.62_0.2_290),oklch(0.55_0.16_250))] bg-clip-text text-transparent">
            ili ga uopšte nema.
          </span>
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Izabereš grad i nišu. Alat prođe kroz Google Maps, oceni svaki sajt i vrati ti kontakt,
          listu konkretnih problema i pripremljenu poruku — spremno za slanje.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {/* Clerk 7: `<Show when="...">` je zamenio `<SignedIn>` / `<SignedOut>`. */}
          <Show when="signed-out">
            <Button asChild variant="primary" size="lg">
              <Link href="/registracija">
                Uđi u besplatnu betu
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/prijava">Prijavi se</Link>
            </Button>
          </Show>

          <Show when="signed-in">
            <Button asChild variant="primary" size="lg">
              <Link href="/pretraga">
                Nastavi na pretragu
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Show>
        </div>

        <section className="mt-20 grid gap-3 sm:grid-cols-2">
          {SVOJSTVA.map(({ Ikona, naslov, opis }) => (
            <div
              key={naslov}
              className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Ikona className="h-4 w-4" />
              </span>
              <p className="mt-3.5 text-sm font-semibold">{naslov}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{opis}</p>
            </div>
          ))}
        </section>

        <p className="mt-12 text-xs text-muted-foreground">
          Podaci su javni, sa Google Maps-a, preko zvaničnog API-ja. 30 kredita mesečno, bez
          kartice.
        </p>
      </main>
    </div>
  );
}
