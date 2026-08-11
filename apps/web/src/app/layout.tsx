import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { TemaProvider } from "@/components/tema-provider";
import { ClerkOkvir } from "@/components/clerk-okvir";
import { TEMA_SKRIPTA } from "@/lib/tema";
import "./globals.css";

// Jedan sans font za ceo proizvod (F2 §1). `latin-ext` je obavezan — bez njega
// nema č, ć, ž, š, đ, a ceo UI je srpski sa dijakritikom.
const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: {
    default: "Sajtoskop",
    template: "%s · Sajtoskop",
  },
  description: "Pronađi biznise u Srbiji kojima sajt ne valja — ili ga uopšte nema.",
};

// Boja trake pregledača na telefonu prati temu. Bez ovoga tamna aplikacija ima
// belu kapu iznad sebe na iOS-u.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#14141d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `lang="sr-Latn-RS"`: ceo UI je srpski, latinica, sa dijakritikom (CLAUDE.md).
    // `suppressHydrationWarning`: skripta ispod menja `class` i `style` na <html>
    // pre hidratacije, pa se server i klijent po definiciji razlikuju baš tu.
    <html lang="sr-Latn-RS" className={manrope.variable} suppressHydrationWarning>
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
