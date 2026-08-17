"use client";

// Kanban otključanih prospekata (F7 §3). Pet kolona, prevlačenje, beleška po
// leadu, filter po niši i gradu.
//
// ── zašto native HTML5 drag and drop, a ne biblioteka ─────
// Pet kolona i kartice bez ugnježdenog reda su tačno slučaj koji `draggable` +
// `onDrop` pokrivaju u tridesetak linija. `dnd-kit` je 40 kB u bundle-u i
// senzori za dodir koje ovde niko ne koristi — kanban se gleda za stolom.
//
// ── zašto optimistična izmena ─────────────────────────────
// Kartica se pomera odmah, zahtev ide u pozadini. Prevlačenje koje čeka mrežu
// izgleda pokvareno. Ako server odbije, kartica se vraća i pojavi se poruka —
// tada je greška stvarna i vredna prekida.

import { useEffect, useMemo, useState } from "react";
import { MessageSquareText, Search, StickyNote } from "lucide-react";
import { foldForSearch } from "@sajtoskop/shared";
import type { LeadChannel, LeadStatusValue } from "@sajtoskop/shared";
import { KOLONA_LABEL, KOLONE, type PipelineKartica } from "@/lib/pipeline-tipovi";
import type { ApiError } from "@/lib/search-types";
import { cn } from "@/lib/cn";
import { BAND_LABEL, formatDatum, plural, STATUS_LABEL } from "@/lib/ui-tekst";
import { PorukePanel } from "./poruke-panel";
import { UtisakKartica } from "./utisak-kartica";
import { useUtisci } from "./utisci-provider";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Input, Label, Textarea } from "./ui/input";
import { Izbor } from "./ui/select";

type Props = {
  kartice: PipelineKartica[];
  cityLabels: Record<string, string>;
  nicheLabels: Record<string, string>;
};

/**
 * Boja stanja. Jedina boja u kanbanu — nosi je status, ne ukras.
 *
 * `tacka` stoji uz naslov kolone, `ivica` je levi rub kartice. Ista boja na dva
 * mesta znači da se kartica prepoznaje i kad se odvoji od svoje kolone (dok je
 * korisnik vuče).
 */
const BOJA: Record<LeadStatusValue, { tacka: string; ivica: string }> = {
  nekontaktiran: { tacka: "bg-fg-muted/50", ivica: "border-l-border-strong" },
  kontaktiran: { tacka: "bg-info", ivica: "border-l-info" },
  odgovorio: { tacka: "bg-warn", ivica: "border-l-warn" },
  potpisan: { tacka: "bg-accent", ivica: "border-l-accent" },
  nezainteresovan: { tacka: "bg-fg-muted/25", ivica: "border-l-border" },
};

export function PipelineTabla({ kartice, cityLabels, nicheLabels }: Props) {
  const [redovi, setRedovi] = useState(kartice);

  // [Faza 4, 4.2] `kartice` prop se menja posle uvoza (router.refresh()) dok je
  // komponenta montirana — bez sinhronizacije uvezeni prospekti ne bi izašli do
  // punog reloada (I1). Lokalne izmene (premeštanje, beleška) ostaju: prop je
  // izvor istine na svakom serverskom osvežavanju, a `pomeri`/`sacuvajBelesku`
  // ih i dalje pišu kroz fetch.
  useEffect(() => setRedovi(kartice), [kartice]);

  const [grad, setGrad] = useState("");
  const [nisa, setNisa] = useState("");
  const [upit, setUpit] = useState("");
  const [vucem, setVucem] = useState<string | null>(null);
  const [nadKolonom, setNadKolonom] = useState<LeadStatusValue | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [otvoren, setOtvoren] = useState<PipelineKartica | null>(null);

  // Motor pitanja (F11). Panel sa porukama se NAMERNO ne prijavljuje kao nemir,
  // iako je sloj preko ekrana: on jedini NOSI pitanje (`poruka-kvalitet` stoji
  // ispod poruke, §2.1). Kad bi ućutkao motor, ućutkao bi i sopstveno pitanje.
  const utisci = useUtisci();

  const gradovi = useMemo(
    () => spisak(redovi.map((r) => r.citySlug), cityLabels),
    [redovi, cityLabels],
  );
  const nise = useMemo(
    () => spisak(redovi.flatMap((r) => (r.nicheSlug ? [r.nicheSlug] : [])), nicheLabels),
    [redovi, nicheLabels],
  );

  const vidljivi = useMemo(() => {
    const trazeno = foldForSearch(upit.trim());
    return redovi.filter((r) => {
      if (grad && r.citySlug !== grad) return false;
      if (nisa && r.nicheSlug !== nisa) return false;
      if (!trazeno) return true;
      return foldForSearch(`${r.name} ${r.address ?? ""} ${r.note ?? ""}`).includes(trazeno);
    });
  }, [redovi, grad, nisa, upit]);

  const poKoloni = useMemo(() => {
    const mapa = new Map<LeadStatusValue, PipelineKartica[]>(KOLONE.map((k) => [k, []]));
    for (const r of vidljivi) mapa.get(r.status)?.push(r);
    return mapa;
  }, [vidljivi]);

  /** Lokalna izmena jedne kartice. Jedini put do `setRedovi` iz svih akcija. */
  function izmeni(placeId: string, delta: Partial<PipelineKartica>) {
    setRedovi((prev) => prev.map((r) => (r.placeId === placeId ? { ...r, ...delta } : r)));
  }

  async function pomeri(placeId: string, status: LeadStatusValue) {
    const stari = redovi.find((r) => r.placeId === placeId);
    if (!stari || stari.status === status) return;

    // Snimak PRE premeštanja: posle `izmeni` bi i ova kartica bila „potpisan".
    const vecImaPotpisan = redovi.some((r) => r.placeId !== placeId && r.status === "potpisan");

    setGreska(null);
    // Datum kontakta prati status i lokalno, da kartica ne bi na trenutak
    // stajala u „Kontaktiran" bez ijednog datuma dok server ne odgovori.
    izmeni(placeId, {
      status,
      contactedAt:
        status === "nekontaktiran" ? null : (stari.contactedAt ?? new Date().toISOString()),
    });

    try {
      const res = await fetch("/api/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, status }),
      });

      if (!res.ok) {
        const json = (await res.json()) as ApiError;
        izmeni(placeId, { status: stari.status, contactedAt: stari.contactedAt });
        setGreska(json.greska ?? "Premeštanje nije uspelo.");
        return;
      }

      // Prvi potpisan posao (F11 §2.1) — jedini trenutak u životu naloga u kom
      // se uopšte pita za preporuku. „Prvi" se čita iz table pre premeštanja:
      // motor bi i sam propustio drugo pitanje, ali kartica koja se pojavi na
      // petom potpisanom sa naslovom „Prvi potpisan" bila bi laž.
      if (status === "potpisan" && !vecImaPotpisan) {
        utisci?.prijaviDogadjaj("prvi-potpisan");
      }
    } catch {
      izmeni(placeId, { status: stari.status, contactedAt: stari.contactedAt });
      setGreska("Nema veze sa serverom. Kartica je vraćena na staro mesto.");
    }
  }

  async function sacuvajBelesku(placeId: string, note: string) {
    const stari = redovi.find((r) => r.placeId === placeId);
    izmeni(placeId, { note: note.trim() || null });

    try {
      const res = await fetch("/api/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, note }),
      });
      if (!res.ok) {
        izmeni(placeId, { note: stari?.note ?? null });
        setGreska("Beleška nije sačuvana.");
      }
    } catch {
      izmeni(placeId, { note: stari?.note ?? null });
      setGreska("Beleška nije sačuvana — nema veze sa serverom.");
    }
  }

  /** Kopiranje poruke je već pomerilo lead na serveru; ovde se samo sustiže. */
  function naKontakt(placeId: string, channel: LeadChannel) {
    const r = redovi.find((x) => x.placeId === placeId);
    if (!r) return;
    izmeni(placeId, {
      channel,
      status: r.status === "nekontaktiran" ? "kontaktiran" : r.status,
      contactedAt: r.contactedAt ?? new Date().toISOString(),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-elev p-4 shadow-sm">
        <label className="min-w-[14rem] flex-1">
          <Label>Pretraži pipeline</Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
            />
            <Input
              type="search"
              value={upit}
              onChange={(e) => setUpit(e.target.value)}
              placeholder="naziv, adresa ili beleška"
              className="pl-9"
            />
          </div>
        </label>

        {gradovi.length > 1 && (
          <Izbor naziv="Grad" vrednost={grad} postavi={setGrad} opcije={gradovi} sve="Svi gradovi" />
        )}
        {nise.length > 1 && (
          <Izbor naziv="Niša" vrednost={nisa} postavi={setNisa} opcije={nise} sve="Sve niše" />
        )}

        <p className="ml-auto pb-2.5 text-xs num text-fg-muted">
          {vidljivi.length} {plural(vidljivi.length, "kartica", "kartice", "kartica")}
          {vidljivi.length !== redovi.length && ` od ${redovi.length}`}
        </p>
      </div>

      {greska && <Alert variant="danger">{greska}</Alert>}

      {/* Kartica preko kolona (F11 §2.1): prvi potpisan posao je jedini trenutak
          u kom se uopšte pita za preporuku. */}
      <UtisakKartica kljuc="prvi-potpisan" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {KOLONE.map((k) => {
          const u = poKoloni.get(k) ?? [];
          const nad = nadKolonom === k;

          return (
            <section
              key={k}
              onDragOver={(e) => {
                e.preventDefault();
                setNadKolonom(k);
              }}
              onDragLeave={() => setNadKolonom((p) => (p === k ? null : p))}
              onDrop={(e) => {
                e.preventDefault();
                setNadKolonom(null);
                const id = vucem ?? e.dataTransfer.getData("text/plain");
                if (id) void pomeri(id, k);
                setVucem(null);
              }}
              className={cn(
                "flex min-h-[9rem] flex-col rounded-2xl border p-2.5 transition-all duration-150",
                nad
                  ? "border-accent bg-accent-wash/60 ring-2 ring-accent/25"
                  : "border-border bg-bg-subtle/50",
              )}
            >
              <h2 className="flex items-center gap-2 px-1 pb-2.5 text-xs font-semibold">
                <span aria-hidden className={cn("h-2 w-2 rounded-full", BOJA[k].tacka)} />
                <span>{KOLONA_LABEL[k]}</span>
                <span className="ml-auto rounded-full bg-bg-inset px-1.5 py-0.5 text-[11px] font-medium num text-fg-muted">
                  {u.length}
                </span>
              </h2>

              <div className="space-y-2">
                {u.map((r) => (
                  <Kartica
                    key={r.placeId}
                    r={r}
                    cityLabels={cityLabels}
                    vuceSe={vucem === r.placeId}
                    pocniVucu={() => setVucem(r.placeId)}
                    zavrsiVucu={() => setVucem(null)}
                    otvoriPoruke={() => setOtvoren(r)}
                    sacuvajBelesku={(t) => void sacuvajBelesku(r.placeId, t)}
                    pomeriKarticu={(status) => void pomeri(r.placeId, status)}
                  />
                ))}

                {u.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-[11px] text-fg-muted/70">
                    prevuci karticu ovde
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {otvoren && (
        <PorukePanel
          placeId={otvoren.placeId}
          naziv={otvoren.name}
          zatvori={() => setOtvoren(null)}
          naKontakt={(ch) => naKontakt(otvoren.placeId, ch)}
        />
      )}
    </div>
  );
}

function Kartica({
  r,
  cityLabels,
  vuceSe,
  pocniVucu,
  zavrsiVucu,
  otvoriPoruke,
  sacuvajBelesku,
  pomeriKarticu,
}: {
  r: PipelineKartica;
  cityLabels: Record<string, string>;
  vuceSe: boolean;
  pocniVucu: () => void;
  zavrsiVucu: () => void;
  otvoriPoruke: () => void;
  sacuvajBelesku: (t: string) => void;
  pomeriKarticu: (status: LeadStatusValue) => void;
}) {
  const [pisem, setPisem] = useState(false);
  const [tekst, setTekst] = useState(r.note ?? "");

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", r.placeId);
        e.dataTransfer.effectAllowed = "move";
        pocniVucu();
      }}
      onDragEnd={zavrsiVucu}
      className={cn(
        "cursor-grab rounded-xl border border-l-[3px] border-border bg-bg-elev p-3 text-sm shadow-sm transition-all duration-150",
        "hover:-translate-y-px hover:shadow-card active:cursor-grabbing",
        BOJA[r.status].ivica,
        vuceSe && "rotate-1 opacity-40 shadow-card",
      )}
    >
      <p className="truncate font-medium leading-snug">{r.name}</p>

      <p className="mt-0.5 truncate text-xs text-fg-muted">
        {cityLabels[r.citySlug] ?? r.citySlug}
        {r.contactedAt && ` · ${formatDatum(r.contactedAt)}`}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {r.siteStatus && r.siteStatus !== "ok" ? (
          <Badge
            size="sm"
            variant={
              r.siteStatus === "nema_sajt"
                ? "jak-success"
                : r.siteStatus === "mrtav"
                  ? "jak-warning"
                  : "jak-info"
            }
          >
            {STATUS_LABEL[r.siteStatus]}
          </Badge>
        ) : (
          r.uglyBand && <Badge variant="neutral">{BAND_LABEL[r.uglyBand]}</Badge>
        )}

        {r.uglyScore !== null && (
          <span className="text-[11px] font-medium num text-fg-muted">
            {r.uglyScore}
          </span>
        )}

        {r.channel && (
          <span className="ml-auto text-[11px] text-fg-muted/80">{r.channel}</span>
        )}
      </div>

      {pisem ? (
        <Textarea
          autoFocus
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          onBlur={() => {
            setPisem(false);
            if (tekst !== (r.note ?? "")) sacuvajBelesku(tekst);
          }}
          // [Faza 4, 4.9] Esc otkazuje bez upisa — slučajan blur (klik pored) ne
          // sme da ostavi polovičan tekst (nalaz 7.1.5).
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setTekst(r.note ?? "");
              setPisem(false);
            }
          }}
          rows={3}
          placeholder="beleška"
          className="mt-2.5 resize-none bg-bg-subtle text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPisem(true)}
          className="mt-2.5 flex w-full items-center gap-1.5 truncate rounded-md text-left text-xs text-fg-muted transition-colors hover:text-fg"
        >
          <StickyNote className="h-3 w-3 shrink-0" />
          <span className="truncate">{r.note || "dodaj belešku"}</span>
        </button>
      )}

      {/* [Faza 4, 4.1] „Premesti u…" — rezerva za touch i tastaturu: native
          drag&drop nema ni jedno ni drugo (nalaz 7.1.1). Isti `pomeri` kao
          prevlačenje, pa se i „prvi potpisan" javlja isto. */}
      <select
        aria-label="Premesti u kolonu"
        value=""
        onChange={(e) => {
          const status = e.target.value as LeadStatusValue;
          if (status) pomeriKarticu(status);
        }}
        className="mt-2.5 w-full cursor-pointer rounded-lg border border-border-strong bg-bg-subtle px-2 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-accent focus:border-accent focus:outline-none"
      >
        <option value="" disabled>
          Premesti u…
        </option>
        {KOLONE.map((k) => (
          <option key={k} value={k}>
            {KOLONA_LABEL[k]}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={otvoriPoruke}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-bg-subtle py-1.5 text-xs font-medium transition-colors hover:border-accent hover:bg-accent hover:text-accent-ink"
      >
        <MessageSquareText className="h-3 w-3" />
        Poruka
      </button>
    </article>
  );
}

/** Filter nudi samo ono što u kanbanu stvarno postoji, poređano po srpskoj azbuci. */
function spisak(slugs: string[], labels: Record<string, string>) {
  return [...new Set(slugs)]
    .map((slug) => ({ slug, label: labels[slug] ?? slug }))
    .sort((a, b) => a.label.localeCompare(b.label, "sr-Latn-RS"));
}
