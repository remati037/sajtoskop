// apps/web/src/components/futer.tsx
// Futer javnog dela sajta. Do S22 ga uopšte nije bilo — pravne strane i
// cenovnik nisu imali nijedan zajednički izlaz, a Paddle za odobrenje naloga
// traži da Uslovi i Politika povraćaja budu vidljivi sa svake javne strane.
//
// ‼️ MONTIRA SE SAMO IZVAN GRUPE `(app)`. Unutar aplikacije futer nema šta da
//    radi: tamo je bočna traka stalna navigacija, a strana se skroluje u svom
//    okviru — futer bi se pojavljivao ispod tabele prospekata i pomerao radnu
//    površinu. Linkovi ka pravnim tekstovima ulogovanom korisniku stoje na
//    `/cenovnik` i u mejlovima, ne u alatu.
//
// Strane na kojima stoji: `/`, `/cenovnik`, `/welcome`, `/uslovi`,
// `/privatnost`, `/povracaj`.

import Link from "next/link";
import { ZnakSaImenom } from "@/components/znak";

/** Adresa podrške. Ista je i u `/welcome` i u poruci greške na `/cenovnik`. */
export const KONTAKT_MEJL = "podrska@sajtoskop.com";

const LINKOVI: { href: string; naziv: string }[] = [
  { href: "/cenovnik", naziv: "Cenovnik" },
  { href: "/uslovi", naziv: "Uslovi korišćenja" },
  { href: "/privatnost", naziv: "Politika privatnosti" },
  { href: "/povracaj", naziv: "Politika povraćaja" },
];

export function Futer({ className }: { className?: string }) {
  // Godina se čita pri renderu. Strane sa `force-dynamic` je dobijaju na svaki
  // zahtev, a statične na svaki build — što je za copyright notice dovoljno,
  // jer se aplikacija ionako deploy-uje češće nego jednom godišnje.
  const godina = new Date().getFullYear();

  return (
    <footer className={`relative border-t border-border bg-bg-subtle/60 ${className ?? ""}`}>
      <div className="mx-auto w-full max-w-[1160px] px-5 py-9 sm:px-7 lg:px-8">
        <div className="flex flex-col gap-7 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Link href="/" className="inline-flex rounded-lg">
              <ZnakSaImenom />
            </Link>
            <p className="mt-2.5 max-w-xs text-xs leading-relaxed text-fg-muted">
              Biznisi u Srbiji kojima sajt ne valja — ili ga uopšte nema.
            </p>
          </div>

          {/* Kolone na telefonu ostaju u jednom redu koji se prelama: pet
              linkova ne traži zaglavlja sekcija ni tri kolone. */}
          <nav
            aria-label="Pravno i cene"
            className="flex flex-wrap gap-x-6 gap-y-2.5 text-sm md:justify-end"
          >
            {LINKOVI.map(({ href, naziv }) => (
              <Link
                key={href}
                href={href}
                className="text-fg-muted transition-colors hover:text-fg"
              >
                {naziv}
              </Link>
            ))}
            <a
              href={`mailto:${KONTAKT_MEJL}`}
              className="text-fg-muted transition-colors hover:text-fg"
            >
              Kontakt
            </a>
          </nav>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border pt-5 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between">
          {/* Copyright notice traži `docs/F8-landing.md` §3 i `docs/bezbednost-i-zastita.md`,
              Sloj 1 — bez njega je autorstvo teže dokazati nego što mora da bude. */}
          <p>
            <span className="num">© {godina}</span> Sajtoskop · Marko Milenković. Sva prava
            zadržana.
          </p>
          <p>
            Podaci o firmama su javni, sa Google Maps-a, preko zvaničnog API-ja.
          </p>
        </div>
      </div>
    </footer>
  );
}
