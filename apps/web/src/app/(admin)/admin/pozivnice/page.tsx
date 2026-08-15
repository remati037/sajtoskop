// apps/web/src/app/(admin)/admin/pozivnice/page.tsx
// Ulazak u betu (F12 §3.3).
//
// Spisak pozivnica se čita ovde, na serveru, direktno iz Clerka — bez `GET`
// rute pod `/api/admin` (isti razlog kao za listu korisnika, v. „S3 — šta se
// razišlo", tačka 3). Sve što menja stanje ide kroz `POST`/`DELETE`
// `/api/admin/pozivnice` i ostavlja red u reviziji.

import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin";
import { citajPozivnice } from "@/lib/admin-pozivnice";
import { Pozivnice } from "@/components/admin-pozivnice";
import { Alert } from "@/components/ui/alert";
import { ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pozivnice" };

export default async function Page() {
  // Prva linija svake strane pod `/admin` (pravilo 13). Layout se ne računa.
  await requireAdminPage();

  const lista = await citajPozivnice();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Pozivnice"
        opis="Dva puta unutra: pozivnica na mejl, ili nalog otvoren odmah sa generisanom lozinkom. Obe radnje stoje u reviziji; lozinka ne stoji nigde."
      />

      {lista.greska && (
        <Alert variant="warning" className="mb-5">
          {lista.greska}
        </Alert>
      )}

      <Pozivnice redovi={lista.redovi} />
    </div>
  );
}
