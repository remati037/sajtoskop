// apps/web/src/app/(admin)/admin/korisnici/[id]/page.tsx
// Detalj korisnika (F12 §3.2, prošireno u S20) — pet blokova i kolona sa
// radnjama.
//
// Čitanje je u `lib/admin-korisnici.ts`, izmene u `lib/admin-radnje.ts` i u
// rutama pod `/api/admin`. Ova strana ne menja ništa sama; ona samo prikazuje i
// prosleđuje ono što klijentska kolona sme da ponudi.
//
// `refId` se generiše OVDE, pri renderu — dakle pri otvaranju forme, kako F12 §2
// i traži. Da se generiše pri slanju, dvostruki klik na „Dodaj 30 kredita" bi
// bio dve različite radnje i dodelio 60.
//
// Nepostojeći ID daje `404`, isto kao i sve ostalo pod `/admin` — postojanje
// naloga nije informacija koja se odaje ni greškom u kucanju.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Infinity as Beskonacno, ShieldCheck } from "lucide-react";
import { CITIES, GRACE_DAYS, NICHES, planFor } from "@sajtoskop/shared";
import { requireAdminPage } from "@/lib/admin";
import { citajKorisnika } from "@/lib/admin-korisnici";
import { brojAdmina } from "@/lib/admin-radnje";
import { noviRefId } from "@/lib/admin-radnje-schema";
import { KOLONA_LABEL } from "@/lib/pipeline-tipovi";
import {
  formatDatum,
  formatDatumKratko,
  RAZLOG_KREDITA,
  STANJE_PRISTUPA,
  vremeUnazad,
} from "@/lib/ui-tekst";
import { cn } from "@/lib/cn";
import { RadnjeNadKorisnikom } from "@/components/admin-radnje";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { NaslovSekcije, ZaglavljeStranice } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Korisnik" };

const GRAD = new Map(CITIES.map((c) => [c.slug, c.label]));
const NISA = new Map(NICHES.map((n) => [n.slug, n.label]));

const STATUS_POSLA: Record<string, "neutral" | "info" | "success" | "danger"> = {
  pending: "neutral",
  running: "info",
  done: "success",
  failed: "danger",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  // Prva linija svake strane pod `/admin` (pravilo 13). Layout se ne računa.
  const actor = await requireAdminPage();

  const { id } = await params;
  const detalj = await citajKorisnika(decodeURIComponent(id));
  if (!detalj) notFound();

  const { profil, clerk, pristup } = detalj;
  const plan = planFor(profil.plan);
  const jaSam = actor === profil.id;

  // Broj admina odlučuje samo hoće li dugme „Skini ulogu" biti ponuđeno. Brava
  // je u ruti, koja broji ponovo — ovo je poruka, ne zaštita.
  const admina = await brojAdmina();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/admin/korisnici"
        className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Svi korisnici
      </Link>

      <ZaglavljeStranice naslov={profil.email ?? "Bez mejla"}>
        {(profil.role === "admin" || detalj.bootstrap) && (
          <Badge variant="primary">
            <ShieldCheck />
            ADMIN
          </Badge>
        )}
        {clerk?.blokiran && <Badge variant="danger">BLOKIRAN</Badge>}
        {clerk?.zakljucan && <Badge variant="warning">ZAKLJUČAN</Badge>}
      </ZaglavljeStranice>

      {detalj.clerkGreska && (
        <Alert variant="warning" className="mb-5">
          {detalj.clerkGreska}
        </Alert>
      )}

      {/* F12 §6: brisanje je prošlo u Clerku, a webhook nije stigao — ili ga u
          trenutku brisanja još nije ni bilo (dodat je tek u F12.2). Profil tada
          ostaje zauvek i isti mejl ume da se pojavi dvaput u listi. Jedini izlaz
          je brisanje iz opasne zone, koje u ovom slučaju poredi potvrdu sa
          `profiles.email` i briše red direktno. */}
      {detalj.uClerku === false && (
        <Alert variant="warning" className="mb-5">
          Ovaj profil postoji u bazi, ali tog naloga u Clerku više nema. Najverovatnije je
          obrisan iz Clerk konzole pre nego što je webhook <span className="num">user.deleted</span>{" "}
          postojao. Brisanje iz opasne zone uklanja profil i sve njegove redove.
        </Alert>
      )}

      {detalj.bootstrap && profil.role !== "admin" && (
        <Alert variant="info" className="mb-5">
          {jaSam ? (
            <>
              Ti si admin kroz <span className="num">ADMIN_BOOTSTRAP_IDS</span>, a uloga u bazi ti
              je i dalje <span className="num">user</span> — zato te filter „Admini" hvata iz
              env-a, a ne iz kolone. Sebi ulogu ne možeš da dodeliš (jedno pravilo za obe strane,
              §1); ako želiš da stoji i u bazi, neka ti je dodeli drugi admin. Prava se time ne
              menjaju, samo prestaju da zavise od env-a.
            </>
          ) : (
            <>
              Admin je kroz <span className="num">ADMIN_BOOTSTRAP_IDS</span>, a uloga u bazi mu je
              i dalje <span className="num">user</span>. Skidanje uloge odavde mu prava ne bi
              oduzelo — env je iznad baze. Ako želiš da uloga stoji i u bazi, dodeli je dugmetom
              u koloni desno.
            </>
          )}
        </Alert>
      )}

      {/* Radnje su svoja kolona, ne traka iznad blokova: izmena se skoro uvek
          donosi gledajući knjigu kredita ili istoriju pretraga, pa jedno ne sme
          da gura drugo van ekrana. Na telefonu se kolona prelije ispod. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {/* ── 1. NALOG ─────────────────────────────────────── */}
          <Blok naslov="Nalog">
            <dl className="divide-y divide-border">
              <Red naziv="Mejl" vrednost={profil.email ?? "—"} mono />
              <Red naziv="Ime" vrednost={clerk?.ime ?? "—"} />
              <Red naziv="Clerk ID" vrednost={profil.id} mono />
              <Red naziv="Plan" vrednost={profil.plan} />
              <Red naziv="Uloga" vrednost={profil.role === "admin" ? "Admin" : "Korisnik"} />
              <Red naziv="Registrovan" vrednost={formatDatum(profil.created_at)} />
              <Red
                naziv="Poslednji put"
                vrednost={vremeUnazad(profil.last_seen_at)}
                napomena={profil.last_seen_at ? formatDatum(profil.last_seen_at) : undefined}
              />
              <Red
                naziv="Poslednja prijava"
                vrednost={clerk ? vremeUnazad(clerk.poslednjaPrijava) : "—"}
              />
              <Red
                naziv="Status"
                vrednost={
                  !clerk ? "—" : clerk.blokiran ? "Blokiran" : clerk.zakljucan ? "Zaključan" : "Aktivan"
                }
              />
            </dl>
          </Blok>

          {/* ── 2. PRISTUP ───────────────────────────────────── */}
          {/* Sve ispod je IZVEDENO iz dva ulaza (`beta_expires_at` i
              `plan_expires_at`) — `stanjePristupa()` ih sabira, ova strana ih
              samo ispisuje. Treći skladišteni datum bi se razišao sa prva dva
              čim se pomeri rok bete (LANSIRANJE §1.5). */}
          <Blok naslov="Pristup">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={STANJE_PRISTUPA[pristup.stanje].variant}>
                {STANJE_PRISTUPA[pristup.stanje].label}
              </Badge>
              {pristup.stanje === "beta" && pristup.punDo === null && (
                <Badge variant="warning" title="Beta bez roka — traje dok je neko ne ugasi rukom.">
                  <Beskonacno />
                  NEOGRANIČENO
                </Badge>
              )}
            </div>

            <p className="mb-3 text-[13px] leading-relaxed text-fg-muted">
              {STANJE_PRISTUPA[pristup.stanje].opis}
            </p>

            <dl className="divide-y divide-border">
              <Red naziv="Rok bete" vrednost={rokTekst(profil.beta_expires_at, profil.plan)} mono />
              <Red
                naziv="Rok pretplate"
                vrednost={profil.plan_expires_at ? formatDatum(profil.plan_expires_at) : "—"}
                napomena={detalj.pretplata ? `Paddle: ${detalj.pretplata.status}` : "nema pretplate"}
                mono
              />
              <Red
                naziv="Pun pristup do"
                vrednost={pristup.punDo ? formatDatum(pristup.punDo) : "—"}
                napomena="max(rok bete, rok pretplate)"
                mono
              />
              <Red
                naziv="Čitanje do"
                vrednost={pristup.citanjeDo ? formatDatum(pristup.citanjeDo) : "—"}
                napomena={`pun pristup + ${GRACE_DAYS} dana grace-a`}
                mono
              />
              {detalj.pretplata?.canceledAt && (
                <Red
                  naziv="Otkazana"
                  vrednost={formatDatum(detalj.pretplata.canceledAt)}
                  napomena="pristup i dalje traje do kraja plaćenog perioda"
                  mono
                />
              )}
            </dl>
          </Blok>

          {/* ── 3. KREDITI ───────────────────────────────────── */}
          <Blok naslov="Krediti">
            <dl className="divide-y divide-border">
              {/* Dve kase, odvojeno i uvek (§1.4). Zbir je ono što korisnik
                  troši, ali samo razdvojen prikaz objašnjava zašto mu se jedan
                  deo balansa resetuje mesečno a drugi nikad. */}
              <Red
                naziv="Ukupno"
                vrednost={String(profil.credits_balance + profil.credits_topup)}
                napomena="zbir obe kase — toliko stvarno sme da potroši"
                mono
              />
              <Red
                naziv="Iz pretplate"
                vrednost={`${profil.credits_balance} / ${plan.monthlyCredits}`}
                napomena="ističe — mesečna dodela postavlja, bez rollovera"
                mono
              />
              <Red
                naziv="Dokupljeni"
                vrednost={String(profil.credits_topup)}
                napomena="ne ističu — paketi iz §1.4"
                mono
              />
              <Red
                naziv="Nova skeniranja danas"
                vrednost={`${profil.cache_miss_count} / ${plan.cacheMissPerDay}`}
                napomena={profil.cache_miss_day ?? "još nijedno"}
                mono
              />
              <Red
                naziv="Izvezeno danas"
                vrednost={`${profil.export_count} / ${plan.exportPerDay}`}
                mono
              />
            </dl>

            <NaslovSekcije className="mt-5">Izvod iz knjige</NaslovSekcije>
            {detalj.ledger.length === 0 ? (
              <Prazno>Knjiga je prazna.</Prazno>
            ) : (
              <ul className="mt-2 max-h-80 divide-y divide-border overflow-y-auto text-[13px]">
                {detalj.ledger.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="text-fg">{RAZLOG_KREDITA[s.reason]}</span>
                      <span className="ml-2 num text-[11px] text-fg-faint">
                        {formatDatumKratko(s.created_at)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 num font-semibold",
                        s.delta > 0 ? "text-accent-text" : s.delta < 0 ? "text-fg" : "text-fg-muted",
                      )}
                    >
                      {s.delta > 0 ? `+${s.delta}` : s.delta}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-fg-faint">Poslednjih 50 stavki.</p>
          </Blok>

          {/* ── 4. AKTIVNOST ─────────────────────────────────── */}
          <Blok naslov="Aktivnost">
            <NaslovSekcije>Pipeline</NaslovSekcije>
            {detalj.pipeline.length === 0 ? (
              <Prazno>Nijedan lead nije ušao u pipeline.</Prazno>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {detalj.pipeline.map((k) => (
                  <li key={k.status}>
                    <Badge variant="outline">
                      {KOLONA_LABEL[k.status]} <span className="num">{k.broj}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}

            <NaslovSekcije className="mt-5">Otključani</NaslovSekcije>
            {detalj.otkljucani.length === 0 ? (
              <Prazno>Nijedan otključan prospekt.</Prazno>
            ) : (
              <ul className="mt-2 divide-y divide-border text-[13px]">
                {detalj.otkljucani.map((u) => (
                  <li key={u.place_id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-fg">
                      {u.naziv ?? <span className="num text-fg-muted">{u.place_id}</span>}
                    </span>
                    <span className="shrink-0 num text-[11px] text-fg-faint">
                      {formatDatumKratko(u.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <NaslovSekcije className="mt-5">Pretrage</NaslovSekcije>
            {detalj.pretrage.length === 0 ? (
              <Prazno>Nijedna pretraga.</Prazno>
            ) : (
              <ul className="mt-2 divide-y divide-border text-[13px]">
                {detalj.pretrage.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-fg">
                      {GRAD.get(s.city_slug) ?? s.city_slug}
                      {s.niche_slug && ` · ${NISA.get(s.niche_slug) ?? s.niche_slug}`}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {/* Keš je besplatan, `api` je plaćeno skeniranje (F9). Ova
                          razlika je jedini razlog zbog kog istorija pretraga uopšte
                          stoji u konzoli. */}
                      <Badge variant={s.source === "api" ? "warning" : "neutral"} size="sm">
                        {s.source === "api" ? "SKEN" : "KEŠ"}
                      </Badge>
                      <span className="num text-[11px] text-fg-faint">
                        {formatDatumKratko(s.created_at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <NaslovSekcije className="mt-5">Poslovi u redu</NaslovSekcije>
            {detalj.poslovi.length === 0 ? (
              <Prazno>Nijedan posao.</Prazno>
            ) : (
              <ul className="mt-2 divide-y divide-border text-[13px]">
                {detalj.poslovi.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      <span className="num text-fg-muted">#{p.id}</span>{" "}
                      <span className="text-fg">{p.type}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant={STATUS_POSLA[p.status] ?? "neutral"} size="sm">
                        {p.status}
                      </Badge>
                      <span className="num text-[11px] text-fg-faint">
                        {formatDatumKratko(p.created_at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Blok>

          {/* ── 5. UTISCI ────────────────────────────────────── */}
          <Blok naslov="Utisci">
            {detalj.utisci.length === 0 ? (
              <Prazno>Nijedan utisak.</Prazno>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {detalj.utisci.map((u) => (
                  <li key={u.id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge variant="outline" size="sm">
                          {u.status}
                        </Badge>
                        {u.kind && (
                          <span className="truncate text-[11px] text-fg-muted">{u.kind}</span>
                        )}
                        {u.prompt_key && (
                          <span className="truncate num text-[11px] text-fg-faint">
                            {u.prompt_key}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 num text-[11px] text-fg-faint">
                        {formatDatumKratko(u.created_at)}
                      </span>
                    </div>
                    {u.message && (
                      <p className="mt-1 line-clamp-2 text-fg-muted">{u.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-fg-faint">
              Poslednjih 20. Obrada prijava (status, oznake, beleška) dolazi sa ekranom
              <span className="num"> /admin/utisci</span>.
            </p>
          </Blok>
        </div>

        {/* ── RADNJE ───────────────────────────────────────── */}
        {/* `betaRefId` je ZASEBAN ključ, ne isti kao `refId`: dva obrasca su
            dve radnje i dve idempotencije, pa slanje jednog ne sme da „potroši"
            ključ drugog. */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <RadnjeNadKorisnikom
            id={profil.id}
            email={profil.email}
            plan={profil.plan}
            role={profil.role}
            cacheMissCount={profil.cache_miss_count}
            cacheMissLimit={plan.cacheMissPerDay}
            refId={noviRefId()}
            betaRefId={noviRefId()}
            betaDo={profil.beta_expires_at}
            jeBeta={profil.plan === "beta"}
            jaSam={jaSam}
            blokiran={clerk ? clerk.blokiran : null}
            poslednjiAdmin={profil.role === "admin" && admina <= 1}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Rok bete, sa jedinom zamkom iz §1.5 ispisanom, a ne prećutanom.
 *
 * `null` znači dve različite stvari: uz plan `beta` je NEOGRANIČENO, uz svaki
 * drugi plan je „bete nema". Ista prazna kolona, dva suprotna značenja — pa
 * ekran sa kog se beta dodeljuje mora da kaže koje je u pitanju.
 */
function rokTekst(rok: string | null, plan: string): string {
  if (rok) return formatDatum(rok);
  return plan === "beta" ? "neograničeno" : "—";
}

// ── sitni delovi ─────────────────────────────────────────────
// Bez ugnježđenih kartica (§7.2): blok je jedna površina, a podela unutar njega
// ide hairline linijom.

function Blok({ naslov, children }: { naslov: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-bg-elev p-5 shadow-sm">
      <h2 className="mb-3 text-[15px] font-semibold tracking-tight">{naslov}</h2>
      {children}
    </section>
  );
}

function Red({
  naziv,
  vrednost,
  napomena,
  mono,
}: {
  naziv: string;
  vrednost: string;
  napomena?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
      <dt className="shrink-0 text-fg-muted">{naziv}</dt>
      <dd className="min-w-0 text-right">
        <span className={cn("block truncate text-fg", mono && "num")}>{vrednost}</span>
        {napomena && <span className="block truncate text-[11px] text-fg-faint">{napomena}</span>}
      </dd>
    </div>
  );
}

function Prazno({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[13px] text-fg-muted">{children}</p>;
}
