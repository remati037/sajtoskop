// apps/worker/src/jobs/monthly-grant.ts
// Mesečna dodela kredita (F4 §2). Reset na `plan.monthlyCredits`, bez rollovera.
//
// Zašto posao, a ne cron u Supabase-u: red poslova već ima retry, backoff i
// žetvu zaglavljenih. Posao koji na pola pukne (Supabase odbio zahtev) vraća se
// u red i nastavlja, a korisnici kojima je dodela već upisana se preskaču po
// `ref_id`-u. Cron bi za to isto tražio svoju logiku ponavljanja.
//
// Idempotencija je u bazi, ne ovde: `grant_monthly_credits` odbija drugi poziv
// sa istim `ref_id` (mesec). Zato je bezbedno pustiti isti posao dvaput.

import { planFor } from "@sajtoskop/shared";
import type { MonthlyGrantResult, ProfileRow } from "@sajtoskop/shared";
import { supabaseAdmin } from "../lib/supabase";
import type { JobContext, JobResult } from "./types";
import { monthlyGrantPayloadSchema } from "./types";

/** Koliko profila se čita odjednom. Beta ima desetine korisnika; ovo je za posle. */
const STRANA = 500;

type ProfileSlice = Pick<ProfileRow, "id" | "plan">;

export async function runMonthlyGrant(raw: unknown, ctx: JobContext): Promise<JobResult> {
  const { month } = monthlyGrantPayloadSchema.parse(raw);
  const db = supabaseAdmin();

  let dodeljeno = 0;
  let preskoceno = 0;
  let palo = 0;
  let ukupnoDelta = 0;
  let od = 0;

  for (;;) {
    const { data, error } = await db
      .from("profiles")
      .select("id, plan")
      .order("id", { ascending: true })
      .range(od, od + STRANA - 1)
      .returns<ProfileSlice[]>();

    if (error) throw new Error(`Čitanje profila nije uspelo: ${error.message}`);

    const profili = data ?? [];
    if (profili.length === 0) break;

    for (const profil of profili) {
      const target = planFor(profil.plan).monthlyCredits;

      const { data: res, error: rpcErr } = await db.rpc("grant_monthly_credits", {
        p_user: profil.id,
        p_target: target,
        p_ref_id: month,
      });

      if (rpcErr) {
        // Jedan korisnik ne obara dodelu za sve ostale. Posao se svejedno
        // završava kao neuspeh (v. ispod), pa se ponavlja i njega pokupi.
        palo++;
        ctx.log(`${profil.id}: ${rpcErr.message}`);
        continue;
      }

      const row = ((res ?? []) as MonthlyGrantResult[])[0];
      if (!row) {
        palo++;
        continue;
      }

      if (row.reason === "already_granted") preskoceno++;
      else if (row.ok) {
        dodeljeno++;
        ukupnoDelta += row.delta;
      } else {
        palo++;
        ctx.log(`${profil.id}: ${row.reason}`);
      }
    }

    if (profili.length < STRANA) break;
    od += STRANA;
  }

  // Neuspeh nekih korisnika MORA da obori posao: inače se `monthly_grant` za taj
  // mesec zavede kao `done` i niko nikad ne sazna da 3 čoveka nemaju kredite.
  // Ponovljeni pokušaj preskače one koji su prošli — dodela je idempotentna.
  if (palo > 0) {
    throw new Error(
      `${month}: ${dodeljeno} dodeljeno, ${preskoceno} preskočeno, ${palo} nije uspelo`,
    );
  }

  return {
    note:
      `${month}: ${dodeljeno} ${dodeljeno === 1 ? "korisnik" : "korisnika"} dobilo kredite ` +
      `(neto ${ukupnoDelta >= 0 ? "+" : ""}${ukupnoDelta}), ${preskoceno} već imalo dodelu`,
  };
}
