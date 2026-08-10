// apps/worker/src/lib/user-agent.ts
// Token po kome nas tuđi sajt prepoznaje (pravilo 12). Isti za `fetch-site`,
// `robots` i Playwright — sajt koji nas blokira mora da nas blokira svuda.
//
// Živi u zasebnom fajlu, a ne u `fetch-site.ts`, samo zbog zavisnosti:
// `safe-url.ts` mu treba, a `fetch-site.ts` treba `safe-url.ts`. Bez ovog
// razdvajanja to je kružni import.

/**
 * Prepoznatljiv token uz Chrome kompatibilni deo. Chrome deo nije maskiranje
 * nego nužnost: pola zapuštenih sajtova stoji iza WAF-a koji odbija sve što ne
 * liči na pregledač, a taj sajt nam je najvredniji lead.
 */
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 Sajtoskop/1.0 " +
  "(+https://sajtoskop.com/bot)";

/** Bez našeg tokena. Rezerva za WAF-ove koji odbiju nepoznato ime. */
export const UA_PLAIN = UA.slice(0, UA.indexOf(" Sajtoskop/1.0"));
