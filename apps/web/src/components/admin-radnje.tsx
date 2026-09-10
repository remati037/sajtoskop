"use client";

// apps/web/src/components/admin-radnje.tsx
// Desna kolona detalja korisnika (F12 §3.2) — sve što konzola sme da promeni.
//
// Dve grupe, razdvojene linijom: obične radnje gore, opasne dole. Opasne traže
// TIPKANI mejl, i to je jedina prepreka koja stvarno radi — `confirm()` se
// klikne refleksno, a mejl mora da se pročita da bi se prekucao.
//
// Destruktivno dugme je ghost sa `--danger` tekstom, nikad crveni fill
// (dizajn sistem §7.1). Crveni pravougaonik vuče oko jače od radnje koja se
// zaista traži, a ovde se najčešće ne traži nijedna.
//
// ── šta ovde NIJE zaštita ────────────────────────────────────
// Sve što je ispod `disabled` i sve što je iza tipkanog mejla je udobnost.
// Prava brava je u ruti: „ne sebi", „poslednji admin ostaje" i poređenje mejla
// sa Clerkom rade se na serveru, a ovaj fajl samo ne nudi ono što bi ionako
// bilo odbijeno.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, MinusCircle, PlusCircle, RotateCcw, Send, ShieldCheck, ShieldOff, Sparkles, Trash2, UserX } from "lucide-react";
import type { AdminRole } from "@sajtoskop/shared";
import { KOMP_PREDLOG, PLAN_OPCIJE, type RadnjaOdgovor } from "@/lib/admin-radnje-schema";
import { cn } from "@/lib/cn";
import { formatDatum } from "@/lib/ui-tekst";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input, Label, Textarea } from "./ui/input";
import { NaslovSekcije } from "./ui/stranica";

type Poruka = { ok: boolean; tekst: string };

export type RadnjeProps = {
  id: string;
  email: string | null;
  plan: string;
  role: AdminRole;
  cacheMissCount: number;
  cacheMissLimit: number;
  /** Ključ idempotencije, generisan na SERVERU pri otvaranju ove strane. */
  refId: string;
  /** Isto, ali za komp obrazac — dve radnje, dva ključa. */
  kompRefId: string;
  /** `profiles.komp_expires_at`. `null` uz `jeKomp` znači NEOGRANIČENO (§1.5). */
  kompDo: string | null;
  /** Je li `profiles.plan` već `komp` — od toga zavisi tekst, ne dozvola. */
  jeKomp: boolean;
  /** Gleda li admin sopstveni nalog. Tada nema uloge, blokade ni brisanja. */
  jaSam: boolean;
  /** `null` znači da Clerk nije odgovorio — stanje se ne zna, pa se ne nudi. */
  blokiran: boolean | null;
  /** Skidanje uloge bi ostavilo konzolu bez ijednog admina. */
  poslednjiAdmin: boolean;
};

export function RadnjeNadKorisnikom(props: RadnjeProps) {
  const {
    id, email, plan, role, cacheMissCount, cacheMissLimit, refId, jaSam, blokiran,
    kompRefId, kompDo, jeKomp,
  } = props;

  const router = useRouter();
  const [ceka, prenesi] = useTransition();
  const [radi, setRadi] = useState<string | null>(null);
  const [poruke, setPoruke] = useState<Record<string, Poruka>>({});

  // Obrazac kredita
  const [iznos, setIznos] = useState("");
  const [napomena, setNapomena] = useState("");
  // Plan i uloga se drže lokalno samo dok se čeka odgovor; izvor istine je red u
  // bazi, koji `router.refresh()` vrati kroz `props`.
  const [noviPlan, setNoviPlan] = useState(plan);
  // Poruka korisniku
  const [naslovPoruke, setNaslovPoruke] = useState("");
  const [telo, setTelo] = useState("");
  // Komp: jedan obrazac za otvaranje naloga, jedan red za sam rok
  const [kompKredita, setKompKredita] = useState(String(KOMP_PREDLOG.krediti));
  // Prazan početak, pa popuna u `useEffect` — namerno.
  //
  // Podrazumevani datum je „danas + 30 dana", a „danas" na serveru (UTC na
  // Vercelu) i u pregledaču (Beograd) nije isti dan svake večeri. Da se računa
  // pri renderu, vrednost polja bi se razlikovala između servera i klijenta i
  // React bi prijavio neslaganje pri hidraciji — na obrascu koji dodeljuje
  // pristup, i to tačno u satima kad se najčešće radi.
  const [kompDatum, setKompDatum] = useState("");
  const [kompNeograniceno, setKompNeograniceno] = useState(false);
  const [kompProslostOk, setKompProslostOk] = useState(false);
  // Opasna zona
  const [potvrda, setPotvrda] = useState("");

  useEffect(() => {
    setKompDatum((v) => v || zaDana(KOMP_PREDLOG.dana));
  }, []);

  const mejl = (email ?? "").trim().toLowerCase();
  const potvrdjeno = mejl.length > 0 && potvrda.trim().toLowerCase() === mejl;
  const zauzeto = radi !== null || ceka;

  // ── komp: šta se stvarno šalje ────────────────────────────
  // `null` je NEOGRANIČENO (§1.5) i jedina vrednost koju server tumači.
  const kompRok = kompNeograniceno ? null : krajDana(kompDatum);
  const kompKreditaBroj = Number(kompKredita);
  const uProslosti = kompRok !== null && Date.parse(kompRok) <= Date.now();
  /** Dovoljno za „Samo rok": ispravan datum (ili neograničeno) i potvrda za prošlost. */
  const rokSpreman = (kompNeograniceno || kompRok !== null) && (!uProslosti || kompProslostOk);
  /** Otvaranje traži još i ispravan broj kredita — `PATCH` ga uopšte ne šalje. */
  const kompSpremna =
    rokSpreman &&
    Number.isInteger(kompKreditaBroj) &&
    kompKreditaBroj >= 0 &&
    kompKreditaBroj <= 2000;

  async function posalji(
    kljuc: string,
    putanja: string,
    init: RequestInit,
    poCistoj?: () => void,
  ) {
    setRadi(kljuc);
    setPoruke((p) => {
      const kopija = { ...p };
      delete kopija[kljuc];
      return kopija;
    });

    try {
      const res = await fetch(`/api/admin/korisnici/${encodeURIComponent(id)}${putanja}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });

      // `404` sa praznim telom je odgovor za „nisi admin" (F12 odluka 3). Do
      // njega se dolazi samo ako je sesija istekla usred rada — poruka to i kaže,
      // umesto da ćuti kao sam odgovor.
      let telo: RadnjaOdgovor | { greska?: string } | null = null;
      try {
        telo = (await res.json()) as RadnjaOdgovor | { greska?: string };
      } catch {
        telo = null;
      }

      if (!res.ok) {
        const tekst =
          (telo && "greska" in telo && telo.greska) ||
          (res.status === 404
            ? "Sesija je istekla ili nemaš prava. Osveži stranu i prijavi se ponovo."
            : "Izmena nije prošla.");
        setPoruke((p) => ({ ...p, [kljuc]: { ok: false, tekst } }));
        return;
      }

      const tekst = telo && "poruka" in telo ? telo.poruka : "Urađeno.";
      setPoruke((p) => ({ ...p, [kljuc]: { ok: true, tekst } }));
      poCistoj?.();

      // Osvežava i balans, i izvod iz knjige, i — što je ovde najvažnije — `refId`
      // za sledeću korekciju. Bez toga bi druga izmena nosila isti ključ i izašla
      // kao „već primenjeno".
      prenesi(() => router.refresh());
    } catch (err) {
      console.error("[admin-radnje]", err);
      setPoruke((p) => ({
        ...p,
        [kljuc]: { ok: false, tekst: "Veza sa serverom nije uspela. Pokušaj ponovo." },
      }));
    } finally {
      setRadi(null);
    }
  }

  function korigujKredite(smer: 1 | -1) {
    const broj = Number(iznos);
    if (!Number.isInteger(broj) || broj <= 0 || broj > 500) {
      setPoruke((p) => ({
        ...p,
        krediti: { ok: false, tekst: "Iznos je ceo broj od 1 do 500." },
      }));
      return;
    }
    if (napomena.trim().length < 3) {
      setPoruke((p) => ({
        ...p,
        krediti: { ok: false, tekst: "Beleška je obavezna — upiši zašto." },
      }));
      return;
    }

    void posalji(
      "krediti",
      "/krediti",
      {
        method: "POST",
        body: JSON.stringify({ delta: smer * broj, napomena: napomena.trim(), refId }),
      },
      () => {
        setIznos("");
        setNapomena("");
      },
    );
  }

  return (
    <section className="rounded-xl border border-border bg-bg-elev p-5 shadow-sm">
      <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Radnje</h2>
      <p className="mb-5 text-[11px] text-fg-faint">
        Svaka izmena odavde ostavlja red u reviziji, i kad prođe i kad padne.
      </p>

      {/* ── KREDITI ─────────────────────────────────────────── */}
      <NaslovSekcije>Krediti</NaslovSekcije>
      <div className="mt-2 space-y-2.5">
        <label className="block">
          <Label>Iznos</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={iznos}
            onChange={(e) => setIznos(e.target.value)}
            placeholder="30"
            className="num"
            disabled={zauzeto}
          />
        </label>

        <label className="block">
          <Label>Beleška (obavezna)</Label>
          <Textarea
            rows={2}
            maxLength={200}
            value={napomena}
            onChange={(e) => setNapomena(e.target.value)}
            placeholder="Zašto ova izmena"
            disabled={zauzeto}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={zauzeto}
            onClick={() => korigujKredite(1)}
          >
            {radi === "krediti" ? <Loader2 className="animate-spin" /> : <PlusCircle />}
            Dodaj
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={zauzeto}
            onClick={() => korigujKredite(-1)}
          >
            <MinusCircle />
            Oduzmi
          </Button>
        </div>

        <Odgovor poruka={poruke.krediti} />
      </div>

      {/* ── PLAN ────────────────────────────────────────────── */}
      <Pregrada />
      <NaslovSekcije>Plan</NaslovSekcije>
      <div className="mt-2 space-y-2.5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <Label>Vrednost iz PLANS</Label>
            {/* Nativni `<select>` je ovde dovoljan: opcija je onoliko koliko ih
                ima u `plans.ts`, danas jedna. Radix `Izbor` iz `ui/select.tsx`
                bi za jedan padajući spisak u konzoli bio ceremonija. */}
            <select
              value={noviPlan}
              onChange={(e) => setNoviPlan(e.target.value)}
              disabled={zauzeto}
              className="h-10 w-full rounded-lg border border-border-strong bg-bg-elev px-3 text-sm text-fg shadow-sm outline-none transition-[border-color,box-shadow] hover:border-fg-muted focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
            >
              {PLAN_OPCIJE.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <Button
            size="sm"
            variant="secondary"
            disabled={zauzeto || noviPlan === plan}
            onClick={() =>
              void posalji("plan", "/plan", {
                method: "PATCH",
                body: JSON.stringify({ plan: noviPlan }),
              })
            }
          >
            {radi === "plan" && <Loader2 className="animate-spin" />}
            Sačuvaj
          </Button>
        </div>

        <Napomena>
          Plana <span className="num">komp</span> ovde nema namerno: komp nije samo plan nego i rok
          i krediti, pa ide kroz obrazac ispod. Plan bez roka bi bio neograničen komp.
        </Napomena>

        <Odgovor poruka={poruke.plan} />
      </div>

      {/* ── KOMP ────────────────────────────────────────────── */}
      {/* Jedina radnja u konzoli koja menja tri stvari jednim pozivom, i (uz
          pozivnicu) jedini put kojim plan sme da postane `komp` (LANSIRANJE §1.1,
          odluka D1). Sve tri izmene su u jednoj transakciji u bazi — pola
          otvorenog komp naloga je gore nego nijedan. Pozivnice su na
          `/admin/pozivnice` (S27); iskorišćena stoji u bloku „Pristup". */}
      <Pregrada />
      <NaslovSekcije>Komp nalog</NaslovSekcije>
      <div className="mt-2 space-y-2.5">
        <p className="text-[13px] text-fg-muted">
          {jeKomp ? (
            kompDo ? (
              <>
                Komp do <span className="num text-fg">{formatDatum(kompDo)}</span>
                {Date.parse(kompDo) <= Date.now() && " — rok je prošao, komp je ugašen."}
              </>
            ) : (
              <>
                Komp <span className="text-fg">bez roka</span> — traje dok ga ne ugasiš.
              </>
            )
          ) : (
            "Nije komp."
          )}
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="w-24">
            <Label>Kredita</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={2000}
              value={kompKredita}
              onChange={(e) => setKompKredita(e.target.value)}
              className="num"
              disabled={zauzeto}
            />
          </label>

          <label className="min-w-0 flex-1">
            <Label>Rok</Label>
            <Input
              type="date"
              value={kompDatum}
              onChange={(e) => {
                setKompDatum(e.target.value);
                setKompProslostOk(false);
              }}
              className="num"
              disabled={zauzeto || kompNeograniceno}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-[13px] text-fg-muted">
          <input
            type="checkbox"
            checked={kompNeograniceno}
            onChange={(e) => {
              setKompNeograniceno(e.target.checked);
              setKompProslostOk(false);
            }}
            disabled={zauzeto}
            className="h-4 w-4 accent-accent"
          />
          Neograničeno (bez roka)
        </label>

        {/* Rok u prošlosti je LEGITIMAN — tako se komp gasi (§1.5). Ali je i
            najčešća omaška (pogrešna godina), a posledica je da čovek istog
            trenutka ispadne iz aplikacije. Zato potvrda, a ne zabrana. */}
        {uProslosti && (
          <label className="flex items-start gap-2 rounded-lg bg-warn-wash px-3 py-2 text-[13px] text-warn-text">
            <input
              type="checkbox"
              checked={kompProslostOk}
              onChange={(e) => setKompProslostOk(e.target.checked)}
              disabled={zauzeto}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              Rok je u prošlosti — nalog gubi pun pristup odmah. Potvrdi da je to namera.
            </span>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={zauzeto || !kompSpremna}
            onClick={() =>
              void posalji("komp", "/komp", {
                method: "POST",
                body: JSON.stringify({
                  do: kompRok,
                  krediti: Number(kompKredita),
                  refId: kompRefId,
                }),
              })
            }
          >
            {radi === "komp" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {jeKomp ? "Obnovi komp" : "Otvori komp"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={zauzeto || !rokSpreman}
            title="Menja samo rok — plan i krediti ostaju kakvi jesu."
            onClick={() =>
              void posalji("komp-rok", "/komp", {
                method: "PATCH",
                body: JSON.stringify({ do: kompRok }),
              })
            }
          >
            {radi === "komp-rok" ? <Loader2 className="animate-spin" /> : <CalendarClock />}
            Samo rok
          </Button>
        </div>

        <Napomena>
          Otvaranje upisuje plan, rok i kredite u jednom potezu; dvostruki klik ne daje dva
          paketa kredita. „Samo rok" ne dira ni plan ni kredite — njime se komp i produžava i
          gasi.
        </Napomena>

        <Odgovor poruka={poruke.komp} />
        <Odgovor poruka={poruke["komp-rok"]} />
      </div>

      {/* ── DNEVNI LIMIT ────────────────────────────────────── */}
      <Pregrada />
      <NaslovSekcije>Dnevni limit skeniranja</NaslovSekcije>
      <div className="mt-2 space-y-2.5">
        <p className="text-[13px] text-fg-muted">
          Iskorišćeno <span className="num text-fg">{cacheMissCount}</span> od{" "}
          <span className="num text-fg">{cacheMissLimit}</span> danas.
        </p>

        <Button
          size="sm"
          variant="outline"
          disabled={zauzeto || cacheMissCount === 0}
          onClick={() => void posalji("limit", "/limit", { method: "POST" })}
        >
          {radi === "limit" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Resetuj brojač
        </Button>

        <Odgovor poruka={poruke.limit} />
      </div>

      {/* ── ULOGA ───────────────────────────────────────────── */}
      <Pregrada />
      <NaslovSekcije>Uloga</NaslovSekcije>
      <div className="mt-2 space-y-2.5">
        <p className="text-[13px] text-fg-muted">
          Trenutno: <span className="text-fg">{role === "admin" ? "Admin" : "Korisnik"}</span>
        </p>

        {jaSam ? (
          <Napomena>Sebi ne možeš da menjaš ulogu — jedan pogrešan klik je konzola bez admina.</Napomena>
        ) : (
          <>
            <Button
              size="sm"
              variant={role === "admin" ? "outline" : "secondary"}
              disabled={zauzeto || (role === "admin" && props.poslednjiAdmin)}
              onClick={() =>
                void posalji("uloga", "/uloga", {
                  method: "PATCH",
                  body: JSON.stringify({ role: role === "admin" ? "user" : "admin" }),
                })
              }
            >
              {radi === "uloga" ? (
                <Loader2 className="animate-spin" />
              ) : role === "admin" ? (
                <ShieldOff />
              ) : (
                <ShieldCheck />
              )}
              {role === "admin" ? "Skini ulogu admina" : "Dodeli ulogu admina"}
            </Button>

            {role === "admin" && props.poslednjiAdmin && (
              <Napomena>
                Ovo je poslednji admin u bazi. Prvo postavi drugog, pa mu skini ulogu.
              </Napomena>
            )}
          </>
        )}

        <Odgovor poruka={poruke.uloga} />
      </div>

      {/* ── PORUKA ──────────────────────────────────────────── */}
      {/* Jedina radnja u konzoli koja izlazi iz sistema ka drugom čoveku. Zato
          ima i svoj brojač (20 na dan), pored onog od 120 mutacija na sat. */}
      <Pregrada />
      <NaslovSekcije>Poruka</NaslovSekcije>
      <div className="mt-2 space-y-2.5">
        {mejl ? (
          <>
            <label className="block">
              <Label>Naslov</Label>
              <Input
                value={naslovPoruke}
                onChange={(e) => setNaslovPoruke(e.target.value)}
                placeholder="Pitanje o nalogu"
                maxLength={120}
                disabled={zauzeto}
              />
            </label>

            <label className="block">
              <Label>Tekst</Label>
              <Textarea
                rows={4}
                maxLength={4000}
                value={telo}
                onChange={(e) => setTelo(e.target.value)}
                placeholder="Zdravo Ana,"
                disabled={zauzeto}
              />
            </label>

            <Button
              size="sm"
              variant="secondary"
              disabled={zauzeto || naslovPoruke.trim().length < 3 || telo.trim().length < 10}
              onClick={() =>
                void posalji(
                  "poruka",
                  "/poruka",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      naslov: naslovPoruke.trim(),
                      poruka: telo.trim(),
                    }),
                  },
                  () => {
                    setNaslovPoruke("");
                    setTelo("");
                  },
                )
              }
            >
              {radi === "poruka" ? <Loader2 className="animate-spin" /> : <Send />}
              Pošalji na {email}
            </Button>

            <Napomena>
              Ide kroz Resend, sa odgovorom na moju adresu. Sadržaj se ne upisuje u reviziju —
              samo naslov i dužina.
            </Napomena>
          </>
        ) : (
          <Napomena>Nalog nema mejl u bazi, pa poruka nema kuda.</Napomena>
        )}

        <Odgovor poruka={poruke.poruka} />
      </div>

      {/* ── OPASNO ──────────────────────────────────────────── */}
      {/* Linija je deblja od ostalih pregrada, i to je jedina razlika u težini na
          ovom ekranu. Sve ispod nje se ne može opozvati. */}
      <div className="mt-6 border-t-2 border-border pt-5">
        <NaslovSekcije className="text-danger">Opasno</NaslovSekcije>

        {jaSam ? (
          <Napomena className="mt-2">
            Sopstveni nalog se odavde ne blokira i ne briše. Za to postoji Clerk konzola — i
            razlog da se dvaput promisli.
          </Napomena>
        ) : (
          <div className="mt-2 space-y-3">
            <label className="block">
              <Label>Otkucaj mejl korisnika da otključaš radnje</Label>
              <Input
                value={potvrda}
                onChange={(e) => setPotvrda(e.target.value)}
                placeholder={email ?? "nalog nema mejl"}
                autoComplete="off"
                spellCheck={false}
                className="num"
                disabled={zauzeto || !mejl}
              />
            </label>

            {!mejl && (
              <Napomena>Nalog nema mejl u bazi, pa potvrda ne može da se proveri.</Napomena>
            )}

            <div className="flex flex-wrap gap-2">
              {blokiran === true ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={zauzeto}
                  onClick={() =>
                    void posalji("blokada", "/blokada", {
                      method: "POST",
                      body: JSON.stringify({ blokiran: false }),
                    })
                  }
                >
                  {radi === "blokada" && <Loader2 className="animate-spin" />}
                  Odblokiraj
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={zauzeto || !potvrdjeno || blokiran === null}
                  onClick={() =>
                    void posalji("blokada", "/blokada", {
                      method: "POST",
                      body: JSON.stringify({ blokiran: true }),
                    })
                  }
                >
                  {radi === "blokada" ? <Loader2 className="animate-spin" /> : <UserX />}
                  Blokiraj nalog
                </Button>
              )}

              <Button
                size="sm"
                variant="danger"
                disabled={zauzeto || !potvrdjeno}
                onClick={() =>
                  void posalji(
                    "brisanje",
                    "",
                    { method: "DELETE", body: JSON.stringify({ potvrda: potvrda.trim() }) },
                    () => setPotvrda(""),
                  )
                }
              >
                {radi === "brisanje" ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Obriši nalog
              </Button>
            </div>

            {blokiran === null && (
              <Napomena>
                Clerk nije odgovorio, pa se stanje blokade ne zna. Blokada se ne nudi dok se ne
                učita.
              </Napomena>
            )}

            <p className="text-[11px] text-fg-faint">
              Brisanje uklanja nalog u Clerku, pa kaskadom sve njegove redove: otključane
              prospekte, knjigu kredita, pipeline, poruke i utiske. Prospekti i auditi ostaju —
              to nisu njegovi podaci.
            </p>

            <Odgovor poruka={poruke.blokada} />
            <Odgovor poruka={poruke.brisanje} />
          </div>
        )}
      </div>
    </section>
  );
}

// ── datumi u komp obrascu ────────────────────────────────────
// `<input type="date">` radi sa `YYYY-MM-DD` po LOKALNOM danu, a baza čuva
// trenutak. Prevod je namerno „kraj izabranog dana, po vremenu admina": kad
// upišem 21. septembar, komp traje ceo 21. septembar — a ne ističe u ponoć na
// početku tog dana, što bi bilo za jedan dan manje nego što piše.

/** Lokalni `YYYY-MM-DD` za „danas + n dana". */
function zaDana(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` → ISO trenutak na kraju tog lokalnog dana. `null` za neispravan unos. */
function krajDana(dan: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dan);
  if (!m) return null;

  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── sitni delovi ─────────────────────────────────────────────
// Bez ugnježđenih kartica (§7.2): sekcije unutar bloka razdvaja hairline linija.

function Pregrada() {
  return <div className="my-5 border-t border-border" />;
}

function Odgovor({ poruka }: { poruka?: Poruka }) {
  if (!poruka) return null;
  return (
    <Alert variant={poruka.ok ? "success" : "danger"} bezIkonice className="px-3 py-2 text-[13px]">
      {poruka.tekst}
    </Alert>
  );
}

function Napomena({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[11px] text-fg-faint", className)}>{children}</p>;
}
