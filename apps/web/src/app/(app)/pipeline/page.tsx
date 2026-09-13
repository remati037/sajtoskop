// apps/web/src/app/(app)/pipeline/page.tsx
// Kanban otključanih prospekata (F7 §3).
//
// Ovaj ekran zamenjuje `pipeline-biznisi` Sheet (F7 §4). Status „Potpisan" je
// jedini podatak u proizvodu koji konkurent ne može ni da kupi ni da kopira, i
// jedini koji raste s vremenom — zato je kanban, a ne generator poruka, deo ove
// faze koji se ne preskače.

import type { Metadata } from "next";
import Link from "next/link";
import { KanbanSquare } from "lucide-react";
import { CITIES, NICHES } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { zahtevajOnboarding } from "@/lib/onboarding";
import { zahtevajCitanje } from "@/lib/pristup";
import { getPipeline } from "@/lib/pipeline";
import { PipelineTabla } from "@/components/pipeline-tabla";
import { PipelineUvoz } from "@/components/pipeline-uvoz";
import { VezaGreska } from "@/components/veza-greska";
import { Button } from "@/components/ui/button";
import { PraznoStanje, ZaglavljeStranice } from "@/components/ui/stranica";
import { FaliMikro } from "@/components/fali-mikro";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pipeline" };

export default async function Page() {
  // Prva linija svake zaštićene stranice — ni middleware ni layout ovo ne rade.
  await requireSession();

  // Isto kao na „Mojoj listi": kvar veze daje `profile === null` i poruku, pa
  // prazan niz ovde nikad ne izgleda kao „nemaš nijedan prospekt".
  //
  // S19: kapija pristupa uz podatak, ne u layout-u — layout se ne izvršava
  // ponovo pri klijentskoj navigaciji. Zaključan nalog ide na `/zakljucano`;
  // `grace` PROLAZI, jer je čitanje svog rada ceo smisao grace perioda (§1.5).
  //
  // Ide u isti `Promise.all` i vraća profil koji je ionako trebao ovoj strani —
  // dakle kapija ne košta nijedan dodatan upit nad `profiles`. `redirect()` iz
  // nje se kroz `Promise.all` uredno propagira.
  const [kartice, { profile, pristup }] = await Promise.all([
    getPipeline().catch((err: unknown) => {
      console.error("[pipeline] čitanje kartica:", err);
      return [];
    }),
    zahtevajCitanje(),
  ]);

  // [S30, §1.8] Treća linija: nov nalog sa pristupom ide u čarobnjak.
  zahtevajOnboarding(profile, pristup);

  // [S30, §4.7] Prazan pipeline je „0 `lead_status`", ne „0 otključanih":
  // otključan prospekt bez reda je u levku samo po podrazumevanoj vrednosti.
  const imaRedova = kartice.some((k) => k.uPipelineu);

  const cityLabels = Object.fromEntries(CITIES.map((c) => [c.slug, c.label]));
  const nicheLabels = Object.fromEntries(NICHES.map((n) => [n.slug, n.label]));

  return (
    <div className="mx-auto w-full max-w-[110rem] px-4 py-8 sm:px-6 lg:px-8">
      <ZaglavljeStranice
        naslov="Pipeline"
        opis={
          <>
            Prevuci karticu da promeniš status. Kopiranje poruke samo prebacuje prospekt u
            „Kontaktiran" — nazad ga vraćaš ti, ne alat.
          </>
        }
      >
        <PipelineUvoz />
      </ZaglavljeStranice>

      {/* Isti redosled kao na „Mojoj listi": prvo se isključuje pokvarena veza,
          pa tek onda ide prazno stanje. Obrnuto bi značilo da RLS koji ne
          prepoznaje korisnika izgleda kao „nemaš nijedan prospekt". */}
      {!profile ? (
        <VezaGreska sta="Pipeline" />
      ) : !imaRedova ? (
        <>
        <PraznoStanje
          ikona={<KanbanSquare />}
          naslov="Pipeline je prazan dok ne pošalješ prvu poruku"
          opis="Kad kopiraš poruku, klik na „Kontaktiran“ dovodi prospekt ovde. Pet kolona: Nekontaktiran → Kontaktiran → Odgovorio → Potpisan → Nezainteresovan."
        >
          <Button asChild variant="primary">
            <Link href={kartice.length > 0 ? "/lista" : "/pretraga"}>Idi na otključane prospekte</Link>
          </Button>
        </PraznoStanje>

          {/* [S29 §5.3 C] Prazno posle nedelju dana više nije „nisam stigao"
              nego „nešto ne valja". Prag je u komponenti, jer je svojstvo ovog
              mesta, a ne pravilo motora. */}
          <FaliMikro posleDana={7} className="mx-auto mt-4 w-full max-w-lg" />
        </>
      ) : (
        <PipelineTabla kartice={kartice} cityLabels={cityLabels} nicheLabels={nicheLabels} />
      )}
    </div>
  );
}
