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
import { smeDaKupiPaket } from "@sajtoskop/shared";
import { getCurrentUserId } from "@/lib/auth";
import { sellerName } from "@/lib/env";
import { citajPristup } from "@/lib/pristup";
import { imaoProbuRanije } from "@/lib/proba";
import { citajNameru } from "@/lib/cenovnik-namera-schema";
import { LANDING_URL } from "@/lib/veze";
import { CenovnikEkran } from "@/components/cenovnik-ekran";
import { Futer } from "@/components/futer";
import { PrekidacTemeDugme } from "@/components/prekidac-teme";
import { ZnakSaImenom } from "@/components/znak";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cenovnik",
  description:
    "Tri plana za pronalaženje prospekata u Srbiji, mesečno ili godišnje — i dva paketa " +
    "kredita kao dopuna uz plan, čiji krediti ne ističu.",
};

/**
 * Da li rečenica „Proba 7 dana…" sme da stoji iznad kartica (S26).
 *
 * Isto pitanje postavlja checkout (`imaoProbuRanije`), pa je odgovor isti po
 * konstrukciji. Gost probu dobija (nov nalog je nikad nije imao); komp i
 * pozivnica ne. Kvar upita SKRIVA rečenicu: izostavljeno obećanje je manja
 * šteta od obećane probe koju Stripe strana onda ne pokaže.
 */
async function nudiProbu(userId: string | null, gratisMesec: boolean, komp: boolean) {
  if (userId === null) return true;
  if (gratisMesec || komp) return false;
  return imaoProbuRanije(userId).then(
    (imao) => !imao,
    (err: unknown) => {
      console.error("[cenovnik] čitanje probe:", err);
      return false;
    },
  );
}

export default async function Page({
  searchParams,
}: {
  /**
   * Namera sa landinga: `?plan=`, `?ciklus=`, `?paket=` (§1.7).
   *
   * ‼️ Ništa odavde se ne veruje i ništa ne može da obori stranu — v.
   *    `lib/cenovnik-namera.ts`. Nepoznata vrednost se ponaša kao da je nije
   *    bilo, jer je ovo javan link sa tuđe strane, ne API.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [upit, userId, { pristup, profile }] = await Promise.all([
    searchParams,
    // `getCurrentUserId()`, ne `currentUser()`: treba nam samo POSTOJANJE sesije,
    // a `currentUser()` za to ide na Clerk API. Mejl se od S18 nigde ne koristi
    // — kupovinu vezuje `user_id`, ne adresa sa koje je plaćeno.
    getCurrentUserId().catch((err: unknown) => {
      console.error("[cenovnik] čitanje Clerk sesije:", err);
      return null;
    }),
    // Stanje naloga određuje da li se paketi uopšte mogu kupiti (odluka 26.8.).
    // Gost nema sesiju, pa ovo vrati `pristup: null` bez ijednog upita — a
    // `smeDaKupiPaket(null)` je `false`, što je za gosta i tačno.
    citajPristup().catch((err: unknown) => {
      console.error("[cenovnik] čitanje pristupa:", err);
      return { pristup: null, profile: null };
    }),
  ]);

  const prijavljen = userId !== null;
  const namera = citajNameru(upit);

  // [S26] Pozivnica „prvi mesec gratis": izvor istine je `profiles.invite_id`,
  // isti koji čita checkout. `?pozivnica=1` iz spec-a se NE traži uz njega —
  // checkout kupon dodaje po `invite_id` bez obzira na link, pa bi ekran koji
  // čeka parametar pokazao punu cenu i probu, a Stripe onda €0 i bez probe.
  const gratisMesec = (profile?.invite_id ?? null) !== null;
  const probaDostupna = await nudiProbu(userId, gratisMesec, pristup?.stanje === "komp");

  return (
    // `flex flex-col` + `flex-1` na `<main>`: bez toga futer stoji odmah ispod
    // sadržaja, a ne na dnu ekrana, na kratkim prozorima.
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[32rem]" />

      <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center justify-between px-5 sm:px-7 lg:px-8">
        {/* Logo vodi na landing (S24, §1.7) — posetilac koji je došao sa
            prodajne strane očekuje nazad na nju, ne u formu za prijavu. */}
        <a href={LANDING_URL} className="rounded-lg">
          <ZnakSaImenom imeKlase="text-base" />
        </a>
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

      <main className="relative mx-auto w-full max-w-[1160px] flex-1 px-5 pb-[clamp(4.5rem,9vw,8rem)] pt-[clamp(2.5rem,6vw,5rem)] sm:px-7 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Cenovnik</p>
          <h1 className="h1 mt-3">Plati po tome koliko tražiš</h1>
          <p className="lede mx-auto mt-4 max-w-xl">
            Kredit je jedan otključan prospekt ili jedna stranica skeniranja — do 20 rezultata.
            Ono što je već u kešu stiže odmah, po istoj ceni, a plaćen pristup važi 30 dana bez
            daljih kredita. Kad ti plan ne bude dovoljan,{" "}
            <a href="#paketi" className="font-medium text-accent-text underline underline-offset-4">
              paket kredita
            </a>{" "}
            ga dopunjuje.
          </p>
        </div>

        <div className="mt-10 sm:mt-12">
          <CenovnikEkran
            prijavljen={prijavljen}
            smePaket={smeDaKupiPaket(pristup ?? null)}
            namera={namera}
            prodavac={sellerName()}
            gratisMesec={gratisMesec}
            probaDostupna={probaDostupna}
          />
        </div>
      </main>

      <Futer />
    </div>
  );
}
