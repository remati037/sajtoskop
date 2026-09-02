// apps/web/src/lib/cenovnik-namera-schema.ts
// Čitanje `?plan=`, `?ciklus=` i `?paket=` sa `/cenovnik`. Samo server —
// v. zaglavlje `lib/cenovnik-namera.ts` za razlog razdvajanja.
//
// ── zašto se nepoznata vrednost IGNORIŠE ───────────────────
// ‼️ Ovo je javan link sa TUĐE strane, ne API. `?plan=Pro`, `?ciklus=annual`
//    ili prosto zastareo link sa landinga koji nije redeploy-ovan ne smeju da
//    daju `400` ni crveni ekran — to je izgubljen kupac umesto cenovnika koji
//    radi. Zato svako polje ima `.catch(undefined)`: neispravna vrednost se
//    ponaša tačno kao da je nije bilo, a strana se otvara kao da je neko došao
//    na goli `/cenovnik`.
//
//    Zato ovde NEMA `safeParse` sa granom za grešku — šema po konstrukciji ne
//    može da padne.

import { z } from "zod";
import {
  BEZ_NAMERE,
  CIKLUS_IZ_LINKA,
  PAKET_IZ_LINKA,
  PLANOVI_U_LINKU,
  type Namera,
} from "@/lib/cenovnik-namera";

const nameraSchema = z.object({
  plan: z.enum(PLANOVI_U_LINKU).optional().catch(undefined),
  ciklus: z.enum(["mesecno", "godisnje"]).optional().catch(undefined),
  paket: z.enum(["50", "150"]).optional().catch(undefined),
});

/**
 * `searchParams` → namera, bez ijednog načina da padne.
 *
 * Niz vrednosti (`?plan=pro&plan=starter`) Next daje kao `string[]`; uzima se
 * prva, jer je to i ono što bi pregledač poslao iz forme. Sve ostalo pada na
 * `undefined` kroz šemu.
 */
export function citajNameru(
  params: Record<string, string | string[] | undefined>,
): Namera {
  const jedna = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const rezultat = nameraSchema.safeParse({
    plan: jedna(params.plan),
    ciklus: jedna(params.ciklus),
    paket: jedna(params.paket),
  });

  // Pojas i tregeri: `.catch()` na svakom polju znači da ovo ne može da se desi,
  // ali cena greške je ceo cenovnik, a cena provere je jedan `if`.
  if (!rezultat.success) return BEZ_NAMERE;

  const { plan, ciklus, paket } = rezultat.data;
  return {
    plan: plan ?? null,
    ciklus: ciklus ? CIKLUS_IZ_LINKA[ciklus] : null,
    paket: paket ? PAKET_IZ_LINKA[paket] : null,
  };
}
