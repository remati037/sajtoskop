# F3 — Worker, red poslova i pretraga uživo

**Cilj:** pretražiš kombinaciju koje nema u bazi, dobiješ „u obradi", i lista se sama popuni
za manje od dva minuta.

**Procena:** 4–5 dana · **Preduslov:** F2 gotov

> **Ovo je faza posle koje proizvod postoji.** Ako se nešto kasnije raspadne, verzija koja se
> pušta korisnicima je F3 + F4. Sve dalje je dodatak.

---

## 1. Model reda

Postgres tabela `job_queue`, bez Redisa. Worker nema nijedan otvoren port — sam vuče posao.

```sql
-- preuzimanje posla, atomično, bez blokiranja drugih radnika
update job_queue
set status = 'running', locked_at = now(), attempts = attempts + 1
where id = (
  select id from job_queue
  where status = 'pending' and run_after <= now()
  order by id
  for update skip locked
  limit 1
)
returning *;
```

Petlja workera: povuci → izvrši → `done` ili `failed`. Na grešku:

```
attempts < max_attempts → status 'pending', run_after = now() + interval '1 minute' * 2^attempts
attempts >= max_attempts → status 'failed', last_error popunjen
```

**Zaglavljeni poslovi:** svaki `running` stariji od 15 minuta vrati u `pending`. Cron u samom
workeru, svakih 5 minuta.

`WORKER_CONCURRENCY=3` na CX22. Više od toga nema smisla dok nema Playwrighta.

---

## 2. Tipovi poslova

| Tip | Payload | Šta radi |
|---|---|---|
| `scan` | `{ citySlug, nicheSlug, userId }` | Places Text Search → upsert `businesses` → kreira `enrich_basic` po biznisu bez svežeg audita |
| `enrich_basic` | `{ placeId }` | `fetch-site` → `uglyScore` → `harvestEmails` → upsert `website_audits` (`audit_level = 1`) |
| `refresh_google` | `{ placeId[] }` | osvežava Google polja kojima je isteklo 30 dana |
| `enrich_full` | `{ placeId }` | **postoji kao tip, ne radi ništa do F5** |

`scan` za tier-1 gradove koristi `buildQueries()` iz taksonomije i cepa po `subareas` —
logika već postoji u shared paketu, ne pisati je ponovo.

---

## 3. Budžet API poziva — prelazak iz fajla u bazu

`api-budget.ts` se prenosi na `api_budget` tabelu. **`budgetDay()` logika sa
`America/Los_Angeles` ostaje netaknuta** — to je bug koji je već jednom pojeo kvotu.

```ts
// pseudo, ali ovim redosledom
await assertAvailable(expectedPages);   // pre-flight, pre prvog fetch-a
for (const page of pages) {
  await consume(1);                      // PRE svakog HTTP zahteva, uključujući paginaciju
  const res = await fetch(...);
  if (res.status === 429) { await markExhausted(); return partial(collected); }
}
```

Inkrement u bazi mora biti atomičan:

```sql
insert into api_budget (day, month, calls) values ($1, $2, 1)
on conflict (day) do update set calls = api_budget.calls + 1
returning calls;
```

Ako `calls >= GLOBAL_DAILY_API_CAP` ili mesečni zbir `>= GLOBAL_MONTHLY_API_CAP` → posao ide u
`pending` sa `run_after` na sutra, korisnik dobija poruku *„dnevni limit skeniranja je dostignut,
pretraga će se izvršiti automatski sutra"*.

**Parcijalni rezultati se čuvaju.** Ako budžet pukne na trećoj stranici, upiši prve dve i
označi scan kao `partial`. Bacanje prikupljenih podataka je bacanje već potrošenog novca.

---

## 4. Cache-miss limit po korisniku

Provera se radi **u webu, pre upisa job-a**, ne u workeru.

```ts
// atomično, u jednoj transakciji
// resetuj brojač ako je cache_miss_day != danas (lokalni datum korisnika je nebitan, koristi LA dan)
// ako cache_miss_count >= PLANS[plan].cacheMissPerDay → odbij sa jasnom porukom
// inače inkrementiraj i upiši job
```

Beta: 10 dnevno. Pretrage iz keša ostaju **neograničene** i to se korisniku eksplicitno kaže —
to je marketinška poenta, ne samo zaštita.

---

## 5. Web strana

- [ ] `POST /api/search` proširen: `not_scanned` više ne završava tu nego kreira `scan` job i vraća `{ status: "queued", jobId }`
- [ ] `GET /api/job/:id` — status posla; `user_id` iz sesije mora da se poklopi sa onim u payloadu
- [ ] Klijent polluje na 3 sekunde, max 3 minuta, pa poruka „traje duže nego obično, rezultat će biti tu kad se vratiš"
- [ ] Stanja u UI-u: `queued` → `running` → gotovo, sa brojem obrađenih biznisa
- [ ] `stale` rezultati (stariji od 30 dana) prikazuju se odmah, uz `refresh_google` job u pozadini

---

## 6. Deployment workera

`apps/worker/Dockerfile` i `docker-compose.yml` na Hetzner CX22:

```yaml
services:
  worker:
    build: .
    restart: unless-stopped
    user: "1001:1001"
    read_only: true
    tmpfs: [/tmp:size=512M]
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    mem_limit: 1g
    pids_limit: 200
    env_file: .env
```

- [ ] Hetzner server, `ufw` sa **zatvorenim svim inbound portovima osim SSH**
- [ ] SSH samo ključem, lozinka isključena
- [ ] Google API ključ: **IP restriction na Hetzner IP** + API restriction samo na Places i PageSpeed + dnevna kvota. Ovo je najveći bezbednosni ROI u celom projektu i traje jedno polje u konzoli.
- [ ] Deploy: `git pull && docker compose up -d --build`. Bez CI-a za sada.
- [ ] Log rotacija, da disk ne pukne

---

## 7. CLI ostaje živ

- [ ] `apps/cli` prebaci na isti `api_budget` u bazi, da CLI i worker dele brojač
- [ ] Bez toga ćeš potrošiti kvotu iz terminala i ne razumeti zašto app ne radi

---

## 8. Gotovo kad

- Pretraga kombinacije koje nema u bazi vraća rezultat za manje od 2 minuta
- `api_budget.calls` raste tačno za broj stvarnih HTTP zahteva, uključujući svaku stranicu paginacije
- 11. cache-miss pretraga u istom danu na beta planu se odbija sa razumljivom porukom
- Ubijanje workera usred posla → posao se posle 15 minuta sam vrati u `pending` i izvrši
- Google konzola pokazuje pozive **samo** sa Hetzner IP-a
- `nmap` na Hetzner IP pokazuje otvoren samo SSH

---

## 9. Ne radi u ovoj fazi

- Bez Playwrighta i screenshotova
- Bez PageSpeed i Claude poziva (`enrich_full` je prazan)
- Bez Redisa i BullMQ-a
- Bez javnog HTTP endpointa na workeru — ako ti zatreba, prvo mi javi zašto

---

## 10. Prompt za sesiju

```
Radimo docs/F3-worker.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Kreni od api-budget prelaska na Postgres, pre svega ostalog — to je modul u
kome je već jednom bio bug sa vremenskom zonom i hoću da ga vidim prvog.
Pokaži mi budgetDay() implementaciju i mesto gde se consume() poziva u
places.ts pre nego što napišeš petlju workera.

Posle toga: job_queue petlja, pa tipovi poslova, pa web integracija.
Docker i Hetzner na kraju.
```
