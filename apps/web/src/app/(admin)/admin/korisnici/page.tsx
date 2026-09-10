// apps/web/src/app/(admin)/admin/korisnici/page.tsx
// Lista korisnika (F12 §3.1).
//
// Jedan upit u bazu (`admin_users_page`) i jedan poziv Clerku za celu stranicu.
// Filteri, sortiranje i strana žive u adresi, pa filtrira baza — v.
// `admin-filteri.tsx`.
//
// Radnji nad pojedinačnim nalogom ovde nema — sve što menja stanje je u detalju.
// U zaglavlju stoje samo dve koje se tiču cele liste: pozivanje i izvoz.

import type { Metadata } from "next";
import Link from "next/link";
import { PLANS, type StanjeId } from "@sajtoskop/shared";
import { requireAdminPage } from "@/lib/admin";
import {
  citajKorisnike,
  type FilterKorisnika,
  type RedKorisnika,
  type SortKorisnika,
  type Smer,
} from "@/lib/admin-korisnici";
import { formatDatum, STANJE_PRISTUPA, vremeUnazad } from "@/lib/ui-tekst";
import { cn } from "@/lib/cn";
import {
  PadajuciFilter,
  Paginacija,
  PoljePretrage,
  SortKolona,
  TrakaFiltera,
} from "@/components/admin-filteri";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PraznoStanje, ZaglavljeStranice } from "@/components/ui/stranica";
import { Download, MailPlus, MessageSquareHeart, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Korisnici" };

const FILTERI: { vrednost: FilterKorisnika; label: string }[] = [
  { vrednost: "svi", label: "Svi" },
  { vrednost: "aktivni7", label: "Aktivni 7d" },
  { vrednost: "admini", label: "Admini" },
  { vrednost: "bez_aktivnosti", label: "Bez aktivnosti" },
];

const SORTOVI: SortKorisnika[] = ["created_at", "credits", "unlocks", "last_seen"];

/**
 * Sedam stanja pristupa kao filter (S20/S25, LANSIRANJE §1.5, naplata-stripe.md §7).
 *
 * Redosled nije abecedni nego onaj kojim se pitanja stvarno postavljaju: prvo
 * „ko je komp" (jer njima ja postavljam rok), pa ko je u probi, pa ko plaća, pa
 * ko je na izlazu.
 */
const STANJA: StanjeId[] = ["komp", "proba", "aktivan", "otkazan", "dopuna", "grace", "zakljucan"];

/** Nepoznata vrednost iz adrese pada na podrazumevanu, nikad ne ruši stranu. */
function jedan<T extends string>(vrednost: string | undefined, dozvoljene: readonly T[], podrazumevana: T): T {
  return dozvoljene.includes((vrednost ?? "") as T) ? ((vrednost ?? "") as T) : podrazumevana;
}

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

  const upit = {
    q: tekst(sp.q).slice(0, 120),
    filter: jedan<FilterKorisnika>(
      tekst(sp.filter),
      FILTERI.map((f) => f.vrednost),
      "svi",
    ),
    plan: jedan<string>(tekst(sp.plan), ["", ...Object.keys(PLANS)], ""),
    stanje: jedan<StanjeId | "">(tekst(sp.stanje), ["", ...STANJA], ""),
    sort: jedan<SortKorisnika>(tekst(sp.sort), SORTOVI, "created_at"),
    smer: jedan<Smer>(tekst(sp.smer), ["asc", "desc"], "desc"),
    strana: Math.max(1, Number.parseInt(tekst(sp.strana), 10) || 1),
  };

  const lista = await citajKorisnike(upit);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Korisnici"
        opis="Ko je u beti, koliko je potrošio i kad je poslednji put bio. Radnje nad nalogom su u detalju."
      >
        {/* Izvoz je običan link, da bi radio kao preuzimanje fajla — ali je i
            mutacija u smislu pravila 14: PII izlazi iz sistema, pa ruta upisuje
            red u reviziju sa brojem redova (F12 §5). */}
        <Button asChild variant="outline" size="sm">
          <a href="/api/admin/izvoz?sta=korisnici" download>
            <Download />
            Izvezi CSV
          </a>
        </Button>
        <Button asChild variant="primary" size="sm">
          <Link href="/admin/pozivnice">
            <MailPlus />
            Pozovi
          </Link>
        </Button>
      </ZaglavljeStranice>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PoljePretrage naziv="Pretraga po mejlu" placeholder="mejl…" />
        <TrakaFiltera kljuc="filter" opcije={FILTERI} podrazumevano="svi" />
        <PadajuciFilter
          kljuc="stanje"
          naziv="Filter po stanju pristupa"
          svePrazno="Svako stanje"
          opcije={STANJA.map((s) => ({ vrednost: s, label: STANJE_PRISTUPA[s].label }))}
        />
      </div>

      {lista.clerkGreska && (
        <Alert variant="warning" className="mb-4">
          {lista.clerkGreska}
        </Alert>
      )}

      {lista.redovi.length === 0 ? (
        <PraznoStanje
          ikona={<Users />}
          naslov="Nijedan korisnik ne odgovara filteru."
          opis="Probaj bez filtera ili sa kraćim delom mejla."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-sm">
            <div className="scroll-x">
              <table className="w-full min-w-[54rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-subtle/70 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                    <th className="py-2.5 pl-4 font-medium">Mejl</th>
                    <th className="py-2.5 font-medium">Plan</th>
                    <th
                      className="py-2.5 font-medium"
                      title="Stanje pristupa — isto ono što kapija zaključuje (LANSIRANJE §1.5)"
                    >
                      Stanje
                    </th>
                    <th className="py-2.5 text-right font-medium">
                      <SortKolona kljuc="credits" label="Krediti" />
                    </th>
                    <th className="py-2.5 text-right font-medium" title="Otključanih prospekata">
                      <SortKolona kljuc="unlocks" label="Otklj." />
                    </th>
                    <th
                      className="py-2.5 text-right font-medium"
                      title="Pretraga — i besplatnih iz keša i plaćenih skeniranja"
                    >
                      Pretrage
                    </th>
                    {/* „Utisci" je jedini stubac koji ne meri potrošnju nego to
                        da li se čovek uopšte javlja. Zato je i prikazan
                        drugačije — bedž umesto gologa broja, i crtica kad ga
                        nema, da nule ne prave šum kroz celu tabelu. */}
                    <th
                      className="py-2.5 text-center font-medium"
                      title="Poslatih utisaka i odgovora na pitanja"
                    >
                      Javio se
                    </th>
                    <th className="py-2.5 pr-4 font-medium">
                      <SortKolona kljuc="last_seen" label="Poslednji put" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lista.redovi.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/70 transition-colors last:border-0 hover:bg-bg-subtle/60"
                    >
                      <td className="py-2.5 pl-4">
                        <Link
                          href={`/admin/korisnici/${encodeURIComponent(r.id)}`}
                          className="group flex min-w-0 items-center gap-2"
                        >
                          <span className="min-w-0">
                            <span className="block max-w-[16rem] truncate num text-[13px] text-fg group-hover:underline group-hover:underline-offset-4">
                              {r.email ?? "—"}
                            </span>
                            {r.clerk?.ime && (
                              <span className="block max-w-[16rem] truncate text-[11px] text-fg-muted">
                                {r.clerk.ime}
                              </span>
                            )}
                          </span>
                          {(r.role === "admin" || r.bootstrap) && (
                            <Badge
                              variant="primary"
                              size="sm"
                              title={
                                r.role === "admin"
                                  ? "Uloga u bazi"
                                  : "Admin iz ADMIN_BOOTSTRAP_IDS — uloga u bazi je i dalje `user`, pa se odavde ne može skinuti"
                              }
                            >
                              ADMIN
                            </Badge>
                          )}
                          {r.clerk?.blokiran && (
                            <Badge variant="danger" size="sm">
                              BLOKIRAN
                            </Badge>
                          )}
                          {/* F12 §6: profil koji je nadživeo svog Clerk
                              korisnika. Do F12.2 webhook `user.deleted` nije
                              postojao, pa je brisanje iz Clerk konzole
                              ostavljalo red zauvek — i isti mejl ume da se
                              pojavi dvaput. */}
                          {r.uClerku === false && (
                            <Badge
                              variant="warning"
                              size="sm"
                              title="Profil postoji u bazi, ali tog naloga u Clerku više nema. Otvori detalj da ga obrišeš."
                            >
                              NEMA U CLERKU
                            </Badge>
                          )}
                        </Link>
                      </td>
                      <td className="py-2.5 text-fg-muted">{r.plan}</td>
                      <td className="py-2.5">
                        <StanjeBedz pristup={r.pristup} />
                      </td>
                      {/* Prikazano stanje kredita je ZBIR obe kase (§1.4); iz
                          paketa u zagradi, jer to je deo koji NE ističe i jedini
                          razlog zbog kog nalog bez pretplate i dalje radi. */}
                      <td className="py-2.5 text-right num">
                        {r.credits_balance + r.credits_topup}
                        {r.credits_topup > 0 && (
                          <span
                            className="ml-1 text-[11px] text-fg-faint"
                            title="Od toga iz paketa — ne ističe"
                          >
                            (+{r.credits_topup})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right num">
                        <Broj vrednost={r.unlocks_count} />
                      </td>
                      <td className="py-2.5 text-right num">
                        <Broj vrednost={r.searches_count} />
                      </td>
                      <td className="py-2.5 text-center">
                        {r.feedback_count > 0 ? (
                          <Badge variant="primary" size="sm" title="Poslatih utisaka i odgovora">
                            <MessageSquareHeart />
                            <span className="num">{r.feedback_count}</span>
                          </Badge>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 pr-4 text-[13px]",
                          r.last_seen_at ? "text-fg-muted" : "text-fg-faint",
                        )}
                        title={r.last_seen_at ?? undefined}
                      >
                        {vremeUnazad(r.last_seen_at)}
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
            imenica="korisnika"
          />
        </>
      )}

      <p className="mt-6 max-w-2xl text-xs text-fg-muted">
        „Poslednji put" se upisuje najviše jednom na sat, iz okvira aplikacije. Korisnik koji
        piše „nikad" nije bio od uvođenja te kolone — ne znači da nalog ne radi. Bedž{" "}
        <span className="text-fg">ADMIN</span> nosi i onaj ko je admin samo kroz{" "}
        <span className="num">ADMIN_BOOTSTRAP_IDS</span>; njemu se uloga odavde ne može skinuti,
        jer je u bazi i nema.
      </p>
    </div>
  );
}

/**
 * Stanje pristupa u jednom bedžu, sa datumom u `title`-u.
 *
 * Datum ne ide u sam bedž: u koloni od šest različitih stanja bi svaki red bio
 * dva reda teksta, a pitanje koje se postavlja gledajući listu je „ko je u
 * kom stanju", ne „do kad tačno". Tačan datum stoji na detalju i u `title`-u.
 */
function StanjeBedz({ pristup }: { pristup: RedKorisnika["pristup"] }) {
  const opis = STANJE_PRISTUPA[pristup.stanje];

  const datum =
    pristup.stanje === "komp" && pristup.punDo === null
      ? "Bez roka — neograničeno."
      : pristup.stanje === "grace"
        ? `Čitanje do ${formatDatum(pristup.citanjeDo)}.`
        : pristup.punDo
          ? `Pun pristup do ${formatDatum(pristup.punDo)}.`
          : "";

  return (
    <Badge variant={opis.variant} size="sm" title={`${opis.opis}${datum ? ` ${datum}` : ""}`}>
      {opis.label}
    </Badge>
  );
}

/** Nula je šum, a ne podatak — tabela puna nula se ne čita. */
function Broj({ vrednost }: { vrednost: number }) {
  if (vrednost === 0) return <span className="text-fg-faint">—</span>;
  return <span className="text-fg-muted">{vrednost}</span>;
}
