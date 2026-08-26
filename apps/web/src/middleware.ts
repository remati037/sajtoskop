// apps/web/src/middleware.ts
// Middleware SAMO postavlja Clerk kontekst da bi `auth()` radio u serverskim
// komponentama i rutama. On NE štiti rute.
//
// Zašto ne štiti: Clerk je deprecirao `createRouteMatcher` i zaštitu kroz
// middleware, uz obrazloženje da se poklapanje po putanji razilazi sa načinom na
// koji Next.js zaista rutira zahteve — pa zaštićen resurs ume da ostane dohvatljiv.
// https://clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher
//
// ── PRAVILO KOJE OVO ZAMENJUJE ─────────────────────────────
// Svaka stranica, layout, API ruta i server akcija koja dodiruje korisničke
// podatke MORA sama da pozove `requireSession()` (ili `getCurrentUserId()`) iz
// `@/lib/auth`. Nema podrazumevane zaštite — provera je uz podatak, ne uz putanju.
//
// Izuzeci koji je namerno nemaju:
//   /                      prijava i registracija; javno po definiciji
//   /prijava, /registracija redirekcije na `/`, zbog starih linkova
//   /api/webhooks/clerk    Clerk zove bez sesije; potpis JESTE autentikacija
//   /api/billing/webhook   isto, Paddle (S18) — `paddle.webhooks.unmarshal`
//   /cenovnik              javan ekran cena; sesija se čita samo da bi se znalo
//                          da li dugme vodi u checkout ili na registraciju

import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // Sve osim Next internih fajlova i statike — osim ako je statika u query stringu.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Uvek za API i tRPC rute.
    "/(api|trpc)(.*)",
  ],
};
