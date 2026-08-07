import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { srRS } from "@clerk/localizations";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sajtoskop",
  description: "Pronađi biznise u Srbiji kojima sajt ne valja — ili ga uopšte nema.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `lang="sr-Latn-RS"`: ceo UI je srpski, latinica, sa dijakritikom (CLAUDE.md).
    <ClerkProvider localization={srRS} signInUrl="/prijava" signUpUrl="/registracija">
      <html lang="sr-Latn-RS">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
