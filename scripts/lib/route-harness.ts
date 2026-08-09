// scripts/lib/route-harness.ts
// Poziva pravi Next.js route handler iz obične Node skripte.
//
// ── ZAŠTO OVAKO, A NE HTTP KA `next dev` ──────────────────
// F4 §7 traži 20 paralelnih `POST /api/unlock`. Preko HTTP-a bi svaki zahtev
// morao da nosi pravu Clerk sesiju, a nje nema bez pregleda. Jedina alternativa
// bila bi test-backdoor u autentifikaciji — zaobilaznica u produkcijskom kodu
// zbog testa, tačno ono što pravilo 8 zabranjuje.
//
// Zato: skripta uvozi `route.ts` kakav jeste i zove njegov `POST(Request)`.
// Handler je obična funkcija; `NextResponse` je nadgradnja Web `Response`-a i
// radi u Node-u bez ičega oko sebe.
//
// ── ŠTA OVO DOKAZUJE, A ŠTA NE ────────────────────────────
// Dokazuje: parsiranje tela, mapiranje ishoda u status kodove, i — što je
// jedino i važno — trku nad kreditima u PRAVOJ bazi, sa 20 stvarnih paralelnih
// konekcija i stvarnim `for update`. To PGlite ne može (jedna konekcija), pa
// `pnpm check:sql` ovo namerno ni ne pokušava.
//
// Ne dokazuje: da Clerk ispravno verifikuje token. To nije naš kod, i pokriveno
// je posebno — proverom da bez sesije ruta vraća 401 i da `userId` iz tela nema
// nikakav efekat.

import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const webSrc = path.join(root, "apps", "web", "src");
const stubs = pathToFileURL(path.join(here, "next-stubs.ts")).href;

// Moduli koji postoje samo unutar Next-a. `server-only` je jedini tu iz drugog
// razloga: on svesno BACA kad ga uveze bilo ko osim Next servera — to je P0-4
// zaštita i ostaje kakva jeste; ovde joj samo sklanjamo telo.
const REPLACED = new Set(["server-only", "next/navigation", "@clerk/nextjs/server"]);

/**
 * `registerHooks` je sinhron i radi u istoj niti (Node 22.15+), za razliku od
 * `register()` koji ide u worker i ne bi mogao da deli stanje sesije sa testom.
 */
module.registerHooks({
  resolve(specifier, context, next) {
    if (REPLACED.has(specifier)) return { url: stubs, shortCircuit: true };

    // `@/*` alias iz apps/web/tsconfig.json. Node ga ne zna, a route fajlovi ga
    // koriste u svakom importu.
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(path.join(webSrc, specifier.slice(2))).href, context);
    }

    return next(specifier, context);
  },
});

type SessionHolder = { current: string | null };

const holder: SessionHolder = ((globalThis as Record<string, unknown>).__sajtoskopSession ??= {
  current: null,
}) as SessionHolder;

/** Ko je „ulogovan" za sledeće pozive. `null` znači: nema sesije. */
export function setSessionUser(userId: string | null): void {
  holder.current = userId;
}

export type RouteHandler = (req: Request) => Promise<Response>;

/** Učitaj `POST` iz rute, putanjom relativnom na `apps/web/src/app`. */
export async function loadRoute(appPath: string): Promise<RouteHandler> {
  const file = pathToFileURL(path.join(webSrc, "app", appPath)).href;
  const mod = (await import(file)) as { POST?: RouteHandler };

  if (typeof mod.POST !== "function") {
    throw new Error(`${appPath} ne izvozi POST handler.`);
  }
  return mod.POST;
}

export type JsonResponse = { status: number; body: Record<string, unknown> };

/** Jedan `POST` zahtev ka ruti, sa telom kakvo bi poslao pregledač. */
export async function postJson(
  handler: RouteHandler,
  url: string,
  body: unknown,
): Promise<JsonResponse> {
  const res = await handler(
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { _sirovoTelo: text };
  }

  return { status: res.status, body: parsed };
}
