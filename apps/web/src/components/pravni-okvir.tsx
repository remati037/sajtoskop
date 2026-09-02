// apps/web/src/components/pravni-okvir.tsx
// Zajednički okvir za `/uslovi`, `/privatnost` i `/povracaj` — tri duga teksta
// koja se razlikuju samo po sadržaju.
//
// ── zašto komponente, a ne markdown ────────────────────────
// Tekstovi su živi: menjaju se kad se promeni model naplate, a moraju da nose i
// linkove ka `/cenovnik` i međusobno. Markdown bi značio ili renderer sa
// `dangerouslySetInnerHTML` (na strani koju čita i Paddle recenzent) ili paket
// više u bundle-u. Tri komponente su jeftinije od oba.
//
// ── <POPUNITI: …> ──────────────────────────────────────────
// `<Popuniti>` je namerno KRIČEĆI element, ne komentar u kodu: dok markera ima,
// oni se vide na objavljenoj strani. Tekst nastaje iz šablona i nije pravno
// proveren — mesto na kome fali stvaran podatak (matični broj, PIB, rok) ne sme
// da izgleda kao popunjeno.
//
//   pronalaženje svih markera:  grep -rn "<Popuniti>" apps/web/src/app
//
// Go/no-go lista (`docs/LANSIRANJE.md` §8) traži da nijedan ne ostane. Kad
// poslednji nestane, briše se i `<NacrtBaner />` sa sve tri strane.

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { LANDING_URL } from "@/lib/veze";
import { Futer, KONTAKT_MEJL } from "@/components/futer";
import { PrekidacTemeDugme } from "@/components/prekidac-teme";
import { ZnakSaImenom } from "@/components/znak";
import { cn } from "@/lib/cn";

/** Tri pravne strane; red je isti kao u futeru. */
const PRAVNE_STRANE = [
  { putanja: "/uslovi", naziv: "Uslovi korišćenja" },
  { putanja: "/privatnost", naziv: "Politika privatnosti" },
  { putanja: "/povracaj", naziv: "Politika povraćaja" },
] as const;

export type PravnaPutanja = (typeof PRAVNE_STRANE)[number]["putanja"];

/**
 * Mesto na kome fali stvaran podatak.
 *
 * Renderuje se kao `<POPUNITI: opis>` u žutoj kapsuli, u obe teme.
 */
export function Popuniti({ children }: { children: React.ReactNode }) {
  return (
    <span className="num mx-0.5 inline-block rounded-md bg-warn-wash px-1.5 py-0.5 text-[0.85em] font-medium text-warn-text">
      &lt;POPUNITI: {children}&gt;
    </span>
  );
}

/** Upozorenje na vrhu strane, dok god ima ijednog markera. */
export function NacrtBaner() {
  return (
    <div className="mt-8 flex gap-3 rounded-xl border border-border bg-warn-wash px-4 py-3.5">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-text" aria-hidden />
      <p className="text-xs leading-relaxed text-fg-muted">
        <strong className="font-semibold text-fg">Ovo je nacrt.</strong> Mesta označena sa{" "}
        <span className="num text-warn-text">&lt;POPUNITI: …&gt;</span> nisu popunjena, pa
        tekst još nije konačan. Ako ti nešto od toga treba pre nego što bude popunjeno, piši
        na{" "}
        <a
          href={`mailto:${KONTAKT_MEJL}`}
          className="font-medium text-accent-text underline underline-offset-4"
        >
          {KONTAKT_MEJL}
        </a>
        .
      </p>
    </div>
  );
}

/** Naslovljena celina teksta. Broj je mono i sivlji — numeracija nije sadržaj. */
export function Odeljak({
  broj,
  naslov,
  children,
}: {
  broj: number;
  naslov: string;
  children: React.ReactNode;
}) {
  const id = `odeljak-${broj}`;
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="flex gap-2.5 text-[17px] font-semibold leading-snug tracking-tight">
        <span className="num shrink-0 text-fg-faint">{broj}.</span>
        <span>{naslov}</span>
      </h2>
      {/* Dužina reda staje na 62ch (dizajn sistem §4). */}
      <div className="mt-3 max-w-[62ch] space-y-3 text-sm leading-relaxed text-fg-muted [&_strong]:font-semibold [&_strong]:text-fg">
        {children}
      </div>
    </section>
  );
}

/** Nabrajanje unutar odeljka. */
export function Lista({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ul className={cn("ml-4 list-disc space-y-2 marker:text-fg-faint", className)}>{children}</ul>
  );
}

/**
 * Link u tekstu — isti izgled za unutrašnje, spoljne i `mailto:`.
 *
 * Nov tab dobija samo `http(s)` link; `mailto:` sa `target="_blank"` u nekim
 * pregledačima otvori prazan tab pored mejl klijenta.
 */
export function TekstLink({ href, children }: { href: string; children: React.ReactNode }) {
  const klase = "font-medium text-accent-text underline underline-offset-4";

  if (href.startsWith("/")) {
    return (
      <Link href={href} className={klase}>
        {children}
      </Link>
    );
  }

  const spolja = href.startsWith("http");
  return (
    <a
      href={href}
      className={klase}
      {...(spolja ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/**
 * Okvir strane: zaglavlje bez navigacije aplikacije, tekst u jednoj koloni,
 * futer na dnu.
 *
 * Zaglavlje namerno NE čita Clerk sesiju — pravne strane su jedine u proizvodu
 * koje smeju da budu statične, a `auth()` bi ih pretvorio u dinamične bez
 * ijednog razloga. Ulaz u aplikaciju stoji na logotipu i u futeru.
 */
export function PravniOkvir({
  putanja,
  naslov,
  uvod,
  azurirano,
  children,
}: {
  /** Putanja ove strane — iz nje se izvodi koja druga dva teksta stoje na dnu. */
  putanja: PravnaPutanja;
  naslov: string;
  uvod: React.ReactNode;
  /** Šta stoji uz „Poslednja izmena" — dok se ne popuni, to je marker. */
  azurirano: React.ReactNode;
  children: React.ReactNode;
}) {
  const ostali = PRAVNE_STRANE.filter((s) => s.putanja !== putanja);
  return (
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[28rem]" />

      <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center justify-between px-5 sm:px-7 lg:px-8">
        {/* Logo vodi na landing (S24, §1.7). Paddle recenzent pravne strane
            otvara sa prodajne strane i mora da ima put nazad na nju. */}
        <a href={LANDING_URL} className="rounded-lg">
          <ZnakSaImenom imeKlase="text-base" />
        </a>
        <PrekidacTemeDugme />
      </header>

      <main className="relative mx-auto w-full max-w-[46rem] flex-1 px-5 pb-20 pt-[clamp(2rem,5vw,3.5rem)] sm:px-7">
        <p className="eyebrow">Pravno</p>
        <h1 className="h2 mt-3">{naslov}</h1>
        <p className="lede mt-4 max-w-[62ch]">{uvod}</p>

        <p className="mt-5 text-xs text-fg-muted">Poslednja izmena: {azurirano}</p>

        <NacrtBaner />

        <div className="mt-12 space-y-10">{children}</div>

        {/* Tri teksta se čitaju zajedno, pa se sa svakog vide druga dva. */}
        <p className="mt-14 max-w-[62ch] border-t border-border pt-5 text-xs leading-relaxed text-fg-muted">
          Pitanje o ovom tekstu ide na{" "}
          <a
            href={`mailto:${KONTAKT_MEJL}`}
            className="font-medium text-accent-text underline underline-offset-4"
          >
            {KONTAKT_MEJL}
          </a>
          . Uz ovaj tekst idu i{" "}
          {ostali.map((s, i) => (
            <span key={s.putanja}>
              {i > 0 && " i "}
              <TekstLink href={s.putanja}>{s.naziv}</TekstLink>
            </span>
          ))}
          .
        </p>
      </main>

      <Futer />
    </div>
  );
}
