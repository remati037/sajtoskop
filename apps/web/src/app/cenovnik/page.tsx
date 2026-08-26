// apps/web/src/app/cenovnik/page.tsx
// Javan ekran cena. Namerno stoji IZVAN grupe `(app)`: ta grupa zove
// `requireSession()` u layout-u, a cenovnik mora da radi i neulogovanom
// posetiocu — to mu je i glavna publika.
//
// Zaštite nema jer nema ni podatka koji bi se štitio: sve na strani je javno.
// Sesija se čita samo da bi se znalo DA LI je posetilac prijavljen — gost vidi
// cene, ali ga dugme vodi na registraciju, jer bez `user_id`-ja kupovina nema za
// šta da se veže (S18). Pravilo 8 i dalje važi u punom obliku: `user_id` odavde
// ne izlazi nikuda, `/api/billing/checkout` ga sam uzima iz `auth()`.

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getCurrentUserId } from "@/lib/auth";
import { CenovnikEkran } from "@/components/cenovnik-ekran";
import { PrekidacTemeDugme } from "@/components/prekidac-teme";
import { ZnakSaImenom } from "@/components/znak";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cenovnik",
  description:
    "Tri plana za pronalaženje prospekata u Srbiji, mesečno ili godišnje — i dva paketa " +
    "kredita bez pretplate, čiji krediti ne ističu.",
};

/**
 * Zemlja posetioca iz CDN zaglavlja.
 *
 * Vercel postavlja `x-vercel-ip-country` na svaki zahtev. Lokalno ga nema, a na
 * nepoznatoj lokaciji ume da stigne `XX` — oba slučaja su `null`, i to je bolje
 * od pogađanja: bez `address` Paddle sam odredi zemlju po IP-u posetioca, iz
 * pregledača, dakle tačnije nego što bismo mi umeli sa servera.
 *
 * Vrednost se ne prosleđuje dalje sirova. Paddle prima ISO 3166-1 alpha-2 i
 * odbija sve ostalo, pa se oblik proverava ovde.
 */
function drzavaIzZaglavlja(vrednost: string | null): string | null {
  if (!vrednost) return null;
  const kod = vrednost.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(kod) || kod === "XX") return null;
  return kod;
}

export default async function Page() {
  const [zaglavlja, userId] = await Promise.all([
    headers(),
    // `getCurrentUserId()`, ne `currentUser()`: treba nam samo POSTOJANJE sesije,
    // a `currentUser()` za to ide na Clerk API. Mejl se od S18 nigde ne koristi
    // — kupovinu vezuje `user_id`, ne adresa sa koje je plaćeno.
    getCurrentUserId().catch((err: unknown) => {
      console.error("[cenovnik] čitanje Clerk sesije:", err);
      return null;
    }),
  ]);

  const drzava = drzavaIzZaglavlja(zaglavlja.get("x-vercel-ip-country"));
  const prijavljen = userId !== null;

  return (
    <div className="relative min-h-screen">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[32rem]" />

      <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center justify-between px-5 sm:px-7 lg:px-8">
        <Link href="/" className="rounded-lg">
          <ZnakSaImenom imeKlase="text-base" />
        </Link>
        <div className="flex items-center gap-2">
          <PrekidacTemeDugme />
          <Link
            href={prijavljen ? "/pretraga" : "/"}
            className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            {prijavljen ? "Aplikacija" : "Prijava"}
          </Link>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-[1160px] px-5 pb-[clamp(4.5rem,9vw,8rem)] pt-[clamp(2.5rem,6vw,5rem)] sm:px-7 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Cenovnik</p>
          <h1 className="h1 mt-3">Plati po tome koliko tražiš</h1>
          <p className="lede mx-auto mt-4 max-w-xl">
            Kredit je jedan otključan prospekt ili jedna stranica skeniranja — do 20 rezultata.
            Pretraga po onome što je već skenirano ne troši ništa i neograničena je na svim
            planovima. Ako ti pretplata ne treba,{" "}
            <a href="#paketi" className="font-medium text-accent-text underline underline-offset-4">
              paket kredita
            </a>{" "}
            se kupuje i sam.
          </p>
        </div>

        <div className="mt-10 sm:mt-12">
          <CenovnikEkran drzava={drzava} prijavljen={prijavljen} />
        </div>
      </main>
    </div>
  );
}
