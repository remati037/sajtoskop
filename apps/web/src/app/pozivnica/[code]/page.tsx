// apps/web/src/app/pozivnica/[code]/page.tsx
// Javna strana pristupne pozivnice (S27, naplata-stripe.md §9.4).
//
// Stoji IZVAN grupe `(app)`, iz istog razloga kao `/cenovnik`: ta grupa zove
// `requireSession()` u layout-u, a link iz pozivnice najčešće otvara neko ko
// nalog još nema. Gost vidi šta pozivnica daje i formu za registraciju na
// ISTOJ strani; posle ulaska Clerk ga vraća ovamo i dugme „Prihvati" je tu.
//
// ── povratak posle ulaska ────────────────────────────────────
// Isti mehanizam kao `/?nalog=nov&nazad=…`: `AuthEkran` sa `posle`. Tamo
// `internaPutanja()` brani od otvorene redirekcije jer vrednost dolazi iz
// query-ja; ovde je putanja sklopljena na serveru iz koda koji je već prošao
// `kodSchema` (samo `A-Z`, `0-9` i `-`), pa nema šta da se podmetne.
//
// ── šta strana otkriva ───────────────────────────────────────
// Tip, rok i kredite — ono što kod ionako daje onome ko ga ima. Ni mejl na koji
// je vezana ni napomenu. Da li pripada baš ovom nalogu kaže tek
// `redeem_invite`, pri prihvatanju (§9.4: „za drugu adresu").

import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { CalendarClock, Coins, CreditCard, Gift, ShieldCheck, TicketX } from "lucide-react";
import { getCurrentUserId } from "@/lib/auth";
import { citajPozivnicuZaStranu, type PozivnicaZaStranu } from "@/lib/pozivnice-pristup";
import {
  ISHOD_POZIVNICE,
  kodSchema,
  opisPozivnice,
  type StanjePozivnice,
} from "@/lib/pozivnice-schema";
import { plural } from "@/lib/ui-tekst";
import { LANDING_URL } from "@/lib/veze";
import { AuthEkran } from "@/components/auth-ekran";
import { Futer } from "@/components/futer";
import { PozivnicaPrihvati } from "@/components/pozivnica-prihvati";
import { PrekidacTemeDugme } from "@/components/prekidac-teme";
import { ZnakSaImenom } from "@/components/znak";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PraznoStanje } from "@/components/ui/stranica";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pozivnica",
  // Link je lični i nosi kod. U pretraživaču nema šta da traži.
  robots: { index: false, follow: false },
};

/** Stanje koje se vidi i bez prijave — iste rečenice kao iz rute (§9.4). */
const NEUPOTREBLJIVA: Record<Exclude<StanjePozivnice, "aktivna">, string> = {
  iskoriscena: ISHOD_POZIVNICE.used_up.poruka,
  istekla: ISHOD_POZIVNICE.expired.poruka,
  opozvana: ISHOD_POZIVNICE.revoked.poruka,
};

/** Segment putanje → normalizovan kod, ili `null` kad ni oblik nije ispravan. */
function procitajKod(sirov: string): string | null {
  let dekodiran: string;
  try {
    dekodiran = decodeURIComponent(sirov);
  } catch {
    return null;
  }
  const p = kodSchema.safeParse(dekodiran);
  return p.success ? p.data : null;
}

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const code = procitajKod((await params).code);

  const [userId, pozivnica] = await Promise.all([
    getCurrentUserId().catch((err: unknown) => {
      console.error("[pozivnica] čitanje Clerk sesije:", err);
      return null;
    }),
    code
      ? citajPozivnicuZaStranu(code).catch((err: unknown) => {
          console.error("[pozivnica] čitanje pozivnice:", err);
          return "greska" as const;
        })
      : Promise.resolve(null),
  ]);

  // Mejl prijavljenog naloga stoji iznad dugmeta: pozivnica vezana za adresu
  // pada sa „za drugu adresu", a čovek sa dva naloga mora da vidi kojim je unutra.
  const email = userId
    ? ((await currentUser().catch(() => null))?.primaryEmailAddress?.emailAddress ?? null)
    : null;

  return (
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[28rem]" />

      <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center justify-between px-5 sm:px-7 lg:px-8">
        <a href={LANDING_URL} className="rounded-lg">
          <ZnakSaImenom imeKlase="text-base" />
        </a>
        <div className="flex items-center gap-2">
          <PrekidacTemeDugme />
          {userId && (
            <Link
              href="/pretraga"
              className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              Aplikacija
            </Link>
          )}
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-[34rem] flex-1 flex-col items-center gap-7 px-5 pb-16 pt-[clamp(2rem,6vw,4.5rem)] sm:px-7">
        {pozivnica === "greska" ? (
          <PraznoStanje
            className="w-full"
            ikona={<TicketX />}
            naslov="Pozivnica trenutno ne može da se učita"
            opis="Baza ne odgovara. Pokušaj ponovo za koji minut — link i dalje važi."
          />
        ) : !code || !pozivnica ? (
          <PraznoStanje
            className="w-full"
            ikona={<TicketX />}
            naslov={ISHOD_POZIVNICE.not_found.poruka}
            opis={
              <>
                Proveri da li je link prekopiran do kraja. Generisan kod izgleda ovako:{" "}
                <span className="num text-fg">SAJT-XXXX-XXXX</span>.
              </>
            }
          >
            <Link
              href={userId ? "/pretraga" : "/"}
              className="text-sm font-medium text-accent-text underline underline-offset-4"
            >
              {userId ? "Nazad u aplikaciju" : "Na prijavu"}
            </Link>
          </PraznoStanje>
        ) : (
          <>
            <div className="text-center">
              <p className="eyebrow">Pozivnica</p>
              <h1 className="mt-3 text-balance text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2rem]">
                Pozivnica za {opisPozivnice(pozivnica.kind, pozivnica.kompDays, pozivnica.kompCredits)}
              </h1>
            </div>

            <Card className="w-full">
              <ul className="divide-y divide-border px-5">
                {STAVKE(pozivnica).map(({ Ikona, naziv, tekst }) => (
                  <li key={naziv} className="flex gap-3 py-3.5">
                    <Ikona className="mt-0.5 h-4 w-4 shrink-0 text-fg-faint" strokeWidth={2.2} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{naziv}</p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">{tekst}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3 border-t border-border bg-bg-subtle/60 px-5 py-3 text-xs text-fg-muted">
                <span>Kod</span>
                <span className="num text-fg">{code}</span>
              </div>
            </Card>

            {pozivnica.stanje !== "aktivna" ? (
              <Alert variant="warning" className="w-full">
                {NEUPOTREBLJIVA[pozivnica.stanje]} Ako misliš da je greška, javi se onome ko ti je
                poslao link.
              </Alert>
            ) : userId ? (
              <PozivnicaPrihvati code={code} email={email} />
            ) : (
              <>
                <p className="max-w-[25rem] text-center text-sm leading-relaxed text-fg-muted">
                  Otvori nalog ili se prijavi — posle toga se vraćaš ovde i prihvataš pozivnicu
                  jednim klikom.
                </p>
                <AuthEkran pocetni="registracija" posle={`/pozivnica/${code}`} />
              </>
            )}
          </>
        )}
      </main>

      <Futer />
    </div>
  );
}

/**
 * Šta pozivnica daje, u tri-četiri reda. Cena se ne ispisuje: iznos stoji na
 * `/cenovnik`, iz `plans.ts`, i to je jedino mesto (v. `app/page.tsx`).
 */
function STAVKE(p: PozivnicaZaStranu): { Ikona: typeof Gift; naziv: string; tekst: string }[] {
  if (p.kind === "prvi_mesec") {
    return [
      {
        Ikona: Gift,
        naziv: "Prvi mesec gratis",
        tekst: "Biraš plan na cenovniku; prvi mesec ne plaćaš ništa, od drugog ide cena plana.",
      },
      {
        Ikona: Coins,
        naziv: "Puni krediti od prvog dana",
        tekst: "Mesečna dodela plana stiže odmah, kao da je mesec plaćen.",
      },
      {
        Ikona: CreditCard,
        naziv: "Kartica je potrebna",
        tekst: "Otkazuješ kad hoćeš, iz aplikacije — pre drugog meseca ništa se ne naplaćuje.",
      },
    ];
  }

  const krediti = p.kompCredits ?? 0;
  return [
    {
      Ikona: ShieldCheck,
      naziv: "Pun pristup",
      tekst: "Skeniranje, otključavanje prospekata i poruke, sa limitima najvećeg plana.",
    },
    {
      Ikona: CalendarClock,
      naziv: "Rok",
      tekst: p.kompDays
        ? `${p.kompDays} ${plural(p.kompDays, "dan", "dana", "dana")} od prihvatanja.`
        : "Bez roka.",
    },
    ...(krediti > 0
      ? [
          {
            Ikona: Coins,
            naziv: "Krediti",
            tekst: `${krediti} ${plural(krediti, "kredit", "kredita", "kredita")} odmah po prihvatanju.`,
          },
        ]
      : []),
    {
      Ikona: CreditCard,
      naziv: "Bez kartice",
      tekst: "Nema pretplate ni naplate.",
    },
  ];
}
