"use client";

// Okvir admin konzole: bočna traka, gornja traka, sadržaj.
//
// Isti dizajn sistem kao aplikacija, ista tipografija, isti tokeni. Jedina
// vizuelna razlika je `ADMIN` bedž uz logo (F12 odluka 9) — poseban „admin skin"
// je posao bez ijedne koristi, a nesigurnost oko toga gde se čovek nalazi rešava
// jedan bedž.
//
// Traka je uža nego u aplikaciji i ne skuplja se: konzola ima četiri ekrana, a
// ne deset, pa dugme za skupljanje ne bi imalo šta da dobije. Nema ni kartice
// kredita — to je korisnikov podatak, ne moj.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/cn";
import { ADMIN_NAVIGACIJA, adminNaslov, jeAktivna, type AdminStavka } from "@/lib/admin-navigacija";
import { PrekidacTemeDugme } from "./prekidac-teme";
import { Znak } from "./znak";

export function AdminOkvir({ children }: { children: React.ReactNode }) {
  const putanja = usePathname();

  return (
    <>
      {/* ── bočna traka ──────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-bg-subtle/85 backdrop-blur-xl lg:flex">
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5 rounded-lg">
            <Znak />
            <span className="text-[15px] font-semibold tracking-[-0.03em] text-fg">sajtoskop</span>
          </Link>
          {/* §7.4: bedž na akcentnoj podlozi, tekst kroz `--accent-ink`. Jedini
              element koji konzolu razlikuje od aplikacije. */}
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-accent-ink">
            ADMIN
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {ADMIN_NAVIGACIJA.map((s) => (
            <AdminLink key={s.href} stavka={s} putanja={putanja} />
          ))}
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <Link
            href="/pretraga"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <ArrowLeft className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            Nazad u aplikaciju
          </Link>
        </div>
      </aside>

      {/* ── sadržaj ──────────────────────────────────────────── */}
      <div className="flex min-h-screen flex-col lg:pl-60">
        <header className="staklo sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border px-4 sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">
              {adminNaslov(putanja)}
            </p>
          </div>

          {/* Na telefonu bočne trake nema — konzola se vodi za računarom. Da bi
              se između dva ekrana ipak moglo preći, navigacija se tu prelije u
              gornju traku. */}
          <nav className="flex items-center gap-1 lg:hidden">
            {ADMIN_NAVIGACIJA.map((s) => {
              const aktivan = jeAktivna(s, putanja);
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={aktivan ? "page" : undefined}
                  aria-label={s.label}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                    aktivan
                      ? "bg-accent-wash text-accent-text"
                      : "text-fg-muted hover:bg-bg-hover hover:text-fg",
                  )}
                >
                  <s.Ikona className="h-[18px] w-[18px]" strokeWidth={2} />
                </Link>
              );
            })}
          </nav>

          <PrekidacTemeDugme />

          <div className="ml-1 flex items-center">
            <UserButton />
          </div>
        </header>

        <main className="flex-1 pb-16">{children}</main>
      </div>
    </>
  );
}

function AdminLink({ stavka, putanja }: { stavka: AdminStavka; putanja: string }) {
  const aktivan = jeAktivna(stavka, putanja);
  const { Ikona } = stavka;

  return (
    <Link
      href={stavka.href}
      aria-current={aktivan ? "page" : undefined}
      title={stavka.opis}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
        aktivan ? "bg-accent-wash text-accent-text" : "text-fg-muted hover:bg-bg-hover hover:text-fg",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity",
          aktivan ? "opacity-100" : "opacity-0",
        )}
      />
      <Ikona
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          aktivan ? "text-accent-text" : "text-fg-muted group-hover:text-fg",
        )}
        strokeWidth={2}
      />
      <span className="truncate">{stavka.label}</span>
    </Link>
  );
}
