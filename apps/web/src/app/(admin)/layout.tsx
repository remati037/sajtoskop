// apps/web/src/app/(admin)/layout.tsx
// Okvir admin konzole. Grupa `(admin)` ne menja nijedan URL — `/admin/korisnici`
// je i dalje `/admin/korisnici`.
//
// ── ovaj layout NIJE zaštita ─────────────────────────────────
// Pravilo 13 i F12 odluka 4: provera je na svakoj strani, jer se layout ne
// izvršava ponovo pri klijentskoj navigaciji između sestrinskih ruta. Svaka
// strana ispod zove `requireAdminPage()` kao prvu liniju i to je jedina stvar
// koja je stvarno drži zatvorenom.
//
// ── zašto onda provera stoji i ovde ──────────────────────────
// Zbog onoga što se vidi, ne zbog onoga što se sme. Kad `notFound()` pozove
// STRANA, Next crta `not-found` unutar najbližeg layout-a — dakle unutar ove
// bočne trake, sa `ADMIN` bedžom. Čovek koji tu nema šta da traži bi tako dobio
// 404 uokviren konzolom, i time saznao tačno ono što `404` umesto `403` krije
// (odluka 3). Kad `notFound()` pozove LAYOUT, granica je iznad njega i okvira
// nema.
//
// Cena je jedno čitanje uloge po punom učitavanju. Klijentska navigacija ga ne
// ponavlja — što je i razlog zbog kog ovo samo po sebi ne bi bilo dovoljno.

import { requireAdminPage } from "@/lib/admin";
import { AdminOkvir } from "@/components/admin-okvir";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();

  return <AdminOkvir>{children}</AdminOkvir>;
}
