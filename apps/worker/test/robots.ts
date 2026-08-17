// apps/worker/test/robots.ts
// Pokretanje: pnpm --filter worker test  (ili `pnpm test` iz korena)
//
// Izuzetak od „testovi samo za ugly-score i spend_credit_and_unlock"
// (00-kontekst §7): ovaj parser odlučuje hoćemo li poštovati tuđu zabranu
// crawlinga sa fiksne IP adrese za koju je vezan i Places ključ. Greška ovde ne
// pravi pogrešan podatak nego blokiranu IP adresu.

import { isPathAllowed, parseRobots } from "../src/lib/robots";

let fail = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
};

const wp = `User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Sitemap: https://x.rs/sitemap.xml`;

let r = parseRobots(wp);
check(isPathAllowed(r, "/"), "WordPress: naslovna dozvoljena");
check(isPathAllowed(r, "/kontakt"), "WordPress: /kontakt dozvoljen");
check(!isPathAllowed(r, "/wp-admin/"), "WordPress: /wp-admin/ zabranjen");
check(isPathAllowed(r, "/wp-admin/admin-ajax.php"), "WordPress: Allow nadjačava Disallow");

r = parseRobots("User-agent: *\nDisallow: /");
check(!isPathAllowed(r, "/"), "Disallow: / blokira sve");

r = parseRobots("User-agent: *\nDisallow:");
check(isPathAllowed(r, "/bilo/sta"), "prazan Disallow ne blokira nista");

r = parseRobots(`User-agent: *
Disallow: /
User-agent: Sajtoskop
Disallow: /admin`);
check(isPathAllowed(r, "/kontakt"), "nasa grupa nadjacava *");
check(!isPathAllowed(r, "/admin"), "nasa grupa i dalje postuje svoj Disallow");

r = parseRobots("User-agent: *\nCrawl-delay: 5\nDisallow: /x");
check(r.delayMs === 5000, `Crawl-delay 5 -> ${r.delayMs}ms`);

r = parseRobots("User-agent: *\nCrawl-delay: 0.2\nDisallow: /x");
check(r.delayMs === 1000, `Crawl-delay 0.2 -> ${r.delayMs}ms (nas minimum od 1s pobedjuje)`);

r = parseRobots("# sve zakomentarisano\nUser-agent: *  # nas\nDisallow: /tajno # zasto ne");
check(!isPathAllowed(r, "/tajno/x"), "komentari se seku");

r = parseRobots("");
check(isPathAllowed(r, "/"), "prazan robots.txt = sve dozvoljeno");

r = parseRobots("User-agent: Googlebot\nDisallow: /");
check(isPathAllowed(r, "/"), "grupa za tudji bot nas ne dodiruje");

r = parseRobots("User-agent: *\nDisallow: /wp-*/uploads");
check(!isPathAllowed(r, "/wp-content/uploads"), "wildcard u sredini se poklapa");
check(isPathAllowed(r, "/wp-content/slike"), "wildcard ne blokira ono sto se ne poklapa");

// Regresija, avgust 2026: WooCommerce ovo upisuje u svaki robots.txt, a raniji
// parser ga je svodio na prefiks `/` i blokirao ceo sajt. Svaki WordPress sa
// WooCommerceom je zbog toga ostajao bez audita i bez Ugly Score-a.
r = parseRobots(`User-agent: *
Disallow: /wp-content/uploads/wc-logs/
Disallow: /*?add-to-cart=
Disallow: /*?*add-to-cart=
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php`);
check(isPathAllowed(r, "/"), "WooCommerce: naslovna dozvoljena");
check(isPathAllowed(r, "/kontakt"), "WooCommerce: /kontakt dozvoljen");
check(!isPathAllowed(r, "/wp-admin/"), "WooCommerce: /wp-admin/ i dalje zabranjen");
check(isPathAllowed(r, "/wp-admin/admin-ajax.php"), "WooCommerce: Allow i dalje nadjacava");
check(!isPathAllowed(r, "/proizvod?add-to-cart=12"), "WooCommerce: add-to-cart zabranjen");

// Yoast dopisuje drugu grupu za `*` sa praznim Disallow — ne sme da obrise
// pravila iz prve, ali ne sme ni da ih pojaca.
r = parseRobots(`User-agent: *
Disallow: /wp-admin/

User-agent: *
Disallow:`);
check(isPathAllowed(r, "/"), "Yoast blok: naslovna dozvoljena");
check(!isPathAllowed(r, "/wp-admin/"), "Yoast blok: prva grupa i dalje vazi");

r = parseRobots("User-agent: *\nDisallow: /*.pdf$");
check(!isPathAllowed(r, "/cenovnik.pdf"), "sufiks $ blokira .pdf");
check(isPathAllowed(r, "/cenovnik.pdf.html"), "sufiks $ sidri kraj putanje");

console.log(fail === 0 ? "\nSve proslo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
