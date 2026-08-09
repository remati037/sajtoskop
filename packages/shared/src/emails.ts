// packages/shared/src/emails.ts
// Vađenje mejlova iz HTML-a. Čist string posao — bez mreže, bez `node:`.
//
// Zašto je ovde, a ne u workeru: od F3 istu ekstrakciju koriste i `enrich_basic`
// posao i `pnpm harvest`. Dve kopije istog regexa bi se razišle prvi put kad
// naiđe nova obfuskacija, pa bi CLI i aplikacija davali različit mejl za isti
// sajt. Isti razlog zbog kog Ugly Score živi na jednom mestu (pravilo 6).
//
// Mreža ostaje pozivaocu: worker prosleđuje HTML koji je već preuzeo, CLI
// obilazi /kontakt i /o-nama sam.

/** Adrese koje su tehničke, ne kontakt. */
const GENERIC =
  /^(no-?reply|noreply|privacy|abuse|postmaster|webmaster|hostmaster|sentry|example|test|user|email|your|name|ime)@/i;

/** Ime fajla koje je regex pokupio kao mejl. */
const BAD_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|mp4|pdf)$/i;

/** Domeni alata, ne firmi. */
const BAD_DOMAIN = /@(sentry|wixpress|example|domain|sentry\.io|2x|w3\.org)/i;

/**
 * Svi upotrebljivi mejlovi iz HTML-a, poređani po korisnosti za outreach:
 * sopstveni domen → info@/kontakt@ → free mail → ostalo.
 *
 * `host` je domen sajta sa kog je HTML — služi samo za rangiranje.
 */
export function extractEmails(html: string, host: string): string[] {
  const found = new Set<string>();

  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const raw = m[1];
    if (!raw) continue;
    try {
      found.add(decodeURIComponent(raw).toLowerCase());
    } catch {
      /* neispravan percent-encoding, preskoči */
    }
  }

  for (const m of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    found.add(m[0].toLowerCase());
  }

  // Obfuskacija koja se stvarno viđa na domaćim sajtovima:
  // "ime (at) domen.rs", "ime [et] domen.rs", "ime (majmun) domen.rs"
  for (const m of html.matchAll(
    /([a-z0-9._%+-]+)\s*[([]\s*(?:at|et|@|majmun)\s*[)\]]\s*([a-z0-9.-]+\.[a-z]{2,})/gi,
  )) {
    found.add(`${m[1]}@${m[2]}`.toLowerCase());
  }

  const clean = [...found].filter(
    (e) =>
      !GENERIC.test(e) &&
      !BAD_EXT.test(e) &&
      !BAD_DOMAIN.test(e) &&
      e.length < 60 &&
      !e.includes("..") &&
      !/^\d+@/.test(e),
  );

  const bare = host.replace(/^www\./, "").toLowerCase();
  const rank = (e: string): number => {
    if (bare && e.endsWith(`@${bare}`)) return 0; // sopstveni domen
    if (/^(info|office|kontakt|contact|prodaja|sales|uprava)@/.test(e)) return 1;
    if (/@(gmail|yahoo|hotmail|outlook|mail)\./.test(e)) return 2; // free mail, i dalje koristan
    return 3;
  };

  return clean.sort((a, b) => rank(a) - rank(b));
}
