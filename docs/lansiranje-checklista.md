# Sajtoskop — checklista do lansiranja

> Stanje na **16. septembar 2026** · kod zaključno sa migracijom `0034` (commit `c6506d1`) ·
> migracije `0001`–`0034` puštene na Supabase · Stripe test mod podešen.
> PDF verzija: `docs/lansiranje-checklista.pdf` (pravi se iz ovog fajla, `pnpm docs:pdf`).

**Kako se koristi.** Stavke su poređane redom kojim se rade. Svaka ima korake i red

**Gotovo kad** — stavka je gotova tek kad on važi, ne kad su koraci prekucani. Štikliraj ovde
(`- [x]`), pa pusti `pnpm docs:pdf` da se osveži i PDF. Detaljni koraci testiranja su u
`docs/plan-testiranja.md`; ovde stoji samo kada se koji deo radi.

**Redosled:** 0 Hitno → 1 Infrastruktura → 2 Kod koji fali → 3 Testiranje → 5 Landing →
6 Prelazak na live → 7 Otvaranje. **Sekciju 4 (pravno i poresko) pokreni odmah, paralelno sa
svim ostalim** — odgovori sa strane traju najduže.

**Već urađeno:** migracije `0001`–`0034` na Supabase-u · Stripe test mod (katalog od 8 cena,
kupon, Customer Portal, webhook, `pnpm stripe:doktor` prolazi) · `ADMIN_BOOTSTRAP_IDS` na
Vercelu · Clerk produkcijska instanca i webhook sa `user.created`, `user.updated`,
`user.deleted` · test brisanja naloga · bucket `feedback` · DNS i domen `app.sajtoskop.com` ·
baza očišćena 14.9. · jedini nalog ima `profiles.role = 'admin'`.

---

## 0. Hitno

- [ ] **0.1 · Worker redeploy na Hetzneru** — odmah, najkasnije 30. septembra
  Na serveru radi kod stariji od S25. Prvog u mesecu bi mesečna dodela postavila kredite
  svima po `profiles.plan` (i probi i mesečnim pretplatama, koje puni Stripe), a worker ne
  zna ni `fail_scan_and_refund` iz `0034`.
  1. Lokalno proveri da je sve na GitHubu: `git status` (čisto), `git push`, pa
     `git log origin/main -1 --oneline` mora da pokaže `c6506d1` ili noviji commit.
  2. Uloguj se na server: `ssh marko@<IP>` (IP je u Hetzner Console → Servers).
  3. Povuci kod:
     ```bash
     cd ~/sajtoskop && git pull
     ```
  4. Proveri `.env` na serveru — mora da ima ove ključeve (vrednosti ne ispisuj):
     ```bash
     grep -oE "^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|GOOGLE_MAPS_API_KEY|PSI_API_KEY|ANTHROPIC_API_KEY|WORKER_CONCURRENCY|PLACES_MONTHLY_BUDGET_EUR)=" ~/sajtoskop/.env
     ```
     Fali li `PLACES_MONTHLY_BUDGET_EUR`, dopiši ga istom vrednošću kao na Vercelu (v. 1.1):
     `echo "PLACES_MONTHLY_BUDGET_EUR=100" >> ~/sajtoskop/.env`.
  5. Pokreni novi build:
     ```bash
     docker compose -f apps/worker/docker-compose.yml up -d --build
     docker compose -f apps/worker/docker-compose.yml logs -f --tail=50
     ```
     Očekuj red `worker start · 3 radnika · žetva na 15 min`. Izađi sa `Ctrl+C`.
  6. Proveri da je pravi kod na disku:
     ```bash
     grep -c "subscriptions" apps/worker/src/jobs/monthly-grant.ts     # mora > 0
     grep -c "fail_scan_and_refund" apps/worker/src/lib/db-writes.ts   # mora > 0
     ```
  7. U aplikaciji, kao admin, pokreni jedno skeniranje **Brzo** nad kombinacijom koje nema u
     kešu. Lista mora da stigne za manje od 2 minuta, a u logu workera piše 1 API poziv.

  **Gotovo kad:** `docker compose … ps` pokazuje `Up` bez restart petlje i skeniranje iz
  aplikacije prolazi.

---

## 1. Infrastruktura, nalozi i env

- [ ] **1.1 · Vercel env promenljive**
  1. Vercel → projekat → **Settings → Environment Variables**.
  2. U pretrazi otkucaj `PADDLE`, pa `POLAR` — obriši sve što nađeš.
  3. Proveri da u **Production** postoji svaka promenljiva iz tabele (vrednosti iz lokalnog
     `.env`, osim gde piše drugačije):

     | Promenljiva | Production vrednost |
     |---|---|
     | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | produkcijski Supabase projekat |
     | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk **Production** instanca (`pk_live_`, `sk_live_`) |
     | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_COUPON_FIRST_MONTH` | **za sada test** (`sk_test_`, `whsec_` test endpointa na `app.sajtoskop.com`, ID test kupona — `sajtoskop_prvi_mesec` ako je pravljen kroz `pnpm stripe:seed`); u 6.4 prelaze na live |
     | `NEXT_PUBLIC_APP_URL` | `https://app.sajtoskop.com` |
     | `NEXT_PUBLIC_LANDING_URL` | `https://www.sajtoskop.com` (sa `www`) |
     | `NEXT_PUBLIC_SELLER_NAME` | `Remati LLC` |
     | `CRON_SECRET` | nova vrednost: `openssl rand -base64 32` |
     | `ADMIN_BOOTSTRAP_IDS` | već postavljeno |
     | `RESEND_API_KEY`, `FEEDBACK_EMAIL_FROM`, `FEEDBACK_EMAIL_TO` | v. 1.8 |
     | `PLACES_MONTHLY_BUDGET_EUR` | `100` — **ista vrednost i na workeru** |

     Google, PageSpeed i Anthropic ključevi **ne idu** na Vercel — žive samo na workeru.
  4. **Preview** okruženje ti ne treba dok ne testiraš naplatu na preview deployu. Ako ga
     koristiš: Stripe test ključevi i **poseban** test webhook endpoint (nikad isti `whsec_`
     kao Production), Clerk development ključevi.
  5. **Deployments** → poslednji deploy → **⋯ → Redeploy**. Env se čita samo pri deployu.
  6. Proveri cron tajnu:
     ```bash
     curl -s -o /dev/null -w "%{http_code}\n" https://app.sajtoskop.com/api/cron/utisci-digest
     # očekivano 404 (bez tajne)
     curl -s -o /dev/null -w "%{http_code}\n" -H "x-cron-secret: <CRON_SECRET>" https://app.sajtoskop.com/api/cron/utisci-digest
     # očekivano 200
     ```

  **Gotovo kad:** nijedna `PADDLE_*`/`POLAR_*` ne postoji, cron vraća 404 bez tajne i 200 sa
  njom, a `/cenovnik` na `app.sajtoskop.com` se otvara bez greške.

- [ ] **1.2 · Vercel Pro plan**
  Hobby plan je po Vercelovim uslovima samo za lične, nekomercijalne projekte — aplikacija
  koja naplaćuje pretplatu tu ne spada. Pro plan uz to daje više cron poslova, pa treći cron
  (`utisci-slike`) prestaje da bude ručni korak (v. 2.4).
  1. Vercel → **Settings → Billing** (nivo tima) → **Upgrade to Pro**.
  2. Kod podešavanja potrošnje uključi **Spend Management** i postavi gornju granicu (npr. $50).

  **Gotovo kad:** tim je na Pro planu, a limit potrošnje je postavljen.

- [ ] **1.3 · Supabase plan — odluka Free ili Pro**
  Free plan nema dnevne backupe, pauzira projekat posle nedelju dana bez saobraćaja i ima
  500 MB baze. Pro ($25/mesec) daje 7 dana dnevnih backupa i bez pauze. **Preporuka:** Pro
  pre prve prave naplate.
  1. Supabase → **Organization → Billing → Change subscription plan → Pro**.
  2. Ostavi **Spend Cap** uključen (podrazumevano je uključen) — tako nema iznenadnog računa.
  3. Posle 24 h: **Database → Backups** mora da pokaže prvi dnevni backup.

  **Gotovo kad:** odluka je doneta; ako je Pro — vidi se prvi dnevni backup.

- [ ] **1.4 · Backup baze van Supabase-a** (ranije R25)
  Radi i uz Supabase Pro: backup kod istog provajdera ne štiti od gubitka naloga. Backup koji
  nikad nije vraćen nije backup — zato je vraćanje deo stavke.
  1. Supabase → **SQL Editor** → `select version();` — zapamti glavnu verziju Postgresa
     (npr. 17).
  2. Supabase → dugme **Connect** (gornja traka) → **Session pooler** → kopiraj URI i zameni
     `[YOUR-PASSWORD]` lozinkom baze. (Pooler radi preko IPv4; direktna konekcija je samo IPv6.)
  3. Na serveru instaliraj `pg_dump` iste ili novije verzije:
     ```bash
     sudo apt install -y postgresql-common
     sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
     sudo apt install -y postgresql-client-17     # broj iz koraka 1
     pg_dump --version
     ```
  4. Tajne u fajl koji čita samo tvoj korisnik:
     ```bash
     cat > ~/.sajtoskop-backup.env <<'EOF'
     DATABASE_URL='postgresql://…iz koraka 2…'
     BACKUP_DIR=/home/marko/backups/sajtoskop
     EOF
     chmod 600 ~/.sajtoskop-backup.env
     ```
  5. Prvo ručno pokretanje:
     ```bash
     set -a; . ~/.sajtoskop-backup.env; set +a
     bash ~/sajtoskop/scripts/backup.sh
     ```
     Očekuj red `backup: /home/marko/backups/sajtoskop/sajtoskop-….sql.gz (N MB)`.
  6. Off-site kopija kroz `rclone` (primer sa Google Drive-om):
     - na serveru: `sudo apt install -y rclone`, pa `rclone config` → `n` (novi remote) → ime
       `gdrive` → tip `drive` → na pitanje o automatskoj konfiguraciji odgovori `n`;
     - na laptopu: `brew install rclone`, pa `rclone authorize "drive"` → prijavi se u
       pregledaču → kopiraj token nazad u terminal servera;
     - proveri: `rclone mkdir gdrive:sajtoskop-backups && rclone lsd gdrive:`.
  7. Zakaži svaku noć — `crontab -e` i dodaj jedan red:
     ```bash
     30 1 * * * set -a; . /home/marko/.sajtoskop-backup.env; set +a; /bin/bash /home/marko/sajtoskop/scripts/backup.sh >> /home/marko/backups/backup.log 2>&1 && rclone copy /home/marko/backups/sajtoskop gdrive:sajtoskop-backups >> /home/marko/backups/backup.log 2>&1
     ```
     (01:30 po vremenu servera, UTC — to je 03:30 po Beogradu leti.)
  8. **Vraćanje na probu**, na laptopu (treba `psql`: `brew install libpq && brew link --force libpq`,
     i Docker Desktop):
     ```bash
     rclone copy gdrive:sajtoskop-backups ./restore --max-age 25h
     docker run -d --name restore-test -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:17
     sleep 5
     gunzip -c restore/sajtoskop-*.sql.gz | psql postgresql://postgres:test@localhost:5433/postgres > restore.log 2>&1
     psql postgresql://postgres:test@localhost:5433/postgres -c "select (select count(*) from profiles) p, (select count(*) from credit_ledger) l, (select count(*) from businesses) b;"
     ```
     Greške u `restore.log` o ulogama, ekstenzijama i šemama `auth`/`storage` su očekivane
     (to su Supabase stvari). Brojevi iz poslednje komande moraju da se poklope sa istim
     upitom u Supabase SQL Editoru (± redovi nastali posle backupa).
  9. Počisti: `docker rm -f restore-test`, obriši `./restore`.

  **Gotovo kad:** tri noći zaredom nova kopija stoji na off-site mestu, a probno vraćanje dalo
  je iste brojeve.

- [ ] **1.5 · Odvojena baza za lokalni razvoj** — preporučeno pre live-a
  Lokalni `.env` danas gađa produkcijsku bazu. Posle otvaranja to znači da svako lokalno
  testiranje sa Stripe test ključevima upisuje lažne pretplate među prave korisnike i troši
  pravi Places budžet (`api_budget`).
  1. Supabase → **New project** → ime `sajtoskop-dev`, region **Frankfurt**, Free plan.
  2. Migracije, redom (sve su idempotentne): dev projekat → **Connect → Session pooler** →
     kopiraj URI, pa na laptopu (`psql` iz `brew install libpq`)
     ```bash
     read -s DEV_DB_URL && export DEV_DB_URL
     for f in supabase/migrations/*.sql; do echo "$f"; psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" || break; done
     ```
     Poslednji ispisan fajl mora da bude `0034_scan_refund.sql`, bez greške.
  3. Dev projekat → **Storage** → napravi bucket `feedback` (Public: off). Bucket `screenshots`
     pravi migracija — proveri da postoji i da je privatan.
  4. Dev projekat → **Authentication → Sign In / Providers → Third-Party Auth → Clerk** →
     domen Clerk **development** instance (Clerk → Configure → Integrations → Supabase).
  5. U lokalnom `.env` zameni tri Supabase vrednosti ključevima dev projekta; Clerk ostaje na
     development ključevima, Stripe na test ključevima.
  6. Da bi lokalno bilo šta da se pretraži: `pnpm seed` (puni `businesses` iz arhive), a nova
     skeniranja pokreći sa `--mock` gde god može.
  7. Worker na Hetzneru **ostaje** na produkcijskoj bazi. Lokalni worker (`pnpm worker`)
     čita lokalni `.env`, dakle dev bazu.

  **Gotovo kad:** `pnpm dev` radi nad dev bazom, a produkcijska baza posle lokalnog testiranja
  nema nijedan nov red.

- [ ] **1.6 · Google Cloud: ključ, kvota i budžet**
  1. **APIs & Services → Credentials** → ključ koji koristi worker:
     - **Application restrictions → IP addresses:** samo IPv4 (i IPv6) adresa Hetzner servera;
     - **API restrictions → Restrict key:** samo *Places API (New)* i *PageSpeed Insights API*.
  2. **APIs & Services → Places API (New) → Quotas & System Limits** → nađi dnevnu kvotu za
     Text Search → **Edit** → postavi **250**.
     Zašto 250: sa `PLACES_MONTHLY_BUDGET_EUR = 100` aplikacija dozvoljava 206 poziva dnevno
     (4.125 mesečno ÷ 20). Googleova kvota mora da bude malo iznad aplikativne, inače Google
     odbije skeniranje pre nego što naš brojač stigne da kaže zašto. Kad podigneš budžet (v.
     „Posle lansiranja"), podigni i ovu kvotu.
  3. **Billing → Budgets & alerts → Create budget** → €50 mesečno, obaveštenja na 50 %, 90 % i
     100 %, na tvoj mejl.
  4. Posle dan-dva: **APIs & Services → Metrics** → grupiši po *Credential* — pozivi dolaze samo
     sa ključa servera. (Ne proveravaj pravim `pnpm scan` sa laptopa: ako restrikcija ne radi,
     taj poziv se plaća.)

  **Gotovo kad:** ključ ima IP i API restrikciju, kvota je 250/dan, budžet alarm postoji.

- [ ] **1.7 · Anthropic spend limit** (ranije R15)
  1. [platform.claude.com](https://platform.claude.com) → **Settings → Billing → Spend limits**
     (ne `Settings → Limits` — tamo su rate limitovi, oni ne štite novčanik).
  2. Postavi mesečni limit, npr. **$50**, i obaveštenje na $25. Jedno otključavanje košta
     ≈ €0,024, pa $50 pokriva oko 1.800 otključavanja.

  **Gotovo kad:** limit je postavljen i vidi se na istoj strani.

- [ ] **1.8 · Resend: domen i adrese** (ranije R14)
  1. [resend.com](https://resend.com) → **Domains** → `sajtoskop.com` mora da ima status
     **Verified**. Ako nema: kopiraj ponuđene DNS zapise (SPF, DKIM, MX za `send.`
     poddomen) kod DNS provajdera, sačekaj, pa **Verify**.
  2. Na Vercelu (Production): `RESEND_API_KEY`, `FEEDBACK_EMAIL_FROM` (npr.
     `Sajtoskop <podrska@sajtoskop.com>`), `FEEDBACK_EMAIL_TO` (tvoj inboks). Redeploy.
  3. Test: pošalji utisak iz aplikacije (plutajuće dugme) → mejl stiže u tvoj inboks.

  **Gotovo kad:** domen je Verified i probni utisak je stigao mejlom.

- [ ] **1.9 · Adresa `podrska@sajtoskop.com`** (ranije R23)
  Stoji na cenovniku, u stanjima skeniranja, na `/welcome` i u Stripe podešavanjima.
  1. Kod DNS provajdera uključi prosleđivanje pošte — npr. **Cloudflare → Email → Email
     Routing** (ako je DNS na Cloudflare-u) ili [ImprovMX](https://improvmx.com). Oba traže MX
     i SPF zapis na golom domenu; Resend-ov MX je na `send.` poddomenu i ne smeta.
  2. Pravilo: `podrska@sajtoskop.com` → tvoj Gmail.
  3. Test: sa neke druge adrese pošalji mejl na `podrska@sajtoskop.com` → stiže.
  4. Opciono: u Gmailu **Settings → Accounts → Send mail as** da odgovaraš sa te adrese.

  **Gotovo kad:** probni mejl je stigao.

- [ ] **1.10 · Clerk produkcija: prijava Google-om i mejlovi**
  Produkcijska Clerk instanca ne sme da koristi Clerkove deljene Google kredencijale — Google
  prijava traži sopstveni OAuth klijent.
  1. U privatnom prozoru otvori `https://app.sajtoskop.com` → **Nastavi sa Google-om**. Ako
     prolazi do aplikacije, idi na korak 5.
  2. Google Cloud → **APIs & Services → OAuth consent screen** → tip *External*, ime
     „Sajtoskop", domen `sajtoskop.com`, linkovi na `app.sajtoskop.com/privatnost` i `/uslovi`
     → **Publish app** (bez toga prijava radi samo test korisnicima).
  3. **Credentials → Create credentials → OAuth client ID** → *Web application* → u
     *Authorized redirect URIs* nalepi URI koji Clerk prikazuje u koraku 4.
  4. Clerk → Production → **Configure → SSO connections → Google** → *Use custom credentials*
     → nalepi Client ID i Client Secret → Save.
  5. Registruj probni nalog mejlom → mejl sa kodom stiže. Pogledaj mu jezik i pošiljaoca; ako je
     na engleskom, **Clerk → Customization → Emails** → prevedi šablone *Verification code* i
     *Reset password* na srpski.
  6. Obriši probni nalog iz Clerka.

  **Gotovo kad:** Google i mejl registracija rade u privatnom prozoru na `app.sajtoskop.com`.

- [ ] **1.11 · Hetzner: alarm i egress filter**
  1. Hetzner Console → **Billing → Budget alerts** → 10 €.
  2. Na serveru proveri da kontejner ne može ka internoj mreži (pravila su u zaglavlju
     `apps/worker/docker-compose.yml`):
     ```bash
     docker compose -f apps/worker/docker-compose.yml exec worker node -e "fetch('http://169.254.169.254/').then(()=>console.log('OTVORENO')).catch(e=>console.log('OK',e.message))"
     ```
     Mora da ispiše `OK …`. Ako piše `OTVORENO`, primeni `iptables` pravila iz tog zaglavlja i
     `sudo netfilter-persistent save`.
  3. Mejl Hetzner naloga drži pod nadzorom — abuse prijava traži odgovor u 24 h.

  **Gotovo kad:** alarm postoji i provera ispisuje `OK`.

---

## 2. Kod koji fali — sesije sa Claude-om

Svaka stavka je jedna sesija. Prompt se kopira u prazan prozor Claude Code-a u ovom repou.

- [ ] **2.1 · Sentry za serverske greške** — preporučeno
  Pad webhooka ili workera danas vidiš samo ako slučajno gledaš log. Klijentski Sentry je
  namerno odbijen (F11 §13, komentar u `lib/dnevnik-gresaka.ts`), pa se predlaže samo
  serverska strana.
  1. [sentry.io](https://sentry.io) → nalog → dva projekta: **Next.js** (`sajtoskop-web`) i
     **Node** (`sajtoskop-worker`) → sačuvaj oba DSN-a.
  2. Prompt:
     ```
     Pročitaj CLAUDE.md i docs/bezbednost.md. Dodaj Sentry SAMO na serverskoj strani:
     apps/web (route handleri, server komponente, middleware) i apps/worker. Bez
     klijentskog SDK-a u pregledaču — odluka iz lib/dnevnik-gresaka.ts ostaje.
     - DSN iz env-a (SENTRY_DSN); bez DSN-a ništa se ne šalje i nije greška.
     - beforeSend briše mejl, telefon, URL sajta prospekta, tela zahteva, Authorization
       i Stripe/Clerk zaglavlja. Napiši test koji to dokazuje.
     - Obavezno pokriveni: /api/billing/webhook, /api/webhooks/clerk, /api/search,
       /api/unlock, i svaki posao u workeru koji padne konačno.
     - Ako Sentry traži izmenu CSP-a, ne dodaji ništa u connect-src za pregledač.
     pnpm typecheck, pnpm test, pnpm --filter @sajtoskop/web lint, pnpm build.
     Ažuriraj docs/dnevnik-isporuka.md.
     ```
  3. `SENTRY_DSN` na Vercel (Production) i u `.env` na serveru; Vercel redeploy, worker
     `up -d --build`.
  4. Namerno izazovi grešku (npr. pogrešan potpis na webhook ruti nije greška — koristi test
     koji sesija ostavi) i proveri da je stigla u Sentry.

  **Gotovo kad:** probna greška iz weba i iz workera vidi se u Sentry-ju, bez ličnih podataka.

- [ ] **2.2 · Mejlovi za pad naplate i spor** — preporučeno pre live-a
  Stripe mejlovi kupcima su isključeni (mi ih šaljemo), pa kupac kome kartica padne to danas
  vidi samo u aplikaciji. Spor (`dispute`) ima rok za odgovor — ako ne znaš da je otvoren,
  gubiš ga.
  ```
  Pročitaj CLAUDE.md, docs/naplata-stripe.md §6.1 i §7.5. U apps/web/src/lib/billing.ts:
  - invoice.payment_failed → mejl KORISNIKU kroz lib/mail.ts: šta se desilo, da pristup
    traje do <datum>, dugme „Ažuriraj karticu" koje vodi na /krediti (portal se otvara
    odatle). Najviše jedan mejl po fakturi (idempotencija po in_…).
  - charge.dispute.created → mejl MENI (FEEDBACK_EMAIL_TO) sa iznosom, dp_… i linkom na
    Stripe Dashboard. Bez podataka o kartici.
  Srpski, latinica, terminologija iz CLAUDE.md. Pad slanja mejla ne sme da obori
  webhook (200 ostaje). Testovi u apps/web/test/naplata.ts. Ažuriraj docs/dnevnik-isporuka.md.
  ```

  **Gotovo kad:** testovi prolaze; lokalno, scenario N4 iz plana testiranja (kartica
  `4000 0000 0000 0341`, sat +8 dana) pošalje mejl korisniku, a `stripe trigger
  charge.dispute.created` pošalje mejl tebi.

- [ ] **2.3 · Sitne ispravke pre otvaranja**
  ```
  Pročitaj CLAUDE.md. Četiri male izmene, jedan commit:
  1. apps/web/src/app/(app)/dashboard/page.tsx: prečica „Pretraga prospekata" kaže
     „sve što je u kešu je besplatno" — od D10 nije (docs/naplata-stripe.md §14.3).
     Prepiši tačno: pristup listi se plaća jednom i važi 30 dana.
  2. apps/web/test/clerk-webhook.ts: test koji drži da se event id čita iz svix-id
     ZAGLAVLJA (popravka dfb52a7), ne iz tela.
  3. grep -rni "beta\|paddle" apps/web/src — ukloni svaki ostatak u vidljivom tekstu.
  4. Proveri da nijedan tekst u UI-u ne obećava besplatno pretraživanje keša.
  pnpm typecheck, pnpm test, lint. Ažuriraj docs/dnevnik-isporuka.md.
  ```

  **Gotovo kad:** testovi prolaze, grep ne vraća ništa vidljivo korisniku.

- [ ] **2.4 · Treći cron (`utisci-slike`)** — posle 1.2
  ```
  Vercel je na Pro planu. Dodaj /api/cron/utisci-slike u apps/web/vercel.json (jednom
  dnevno, npr. 0 3 * * *), ukloni napomenu o ručnom pokretanju iz .env.example i iz
  docs/lansiranje-checklista.md („Posle lansiranja"). Ažuriraj docs/dnevnik-isporuka.md.
  ```

  **Gotovo kad:** Vercel → Settings → Cron Jobs pokazuje tri posla.

- [ ] **2.5 · Kanarinci i metrike aktivacije** — može i prve nedelje posle otvaranja
  Kanarinci su lažni biznisi po kojima prepoznaš da je neko izvukao bazu; metrike su broj
  ljudi koji stignu do prve poruke i vrate se drugog dana.
  ```
  Pročitaj CLAUDE.md, docs/bezbednost.md (Sloj 2, kanarinci) i docs/tok-i-onboarding.md
  §4.9. (1) scripts/kanarinci.ts: 5–10 izmišljenih biznisa sa telefonom i domenom koje
  kontrolišem; obeležavanje ne sme da procuri u API odgovor ni u CSV — predloži mehanizam
  pre pisanja. (2) Jedan SQL (docs ili scripts/metrike.sql) koji vraća: registracije po
  danu, nalozi sa bar jednom listom, sa bar jednim otključavanjem, sa sva četiri
  onboarding koraka, vratili se drugog dana, aktivne pretplate po planu, kupljeni paketi.
  Blok na /admin samo ako staje bez preprojektovanja ekrana. Ažuriraj docs/dnevnik-isporuka.md.
  ```

  **Gotovo kad:** kanarinci su u bazi, a SQL vraća svih sedam brojeva jednim pozivom.

- [ ] **2.6 · Mejl pred kraj probe i potvrda uplate** — obavezno pre live-a
  Stripe mejlovi kupcima su isključeni (§2.2 spec-a naplate), a naših nema: proba prelazi u
  naplatu osmog dana bez ikakvog upozorenja, a kupac nema potvrdu uplate ni račun u inboksu. To
  su najčešći razlozi za sporove. Plan svih mejlova: `docs/roadmap.md` §5 (mejlovi 5.2 i 6.2).
  1. Stripe (test mod) → **Settings → Business → Customer emails** (ili **Settings → Emails**) →
     uključi **Successful payments** i **Refunds**. Ostale mejlove kupcima ostavi isključene.
  2. Isti ekran → **Preview** jednog mejla → proveri jezik. Ako srpski nije ponuđen, zapiši to
     ovde — onda potvrdu uplate šaljemo mi (dopuna prompta ispod).
  3. **Developers → Webhooks** → test endpoint → **Add events** →
     `customer.subscription.trial_will_end` (Stripe ga šalje 3 dana pre kraja probe, nezavisno od
     podešavanja mejlova). Lokalni `stripe listen` prosleđuje sve događaje i ne traži izmenu.
  4. Prompt:
     ```
     Pročitaj CLAUDE.md, docs/roadmap.md §5.0 i §5.5, docs/naplata-stripe.md §6 i §7, i
     apps/web/src/lib/mail.ts. Dodaj obradu customer.subscription.trial_will_end u
     apps/web/src/lib/billing.ts: mejl korisniku sa podrska@ adrese (FEEDBACK_EMAIL_FROM),
     naslov „Proba se završava <datum>", telo: plan, tačan datum i iznos prve naplate iz
     Stripe objekta, broj kredita koji tada stiže, i dugme „Upravljaj pretplatom" koje vodi
     na /krediti. Jedan mejl po pretplati (idempotencija po ID-u događaja je već u
     billing_events; ne šalji ako pretplata ima zakazan otkaz). Pad slanja ne obara
     webhook. Dopiši događaj u docs/naplata-stripe.md §6.1 i u listu u
     docs/lansiranje-checklista.md 6.3. Test u apps/web/test/naplata.ts. Ako je u koraku 2
     zapisano da Stripe ne šalje na srpskom: dodaj i naš mejl „Uplata primljena" na
     invoice.paid i na kupovinu paketa (iznos, plan ili paket, broj kredita) i reci mi da
     isključim Stripe-ov. pnpm typecheck, pnpm test, lint. Unos u docs/dnevnik-isporuka.md.
     ```
  5. Lokalno: scenario N2 iz plana testiranja, sat pomeren **+4 dana** → mejl „Proba se
     završava" stiže na adresu naloga.
  6. Koraci 1 i 3 se ponavljaju u live modu — stavke 6.2 i 6.3.

  **Gotovo kad:** mejl pred kraj probe stiže u test modu, a Stripe potvrda uplate je uključena
  (ili je naš mejl „Uplata primljena" isporučen).

---

## 3. Testiranje

Detaljni koraci, očekivani ishodi i SQL upiti su u **`docs/plan-testiranja.md`**. Ovde stoji
samo redosled. Rezultate upisuj u zapisnik na kraju tog fajla.

- [ ] **3.1 · Automatske provere** — plan testiranja, Deo 1
  1. `pnpm install` na čistom stablu.
  2. Pusti komande iz Dela 1 redom; sve moraju da prođu.
  3. `pnpm check:f4` pusti nad bazom kojoj je namenjen (dev baza iz 1.5 ako postoji).
  4. GitHub → **Actions** → poslednji `main` commit je zelen.

  **Gotovo kad:** sve komande i CI su zeleni.

- [ ] **3.2 · Naplata u Stripe test modu** — plan testiranja, Delovi 6 i 7
  1. Terminal 1: `pnpm dev`. Terminal 2:
     `stripe listen --forward-to localhost:3000/api/billing/webhook` — `whsec_` koji ispiše mora
     da bude u lokalnom `.env` kao `STRIPE_WEBHOOK_SECRET` (restartuj `pnpm dev` ako si ga menjao).
  2. Za scenarije sa pomeranjem vremena koristi `pnpm stripe:sat` (opis u Delu 0).
  3. Prođi scenarije N1–N14 i P1–P3 redom; posle svakog zalepi izlaz SQL upita u zapisnik.

  **Gotovo kad:** svaki scenario ima ishod „prošlo" i zalepljen izlaz knjige kredita.

- [ ] **3.3 · Onboarding, pretraga, kartica, poruke** — plan testiranja, Delovi 2–5
  Tri naloga iz Dela 0 (bez kartice, proba, komp). Pre prvog klika i posle poslednjeg zapiši
  `api_budget` — onboarding ne sme da potroši nijedan Places poziv.

  **Gotovo kad:** sva tri prolaza stižu do kopirane poruke, `api_budget` je isti.

- [ ] **3.4 · Životni ciklus, admin konzola, utisci** — plan testiranja, Delovi 8–10

  **Gotovo kad:** svih sedam stanja pristupa je viđeno na ekranu i proverene su sve admin
  radnje sa redom u reviziji.

- [ ] **3.5 · Brisanje naloga, worker, bezbednost** — plan testiranja, Delovi 11–13

  **Gotovo kad:** nijedan zaključan podatak ne postoji u API odgovoru, ne-admin dobija 404 na
  `/admin`, brisanje otkazuje pretplatu pre brisanja profila.

- [ ] **3.6 · Vizuelni prolaz** — plan testiranja, Deo 14
  Obe teme, 1280 px i 390 px, svaki ekran iz matrice.

  **Gotovo kad:** matrica je popunjena, nađeno je ili popravljeno ili upisano u zapisnik.

---

## 4. Pravno i poresko — pokreni odmah

- [ ] **4.1 · Pisano pitanje poreskom savetniku** (ranije R18)
  Stripe **nije** merchant of record: prodavac je Remati LLC, Stripe Tax je isključen, a kupci
  su iz Srbije i EU, pretežno fizička lica (frilenseri). Odgovor određuje da li se sme
  naplaćivati ovako kako je podešeno.
  1. Nađi savetnika koji radi i sa američkim LLC-om i sa vlasnikom rezidentom Srbije.
  2. Pošalji pitanja **mejlom** (da odgovor bude pisan):
     - Da li Remati LLC mora da se registruje za PDV u Srbiji (preko poreskog punomoćnika) zbog
       prodaje elektronskih usluga fizičkim licima u Srbiji, i od kog iznosa?
     - Da li za kupce fizička lica iz EU treba registracija u non-Union OSS šemi, i od kog iznosa?
     - Da li važi obaveza fiskalizacije za ovakvu prodaju?
     - Da li treba uključiti Stripe Tax, i sa kojim podešavanjima?
     - Kako se oporezuje dobit LLC-a čiji je jedini vlasnik rezident Srbije?
     - Koji rok čuvanja podataka o naplati da upišem u Politiku privatnosti?
     - Da li i kako važi pravo na odustanak od 14 dana (ugovor na daljinu) za digitalnu uslugu
       koja počinje odmah, i koju formulaciju saglasnosti kupca da stavim u checkout i Uslove?
  3. Odgovor sačuvaj kao PDF van repoa.
  4. Ako odgovor traži izmenu (npr. PDV na cenu, Stripe Tax, samo B2B prodaja) — to je nova
     sesija sa Claude-om **pre** 6.1.

  **Gotovo kad:** stigao je pisan odgovor na svih sedam pitanja i zna se da li nešto mora da
  se menja.

- [ ] **4.2 · Odluka o politici povraćaja** (ranije R17)
  `/povracaj` čeka četiri broja. Primer koji se lako brani (tvoja odluka):
  - **pretplata:** povraćaj u roku od 14 dana od prve naplate, ako je potrošeno najviše 10
    kredita;
  - **posle tog roka:** nema srazmernog povraćaja — otkaz važi do kraja plaćenog perioda;
  - **paket:** 14 dana, samo ako nijedan kredit iz paketa nije potrošen.

  Tehnički, svaki povraćaj iz Stripe Dashboarda sam skida kredite iz knjige (`apply_refund`),
  pa politika ne traži ručni posao.

  **Gotovo kad:** četiri vrednosti su zapisane (ulaz u 4.3).

- [ ] **4.3 · Popuni 25 markera u pravnim tekstovima** (ranije R19)
  Posle 4.1 i 4.2. Na stranama se vide kao žute kapsule, uz baner „Ovo je nacrt".
  1. Skupi podatke: pun naziv (**Remati LLC**), država osnivanja, registrovana adresa, EIN.
     Markeri traže „matični broj" i „PIB" jer su pisani za domaću firmu — za LLC to postaju
     broj iz registra države osnivanja i EIN.
  2. Spisak markera:
     - **`/uslovi` (8):** datum objave · pun naziv i pravna forma · adresa sedišta · matični
       broj · PIB · broj žiga kod ZIS-a (ako ga nema, rečenica ostaje bez broja) · nadležan sud
       · primena propisa o zaštiti potrošača i pravu na odustanak (iz 4.1).
     - **`/privatnost` (11):** datum objave · naziv rukovaoca · adresa · matični broj · PIB ·
       lice za zaštitu podataka (da li je obavezno po ZZPL-u) · zakonski rok čuvanja
       podataka o naplati (4.1) · rok čuvanja revizije (npr. 24 meseca) · rok čuvanja logova
       kod hostinga · stvarni regioni obrade (Supabase Frankfurt, Hetzner lokacija, Vercel
       region) · osnov za prenos van zemlje i ugovori o obradi (DPA) sa obrađivačima.
     - **`/povracaj` (6):** datum objave · rok za zahtev · prag potrošenih kredita · srazmerno
       posle roka ili ne · rok za paket · formulacija o pravu na odustanak (4.1).
  3. Regioni: Supabase → Settings → General (region); Hetzner Console → server (lokacija);
     Vercel → Settings → Functions (region).
  4. DPA: Supabase, Vercel, Clerk, Stripe, Anthropic, Resend i Hetzner imaju standardne ugovore
     o obradi na svojim sajtovima — za većinu je dovoljno prihvatiti ih u podešavanjima naloga.
  5. Prompt:
     ```
     Pročitaj CLAUDE.md. Popuni sve <Popuniti> markere u apps/web/src/app/{uslovi,
     privatnost,povracaj}/page.tsx sledećim vrednostima: <nalepi spisak>. Prodavac je
     Remati LLC — gde marker traži matični broj i PIB, upiši registarski broj i EIN i
     prilagodi rečenicu. Kad nestane poslednji marker, ukloni <NacrtBaner /> sa sve tri
     strane. Ne menjaj ništa drugo u pravnom tekstu bez pitanja. grep "Popuniti" mora da
     vrati samo definiciju komponente. Ažuriraj docs/dnevnik-isporuka.md.
     ```
  6. Pročitaj sve tri strane na `app.sajtoskop.com` od početka do kraja.

  **Gotovo kad:** nijedna žuta kapsula ni baner „Ovo je nacrt" ne postoje na tri strane.

- [ ] **4.4 · Aktivacija Stripe naloga za live**
  Stripe pregleda sajt pre odobrenja: traži vidljive cene, uslove, politiku povraćaja,
  privatnost i kontakt — dakle posle 4.3 i 5.1.
  1. Stripe Dashboard → **Activate payments** (ili Settings → Business → Account details).
  2. Tip: *Company* → *LLC*; EIN; registrovana adresa; website `https://www.sajtoskop.com`;
     opis proizvoda (npr. „Pretplata na SaaS alat za pronalaženje poslovnih prospekata").
  3. Predstavnik: tvoji lični podaci i dokument.
  4. Bankovni račun za isplate (račun LLC-a).
  5. **Settings → Business → Public details:** statement descriptor `SAJTOSKOP`, support
     mejl `podrska@sajtoskop.com`, support URL `https://www.sajtoskop.com/kontakt`, linkovi na
     `https://app.sajtoskop.com/uslovi`, `/privatnost` i `/povracaj`.
  6. Prati mejl — Stripe ume da traži dodatni dokument.

  **Gotovo kad:** Dashboard više ne prikazuje „activate" poziv i live ključevi su dostupni.

---

## 5. Landing (van ovog repoa)

- [ ] **5.1 · Veze, pravne strane i `/bot` na landingu** (ranije R36)
  Danas: `www.sajtoskop.com/povracaj` i `/bot` vraćaju 404, a CTA-ovi vode na nepostojeći
  `/sign-up`.
  1. Otvori landing repo u Claude Code-u.
  2. Kopiraj ceo sadržaj `docs/prompt-landing.md` iz ovog repoa u prazan prozor.
  3. Pregledaj spisak koji sesija vrati (naročito kopiju koju ne sme sama da menja) i odobri.
  4. Deploy landinga.
  5. Provera:
     ```bash
     curl -sI https://www.sajtoskop.com/uslovi | grep -i "^location"      # → https://app.sajtoskop.com/uslovi
     curl -sI https://www.sajtoskop.com/povracaj | grep -i "^location"    # → https://app.sajtoskop.com/povracaj
     curl -s -o /dev/null -w "%{http_code}\n" https://www.sajtoskop.com/bot   # → 200
     curl -s https://www.sajtoskop.com | grep -o 'app.sajtoskop.com/cenovnik?plan=[a-z]*&amp;ciklus=[a-z]*' | sort -u
     curl -s https://www.sajtoskop.com | grep -c "sign-up\|price_"          # → 0
     ```
  6. Klikni svaki CTA na landingu u privatnom prozoru — završava na cenovniku sa istaknutim
     planom.

  **Gotovo kad:** sve provere daju očekivano, a klik na plan preselektuje taj plan.

- [ ] **5.2 · Brojevi na landingu = `plans.ts`** (ranije R35)
  Ponavlja se posle svake izmene cene i obavezno posle 6.x.

  | | Mesečno | Godišnje | Krediti mesečno |
  |---|---|---|---|
  | Starter | €29 | €290 | 150 |
  | Pro | €59 | €590 | 450 |
  | Advanced | €119 | €1.190 | 1.200 |
  | Dopuna 75 | €19 jednokratno | — | 75, ne ističu, samo uz plan |
  | Dopuna 200 | €49 jednokratno | — | 200, ne ističu, samo uz plan |

  Uz to: proba 7 dana sa 10 kredita i karticom unapred; nov nalog bez kartice dobija 2 kredita;
  skeniranje 1/2/3 kredita za 20/40/60 firmi i **plaća se i iz keša**; otključavanje 1 kredit;
  „ako nađemo manje firmi nego što si tražio, razliku vraćamo". Nigde „besplatna beta" ni
  „pretraga keša je besplatna".
  1. Otvori landing i uporedi svaki broj sa tabelom.
  2. Uporedi i FAQ i OG sliku.

  **Gotovo kad:** nijedan broj ni tvrdnja se ne razlikuju.

---

## 6. Prelazak Stripe-a na live

Radi se **u jednom sedenju**, redom. Preduslovi: 3.2 prošlo, 4.1 bez blokade, 4.3 i 4.4
gotovi, 5.1 gotov. Test mod ostaje netaknut — lokalni razvoj i dalje radi nad njim.

- [ ] **6.1 · Live katalog i kupon**
  Skripta pravi proizvode, 8 cena sa `lookup_key` i kupon `sajtoskop_prvi_mesec` iz `plans.ts`,
  idempotentno.
  1. Stripe → isključi *Test mode* → **Developers → API keys** → kopiraj *Secret key* (`sk_live_…`).
  2. U terminalu, bez upisa ključa u istoriju:
     ```bash
     read -s STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY
     pnpm stripe:seed --live --samo-provera     # prijavi šta fali
     pnpm stripe:seed --live                    # napravi
     STRIPE_COUPON_FIRST_MONTH=sajtoskop_prvi_mesec pnpm stripe:doktor
     unset STRIPE_SECRET_KEY
     ```

  **Gotovo kad:** `stripe:doktor` sa live ključem prolazi (8 cena + kupon).

- [ ] **6.2 · Live podešavanja** (isto kao u test modu, `docs/naplata-stripe.md` §2.2 i §8)
  1. **Settings → Business → Branding:** logo, ikonica, akcenat `#adee2e`.
  2. **Settings → Billing → Subscriptions and emails:** Smart Retries uključen, 4 pokušaja kroz
     7 dana, posle poslednjeg **cancel subscription**; svi mejlovi kupcima **isključeni**;
     podsetnik pred kraj probe **isključen**.
  3. **Settings → Billing → Customer portal:** istorija faktura ON; mejl ON, adresa/telefon/tax
     ID OFF; kartice ON; otkaz ON na kraju perioda, sa razlogom; pauza **OFF**; promena plana ON
     (sva tri plana, oba ciklusa), upgrade `always_invoice`, downgrade na kraju perioda;
     količine OFF; linkovi na `/uslovi`, `/privatnost`, `/povracaj`; povratak na
     `https://app.sajtoskop.com/krediti`.
  4. **Radar → Rules:** blokiraj kad je otisak kartice korišćen na više od 2 kupca u 24 h.
  5. **Settings → Personal → Communication preferences:** uključi obaveštenja za sporove i za
     neuspele webhook isporuke.
  6. **Customer emails:** uključi **Successful payments** i **Refunds** (ili ih ostavi
     isključene ako je u 2.6 isporučen naš mejl „Uplata primljena").

  **Gotovo kad:** svih pet ekrana je podešeno kao u test modu.

- [ ] **6.3 · Live webhook endpoint**
  1. **Developers → Webhooks → Add endpoint** → URL `https://app.sajtoskop.com/api/billing/webhook`.
  2. API verzija: **`2026-08-26.dahlia`** (mora da se poklapa sa `STRIPE_API_VERSION` u
     `apps/web/src/lib/stripe-server.ts`).
  3. Događaji, tačno ovih deset: `checkout.session.completed`,
     `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.paid`,
     `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`,
     `charge.dispute.closed`.
  4. Otvori endpoint → **Signing secret → Reveal** → kopiraj (`whsec_…`).

  **Gotovo kad:** endpoint postoji sa deset događaja i pravom API verzijom.

- [ ] **6.4 · Vercel Production na live ključeve**
  1. Vercel → Settings → Environment Variables → **samo Production**:
     `STRIPE_SECRET_KEY` = `sk_live_…`, `STRIPE_WEBHOOK_SECRET` = `whsec_…` iz 6.3,
     `STRIPE_COUPON_FIRST_MONTH` = `sajtoskop_prvi_mesec`.
  2. **Redeploy** produkcije.
  3. Odmah: otvori `https://app.sajtoskop.com/cenovnik` → klikni plan → Stripe Checkout mora da
     pokaže **pravu** cenu i da **ne piše** „Test mode". Ne plaćaj — vrati se nazad.

  **Gotovo kad:** checkout je u live modu sa tačnim iznosom.

- [ ] **6.5 · Prava kupovina i povraćaj na svom nalogu**
  Nalog **koji nije admin** (admin ne troši kredite i ne vidi ponudu). Troškovi: Stripe
  zadržava naknadu i na vraćenoj uplati (≈ €3 ukupno).
  1. Registruj se drugim mejlom → `/cenovnik` → Starter mesečno → pravom karticom.
  2. `/welcome` kaže „Proba je počela"; `/krediti` pokazuje probu i 10 (+2) kredita.
  3. `/krediti` → **Aktiviraj odmah** → potvrdi → kartica je naplaćena €29 → posle par sekundi
     balans je 150.
  4. `/cenovnik#paketi` → Dopuna 75 → plati €19 → dopunjeni krediti 75.
  5. Stripe Dashboard (live) → **Payments** → obe uplate → **Refund** (pun iznos).
  6. SQL (Supabase):
     ```sql
     select reason, ref_id, delta, created_at from credit_ledger
     where user_id = '<clerk_id>' order by id;
     ```
     Očekuj po jedan red `povracaj` za svaki refund, sa minusom jednakim dodeli.
  7. `/krediti` → **Upravljaj pretplatom** → otkaži → `/krediti` kaže da je otkazana i do kada traje.
  8. Stripe → **Developers → Webhooks → endpoint**: sve isporuke su `200`.
  9. Obriši ovaj nalog iz Clerka posle provere (pretplata se otkazuje sama pre brisanja profila).

  **Gotovo kad:** svi koraci daju očekivano, a u webhook isporukama nema nijednog neuspeha.

- [ ] **6.6 · Počisti test podatke iz produkcijske baze**
  Ako je lokalni razvoj do sada gađao produkcijsku bazu (v. 1.5), u njoj su probni nalozi i
  sandbox pretplate.
  1. `/admin/korisnici` → svaki nalog koji nije tvoj i nije pravi korisnik → obriši ga u
     Clerku (Production ili Development instanci, gde je nastao).
  2. SQL provera — ne sme da ostane nijedan red iz test moda:
     ```sql
     select count(*) from subscriptions;
     select user_id, status, lookup_key from subscriptions;
     ```
  3. Redovi u `billing_events` iz test moda mogu da ostanu (samo su deduplikacija).

  **Gotovo kad:** u `profiles` i `subscriptions` su samo stvarni nalozi.

- [ ] **6.7 · Brojevi na landingu posle live-a** — ponovi 5.2.

---

## 7. Otvaranje

- [ ] **7.1 · Napuni keš za čarobnjak** — 1–7 dana pre prvih pozivnica
  Čarobnjak nudi samo sveže kombinacije iz keša; prazan keš = „Još nema gotovih lista". Google
  podaci važe 30 dana, pa se ovo ne radi mesec unapred.
  1. Uloguj se kao admin → `/pretraga` → izaberi grad i nišu → dubina **Brzo** → Skeniraj.
     (Admin ne troši kredite, ali Places budžet i dnevni osigurač važe.)
  2. Ponovi za 15–20 kombinacija. Predlog: gradovi `beograd`, `novi-sad`, `nis`, `kragujevac`,
     `sabac`, `cacak`, `subotica` × niše `pvc-stolarija`, `stomatolog`, `auto-servis`,
     `frizerski-salon`, `advokat`, `restoran`, `vodoinstalater`.
  3. SQL — koliko je potrošeno i šta je u kešu:
     ```sql
     select day, calls from api_budget order by day desc limit 2;
     select city_slug, niche_slug, pages, last_results_count, last_scanned_at
     from search_cache order by last_scanned_at desc limit 25;
     ```
  4. Probni nalog → `/pocetak` → ekran 1 nudi gradove sa brojem gotovih lista.

  **Gotovo kad:** čarobnjak nudi bar 15 kombinacija.

- [ ] **7.2 · Vladin komp nalog** (ranije R45)
  1. `/admin/pozivnice` → **Pristupne pozivnice** → tip **Komp** → dana: prazno (bez roka) ili
     broj → kredita **300** → mejl: Vladin → upotreba **1** → napomena „Vlada" → Napravi.
  2. **Kopiraj link** → pošalji lično.
  3. Kad prihvati: `/admin/korisnici` → njegov nalog ima stanje **Komp**.
  4. Upiši ovde: `poslato: ____ · kod: ____`.

  **Gotovo kad:** nalog je u stanju Komp.

- [ ] **7.3 · Prvih 20 ljudi** (ranije R30)
  1. Napravi spisak (ime, mejl, odakle ga znaš, tip pozivnice) u tabeli van repoa.
  2. Za svakog odluči: **komp** (prijatelji, partneri — pun pristup bez plaćanja) ili **prvi
     mesec gratis** (ljudi koji treba da postanu kupci — kartica, pa €0 prvi mesec).
  3. `/admin/pozivnice` → po jedna pozivnica vezana za mejl, upotreba 1.
  4. Lična poruka uz link, npr.: „Napravio sam Sajtoskop — nalazi firme u tvom gradu kojima
     treba sajt i piše ti prvu poruku. Evo ti pristupa: <link>. Javi mi šta te zbuni."
  5. Kolona „poslato / prihvatio / prva poruka" u tabeli.

  **Gotovo kad:** svih 20 pozivnica je poslato.

- [ ] **7.4 · Prvih 5 lično** (ranije R31)
  1. Sa prvih pet dogovori poziv sa deljenjem ekrana (20 min).
  2. Ne objašnjavaj unapred; gledaj gde stanu. Beleži.
  3. Posle svakog: `/admin/utisci` i `/admin/korisnici` → dokle su stigli (koraci onboardinga).
  4. Očigledno popravi odmah (sesija sa Claude-om), pa tek onda ostalih 15.
  5. **Nema javne objave** dok prvih 5 ne prođe od registracije do kopirane poruke bez tvoje pomoći.

  **Gotovo kad:** pet ljudi je samo stiglo do poruke.

---

## Go / no-go — jedno sedenje, na produkciji, sa čistim nalogom

- [ ] Registracija → čarobnjak → lista → otključavanje → kopirana poruka, bez ijednog pitanja
- [ ] Onboarding nije potrošio nijedan Places poziv (`api_budget` pre i posle)
- [ ] Kupovina plana, paketa i povraćaj prošli pravom karticom (6.5); webhook isporuke sve `200`
- [ ] Otkazivanje kroz portal radi bez tebe
- [ ] Mejl pred kraj probe stiže, a kupac dobija potvrdu uplate (2.6)
- [ ] Pravne strane bez markera i banera, linkovane iz futera, registracije i sa landinga
- [ ] Pisan odgovor savetnika stigao i ništa ne blokira naplatu (4.1)
- [ ] Worker radi novi kod, red poslova se prazni, backup je jednom vraćen
- [ ] Env na Vercelu i workeru: live Stripe samo u Production, `PLACES_MONTHLY_BUDGET_EUR` isti na oba mesta
- [ ] Google kvota iznad aplikativnog dnevnog capa; Anthropic, Google i Hetzner limiti postavljeni
- [ ] Landing: brojevi = `plans.ts`, CTA nosi slug plana, `/bot` postoji
- [ ] Obe teme i 390 px prošli na svim ekranima (3.6)
- [ ] `podrska@sajtoskop.com` prima poštu

---

## Posle lansiranja — rutina

**Nedeljno**
- Tempo Places poziva naspram broja pretplata:
  ```sql
  select month, sum(calls) as poziva from api_budget group by month order by month desc limit 2;
  select plan, ciklus, status, count(*) from subscriptions
  where status in ('active','trialing','past_due') group by 1,2,3;
  ```
  Mesečni cap je `1.000 + budžet ÷ 0,032` (€100 → 4.125, €150 → 5.687). Kad tempo prelazi
  ~70 % capa, podigni `PLACES_MONTHLY_BUDGET_EUR` **na Vercelu i na workeru istovremeno**
  (Vercel redeploy, worker `up -d`) i Googleovu dnevnu kvotu na malo iznad `cap ÷ 20`.
  Odbijeno skeniranje plaćenom korisniku skuplje je od svakog Places računa.
- Stripe → Payments (pali, sporovi) · Webhooks (neuspele isporuke).
- `/admin/utisci` — NPS, „Fali", nove prijave.
- Worker: `docker compose -f apps/worker/docker-compose.yml logs --since 168h | grep PAO`,
  `df -h /`, `docker stats --no-stream`.
- Dok cron `utisci-slike` nije zakazan (2.4):
  `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://app.sajtoskop.com/api/cron/utisci-slike`

**Mesečno**
- 1. u mesecu: godišnji i komp nalozi su dobili dodelu
  (`select user_id, delta, ref_id from credit_ledger where reason = 'monthly_grant' order by id desc limit 20;`).
- Probno vraćanje backupa (1.4, koraci 8–9).
- Dependabot PR-ovi i `pnpm audit --prod`.
- Anthropic, Google Cloud i Stripe računi naspram očekivanja.

**Pre prve promene cene**
- Stripe pravi novu cenu sa istim `lookup_key`, a stara ostaje bez njega — fakture postojećih
  pretplatnika na staroj ceni bi u `invoice.paid` bile „preskočeno" i ne bi dobile kredite.
  Pre promene: sesija sa Claude-om za rezervu (npr. `price.metadata.plan`).

**Dalji razvoj** — sve posle otvaranja (mejlovi, obrada prijava, javna tabla, radar, region…)
je u `docs/roadmap.md`.
