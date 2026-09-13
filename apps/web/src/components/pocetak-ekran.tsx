"use client";

// apps/web/src/components/pocetak-ekran.tsx
// Čarobnjak `/pocetak` — četiri ekrana, tekst doslovno iz §4.2.
//
// Zajedničko (§4.2): wordmark gore levo, „Preskoči" gore desno na svakom ekranu,
// „Nazad" dole levo od drugog ekrana, jedno primarno dugme, Enter ide dalje,
// tačkice 1–4 ispod naslova bez brojača, ulazak opacity + y (`animate-uklizi`,
// jedna ease kriva; `prefers-reduced-motion` gasi pomak u `globals.css`).
//
// ── ekran 4 i nula Places poziva ────────────────────────────
// Klik prvo pita `/api/search` BEZ naplate. Ako keš i dalje pokriva listu
// (`needs_scan` sa `kind: kes`, ili već plaćen pristup), drugi poziv plaća
// pristup iz keša — bez posla i bez Google-a. Ako je kombinacija u međuvremenu
// istekla, ekran se ponovo crta sa novom cenom i rečenicom iz §1.8, a tek
// SLEDEĆI klik plaća osvežavanje. Bez te provere bi `pay: true` nad isteklom
// kombinacijom tiho pokrenuo skeniranje — Places poziv usred čarobnjaka.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import type { OnboardingKanal } from "@sajtoskop/shared";
import { cn } from "@/lib/cn";
import type { ApiError, SearchResponse } from "@/lib/search-types";
import { plural } from "@/lib/ui-tekst";
import { Combobox } from "./combobox";
import { Button } from "./ui/button";
import { ZnakSaImenom } from "./znak";

export type NisaCarobnjaka = {
  slug: string;
  label: string;
  total: number;
  noSite: number;
  /** `null` kad se broj nije pročitao — tada se ne prikazuje. */
  dead: number | null;
};

export type GradCarobnjaka = {
  slug: string;
  label: string;
  /** Broj svežih kombinacija u kešu. */
  liste: number;
  /** Zbir firmi bez sajta u tim kombinacijama. */
  bezSajta: number;
  nise: NisaCarobnjaka[];
};

/** §4.2, doslovno. */
const TEKST = {
  preskoci: "Preskoči",
  nazad: "Nazad",
  dalje: "Dalje",
  ekran1: {
    eyebrow: "PRVI KORAK OD TRI",
    naslov: "Gde tražiš klijente?",
    lede: "Prikazujem samo gradove za koje već imam gotove liste — prva lista stiže odmah, bez čekanja.",
    placeholder: "Grad…",
    fusnota: "Grad koji ne vidiš ovde možeš da skeniraš kasnije, sa pretrage.",
  },
  ekran2: {
    eyebrow: "DRUGI KORAK OD TRI",
    naslov: "Kome praviš sajtove?",
    ledePosle:
      "Zelena brojka je koliko firmi u niši uopšte nema sajt — to su najlakši razgovori.",
    fusnota: "Kad izabereš, nišu i grad pamtim kao podrazumevane za pretragu. Menjaš ih kad hoćeš.",
  },
  ekran3: {
    eyebrow: "TREĆI KORAK OD TRI",
    naslov: "Kako obično kontaktiraš firme?",
    fusnota: "Poruku pišem u kanalu koji izabereš; ostala dva su uvek na klik.",
  },
  ekran4: {
    eyebrow: "SPREMNO",
    ledeUvod: "Lista je gotova i stiže odmah.",
    fusnota:
      "Lista ti ostaje 30 dana. Sve što je u njoj već je proverio Sajtoskop bot — telefon, sajt, kako radi na telefonu.",
    otvaram: "Otvaram…",
    istekla: "Ova lista je upravo istekla, osvežavanje košta isto",
  },
  prazno: {
    naslov: "Još nema gotovih lista",
    lede: "Prva lista za tvoj grad nastaje kad je neko skenira — možeš to da budeš ti. Skeniranje košta 1 kredit za 20 firmi.",
    dugme: "Idi na pretragu",
  },
} as const;

const KANALI: { kanal: OnboardingKanal; naslov: string; opis: string }[] = [
  { kanal: "viber", naslov: "Viber", opis: "Kratka poruka bez linka. Za mobilne brojeve, najviše odgovora." },
  { kanal: "mejl", naslov: "Mejl", opis: "Duža poruka sa primerima. Kad firma ima adresu." },
  { kanal: "instagram", naslov: "Instagram", opis: "Dve poruke: prva bez ponude. Za firme koje žive na mrežama." },
];

const firmi = (n: number) => plural(n, "firma", "firme", "firmi");
const kredita = (n: number) => `${n} ${plural(n, "kredit", "kredita", "kredita")}`;

type Props = {
  gradovi: GradCarobnjaka[];
  pocetno: { grad: string | null; nisa: string | null; kanal: OnboardingKanal | null };
  /** Zbir obe kase. */
  krediti: number;
  /** `dopuna` bez paketa, sa netaknutim kreditima dobrodošlice (§4.2, ekran 4). */
  besplatni: boolean;
  /** „Komp pristup do …, N kredita" iznad naslova prvog ekrana (§1.13). */
  kompRed: string | null;
  /** `?ponovo=1` — preselekcija, bez preskakanja u bazi (§4.8). */
  ponovo: boolean;
};

export function PocetakEkran({ gradovi, pocetno, krediti, besplatni, kompRed, ponovo }: Props) {
  const router = useRouter();

  const pocetniGrad = gradovi.find((g) => g.slug === pocetno.grad) ?? null;
  const [ekran, setEkran] = useState(0);
  const [grad, setGrad] = useState<string | null>(pocetniGrad?.slug ?? null);
  const [nisa, setNisa] = useState<string | null>(
    pocetniGrad?.nise.some((n) => n.slug === pocetno.nisa) ? pocetno.nisa : null,
  );
  const [kanal, setKanal] = useState<OnboardingKanal | null>(pocetno.kanal);
  const [radi, setRadi] = useState(false);
  const [greska, setGreska] = useState<{ tekst: string; planovi: boolean } | null>(null);
  /** Kombinacija je istekla između ekrana: nova cena, a sledeći klik plaća (§1.8). */
  const [isteklo, setIsteklo] = useState<{ cost: number } | null>(null);

  const izabraniGrad = gradovi.find((g) => g.slug === grad) ?? null;
  const izabranaNisa = izabraniGrad?.nise.find((n) => n.slug === nisa) ?? null;

  /** Odgovor sa ekrana u bazu (0028). Ne čeka se — izbor ostaje i bez upisa. */
  function sacuvaj(korak: "grad" | "nisa" | "kanal", vrednost: string) {
    void fetch("/api/onboarding/korak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ korak, vrednost }),
    }).catch(() => {
      // Bez upisa se izbor ne preselektuje sledeći put. Tok ide dalje.
    });
  }

  async function preskoci() {
    setRadi(true);
    setGreska(null);
    // `?ponovo=1` ne dira `onboarding_skipped_at` — to je podatak o PRVOM prolazu.
    if (!ponovo) {
      try {
        const res = await fetch("/api/onboarding/preskoci", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gde: "carobnjak" }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        // Bez upisa bi kapija na `/pretraga` vratila čoveka ovamo — zato poruka,
        // ne tiha redirekcija u krug.
        setGreska({ tekst: "Trenutno ne mogu da sačuvam izbor. Pokušaj ponovo.", planovi: false });
        setRadi(false);
        return;
      }
    }
    router.replace("/pretraga");
  }

  async function pretraga(pay: boolean): Promise<{ res: Response; json: SearchResponse | ApiError }> {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: grad, niche: nisa, dubina: "brzo", pay }),
    });
    return { res, json: (await res.json()) as SearchResponse | ApiError };
  }

  function odbijeno(res: Response, json: SearchResponse | ApiError) {
    const tekst = "greska" in json ? json.greska : "Lista trenutno ne može da se otvori. Pokušaj ponovo.";
    setGreska({ tekst, planovi: res.status === 402 });
  }

  async function otvori() {
    if (!grad || !nisa) return;
    setRadi(true);
    setGreska(null);

    try {
      if (!isteklo) {
        const provera = await pretraga(false);
        if (!provera.res.ok) {
          odbijeno(provera.res, provera.json);
          setRadi(false);
          return;
        }
        const o = provera.json as SearchResponse;
        if (o.status === "needs_scan" && o.scan && o.scan.kind !== "kes") {
          setIsteklo({ cost: o.scan.cost });
          setRadi(false);
          return;
        }
      }

      // Plaćanje pristupa: `cached` iz keša, ili `already_paid` kad je pristup
      // već tu (tada bez kredita — ruta svejedno upiše korak `pretraga`).
      const placanje = await pretraga(true);
      if (!placanje.res.ok) {
        odbijeno(placanje.res, placanje.json);
        setRadi(false);
        return;
      }

      // `dubina=brzo` je nužno: plaćena je jedna stranica, a bez parametra bi
      // pretraga tražila „Standardno" i videla cenu umesto liste.
      router.replace(
        `/pretraga?grad=${encodeURIComponent(grad)}&nisa=${encodeURIComponent(nisa)}&dubina=brzo`,
      );
    } catch {
      setGreska({ tekst: "Nema veze sa serverom. Proveri internet pa pokušaj ponovo.", planovi: false });
      setRadi(false);
    }
  }

  function dalje() {
    if (radi) return;
    if (ekran === 0 && grad) {
      sacuvaj("grad", grad);
      setEkran(1);
    } else if (ekran === 1 && nisa) {
      sacuvaj("nisa", nisa);
      setEkran(2);
    } else if (ekran === 2 && kanal) {
      sacuvaj("kanal", kanal);
      setEkran(3);
    } else if (ekran === 3) {
      void otvori();
    }
  }

  const mozeDalje =
    (ekran === 0 && !!grad) || (ekran === 1 && !!izabranaNisa) || (ekran === 2 && !!kanal) || ekran === 3;

  // ── okvir ──────────────────────────────────────────────────
  const zaglavlje = (
    <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center justify-between px-5 sm:px-7 lg:px-8">
      <ZnakSaImenom imeKlase="text-base" />
      <Button type="button" variant="ghost" size="sm" disabled={radi} onClick={() => void preskoci()}>
        {TEKST.preskoci}
      </Button>
    </header>
  );

  if (gradovi.length === 0) {
    return (
      <div className="relative flex min-h-screen flex-col">
        <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[28rem]" />
        {zaglavlje}
        <main className="relative mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-16 pt-[clamp(2rem,8vw,5rem)] sm:px-7">
          <h1 className="h2">{TEKST.prazno.naslov}</h1>
          <p className="lede mt-4">{TEKST.prazno.lede}</p>
          {greska && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {greska.tekst}
            </p>
          )}
          <div className="mt-8">
            <Button type="button" variant="primary" size="lg" disabled={radi} onClick={() => void preskoci()}>
              {TEKST.prazno.dugme}
              <ArrowRight strokeWidth={2.2} />
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const podaci = [
    { eyebrow: TEKST.ekran1.eyebrow, naslov: TEKST.ekran1.naslov, fusnota: TEKST.ekran1.fusnota },
    { eyebrow: TEKST.ekran2.eyebrow, naslov: TEKST.ekran2.naslov, fusnota: TEKST.ekran2.fusnota },
    { eyebrow: TEKST.ekran3.eyebrow, naslov: TEKST.ekran3.naslov, fusnota: TEKST.ekran3.fusnota },
    {
      eyebrow: TEKST.ekran4.eyebrow,
      naslov: izabraniGrad && izabranaNisa ? `${izabranaNisa.label} · ${izabraniGrad.label}` : "",
      fusnota: TEKST.ekran4.fusnota,
    },
  ][ekran]!;

  const cena = isteklo?.cost ?? 1;

  return (
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[28rem]" />
      {zaglavlje}

      <main className="relative mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-16 pt-[clamp(1.5rem,6vw,4rem)] sm:px-7">
        <form
          key={ekran}
          className="animate-uklizi"
          onSubmit={(e) => {
            e.preventDefault();
            dalje();
          }}
        >
          {kompRed && ekran === 0 && (
            <p className="mb-5 inline-flex rounded-full border border-border-accent bg-accent-wash px-3 py-1 text-xs font-medium text-accent-text">
              {kompRed}
            </p>
          )}

          <p className="eyebrow">{podaci.eyebrow}</p>
          <h1 className="h2 mt-3">{podaci.naslov}</h1>

          {/* Tačkice 1–4, bez brojača „1 od 4" (§4.2). */}
          <div aria-hidden className="mt-3 flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === ekran ? "w-5 bg-accent" : i < ekran ? "w-1.5 bg-accent/60" : "w-1.5 bg-border-strong",
                )}
              />
            ))}
          </div>

          {/* ── ekran 1: grad ── */}
          {ekran === 0 && (
            <>
              <p className="lede mt-4">{TEKST.ekran1.lede}</p>
              <div className="mt-6">
                <Combobox
                  label="Grad"
                  placeholder={TEKST.ekran1.placeholder}
                  groups={[
                    {
                      label: "Gradovi",
                      options: gradovi.map((g) => ({
                        value: g.slug,
                        label: g.label,
                        opis: `${g.liste} ${plural(g.liste, "gotova lista", "gotove liste", "gotovih lista")} · ${g.bezSajta} ${firmi(g.bezSajta)} bez sajta`,
                      })),
                    },
                  ]}
                  value={grad}
                  onChange={(g) => {
                    setGrad(g);
                    const novi = gradovi.find((x) => x.slug === g);
                    if (!novi?.nise.some((n) => n.slug === nisa)) setNisa(null);
                    setIsteklo(null);
                  }}
                />
              </div>
            </>
          )}

          {/* ── ekran 2: niša ── */}
          {ekran === 1 && izabraniGrad && (
            <>
              <p className="lede mt-4">
                Za <strong className="font-semibold text-fg">{izabraniGrad.label}</strong> imam{" "}
                <span className="num">{izabraniGrad.liste}</span>{" "}
                {plural(izabraniGrad.liste, "gotovu listu", "gotove liste", "gotovih lista")}.{" "}
                {TEKST.ekran2.ledePosle}
              </p>
              <div role="radiogroup" aria-label={TEKST.ekran2.naslov} className="mt-6 flex flex-wrap gap-2">
                {izabraniGrad.nise.map((n) => {
                  const izabrana = n.slug === nisa;
                  return (
                    <button
                      key={n.slug}
                      type="button"
                      role="radio"
                      aria-checked={izabrana}
                      onClick={() => {
                        setNisa(n.slug);
                        setIsteklo(null);
                      }}
                      className={cn(
                        "inline-flex min-h-10 flex-wrap items-center gap-x-1.5 rounded-xl border px-3 py-2 text-left text-[13px] transition-colors",
                        izabrana
                          ? "border-accent bg-accent-wash text-fg"
                          : "border-border-strong bg-bg-elev text-fg hover:border-fg-muted",
                      )}
                    >
                      <span className="font-medium">{n.label}</span>
                      <span className="text-fg-muted">·</span>
                      <span className="num text-fg-muted">
                        {n.total} {firmi(n.total)}
                      </span>
                      <span className="text-fg-muted">·</span>
                      <span className="num font-medium text-accent-text">{n.noSite} bez sajta</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ── ekran 3: kanal ── */}
          {ekran === 2 && (
            <div role="radiogroup" aria-label={TEKST.ekran3.naslov} className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {KANALI.map((k) => {
                const izabran = k.kanal === kanal;
                return (
                  <button
                    key={k.kanal}
                    type="button"
                    role="radio"
                    aria-checked={izabran}
                    onClick={() => setKanal(k.kanal)}
                    className={cn(
                      "flex flex-col rounded-xl border px-4 py-3 text-left transition-colors",
                      izabran
                        ? "border-accent bg-accent-wash"
                        : "border-border-strong bg-bg-elev hover:border-fg-muted",
                    )}
                  >
                    <span className="text-sm font-semibold">{k.naslov}</span>
                    <span className="mt-1 text-[13px] leading-snug text-fg-muted">{k.opis}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── ekran 4: prva lista ── */}
          {ekran === 3 && izabranaNisa && (
            <>
              <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
                <div className="bg-bg-elev px-3 py-3">
                  <dt className="sr-only">Firmi</dt>
                  <dd className="num text-2xl font-semibold tracking-tight">{izabranaNisa.total}</dd>
                  <dd className="text-xs text-fg-muted">{firmi(izabranaNisa.total)}</dd>
                </div>
                <div className="bg-bg-elev px-3 py-3">
                  <dt className="sr-only">Bez sajta</dt>
                  <dd className="num text-2xl font-semibold tracking-tight text-accent-text">
                    {izabranaNisa.noSite}
                  </dd>
                  <dd className="text-xs text-fg-muted">bez sajta</dd>
                </div>
                <div className="bg-bg-elev px-3 py-3">
                  <dt className="sr-only">Sa mrtvim domenom</dt>
                  <dd className="num text-2xl font-semibold tracking-tight">
                    {izabranaNisa.dead ?? "—"}
                  </dd>
                  <dd className="text-xs text-fg-muted">sa mrtvim domenom</dd>
                </div>
              </dl>

              {isteklo && (
                <p role="status" className="mt-4 text-sm font-medium text-warn-text">
                  {TEKST.ekran4.istekla}
                </p>
              )}

              <p className="lede mt-4">
                {TEKST.ekran4.ledeUvod}{" "}
                {besplatni && !isteklo ? (
                  <>
                    Imaš{" "}
                    <strong className="font-semibold text-fg">
                      <span className="num">{krediti}</span> besplatna kredita
                    </strong>
                    : ovaj ide na listu, sledeći na prvi prospekt.
                  </>
                ) : (
                  <>
                    Košta{" "}
                    <strong className="font-semibold text-fg">
                      <span className="num">{cena}</span> {plural(cena, "kredit", "kredita", "kredita")}
                    </strong>{" "}
                    — imaš{" "}
                    <strong className="num font-semibold text-fg">{krediti}</strong>.
                  </>
                )}
              </p>
            </>
          )}

          {greska && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {greska.tekst}{" "}
              {greska.planovi && (
                <a href="/cenovnik" className="font-medium text-accent-text underline underline-offset-4">
                  Pogledaj planove
                </a>
              )}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            {ekran > 0 ? (
              <Button type="button" variant="ghost" disabled={radi} onClick={() => setEkran((e) => e - 1)}>
                {TEKST.nazad}
              </Button>
            ) : (
              <span />
            )}

            <Button type="submit" variant="primary" size="lg" disabled={!mozeDalje || radi}>
              {radi ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  {ekran === 3 ? TEKST.ekran4.otvaram : TEKST.dalje}
                </>
              ) : ekran === 3 ? (
                <>
                  Otvori listu · <span className="num">{kredita(cena)}</span>
                  <ArrowRight strokeWidth={2.2} />
                </>
              ) : (
                <>
                  {TEKST.dalje}
                  <ArrowRight strokeWidth={2.2} />
                </>
              )}
            </Button>
          </div>

          <p className="mt-6 text-xs leading-relaxed text-fg-muted">{podaci.fusnota}</p>
        </form>
      </main>
    </div>
  );
}
