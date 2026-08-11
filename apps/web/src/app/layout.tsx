import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TemaProvider } from "@/components/tema-provider";
import { ClerkOkvir } from "@/components/clerk-okvir";
import { TEMA_SKRIPTA } from "@/lib/tema";
import "./globals.css";

// Geist Sans za sve, Geist Mono za brojeve, ID-eve, URL-ove i labele
// (`docs/DIZAJN-SISTEM.md` §4). Paket `geist` nosi obe varijante kao lokalne
// fontove — ne ide preko `next/font/google`, pa nema ni zahteva ka Google-u ni
// pitanja o pokrivenosti dijakritike: Geist ima pun latin-ext.

export const metadata: Metadata = {
  title: {
    default: "Sajtoskop",
    template: "%s · Sajtoskop",
  },
  description: "Pronađi biznise u Srbiji kojima sajt ne valja — ili ga uopšte nema.",
};

// Boja trake pregledača na telefonu prati temu. Bez ovoga tamna aplikacija ima
// belu kapu iznad sebe na iOS-u. Vrednosti su `--bg` iz obe teme; `<meta>` ne
// ume CSS promenljivu, pa je ovo jedino mesto u proizvodu gde hex sme da stoji
// van `globals.css`.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#07080a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `lang="sr-Latn-RS"`: ceo UI je srpski, latinica, sa dijakritikom (CLAUDE.md).
    // `suppressHydrationWarning`: skripta ispod menja `class` i `style` na <html>
    // pre hidratacije, pa se server i klijent po definiciji razlikuju baš tu.
    <html
      lang="sr-Latn-RS"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Mora da bude sinhrona i pre stila — v. `lib/tema.ts`. */}
        <script dangerouslySetInnerHTML={{ __html: TEMA_SKRIPTA }} />
      </head>
      <body className="font-sans">
        <TemaProvider>
          <ClerkOkvir>{children}</ClerkOkvir>
        </TemaProvider>
      </body>
    </html>
  );
}
