// apps/web/src/lib/search-schema.ts
// Ugovor tela `POST /api/search`. Stoji odvojeno od rute da bi mogao da se
// proveri bez podizanja Next-a — ruta je tanka i ne sme da krije logiku.

import { z } from "zod";
import { CITY_SLUGS, NICHE_SLUGS } from "@sajtoskop/shared";
import { MAX_PAGE } from "./search-types";

// `strictObject`: nepoznat ključ je greška, ne šum. Da neko ne pokuša da provuče
// `pageSize` ili `limit` i tako napravi bulk endpoint koji PRD izričito zabranjuje.
export const searchBodySchema = z.strictObject({
  // Allowlist iz taksonomije, nikad slobodan tekst — ovo je jedini razlog zašto
  // je bezbedno slati vrednost dalje u `eq()` filter.
  // Poruka je naša, ne Zodova: podrazumevana ispisuje svih 54 grada u odgovoru,
  // a korisnik ovu grešku vidi samo sa zastarelog linka.
  city: z.enum(CITY_SLUGS, { error: "Nepoznat grad." }),
  niche: z.enum(NICHE_SLUGS, { error: "Nepoznata niša." }),
  filters: z
    .strictObject({
      onlyNoSite: z.boolean().default(false),
      onlySocial: z.boolean().default(false),
      onlyDead: z.boolean().default(false),
      minScore: z.number().int().min(0).max(100).optional(),
    })
    // `.prefault({})`, ne `.default({})`: u Zod 4 `default` prima GOTOV izlazni
    // objekat (sva tri boolean-a), dok `prefault` propušta `{}` kroz šemu i pusti
    // ugnežđene `.default(false)` da odrade svoje. PRD-ov snippet se ne kompajlira.
    .prefault({}),
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
});

export type SearchBody = z.infer<typeof searchBodySchema>;
