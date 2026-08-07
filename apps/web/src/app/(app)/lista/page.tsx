// apps/web/src/app/(app)/lista/page.tsx
// Otključani prospekti. Puni se u F4, kad otključavanje počne da radi —
// do tada je prazan ekran sa objašnjenjem, ne mrtav link u navigaciji.

import Link from "next/link";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireSession();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Moja lista</h1>

      <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 px-5 py-6 dark:border-neutral-800 dark:bg-neutral-900/50">
        <p className="font-medium">Još nemaš nijedan otključan prospekt.</p>
        <p className="mt-1 max-w-xl text-sm text-neutral-500">
          Otključavanje troši kredit i otvara telefon, mejl, adresu sajta i pun Ugly Score.
          Dugme „Otključaj" u pretrazi radi od sledeće faze.
        </p>
        <Link
          href="/pretraga"
          className="mt-4 inline-block text-sm underline underline-offset-4"
        >
          Idi na pretragu
        </Link>
      </div>
    </main>
  );
}
