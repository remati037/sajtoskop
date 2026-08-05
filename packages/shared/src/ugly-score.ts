// src/ugly-score.ts
// Ugly Score — koliko je sajt zapušten. Čista funkcija, bez zavisnosti od mreže.
// VAŽNO: težine i heuristike NIKAD ne idu u klijentski bundle (bezbednost-i-zastita.md, Sloj 2).

import { pathToFileURL } from "node:url";

export type Band = "kritican" | "los" | "osrednji" | "solidan";

export type Signal = {
  key: string;
  points: number;
  /** Rečenica koju doslovno možeš staviti u cold poruku. */
  label: string;
};

export type ScoreInput = {
  html: string;
  httpsOk: boolean;
  loadMs: number | null;
  finalUrl: string | null;
};

export type ScoreResult = {
  score: number;          // 0-100, veće = gore
  band: Band;
  signals: Signal[];
  platform: Platform;
  topIssue: string | null;
};

export type Platform =
  | "WordPress" | "Joomla" | "Drupal" | "Wix" | "Squarespace"
  | "Shopify" | "Blogger" | "Weebly" | "custom";

// ── pomoćne ────────────────────────────────────────────────

const has = (html: string, re: RegExp): boolean => re.test(html);

const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;

/** <head> deo — dovoljno za većinu meta provera, brže od celog dokumenta. */
function head(html: string): string {
  const m = /<head[\s>][\s\S]{0,20000}?<\/head>/i.exec(html);
  return m ? m[0] : html.slice(0, 20_000);
}

/** Srpska deklinacija: 1 godinu, 2-4 godine, 5+ godina. */
function godina(n: number): string {
  const d1 = n % 10;
  const d2 = n % 100;
  if (d1 === 1 && d2 !== 11) return "godinu";
  if (d1 >= 2 && d1 <= 4 && !(d2 >= 12 && d2 <= 14)) return "godine";
  return "godina";
}

// ── detekcija platforme ────────────────────────────────────

export function detectPlatform(html: string): Platform {
  if (has(html, /wp-content|wp-includes|wp-json/i)) return "WordPress";
  if (has(html, /\/media\/jui\/|com_content|Joomla!|\/templates\/[a-z0-9_-]+\/css\/template\.css/i)) return "Joomla";
  if (has(html, /sites\/default\/files|drupal\.js|Drupal\.settings/i)) return "Drupal";
  if (has(html, /static\.parastorage\.com|wix\.com|X-Wix-/i)) return "Wix";
  if (has(html, /squarespace|static1\.squarespace\.com/i)) return "Squarespace";
  if (has(html, /cdn\.shopify\.com|Shopify\.theme/i)) return "Shopify";
  if (has(html, /blogspot\.com|blogger\.com/i)) return "Blogger";
  if (has(html, /weebly\.com/i)) return "Weebly";
  return "custom";
}

// ── copyright godina ───────────────────────────────────────

/** Najveća godina uz © ili "sva prava". null ako je nema. */
export function copyrightYear(html: string): number | null {
  const now = new Date().getFullYear();
  const years: number[] = [];
  const re = /(?:©|&copy;|copyright|sva prava|all rights)[^<>]{0,40}?((?:19|20)\d{2})/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const y = Number(m[1]);
    if (y >= 1995 && y <= now + 1) years.push(y);
  }
  return years.length ? Math.max(...years) : null;
}

// ── glavni skor ────────────────────────────────────────────

export function scoreSite(input: ScoreInput): ScoreResult {
  const { html, httpsOk, loadMs } = input;
  const h = head(html);
  const year = new Date().getFullYear();
  const signals: Signal[] = [];

  const add = (key: string, points: number, label: string) =>
    signals.push({ key, points, label });

  const hasViewport = has(h, /<meta[^>]+name=["']?viewport/i);

  // ── TEŠKI (svaki sam po sebi znači "ovo treba menjati") ──

  // Najjači signal na srpskom tržištu: sajt se ne otvara na telefonu
  if (!hasViewport) {
    add("no_viewport", 30, "Sajt nije prilagođen telefonu");
  }

  if (!httpsOk) {
    add("no_https", 22, "Nema HTTPS — Chrome ga označava kao nebezbedan");
  }

  const cy = copyrightYear(html);
  if (cy !== null) {
    const age = year - cy;
    if (age >= 6) add("copyright_ancient", 20, `Copyright ${cy} — nije diran ${age} ${godina(age)}`);
    else if (age >= 3) add("copyright_old", 12, `Copyright ${cy} — nije ažuriran ${age} ${godina(age)}`);
  }

  // Prag od 3 razdvaja "ceo sajt je tako pravljen" od "jedna tabela sa cenovnikom"
  if (count(html, /<table[\s>]/gi) >= 3 && !hasViewport) {
    add("table_layout", 18, "Napravljen tabelama, tehnologijom iz 2005.");
  }

  // marquee se vidi golim okom — sam po sebi dovoljan
  if (has(html, /<marquee[\s>]/i)) {
    add("marquee", 16, "Na sajtu se tekst pomera levo-desno — efekat iz devedesetih");
  }

  if (count(html, /<(?:font|center)[\s>]/gi) >= 3) {
    add("legacy_tags", 12, "Koristi HTML tagove izbačene pre 15 godina");
  }

  if (has(html, /<frameset|<frame[\s>]/i)) {
    add("frames", 20, "Napravljen frejmovima");
  }

  if (has(html, /\.swf["'\s>]|application\/x-shockwave-flash/i)) {
    add("flash", 20, "Sadrži Flash — ne radi ni u jednom modernom browseru");
  }

  // ── SREDNJI ──

  const jq = /jquery[.-](\d+)\.(\d+)[\d.]*(?:\.min)?\.js/i.exec(html);
  if (jq && Number(jq[1]) < 2) {
    add("jquery_old", 8, `jQuery ${jq[1]}.${jq[2]} — verzija sa poznatim propustima`);
  }

  if (!has(h, /<title[\s>][^<]*\S/i)) {
    add("no_title", 10, "Nema naslov stranice — loše za Google");
  }
  if (!has(h, /<meta[^>]+name=["']?description/i)) {
    add("no_description", 7, "Nema meta opis — Google prikazuje nasumičan tekst");
  }
  if (!has(h, /rel=["']?(?:shortcut )?icon/i)) {
    add("no_favicon", 4, "Nema favicon");
  }
  if (!has(h, /<meta[^>]+property=["']?og:/i)) {
    add("no_og", 5, "Bez Open Graph — deljenje na Fejsbuku izgleda loše");
  }

  // Sporo učitavanje — dopunski signal, ovo je jedno merenje
  if (loadMs !== null && loadMs > 5000) {
    add("very_slow", 10, `Učitavanje ${(loadMs / 1000).toFixed(1)}s`);
  } else if (loadMs !== null && loadMs > 3000) {
    add("slow", 5, `Učitavanje ${(loadMs / 1000).toFixed(1)}s`);
  }

  if (html.length < 2000) {
    add("thin", 8, "Skoro prazna stranica");
  }

  const raw = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.min(100, raw);

  const band: Band =
    score >= 70 ? "kritican" :
    score >= 45 ? "los" :
    score >= 20 ? "osrednji" : "solidan";

  const sorted = [...signals].sort((a, b) => b.points - a.points);

  return {
    score,
    band,
    signals: sorted,
    platform: detectPlatform(html),
    topIssue: sorted[0]?.label ?? null,
  };
}

// ── samotest: pnpm exec tsx src/ugly-score.ts ───────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modern = `<html><head><meta name="viewport" content="width=device-width">
    <title>Ordinacija</title><meta name="description" content="x">
    <meta property="og:title" content="x"><link rel="icon" href="/f.ico">
    </head><body>${"tekst ".repeat(500)}<p>&copy; ${new Date().getFullYear()}</p></body></html>`;

  const meh = `<html><head><title>Ordinacija</title></head>
    <body>${"tekst ".repeat(500)}<p>&copy; ${new Date().getFullYear() - 4}</p></body></html>`;

  const ancient = `<html><head><title>Ordinacija</title></head><body>
    <table><tr><td><table><tr><td><table><tr><td>
    <font size="2">Dobrodosli</font></td></tr></table></td></tr></table></td></tr></table>
    <center><font color="red">Akcija</font></center><marquee>Novo!</marquee>
    <script src="/js/jquery-1.7.2.min.js"></script>
    ${"tekst ".repeat(400)}<center>&copy; 2011</center></body></html>`;

  // jedan <center> u modernom sajtu ne sme da upali legacy_tags
  const modernWithOneCenter = modern.replace("</body>", "<center>Radno vreme</center></body>");

  const cases: [string, string, Band][] = [
    ["moderan", modern, "solidan"],
    ["moderan +center", modernWithOneCenter, "solidan"],
    ["osrednji", meh, "los"],
    ["iz 2011", ancient, "kritican"],
  ];

  let fail = 0;
  for (const [name, html, expected] of cases) {
    const r = scoreSite({ html, httpsOk: true, loadMs: 800, finalUrl: null });
    const ok = r.band === expected;
    if (!ok) fail++;
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(16)} skor ${String(r.score).padStart(3)} · ${r.band} · ${r.platform}`);
    console.log(`   ${r.signals.map((s) => `${s.key}(${s.points})`).join(" ") || "—"}`);
    if (!ok) console.log(`   očekivano: ${expected}`);
  }
  console.log(fail === 0 ? "\nSva četiri prošla." : `\n${fail} palo.`);
}