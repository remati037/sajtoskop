// apps/web/src/app/(admin)/admin/pozivnice/page.tsx
// Dve vrste pozivnica na jednoj strani (F12 §3.3, S27 / naplata-stripe.md §9.3).
//
//   1. Pristupne pozivnice — kod koji daje komp ili prvi mesec gratis. Žive u
//      našoj bazi (`access_invites`, 0025).
//   2. Clerk pozivnice — ulazak u nalog: pozivnica na mejl, ili nalog odmah sa
//      generisanom lozinkom. Žive u Clerku.
//
// Pristupne stoje prve jer se od S27 koriste češće: Clerk pozivnica daje nalog
// bez plana, pa sama po sebi nikome više ne otvara pristup.
//
// Oba spiska se čitaju ovde, na serveru — bez `GET` rute pod `/api/admin`
// (isti razlog kao za listu korisnika, v. „S3 — šta se razišlo", tačka 3). Sve
// što menja stanje ide kroz `POST`/`DELETE` i ostavlja red u reviziji.

import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin";
import { citajPozivnice as citajClerkPozivnice } from "@/lib/admin-pozivnice";
import { citajPozivnice as citajPristupne } from "@/lib/pozivnice-pristup";
import { Pozivnice } from "@/components/admin-pozivnice";
import { PristupnePozivnice } from "@/components/admin-pozivnice-pristup";
import { Alert } from "@/components/ui/alert";
import { ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pozivnice" };

export default async function Page() {
  // Prva linija svake strane pod `/admin` (pravilo 13). Layout se ne računa.
  await requireAdminPage();

  // Dva nezavisna izvora; pad jednog ne sakriva drugi (oba vraćaju `greska`).
  const [pristupne, clerk] = await Promise.all([citajPristupne(), citajClerkPozivnice()]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Pozivnice"
        opis="Pristupna pozivnica je kod koji daje komp ili prvi mesec gratis — link šalješ ručno. Ispod nje je ulazak u nalog kroz Clerk. Sve radnje stoje u reviziji; lozinka ne stoji nigde."
      />

      <section aria-labelledby="pristupne" className="mb-12">
        <h2 id="pristupne" className="mb-4 text-lg font-semibold tracking-tight">
          Pristupne pozivnice
        </h2>
        {pristupne.greska && (
          <Alert variant="warning" className="mb-5">
            {pristupne.greska}
          </Alert>
        )}
        <PristupnePozivnice redovi={pristupne.redovi} />
      </section>

      <section aria-labelledby="clerk" className="border-t border-border pt-10">
        <h2 id="clerk" className="mb-4 text-lg font-semibold tracking-tight">
          Clerk pozivnice
        </h2>
        {clerk.greska && (
          <Alert variant="warning" className="mb-5">
            {clerk.greska}
          </Alert>
        )}
        <Pozivnice redovi={clerk.redovi} />
      </section>
    </div>
  );
}
