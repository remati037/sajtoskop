// apps/web/src/app/(admin)/admin/utisci/page.tsx
// Utisci u konzoli (F11 §6.6).
//
// Jedan ekran UNUTAR konzole iz F12 PRD-a (git istorija), ne svoj okvir: odatle
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
import { MessageSquareHeart, Search } from "lucide-react";
import { pitanjeZaKljuc, type AdminFali } from "@sajtoskop/shared";
import { requireAdminPage } from "@/lib/admin";
import { citajPregled, trajanje } from "@/lib/admin-pregled";
import {
  citajFali,
  citajOznake,
  citajUtisak,
  citajUtiske,
  PO_STRANI,
  type ListaUtisaka,
} from "@/lib/admin-utisci";
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

/** Ispod ovoliko odgovora NPS nije dokaz nego signal (F11 §10). */
const UZORAK_ZA_NPS = 12;

type Params = Record<string, string | string[] | undefined>;

/** Ono što `citajUtiske()` vrati kad nema šta da vrati — bez lažnog upita. */
const PRAZNA_LISTA = {
  redovi: [],
  ukupno: 0,
  strana: 1,
  strana_max: 1,
  nemaKorisnika: false,
} satisfies ListaUtisaka;

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

  // [S29] `fali` je pogled, ne filter: umesto pojedinačnih redova ide zbirna
  // lista iz `admin_fali()`, jer je kod tog pitanja zanimljivo šta se PONAVLJA,
  // a ne ko je to napisao u utorak.
  const pogledFali = tekst(sp.sloj) === "fali";

  const [pregled, lista, oznake, fali] = await Promise.all([
    citajPregled(),
    // U `fali` pogledu se lista pojedinačnih utisaka ne crta, pa se ni ne čita:
    // upit čiji rezultat niko ne prikaže je upit koji se plaća bez razloga.
    pogledFali
      ? Promise.resolve(PRAZNA_LISTA)
      : citajUtiske({
          status: tekst(sp.status),
          sloj: tekst(sp.sloj),
          ocena: tekst(sp.ocena),
          korisnik: tekst(sp.korisnik).slice(0, 254),
          strana: Math.max(1, Number.parseInt(tekst(sp.strana), 10) || 1),
        }),
    citajOznake(),
    pogledFali ? citajFali(tekst(sp.ruta)) : Promise.resolve([]),
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

  const nps = u.nps;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Utisci"
        opis="Sve što je stiglo — dugme, pitanja, kampanje i incidenti u istoj listi. Status, oznake i beleška se menjaju u panelu desno."
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
        {/* [S29] Medijana cene je otišla sa pitanjem o ceni — proizvod se
            naplaćuje, pa opseg u RSD više nije procena nego pogrešna brojka.
            Skor računa `admin_nps()`; ovde se ne prepisuje. */}
        <Brojka
          naslov="NPS"
          vrednost={nps.n === 0 ? "—" : String(nps.score)}
          podnaslov={
            nps.n === 0
              ? "nijedan odgovor na pitanje o preporuci"
              : `${nps.promoteri} promotera · ${nps.pasivni} pasivnih · ${nps.detraktori} detraktora`
          }
          napomena={
            nps.n === 0
              ? undefined
              : nps.n < UZORAK_ZA_NPS
                ? `iz ${nps.n} odgovora — signal, ne dokaz`
                : `iz ${nps.n} odgovora · ${nps.poslednjih_30_dana} u 30 dana`
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
        {/* [S29] „Fali" i „Citat" stoje u istoj traci kao slojevi, iako nisu
            slojevi nego pogledi. Svoja traka bi značila dva mesta za jednu
            odluku — a čovek koji traži „šta ljudima fali" bira jednu stvar. */}
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
            { vrednost: "fali", label: "Fali" },
            { vrednost: "citat", label: "Citat" },
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
          {pogledFali ? (
            <ListaFali redovi={fali} sp={sp} ruta={tekst(sp.ruta)} />
          ) : lista.redovi.length === 0 ? (
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
            poslovi={detalj.poslovi}
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

// ── „Fali" — zbirna lista ────────────────────────────────────
// Kod ovog pitanja je zanimljivo šta se PONAVLJA, a ne ko je to napisao u
// utorak. Zato ovde nema kolone „ko" ni panela: grupisanje radi `admin_fali()`
// u bazi, a ekran samo crta ono što je izbrojano.

const RUTE_FALI: { vrednost: string; label: string }[] = [
  { vrednost: "", label: "Svi ekrani" },
  { vrednost: "/pretraga", label: "Pretraga" },
  { vrednost: "/lista", label: "Moja lista" },
  { vrednost: "/pipeline", label: "Pipeline" },
];

function ListaFali({
  redovi,
  sp,
  ruta,
}: {
  redovi: AdminFali[];
  sp: Params;
  ruta: string;
}) {
  return (
    <div className="min-w-0">
      {/* Filter po ekranu je u adresi, kao i svi ostali — otvoren pogled se
          može poslati sebi u poruku i vratiti dugmetom „nazad". */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {RUTE_FALI.map((r) => (
          <Link
            key={r.vrednost || "sve"}
            href={adresa(sp, { ruta: r.vrednost, utisak: "" })}
            scroll={false}
            className={cn(
              "inline-flex h-8 items-center rounded-lg border border-border-strong bg-bg-elev px-3 text-xs font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg",
              ruta === r.vrednost && "border-border-accent bg-accent-wash text-accent-text",
            )}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {redovi.length === 0 ? (
        <PraznoStanje
          ikona={<Search />}
          naslov="Niko još nije napisao šta mu fali."
          opis="Pitanje se pojavljuje ispod praznog stanja — na pretrazi bez pogodaka, na praznoj listi i na praznom pipeline-u."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
          <div className="scroll-x">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle/70 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                  <th className="py-2.5 pl-4 font-medium">Šta fali</th>
                  <th className="w-20 py-2.5 font-medium">Koliko</th>
                  <th className="w-28 py-2.5 font-medium">Ekran</th>
                  <th className="w-28 py-2.5 pr-4 font-medium">Poslednji put</th>
                </tr>
              </thead>
              <tbody>
                {redovi.map((r) => (
                  <tr
                    key={`${r.message}-${r.route ?? ""}`}
                    className="border-b border-border/70 align-top transition-colors last:border-0 hover:bg-bg-subtle/60"
                  >
                    {/* Tekst korisnika ide kao TEKST, nikad kao HTML. */}
                    <td className="py-2.5 pl-4 text-[13px] text-fg">{r.message}</td>
                    <td className="num py-2.5 text-[13px] text-fg">{r.count}</td>
                    <td className="num py-2.5 text-[12px] text-fg-muted">{r.route ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-[12px] text-fg-muted">
                      {formatDatumKratko(r.poslednji_put)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-fg-muted">
        Grupisano po tekstu, bez razlike u velikim slovima i razmacima. Isti zahtev napisan
        triput je jedan red sa brojem <span className="num">3</span>.
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
