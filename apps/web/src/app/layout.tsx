import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { srRS } from "@clerk/localizations";
import "./globals.css";

// Jedan sans font za ceo proizvod (F2 §1). `latin-ext` je obavezan — bez njega
// nema č, ć, ž, š, đ, a ceo UI je srpski sa dijakritikom.
const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "Sajtoskop",
  description: "Pronađi biznise u Srbiji kojima sajt ne valja — ili ga uopšte nema.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `lang="sr-Latn-RS"`: ceo UI je srpski, latinica, sa dijakritikom (CLAUDE.md).
    <ClerkProvider localization={srRS} signInUrl="/prijava" signUpUrl="/registracija">
      <html lang="sr-Latn-RS" className={manrope.variable}>
        <body className="font-sans">{children}</body>
      </html>
    </ClerkProvider>
  );
}
