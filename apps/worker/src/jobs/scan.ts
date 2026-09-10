// apps/worker/src/jobs/scan.ts
// Places Text Search → upsert `businesses` → `enrich_basic` po biznisu koji
// nema svež audit. Jedini posao u sistemu koji troši Google kvotu.
//
// ── koliko ovo košta ───────────────────────────────────────
// [S17] Jedan upit je TAČNO onoliko Places poziva koliko je stranica plaćeno:
// `maxResults` iz payloada (20 / 40 / 60) → 1 / 2 / 3 poziva → 1 / 2 / 3 kredita
// (LANSIRANJE §1.2). `spend_credit_and_scan` normalizuje `maxResults` na umnožak
// stranice pre nego što upiše posao, a `searchText` staje na tom broju stranica
// — pa skeniranje dublje od plaćenog ne može da nastane ni zaokruživanjem.
//
// Podrazumevano je JEDAN upit po scanu (`buildScanQueries` bez `deep` vraća
// jedan), pa je broj upita × broj stranica = broj poziva = cena.
//
// `SCAN_DEEP=1` cepa veliki grad po opštinama iz taksonomije. Beograd ima 15
// opština → 45 poziva, što je 60% dnevnog capa i 5% mesečnog za jednu pretragu
// jednog korisnika. Zato deep ima svoj tvrd limit (`SCAN_MAX_QUERIES`), nije u
// payloadu — web ga ne može poslati ni greškom — i postoji samo za ručno
// pokretanje. ‼️ Deep JESTE skeniranje dublje od plaćenog i zato NIKAD ne sme da
// se uključi na mašini koja vrti poslove iz weba.

import type { Business, City, Niche } from "@sajtoskop/shared";
import {
  buildQueries,
  buildScanQueries,
  foldForSearch,
  resolveCity,
  resolveNiche,
  stranicaZaRezultate,
} from "@sajtoskop/shared";
import { BudgetError } from "../lib/api-budget";
import { placeIdsNeedingAudit, recordScan, refundScan, upsertBusinesses, zapisiNapredak } from "../lib/db-writes";
import { searchText } from "../lib/places";
import { enqueueMany } from "../lib/queue";
import type { JobContext, JobResult } from "./types";
import { scanPayloadSchema } from "./types";

/** Tvrd limit na broj upita po scanu. Svaki upit je do 3 Places poziva (deep). */
const SCAN_MAX_QUERIES = Number(process.env.SCAN_MAX_QUERIES ?? 5);

/**
 * Firma iz susednog mesta koju je Google ubacio u rezultat nije lead za ovaj
 * grad. Poređenje je po celoj reči: „Šabački put" u Beogradu ne prolazi kao
 * Šabac, a firma u prigradskom naselju sa gradom u adresi prolazi.
 */
function filterToCity(businesses: Business[], cityLabel: string): {
  inCity: Business[];
  dropped: number;
} {
  const re = new RegExp(`\\b${foldForSearch(cityLabel).replace(/\s+/g, "\\s+")}\\b`);
  const inCity = businesses.filter((b) => re.test(foldForSearch(b.address)));
  return { inCity, dropped: businesses.length - inCity.length };
}

export type CollectResult = {
  inCity: Business[];
  apiCalls: number;
  partial: boolean;
  queryText: string;
};

/**
 * Zajednički deo `scan` i `refresh_google`: povuci iz Placesa, odbaci firme van
 * grada, upiši u `businesses`. Ono što ih razlikuje je šta se radi POSLE ovoga.
 */
export async function collectAndUpsert(
  city: City,
  niche: Niche,
  opts: { maxResults: number; countryCode: string },
  ctx: JobContext,
): Promise<CollectResult> {
  const deep = process.env.SCAN_DEEP === "1";
  const all = deep ? buildQueries(niche, city) : buildScanQueries(niche, city);
  const queries = all.slice(0, SCAN_MAX_QUERIES);

  if (queries.length < all.length) {
    ctx.log(
      `upita ${all.length} → skraćeno na ${queries.length} (SCAN_MAX_QUERIES). ` +
        `Izostavljeno: ${all.slice(SCAN_MAX_QUERIES).join(", ")}`,
    );
  }

  const seen = new Set<string>();
  const found: Business[] = [];
  let apiCalls = 0;
  let partial = false;

  for (const query of queries) {
    let batch: Awaited<ReturnType<typeof searchText>>;
    try {
      batch = await searchText(query, {
        maxResults: opts.maxResults,
        languageCode: "sr-Latn",
      });
    } catch (err) {
      // Budžet je pukao usred posla. Ako je nešto već prikupljeno, upisuje se —
      // bacanje prikupljenih podataka je bacanje već potrošenog novca (PRD §3).
      if (err instanceof BudgetError && found.length > 0) {
        ctx.log(`budžet stao usred scana: ${err.message}`);
        partial = true;
        break;
      }
      throw err;
    }

    apiCalls += batch.apiCalls;
    if (batch.partial) partial = true;

    for (const b of batch.businesses) {
      if (seen.has(b.placeId)) continue;
      seen.add(b.placeId);
      found.push(b);
    }

    if (found.length >= opts.maxResults && !deep) break;
  }

  const { inCity, dropped } = filterToCity(found, city.label);
  if (dropped > 0) ctx.log(`van grada, izbačeno ${dropped}`);

  const queryText = queries[0] ?? niche.query;

  if (inCity.length > 0) {
    await upsertBusinesses({
      businesses: inCity,
      citySlug: city.slug,
      nicheSlug: niche.slug,
      queryText,
      countryCode: opts.countryCode,
    });
  }

  return { inCity, apiCalls, partial, queryText };
}

export async function runScan(raw: unknown, ctx: JobContext): Promise<JobResult> {
  const payload = scanPayloadSchema.parse(raw);
  const city = resolveCity(payload.citySlug);
  const niche = resolveNiche(payload.nicheSlug);

  const { inCity, apiCalls, partial } = await collectAndUpsert(
    city,
    niche,
    { maxResults: payload.maxResults, countryCode: payload.countryCode },
    ctx,
  );

  // [S17] Dubina koju ovaj scan pokriva — ista formula iz koje je izvedena i
  // cena. Čita se iz `maxResults`, ne iz broja vraćenih firmi: Google ume da za
  // tri plaćene stranice vrati 25 rezultata, a korisnik je platio obim, ne broj.
  const stranica = stranicaZaRezultate(payload.maxResults);

  // Registar keša se upisuje pre svakog izlaza iz ove funkcije, i za prazan
  // rezultat (F9 §1). Prazno koje se ne zapamti naplaćuje se svakom sledećem
  // radoznalom korisniku redom, a svaki taj pokušaj su nova 3 Places poziva.
  const registrovan = await recordScan({
    countryCode: payload.countryCode,
    citySlug: city.slug,
    nicheSlug: niche.slug,
    count: inCity.length,
    jobId: ctx.job.id,
    // [Faza 6, 6.4] Parcijalan scan (budžet stao) se pamti kao takav — sledeći
    // korisnik vidi da kombinacija nije potpuna, i ponovno skeniranje ne
    // izgleda kao lažno svež rezultat (B5).
    partial,
    // [S17] Bez ovoga bi svaka kombinacija u kešu izgledala kao plitka i „Duboko"
    // bi se naplaćivalo iznova nad podacima koji već postoje.
    pages: stranica,
  });

  // Skenirano, ali neregistrovano. Za korisnika je to najgori mogući ishod:
  // posao je „done", pa nema ni pada ni povraćaja, a kombinacija i dalje nije u
  // kešu — ekran se isprazni i sledeći pokušaj se opet naplati. Posao se ne
  // obara (ponavljanje = novi Places pozivi), nego se kredit vraća odmah.
  let vracenoBezRegistra = 0;
  if (!registrovan) {
    vracenoBezRegistra = await refundScan(ctx.job.id);
    // `refundScan` vraća BROJ PLATILACA, ne zbir kredita — od S17 iznos po
    // platiocu nije uvek 1, pa bi „vraćeno N kredita" bio pogrešan broj u logu.
    ctx.log(
      `registar keša NIJE upisan — kombinacija ostaje van keša, ` +
        `kredit vraćen na ${vracenoBezRegistra} naloga`,
    );
  }

  if (inCity.length === 0) {
    // [Faza 3, 3.2] Napredak i za prazan rezultat — klijent vidi „0 nađeno"
    // umesto trake koja čeka.
    await zapisiNapredak(ctx.job.id, 0, 0);

    // Platio je skeniranje, dobio prazan ekran — kredit se vraća (F9, odluka 5).
    // Parcijalan scan sa nula rezultata ide istim putem: budžet je pukao pre
    // nego što je išta stiglo, dakle korisnik nema ništa za svoj kredit.
    const vraceno = await refundScan(ctx.job.id);

    return {
      note:
        `${city.label} · ${niche.label}: nijedan rezultat (${apiCalls} API poziva` +
        `${vraceno > 0 ? `, kredit vraćen na ${vraceno} naloga` : ""})`,
      ...(partial && { partial }),
    };
  }

  // [S25, §14.4] Manje stranica nego plaćeno → razlika nazad. `apiCalls` je
  // tačan broj napravljenih Places poziva: Google prestaje da vraća
  // `nextPageToken` kad nema više rezultata, pa je `stranica − apiCalls` tačno
  // ono što nije koštalo. Stoji POSLE grane za prazan rezultat i posle registra,
  // i to nije slučajno: `refund_scan` je idempotentan po (platilac, posao), pa
  // bi delimičan povraćaj upisan PRE punog (prazan rezultat, neupisan registar)
  // pun povraćaj proglasio duplikatom — korisnik bi ostao bez ostatka.
  let vracenoRazlika = 0;
  if (registrovan && apiCalls > 0 && apiCalls < stranica) {
    vracenoRazlika = await refundScan(ctx.job.id, apiCalls);
    ctx.log(
      `plaćeno ${stranica} ${stranica === 1 ? "stranica" : "stranice"}, Google dao ${apiCalls} — ` +
        `razlika vraćena na ${vracenoRazlika} naloga`,
    );
  }

  // Audit se namerno NE radi ovde: `scan` mora da završi za sekunde da bi lista
  // bila vidljiva. Preuzimanje sajtova je 1 zahtev/s po domenu i traje minutima.
  const needAudit = await placeIdsNeedingAudit(inCity.map((b) => b.placeId));

  // [Faza 3, 3.2] Početno stanje napretka: `analyzed` su auditi koji su već
  // postojali; svaki `enrich_basic` koji upiše audit diže broj
  // (inkrementirajAnalizu).
  await zapisiNapredak(ctx.job.id, inCity.length, inCity.length - needAudit.length);

  const created = await enqueueMany(
    needAudit.map((placeId) => ({
      type: "enrich_basic" as const,
      // scanJobId: za napredak na redu posla (3.2) — enrich_basic posle upisa
      // audita diže `analyzed` roditeljskog posla.
      payload: { placeId, scanJobId: ctx.job.id },
      dedupeKey: placeId,
    })),
  );

  return {
    note:
      `${city.label} · ${niche.label}: ${inCity.length} biznisa, ` +
      `${created} za analizu, ${apiCalls} API poziva${partial ? " (parcijalno)" : ""}` +
      (vracenoRazlika > 0 ? ` — razlika vraćena na ${vracenoRazlika} naloga` : "") +
      (registrovan ? "" : ` — BEZ REGISTRA KEŠA, kredit vraćen na ${vracenoBezRegistra} naloga`),
    ...(partial && { partial }),
  };
}
