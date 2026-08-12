"use client";

// ClerkProvider koji prati temu proizvoda.
//
// Bez ovoga se prijava, registracija i meni naloga crtaju u Clerk-ovoj svetloj
// paleti — beo pravougaonik nasred tamne aplikacije. Kako Clerk boje prima kao
// prop, a ne kao CSS promenljive, provider mora da bude klijentski i da čita
// stvarnu temu iz konteksta.
//
// Vrednosti su doslovno tokeni iz `docs/DIZAJN-SISTEM.md` §3.1 — dokument ih
// već drži u HEX-u, pa je ovo prepis, ne prevod. Jedini izuzetak je
// `colorBorder` u tamnoj temi: token je `rgba(...)`, a Clerk iz boje ivice
// izvodi svoju skalu i providnost mu razvali kontrast. Ovde stoji ista boja
// spljoštena preko `--bg-elev`.
//
// `colorBorder` je namerno `--border-strong`, a ne `--border`: sve što Clerk
// ovom bojom crta jesu polja za unos i dugmad za socijalne prijave, dakle
// kontrole — a one po §3.2.1 drže 3:1. Clerk nema odvojen token za površinu,
// pa bi `--border` ovde značio da forma jedina u proizvodu ima nevidljiva polja.

import { ClerkProvider } from "@clerk/nextjs";
import { srRS } from "@clerk/localizations";
import { useTema } from "./tema-provider";

const SVETLA = {
  colorPrimary: "#8fd413", // --accent
  colorPrimaryForeground: "#0a0b0c", // --accent-ink
  colorBackground: "#ffffff", // --bg-elev
  colorForeground: "#0a0b0c", // --fg
  colorMutedForeground: "#575e66", // --fg-muted
  colorMuted: "#f1f3f1", // --bg-inset
  colorInput: "#ffffff", // --bg-elev
  colorInputForeground: "#0a0b0c", // --fg
  colorBorder: "#878e89", // --border-strong
  colorDanger: "#d92020", // --danger
  colorSuccess: "#4e7c0a", // --accent-text
  colorWarning: "#b45309", // --warn-text
};

const TAMNA = {
  colorPrimary: "#adee2e", // --accent
  colorPrimaryForeground: "#08090a", // --accent-ink
  colorBackground: "#101317", // --bg-elev
  colorForeground: "#f2f4f3", // --fg
  colorMutedForeground: "#9aa2ab", // --fg-muted
  colorMuted: "#0e1114", // --bg-inset
  colorInput: "#0e1114", // --bg-inset
  colorInputForeground: "#f2f4f3", // --fg
  colorBorder: "#66686b", // --border-strong, spljošten preko --bg-elev
  colorDanger: "#ff5a5a", // --danger
  colorSuccess: "#c4f55c", // --accent-text
  colorWarning: "#fbbf24", // --warn-text
};

export function ClerkOkvir({ children }: { children: React.ReactNode }) {
  // Otkad tema više nema stanje „sistem", izbor JESTE tema — nema šta da se
  // razrešava, pa je i `stvarna` iz konteksta otpala.
  const { tema } = useTema();
  const boje = tema === "tamna" ? TAMNA : SVETLA;

  return (
    <ClerkProvider
      localization={srRS}
      // Obe forme stoje na početnoj strani; parametar bira karticu. Clerk ovim
      // gradi svoje unutrašnje linkove, pa mora da pokazuje na `/`, a ne na
      // `/prijava` — inače svaki taj link ide kroz redirekciju.
      signInUrl="/"
      signUpUrl="/?nalog=nov"
      appearance={{
        variables: {
          ...boje,
          borderRadius: "0.875rem", // --radius, 14px (§5)
          fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
