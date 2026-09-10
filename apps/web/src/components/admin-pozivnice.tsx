"use client";

// apps/web/src/components/admin-pozivnice.tsx
// Obrazac za ulazak u betu i spisak poslatog (F12 §3.3).
//
// [ODSTUPANJE od F12 §3.3, namerno] PRD ovo crta kao modal iznad liste
// korisnika. Ovde je ekran, iz dva razloga:
//   1. Uz obrazac ide i SPISAK poslatih pozivnica sa opozivom. Lista unutar
//      modala bi tražila svoje učitavanje, dakle i `GET` rutu pod `/api/admin`
//      koje inače nema (v. „S3 — šta se razišlo", tačka 3).
//   2. Lozinka i link se prikazuju TAČNO JEDNOM. Modal koji se zatvori klikom
//      pored je najgore moguće mesto za podatak koji se više ne može dobiti.
//
// Dugme „Pozovi" na `/admin/korisnici` vodi ovamo, pa je put isti kao u PRD-u —
// menja se samo gde se otvara.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, MailPlus, Send, UserPlus, X } from "lucide-react";
import type { PozivnicaRed, StatusPozivnice } from "@/lib/admin-pozivnice";
import type { RadnjaOdgovor } from "@/lib/admin-radnje-schema";
import { formatDatum } from "@/lib/ui-tekst";
import { cn } from "@/lib/cn";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Label, Textarea } from "./ui/input";
import { NaslovSekcije } from "./ui/stranica";

type Nacin = "pozivnica" | "nalog";

type Tajna = { naslov: string; vrednost: string; opis: string };

const STATUS: Record<StatusPozivnice, { label: string; variant: "neutral" | "success" | "warning" | "outline" }> = {
  pending: { label: "Čeka", variant: "warning" },
  accepted: { label: "Prihvaćena", variant: "success" },
  revoked: { label: "Opozvana", variant: "outline" },
  expired: { label: "Istekla", variant: "neutral" },
};

export function Pozivnice({ redovi }: { redovi: PozivnicaRed[] }) {
  const router = useRouter();
  const [ceka, prenesi] = useTransition();

  const [email, setEmail] = useState("");
  const [poruka, setPoruka] = useState("");
  const [nacin, setNacin] = useState<Nacin>("pozivnica");

  const [radi, setRadi] = useState<string | null>(null);
  const [odgovor, setOdgovor] = useState<{ ok: boolean; tekst: string } | null>(null);
  // Ono što se vidi jednom: lozinka otvorenog naloga i link iz pozivnice.
  const [tajne, setTajne] = useState<Tajna[]>([]);

  const zauzeto = radi !== null || ceka;

  async function posalji(kljuc: string, init: RequestInit): Promise<RadnjaOdgovor | null> {
    setRadi(kljuc);
    setOdgovor(null);

    try {
      const res = await fetch("/api/admin/pozivnice", {
        headers: { "Content-Type": "application/json" },
        ...init,
      });

      let telo: RadnjaOdgovor | { greska?: string } | null = null;
      try {
        telo = (await res.json()) as RadnjaOdgovor | { greska?: string };
      } catch {
        telo = null;
      }

      if (!res.ok) {
        setOdgovor({
          ok: false,
          tekst:
            (telo && "greska" in telo && telo.greska) ||
            (res.status === 404
              ? "Sesija je istekla ili nemaš prava. Osveži stranu i prijavi se ponovo."
              : "Nije prošlo."),
        });
        return null;
      }

      const uspeh = telo as RadnjaOdgovor;
      setOdgovor({ ok: true, tekst: uspeh.poruka });
      prenesi(() => router.refresh());
      return uspeh;
    } catch (err) {
      console.error("[admin-pozivnice]", err);
      setOdgovor({ ok: false, tekst: "Veza sa serverom nije uspela. Pokušaj ponovo." });
      return null;
    } finally {
      setRadi(null);
    }
  }

  async function pozovi() {
    const adresa = email.trim();
    if (!adresa.includes("@")) {
      setOdgovor({ ok: false, tekst: "Upiši mejl adresu." });
      return;
    }

    const uspeh = await posalji("pozovi", {
      method: "POST",
      body: JSON.stringify({
        email: adresa,
        poruka: poruka.trim() || undefined,
        nacin,
      }),
    });

    if (!uspeh) return;

    setEmail("");
    setPoruka("");

    const nove: Tajna[] = [];
    if (uspeh.podaci?.lozinka) {
      nove.push({
        naslov: `Lozinka za ${uspeh.podaci.email ?? adresa}`,
        vrednost: uspeh.podaci.lozinka,
        opis: "Vidi se samo sada. Nije upisana ni u bazu, ni u dnevnik, ni u log.",
      });
    }
    if (uspeh.podaci?.link) {
      nove.push({
        naslov: "Link iz pozivnice",
        vrednost: uspeh.podaci.link,
        opis: "Isti link je otišao mejlom. Ovde je za slučaj da treba ručno, Viberom.",
      });
    }
    setTajne(nove);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
      {/* ── OBRAZAC ──────────────────────────────────────────── */}
      <section className="lg:sticky lg:top-8 lg:self-start">
        <div className="rounded-xl border border-border bg-bg-elev p-5 shadow-sm">
          <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Otvori ulaz u nalog</h2>
          <p className="mb-5 text-[11px] text-fg-faint">
            Profil nastaje kad se nalog napravi, kroz isti webhook kao i za svakog ko se prijavi
            sam — bez plana i bez kredita. Pristup daje pristupna pozivnica iznad.
          </p>

          <div className="space-y-2.5">
            <label className="block">
              <Label>Mejl</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ana@studio.rs"
                autoComplete="off"
                spellCheck={false}
                className="num"
                disabled={zauzeto}
              />
            </label>

            <label className="block">
              <Label>Poruka (opciono, ide u mejl)</Label>
              <Textarea
                rows={3}
                maxLength={1000}
                value={poruka}
                onChange={(e) => setPoruka(e.target.value)}
                placeholder="Zdravo Ana, pričali smo o ovome u utorak…"
                disabled={zauzeto}
              />
            </label>

            <fieldset className="space-y-2 pt-1">
              <legend className="sr-only">Način</legend>
              <IzborNacina
                izabran={nacin === "pozivnica"}
                onClick={() => setNacin("pozivnica")}
                disabled={zauzeto}
                Ikona={MailPlus}
                naslov="Pošalji pozivnicu"
                opis="Lozinku bira sam, kroz link koji važi 30 dana."
              />
              <IzborNacina
                izabran={nacin === "nalog"}
                onClick={() => setNacin("nalog")}
                disabled={zauzeto}
                Ikona={UserPlus}
                naslov="Otvori nalog odmah"
                opis="Server generiše lozinku i prikazuje je jednom. Za uvođenje uživo."
              />
            </fieldset>

            {/* Sekundarno od S27: primarno dugme strane je „Napravi pozivnicu"
                u sekciji iznad (jedno primarno po ekranu, dizajn sistem §7.1). */}
            <Button
              variant="secondary"
              className="w-full"
              disabled={zauzeto || !email.trim()}
              onClick={() => void pozovi()}
            >
              {radi === "pozovi" ? <Loader2 className="animate-spin" /> : <Send />}
              {nacin === "nalog" ? "Otvori nalog" : "Pošalji pozivnicu"}
            </Button>

            {odgovor && (
              <Alert
                variant={odgovor.ok ? "success" : "danger"}
                bezIkonice
                className="px-3 py-2 text-[13px]"
              >
                {odgovor.tekst}
              </Alert>
            )}

            {tajne.map((t) => (
              <Jednom key={t.naslov} tajna={t} />
            ))}
          </div>
        </div>
      </section>

      {/* ── SPISAK ───────────────────────────────────────────── */}
      <section className="min-w-0">
        <NaslovSekcije className="mb-2">Poslate pozivnice</NaslovSekcije>

        {redovi.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-bg-elev/60 px-4 py-8 text-center text-sm text-fg-muted">
            Nijedna pozivnica još nije poslata.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
            <div className="scroll-x">
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-subtle/70 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                    <th className="py-2.5 pl-4 font-medium">Mejl</th>
                    <th className="py-2.5 font-medium">Stanje</th>
                    <th className="py-2.5 font-medium">Poslata</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Radnja</th>
                  </tr>
                </thead>
                <tbody>
                  {redovi.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/70 transition-colors last:border-0 hover:bg-bg-subtle/60"
                    >
                      <td className="max-w-[16rem] truncate py-2.5 pl-4 num text-[13px]">
                        {r.email}
                      </td>
                      <td className="py-2.5">
                        <Badge variant={STATUS[r.status].variant} size="sm">
                          {STATUS[r.status].label}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-[12.5px] text-fg-muted">
                        {formatDatum(r.napravljena)}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {r.status === "pending" ? (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={zauzeto}
                            onClick={() =>
                              void posalji(`opoziv-${r.id}`, {
                                method: "DELETE",
                                body: JSON.stringify({ id: r.id }),
                              })
                            }
                          >
                            {radi === `opoziv-${r.id}` ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <X />
                            )}
                            Opozovi
                          </Button>
                        ) : (
                          <span className="text-[11px] text-fg-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] text-fg-faint">
          Spisak dolazi iz Clerka, ne iz baze — istek i prihvatanje vodi on. Opozvana pozivnica
          ostaje u Clerku, ali njen link više ne radi.
        </p>
      </section>
    </div>
  );
}

// ── sitni delovi ─────────────────────────────────────────────

/** Izbor jedne od dve opcije kao kartica sa ikonicom. Deli ga i obrazac pristupnih pozivnica. */
export function IzborNacina({
  izabran,
  onClick,
  disabled,
  Ikona,
  naslov,
  opis,
}: {
  izabran: boolean;
  onClick: () => void;
  disabled: boolean;
  Ikona: typeof MailPlus;
  naslov: string;
  opis: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={izabran}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:opacity-50",
        izabran
          ? "border-accent/40 bg-accent-wash"
          : "border-border-strong bg-bg-elev hover:bg-bg-subtle",
      )}
    >
      <Ikona
        className={cn("mt-0.5 h-4 w-4 shrink-0", izabran ? "text-accent-text" : "text-fg-muted")}
        strokeWidth={2}
      />
      <span className="min-w-0">
        <span className={cn("block text-[13px] font-medium", izabran ? "text-accent-text" : "text-fg")}>
          {naslov}
        </span>
        <span className="mt-0.5 block text-[11px] text-fg-muted">{opis}</span>
      </span>
    </button>
  );
}

/**
 * Podatak koji postoji samo dok se ova strana ne osveži.
 *
 * Zato ima dugme za kopiranje, a ne samo tekst: prekucavanje lozinke od 20
 * znakova je tačno mesto na kom se pravi greška koja se ne može ispraviti.
 */
function Jednom({ tajna }: { tajna: Tajna }) {
  const [kopirano, setKopirano] = useState(false);

  return (
    <div className="rounded-lg border border-accent/30 bg-accent-wash p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-accent-text">
        {tajna.naslov}
      </p>
      <div className="mt-1.5 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all num text-[13px] text-fg">{tajna.vrednost}</code>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Kopiraj"
          onClick={() => {
            void navigator.clipboard.writeText(tajna.vrednost).then(() => {
              setKopirano(true);
              setTimeout(() => setKopirano(false), 2000);
            });
          }}
        >
          {kopirano ? <Check /> : <Copy />}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-fg-muted">{tajna.opis}</p>
    </div>
  );
}
