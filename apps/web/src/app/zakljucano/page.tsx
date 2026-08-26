// apps/web/src/app/zakljucano/page.tsx
// Gde stiže nalog kome je i grace period istekao (LANSIRANJE §1.5).
//
// Namerno stoji IZVAN grupe `(app)`: ta grupa je ono što je zaključano, pa bi
// strana o zaključavanju unutar nje bila petlja preusmeravanja. Okvir je isti
// kao na `/cenovnik` — logo, prekidač teme, ništa iz aplikacije.
//
// ‼️ Ovo NIJE `404` i nije prazan ekran, i to je odluka iz §1.5. Čovek koji je
//    do prošlog meseca plaćao mora da pročita ŠTA se desilo, ŠTA je ostalo i
//    ŠTA može da uradi. Prazan ekran na tom mestu je najbrži put do „ukrali ste
//    mi podatke" — a nije obrisano ništa.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { citajPristup } from "@/lib/pristup";
import { formatDatum } from "@/lib/ui-tekst";
import { Button } from "@/components/ui/button";
import { PrekidacTemeDugme } from "@/components/prekidac-teme";
import { ZnakSaImenom } from "@/components/znak";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pristup je istekao",
  // Strana postoji za jednog ulogovanog čoveka; u pretraživaču nema šta da traži.
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireSession();

  const { pristup } = await citajPristup();

  // Ko sme unutra, taj ovde nema šta da radi — uključujući i onoga ko je maločas
  // kupio paket i time se vratio u `dopuna` stanje. Bez ovoga bi strana ostala
  // slepa ulica posle kupovine.
  //
  // `pristup === null` je nepoznato stanje (pokvarena veza sa bazom), i ono se
  // takođe pušta nazad: kvar veze ne sme da izgleda kao istekla pretplata.
  if (!pristup || pristup.cita) redirect("/pretraga");

  return (
    <div className="relative min-h-screen">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[32rem]" />

      <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center justify-between px-5 sm:px-7 lg:px-8">
        <Link href="/cenovnik" className="rounded-lg">
          <ZnakSaImenom imeKlase="text-base" />
        </Link>
        <PrekidacTemeDugme />
      </header>

      <main className="relative mx-auto w-full max-w-xl px-5 pb-24 pt-[clamp(3rem,8vw,6rem)] sm:px-7">
        <div className="rounded-2xl border border-border bg-bg-elev p-6 shadow-card sm:p-8">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-bg-inset text-fg-muted">
            <Lock className="h-5 w-5" aria-hidden />
          </span>

          <h1 className="h2 mt-4">Pristup je istekao</h1>

          <p className="mt-3 text-sm leading-relaxed text-fg-muted">
            {pristup.punDo ? (
              <>
                Pun pristup ti je prestao <span className="num">{formatDatum(pristup.punDo)}</span>.
                Posle toga si imao još mesec dana da otvaraš svoje prospekte i izvezeš ih —
                {pristup.citanjeDo ? (
                  <>
                    {" "}
                    taj rok je istekao{" "}
                    <span className="num">{formatDatum(pristup.citanjeDo)}</span>.
                  </>
                ) : (
                  " i taj rok je istekao."
                )}
              </>
            ) : (
              "Nalog nema ni aktivnu pretplatu, ni betu koja traje, ni kupljene kredite."
            )}
          </p>

          <p className="mt-3 text-sm leading-relaxed text-fg-muted">
            <strong className="font-semibold text-fg">Ništa nije obrisano.</strong> Otključani
            prospekti, pipeline, beleške i poruke stoje tačno kako si ih ostavio i vraćaju se u
            istom trenutku u kom nalog ponovo dobije pristup.
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="primary">
              <Link href="/cenovnik">
                Pogledaj planove
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/cenovnik#paketi">Samo dokupi kredite</Link>
            </Button>
          </div>

          <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-fg-muted">
            Paket kredita je dovoljan — ne moraš na pretplatu. Krediti iz paketa ne ističu i sami
            po sebi vraćaju pun pristup, sa Starter dnevnim limitima.
          </p>
        </div>
      </main>
    </div>
  );
}
