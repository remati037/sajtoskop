import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { ZnakSaImenom } from "@/components/znak";

// `[[...rest]]` je obavezan: Clerk unutar sebe rutira na /prijava/factor-one,
// /prijava/sso-callback i slično. Bez catch-all segmenta ti koraci daju 404.
//
// Clerk-ov widget prati temu proizvoda kroz `appearance` u `clerk-okvir.tsx`.
// Ovde je samo okvir oko njega: znak, povratak na početnu i ista aura kao na
// landing-u, da prijava ne izgleda kao tuđa stranica.

export const metadata: Metadata = { title: "Prijava" };

export default function Page() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div aria-hidden className="pozadina-aure pointer-events-none fixed inset-0 -z-10" />

      <Link href="/" className="flex items-center gap-2.5">
        <ZnakSaImenom />
      </Link>

      <SignIn />

      <Link
        href="/"
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Nazad na početnu
      </Link>
    </main>
  );
}
