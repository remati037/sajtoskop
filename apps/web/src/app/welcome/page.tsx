// apps/web/src/app/welcome/page.tsx
// Odredište posle uspešnog plaćanja (`success_url` u `/api/billing/checkout`).
//
// ‼️ OVA STRANA NE DODELJUJE NIŠTA. Ne upisuje pretplatu, ne dodaje kredite i ne
//    menja plan. Redirekcija je samo UX: korisnik ume da zatvori tab pre nego
//    što stigne dovde, da izgubi vezu ili da otvori ovaj URL rukom. Izvor istine
//    su Stripe webhookovi (`customer.subscription.created`, `invoice.paid`,
//    `checkout.session.completed`) — v. `app/api/billing/webhook/route.ts`.
//
// Zbog toga i kopija namerno ne kaže „plan ti je aktiviran": u trenutku kad se
// ova strana prikaže, webhook možda još nije stigao. Kaže da je plaćanje primljeno.
//
// ── `?sesija=cs_…` (S26, naplata-stripe.md §5.4) ────────────
// Jedan `checkout.sessions.retrieve` — SAMO za tekst („Starter, mesečno, proba
// do 17. septembra"), dok webhook ne stigne. Ništa se ne upisuje. Sesija se
// prikazuje samo svom vlasniku (`client_reference_id` = Clerk `userId`): ID
// sesije stoji u URL-u, a URL ume da završi u tuđoj istoriji ili na snimku
// ekrana. Svaki kvar (neispravan ID, tuđa sesija, Stripe ne odgovara,
// nepodešen ključ) pada na tekst bez detalja — strana zahvalnosti ne sme da
// pukne zato što je naplata već prošla.

import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { CircleCheck } from "lucide-react";
import { getCurrentUserId } from "@/lib/auth";
import { PAKETI } from "@/lib/cenovnik";
import { stripe } from "@/lib/stripe-server";
import { formatDatum, imePlana } from "@/lib/ui-tekst";
import { LANDING_URL } from "@/lib/veze";
import { Futer } from "@/components/futer";
import { Button } from "@/components/ui/button";
import { ZnakSaImenom } from "@/components/znak";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hvala",
  // Potvrda kupovine nema šta da traži u pretrazi.
  robots: { index: false, follow: false },
};

/** Stripe ID Checkout sesije. Sve drugo se ni ne šalje Stripe-u. */
const sesijaIdSchema = z.string().regex(/^cs_(test|live)_[A-Za-z0-9]{8,250}$/);

const PLAN_IZ_METAPODATAKA = z.enum(["starter", "pro", "advanced"]);

type Opis = {
  /** Naslov strane. Proba nije naplata — i ne sme tako da se zove. */
  naslov: string;
  /** „Starter, mesečno, proba do 17. septembra 2026." */
  stavka: string;
};

async function opisKupovine(sesijaId: string, userId: string): Promise<Opis | null> {
  try {
    const sesija = await stripe().checkout.sessions.retrieve(sesijaId, {
      expand: ["subscription"],
    });
    if (sesija.client_reference_id !== userId) return null;

    if (sesija.mode === "payment") {
      const paket = PAKETI.find((p) => p.id === sesija.metadata?.paket);
      return paket
        ? { naslov: "Plaćanje je primljeno", stavka: `${paket.name}, ${paket.credits} kredita` }
        : null;
    }

    if (sesija.mode === "subscription") {
      const plan = PLAN_IZ_METAPODATAKA.safeParse(sesija.metadata?.plan);
      if (!plan.success) return null;

      const delovi = [
        imePlana(plan.data),
        sesija.metadata?.ciklus === "year" ? "godišnje" : "mesečno",
      ];
      const pretplata = typeof sesija.subscription === "object" ? sesija.subscription : null;
      const krajProbe = pretplata?.trial_end ?? null;

      if (krajProbe) {
        delovi.push(`proba do ${formatDatum(new Date(krajProbe * 1000).toISOString())}`);
        return { naslov: "Proba je počela", stavka: delovi.join(", ") };
      }
      return { naslov: "Plaćanje je primljeno", stavka: delovi.join(", ") };
    }
  } catch (err) {
    // Poruka, ne ceo objekat: Stripe greška nosi i zahtev, a ovaj log je trajan.
    console.error("[welcome] čitanje sesije:", err instanceof Error ? err.message : String(err));
  }
  return null;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [upit, userId] = await Promise.all([searchParams, getCurrentUserId()]);
  // Kupac ume da plati i pre nego što napravi nalog — tada ga vodimo na
  // registraciju, a ne u aplikaciju u koju ne može da uđe.
  const ulogovan = userId !== null;

  const sirovo = Array.isArray(upit.sesija) ? upit.sesija[0] : upit.sesija;
  const sesijaId = sesijaIdSchema.safeParse(sirovo);
  const opis = userId && sesijaId.success ? await opisKupovine(sesijaId.data, userId) : null;

  return (
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[28rem]" />

      <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center px-5 sm:px-7 lg:px-8">
        {/* Logo vodi na landing (S24, §1.7). */}
        <a href={LANDING_URL} className="rounded-lg">
          <ZnakSaImenom imeKlase="text-base" />
        </a>
      </header>

      <main className="relative mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-5 pb-24 text-center sm:px-7">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-wash text-accent-text">
          <CircleCheck className="h-6 w-6" strokeWidth={1.75} />
        </div>

        <h1 className="h2 mt-6">{opis?.naslov ?? "Plaćanje je primljeno"}</h1>

        {opis && (
          <p className="num mt-3 rounded-full border border-border bg-bg-elev px-3.5 py-1.5 text-sm font-medium">
            {opis.stavka}
          </p>
        )}

        <p className="lede mt-4">
          Hvala. Račun stiže mejlom posle svake naplate. Plan se aktivira za koji sekund — ako ga
          ne vidiš na strani „Krediti", osveži stranu.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {ulogovan ? (
            <>
              <Button variant="primary" size="lg" asChild>
                <Link href="/pretraga">Nastavi na pretragu</Link>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <Link href="/krediti">Stanje kredita</Link>
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" asChild>
              <Link href="/?nalog=nov">Napravi nalog</Link>
            </Button>
          )}
        </div>

        <p className="mt-8 text-xs text-fg-muted">
          Ako se plan ne pojavi u roku od nekoliko minuta, piši mi na{" "}
          <a
            href="mailto:podrska@sajtoskop.com"
            className="font-medium text-accent-text underline underline-offset-4"
          >
            podrska@sajtoskop.com
          </a>{" "}
          — imaj pri ruci broj računa iz mejla.
        </p>
      </main>

      <Futer />
    </div>
  );
}
