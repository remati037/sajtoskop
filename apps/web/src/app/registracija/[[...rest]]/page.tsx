import type { Metadata } from "next";
import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { ZnakSaImenom } from "@/components/znak";

// Isti okvir kao prijava — v. `prijava/[[...rest]]/page.tsx`.

export const metadata: Metadata = { title: "Registracija" };

export default function Page() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div aria-hidden className="pozadina-aure pointer-events-none fixed inset-0 -z-10" />

      <Link href="/" className="flex items-center gap-2.5">
        <ZnakSaImenom />
      </Link>

      <SignUp />

      <p className="text-center text-xs text-muted-foreground">
        Beta je besplatna dok traje. 30 kredita mesečno, bez kartice.
      </p>

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
