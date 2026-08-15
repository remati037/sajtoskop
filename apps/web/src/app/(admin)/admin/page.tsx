// apps/web/src/app/(admin)/admin/page.tsx
// Pregled sistema (F12 §3.4).
//
// Šest kartica, sve iz baze, jedan poziv `admin_overview` i nijedan spoljni
// servis. Ovaj ekran postoji da bih za pet sekundi znao da li nešto gori — zato
// je i jedini na kom sme da se pojavi crvena boja, i to za tačno dve stvari:
// budžet preko 80 % i posao koji čeka duže od 30 minuta.
//
// Sve ostalo je namerno neutralno. Kartica koja je stalno narandžasta zato što
// „ima 3 otvorena buga" je kartica koja se za nedelju dana ne vidi.

import type { Metadata } from "next";
import Link from "next/link";
import {
  Coins,
  Database,
  Gauge,
  ListChecks,
  MessageSquareHeart,
  Users,
} from "lucide-react";
import { RAZLOG_KREDITA } from "@/lib/ui-tekst";
import { requireAdminPage } from "@/lib/admin";
import {
  budzetKriticno,
  citajPregled,
  poslovKriticno,
  PRAG_CEKANJA_SEC,
  trajanje,
  udeoBudzeta,
} from "@/lib/admin-pregled";
import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/alert";
import { ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pregled" };

/** Ispod ovoliko odgovora medijana cene nije dokaz nego signal (F11). */
const UZORAK_ZA_MEDIJANU = 12;

export default async function Page() {
  // Prva linija svake strane pod `/admin` (pravilo 13). Layout se ne računa.
  await requireAdminPage();

  const p = await citajPregled();

  const budzetCrven = budzetKriticno(p.budzet);
  const posloviCrveni = poslovKriticno(p.poslovi);
  const procenatBudzeta = Math.round(udeoBudzeta(p.budzet) * 100);

  const rsd = new Intl.NumberFormat("sr-Latn-RS");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Pregled"
        opis="Stanje sistema iz baze, bez ijednog spoljnog poziva. Crveno je samo budžet preko 80 % i posao koji čeka duže od pola sata."
      />

      {budzetCrven && (
        <Alert variant="danger" className="mb-5">
          {p.budzet.iscrpljen
            ? "Google je danas vratio 429 — dnevna kvota je iscrpljena i skeniranja stoje do sutra u 9 ujutru."
            : `Places budžet je na ${procenatBudzeta} %. Svaki sledeći poziv ide iz mog džepa.`}
        </Alert>
      )}

      {posloviCrveni && (
        <Alert variant="danger" className="mb-5">
          Najstariji posao na čekanju stoji {trajanje(p.poslovi.najstariji_sec)}. Worker verovatno
          ne radi — proveri Hetzner pre nego što bilo šta drugo gledaš.
        </Alert>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* ── 1. PLACES BUDŽET ────────────────────────────────── */}
        <Kartica
          naslov="Places budžet"
          ikona={<Gauge />}
          vrednost={`${p.budzet.dan_poziva} / ${p.budzet.dan_cap}`}
          podnaslov={`danas · ${p.budzet.dan}`}
          traka={[p.budzet.dan_poziva, p.budzet.dan_cap]}
          crveno={budzetCrven}
        >
          <Red
            naziv="Mesec"
            vrednost={`${p.budzet.mesec_poziva} / ${p.budzet.mesec_cap}`}
            napomena={`${p.budzet.dana_do_kraja} ${p.budzet.dana_do_kraja === 1 ? "dan" : "dana"} do reseta`}
          />
          {Object.entries(p.budzet.po_vrsti).map(([vrsta, broj]) => (
            <Red key={vrsta} naziv={vrsta} vrednost={String(broj)} />
          ))}
          {p.budzet.iscrpljen && <Red naziv="Stanje" vrednost="iscrpljen (429)" />}
        </Kartica>

        {/* ── 2. RED POSLOVA ──────────────────────────────────── */}
        <Kartica
          naslov="Red poslova"
          ikona={<ListChecks />}
          vrednost={String(p.poslovi.na_cekanju)}
          podnaslov="na čekanju"
          crveno={posloviCrveni}
        >
          <Red naziv="U radu" vrednost={String(p.poslovi.u_radu)} />
          <Red naziv="Palo za 24 h" vrednost={String(p.poslovi.palo_24h)} />
          <Red
            naziv="Najstariji čeka"
            vrednost={p.poslovi.najstariji_sec > 0 ? trajanje(p.poslovi.najstariji_sec) : "—"}
            napomena={
              p.poslovi.najstariji_sec > 0
                ? `prag je ${trajanje(PRAG_CEKANJA_SEC)}`
                : "nijedan ne čeka"
            }
          />
          {/* Namerno odloženi poslovi nisu zaglavljeni poslovi, pa ne pale
              crveno — ali se broje, da razlika ne bi izgledala kao greška. */}
          {p.poslovi.odlozeno > 0 && (
            <Red naziv="Odloženo za kasnije" vrednost={String(p.poslovi.odlozeno)} />
          )}
        </Kartica>

        {/* ── 3. KORISNICI ────────────────────────────────────── */}
        <Kartica
          naslov="Korisnici"
          ikona={<Users />}
          vrednost={String(p.korisnici.ukupno)}
          podnaslov={`${p.korisnici.aktivni_7d} aktivnih 7 dana`}
        >
          <Red naziv="Novi 7 dana" vrednost={String(p.korisnici.novi_7d)} />
          <Red naziv="Aktivni 30 dana" vrednost={String(p.korisnici.aktivni_30d)} />
          <Red
            naziv="Nijednom viđen"
            vrednost={String(p.korisnici.nikad)}
            napomena="od uvođenja kolone"
          />
          <Red naziv="Admina" vrednost={String(p.korisnici.admina)} />
        </Kartica>

        {/* ── 4. KREDITI ──────────────────────────────────────── */}
        <Kartica
          naslov="Krediti (30 dana)"
          ikona={<Coins />}
          vrednost={`+${p.krediti.dodeljeno}`}
          podnaslov={`dodeljeno · ${p.krediti.potroseno} potrošeno`}
        >
          {Object.entries(p.krediti.po_razlogu).length === 0 ? (
            <Red naziv="Knjiga" vrednost="prazna" />
          ) : (
            Object.entries(p.krediti.po_razlogu).map(([razlog, zbir]) => (
              <Red
                key={razlog}
                naziv={RAZLOG_KREDITA[razlog as keyof typeof RAZLOG_KREDITA] ?? razlog}
                vrednost={zbir > 0 ? `+${zbir}` : String(zbir)}
              />
            ))
          )}
        </Kartica>

        {/* ── 5. UTISCI ───────────────────────────────────────── */}
        <Kartica
          naslov="Utisci"
          ikona={<MessageSquareHeart />}
          vrednost={String(p.utisci.otvoreni_bugovi)}
          podnaslov="otvorenih bugova"
        >
          <Red naziv="Ukupno" vrednost={String(p.utisci.ukupno)} />
          <Red naziv="Novih 7 dana" vrednost={String(p.utisci.novih_7d)} />
          <Red
            naziv="Odgovorenost"
            vrednost={
              p.utisci.pitanja.prikazano > 0
                ? `${Math.round((p.utisci.pitanja.odgovoreno / p.utisci.pitanja.prikazano) * 100)} %`
                : "—"
            }
            napomena={`${p.utisci.pitanja.odgovoreno} od ${p.utisci.pitanja.prikazano} pitanja`}
          />
          <Red
            naziv="Medijana cene"
            vrednost={p.medijana === null ? "—" : `${rsd.format(p.medijana)} RSD`}
            napomena={
              p.medijana === null
                ? "nijedan odgovor"
                : p.medijanaUzorak < UZORAK_ZA_MEDIJANU
                  ? `iz ${p.medijanaUzorak} — signal, ne dokaz`
                  : `iz ${p.medijanaUzorak} odgovora`
            }
          />
        </Kartica>

        {/* ── 6. BAZA ─────────────────────────────────────────── */}
        <Kartica
          naslov="Baza"
          ikona={<Database />}
          vrednost={String(p.baza.biznisa)}
          podnaslov="prospekata"
        >
          <Red naziv="Audita" vrednost={String(p.baza.audita)} />
          <Red naziv="Otključavanja" vrednost={String(p.baza.otkljucano)} />
          <Red
            naziv="Udeo keša"
            vrednost={
              p.baza.pretraga > 0
                ? `${Math.round((p.baza.iz_kesa / p.baza.pretraga) * 100)} %`
                : "—"
            }
            napomena={`${p.baza.iz_kesa} od ${p.baza.pretraga} pretraga`}
          />
          {/* Pravilo 1: Google podatak stariji od 30 dana se ne servira. Ovo je
              ta brojka — koliko redova čeka refresh pre nego što opet sme napolje. */}
          <Red
            naziv="Google stariji od 30d"
            vrednost={String(p.baza.stari_google)}
            napomena={p.baza.stari_google > 0 ? "traže refresh pre serviranja" : "nema takvih"}
          />
        </Kartica>
      </dl>

      <p className="mt-6 text-xs text-fg-muted">
        Brojke su iz baze u trenutku učitavanja. Ekran je dinamičan i ne kešira se — osveži da
        bi se pomerio.{" "}
        <Link href="/admin/korisnici" className="underline underline-offset-4 hover:text-fg">
          Korisnici
        </Link>{" "}
        i{" "}
        <Link href="/admin/revizija" className="underline underline-offset-4 hover:text-fg">
          revizija
        </Link>{" "}
        imaju detalje iza ovih brojeva.
      </p>
    </div>
  );
}

// ── sitni delovi ─────────────────────────────────────────────
// Kartica je jedna površina sa jednom senkom; podela unutra ide hairline linijom,
// nikad ugnježđenom karticom (§7.2).

function Kartica({
  naslov,
  ikona,
  vrednost,
  podnaslov,
  traka,
  crveno,
  children,
}: {
  naslov: string;
  ikona: React.ReactNode;
  vrednost: string;
  podnaslov: string;
  /** `[iskorišćeno, granica]` — traka napunjenosti, samo gde granica postoji. */
  traka?: [number, number];
  crveno?: boolean;
  children: React.ReactNode;
}) {
  const procenat =
    traka && traka[1] > 0 ? Math.min(100, Math.max(0, Math.round((traka[0] / traka[1]) * 100))) : null;

  return (
    <div
      className={cn(
        "rounded-xl border bg-bg-elev p-4 shadow-sm",
        crveno ? "border-danger/30" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
          {naslov}
        </dt>
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg [&_svg]:h-3.5 [&_svg]:w-3.5",
            crveno ? "bg-danger-wash text-danger" : "bg-accent-wash text-accent-text",
          )}
        >
          {ikona}
        </span>
      </div>

      <dd className={cn("mt-2 num text-2xl font-semibold tracking-tight", crveno && "text-danger")}>
        {vrednost}
      </dd>
      <dd className="mt-0.5 text-xs text-fg-muted">{podnaslov}</dd>

      {procenat !== null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-bg-inset">
          <div
            className={cn("h-full rounded-full", crveno ? "bg-danger" : "bg-accent")}
            style={{ width: `${procenat}%` }}
          />
        </div>
      )}

      <div className="mt-4 divide-y divide-border border-t border-border">{children}</div>
    </div>
  );
}

function Red({
  naziv,
  vrednost,
  napomena,
}: {
  naziv: string;
  vrednost: string;
  napomena?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
      <span className="min-w-0 shrink-0 truncate text-fg-muted">{naziv}</span>
      <span className="min-w-0 text-right">
        <span className="block truncate num text-fg">{vrednost}</span>
        {napomena && <span className="block truncate text-[11px] text-fg-faint">{napomena}</span>}
      </span>
    </div>
  );
}
