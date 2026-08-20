// apps/web/src/lib/search-schema.ts
// Ugovor tela `POST /api/search`. Stoji odvojeno od rute da bi mogao da se
// proveri bez podizanja Next-a — ruta je tanka i ne sme da krije logiku.

import { z } from "zod";
import { CITY_SLUGS, DUBINE, NICHE_SLUGS, PODRAZUMEVANA_DUBINA } from "@sajtoskop/shared";
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

  /**
   * [S17] Koliko duboko skenirati — i time koliko kredita to košta (1/2/3).
   *
   * Zatvoren skup iz `@sajtoskop/shared`, nikad slobodan broj rezultata: kad bi
   * klijent slao `maxResults`, mogao bi da traži 60 rezultata pošto je na ekranu
   * video cenu za 20. Ovako server sam prevodi ponudu u broj stranica, na jednom
   * mestu, iz istog izvora iz kog je cena i prikazana.
   *
   * Podrazumevano „Standardno" — isto što je do S17 koštalo svako skeniranje.
   * Nema dejstva na besplatnom putu osim jednog: pogodak u kešu je uslovan i po
   * dubini, pa `dubina` odlučuje i da li je pretraga uopšte besplatna.
   */
  dubina: z.enum(DUBINE).default(PODRAZUMEVANA_DUBINA),

  /**
   * Korisnik je u modalu potvrdio trošak (F9 §3). Bez ovoga se kredit NIKAD ne
   * skida — pretraga bez `pay` je uvek ili besplatna, ili vrati `needs_scan` sa
   * cenom. Podrazumevana vrednost je zato `false`, a ne izostavljeno polje:
   * zaboravljena provera u ruti tada ne naplaćuje, nego odbija.
   */
  pay: z.boolean().default(false),

  /**
   * Ponovo skeniraj i kad je keš svež (F9, odluka 7 — tekstualno dugme „Osveži"
   * i „Skeniraj ipak ponovo" nad praznom kombinacijom). Bez `pay` nema dejstva.
   */
  force: z.boolean().default(false),
});

export type SearchBody = z.infer<typeof searchBodySchema>;
