// apps/web/src/components/veza-greska.tsx
// Glasna poruka kad Clerk↔Supabase veza ne radi.
//
// ── ZAŠTO OVO POSTOJI ─────────────────────────────────────
// Svako čitanje kroz `userSupabase()` oslanja se na Clerk token: RLS politika
// poredi `auth.jwt() ->> 'sub'` sa `user_id`. Kad ta veza pukne — Clerk nije
// podešen kao third-party provider, ključ rotiran, token istekao na čudan način —
// Postgres NE vraća grešku. Vraća prazan rezultat, jer je politika uredno
// primenjena i nijedan red nije prošao.
//
// Posledica bez ove komponente: korisnik koji je platio kreditima za 40
// prospekata otvara „Moju listu" i vidi „Još nemaš nijedan otključan prospekt".
// Tiho pogrešan odgovor je gori od pada — čovek zaključi da je izgubio podatke.
//
// ── KAKO SE OTKRIVA, BEZ IJEDNOG DODATNOG UPITA ───────────
// `getOwnProfile()` ide kroz ISTI klijent i ISTU vrstu politike. Ako on vrati
// red, token demonstrativno radi i prazna lista je stvarno prazna. Ako vrati
// `null`, a `(app)/layout.tsx` je pre toga već pozvao `ensureProfile()` (koji
// red pravi kroz admin klijent), onda profil postoji u bazi a korisnik ga ne
// vidi — što može da znači samo jedno.
//
// Zato stranice ne rade nikakvu dodatnu proveru: prosleđuju profil koji su
// ionako učitale.

import { Alert } from "./ui/alert";

export function VezaGreska({ sta }: { sta: string }) {
  return (
    <Alert variant="warning">
      <p className="font-medium">{sta} trenutno ne mogu da se učitaju.</p>
      <p className="mt-1 max-w-2xl">
        Ništa nije izgubljeno: otključani prospekti i krediti su sačuvani. Probaj
        ponovo za minut.
      </p>
      {/* Tehnički uzrok je za mene, ne za korisnika — isti obrazac kao TrakaKvara. */}
      <details className="mt-2 max-w-2xl text-xs">
        <summary className="cursor-pointer">Tehnički detalji</summary>
        <p className="mt-1">
          Baza ne prepoznaje nalog. Najverovatnije Clerk nije podešen kao third-party
          auth provider u Supabase-u, pa RLS politika ne vidi korisnički ID.
        </p>
      </details>
    </Alert>
  );
}
