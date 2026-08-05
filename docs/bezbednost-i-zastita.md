# Bezbednost i zaštita od kopiranja

Prioritetizovano. P0 mora pre launcha, P1 pre 100 korisnika, P2 kasnije.
Sve je specifično za ovu aplikaciju — generički OWASP checklist možeš naći bilo gde.

---

# DEO 1 — BEZBEDNOST

## P0-1. Krediti su novac. Tretiraj ih tako.

Najveća finansijska površina napada. Tri odvojena problema:

### Race condition / double-spend

Korisnik sa 1 kreditom pošalje 20 paralelnih zahteva za otključavanje 20 različitih leadova. Ako proveravaš balans pa onda umanjuješ, prođe svih 20.

**Rešenje: sve u jednoj Postgres funkciji sa row lockom.**

```sql
create or replace function spend_credit_and_unlock(p_user uuid, p_place text)
returns table (ok boolean, reason text)
language plpgsql
security definer
as $$
declare
  v_balance int;
begin
  -- ključni deo: FOR UPDATE zaključava red do kraja transakcije
  select credits_balance into v_balance
  from profiles where id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user'; return;
  end if;

  -- već otključano → besplatno, ne naplaćuj dvaput
  if exists (select 1 from unlocks where user_id = p_user and place_id = p_place) then
    return query select true, 'already_unlocked'; return;
  end if;

  if v_balance < 1 then
    return query select false, 'insufficient_credits'; return;
  end if;

  insert into unlocks (user_id, place_id) values (p_user, p_place);
  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, -1, 'unlock', p_place);
  update profiles set credits_balance = credits_balance - 1 where id = p_user;

  return query select true, 'unlocked';
end;
$$;
```

Nikad ne radi `select balance` → `if` u JavaScriptu → `update balance`. To je klasična rupa.

### Klijentska provera je dekoracija

Sakriveni dugme "Otključaj" kad nema kredita je UX, ne bezbednost. Endpoint mora sam da proveri. Uvek.

### IDOR na unlock endpointu

```ts
// ❌ POGREŠNO — veruje klijentu
const { userId, placeId } = await req.json();
await spendCredit(userId, placeId);

// ✅ TAČNO — user_id isključivo iz verifikovane sesije
const { userId } = await auth();           // Clerk, server-side
if (!userId) return unauthorized();
const { placeId } = parseSchema(await req.json());
await spendCredit(userId, placeId);
```

`user_id` nikad ne dolazi iz request body-ja, query parametra ili headera. Samo iz verifikovanog tokena.

---

## P0-2. Cache-miss pretraga je tvoj trošak, a korisniku je besplatna

**Ovo je propust u originalnom PRD-u.** Krediti se troše na otključavanje, ali Google API pozive plaća pretraga. Korisnik sa free planom može da prođe 48 niša × 50 gradova i natera te da platiš kompletan sweep Srbije za nula kredita.

Tri sloja popravke:

```ts
const SEARCH_LIMITS: Record<string, { cacheMissPerDay: number }> = {
  free:     { cacheMissPerDay: 3 },
  starter:  { cacheMissPerDay: 15 },
  pro:      { cacheMissPerDay: 40 },
  agency:   { cacheMissPerDay: 100 },
  lifetime: { cacheMissPerDay: 40 },
};
```

1. **Dnevni limit cache-miss pretraga po planu.** Pretrage iz keša su neograničene i instant — to je i marketinška poenta, ne samo zaštita.
2. **Globalni dnevni budžet API poziva.** Hard stop u kodu, nezavisno od korisnika. Ako se pređe, novi cache-miss zahtevi idu u red za sutra sa jasnom porukom.
3. **Google Cloud quota ispod besplatnog praga.** Budget alerts samo obaveštavaju — **quota limits zaustavljaju**. Postavi per-API dnevni limit koji matematički ne može da pređe mesečni free tier.

Ako i dalje boli: naplati 1 kredit za cache-miss pretragu, a 0 za pretragu iz keša. Time se cena poravnava sa tvojim troškom i korisniku objašnjava zašto su neke pretrage instant.

---

## P0-3. Zamućeni podaci moraju NEDOSTAJATI u odgovoru

Najčešća greška u lead-gen proizvodima:

```ts
// ❌ KATASTROFA — telefon i mejl su u JSON-u, CSS ih samo zamućuje
return json(businesses);  // {name, phone, email, ...}
```

```ts
// ✅ Server izbacuje polja za sve što nije otključano
const unlockedIds = new Set(await getUnlockedPlaceIds(userId));

const safe = businesses.map((b) => {
  const isUnlocked = unlockedIds.has(b.place_id);
  return {
    place_id: b.place_id,
    name: b.name,
    city_slug: b.city_slug,
    ugly_band: b.ugly_band,
    status_flag: b.status_flag,
    platform: b.platform,
    has_website: !!b.website_url,
    // sve ispod samo ako je otključano:
    phone:        isUnlocked ? b.phone : null,
    email:        isUnlocked ? b.email : null,
    website_url:  isUnlocked ? b.website_url : null,
    ugly_score:   isUnlocked ? b.ugly_score : null,
    ai_issues:    isUnlocked ? b.ai_issues : null,
    screenshot:   isUnlocked ? await signedUrl(b.screenshot_desktop) : null,
  };
});
```

Isto važi za Supabase Realtime kanale i za bilo koji `select *` koji ide klijentu.

**Screenshotovi:** Supabase Storage bucket mora biti **privatan**, sa signed URL-ovima koji ističu za 15 minuta. Javni bucket sa predvidivim imenima fajlova (`{place_id}.webp`) znači da ti ceo vizualni deo baze može enumerisati bilo ko.

---

## P0-4. Supabase RLS i service_role ključ

Dva pravila:

**1. `SUPABASE_SERVICE_ROLE_KEY` nikad ne sme u klijentski bundle.** Bez `NEXT_PUBLIC_` prefiksa, nikad u komponenti, nikad u `use client` fajlu. Provera:

```bash
npm run build && grep -r "service_role\|eyJhbGciOi" .next/static/ && echo "PROBLEM"
```

Ubaci ovo u CI. Jedan slučajan import i cela baza je javna.

**2. RLS uključen na SVAKOJ tabeli, bez izuzetka.**

```sql
alter table profiles              enable row level security;
alter table credit_ledger         enable row level security;
alter table unlocks               enable row level security;
alter table lists                 enable row level security;
alter table list_items            enable row level security;
alter table outreach_messages     enable row level security;
alter table radar_subscriptions   enable row level security;
alter table invoices              enable row level security;
alter table businesses            enable row level security;
alter table website_audits        enable row level security;

-- korisnički podaci: vidi samo svoje
create policy "own rows" on unlocks
  for all using (user_id = auth.uid());

-- deljeni podaci: čitanje kroz aplikaciju, pisanje samo service role
create policy "no direct read" on businesses
  for select using (false);
```

Za `businesses` i `website_audits` idi na `using (false)` i sve čitanje provlači kroz svoje API rute. Tako imaš jedno mesto gde se primenjuje logika iz P0-3. Ako dozvoliš direktan Supabase klijent pristup tim tabelama, korisnik može da napiše svoj upit i uzme sve.

---

## P0-5. Renderovanje nepoznatih sajtova — najveća površina napada

Ti dobrovoljno otvaraš stotine nepoznatih sajtova u pravom Chromiumu na svom serveru. Normalne web aplikacije to ne rade.

**Playwright izolacija:**

```yaml
# docker-compose.yml na Hetzneru
services:
  worker:
    build: .
    user: "1001:1001"              # ne root
    read_only: true
    tmpfs:
      - /tmp:size=512M
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    mem_limit: 1g
    pids_limit: 200
    networks:
      - egress-only               # bez pristupa internoj mreži
```

```ts
const browser = await chromium.launch({
  args: [
    "--no-sandbox",                    // potrebno u kontejneru, ali...
    "--disable-dev-shm-usage",
    "--disable-file-system",           // ...zato blokiraj file access
    "--disable-extensions",
    "--disable-plugins",
    "--block-new-web-contents",        // bez popup prozora
  ],
});

// svež kontekst po sajtu, nikad deljen
const ctx = await browser.newContext({
  javaScriptEnabled: true,
  bypassCSP: false,
  serviceWorkers: "block",
  permissions: [],
});

const page = await ctx.newPage();
page.setDefaultTimeout(15_000);

// blokiraj sve što nije potrebno za screenshot
await page.route("**/*", (route) => {
  const t = route.request().resourceType();
  if (["media", "websocket", "eventsource", "manifest"].includes(t)) {
    return route.abort();
  }
  route.continue();
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.screenshot({ path, type: "webp" });
} finally {
  await ctx.close();   // uvek, i na grešku
}
```

Plus: hard timeout na ceo job (30s), automatski restart browsera svakih 50 sajtova (memory leak), i limit paralelnih konteksta (3-5 na CX22).

---

## P0-6. SSRF zaštita

Trenutno URL-ovi dolaze iz Googlea, pa je rizik nizak. **U trenutku kada dodaš polje "unesi URL svog sajta za analizu" — a dodaćeš ga, to je očigledan feature — postaje kritično.** Napiši zaštitu sada.

```ts
import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

const BLOCKED_RANGES = [
  "private",      // 10/8, 172.16/12, 192.168/16
  "loopback",     // 127/8
  "linkLocal",    // 169.254/16 — cloud metadata endpoint!
  "uniqueLocal",  // fc00::/7
  "carrierGradeNat", // 100.64/10
  "unspecified",
  "reserved",
];

export async function resolveSafeUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("invalid_url"); }

  if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad_scheme");
  if (u.username || u.password) throw new Error("credentials_in_url");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error("local_host");

  const { address } = await dns.lookup(u.hostname);
  const parsed = ipaddr.parse(address);
  if (BLOCKED_RANGES.includes(parsed.range())) throw new Error("blocked_ip");

  return { url: u, ip: address };
}
```

Dve stvari koje se lako propuste:

- **DNS rebinding.** Domen se resolvuje u javni IP pri proveri, pa u `127.0.0.1` pri fetchu. Rešenje: fetch šalji **na razrešeni IP** sa `Host` headerom, ne na hostname.
- **Redirekcije.** Sajt vrati `302` na `http://169.254.169.254/`. Postavi `redirect: "manual"`, prati ručno, **proveri svaki hop kroz istu funkciju**, max 3 skoka.

`169.254.169.254` je cloud metadata endpoint. Na Hetzneru odatle izlaze podaci o serveru. Ovo nije teoretski.

---

## P0-7. API ključevi i tajne

| Ključ | Gde živi | Zaštita |
|---|---|---|
| Google Places | samo worker, env var | **IP restriction na Hetzner IP** + API restriction samo na Places API + dnevna quota ispod free tiera |
| PageSpeed Insights | worker | API restriction, quota |
| Anthropic | worker | nikad u Vercel klijentskom kodu; postavi spend limit u konzoli |
| Supabase service_role | worker + Vercel server env | grep provera u CI-u (P0-4) |
| Clerk secret | Vercel server env | |
| LS webhook secret | Vercel server env | |

Google ključ bez IP restrikcije koji procuri = neko ti potroši ceo budžet za jedan dan. Restrikcija je jedno polje u konzoli i najveći ROI od svih bezbednosnih mera na ovoj listi.

`.env` u `.gitignore`, `git secrets` ili `gitleaks` kao pre-commit hook. Ako ključ ikada dodirne git istoriju — rotiraj ga, ne briši commit.

---

## P0-8. Validacija ulaza sa allowlistom

Grad i niša **nikad** kao slobodan tekst:

```ts
import { z } from "zod";
import { CITIES, NICHES } from "@/shared/taxonomy";

const searchSchema = z.object({
  city:  z.enum(CITIES.map((c) => c.slug) as [string, ...string[]]),
  niche: z.enum(NICHES.map((n) => n.slug) as [string, ...string[]]),
  limit: z.number().int().min(10).max(60),
});
```

Ovo rešava tri stvari odjednom: sprečava injection u Places upit, sprečava korisnika da generiše proizvoljno skupe pozive, i garantuje da je keš ključ deterministički. Slobodan tekst u pretrazi je i bezbednosni i troškovni i keš problem.

---

## P1 — pre prvih 100 korisnika

**Rate limiting na tri nivoa.** Po korisniku (logika), po IP-u (Vercel/Upstash), i po queue depth-u (worker odbija ako je red predugačak). Bez IP limita jedan skript sa 50 free računa je isto što i jedan zlonameran korisnik.

**Webhook idempotencija.**
```sql
create table webhook_events (
  provider   text not null,
  event_id   text not null,
  processed_at timestamptz default now(),
  primary key (provider, event_id)
);
```
Insert pre obrade, na konflikt preskoči. Bez toga jedan LS retry duplira kredite.

**Audit log za sve što dodiruje novac.** `credit_ledger` već imaš. Dodaj `admin_actions` za ručne aktivacije i refundove. Kad ti prvi korisnik kaže "platio sam a nemam kredite", trebaće ti trag.

**Bezbednosni headeri.** CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. Next.js `headers()` u `next.config.js`, 20 minuta rada.

**Deljenje računa.** Jedan Pro nalog koji koristi pet ljudi iz agencije je izgubljen prihod. Clerk podržava limit paralelnih sesija. Detekcija: >4 različita IP-a u 24h → soft upozorenje, pa ponuda Agencija plana. Ne banuj automatski, prodaj im upgrade.

**Backup.** Supabase point-in-time recovery na plaćenom planu. Do tada `pg_dump` cron na Hetzneru, sedam dnevnih kopija, offsite. Baza audita ti je celokupna imovina proizvoda — izgubiš je, izgubio si sve.

**Zavisnosti.** Dependabot ili Renovate, `npm audit` u CI-u. Playwright i Chromium drži ažurne — renderuješ nepoznat sadržaj, tu CVE-jevi zaista znače nešto.

**Zaštita lične podatke po ZZPL-u.** Mejlovi preduzetnika su podaci o ličnosti. Ne loguj pun kontakt u aplikacione logove. Napravi endpoint/proceduru za brisanje na zahtev. Politika privatnosti mora da postoji pre prvog korisnika.

## P2 — kasnije

- 2FA za admin panel (Clerk)
- Anomaly detekcija: korisnik koji otključa 300 leadova u satu radi bulk izvlačenje, ne prospekting
- Sentry ili sličan error tracking sa scrubovanjem PII-ja
- Penetration test kad prođeš ~500 korisnika
- SOC2 i sličan cirkus: nikad, za ovaj proizvod

---

# DEO 2 — ZAŠTITA OD KOPIRANJA

## Iskrena polazna točka

**Ideju ne možeš zaštititi. Nikako.** Ti sam kopiraš Ugly Site Scraper i to je legitimno — poslovni modeli i koncepti nisu predmet zaštite. Softverski patenti u Srbiji i EU za poslovne metode praktično nisu dostupni, a i da jesu, koštali bi više od godišnjeg prihoda ovog proizvoda i trajali bi godinama.

Znači: **ako alat uspe, neko će ga kopirati.** Planiraj oko toga, ne protiv toga.

Ono što realno možeš:

## Sloj 1 — pravno, jeftino

### Autorsko pravo — automatski, nula dinara

Kod, tekstovi, dizajn, PDF šabloni i baza podataka su zaštićeni autorskim pravom **od trenutka nastanka**, bez ikakve registracije (Bernska konvencija). Ako neko kopira tvoj kod ili tvoj marketinški tekst — to je povreda i imaš osnov.

Praktično:
- Drži privatan repo sa čitljivom git istorijom (dokaz autorstva sa datumima)
- Copyright notice u futeru i u zaglavljima izvornih fajlova
- Ako uzimaš izvođača — pisani ugovor sa prenosom prava, inače prava ostaju njemu

### Žig kod ZIS-a — ovo je tvoj glavni pravni potez

Registracija žiga u Zavodu za intelektualnu svojinu je red veličine jeftinija i brža od patenta i štiti ono što se realno može ukrasti: **ime i logo**. Konkurent može da napravi isti alat, ali ne sme da ga nazove isto.

- Klase koje su relevantne: **9** (softver), **35** (poslovne usluge, reklamiranje), **42** (SaaS, računarske usluge)
- Uradi to **nakon** što potvrdiš da proizvod ima kupce, ne pre
- Ako ideš na region, razmotri EUIPO žig za EU — pokriva Hrvatsku i Sloveniju
- Proveri bazu ZIS-a pre nego što se vežeš za ime, i istovremeno proveri dostupnost domena na RNIDS-u

### Uslovi korišćenja — ono što ti omogućava da nekoga isključiš

Bez ovoga ne možeš ni da banuješ nekoga bez rizika. Obavezne klauzule:

- Zabrana automatizovanog pristupa, scrapinga i reverse engineeringa
- Zabrana preprodaje, dalje distribucije i deljenja pristupa
- Zabrana korišćenja podataka za izgradnju konkurentskog proizvoda
- Jedan nalog = jedno lice; deljenje je osnov za suspenziju
- Pravo na suspenziju bez povraćaja u slučaju kršenja
- Korisnik je odgovoran za način na koji šalje poruke prospektima

Kršenje ToS-a je povreda ugovora — to je mnogo lakše dokazati od povrede autorskog prava i dovoljno za suspenziju i za pretnju.

### Domeni

Kupi `.rs`, `.co.rs` i `.com` verziju imena. Ukupno ~€40/god i uklanja najgluplji način da ti neko ukrade brend.

## Sloj 2 — tehnički

### Ne šalji moat klijentu

Sve što je stvarno vredno mora ostati na serveru:

| Ostaje na serveru | Nikad u klijentskom bundle-u |
|---|---|
| Težine Ugly Score signala | ❌ |
| Lista heuristika za detekciju platformi | ❌ |
| Claude promptovi | ❌ |
| Fingerprinti domaćih buildera i agencija | ❌ |
| Logika email crawlanja | ❌ |

Ako je algoritam u JavaScriptu koji se šalje browseru, on je javan. Bez izuzetka. Obfuskacija kupuje sate, ne mesece — ne troši vreme na nju.

Isto važi za marketing: reklamiraj **Ugly Score** kao brend, ne objavljuj tabelu težina. Meni je u PRD-u zato što je interni dokument.

### Rate limiti su i anti-kopiranje mera

Mere iz P0-2 i P1 nisu samo bezbednosne. One su ono što sprečava konkurenta da za 3.990 RSD kupi Pro plan i izvuče ti celu bazu. Konkretno:

- Bez bulk endpointa. Nikad "vrati sve leadove za grad X".
- Paginacija sa hard capom (50 po strani), bez `limit=99999`
- CSV export limitiran na otključane leadove, sa dnevnim capom
- Otključavanje ide jedan po jedan, bez batch endpointa

### Kanarinci u bazi — jeftino i pametno

Ubaci 5-10 lažnih biznisa sa jedinstvenim fingerprintima (nepostojeći nazivi, telefoni sa tvojim test brojem, `.rs` domeni koje ti kontrolišeš). Prati kome su dodeljeni.

Ako se ti zapisi pojave u konkurentskom proizvodu ili u nečijoj CSV datoteci, imaš **dokaz kopiranja** sa tragom do konkretnog naloga. Košta te pola sata rada i vredi neuporedivo više od obfuskacije.

Isti trik: unikatna varijacija u formulaciji `ai_verdict` teksta po nalogu (nevidljiva razlika u interpunkciji ili sinonimu). Ako se pojavi negde, znaš čiji nalog je izvor.

## Sloj 3 — pravi moat

Ovo je jedini deo koji zaista drži. Sve gore je higijena.

| Moat | Zašto se ne kopira |
|---|---|
| **Akumulirana istorija audita** | Konkurent koji krene sutra ne može retroaktivno da ima šest meseci Ugly Score istorije. Ti možeš da pokažeš "ovaj sajt nije diran od januara" — on ne može. |
| **Distribucija** | AI Profit Lab publika. To je godina rada koju konkurent nema. Najjača karta koju imaš. |
| **Feedback loop na konverziju** | Korisnici u kanbanu markiraju "Potpisan". Ti time učiš **koji tip leada zaista konvertuje** i to ubacuješ u skoring. Konkurent startuje sa nula podataka o konverziji. Ovo je jedini pravi data flywheel u proizvodu — prioritetizuj ga. |
| **Srpska specifičnost** | APR enrichment, fingerprinti domaćih agencija, prefiks logika, Viber kanal. Sve to je desetine sati domenskog rada koje strani konkurent neće uraditi, a domaći mora da ponovi. |
| **Brzina** | Dosadno ali tačno: isporučuj brže nego što te kopiraju. Solo developer sa Claude Code-om je ovde u prednosti. |
| **Brend i poverenje** | Ljudi kupuju od tebe jer te poznaju iz zajednice. To se ne forkuje. |

**Feedback loop je najvažniji.** Ako ništa drugo iz ovog dela ne implementiraš, implementiraj to: svaki "Potpisan" u kanbanu je podatak koji tvoj skoring čini boljim, a to je jedina prednost koja **raste** s vremenom i koju konkurent ne može da kupi ni ukrade.

## Šta NE raditi

| Ne troši vreme na | Zašto |
|---|---|
| Patent | Softverske poslovne metode praktično nisu patentibilne u EU/RS; skupo, sporo, beskorisno na ovoj skali |
| Obfuskacija koda | Kupuje sate. Svaki iole ozbiljan konkurent je prođe. |
| Skrivanje stacka | Nema veze sa moatom. Tehnologija nije prednost, podaci i distribucija su. |
| Pravne pretnje konkurenciji | Skupo, loš PR u maloj zajednici, i obično nema pravni osnov jer je ideja slobodna |
| NDA za svakoga sa kim razgovaraš | Otežava prodaju i savete, ne štiti ništa. NDA samo za izvođače koji vide kod. |
| Tajnovitost oko proizvoda | Distribucija ti je moat. Skrivanje ubija distribuciju. Gradi javno. |

---

# CHECKLIST

**P0 — pre launcha**
- [ ] `spend_credit_and_unlock` Postgres funkcija sa `FOR UPDATE`
- [ ] `user_id` isključivo iz Clerk sesije na svim rutama
- [ ] Dnevni limit cache-miss pretraga po planu
- [ ] Globalni dnevni cap API poziva + Google Cloud quota ispod free tiera
- [ ] Server-side stripping polja za neotključane leadove
- [ ] Supabase Storage bucket privatan, signed URL-ovi 15 min
- [ ] RLS na svim tabelama; `businesses`/`website_audits` sa `using (false)`
- [ ] CI grep za `service_role` u `.next/static`
- [ ] Playwright u kontejneru: non-root, read-only, cap_drop ALL, mem limit
- [ ] `resolveSafeUrl` sa blokiranim privatnim opsezima, DNS pinning, ručne redirekcije
- [ ] Google ključ: IP restriction + API restriction + quota
- [ ] Zod allowlist za grad i nišu
- [ ] Uslovi korišćenja i politika privatnosti objavljeni

**P1 — pre 100 korisnika**
- [ ] Rate limit po korisniku, IP-u i queue depth-u
- [ ] `webhook_events` idempotencija
- [ ] Bezbednosni headeri
- [ ] `pg_dump` cron backup, 7 dana, offsite
- [ ] Dependabot + `npm audit` u CI
- [ ] Kanarinci u bazi
- [ ] Detekcija deljenja naloga → ponuda upgrade-a

**Zaštita brenda**
- [ ] Provera imena u ZIS bazi i na RNIDS-u
- [ ] `.rs`, `.co.rs`, `.com` kupljeni
- [ ] Copyright notice u futeru i izvornim fajlovima
- [ ] Žig prijavljen — **posle** potvrde da ima kupaca
- [ ] Feedback loop na "Potpisan" status implementiran
