# F1 — Baza, auth i seed

**Cilj:** ulogovan korisnik vidi prazan dashboard, a baza već sadrži ~200 biznisa iz postojećih
scanova sa njihovim Ugly Score-ovima.

**Procena:** 3–4 dana · **Preduslov:** F0 gotov

---

## 1. Supabase i Clerk

- [ ] Supabase projekat, region **Frankfurt (eu-central-1)** — najbliži i ZZPL-prijateljski
- [ ] Clerk aplikacija, srpska lokalizacija, prijava mejlom + Google
- [ ] **Clerk kao third-party auth provider u Supabase-u** (Supabase Dashboard → Authentication → Third-party Auth). Time `auth.jwt() ->> 'sub'` u RLS politikama vraća Clerk user ID.
- [ ] Storage bucket `screenshots` — **privatan**, kreiraj sada iako se puni tek u F5
- [ ] Migracije isključivo kao numerisani fajlovi u `supabase/migrations/`

> Ako Clerk↔Supabase integracija napravi problem, **reci mi pre nego što je zaobiđeš**.
> Zaobilaznica u kojoj web koristi service_role za sve korisničke upite uklanja RLS kao
> zaštitni sloj i to je odluka koju donosim ja, ne ti.

---

## 2. Šema

```sql
-- ── korisnici ─────────────────────────────────────────────
create table profiles (
  id                text primary key,              -- Clerk user id
  email             text,
  plan              text not null default 'beta',
  credits_balance   integer not null default 0,
  cache_miss_day    date,
  cache_miss_count  integer not null default 0,
  created_at        timestamptz not null default now()
);

-- ── Google podaci, TTL 30 dana ────────────────────────────
create table businesses (
  place_id            text primary key,
  country_code        text not null default 'RS',
  city_slug           text not null,
  niche_slug          text,
  query_text          text,
  name                text not null,
  address             text,
  phone               text,
  phone_type          text,                        -- mobilni | fiksni | besplatni | nepoznat
  website_url         text,
  rating              numeric(2,1),
  user_ratings_total  integer,
  google_refreshed_at timestamptz not null default now(),
  first_seen_at       timestamptz not null default now()
);

create index on businesses (country_code, city_slug, niche_slug);
create index on businesses (google_refreshed_at);

-- ── moja intelektualna svojina, bez TTL-a ─────────────────
create table website_audits (
  id                 uuid primary key default gen_random_uuid(),
  place_id           text not null references businesses(place_id) on delete cascade,
  audit_level        smallint not null default 1,  -- 1 = HTML, 2 = +PSI, 3 = +AI
  site_status        text not null,                -- ok | nema_sajt | samo_drustvene | mrtav
  http_status        integer,
  final_url          text,
  ugly_score         integer,
  ugly_band          text,
  platform           text,
  signals            jsonb not null default '[]'::jsonb,
  emails             text[] ,
  screenshot_desktop text,
  screenshot_mobile  text,
  psi_mobile_score   integer,
  ai_issues          jsonb,
  ai_verdict         text,
  enriched_at        timestamptz not null default now()
);

create unique index on website_audits (place_id);
create index on website_audits (ugly_score desc nulls last);
create index on website_audits (site_status);

-- ── otključavanja i krediti ───────────────────────────────
create table unlocks (
  user_id    text not null references profiles(id) on delete cascade,
  place_id   text not null references businesses(place_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table credit_ledger (
  id         bigserial primary key,
  user_id    text not null references profiles(id) on delete cascade,
  delta      integer not null,
  reason     text not null,        -- unlock | monthly_grant | admin | refund
  ref_id     text,
  created_at timestamptz not null default now()
);

create index on credit_ledger (user_id, created_at desc);

-- ── pretrage ──────────────────────────────────────────────
create table searches (
  id            bigserial primary key,
  user_id       text references profiles(id) on delete set null,
  country_code  text not null default 'RS',
  city_slug     text not null,
  niche_slug    text,
  query_text    text,
  source        text not null,     -- cache | api
  results_count integer,
  api_calls     integer not null default 0,
  created_at    timestamptz not null default now()
);

-- ── red poslova ───────────────────────────────────────────
create table job_queue (
  id           bigserial primary key,
  type         text not null,      -- scan | enrich_basic | enrich_full | refresh_google
  payload      jsonb not null,
  status       text not null default 'pending',  -- pending | running | done | failed
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index on job_queue (status, run_after) where status = 'pending';

-- ── budžet API poziva ─────────────────────────────────────
create table api_budget (
  day          date primary key,   -- po America/Los_Angeles
  month        text not null,      -- YYYY-MM, isto po LA
  calls        integer not null default 0,
  exhausted_at timestamptz
);
```

---

## 3. RLS

```sql
alter table profiles       enable row level security;
alter table unlocks        enable row level security;
alter table credit_ledger  enable row level security;
alter table searches       enable row level security;
alter table businesses     enable row level security;
alter table website_audits enable row level security;
alter table job_queue      enable row level security;
alter table api_budget     enable row level security;

create policy "own profile" on profiles
  for select using (id = auth.jwt() ->> 'sub');

create policy "own unlocks" on unlocks
  for select using (user_id = auth.jwt() ->> 'sub');

create policy "own ledger" on credit_ledger
  for select using (user_id = auth.jwt() ->> 'sub');

create policy "own searches" on searches
  for select using (user_id = auth.jwt() ->> 'sub');

-- deljeni podaci: nikakav direktan pristup, sve kroz API rute
create policy "no direct read" on businesses     for select using (false);
create policy "no direct read" on website_audits for select using (false);
create policy "no direct read" on job_queue      for select using (false);
create policy "no direct read" on api_budget     for select using (false);
```

Pisanje u sve tabele ide isključivo kroz `service_role`. Nema `insert`/`update` politika za
korisnike — ni jedne.

---

## 4. Kreditna funkcija

Piši je sada, iako je beta besplatna. Ovo je P0-1 iz `docs/bezbednost.md`.

```sql
create or replace function spend_credit_and_unlock(p_user text, p_place text)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  select credits_balance into v_balance
  from profiles where id = p_user for update;

  if v_balance is null then
    return query select false, 'no_user'; return;
  end if;

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

Plus `grant_credits(p_user text, p_amount integer, p_reason text)` po istom principu:
ledger insert + balance update u jednoj transakciji. **Nikad direktan `UPDATE credits_balance`
bilo gde u aplikaciji.**

---

## 5. Konfiguracija planova

`packages/shared/src/plans.ts`:

```ts
export const PLANS = {
  beta: { monthlyCredits: 30, cacheMissPerDay: 10, exportPerDay: 100 },
} as const;

export const GLOBAL_DAILY_API_CAP = 25;   // ispod Google dnevne kvote
export const GLOBAL_MONTHLY_API_CAP = 900; // ispod 1000 free tier
```

Ostali planovi se dodaju tek kad postoji naplata. Jedan plan sada je namerno.

---

## 6. Auth tok

- [ ] Clerk middleware štiti sve rute osim marketinga i webhooka
- [ ] Clerk webhook `user.created` → upiši red u `profiles` + `grant_credits(id, 30, 'monthly_grant')`
- [ ] Webhook verifikacija potpisa obavezna; bez nje endpoint je javni upis u bazu
- [ ] `getCurrentUserId()` helper koji čita **isključivo** iz Clerk serverske sesije

---

## 7. Seed postojećih scanova

Ovo je razlog zbog kog app na prvi dan ne izgleda prazno.

- [ ] `apps/cli/src/seed.ts` — čita `data/scanovi-arhiva/*.csv` i `*.json`, mapira na `businesses` + `website_audits`, upisuje kroz service_role
- [ ] Dedup po `place_id`; ako nema `place_id` u starom CSV-u, preskoči red i prijavi koliko ih je preskočeno
- [ ] `phone_type` izračunaj kroz postojeći `phoneType()` iz shared paketa
- [ ] `google_refreshed_at` postavi na **stvarni datum scana** iz imena fajla, ne na `now()`

> **Kritično:** scanovi su iz 3–4. avgusta. Google TTL je 30 dana, dakle ističu početkom
> septembra. Seed skripta mora da postavi tačan datum, inače aplikacija servira podatke koje
> po ToS-u ne sme. Refresh job dolazi u F3.

- [ ] Posle seeda ispiši sumarni izveštaj: koliko biznisa, po gradovima i nišama, koliko sa
      `site_status != 'ok'`. Te brojke idu na landing u F8.

---

## 8. Bezbednost — provera pre kraja faze

- [ ] `SUPABASE_SERVICE_ROLE_KEY` nema `NEXT_PUBLIC_` prefiks i ne postoji ni u jednom `"use client"` fajlu
- [ ] CI korak: `pnpm --filter web build && grep -r "service_role\|eyJhbGciOi" apps/web/.next/static/ && exit 1 || true`
- [ ] `.env` u `.gitignore`, gitleaks hook aktivan

---

## 9. Gotovo kad

- Registracija novog korisnika kroz Clerk kreira `profiles` red sa 30 kredita
- `select count(*) from businesses` vraća broj iz seed izveštaja
- `select count(*) from website_audits where site_status <> 'ok'` vraća smislen broj
- Pokušaj direktnog čitanja `businesses` sa anon ključem vraća prazan rezultat
- 20 paralelnih poziva `spend_credit_and_unlock` sa 1 kreditom → tačno jedan `unlocked`

Poslednju stavku testiraj stvarno, skriptom, ne pretpostavkom.

---

## 10. Ne radi u ovoj fazi

- Ne piši UI za pretragu — to je F2
- Ne piši worker logiku — to je F3
- Ne dodaj tabele za kanban, poruke ni naplatu
- Ne implementiraj `enrich_full` job tip

---

## 11. Prompt za sesiju

```
Radimo docs/F1-baza-auth.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Prvo mi napravi migracioni fajl supabase/migrations/0001_init.sql sa celom
šemom, RLS politikama i funkcijama iz PRD-a, ali PRE nego što ga napišeš
reci mi:
1. da li ima nešto u šemi što ti deluje kao greška ili nedostaje
2. kako predlažeš da rešimo Clerk -> Supabase JWT, sa konkretnim koracima

Seed skriptu pišemo tek kad migracija prođe.
```
