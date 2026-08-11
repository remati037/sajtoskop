// apps/web/src/lib/pipeline-tipovi.ts
// Ugovor između kanbana i njegovog UI-ja. Namerno BEZ `import "server-only"` —
// ovaj fajl uvozi klijentska komponenta, pa ne sme da povuče Supabase klijent.
//
// Isti rascep kao `search-types.ts` naspram `public-lead.ts`: ovde su tipovi i
// konstante, a sve što dodiruje bazu je u `pipeline.ts`, koji jeste `server-only`.
//
// `MojLead` se uvozi kao TIP iz `moja-lista.ts` — `import type` se pri
// prevođenju briše, pa `server-only` iz tog modula ne stiže u bundle.

import type { LeadChannel, LeadStatusValue } from "@sajtoskop/shared";
import type { MojLead } from "./moja-lista";

/** Redosled kolona u kanbanu. Jedini izvor tog redosleda u aplikaciji. */
export const KOLONE: readonly LeadStatusValue[] = [
  "nekontaktiran",
  "kontaktiran",
  "odgovorio",
  "potpisan",
  "nezainteresovan",
] as const;

export const KOLONA_LABEL: Record<LeadStatusValue, string> = {
  nekontaktiran: "Nekontaktiran",
  kontaktiran: "Kontaktiran",
  odgovorio: "Odgovorio",
  potpisan: "Potpisan",
  nezainteresovan: "Nezainteresovan",
};

/**
 * Otključan prospekt sa svojim mestom u levku.
 *
 * Lead bez reda u `lead_status` je `nekontaktiran`; ta podrazumevana vrednost se
 * ne materijalizuje pri otključavanju, nego se popunjava pri čitanju
 * (v. `getPipeline`).
 */
export type PipelineKartica = MojLead & {
  status: LeadStatusValue;
  note: string | null;
  channel: LeadChannel | null;
  /** Datum PRVOG kontakta. `null` tačno kad je status `nekontaktiran`. */
  contactedAt: string | null;
};
