// apps/web/src/app/(admin)/admin/revizija/page.tsx
// Dnevnik admin radnji (F12 §3.5).
//
// Ovo je moja jedina odbrana ako se ikad zapitam „ko je ovom čoveku dao 200
// kredita". Zato se čita doslovno: red iz `admin_audit` kakav jeste, sa akterom,
// ciljem, vremenom i `payload`-om — bez ijednog ulepšavanja.
//
// U ovoj isporuci tabela je gotovo prazna, i to je uredno stanje: jedina radnja
// koja u nju danas piše je `admin_adjust_credits`, a nju poziva tek F12.2. Ekran
// postoji ranije zato što dnevnik koji se napravi posle prve radnje nije dnevnik.

import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requireAdminPage } from "@/lib/admin";
import { citajRadnje, citajReviziju } from "@/lib/admin-korisnici";
import { formatDatum } from "@/lib/ui-tekst";
import { Paginacija, PoljePretrage, TrakaFiltera } from "@/components/admin-filteri";
import { Badge } from "@/components/ui/badge";
import { PraznoStanje, ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Revizija" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Prva linija svake strane pod `/admin` (pravilo 13). Layout se ne računa.
  await requireAdminPage();

  const sp = await searchParams;
  const tekst = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

  const radnje = await citajRadnje();

  // Radnja iz adrese mora da postoji u dnevniku. Nepoznata vrednost pada na
  // „sve" — filter po nečemu čega nema bi bio trajno prazan ekran bez objašnjenja.
  const trazenaRadnja = tekst(sp.action);
  const action = radnje.includes(trazenaRadnja) ? trazenaRadnja : "";

  const lista = await citajReviziju({
    action,
    korisnik: tekst(sp.korisnik).slice(0, 120),
    strana: Math.max(1, Number.parseInt(tekst(sp.strana), 10) || 1),
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Revizija"
        opis="Svaka admin radnja, i kad je uspela i kad je pala. Red se upisuje u istoj transakciji sa samom radnjom."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PoljePretrage
          naziv="Filter po korisniku"
          kljuc="korisnik"
          placeholder="Clerk ID korisnika…"
        />
        {radnje.length > 0 && (
          <TrakaFiltera
            kljuc="action"
            podrazumevano=""
            opcije={[
              { vrednost: "", label: "Sve radnje" },
              ...radnje.map((r) => ({ vrednost: r, label: r })),
            ]}
          />
        )}
      </div>

      {lista.redovi.length === 0 ? (
        <PraznoStanje
          ikona={<ScrollText />}
          naslov="Dnevnik je prazan."
          opis="Prvi red se pojavljuje čim se izvrši prva radnja koja menja tuđi nalog — dodela kredita, promena plana ili uloge, blokada, brisanje."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
            <div className="scroll-x">
              <table className="w-full min-w-[52rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-subtle/70 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                    <th className="py-2.5 pl-4 font-medium">Kad</th>
                    <th className="py-2.5 font-medium">Radnja</th>
                    <th className="py-2.5 font-medium">Akter</th>
                    <th className="py-2.5 font-medium">Nad kim</th>
                    <th className="py-2.5 pr-4 font-medium">Šta</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.redovi.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/70 align-top transition-colors last:border-0 hover:bg-bg-subtle/60"
                    >
                      <td className="py-2.5 pl-4 text-[12.5px] text-fg-muted">
                        {formatDatum(r.created_at)}
                        <span className="block num text-[11px] text-fg-faint">
                          {new Date(r.created_at).toLocaleTimeString("sr-Latn-RS", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="num text-[12.5px] text-fg">{r.action}</span>
                          {!r.ok && <Badge variant="danger" size="sm">PALO</Badge>}
                        </span>
                        {r.error && (
                          <span className="mt-0.5 block max-w-[16rem] truncate text-[11px] text-danger">
                            {r.error}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {/* Akter je `null` kad je njegov nalog obrisan — red
                            ostaje, jer je to tačno onaj slučaj zbog kog dnevnik
                            i postoji (v. migraciju 0012). */}
                        <span className="block max-w-[11rem] truncate num text-[11.5px] text-fg-muted">
                          {r.actor_id ?? "obrisan nalog"}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {r.target_user ? (
                          <Link
                            href={`/admin/korisnici/${encodeURIComponent(r.target_user)}`}
                            className="block max-w-[11rem] truncate num text-[11.5px] text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                          >
                            {r.target_user}
                          </Link>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        {/* `payload` nikad ne sadrži lozinku, token ni ključ
                            (pravilo 14) — zato sme ovako, doslovno. */}
                        <span className="block max-w-[20rem] truncate num text-[11.5px] text-fg-muted">
                          {Object.keys(r.payload).length > 0 ? JSON.stringify(r.payload) : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Paginacija
            strana={lista.strana}
            strana_max={lista.strana_max}
            ukupno={lista.ukupno}
            imenica="radnji"
          />
        </>
      )}
    </div>
  );
}
