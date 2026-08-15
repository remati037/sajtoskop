// apps/web/src/app/(admin)/admin/utisci/page.tsx
// Utisci u konzoli (F11 §6.6).
//
// Jedan ekran UNUTAR konzole iz `docs/F12-admin.md`, ne svoj okvir: odatle
// dolaze `requireAdminPage()`, bočna traka, `admin_audit` i put do kredita.
//
// Raspored: red brojki, filteri, lista levo, detalj u panelu desno. Panel se
// otvara kroz adresu (`?utisak=<id>`), a ne kroz `useState` — iz istog razloga
// zbog kog su i filteri u adresi (v. `admin-filteri.tsx`): otvorena prijava se
// može poslati sebi u poruku, osvežiti i vratiti dugmetom „nazad".
//
// ── zašto brojke dolaze iz `admin_overview` ──────────────────
// Isti poziv koji puni karticu „Utisci" na `/admin` (0013, prošireno u 0015).
// Druga funkcija koja broji isto bila bi drugi izvor istine, i prvi koji se
// raziđe je onaj u koji se ređe gleda. Cena je što se uz ovaj ekran izračuna i
// budžet i red poslova — jedan poziv, i to je jeftinije od dva tačna odgovora
// koji se ne slažu.

import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareHeart } from "lucide-react";
import { pitanjeZaKljuc } from "@sajtoskop/shared";
import { requireAdminPage } from "@/lib/admin";
import { citajPregled, trajanje } from "@/lib/admin-pregled";
import { citajOznake, citajUtisak, citajUtiske, PO_STRANI } from "@/lib/admin-utisci";
import { SLOJ_UTISKA, STATUS_UTISKA } from "@/lib/admin-utisci-schema";
import { cn } from "@/lib/cn";
import { potpisanUrlSlike } from "@/lib/slika";
import { formatDatumKratko } from "@/lib/ui-tekst";
import { BEDZ_STATUSA, PanelUtiska } from "@/components/admin-utisak-panel";
import { Paginacija, PoljePretrage, TrakaFiltera } from "@/components/admin-filteri";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { NaslovSekcije, PraznoStanje, ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Utisci" };

/** Ispod ovoliko odgovora medijana cene nije dokaz nego signal (F11 §10). */
const UZORAK_ZA_MEDIJANU = 12;

type Params = Record<string, string | string[] | undefined>;

const tekst = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

/** Adresa sa izmenjenim parametrom — isto pravilo kao u `admin-filteri.tsx`. */
function adresa(sp: Params, izmene: Record<string, string>): string {
  const p = new URLSearchParams();

  for (const [k, v] of Object.entries(sp)) {
    const vrednost = tekst(v);
    if (vrednost) p.set(k, vrednost);
  }
  for (const [k, v] of Object.entries(izmene)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }

  const upit = p.toString();
  return `/admin/utisci${upit ? `?${upit}` : ""}`;
}

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  // Prva linija svake strane pod `/admin` (pravilo 13). Layout se ne računa.
  await requireAdminPage();

  const sp = await searchParams;

  const [pregled, lista, oznake] = await Promise.all([
    citajPregled(),
    citajUtiske({
      status: tekst(sp.status),
      sloj: tekst(sp.sloj),
      ocena: tekst(sp.ocena),
      korisnik: tekst(sp.korisnik).slice(0, 254),
      strana: Math.max(1, Number.parseInt(tekst(sp.strana), 10) || 1),
    }),
    citajOznake(),
  ]);

  const izabran = Number.parseInt(tekst(sp.utisak), 10);
  const detalj =
    Number.isInteger(izabran) && izabran > 0
      ? await citajUtisak(izabran, potpisanUrlSlike)
      : null;

  const u = pregled.utisci;
  const odgovorenost =
    u.pitanja.prikazano > 0
      ? Math.round((u.pitanja.odgovoreno / u.pitanja.prikazano) * 100)
      : null;

  const rsd = new Intl.NumberFormat("sr-Latn-RS");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Utisci"
        opis="Sve što je stiglo iz bete — dugme, pitanja, kampanje i incidenti u istoj listi. Status, oznake i beleška se menjaju u panelu desno."
      />

      {/* ── RED BROJKI (§6.6) ─────────────────────────────── */}
      {/* Iste brojke kao kartica „Utisci" na /admin — isti poziv, ne isti račun
          napisan dvaput. */}
      <dl className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Brojka
          naslov="Odgovorenost"
          vrednost={odgovorenost === null ? "—" : `${odgovorenost} %`}
          podnaslov={`${u.pitanja.odgovoreno} od ${u.pitanja.prikazano} prikazanih pitanja`}
          napomena={
            odgovorenost !== null && odgovorenost < 40 ? "cilj iz §10 je ≥ 40 %" : undefined
          }
        />
        <Brojka
          naslov="Medijana cene"
          vrednost={pregled.medijana === null ? "—" : `${rsd.format(pregled.medijana)} RSD`}
          podnaslov={
            pregled.medijana === null
              ? "nijedan odgovor na pitanje o ceni"
              : `iz ${pregled.medijanaUzorak} odgovora, mesečno`
          }
          napomena={
            pregled.medijana !== null && pregled.medijanaUzorak < UZORAK_ZA_MEDIJANU
              ? "signal, ne dokaz"
              : undefined
          }
        />
        <Brojka
          naslov="Otvoreni bugovi"
          vrednost={String(u.otvoreni_bugovi)}
          podnaslov={`${u.nedirnuto} nedirnutih od ${u.ukupno} prijava`}
        />
        <Brojka
          naslov="Prosek do odgovora"
          vrednost={u.obrada.reseno > 0 ? trajanje(u.obrada.prosek_sec) : "—"}
          podnaslov={
            u.obrada.reseno > 0
              ? `iz ${u.obrada.reseno} prijava sa ishodom`
              : "nijedna prijava još nema ishod"
          }
          napomena={
            u.obrada.nereseno > 0
              ? `najstarija nerešena čeka ${trajanje(u.obrada.nereseno_najstarije_sec)}`
              : undefined
          }
        />
      </dl>

      {/* ── ODGOVORENOST PO PITANJU ───────────────────────── */}
      {/* Zbirna brojka kaže da li mehanika radi; ova kaže KOJE pitanje ne radi. */}
      {u.po_pitanju.length > 0 && (
        <div className="mb-6 rounded-xl border border-border bg-bg-elev p-4 shadow-sm">
          <NaslovSekcije>Odgovorenost po pitanju</NaslovSekcije>
          <ul className="mt-2.5 divide-y divide-border">
            {u.po_pitanju.map((q) => {
              const procenat =
                q.prikazano > 0 ? Math.round((q.odgovoreno / q.prikazano) * 100) : 0;

              return (
                <li key={q.kljuc} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="num min-w-40 text-[12.5px] text-fg">{q.kljuc}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">
                    {pitanjeZaKljuc(q.kljuc)?.naslov ?? "nije više u katalogu"}
                  </span>
                  <span className="h-1 w-20 overflow-hidden rounded-full bg-bg-inset">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${procenat}%` }}
                    />
                  </span>
                  <span className="num w-32 text-right text-[12px] text-fg-muted">
                    {q.odgovoreno}/{q.prikazano} · {procenat} %
                  </span>
                  <span className="num w-24 text-right text-[11px] text-fg-faint">
                    {q.odbaceno} odbačeno
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── FILTERI ───────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PoljePretrage
          naziv="Filter po korisniku"
          kljuc="korisnik"
          placeholder="mejl ili Clerk ID…"
        />
        <TrakaFiltera
          kljuc="status"
          podrazumevano=""
          opcije={[
            { vrednost: "", label: "Svi" },
            { vrednost: "otvoreno", label: "Otvoreno" },
            { vrednost: "novo", label: STATUS_UTISKA.novo },
            { vrednost: "priznato", label: STATUS_UTISKA.priznato },
            { vrednost: "u_radu", label: STATUS_UTISKA.u_radu },
            { vrednost: "reseno", label: STATUS_UTISKA.reseno },
            { vrednost: "odbijeno", label: STATUS_UTISKA.odbijeno },
            { vrednost: "duplikat", label: STATUS_UTISKA.duplikat },
          ]}
        />
        <TrakaFiltera
          kljuc="sloj"
          podrazumevano=""
          opcije={[
            { vrednost: "", label: "Svi slojevi" },
            { vrednost: "pitanje", label: SLOJ_UTISKA.pitanje },
            { vrednost: "kampanja", label: SLOJ_UTISKA.kampanja },
            { vrednost: "incident", label: SLOJ_UTISKA.incident },
            { vrednost: "dugme", label: SLOJ_UTISKA.dugme },
            { vrednost: "podsetnik", label: SLOJ_UTISKA.podsetnik },
          ]}
        />
        <TrakaFiltera
          kljuc="ocena"
          podrazumevano=""
          opcije={[
            { vrednost: "", label: "Sve ocene" },
            { vrednost: "1", label: "1" },
            { vrednost: "2", label: "2" },
            { vrednost: "3", label: "3" },
            { vrednost: "bez", label: "Bez ocene" },
          ]}
        />
      </div>

      {lista.nemaKorisnika && (
        <Alert variant="neutral" className="mb-4">
          Nijedan nalog ne odgovara tom mejlu. Lista je prazna zbog filtera, ne zato što taj čovek
          ćuti.
        </Alert>
      )}

      {/* ── LISTA + PANEL ─────────────────────────────────── */}
      <div className={cn("grid gap-5", detalj && "lg:grid-cols-[minmax(0,1fr)_24rem]")}>
        <div className="min-w-0">
          {lista.redovi.length === 0 ? (
            <PraznoStanje
              ikona={<MessageSquareHeart />}
              naslov={lista.nemaKorisnika ? "Nema pogodaka." : "Nijedan utisak još nije stigao."}
              opis="Prvi red se pojavljuje čim neko klikne na dugme, odgovori na pitanje ili mu skeniranje padne."
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
                <div className="scroll-x">
                  <table className="w-full min-w-[40rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-bg-subtle/70 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                        <th className="py-2.5 pl-4 font-medium">Kad</th>
                        <th className="py-2.5 font-medium">Ko</th>
                        <th className="py-2.5 font-medium">Sloj</th>
                        <th className="py-2.5 font-medium">Šta</th>
                        <th className="py-2.5 pr-4 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.redovi.map((r) => {
                        const pitanje = r.prompt_key ? pitanjeZaKljuc(r.prompt_key) : null;
                        const otvoren = detalj?.red.id === r.id;

                        return (
                          <tr
                            key={r.id}
                            className={cn(
                              "border-b border-border/70 align-top transition-colors last:border-0 hover:bg-bg-subtle/60",
                              otvoren && "bg-bg-subtle",
                            )}
                          >
                            <td className="py-2.5 pl-4">
                              <Link
                                href={adresa(sp, { utisak: String(r.id) })}
                                scroll={false}
                                className="block text-[12.5px] text-fg-muted"
                              >
                                {formatDatumKratko(r.created_at)}
                                <span className="block num text-[11px] text-fg-faint">
                                  #{r.id}
                                </span>
                              </Link>
                            </td>
                            <td className="py-2.5">
                              <span className="block max-w-44 truncate num text-[12px] text-fg-muted">
                                {r.email ?? r.user_id}
                              </span>
                            </td>
                            <td className="py-2.5">
                              <span className="text-[12px] text-fg-muted">
                                {SLOJ_UTISKA[r.source]}
                              </span>
                              {r.kind === "bug" && (
                                <Badge variant="danger" size="sm" className="ml-1.5">
                                  Bug
                                </Badge>
                              )}
                            </td>
                            <td className="py-2.5">
                              <Link
                                href={adresa(sp, { utisak: String(r.id) })}
                                scroll={false}
                                className="block max-w-md"
                              >
                                <span className="block truncate text-[13px] text-fg">
                                  {pitanje?.naslov ??
                                    r.message?.trim() ??
                                    (r.rating !== null ? `Ocena ${r.rating}/3` : "—")}
                                </span>
                                {r.message?.trim() && pitanje && (
                                  <span className="block truncate text-[11.5px] text-fg-faint">
                                    {r.message}
                                  </span>
                                )}
                              </Link>
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge variant={BEDZ_STATUSA[r.status]} size="sm">
                                {STATUS_UTISKA[r.status]}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <Paginacija
                strana={lista.strana}
                strana_max={lista.strana_max}
                ukupno={lista.ukupno}
                imenica="prijava"
              />
            </>
          )}
        </div>

        {detalj ? (
          <PanelUtiska
            red={detalj.red}
            slikaUrl={detalj.slikaUrl}
            dnevnik={detalj.dnevnik}
            ukupnoOdKorisnika={detalj.ukupnoOdKorisnika}
            predlozi={oznake}
            nazad={adresa(sp, { utisak: "" })}
          />
        ) : (
          Number.isInteger(izabran) &&
          izabran > 0 && (
            <Alert variant="neutral" className="lg:col-span-2">
              Prijave <span className="num">#{izabran}</span> nema. Verovatno je nestala uz nalog
              koji je obrisan.
            </Alert>
          )
        )}
      </div>

      <p className="mt-6 text-xs text-fg-muted">
        Stranica po <span className="num">{PO_STRANI}</span>. Instant mejl stiže samo za bug, ocenu
        1 i incident — sve ostalo je u digestu u <span className="num">21:00</span>.
      </p>
    </div>
  );
}

// ── sitni delovi ─────────────────────────────────────────────
// Kartica je jedna površina sa jednom senkom; bez ugnježđenih kartica (§7.2).

function Brojka({
  naslov,
  vrednost,
  podnaslov,
  napomena,
}: {
  naslov: string;
  vrednost: string;
  podnaslov: string;
  /** Jedna rečenica koja se pojavljuje samo kad brojka nešto znači. */
  napomena?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-elev p-4 shadow-sm">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">{naslov}</dt>
      <dd className="mt-2 num text-2xl font-semibold tracking-tight">{vrednost}</dd>
      <dd className="mt-0.5 text-xs text-fg-muted">{podnaslov}</dd>
      {napomena && <dd className="mt-1 text-[11px] text-warn-text">{napomena}</dd>}
    </div>
  );
}
