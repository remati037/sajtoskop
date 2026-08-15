// apps/web/src/app/(admin)/admin/utisci/[id]/page.tsx
// Stalna adresa jedne prijave (F11 §4: „mejl nosi link na `/admin/utisci/<id>`").
//
// Ovo NIJE drugi ekran nego druga vrata u isti: detalj živi u panelu na
// `/admin/utisci`, a ova strana samo prevodi adresu iz mejla u `?utisak=<id>`.
// Dve implementacije istog panela bile bi dve koje se raziđu — a mejl mora da
// vodi tačno tamo gde se prijava i obrađuje, sa listom i filterima pri ruci.
//
// Zašto uopšte postoji zasebna adresa: link u pošti mora da preživi promenu
// oblika query stringa. `/admin/utisci/143` je adresa koja se ne menja; ono iza
// znaka pitanja se menja svaki put kad se doda filter.

import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  // Prva linija svake strane pod `/admin` (pravilo 13), i pre redirekcije:
  // preusmerenje koje se desi pre provere prava je potvrda da ekran postoji.
  await requireAdminPage();

  const id = Number((await params).id);

  // Neispravan ID vodi na golu listu, ne na `404`. Prijava koje nema je stanje
  // koje sama lista objašnjava jednom rečenicom — a `404` bi ovde značio „ovaj
  // ekran ne postoji", što nije istina.
  if (!Number.isInteger(id) || id <= 0) redirect("/admin/utisci");

  redirect(`/admin/utisci?utisak=${id}`);
}
