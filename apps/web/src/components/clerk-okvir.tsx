"use client";

// ClerkProvider koji prati temu proizvoda.
//
// Bez ovoga se prijava, registracija i meni naloga crtaju u Clerk-ovoj svetloj
// paleti — beo pravougaonik nasred tamne aplikacije. Kako Clerk boje prima kao
// prop, a ne kao CSS promenljive, provider mora da bude klijentski i da čita
// stvarnu temu iz konteksta.
//
// Boje su ovde HEX, iako je ceo ostatak proizvoda u oklch: Clerk sam pravi
// skalu iz `colorPrimary` i njegov parser ne poznaje oklch. Vrednosti su ručno
// prevedeni parnjaci tokena iz `globals.css`.

import { ClerkProvider } from "@clerk/nextjs";
import { srRS } from "@clerk/localizations";
import { useTema } from "./tema-provider";

const SVETLA = {
  colorPrimary: "#5b3df5",
  colorPrimaryForeground: "#ffffff",
  colorBackground: "#ffffff",
  colorForeground: "#1e1e2a",
  colorMutedForeground: "#6f6f80",
  colorMuted: "#f4f4f7",
  colorInput: "#ffffff",
  colorInputForeground: "#1e1e2a",
  colorBorder: "#e6e6ec",
  colorDanger: "#dc3a45",
  colorSuccess: "#1f9d63",
  colorWarning: "#d18a12",
};

const TAMNA = {
  colorPrimary: "#8b7bf7",
  colorPrimaryForeground: "#16101f",
  colorBackground: "#1c1c28",
  colorForeground: "#f2f2f5",
  colorMutedForeground: "#a8a8b8",
  colorMuted: "#25252f",
  colorInput: "#25252f",
  colorInputForeground: "#f2f2f5",
  colorBorder: "#33333f",
  colorDanger: "#f0666f",
  colorSuccess: "#4ec98d",
  colorWarning: "#e5ac4a",
};

export function ClerkOkvir({ children }: { children: React.ReactNode }) {
  const { stvarna } = useTema();
  const boje = stvarna === "tamna" ? TAMNA : SVETLA;

  return (
    <ClerkProvider
      localization={srRS}
      signInUrl="/prijava"
      signUpUrl="/registracija"
      appearance={{
        variables: {
          ...boje,
          borderRadius: "0.75rem",
          fontFamily: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
