# 09 · Lokalna baza (Supabase CLI)

> Ceo Supabase stack (Postgres, PostgREST, Auth, Storage) na laptopu, iste migracije kao produkcija, web i worker gađaju njega. Produkcija se samo **čita**, i to jednom, za seed (§6).
> Stanje: prošlo na macOS + Colima, migracije 0001–0035, seed 513 biznisa / 513 audita / 25 keš kombinacija.
> Mesto u repou: `docs/LOKALNA-BAZA.md`.

**Sve komande iz korena app repoa `sajtoskop`** (tamo gde su `pnpm-workspace.yaml`, `apps/`, `supabase/migrations/`), osim onih označenih kao globalne. Landing repo `sajtoskop-website` se ne dira.

---

## 0. Pregled

| Deo | Gde radi | Port / adresa |
|---|---|---|
| Docker runtime | Colima (globalno) | — |
| Supabase API (PostgREST, Storage, Auth) | kontejneri | `http://127.0.0.1:54321` |
| Postgres | `supabase_db_sajtoskop` | `127.0.0.1:54322` |
| Studio | kontejner (opciono) | `http://127.0.0.1:54323` |
| Web | terminal 1 | `http://localhost:3000` |
| Clerk webhook tunel | terminal 2 | `https://…trycloudflare.com` |
| Worker | terminal 3 | bez porta |
| Stripe webhook | terminal 4 | — |

---

## 1. Docker preko Colime (jednom, globalno)

Colima umesto Docker Desktopa: besplatna i za firmu, bez GUI-ja, memorija se zadaje.

```bash
brew install colima docker docker-compose

# Apple Silicon, macOS 13+
colima start --cpu 2 --memory 3 --disk 30 --vm-type vz --mount-type virtiofs
# Intel Mac
colima start --cpu 2 --memory 3 --disk 30
```

U `~/.zshrc`:

```bash
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
```

```bash
source ~/.zshrc
docker run --rm hello-world     # „Hello from Docker!"
```

**Greška `docker-credential-desktop: executable file not found`** — ostatak stare Docker Desktop instalacije:

```bash
sed -i '' '/"credsStore"/d' ~/.docker/config.json
python3 -m json.tool ~/.docker/config.json    # mora da prođe; ako ne, obriši zarez viška
```

Ako storage kontejner ne prođe proveru zdravlja pri `db reset` ili `start`, fali memorije: `colima stop && colima start --memory 4` (isti ostali flagovi).

---

## 2. Supabase CLI u repou

```bash
pnpm add -D -w supabase
pnpm supabase --version
```

Opcione skripte u root `package.json` → `scripts`:

```json
"db:start":  "supabase start",
"db:stop":   "supabase stop",
"db:reset":  "supabase db reset",
"db:status": "supabase status"
```

U ovom uputstvu stoji `pnpm supabase …`, radi i bez njih.

**Nikad** `supabase link` ni `supabase db push` u ovom repou.

---

## 3. `supabase/config.toml`

Ako ne postoji: `pnpm supabase init` (N na VS Code / Deno pitanja). Ne dira `supabase/migrations/`.

Izmene u odnosu na podrazumevani fajl:

```toml
project_id = "sajtoskop"

[db]
major_version = 17          # isto kao produkcija: select version(); u Supabase SQL editoru

[db.seed]
enabled = true
sql_paths = ["./seed.sql", "./seed-lokalni.sql"]

[auth]
enabled = true              # mora, zbog Clerk JWT-a

[auth.third_party.clerk]
enabled = true
domain = "real-boxer-65.clerk.accounts.dev"   # Frontend API domen Clerk DEV instance

[realtime]
enabled = false

[local_smtp]                # mail server (u starijim CLI verzijama se zvao [inbucket])
enabled = false

[analytics]
enabled = false

[edge_runtime]
enabled = false

[storage.buckets.feedback]  # ne pravi ga nijedna migracija, na produkciji je ručno napravljen
public = false
```

`screenshots` bucket pravi `0001_init.sql`, zato ga ovde nema.

**Clerk dev instanca → Integrations → Supabase → Activate.** Bez toga token nema `role: authenticated` i RLS vraća prazno, bez greške.

---

## 4. Prvo pokretanje

```bash
touch supabase/seed.sql supabase/seed-lokalni.sql
echo "supabase/seed-lokalni.sql" >> .gitignore
pnpm supabase start
```

Prvi put vuče image-e (1–2 GB). Ispis `Skipping migration .gitkeep` je bezopasan.

Alias za psql (jednom, globalno):

```bash
echo "alias sdb='docker exec -it supabase_db_sajtoskop psql -U postgres'" >> ~/.zshrc
source ~/.zshrc
sdb -c "select 1;"
```

Posle ovoga svaki upit je `sdb -c "…"`, a `sdb` sam otvara interaktivni psql.

---

## 5. `.env` (jedan fajl u korenu)

Web i worker čitaju **isti** `.env` iz korena. Redosled prednosti za web: Vercel env > `apps/web/.env.local` > koren `.env`. `apps/web/.env.local` ne sme da postoji, inače ne znaš koja vrednost važi.

Sačuvaj produkcionu verziju:

```bash
cp .env .env.prod
git check-ignore .env.prod        # mora da ispiše .env.prod
```

Lokalni ključevi:

```bash
pnpm supabase status -o env
```

| Varijabla | Lokalna vrednost |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` iz status-a |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` iz status-a |
| `SUPABASE_DB_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_…` (dev instanca) |
| `CLERK_SECRET_KEY` | `sk_test_…` (dev instanca) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | iz Clerk endpointa (§7) |
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | iz `stripe listen` (§7) |
| `STRIPE_COUPON_FIRST_MONTH` | ID kupona iz Stripe **test** moda |
| `PLACES_MONTHLY_BUDGET_EUR` | `2` |
| `ADMIN_BOOTSTRAP_IDS` | tvoj lokalni Clerk dev `user_…` ID (§8, T8) |

Google Maps, PageSpeed, Anthropic, Resend i `WORKER_*` ostaju kako jesu. Ti API-ji su pravi i lokalno: svako otključavanje košta ~2 centa, a Places kvota je deljena sa produkcijom (lokalni brojač budžeta je odvojen, produkcija ga ne vidi).

Provera posle svake izmene:

```bash
grep -n "supabase.co\|sk_live_\|pk_live_" .env      # 0 redova
```

Kad ti iz terminala zatreba produkcija (backup, upit), URL prosleđuješ eksplicitno, `.env.prod` ne vraćaš.

---

## 6. Seed

### 6.1 `supabase/seed.sql` (u gitu)

Prazan. Admin dolazi iz `ADMIN_BOOTSTRAP_IDS`, taksonomija iz `packages/shared`.

### 6.2 `supabase/seed-lokalni.sql` (van gita)

Javni podaci sa produkcije: `businesses`, `website_audits`, `search_cache` (keš po grad/niša, bez korisničkih podataka). Nikad `profiles`, `credit_ledger`, `unlocks`, `searches`, `search_access`, `outreach_messages`, `feedback`.

```bash
DB_CONTAINER=supabase_db_sajtoskop
PROD_DB=$(grep '^SUPABASE_DB_URL=' .env.prod | cut -d= -f2- | tr -d "\"'")
PROD_DB=${PROD_DB/:6543/:5432}                        # pg_dump traži session pooler
echo "$PROD_DB" | sed 's/:[^:@]*@/:***@/'            # mora: pooler.supabase.com:5432

docker exec "$DB_CONTAINER" pg_dump "$PROD_DB" \
  --data-only --no-owner \
  --column-inserts --rows-per-insert=200 \
  -t public.businesses -t public.website_audits -t public.search_cache \
  | grep -v '^\\' \
  > supabase/seed-lokalni.sql

grep -c '^\\' supabase/seed-lokalni.sql              # 0
ls -lh supabase/seed-lokalni.sql
pnpm supabase db reset
```

Zašto ovako:
- `pg_dump` iz lokalnog kontejnera = ista major verzija kao baza.
- `--column-inserts` + `grep -v '^\\'`: podrazumevani `COPY … FROM stdin` i `\restrict` linije su psql komande i Supabase seed puca na njima (`syntax error at or near "\"`).
- Placeholderi tipa `<ime>` u zsh-u znače preusmeravanje iz fajla, zato su ovde promenljive.

Provera:

```bash
sdb -c "select 'businesses', count(*) from businesses union all select 'website_audits', count(*) from website_audits union all select 'search_cache', count(*) from search_cache;"
```

Keš važi 30 dana od `last_scanned_at`. Za testiranje biraj sveže kombinacije, inače pretraga zove pravi Places:

```bash
sdb -c "select city_slug, niche_slug, last_results_count, last_scanned_at from search_cache where last_scanned_at > now() - interval '30 days' order by last_results_count desc limit 10;"
```

Seed osvežavaš ponavljanjem ovog bloka.

---

## 7. Alati za webhookove (jednom, globalno)

```bash
brew install cloudflared stripe/stripe-cli/stripe
```

**Clerk** — tunel do lokalnog weba:

```bash
cloudflared tunnel --url http://localhost:3000
```

Clerk dev → Webhooks → Add endpoint: `https://<ispis>.trycloudflare.com/api/webhooks/clerk`, eventi `user.created`, `user.updated`, `user.deleted`. Signing secret → `CLERK_WEBHOOK_SIGNING_SECRET`.
Quick tunel menja URL pri svakom pokretanju: Clerk → endpoint → Edit → novi URL. Secret ostaje isti.

**Stripe** — browser `stripe login` ne dozvoljava Authorise na ovom nalogu, zato ključ direktno:

```bash
stripe listen --api-key "$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2- | tr -d "\"'")" \
  --forward-to localhost:3000/api/billing/webhook
```

Ispisani `whsec_…` → `STRIPE_WEBHOOK_SECRET`, restart weba. Obično je isti pri svakom pokretanju.

---

## 8. Test lista

Pre svega: stari terminali zatvoreni (stari `dev` drži port 3000), baza radi (`pnpm supabase status`).

**Terminal 1:** `pnpm --filter @sajtoskop/web dev`
**Terminal 2:** `cloudflared tunnel --url http://localhost:3000`
**Terminal 3:** worker (T11)
**Terminal 4:** `stripe listen …` (T12)

Svaka izmena `.env` → restart terminala 1 (i 3 ako se tiče workera).

| # | Šta | Komanda / korak | Očekivano |
|---|---|---|---|
| T1 | Stack | `pnpm supabase status` | svi servisi rade osim isključenih |
| T2 | Migracije | `sdb -c "select count(*), max(version) from supabase_migrations.schema_migrations;"` | `35 \| 0035` (ili novija) |
| T3 | RPC-ovi | `sdb -c "select proname from pg_proc where proname in ('apply_subscription','redeem_invite','claim_cache_miss','spend_credit_and_scan','refund_scan');"` | 5 redova |
| T4 | Idempotentnost | `pnpm check:sql` | prolazi |
| T5 | Seed | upit iz §6.2 | isti brojevi kao produkcija na dan dumpa |
| T6 | RLS | blok ispod tabele | `user_test_1`, pa `0`, `0` |
| T7 | Web gađa lokal | `docker logs -f $(docker ps --format '{{.Names}}' \| grep supabase_kong)` pa klikći po aplikaciji | linije `GET /rest/v1/…`, `POST /rest/v1/rpc/…` |
| T8 | Registracija | nov nalog na `localhost:3000` | `profiles`: `dopuna`, topup `2`; ledger `onboarding +2`; cloudflared `POST /api/webhooks/clerk 200` |
| T9 | Pretraga iz keša | `beograd / advokat` | `search_access` red sa praznim `job_id`; ledger `scan -2`; nema `scan` joba u `job_queue` |
| T10 | Admin krediti | `/admin` → korekcija +5 | `credits_topup` +5, `credits_balance` netaknut; `admin_audit` payload `"kasa": "topup"`, `ok = t`; traka „nemaš kredita" nestaje |
| T11 | Otključavanje | worker upaljen (ispod), otključaj 1 karticu sa sajtom | `enrich_full` → `done`; 2 fajla u `screenshots`; kredit manje |
| T12 | Stripe | `/cenovnik` → Pro → `4242 4242 4242 4242` | eventi `[200]`; `subscriptions` `trialing \| pro`; `stripe_customer_id` popunjen; topup netaknut |
| T13 | Upornost | §9 gašenje pa paljenje | nalog i pretplata i dalje postoje |
| T14 | Reset | `pnpm supabase db reset` | `profiles` prazan, seed ponovo pun |

**T6 — RLS sa Clerk identitetom, bez aplikacije:**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_test_1","role":"authenticated"}', true);
select auth.jwt() ->> 'sub';      -- user_test_1
select count(*) from unlocks;     -- 0
select count(*) from profiles;    -- 0
rollback;
```

Ako vrati tuđe redove: `select tablename, rowsecurity from pg_tables where schemaname = 'public';` — sve mora biti `true`. Isti propust bi postojao i na produkciji.

**Upiti za T8–T12:**

```bash
sdb -c "select id, plan, credits_balance, credits_topup, stripe_customer_id from profiles;"
sdb -c "select id, reason, delta, ref_id from credit_ledger order by id desc limit 5;"
sdb -c "select * from search_access;"
sdb -c "select action, payload, ok from admin_audit order by id desc limit 3;"
sdb -c "select id, type, status, attempts, last_error from job_queue order by id desc limit 5;"
sdb -c "select bucket_id, name, created_at from storage.objects order by created_at desc limit 5;"
sdb -c "select status, plan, ciklus, trial_end from subscriptions;"
```

Kad nisi siguran u imena kolona: `sdb -c "select * from <tabela> limit 3;"`. Upite puštaj jedan po jedan, greška u nizu se lako izgubi.

**T8 — admin nalog:** ID iz `profiles` upiši u `.env` kao `ADMIN_BOOTSTRAP_IDS`, restartuj web, `/admin` mora da se otvori.

**T11 — worker (terminal 3):**

```bash
pnpm --filter @sajtoskop/worker exec playwright install chromium    # jednom
pnpm --filter @sajtoskop/worker dev    # tačno ime: grep -A10 '"scripts"' apps/worker/package.json
```

Mora da se podigne bez `Nedostaje env promenljiva …`. Na `failed`: `last_error` iz `job_queue` + ispis terminala 3.

---

## 9. Svakodnevni rad

**Početak:**

```bash
colima start
pnpm supabase start
```

Pa terminali 1–4 po potrebi (§8). Posle paljenja cloudflared-a ažuriraj URL u Clerku.

**Nova migracija:**

```bash
ls supabase/migrations | tail -1          # sledeći broj
# napiši supabase/migrations/00NN_ime.sql
pnpm supabase db reset                    # sve od nule + seed
pnpm check:sql                            # dvaput, idempotentnost
```

Posle `db reset` profil nestaje. Prijavi se ponovo: aplikacija ga pravi sama (isti Clerk ID, `ADMIN_BOOTSTRAP_IDS` ostaje). Ako ne napravi, Clerk dev → Users → Delete → registracija ispočetka → novi ID u `.env`.

**Kraj:**

```bash
# Ctrl+C u terminalima 1–4
pnpm supabase stop        # podaci ostaju
colima stop               # oslobađa RAM
```

`supabase stop --no-backup` **briše** podatke. Za čist start koristi `db reset`.

---

## 10. Kad nešto ne radi

| Simptom | Uzrok | Rešenje |
|---|---|---|
| `zsh: command not found: docker` | Docker nije instaliran | §1 |
| `docker-credential-desktop … not found` | ostatak Docker Desktopa | §1, `credsStore` |
| `zsh: no matches found: --include=*.ts` / `apps/web/.env*` | zsh razvija glob | navodnici: `--include='*.ts'`; za fajlove `find` |
| `zsh: no such file or directory: ime-…` | nalepljen placeholder `<…>` | zameni stvarnom vrednošću ili promenljivom |
| `Command "db:start" not found` | skripte nisu u `package.json` | §2, ili `pnpm supabase start` |
| `zsh: command not found: sdb` | alias nije učitan | §4, `source ~/.zshrc` |
| Seed: `syntax error at or near "\"` | COPY format / `\restrict` | §6.2, `--column-inserts` + `grep -v` |
| Seed fajl 0 B | pogrešna komanda dumpa | §6.2 sa promenljivama |
| Storage kontejner nije zdrav | malo memorije | `colima start --memory 4` |
| Upit u `sdb` ne ispiše ništa | greška u imenu kolone, progutana u nizu komandi | pusti upit sam, ili `select *` |
| RLS vraća prazno, bez greške | Clerk token bez `role` | §3, Clerk → Integrations → Supabase |
| Clerk webhook ne stiže | cloudflared promenio URL | §7 |
| Stripe Authorise sivo | browser login | §7, `--api-key` |
| Snimak na kartici „pukao", u bazi sve postoji | CSP bez Supabase origina | rešeno (§11.1): origin se izvodi iz `NEXT_PUBLIC_SUPABASE_URL`; restartuj web posle izmene `.env` |
| Traka „Dobio si 2 kredita" i kad imaš više | zakucan tekst | otvoreno, §11.1 |
| `Could not establish connection. Receiving end does not exist` | Chrome ekstenzija | ignoriši |

Logovi: `docker logs supabase_db_sajtoskop` (isto za `supabase_rest_`, `supabase_auth_`, `supabase_storage_`, `supabase_kong_` + `sajtoskop`).

---

## 11. Otvoreno posle lokalnog testa

### 11.1 Dve sitne popravke (jedan Claude Code prompt)

1. **CSP iz env-a** (rešeno) — `apps/web/next.config.ts` zakucava `https://*.supabase.co` u `img-src` (i verovatno `connect-src`). Origin treba izvesti iz `NEXT_PUBLIC_SUPABASE_URL`, istim obrascem kao Clerk domen iz publishable ključa. Bez tihog fallback-a, build pada ako env fali.
2. **Traka za plan „dopuna"** — tekst zavisi od stanja: samo onboarding → postojeći tekst; kupljen paket → „Imaš N kredita iz paketa" bez „probaj"; admin/feedback → „Nemaš plan. Imaš N kredita. …". N = `credits_topup + greatest(credits_balance, 0)`.

### 11.2 Poznat rizik (upisati u `docs/lansiranje-checklista.md`)

```
- Pokloni (admin, feedback) od 0035 idu u credits_topup, a topup > 0 pretiče
  grace (pristup.ts, grana 3). Istekao pretplatnik sa 1 poklonjenim kreditom
  zadržava pun dopuna pristup dok ga ne potroši. Prati: broj profila sa
  plan = dopuna, plan_expires_at u prošlosti i credits_topup > 0 bez kupljenog
  paketa. Popravka posle lansiranja: odvojena kasa za poklone ili grana 3 gleda
  samo kupljenu dopunu.
```

---

## 12. Migracija 0035 na produkciju

Pre 0035 su admin dodele i nagrade za utiske išle u `credits_balance`. Korisnik bez pretplate ih vidi, a ne može da ih potroši.

Redosled je bitan: **upit pre migracije**. Upit ne razlikuje stare od novih dodela, pa bi posle migracije prikazao i ispravne.

**1. Produkcioni SQL editor, pre migracije** (upit je i u `lansiranje-checklista.md`, stavka 0.2):

```sql
select p.id, p.email, p.plan, p.credits_balance, p.credits_topup,
       cl.reason, count(*) as dodela, sum(cl.delta) as ukupno_dodeljeno,
       min(cl.created_at) as prva, max(cl.created_at) as poslednja
from credit_ledger cl
join profiles p on p.id = cl.user_id
where cl.reason in ('admin', 'feedback')
  and cl.delta > 0
  and not exists (
    select 1 from subscriptions s
    where s.user_id = p.id and s.status in ('active', 'trialing', 'past_due')
  )
group by p.id, p.email, p.plan, p.credits_balance, p.credits_topup, cl.reason
order by p.plan, poslednja desc;
```

Sačuvaj rezultat.

**2. Pusti `0035_admin_krediti_topup.sql`** na produkciji istim putem kao prethodne (koraci u stavci 0.2). Provera:

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 1;
-- ili, ako se migracije puštaju ručno:
select proname from pg_proc where proname in ('admin_adjust_credits', 'grant_credits');
```

**3. Ako je rezultat iz koraka 1 prazan — gotovo.**

**4. Ako nije**, zaglavljene kredite prebaci u dopunu, za svaki `id` iz rezultata:

```sql
update profiles
set credits_topup   = credits_topup + credits_balance,
    credits_balance = 0
where id = '<user_id>'
  and credits_balance > 0
  and not exists (
    select 1 from subscriptions s
    where s.user_id = profiles.id and s.status in ('active','trialing','past_due')
  );
```

Pa `select id, credits_balance, credits_topup from profiles where id = '<user_id>';` — balans `0`, dopuna uvećana.

Pretplatnici nisu u upitu: njima su stare dodele već nestale pri sledećem `invoice.paid`. Nadoknada je ručna odluka po korisniku (admin +N, sada ide u dopunu).
