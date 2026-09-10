"use client";

// apps/web/src/components/admin-pozivnice-pristup.tsx
// Pristupne pozivnice u konzoli (S27, naplata-stripe.md §9.3): obrazac levo,
// tabela desno — isti raspored kao Clerk pozivnice ispod, da strana čita kao
// jedna celina.
//
// Link se ne šalje odavde (mejl sa pozivnicom je K6): admin ga kopira i šalje
// ručno. Zato dugme „Kopiraj link" stoji i u odgovoru na pravljenje i u
// svakom redu tabele.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Gift, Loader2, Sparkles, Ticket, X } from "lucide-react";
import { KOMP_DEFAULT_DAYS, PLANS, type AccessInviteKind } from "@sajtoskop/shared";
import type { RadnjaOdgovor } from "@/lib/admin-radnje-schema";
import {
  linkPozivnice,
  stanjePozivnice,
  type PozivnicaPristupRed,
  type StanjePozivnice,
} from "@/lib/pozivnice-schema";
import { formatDatum, formatDatumKratko, plural } from "@/lib/ui-tekst";
import { cn } from "@/lib/cn";
import { IzborNacina } from "./admin-pozivnice";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/input";
import { NaslovSekcije } from "./ui/stranica";

type Filter = "sve" | AccessInviteKind;

const FILTERI: { vrednost: Filter; naziv: string }[] = [
  { vrednost: "sve", naziv: "Sve" },
  { vrednost: "komp", naziv: "Komp" },
  { vrednost: "prvi_mesec", naziv: "Prvi mesec" },
];

const TIP: Record<AccessInviteKind, { label: string; variant: "primary" | "info" }> = {
  komp: { label: "Komp", variant: "primary" },
  prvi_mesec: { label: "Prvi mesec", variant: "info" },
};

const STANJE: Record<StanjePozivnice, { label: string; variant: "success" | "neutral" | "outline" }> = {
  aktivna: { label: "Aktivna", variant: "success" },
  iskoriscena: { label: "Iskorišćena", variant: "neutral" },
  istekla: { label: "Istekla", variant: "neutral" },
  opozvana: { label: "Opozvana", variant: "outline" },
};

export function PristupnePozivnice({ redovi }: { redovi: PozivnicaPristupRed[] }) {
  const router = useRouter();
  const [ceka, prenesi] = useTransition();

  const [tip, setTip] = useState<AccessInviteKind>("komp");
  const [kod, setKod] = useState("");
  const [email, setEmail] = useState("");
  const [dana, setDana] = useState(String(KOMP_DEFAULT_DAYS));
  const [bezRoka, setBezRoka] = useState(false);
  const [krediti, setKrediti] = useState(String(PLANS.komp.monthlyCredits));
  const [upotreba, setUpotreba] = useState("1");
  const [napomena, setNapomena] = useState("");

  const [radi, setRadi] = useState<string | null>(null);
  const [odgovor, setOdgovor] = useState<{ ok: boolean; tekst: string } | null>(null);
  const [noviLink, setNoviLink] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("sve");

  const zauzeto = radi !== null || ceka;

  const vidljivi = useMemo(
    () => (filter === "sve" ? redovi : redovi.filter((r) => r.kind === filter)),
    [redovi, filter],
  );

  const broj = (f: Filter) => (f === "sve" ? redovi.length : redovi.filter((r) => r.kind === f).length);

  async function posalji(kljuc: string, url: string, init: RequestInit): Promise<RadnjaOdgovor | null> {
    setRadi(kljuc);
    setOdgovor(null);

    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });

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
      console.error("[admin-pozivnice-pristup]", err);
      setOdgovor({ ok: false, tekst: "Veza sa serverom nije uspela. Pokušaj ponovo." });
      return null;
    } finally {
      setRadi(null);
    }
  }

  async function napravi() {
    setNoviLink(null);

    // Prazna polja idu kao `undefined` — `JSON.stringify` ih izostavlja, a šema
    // ih čita kao „nije uneto". `komp_days: null` je izričito „bez roka".
    const zajednicko = {
      code: kod.trim() || undefined,
      email: email.trim() || undefined,
      max_uses: Number(upotreba),
      note: napomena.trim() || undefined,
    };
    const telo =
      tip === "komp"
        ? {
            kind: "komp",
            ...zajednicko,
            komp_days: bezRoka ? null : Number(dana),
            komp_credits: Number(krediti),
          }
        : { kind: "prvi_mesec", ...zajednicko };

    const uspeh = await posalji("napravi", "/api/admin/pozivnice/pristup", {
      method: "POST",
      body: JSON.stringify(telo),
    });
    if (!uspeh) return;

    setKod("");
    setEmail("");
    setNapomena("");
    setNoviLink(uspeh.podaci?.link ?? null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
      {/* ── OBRAZAC ──────────────────────────────────────────── */}
      <section className="lg:sticky lg:top-8 lg:self-start">
        <div className="rounded-xl border border-border bg-bg-elev p-5 shadow-sm">
          <h3 className="mb-1 text-[15px] font-semibold tracking-tight">Nova pozivnica</h3>
          <p className="mb-5 text-[11px] text-fg-faint">
            Jedan nalog sme da iskoristi jednu pozivnicu, bilo kog tipa. Ko već ima pretplatu, ne
            može da je iskoristi.
          </p>

          <div className="space-y-2.5">
            <fieldset className="space-y-2">
              <legend className="sr-only">Tip</legend>
              <IzborNacina
                izabran={tip === "komp"}
                onClick={() => setTip("komp")}
                disabled={zauzeto}
                Ikona={Sparkles}
                naslov="Komp"
                opis="Pun pristup bez Stripe-a, sa rokom i kreditima. Za partnere i prijatelje."
              />
              <IzborNacina
                izabran={tip === "prvi_mesec"}
                onClick={() => setTip("prvi_mesec")}
                disabled={zauzeto}
                Ikona={Gift}
                naslov="Prvi mesec gratis"
                opis="Normalan checkout sa 100% kuponom na prvi period, bez probe. Kartica je obavezna."
              />
            </fieldset>

            {tip === "komp" && (
              <>
                <div className="flex gap-2">
                  <label className="min-w-0 flex-1">
                    <Label>Dana</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={365}
                      value={bezRoka ? "" : dana}
                      onChange={(e) => setDana(e.target.value)}
                      placeholder="bez roka"
                      className="num"
                      disabled={zauzeto || bezRoka}
                    />
                  </label>
                  <label className="min-w-0 flex-1">
                    <Label>Kredita</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={2000}
                      value={krediti}
                      onChange={(e) => setKrediti(e.target.value)}
                      className="num"
                      disabled={zauzeto}
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[13px] text-fg-muted">
                  <input
                    type="checkbox"
                    checked={bezRoka}
                    onChange={(e) => setBezRoka(e.target.checked)}
                    disabled={zauzeto}
                    className="h-4 w-4 accent-accent"
                  />
                  Bez roka (neograničen komp)
                </label>
                <p className="text-[11px] text-fg-faint">
                  Rok teče od prihvatanja, ne od danas. Posle prvog paketa komp dobija{" "}
                  <span className="num">{PLANS.komp.monthlyCredits}</span> kredita mesečno dok traje.
                </p>
              </>
            )}

            <div className="flex gap-2">
              <label className="min-w-0 flex-1">
                <Label>Kod (opciono)</Label>
                <Input
                  value={kod}
                  onChange={(e) => setKod(e.target.value.toUpperCase())}
                  placeholder="SAJT-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                  className="num"
                  disabled={zauzeto}
                />
              </label>
              <label className="w-24 shrink-0">
                <Label>Upotreba</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={upotreba}
                  onChange={(e) => setUpotreba(e.target.value)}
                  className="num"
                  disabled={zauzeto}
                />
              </label>
            </div>
            {kod.trim() && !email.trim() && (
              <p className="rounded-lg bg-warn-wash px-3 py-2 text-[12px] text-warn-text">
                Ručni kod se da pogoditi. Veži ga za mejl, ili ostavi polje prazno za generisan.
              </p>
            )}

            <label className="block">
              <Label>Samo za mejl (opciono)</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vlada@studio.rs"
                autoComplete="off"
                spellCheck={false}
                className="num"
                disabled={zauzeto}
              />
            </label>

            <label className="block">
              <Label>Napomena (opciono, vidiš je samo ti)</Label>
              <Input
                value={napomena}
                onChange={(e) => setNapomena(e.target.value)}
                placeholder="Vlada — partner, dogovoreno na sastanku"
                maxLength={200}
                disabled={zauzeto}
              />
            </label>

            <Button
              variant="primary"
              className="w-full"
              disabled={zauzeto}
              onClick={() => void napravi()}
            >
              {radi === "napravi" ? <Loader2 className="animate-spin" /> : <Ticket />}
              Napravi pozivnicu
            </Button>

            {odgovor && (
              <Alert variant={odgovor.ok ? "success" : "danger"} bezIkonice className="px-3 py-2 text-[13px]">
                {odgovor.tekst}
              </Alert>
            )}

            {noviLink && (
              <div className="rounded-lg border border-accent/30 bg-accent-wash p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-accent-text">
                  Link za slanje
                </p>
                <div className="mt-1.5 flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all num text-[13px] text-fg">{noviLink}</code>
                  <KopirajDugme vrednost={noviLink} variant="outline" />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── SPISAK ───────────────────────────────────────────── */}
      <section className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <NaslovSekcije>Napravljene pozivnice</NaslovSekcije>
          <div
            role="group"
            aria-label="Filter po tipu"
            className="flex gap-0.5 rounded-lg border border-border-strong bg-bg-subtle p-0.5"
          >
            {FILTERI.map((f) => {
              const aktivan = f.vrednost === filter;
              return (
                <button
                  key={f.vrednost}
                  type="button"
                  aria-pressed={aktivan}
                  onClick={() => setFilter(f.vrednost)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                    aktivan ? "bg-bg-elev text-fg shadow-sm ring-1 ring-border-strong" : "text-fg-muted hover:text-fg",
                  )}
                >
                  {f.naziv}
                  <span className="num text-[11px] text-fg-faint">{broj(f.vrednost)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {vidljivi.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-bg-elev/60 px-4 py-8 text-center text-sm text-fg-muted">
            {redovi.length === 0 ? "Nijedna pristupna pozivnica još nije napravljena." : "Nijedna pozivnica tog tipa."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
            <div className="scroll-x">
              <table className="w-full min-w-[50rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-subtle/70 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                    <th className="py-2.5 pl-4 font-medium">Kod</th>
                    <th className="py-2.5 font-medium">Tip</th>
                    <th className="py-2.5 font-medium">Rok / krediti</th>
                    <th className="py-2.5 font-medium">Iskorišćeno</th>
                    <th className="py-2.5 font-medium">Ko</th>
                    <th className="py-2.5 font-medium">Kad</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Radnja</th>
                  </tr>
                </thead>
                <tbody>
                  {vidljivi.map((r) => {
                    const stanje = stanjePozivnice(r);
                    const poslednje = r.iskoristili[r.iskoristili.length - 1];
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-border/70 align-top transition-colors last:border-0 hover:bg-bg-subtle/60"
                      >
                        <td className="max-w-[15rem] py-2.5 pl-4">
                          <span className="block num text-[13px] font-medium text-fg">{r.code}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant={STANJE[stanje].variant} size="sm">
                              {STANJE[stanje].label}
                            </Badge>
                            {r.email && (
                              <span className="truncate num text-[11px] text-fg-muted" title="Samo za ovu adresu">
                                za {r.email}
                              </span>
                            )}
                          </span>
                          {r.note && (
                            <span className="mt-1 block truncate text-[11px] text-fg-faint" title={r.note}>
                              {r.note}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <Badge variant={TIP[r.kind].variant} size="sm">
                            {TIP[r.kind].label}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-[12.5px] text-fg-muted">
                          {r.kind === "komp" ? (
                            <span className="num">
                              {r.kompDays
                                ? `${r.kompDays} ${plural(r.kompDays, "dan", "dana", "dana")}`
                                : "bez roka"}
                              {" · "}
                              {r.kompCredits ?? 0} kr.
                            </span>
                          ) : (
                            "kupon na prvi period"
                          )}
                        </td>
                        <td className="py-2.5 num text-[13px] text-fg">
                          {r.usedCount}/{r.maxUses}
                        </td>
                        <td className="max-w-[13rem] py-2.5 text-[12.5px]">
                          {r.iskoristili.length === 0 ? (
                            <span className="text-fg-faint">—</span>
                          ) : (
                            <span className="flex flex-col gap-0.5">
                              {r.iskoristili.slice(0, 2).map((k) => (
                                <Link
                                  key={k.userId}
                                  href={`/admin/korisnici/${encodeURIComponent(k.userId)}`}
                                  className="truncate num text-fg underline-offset-4 hover:underline"
                                >
                                  {k.email ?? k.userId}
                                </Link>
                              ))}
                              {r.iskoristili.length > 2 && (
                                <span className="num text-[11px] text-fg-faint">
                                  +{r.iskoristili.length - 2}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-[12.5px] text-fg-muted">
                          {poslednje ? (
                            <span className="num" title={formatDatum(poslednje.kad)}>
                              {formatDatumKratko(poslednje.kad)}
                            </span>
                          ) : (
                            <span className="num text-fg-faint" title="Napravljena">
                              {formatDatumKratko(r.createdAt)}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="flex items-center justify-end gap-1">
                            <KopirajDugme vrednost={linkPozivnice(r.code)} variant="ghost" />
                            {stanje === "aktivna" || stanje === "iskoriscena" ? (
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={zauzeto}
                                onClick={() =>
                                  void posalji(
                                    `opoziv-${r.id}`,
                                    `/api/admin/pozivnice/pristup/${encodeURIComponent(r.id)}`,
                                    { method: "DELETE" },
                                  )
                                }
                              >
                                {radi === `opoziv-${r.id}` ? <Loader2 className="animate-spin" /> : <X />}
                                Opozovi
                              </Button>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] text-fg-faint">
          Opoziv zatvara buduće upotrebe. Ko je komp već dobio, zadržava ga; nepotrošen „prvi
          mesec" se opozivom gubi. Kolona „Kad" je poslednje iskorišćenje, a sivo je datum
          pravljenja. Mejl sa pozivnicom još ne postoji — link šalješ ručno.
        </p>
      </section>
    </div>
  );
}

// ── sitni delovi ─────────────────────────────────────────────

function KopirajDugme({ vrednost, variant }: { vrednost: string; variant: "outline" | "ghost" }) {
  const [kopirano, setKopirano] = useState(false);

  return (
    <Button
      size="icon-sm"
      variant={variant}
      aria-label="Kopiraj link"
      title="Kopiraj link"
      onClick={() => {
        void navigator.clipboard.writeText(vrednost).then(() => {
          setKopirano(true);
          setTimeout(() => setKopirano(false), 2000);
        });
      }}
    >
      {kopirano ? <Check /> : <Copy />}
    </Button>
  );
}
