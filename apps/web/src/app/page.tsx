import Link from "next/link";
import { Show } from "@clerk/nextjs";

// Privremena javna stranica. Pravi landing sa brojkama iz seed izveštaja
// dolazi u F8 — ne pravi ga ovde.

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Sajtoskop</h1>

      <p className="text-neutral-600 dark:text-neutral-400">
        Biznisi u Srbiji kojima sajt ne valja — ili ga uopšte nema. Sa kontaktom,
        listom problema i pripremljenom porukom.
      </p>

      <div className="flex gap-3">
        {/* Clerk 7: `<Show when="...">` je zamenio `<SignedIn>` / `<SignedOut>`. */}
        <Show when="signed-out">
          <Link
            href="/registracija"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-neutral-900"
          >
            Napravi nalog
          </Link>
          <Link
            href="/prijava"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
          >
            Prijavi se
          </Link>
        </Show>

        <Show when="signed-in">
          <Link
            href="/dashboard"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-neutral-900"
          >
            Nastavi na kontrolnu tablu
          </Link>
        </Show>
      </div>

      <p className="text-xs text-neutral-500">
        Beta je besplatna do kraja bete — ne zauvek.
      </p>
    </main>
  );
}
