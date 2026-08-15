// apps/web/src/app/(admin)/admin/dnevnik/page.tsx
// Beta dnevnik u konzoli (F11.4 §6.5) — CRUD nad stavkama.
//
// Ekran postoji TEK SADA, zajedno sa stavkom u meniju (`admin-navigacija.ts`):
// stavka u meniju koja vodi na 404 je gora od stavke koje nema. Do ove
// isporuke spisak u „poveži sa stavkom" (`/admin/utisci`) je mogao da bude
// prazan i ekran je to govorio naglas (v. `admin-utisci-schema.ts`).

import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin";
import { citajSveStavke } from "@/lib/dnevnik";
import { AdminDnevnik } from "@/components/admin-dnevnik";
import { ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dnevnik" };

export default async function Page() {
  // Prva linija svake strane pod `/admin` (pravilo 13). Layout se ne računa.
  await requireAdminPage();

  const stavke = await citajSveStavke();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Beta dnevnik"
        opis='Stavke koje korisnik vidi na kontrolnoj tabli. Oznaka „iz tvog utiska" se pojavljuje sama — kad je stavka vezana za korisnikovu prijavu kroz „poveži sa stavkom" u utiscima.'
      />

      <div className="mt-6">
        <AdminDnevnik stavke={stavke} />
      </div>
    </div>
  );
}
