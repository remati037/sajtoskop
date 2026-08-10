// apps/worker/src/lib/screenshot.ts
// Dva screenshota nepoznatog sajta u pravom Chromiumu (F5 §3 i §4, bezbednost P0-5).
//
// Ovo je najopasniji fajl u repou. Sve ostalo obrađuje tuđe podatke; ovaj
// izvršava tuđi kod. Pretpostavka je da će jednom neki od tih sajtova pobeći iz
// renderer procesa — zato je posao ovog modula samo da tada napadač zatekne
// prazan kontejner: bez roota, bez upisa na disk, bez interne mreže, bez ključa.
//
// Node-only, isključivo u workeru. Nikad u Vercel funkciji (pravilo 7).
//
// Redosled kroz koji URL mora da prođe pre nego što ga Chromium vidi:
//   mayCrawl (robots.txt + razmak 1s)  →  followSafely (SSRF, svaki hop)
//   →  page.route (svaki podzahtev ponovo kroz resolveSafeUrl)

import { randomBytes } from "node:crypto";
import pLimit from "p-limit";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import sharp from "sharp";
import { mayCrawl } from "./robots";
import { checkUrlShape, followSafely, resolveSafeUrl, toHttpUrl, UnsafeUrlError } from "./safe-url";
import { UA } from "./user-agent";

// ── podešavanja ────────────────────────────────────────────

/** Tvrdi rok za ceo jedan sajt, oba screenshota. PRD §3. */
const HARD_TIMEOUT_MS = 30_000;

/** Rok za jednu navigaciju. */
const NAV_TIMEOUT_MS = 15_000;

/** Koliko se čeka da se učita ono što posetilac vidi prvo. */
const SETTLE_MS = 800;

/** Chromium curi memoriju; posle ovoliko sajtova se gasi i pali ponovo. PRD §3. */
const RESTART_EVERY = 50;

/** Ispod ovoliko preostalog vremena nema smisla počinjati drugu varijantu. */
const MIN_VARIANT_MS = 6_000;

const WEBP_QUALITY = 80;

/**
 * Koliko sajtova se slika istovremeno. Odvojeno od `WORKER_CONCURRENCY` jer
 * jedan Chromium kontekst košta red veličine više memorije od jednog HTTP
 * zahteva — tri radnika smeju da vuku tri posla, ali ne i da drže tri pregledača.
 * Na CX22 preko 3 znači OOM (PRD §3).
 */
const SHOT_CONCURRENCY = Math.min(3, Math.max(1, Number(process.env.SHOT_CONCURRENCY ?? 2)));

const shotGate = pLimit(SHOT_CONCURRENCY);

/**
 * Tipovi resursa koji ne utiču na izgled prve ekranske strane, a jesu mreža,
 * memorija i — kod `websocket`/`eventsource` — otvoren kanal ka tuđem serveru
 * koji nadživi screenshot.
 */
const BLOCKED_RESOURCES = new Set(["media", "websocket", "eventsource", "manifest"]);

export type ShotVariant = "desktop" | "mobile";

type VariantSpec = {
  name: ShotVariant;
  width: number;
  height: number;
  isMobile: boolean;
  deviceScaleFactor: number;
};

/**
 * `fullPage: false` je namerno na obe: interesuje nas ono što posetilac vidi
 * prvo. Mobilni je tu zato što se na njemu vidi da sajt nije responsive — to je
 * pola vrednosti proizvoda (PRD §4).
 */
const VARIANTS: readonly VariantSpec[] = [
  { name: "desktop", width: 1440, height: 900, isMobile: false, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
];

// ── greške ─────────────────────────────────────────────────

/** Sajt se ne otvara. Po PRD-u §5 to nije greška posla nego najjači lead. */
export class SiteUnreachableError extends Error {
  readonly url: string;
  constructor(url: string, detail: string) {
    super(`sajt se ne otvara (${detail}): ${url}`);
    this.name = "SiteUnreachableError";
    this.url = url;
  }
}

/** `robots.txt` nam zabranjuje ovu putanju (pravilo 12). */
export class CrawlBlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`${reason}: ${url}`);
    this.name = "CrawlBlockedError";
  }
}

// ── životni vek pregledača ─────────────────────────────────

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;
let sitesSinceLaunch = 0;
let inFlight = 0;

/**
 * `--no-sandbox` je nužan jer `cap_drop: ALL` u compose-u uklanja CAP_SYS_ADMIN
 * bez kog Chromium ne ume da napravi svoj namespace sandbox. Zato SVE ostalo
 * mora da bude zategnuto — seccomp profil, read-only fs i uid 1001 su ono što
 * je od izolacije ostalo.
 */
function launchArgs(): string[] {
  return [
    "--disable-dev-shm-usage", // /dev/shm u kontejneru je 64MB; koristi /tmp
    "--disable-file-system", // FileSystem API stranici
    "--disable-extensions",
    "--disable-plugins",
    "--block-new-web-contents", // bez popup prozora i novih tabova
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
  ];
}

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (launching) return await launching;

  launching = chromium
    .launch({
      args: launchArgs(),
      // Playwrightov način da doda `--no-sandbox`; isto, ali eksplicitno.
      chromiumSandbox: false,
      timeout: 30_000,
    })
    .then((b) => {
      browser = b;
      sitesSinceLaunch = 0;
      return b;
    })
    .finally(() => {
      launching = null;
    });

  return await launching;
}

/**
 * Ugasi pregledač ako je odradio svojih 50 sajtova i ako trenutno niko ne slika.
 * Bez provere `inFlight` bismo srušili kontekst paralelnog posla.
 */
async function recycleIfDue(): Promise<void> {
  if (sitesSinceLaunch < RESTART_EVERY || inFlight > 0 || !browser) return;

  const old = browser;
  browser = null;
  sitesSinceLaunch = 0;
  await old.close().catch(() => {});
}

/** Uredno gašenje iz `shutdown()` u index.ts. */
export async function closeBrowser(): Promise<void> {
  const old = browser;
  browser = null;
  launching = null;
  sitesSinceLaunch = 0;
  if (old) await old.close().catch(() => {});
}

// ── zaštita na nivou stranice ──────────────────────────────

/**
 * Svaki podzahtev stranice ide kroz istu SSRF proveru kao i glavni URL.
 *
 * `followSafely` proverava samo ono što mi otvaramo. Stranica posle toga sama
 * povlači slike, skripte i `iframe`-ove sa proizvoljnih adresa — uključujući
 * `<img src="http://169.254.169.254/latest/meta-data/">`. Odgovor na taj zahtev
 * ne bismo videli u screenshotu, ali bi izašao sa naše mašine i, kod
 * neobazrivog `onerror` handlera, vratio se sajtu.
 *
 * Keš je po sajtu, ne po procesu: odluka doneta pre sat vremena ne sme da
 * preživi promenu DNS zapisa.
 */
async function installGuards(page: Page): Promise<void> {
  const verdicts = new Map<string, Promise<boolean>>();

  const isAllowed = (raw: string): Promise<boolean> => {
    let key: string;
    try {
      const u = new URL(raw);
      // `data:` i `blob:` ne izlaze na mrežu. Sve što nije http(s) — uključujući
      // `file:` — pada u `else` i biva odbijeno.
      if (u.protocol === "data:" || u.protocol === "blob:") return Promise.resolve(true);
      if (u.protocol !== "http:" && u.protocol !== "https:") return Promise.resolve(false);
      key = `${u.protocol}//${u.host}`;
    } catch {
      return Promise.resolve(false);
    }

    const cached = verdicts.get(key);
    if (cached) return cached;

    const pending = resolveSafeUrl(`${key}/`).then(
      () => true,
      () => false,
    );
    verdicts.set(key, pending);
    return pending;
  };

  await page.route("**/*", async (route) => {
    const request = route.request();

    if (BLOCKED_RESOURCES.has(request.resourceType())) {
      await route.abort().catch(() => {});
      return;
    }

    if (await isAllowed(request.url())) {
      await route.continue().catch(() => {});
    } else {
      await route.abort("blockedbyclient").catch(() => {});
    }
  });

  // Sajt koji otvori `alert()` u `onload` blokira screenshot do isteka roka.
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
}

async function newHardenedContext(spec: VariantSpec): Promise<BrowserContext> {
  const b = await getBrowser();

  // Svež kontekst po sajtu I po varijanti — nikad deljen. Kolačić, localStorage
  // i service worker jednog sajta ne smeju da vide drugi (PRD §3).
  return await b.newContext({
    viewport: { width: spec.width, height: spec.height },
    isMobile: spec.isMobile,
    hasTouch: spec.isMobile,
    deviceScaleFactor: spec.deviceScaleFactor,
    userAgent: UA, // identifikujući, isti kao u fetch-site.ts (pravilo 12)
    locale: "sr-RS",
    timezoneId: "Europe/Belgrade",
    bypassCSP: false, // CSP sajta je i naša zaštita, ne samo njegova
    serviceWorkers: "block", // SW nadživi kontekst i nastavi da radi mrežu
    permissions: [], // bez geolokacije, kamere, notifikacija
    javaScriptEnabled: true, // bez JS pola sajtova izgleda bolje nego što jeste
    ignoreHTTPSErrors: true, // istekao sertifikat je signal, ne razlog da odustanemo
  });
}

// ── slikanje ───────────────────────────────────────────────

export type Shot = {
  variant: ShotVariant;
  webp: Buffer;
};

export type CaptureResult = {
  /** URL koji je stvarno slikan, posle svih redirekcija. */
  finalUrl: string;
  /** Status poslednjeg hopa iz `followSafely`. `null` ako se nije otvorio. */
  httpStatus: number | null;
  /** Prazno se nikad ne vraća — u tom slučaju leti `SiteUnreachableError`. */
  shots: Shot[];
};

async function capturePage(url: string, spec: VariantSpec, budgetMs: number): Promise<Buffer> {
  const ctx = await newHardenedContext(spec);

  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(Math.min(NAV_TIMEOUT_MS, budgetMs));
    await installGuards(page);

    // `domcontentloaded`, ne `networkidle`: na sajtovima sa reklamama i
    // trackerima `networkidle` ne nastupi nikad, pa svaki screenshot čeka pun rok.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(NAV_TIMEOUT_MS, budgetMs),
    });

    // Slike i CSS iznad preloma stižu posle DOMContentLoaded. Ako `load` ne
    // nastupi, slikamo šta imamo — to je i dalje ono što posetilac vidi.
    await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    const png = await page.screenshot({
      type: "png",
      fullPage: false,
      animations: "disabled",
      caret: "hide",
      timeout: 10_000,
    });

    // Playwright ume samo png i jpeg. PRD traži webp/80, pa konverzija ide kroz
    // sharp — uz webp je i upola manja od jpeg-a istog kvaliteta, što je bitno
    // jer je Supabase Storage na besplatnom planu 1GB.
    return await sharp(png).webp({ quality: WEBP_QUALITY }).toBuffer();
  } finally {
    // Uvek, i na grešku. Kontekst koji ostane otvoren drži renderer proces živ.
    await ctx.close().catch(() => {});
  }
}

/**
 * Otvori sajt i vrati desktop i mobilni screenshot.
 *
 * Baca `CrawlBlockedError` ako `robots.txt` zabranjuje, `UnsafeUrlError` ako
 * URL ili neki hop u redirekciji vodi na privatnu adresu, `SiteUnreachableError`
 * ako se nijedna varijanta nije otvorila.
 *
 * Ako se otvorila samo jedna varijanta (druga je pojela ostatak roka), vraća se
 * jedna. Jedan screenshot je bolji od nijednog i od pale grane posla.
 *
 * Pozivi su ograničeni na `SHOT_CONCURRENCY` istovremeno; višak čeka u redu.
 */
export function captureSite(rawUrl: string): Promise<CaptureResult> {
  return shotGate(() => captureOne(rawUrl));
}

async function captureOne(rawUrl: string): Promise<CaptureResult> {
  await recycleIfDue();

  // `businesses.website_url` stiže bez protokola (`autodavid.rs/kontakt`).
  // Provera oblika ide PRE `mayCrawl` namerno: `mayCrawl` na neparsiv URL vraća
  // `allowed: false` sa razlogom „neispravan URL", što bi se ovde pretvorilo u
  // „preskočen zbog robots.txt" — poruku koja krije pravi uzrok.
  const startUrl = checkUrlShape(toHttpUrl(rawUrl)).href;

  const robots = await mayCrawl(startUrl, UA);
  if (!robots.allowed) throw new CrawlBlockedError(startUrl, robots.reason ?? "robots.txt");

  // Redirekcije se prate ručno i svaki hop prolazi kroz SSRF proveru. Chromium
  // dobija isključivo već proveren, konačan URL.
  const target = await followSafely(startUrl);
  const finalUrl = target.url.href;

  const deadline = Date.now() + HARD_TIMEOUT_MS;
  const shots: Shot[] = [];
  const failures: string[] = [];

  inFlight++;
  try {
    for (const spec of VARIANTS) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_VARIANT_MS) {
        failures.push(`${spec.name}: nije ostalo vremena`);
        continue;
      }

      // Drugi zahtev ka istom domenu — razmak od 1s važi i za pregledač.
      const hop = await mayCrawl(finalUrl, UA);
      if (!hop.allowed) throw new CrawlBlockedError(finalUrl, hop.reason ?? "robots.txt");

      try {
        const webp = await capturePage(finalUrl, spec, remaining);
        shots.push({ variant: spec.name, webp });
      } catch (err) {
        if (err instanceof UnsafeUrlError) throw err;
        failures.push(`${spec.name}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
      }
    }
  } finally {
    inFlight--;
    sitesSinceLaunch++;
  }

  if (shots.length === 0) {
    throw new SiteUnreachableError(finalUrl, failures.join("; ") || "nepoznat razlog");
  }

  return { finalUrl, httpStatus: target.httpStatus, shots };
}

/**
 * Nepredvidivo ime fajla. Predvidivo ime (`{place_id}.webp`) plus jedan propust
 * u pravima na bucketu znači da ceo vizuelni deo baze može enumerisati bilo ko
 * (P0-3). Bucket je privatan, ali ime je drugi sloj i košta 16 karaktera.
 */
export function screenshotPath(placeId: string, variant: ShotVariant): string {
  const safeId = placeId.replace(/[^A-Za-z0-9_-]/g, "");
  const nonce = randomBytes(12).toString("base64url");
  return `${safeId}-${nonce}-${variant}.webp`;
}
