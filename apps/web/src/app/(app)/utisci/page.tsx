// apps/web/src/app/(app)/utisci/page.tsx
// „Moje prijave" (F11 §6.4) — zatvaranje petlje: korisnik vidi šta je poslao i
// šta je od toga ispalo.
//
// Stavka stoji u meniju „Nalog", ne u „Rad": ovde se ne radi nego proverava —
// isti razlog zbog kog su i Krediti tamo.
//
// Otvaranje ekrana upisuje `seen_at` i nulira `feedback_unseen_count` (tačka na
// plutajućem dugmetu nestaje). To ide kroz `after()`, dakle posle odgovora —
// baš tada je spisak stvarno viđen.
//
// [ODSTUPANJE od F11 §6.4] Čita se direktno iz serverske komponente, ne kroz
// API rutu — isto obrazloženje kao za ekrane konzole (v. `lib/moje-prijave.ts`).

import type { Metadata } from "next";
import { after } from "next/server";
import { Inbox } from "lucide-react";
import type { FeedbackStatus } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { citajMojePrijave, oznaciVidjeno, type MojaPrijava } from "@/lib/moje-prijave";
import { zahtevajCitanje } from "@/lib/pristup";
import { cn } from "@/lib/cn";
import { formatDatum } from "@/lib/ui-tekst";
import { PraznoStanje, ZaglavljeStranice } from "@/components/ui/stranica";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moje prijave" };

/**
 * Kako se status prikazuje KORISNIKU (F11 §6.4).
 *
 * „Odbijeno bez obrazloženja se prikazuje kao pročitano" — čovek koji vidi
 * „odbijeno" bez reči više ne piše. Isto važi za duplikat: ishod bez reči je
 * „Pročitano", ishod sa `user_note`-om je imenovan i obrazložen.
 */
function prikazStatusa(
  status: FeedbackStatus,
  userNote: string | null,
): { label: string; boja: string } {
  switch (status) {
    case "reseno":
      return { label: "Rešeno", boja: "text-accent-text" };
    case "u_radu":
      return { label: "U radu", boja: "text-info-text" };
    case "odbijeno":
      return userNote
        ? { label: "Odbijeno", boja: "text-fg-muted" }
        : { label: "Pročitano", boja: "text-fg-faint" };
    case "duplikat":
      return userNote
        ? { label: "Duplikat", boja: "text-fg-muted" }
        : { label: "Pročitano", boja: "text-fg-faint" };
    default:
      return { label: "Novo", boja: "text-fg-muted" };
  }
}

export default async function Page() {
  // Prva linija svake zaštićene stranice (pravilo 8).
  const userId = await requireSession();

  // S19: kapija pristupa uz podatak, ne u layout-u — layout se ne izvršava
  // ponovo pri klijentskoj navigaciji. Zaključan nalog ide na `/zakljucano`;
  // `grace` PROLAZI, jer je čitanje svog rada ceo smisao grace perioda (§1.5).
  await zahtevajCitanje();

  let prijave: MojaPrijava[] = [];
  try {
    prijave = await citajMojePrijave(userId);
  } catch (err) {
    console.error("[utisci] čitanje prijava:", err);
  }

  // Označi kao viđeno posle odgovora — tačka sa dugmeta nestaje.
  after(() => oznaciVidjeno(userId));

  const poslate = prijave.length;
  const resene = prijave.filter((p) => p.red.status === "reseno").length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Moje prijave"
        opis={
          poslate > 0
            ? `${poslate} ${poslate === 1 ? "poslata" : "poslate"} · ${resene} ${resene === 1 ? "rešena" : "rešene"}`
            : 'Sve što pošalješ kroz dugme „Utisak" staje ovde, sa ishodom kad ga obradim.'
        }
      />

      {prijave.length === 0 ? (
        <PraznoStanje
          ikona={<Inbox />}
          naslov="Nemaš nijednu prijavu."
          opis='Dugme „Utisak" je u donjem desnom uglu svakog ekrana. Ocena je dovoljna — tekst, slika i dnevnik grešaka su dopuna.'
        />
      ) : (
        <ul className="mt-5 space-y-3">
          {prijave.map(({ red, sadrzaj }) => (
            <PrijavaRed key={red.id} prijava={{ red, sadrzaj }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PrijavaRed({ prijava }: { prijava: MojaPrijava }) {
  const { red, sadrzaj } = prijava;
  const status = prikazStatusa(red.status, red.user_note);

  return (
    <li className="rounded-xl border border-border bg-bg-elev p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex items-center gap-1.5 text-xs font-semibold", status.boja)}>
          <span
            aria-hidden
            className={cn("h-2 w-2 rounded-full", tackaBoja(red.status))}
          />
          {status.label}
        </span>

        <span className="num text-xs text-fg-muted">{formatDatum(red.created_at)}</span>
      </div>

      <p className="mt-2 text-sm leading-relaxed">{sadrzaj}</p>

      {/* Obrazloženje je ono što petlju zatvara: „popravljeno, hvala" — ne
          „prikazano kao rešeno". */}
      {red.user_note && (
        <p className="mt-2 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm text-fg-muted">
          {red.user_note}
        </p>
      )}

      {(red.reward_credits > 0 || red.status === "u_radu") && (
        <div className="mt-2.5 flex items-center gap-2">
          {red.reward_credits > 0 && (
            <Badge variant="neutral" size="sm" className="num">
              +{red.reward_credits} kredita
            </Badge>
          )}
          {red.status === "u_radu" && (
            <span className="text-[11px] text-fg-muted">
              Još se obrađuje — javljam se kad bude ishoda.
            </span>
          )}
        </div>
      )}
    </li>
  );
}

/** Ista paleta kao statusi u konzoli, samo kroz tokene (dizajn sistem). */
function tackaBoja(status: FeedbackStatus): string {
  switch (status) {
    case "reseno":
      return "bg-accent";
    case "u_radu":
    case "priznato":
      return "bg-info";
    default:
      return "bg-fg-faint";
  }
}
