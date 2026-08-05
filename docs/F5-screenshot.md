# F5 — Screenshot desktop i mobilni

**Cilj:** otključan lead ima dva screenshota koja su vizuelni dokaz da sajt ne valja.

**Procena:** 3–4 dana · **Preduslov:** F4 gotov

> Ovo je faza sa najvećom površinom napada u celom proizvodu. Dobrovoljno otvaraš stotine
> nepoznatih sajtova u pravom Chromiumu na svom serveru. Normalne web aplikacije to ne rade.
> Bezbednosni deo nije opcioni dodatak — on je veći deo posla od samog screenshota.

---

## 1. Gde se izvršava

Isključivo u workeru, kao prvi korak `enrich_full` posla, koji se kreira na unlock.
**Nikad u bulk scanu, nikad na Vercelu.** Pravila 5 i 7.

---

## 2. SSRF zaštita — piše se pre Playwrighta

U F5 URL-ovi dolaze iz Googlea pa je rizik nizak. Ali polje „unesi URL svog sajta za analizu"
dolazi neizbežno, i tada je kritično. Piši zaštitu sada.

```ts
// apps/worker/src/lib/safe-url.ts
const BLOCKED_RANGES = [
  "private", "loopback", "linkLocal", "uniqueLocal",
  "carrierGradeNat", "unspecified", "reserved",
];

export async function resolveSafeUrl(raw: string) {
  const u = new URL(raw);                                  // baci na nevalidan
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad_scheme");
  if (u.username || u.password) throw new Error("credentials_in_url");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error("local_host");

  const { address } = await dns.lookup(u.hostname);
  if (BLOCKED_RANGES.includes(ipaddr.parse(address).range())) throw new Error("blocked_ip");

  return { url: u, ip: address };
}
```

Dve stvari koje se lako propuste:

- **DNS rebinding.** Domen se razreši u javni IP pri proveri, pa u `127.0.0.1` pri otvaranju. Zato koristi razrešeni IP, ne hostname.
- **Redirekcije.** Sajt vrati `302` na `http://169.254.169.254/`. Prati redirekcije ručno, **provuci svaki hop kroz istu funkciju**, max 3 skoka.

`169.254.169.254` je cloud metadata endpoint. Na Hetzneru odatle izlaze podaci o serveru.
Ovo nije teoretski problem.

---

## 3. Playwright izolacija

```yaml
# docker-compose.yml — proširenje postojećeg servisa iz F3
    user: "1001:1001"
    read_only: true
    tmpfs: [/tmp:size=512M]
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    mem_limit: 1g
    pids_limit: 200
```

```ts
const browser = await chromium.launch({
  args: [
    "--no-sandbox",              // nužno u kontejneru, zato sve ostalo mora biti zategnuto
    "--disable-dev-shm-usage",
    "--disable-file-system",
    "--disable-extensions",
    "--disable-plugins",
    "--block-new-web-contents",
  ],
});

const ctx = await browser.newContext({
  bypassCSP: false,
  serviceWorkers: "block",
  permissions: [],
  userAgent: SAJTOSKOP_UA,       // identifikujući, isti kao u fetch-site.ts
});
```

- Svež kontekst po sajtu, nikad deljen
- `page.setDefaultTimeout(15_000)`, hard timeout na ceo posao 30s
- Blokiraj `media`, `websocket`, `eventsource`, `manifest` kroz `page.route`
- `ctx.close()` u `finally`, uvek, i na grešku
- Restart browsera svakih 50 sajtova — Chromium curi memoriju
- Max 3 paralelna konteksta na CX22

---

## 4. Screenshotovi

| Varijanta | Viewport | Napomena |
|---|---|---|
| desktop | 1440×900 | `fullPage: false` — vidi se ono što posetilac vidi prvo |
| mobilni | 390×844, `isMobile: true`, `deviceScaleFactor: 2` | ovde se vidi da sajt nije responsive, to je pola vrednosti proizvoda |

- Format `webp`, kvalitet 80
- Ime fajla: **nepredvidivo** — `{place_id}-{nanoid}-{desktop|mobile}.webp`. Predvidivo ime plus javni bucket znači da ti ceo vizuelni deo baze može enumerisati bilo ko.
- Bucket `screenshots` je **privatan**; klijent dobija signed URL sa rokom od 15 minuta, generisan u `toPublicLead`
- Upis putanja u `website_audits.screenshot_desktop` / `screenshot_mobile`

---

## 5. Rukovanje neuspehom

Sajt koji ne može da se otvori je **dobar lead, ne greška.**

| Ishod | Šta upisati |
|---|---|
| Timeout, DNS greška, TLS greška | `site_status = 'mrtav'`, bez screenshota, `audit_level` ostaje 1 |
| 4xx / 5xx | screenshot stranice greške (to je i dalje ono što posetilac vidi) |
| Blokiran SSRF-om | bez screenshota, `last_error` u job-u, tiho preskoči |

U UI-u: umesto praznog mesta prikaži poruku *„Sajt se ne otvara — to je najjači mogući argument
u poruci vlasniku."*

---

## 6. Gotovo kad

- Unlock leada sa sajtom vraća dva screenshota u roku od 30 sekundi
- Signed URL prestaje da radi posle 15 minuta
- Direktan pristup putanji u bucketu bez potpisa → odbijen
- Testni URL koji redirektuje na `http://169.254.169.254/` → posao odbijen, ništa upisano
- Testni URL `http://127.0.0.1:8080` → odbijen pre DNS-a
- 50 uzastopnih screenshotova ne obori worker; memorija se vrati posle restarta browsera

Prve dve SSRF provere uradi stvarno, sa svojim testnim domenom koji redirektuje. Ne pretpostavljaj.

---

## 7. Ne radi u ovoj fazi

- Bez PageSpeed i Claude poziva — to je F6
- Bez screenshotova u bulk scanu, ni „samo za prvih 5 rezultata"
- Bez javnog Storage bucketa ni „privremeno javnog za testiranje"

---

## 8. Prompt za sesiju

```
Radimo docs/F5-screenshot.md. Pročitaj CLAUDE.md, docs/00-kontekst.md i
docs/bezbednost.md sekciju P0-5 i P0-6 prvo.

Redosled: safe-url.ts sa testovima → Docker hardening → Playwright modul →
integracija u enrich_full.

Za safe-url.ts napiši i test fajl koji pokriva: privatni IP, loopback,
169.254.169.254, credentials u URL-u, i redirekcioni lanac koji na trećem
hopu vodi na privatnu adresu. Testove hoću da vidim da prolaze pre nego što
Playwright uopšte uđe u priču.
```
