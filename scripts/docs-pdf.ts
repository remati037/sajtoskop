// scripts/docs-pdf.ts — PDF za štampu iz checkliste, plana testiranja i roadmap-a.
//
//   pnpm docs:pdf
//
// Pravi `docs/lansiranje-checklista.pdf`, `docs/plan-testiranja.pdf` i `docs/roadmap.pdf`
// iz istoimenih `.md` fajlova. Markdown je izvor istine; PDF se pušta posle svake izmene.
//
// Konvertor je namerno mali i zna samo podskup markdown-a koji ti fajlovi koriste:
// naslovi, pasusi, citati, tabele, ograđen kod, liste (`-`, `1.`, `- [ ]`, `- [x]`) sa
// uvučenim sadržajem, `**jako**`, `` `kod` `` i `[tekst](url)`. Paket za markdown bi bio
// zavisnost više zbog fajlova koje pišemo sami.
//
// Playwright se uzima iz workera (koren monorepoa ga nema među zavisnostima), a
// pregledač mora da postoji: `pnpm --filter @sajtoskop/worker exec playwright install chromium`.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Pdf = { path: string; format: string; printBackground: boolean; displayHeaderFooter: boolean; headerTemplate: string; footerTemplate: string; margin: Record<string, string> };
type Page = { setContent(html: string, o: { waitUntil: "load" }): Promise<void>; pdf(o: Pdf): Promise<unknown> };
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
type Playwright = { chromium: { launch(): Promise<Browser> } };

const koren = join(dirname(fileURLToPath(import.meta.url)), "..");
const traziIzWorkera = createRequire(join(koren, "apps/worker/package.json"));
const { chromium } = traziIzWorkera("playwright") as Playwright;

const FAJLOVI = ["lansiranje-checklista", "plan-testiranja", "roadmap"] as const;

// ── inline ──────────────────────────────────────────────────

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  const kod: string[] = [];
  let out = s.replace(/`([^`]+)`/g, (_, c: string) => {
    kod.push(`<code>${escape(c)}</code>`);
    return `\u0000${kod.length - 1}\u0000`;
  });
  out = escape(out)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kod[Number(i)] ?? "");
}

// ── blokovi ─────────────────────────────────────────────────

const uvlaka = (l: string): number => l.length - l.trimStart().length;
const prazna = (l: string): boolean => l.trim() === "";
const MARKER = /^(- \[[ x]\] |- |\d+\. )/;

function odseci(linije: string[], n: number): string[] {
  return linije.map((l) => (prazna(l) ? "" : l.slice(Math.min(n, uvlaka(l)))));
}

function blokovi(linije: string[]): string {
  const html: string[] = [];
  let i = 0;

  while (i < linije.length) {
    const l = linije[i] ?? "";

    if (prazna(l)) { i++; continue; }

    if (l.startsWith("```")) {
      const telo: string[] = [];
      i++;
      while (i < linije.length && !(linije[i] ?? "").startsWith("```")) telo.push(linije[i++] ?? "");
      i++;
      html.push(`<pre><code>${escape(telo.join("\n"))}</code></pre>`);
      continue;
    }

    const naslov = /^(#{1,3}) (.*)$/.exec(l);
    if (naslov) {
      const nivo = (naslov[1] ?? "#").length;
      html.push(`<h${nivo}>${inline(naslov[2] ?? "")}</h${nivo}>`);
      i++;
      continue;
    }

    if (l.trim() === "---") { html.push("<hr>"); i++; continue; }

    if (l.startsWith(">")) {
      const telo: string[] = [];
      while (i < linije.length && (linije[i] ?? "").startsWith(">")) telo.push((linije[i++] ?? "").replace(/^> ?/, ""));
      html.push(`<blockquote>${blokovi(telo)}</blockquote>`);
      continue;
    }

    if (l.startsWith("|")) {
      const redovi: string[] = [];
      while (i < linije.length && (linije[i] ?? "").startsWith("|")) redovi.push(linije[i++] ?? "");
      const celije = (r: string): string[] => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const [glava, , ...telo] = redovi;
      html.push(
        `<table><thead><tr>${celije(glava ?? "").map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
          `<tbody>${telo.map((r) => `<tr>${celije(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }

    const m = MARKER.exec(l);
    if (m) {
      const redni = /^\d/.test(m[1] ?? "");
      const stavke: string[] = [];
      while (i < linije.length) {
        const s = linije[i] ?? "";
        const sm = MARKER.exec(s);
        if (!sm || /^\d/.test(sm[1] ?? "") !== redni) break;
        const sirina = (sm[1] ?? "").length;
        const telo = [s.slice(sirina)];
        i++;
        while (i < linije.length) {
          const n = linije[i] ?? "";
          if (!prazna(n) && uvlaka(n) < Math.min(sirina, 2)) break;
          if (prazna(n)) {
            const sledeca = linije.slice(i).find((x) => !prazna(x));
            if (sledeca === undefined || uvlaka(sledeca) < Math.min(sirina, 2)) break;
          }
          telo.push(n);
          i++;
        }
        const [prva = "", ...ostatak] = telo;
        const cekiranje = /^- \[([ x])\] $/.exec(sm[1] ?? "");
        if (cekiranje) {
          const klasa = cekiranje[1] === "x" ? "cb gotovo" : "cb";
          stavke.push(`<li class="${klasa}"><div class="naslov">${inline(prva)}</div>${blokovi(odseci(ostatak, 2))}</li>`);
        } else {
          stavke.push(`<li>${blokovi([prva, ...odseci(ostatak, sirina)])}</li>`);
        }
      }
      html.push(redni ? `<ol>${stavke.join("")}</ol>` : `<ul>${stavke.join("")}</ul>`);
      continue;
    }

    const pasus: string[] = [];
    while (i < linije.length) {
      const p = linije[i] ?? "";
      if (prazna(p) || p.startsWith("```") || p.startsWith("|") || p.startsWith(">") || /^#{1,3} /.test(p) || MARKER.test(p)) break;
      pasus.push(p.trim());
      i++;
    }
    const tekst = pasus.join(" ");
    const klasa = /^\*\*(Gotovo kad|Očekivano)/.test(tekst) ? ' class="kraj"' : "";
    html.push(`<p${klasa}>${inline(tekst)}</p>`);
  }
  return html.join("\n");
}

// ── stranica ────────────────────────────────────────────────

const CSS = `
:root { --ink:#16181d; --muted:#5b6270; --line:#d9dce2; --tag:#eef0f3; }
* { box-sizing:border-box; }
body { margin:0; color:var(--ink); background:#fff; font:10pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; }
main { max-width:820px; margin:0 auto; }
strong, h1, h2, h3, th { font-weight:600; }
h1 { font-size:17pt; margin:0 0 4px; }
h2 { font-size:12pt; margin:16px 0 6px; padding:3px 0; border-bottom:1.5px solid var(--ink); break-after:avoid; }
h3 { font-size:10.5pt; margin:10px 0 4px; color:var(--muted); break-after:avoid; }
p { margin:4px 0; }
a { color:inherit; }
hr { border:0; border-top:1px solid var(--line); margin:12px 0; }
blockquote { margin:0 0 8px; padding:4px 10px; border-left:3px solid var(--line); color:var(--muted); font-size:9.5pt; }
code { font:8.8pt/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background:var(--tag); padding:0 3px; border-radius:3px; overflow-wrap:anywhere; }
pre { font:8.4pt/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background:var(--tag); padding:5px 7px; margin:4px 0; border-radius:3px; white-space:pre-wrap; overflow-wrap:anywhere; break-inside:avoid; }
pre code { background:none; padding:0; font:inherit; }
table { border-collapse:collapse; width:100%; margin:5px 0; font-size:8.8pt; }
tr { break-inside:avoid; }
th, td { border:1px solid var(--line); padding:2px 5px; text-align:left; vertical-align:top; }
th { background:var(--tag); }
ul, ol { margin:3px 0; padding-left:20px; }
li { margin:2px 0; }
ul:has(> li.cb) { list-style:none; padding-left:0; }
li.cb { position:relative; padding:6px 0 7px 24px; border-bottom:1px dotted var(--line); }
li.cb::before { content:""; position:absolute; left:2px; top:9px; width:12px; height:12px; border:1.5px solid var(--ink); border-radius:2px; }
li.cb.gotovo::before { content:"✓"; font-size:10pt; line-height:11px; text-align:center; }
li.cb > .naslov { margin-bottom:2px; }
p.kraj { margin-top:5px; }
@media print { a { text-decoration:none; } }
`;

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    for (const ime of FAJLOVI) {
      const md = readFileSync(join(koren, "docs", `${ime}.md`), "utf8");
      const naslov = /^# (.*)$/m.exec(md)?.[1] ?? ime;
      const html = `<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><title>${escape(naslov)}</title><style>${CSS}</style></head><body><main>${blokovi(md.split("\n"))}</main></body></html>`;
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const izlaz = join(koren, "docs", `${ime}.pdf`);
      await page.pdf({
        path: izlaz,
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="width:100%;font:8px Helvetica,Arial,sans-serif;color:#5b6270;padding:0 14mm;display:flex;justify-content:space-between"><span>${escape(naslov)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
        margin: { top: "14mm", right: "14mm", bottom: "16mm", left: "14mm" },
      });
      console.log(`docs/${ime}.pdf`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
