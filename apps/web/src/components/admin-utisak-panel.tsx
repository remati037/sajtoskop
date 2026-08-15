"use client";

// apps/web/src/components/admin-utisak-panel.tsx
// Detalj prijave u panelu desno (F11 §6.6).
//
// Sve što se o jednoj prijavi zna, pa ispod toga četiri radnje: status, oznake,
// beleška, nagrada i veza sa Beta dnevnikom. Panel je jedina površina sa senkom
// na ovom ekranu — lista levo je tabela, a ne kartica.
//
// ── šta ovde NIJE zaštita ────────────────────────────────────
// Sve što je iza `disabled` je udobnost. Kapije za nagradu („mora da bude bug",
// „mora da bude priznat", „ne dvaput") žive u ruti i u `grant_feedback_credits`;
// ovaj fajl samo ne nudi ono što bi ionako bilo odbijeno, i objašnjava zašto.
//
// Slika stiže kao POTPISAN URL koji je server napravio pri renderu i koji ističe
// za 10 minuta (§4). Zato panel otvoren pola sata pokazuje istekao link — i to
// je tačno ono što treba, jer se osvežavanjem strane dobija nov.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookMarked,
  Coins,
  ExternalLink,
  ImageOff,
  Loader2,
  Save,
  X,
} from "lucide-react";
import {
  opisOdgovora,
  pitanjeZaKljuc,
  type ChangelogRow,
  type FeedbackRow,
} from "@sajtoskop/shared";
import {
  MAX_BELESKA,
  MAX_OZNAKA,
  NAGRADA_ZA_BUG,
  SLOJ_UTISKA,
  STATUS_UTISKA,
  STATUSI,
} from "@/lib/admin-utisci-schema";
import { formatDatum } from "@/lib/ui-tekst";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Label, Textarea } from "./ui/input";
import { NaslovSekcije } from "./ui/stranica";

type Poruka = { ok: boolean; tekst: string };

export type PanelProps = {
  red: FeedbackRow & { email: string | null };
  /** Potpisan URL sa rokom od 10 minuta, ili `null` (nema slike / Storage ćuti). */
  slikaUrl: string | null;
  dnevnik: Pick<ChangelogRow, "id" | "title" | "kind" | "shipped_at" | "from_feedback">[];
  ukupnoOdKorisnika: number;
  /** Oznake koje već postoje u tabeli — predlog, ne enum. */
  predlozi: string[];
  /** Adresa liste sa zadržanim filterima, za `✕`. */
  nazad: string;
};

export function PanelUtiska(props: PanelProps) {
  const { red, slikaUrl, dnevnik, ukupnoOdKorisnika, predlozi, nazad } = props;

  const router = useRouter();
  const [ceka, prenesi] = useTransition();
  const [radi, setRadi] = useState<string | null>(null);
  const [poruke, setPoruke] = useState<Record<string, Poruka>>({});

  const [status, setStatus] = useState(red.status);
  const [oznake, setOznake] = useState(red.tags.join(", "));
  const [beleska, setBeleska] = useState(red.admin_note ?? "");
  const [obrazlozenje, setObrazlozenje] = useState(red.user_note ?? "");

  const vezana = dnevnik.find((d) => d.from_feedback.includes(red.id));
  const [stavka, setStavka] = useState<string>(vezana ? String(vezana.id) : "");

  // Adresa je izvor istine: klik na drugu prijavu u listi menja `props`, pa
  // obrazac mora da ga prati. Bez ovoga bi u panelu ostala tuđa beleška.
  useEffect(() => {
    setStatus(red.status);
    setOznake(red.tags.join(", "));
    setBeleska(red.admin_note ?? "");
    setObrazlozenje(red.user_note ?? "");
    setPoruke({});
  }, [red.id, red.status, red.tags, red.admin_note, red.user_note]);

  const zauzeto = radi !== null || ceka;
  const pitanje = red.prompt_key ? pitanjeZaKljuc(red.prompt_key) : null;

  async function posalji(kljuc: string, putanja: string, init: RequestInit) {
    setRadi(kljuc);
    setPoruke((p) => {
      const kopija = { ...p };
      delete kopija[kljuc];
      return kopija;
    });

    try {
      const res = await fetch(`/api/admin/utisci/${red.id}${putanja}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });

      let telo: { poruka?: string; greska?: string } | null = null;
      try {
        telo = (await res.json()) as { poruka?: string; greska?: string };
      } catch {
        telo = null;
      }

      if (!res.ok) {
        // `404` sa praznim telom je odgovor za „nisi admin" (F12 odluka 3) — do
        // njega se dolazi samo ako je sesija istekla usred rada.
        setPoruke((p) => ({
          ...p,
          [kljuc]: {
            ok: false,
            tekst:
              telo?.greska ??
              (res.status === 404
                ? "Sesija je istekla ili nemaš prava. Osveži stranu i prijavi se ponovo."
                : "Izmena nije prošla."),
          },
        }));
        return;
      }

      setPoruke((p) => ({ ...p, [kljuc]: { ok: true, tekst: telo?.poruka ?? "Urađeno." } }));
      prenesi(() => router.refresh());
    } catch (err) {
      console.error("[admin-utisci]", err);
      setPoruke((p) => ({
        ...p,
        [kljuc]: { ok: false, tekst: "Veza sa serverom nije uspela. Pokušaj ponovo." },
      }));
    } finally {
      setRadi(null);
    }
  }

  function sacuvaj() {
    const spisak = oznake
      .split(",")
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean);

    if (spisak.length > MAX_OZNAKA) {
      setPoruke((p) => ({
        ...p,
        izmena: { ok: false, tekst: `Najviše ${MAX_OZNAKA} oznaka po prijavi.` },
      }));
      return;
    }

    void posalji("izmena", "", {
      method: "PATCH",
      body: JSON.stringify({
        status,
        tags: [...new Set(spisak)],
        admin_note: beleska.trim() || null,
        user_note: obrazlozenje.trim() || null,
      }),
    });
  }

  // Kapija iz §6.7, ponovljena na ekranu samo da bi imala objašnjenje. Pravu
  // odluku donosi ruta, pa i dugme koje bi neko omogućio kroz konzolu ne prolazi.
  const nagradaMoguca =
    red.kind === "bug" && red.status !== "novo" && !["odbijeno", "duplikat"].includes(red.status);

  return (
    <aside className="rounded-xl border border-border bg-bg-elev p-5 shadow-sm">
      {/* ── zaglavlje ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-[15px] font-semibold tracking-tight">#{red.id}</span>
            <Badge variant={BEDZ_STATUSA[red.status]} size="sm">
              {STATUS_UTISKA[red.status]}
            </Badge>
            <Badge variant="outline" size="sm">
              {SLOJ_UTISKA[red.source]}
            </Badge>
            {red.kind === "bug" && (
              <Badge variant="danger" size="sm">
                Bug
              </Badge>
            )}
            {red.reward_credits > 0 && (
              <Badge variant="primary" size="sm">
                +{red.reward_credits} kr
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">
            {formatDatum(red.created_at)} ·{" "}
            <span className="num">{red.ctx.viewport || "?"}</span>
          </p>
        </div>

        <Button asChild variant="ghost" size="icon-sm" aria-label="Zatvori detalj">
          <Link href={nazad}>
            <X />
          </Link>
        </Button>
      </div>

      {/* ── ko i odakle ───────────────────────────────────── */}
      <dl className="mt-4 divide-y divide-border border-y border-border text-[13px]">
        <Red naziv="Korisnik">
          <Link
            href={`/admin/korisnici/${encodeURIComponent(red.user_id)}`}
            className="num underline-offset-4 hover:underline"
          >
            {red.email ?? red.user_id}
          </Link>
          <span className="ml-1.5 text-fg-faint">
            (<span className="num">{ukupnoOdKorisnika}</span> ukupno)
          </span>
        </Red>
        <Red naziv="Ekran">
          {red.route_label ?? "—"}
          {red.route && <span className="ml-1.5 num text-fg-faint">{red.route}</span>}
        </Red>
        <Red naziv="Nalog">
          {red.ctx.plan} · <span className="num">{red.ctx.credits}</span> kr ·{" "}
          <span className="num">{red.ctx.unlocks}</span> otklj.
        </Red>
        {red.rating !== null && <Red naziv="Ocena">{OCENA[red.rating]}</Red>}
        {red.severity !== null && (
          <Red naziv="Težina">
            <span className="num">{red.severity}</span>/3
          </Red>
        )}
      </dl>

      {/* ── pitanje i odgovor ─────────────────────────────── */}
      {red.prompt_key && (
        <div className="mt-4">
          <NaslovSekcije>Pitanje</NaslovSekcije>
          <p className="mt-1.5 text-[13px]">{pitanje?.naslov ?? "(nije više u katalogu)"}</p>
          <p className="mt-1 text-[13px] text-accent-text">
            {pitanje ? opisOdgovora(pitanje, red.answers) : JSON.stringify(red.answers)}
          </p>
          <p className="mt-1 num text-[11px] text-fg-faint">{red.prompt_key}</p>
        </div>
      )}

      {/* ── poruka ────────────────────────────────────────── */}
      <div className="mt-4">
        <NaslovSekcije>Poruka</NaslovSekcije>
        {red.message?.trim() ? (
          <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-accent pl-3 text-[13px]">
            {red.message}
          </p>
        ) : (
          <p className="mt-1.5 text-[13px] text-fg-faint">Bez teksta.</p>
        )}
      </div>

      {/* ── slika ─────────────────────────────────────────── */}
      {red.screenshot_path && (
        <div className="mt-4">
          <NaslovSekcije>Slika</NaslovSekcije>
          {slikaUrl ? (
            <>
              <a href={slikaUrl} target="_blank" rel="noreferrer" className="mt-1.5 block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slikaUrl}
                  alt={`Slika uz prijavu ${red.id}`}
                  className="max-h-64 w-full rounded-lg border border-border object-contain"
                />
              </a>
              <p className="mt-1 text-[11px] text-fg-faint">
                Potpisan link važi 10 minuta i nikad ne ide u mejl. Osveži stranu za nov.
              </p>
            </>
          ) : (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-fg-faint">
              <ImageOff className="h-3.5 w-3.5" />
              Slika postoji u bucketu, ali potpis nije napravljen.
            </p>
          )}
        </div>
      )}

      {/* ── dnevnik klijentskih grešaka ───────────────────── */}
      {red.ctx.errors && red.ctx.errors.length > 0 && (
        <div className="mt-4">
          <NaslovSekcije>Poslednje greške u pregledaču</NaslovSekcije>
          <ul className="mt-1.5 space-y-1">
            {red.ctx.errors.map((g, i) => (
              <li key={`${g.vreme}-${i}`} className="num text-[11.5px] text-fg-muted">
                {g.tip} · {g.ruta} · {g.poruka}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── RADNJE ────────────────────────────────────────── */}
      <div className="mt-6 border-t border-border pt-5">
        <NaslovSekcije>Obrada</NaslovSekcije>

        <div className="mt-2 space-y-2.5">
          <label className="block">
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as FeedbackRow["status"])}
              disabled={zauzeto}
              className="h-10 w-full rounded-lg border border-border-strong bg-bg-elev px-3 text-sm text-fg shadow-sm outline-none transition-[border-color,box-shadow] hover:border-fg-muted focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
            >
              {STATUSI.map((s) => (
                <option key={s} value={s}>
                  {STATUS_UTISKA[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <Label>Oznake (zarezom)</Label>
            <Input
              value={oznake}
              onChange={(e) => setOznake(e.target.value)}
              placeholder="pretraga, mobilni"
              disabled={zauzeto}
            />
          </label>

          {predlozi.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {predlozi.slice(0, 12).map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={zauzeto}
                  onClick={() => {
                    const spisak = oznake.split(",").map((x) => x.trim()).filter(Boolean);
                    if (spisak.includes(o)) return;
                    setOznake([...spisak, o].join(", "));
                  }}
                  className="rounded-md bg-bg-inset px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg disabled:opacity-50"
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          <label className="block">
            <Label>Beleška (ne vidi je korisnik)</Label>
            <Textarea
              rows={3}
              maxLength={MAX_BELESKA}
              value={beleska}
              onChange={(e) => setBeleska(e.target.value)}
              placeholder="Zašto je ovo priznato, gde je popravljeno…"
              disabled={zauzeto}
            />
          </label>

          {/* F11.4: obrazloženje je ono što petlju zatvara — rečenica koja ide
              korisniku u „Moje prijave" i u mejl „rešeno". Namerno odvojeno od
              beleške iznad: to je radna, ovo je javna. */}
          <label className="block">
            <Label>Obrazloženje za korisnika</Label>
            <Textarea
              rows={2}
              maxLength={MAX_BELESKA}
              value={obrazlozenje}
              onChange={(e) => setObrazlozenje(e.target.value)}
              placeholder='„Popravljeno u verziji od 12.08. Hvala."'
              disabled={zauzeto}
            />
            <p className="mt-1 text-[11px] text-fg-muted">
              Vidi ga korisnik u „Moje prijave" i u mejlu „rešeno". Odbijeno bez
              obrazloženja se njemu prikazuje kao „pročitano".
            </p>
          </label>

          <Button size="sm" variant="secondary" disabled={zauzeto} onClick={sacuvaj}>
            {radi === "izmena" ? <Loader2 className="animate-spin" /> : <Save />}
            Sačuvaj
          </Button>

          <Odgovor poruka={poruke.izmena} />
        </div>

        {/* ── NAGRADA ─────────────────────────────────────── */}
        <div className="my-5 border-t border-border" />
        <NaslovSekcije>Nagrada</NaslovSekcije>
        <div className="mt-2 space-y-2.5">
          {red.reward_credits > 0 ? (
            <p className="text-[13px] text-fg-muted">
              Dodeljeno <span className="num text-fg">{red.reward_credits}</span> kredita za ovu
              prijavu.
            </p>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={zauzeto || !nagradaMoguca}
                onClick={() => void posalji("nagrada", "/nagrada", { method: "POST" })}
              >
                {radi === "nagrada" ? <Loader2 className="animate-spin" /> : <Coins />}
                Dodeli {NAGRADA_ZA_BUG} kredita
              </Button>

              {!nagradaMoguca && (
                <p className="text-[11px] text-fg-faint">
                  {red.kind !== "bug"
                    ? "Ide samo za prijavu kvara — nagrađuje se potvrđen bug, ne ocena ni ideja."
                    : red.status === "novo"
                      ? "Prvo priznaj bug: nepregledana prijava nije potvrđena."
                      : "Odbijena prijava i duplikat se ne nagrađuju."}
                </p>
              )}
            </>
          )}

          <p className="text-[11px] text-fg-faint">
            Ide kroz <span className="num">grant_feedback_credits</span>, koji je idempotentan po
            prijavi — dva klika ne dodeljuju dvaput.
          </p>

          <Odgovor poruka={poruke.nagrada} />
        </div>

        {/* ── BETA DNEVNIK ────────────────────────────────── */}
        <div className="my-5 border-t border-border" />
        <NaslovSekcije>Beta dnevnik</NaslovSekcije>
        <div className="mt-2 space-y-2.5">
          {dnevnik.length === 0 ? (
            <p className="text-[11px] text-fg-faint">
              Nijedna stavka dnevnika još ne postoji. Prave se na{" "}
              <span className="num">/admin/dnevnik</span>, koji stiže u F11.4 — do tada ovde nema
              šta da se veže.
            </p>
          ) : (
            <>
              <label className="block">
                <Label>Vezano sa stavkom</Label>
                <select
                  value={stavka}
                  onChange={(e) => setStavka(e.target.value)}
                  disabled={zauzeto}
                  className="h-10 w-full rounded-lg border border-border-strong bg-bg-elev px-3 text-sm text-fg shadow-sm outline-none transition-[border-color,box-shadow] hover:border-fg-muted focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
                >
                  <option value="">— nijedna —</option>
                  {dnevnik.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>

              <Button
                size="sm"
                variant="outline"
                disabled={zauzeto || stavka === (vezana ? String(vezana.id) : "")}
                onClick={() =>
                  void posalji("dnevnik", "/dnevnik", {
                    method: "POST",
                    body: JSON.stringify({ stavka: stavka ? Number(stavka) : null }),
                  })
                }
              >
                {radi === "dnevnik" ? <Loader2 className="animate-spin" /> : <BookMarked />}
                Poveži
              </Button>

              <p className="text-[11px] text-fg-faint">
                Zbog ove veze korisnik na „Moje prijave" vidi „iz tvog utiska". Jedna prijava ide uz
                najviše jednu stavku.
              </p>
            </>
          )}

          <Odgovor poruka={poruke.dnevnik} />
        </div>
      </div>

      <p className="mt-5 text-[11px] text-fg-faint">
        Svaka izmena odavde ostavlja red u{" "}
        <Link href="/admin/revizija" className="underline underline-offset-4 hover:text-fg">
          reviziji
        </Link>
        , i kad prođe i kad padne.{" "}
        <Link
          href={`/admin/utisci/${red.id}`}
          className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-fg"
        >
          Stalna adresa <ExternalLink className="h-3 w-3" />
        </Link>
      </p>
    </aside>
  );
}

// ── sitni delovi ─────────────────────────────────────────────

const OCENA: Record<1 | 2 | 3, string> = { 1: "Loše (1/3)", 2: "Ok (2/3)", 3: "Odlično (3/3)" };

export const BEDZ_STATUSA: Record<
  FeedbackRow["status"],
  "neutral" | "info" | "success" | "warning" | "outline"
> = {
  novo: "warning",
  priznato: "info",
  u_radu: "info",
  reseno: "success",
  odbijeno: "neutral",
  duplikat: "outline",
};

function Red({ naziv, children }: { naziv: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-fg-muted">{naziv}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function Odgovor({ poruka }: { poruka?: Poruka }) {
  if (!poruka) return null;
  return (
    <Alert variant={poruka.ok ? "success" : "danger"} bezIkonice className="px-3 py-2 text-[13px]">
      {poruka.tekst}
    </Alert>
  );
}
