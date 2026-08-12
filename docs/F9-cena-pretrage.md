# F9 — Cena pretrage: keš je besplatan, skeniranje košta kredit

**Cilj:** korisnik na strani Pretraga uvek unapred zna da li ono što traži košta i koliko.
Kombinacija koja je već u kešu je besplatna svima; kombinacija koje nema, ili koja je starija
od 30 dana, košta **1 kredit** i tek onda ulazi u keš — pa je od tog trenutka besplatna i
sledećem korisniku.

**Procena:** 2 dana · **Preduslov:** F2, F3 i F4 gotovi

Ova faza **menja ekonomiju** postavljenu u F2 §4 i F3 §4. Gde se razilaze, važi F9.

---

## 0. Šta se menja u odnosu na F2/F3/F4

| | Do sada | Od F9 |
|---|---|---|
| Pretraga iz keša | besplatna, neograničena | **isto** |
| Promašaj keša | besplatan, troši dnevnu rezervaciju (10/dan) | **1 kredit** + i dalje troši dnevnu rezervaciju |
| Keš stariji od 30 dana | prikaže se odmah, osveži se besplatno u pozadini | **ne prikazuje se**, osvežavanje košta 1 kredit |
| `enqueueRefresh` (auto-osvežavanje) | poziva se na svaku zastarelu pretragu | **ukinut** — svaki Places poziv od sada ima platioca |
| Krediti | samo unlock | unlock **i** skeniranje, iz istog novčanika od 30 mesečno |

Odluke koje su donete uz ovaj dokument i ne preispituju se u implementaciji:

1. **Isti novčanik.** 1 kredit = 1 skeniranje ILI 1 otključan prospekt. Mesečna dodela ostaje 30.
2. **Dnevni limit ostaje 10/dan.** Kredit je cena, dnevni limit je i dalje kočnica za Places
   budžet. Bez njega jedan korisnik za jedno popodne pojede tuđ mesec (900 poziva mesečno,
   scan je do 3 poziva).
3. **Plaćaju obojica.** Dva različita korisnika koja u istoj minuti traže istu nekeširanu
   kombinaciju plaćaju svaki po 1 kredit, iako dele jedan posao.
4. **Isti korisnik plaća jednom.** Drugi klik na isto dugme dok posao još radi ne skida kredit.
5. **Povraćaj** kad posao konačno padne ili kad Google ne vrati nijednu firmu.
6. **Prazan rezultat se pamti 30 dana**, uz izlaz „skeniraj ipak ponovo za 1 kredit".
7. **Ručno osvežavanje sveže kombinacije je dozvoljeno** za 1 kredit.
8. **U UI-ju i u knjizi kredita to se zove „skeniranje"**, ne „pretraga" — plaća se poziv
   Googleu, ne čin pretraživanja. Prvo skeniranje i osvežavanje imaju različit tekst.

---

## 1. Model podataka — registar keša

Do sada je „da li je nešto u kešu" bilo izvedeno iz `businesses`: ima redova → keširano je.
To ne može da nosi naplatu, iz dva razloga: kombinacija skenirana bez ijednog rezultata
izgleda isto kao neskenirana (pa bi se naplaćivala u nedogled), a svežina se čitala kao
`max(google_refreshed_at)` nad redovima koje je možda upisao neki drugi scan.

Zato registar postaje eksplicitan.

```sql
create table search_cache (
  country_code       text not null default 'RS',
  city_slug          text not null,
  niche_slug         text not null,
  last_scanned_at    timestamptz not null default now(),
  last_results_count integer not null default 0,
  scan_count         integer not null default 0,   -- koliko puta je skenirana
  last_job_id        bigint,
  primary key (country_code, city_slug, niche_slug)
);
```

- **Jedan izvor istine za svežinu.** `last_scanned_at` je ono po čemu se računa TTL od 30 dana
  (`GOOGLE_TTL_DAYS`), i za naplatu i za prikaz. `businesses.google_refreshed_at` ostaje ono
  što jeste — svežina pojedinačnog reda za pravilo 1.
- RLS `using (false)`, kao `businesses`. Čita se isključivo kroz `service_role`, iz API rute.
- Upisuje ga **worker** na kraju `scan` i `refresh_google` posla (i kad je rezultat prazan),
  i **CLI seed** kad puni bazu iz arhive — inače lokalno seedovana kombinacija izgleda
  neskenirano i traži kredit u razvoju.
- Migracija radi **backfill** iz `businesses`: `group by (country_code, city_slug, niche_slug)`,
  `last_scanned_at = max(google_refreshed_at)`. Sve što je danas u bazi ostaje besplatno.

Brojači za listu (`ukupno`, `bez sajta`) se ne denormalizuju u ovu tabelu — audit stiže minutima
posle scana, pa bi upisan broj bio pogrešan. Računaju se pogledom:

```sql
create view search_cache_stats with (security_invoker = on) as
  select b.country_code, b.city_slug, b.niche_slug,
         count(*)::int as total,
         count(*) filter (where wa.site_status = 'nema_sajt')::int as no_site
  from businesses b
  left join website_audits wa on wa.place_id = b.place_id
  where b.niche_slug is not null
  group by 1, 2, 3;
```

`security_invoker = on` je obavezan: bez njega pogled radi kao vlasnik i tiho zaobilazi
`using (false)` na `businesses`.

---

## 2. Naplata — jedna SQL funkcija, jedna transakcija

Pravilo 3 iz CLAUDE.md kaže da se krediti menjaju samo kroz `spend_credit_and_unlock` ili
`grant_credits`. Ovo je treća funkcija i to je **svesno odstupanje**, iz istog razloga kao
`grant_monthly_credits` u 0004: skidanje kredita i upis posla moraju da budu jedna transakcija.
Alternativa je „skini pa upiši" — a između to dvoje stane pad procesa, i korisnik ostaje bez
kredita bez ijednog skeniranja. Duh pravila je ispoštovan: balans se i dalje menja isključivo
unutar auditovane `security definer` funkcije, pod `for update`, uz obaveznu stavku u knjizi.

```sql
create function spend_credit_and_scan(
  p_user text, p_country text, p_city text, p_niche text, p_max_results integer
) returns table (ok boolean, reason text, job_id bigint, joined boolean,
                 charged boolean, credits_left integer)
```

Redosled unutar transakcije:

1. `select ... from profiles where id = p_user for update` — nema profila → `no_user`.
2. Nađi **živ** posao (`pending`/`running`) sa `dedupe_key = 'RS:grad:nisa'`.
3. Ako živ posao postoji **i** taj korisnik za njega već ima stavku u knjizi
   (`reason = 'scan'`, `ref_id = 'scan:<job_id>'`) → `already_paid`, `charged = false`.
   Ovo je odluka 4: dupli klik, osvežena kartica, dva taba.
4. Balans < 1 → `insufficient_credits`. **Posao se ne upisuje** — Places se ne dira dok se
   ne naplati.
5. `enqueue_job(...)` → `job_id`, `joined`.
6. `insert into credit_ledger (user_id, delta, reason, ref_id) values (p_user, -1, 'scan', 'scan:' || job_id)`
   i `update profiles set credits_balance = credits_balance - 1`.

Zašto je `ref_id` baš `scan:<job_id>`, a ne `RS:grad:nisa`: knjiga time postaje spisak
platilaca po poslu, pa povraćaj ne mora nigde drugde da traži ko je šta platio. I odluka 3
(plaćaju obojica) i odluka 4 (isti čovek jednom) ispadaju iz istog uslova.

Prateće izmene u šemi:

- `credit_ledger_reason_valid` dobija `'scan'`
- parcijalni unique indeks `(user_id, reason, ref_id) where reason = 'refund' and ref_id like 'scan:%'`
  — bez njega ponovljen povraćaj ume da doda kredit dvaput

### Povraćaj

```sql
create function refund_scan(p_job_id bigint) returns table (refunded integer)
```

Za svaku `scan` stavku tog posla vraća +1 kroz `reason = 'refund'`, `ref_id = 'scan:<job_id>'`,
idempotentno. Zove ga **worker**, na dva mesta:

- `runScan`, kad je `inCity.length === 0` — Google nema nijednu firmu za tu kombinaciju
- petlja u `index.ts`, kad `failJob` vrati `final = true` za posao tipa `scan`

Odloženi posao (`defer_job` zbog budžeta) **nije** pad i ne vraća kredit — skeniranje će se
izvršiti kad kvota stigne.

---

## 3. API ugovor

### `POST /api/search`

Telo dobija dva polja: `pay: boolean = false` i `force: boolean = false`.

| Stanje registra | `pay: false` | `pay: true` |
|---|---|---|
| svež (< 30 dana), ima rezultata | `status: "cache"`, besplatno | isto (bez naplate) osim uz `force: true` |
| svež, 0 rezultata | `status: "cache"`, `total: 0`, `emptyScan: true` | naplati samo uz `force: true` |
| nema ga u registru | `status: "needs_scan"`, `scan.kind: "prvo"` | naplati → `status: "queued"` |
| stariji od 30 dana | `status: "needs_scan"`, `scan.kind: "osvezavanje"` | naplati → `status: "queued"` |

`needs_scan` **ne vraća nijedan lead** — ni ime, ni grad. Odluka: zastareo keš se ponaša kao
da ga nema, što je i najstroža čitanje pravila 1 („nikad ne serviraj Google podatak stariji od
30 dana").

Uz `needs_scan` ide i cena, da klijent ne mora ništa da računa:

```ts
scan: {
  cost: 1,
  kind: "prvo" | "osvezavanje",
  lastScannedAt: string | null,
  creditsLeft: number,
}
```

Redosled provera na plaćenom putu (svaka pre naplate, ni jedna posle):

1. `requireUserId()`
2. pre-flight `api_budget_status` — ako dnevni ostatak ne pokriva 3 poziva, `503` i **bez
   naplate**. Korisnik ne plaća kredit za posao koji će čekati kvotu.
3. `claim_cache_miss` — dnevni limit od 10; na `limit_reached` `429`, bez naplate
4. `spend_credit_and_scan` — na `insufficient_credits` `402` i **`release_cache_miss`**
5. na `already_paid` takođe `release_cache_miss` — dupli klik ne troši ni kredit ni rezervaciju

`searches` se i dalje puni na svaku pretragu; plaćeni put upisuje `source: 'api'`.
`api_calls` ostaje 0 — poziv broji worker kroz `api_budget`, ovde bi bio nagađanje.

### `GET /api/search/kes`

Registar za listu na strani. Vraća, za `RS`:

```ts
type KesStavka = {
  city: string; niche: string;
  total: number; noSite: number;
  scannedAt: string; expiresAt: string;
  fresh: boolean;             // još besplatno
  mine: boolean;              // korisnik je ovu kombinaciju već tražio
  empty: boolean;             // skenirano, Google nema nijednu firmu
};
```

`mine` se čita iz `searches` za tog korisnika.

Istekle kombinacije (`fresh: false`) se **vraćaju**, ali se u listi **ne prikazuju** — lista se
zove „besplatne pretrage" i mora da bude istinita. Šalju se zbog trake cene: bez njih klijent
pre klika ne ume da razlikuje „nikad skenirano" od „starije od 30 dana", a to su po odluci 8
dve različite rečenice. Filtriranje je u UI-ju, na jednom mestu, umesto dva upita koja se
vremenom raziđu.

---

## 4. UI — strana Pretraga

### 4.1 Traka cene ispod forme

Čim su izabrani i grad i niša, ispod forme stoji jedna rečenica i dugme dobija cenu:

| Stanje | Tekst | Dugme |
|---|---|---|
| svež keš | „U kešu · besplatno · osveženo 12.08, važi do 11.09." | „Pretraži" |
| svež, prazan | „Skenirano 12.08 — Google nema nijednu firmu za ovu kombinaciju." | „Pretraži" |
| nema u kešu | „Nije u kešu — skeniranje košta **1 kredit**." | „Skeniraj za 1 kredit" |
| stariji od 30 dana | „Podaci su stariji od 30 dana — osvežavanje košta **1 kredit**." | „Osveži za 1 kredit" |

Bez kredita: dugme je isključeno, tekst je „Nemaš kredita — keširane pretrage su i dalje
besplatne." uz vezu ka `/krediti`.

### 4.2 Modal potvrde

Otvara se pre svakog skidanja kredita, isti obrazac kao otključavanje:

> **Skeniranje košta 1 kredit**
> Šabac · PVC stolarija još nije u kešu. Google se poziva uživo, traje do dva minuta.
> Posle toga je ova kombinacija besplatna svima 30 dana.
> Imaš 27 kredita. Posle skeniranja: 26.
> `[ Odustani ]  [ Skeniraj za 1 kredit ]`

Za osvežavanje isti modal, drugi tekst („Podaci su od 12.07, stariji od 30 dana").

### 4.3 Lista besplatnih pretraga

Sekcija ispod forme, vidljiva pre prve pretrage i posle nje. Dva bloka, redosledom iz odluke:
**„Tvoje pretrage"** pa **„Ostalo u kešu"**. Jedan red:

```
Beograd · PVC stolarija        128 prospekata · 41 bez sajta      besplatno do 11.09.
```

- klik na red popunjava oba combobox-a i odmah pokreće besplatnu pretragu
- polje za filtriranje iznad liste (grad ili niša), jer redova vremenom bude na stotine
- prazne kombinacije stoje u listi kao „0 prospekata — Google nema nijednu firmu", sivo
- rok bliži od 3 dana se piše bojom upozorenja (`--warn-text`), ne crvenom

### 4.4 Posle rezultata

Uz liniju svežine stoji tekstualno dugme **„Osveži za 1 kredit"** (odluka 7) — i za svež keš.
Za praznu kombinaciju isto dugme piše „Skeniraj ipak ponovo za 1 kredit" (odluka 6).

### 4.5 Istorija kredita

`/krediti` prikazuje `scan` stavku kao **„Skeniranje: Beograd · PVC stolarija"**. Naziv se
dobija iz `ref_id`-ja posla (`job_queue.payload`), isto kao što se za `unlock` dovlači naziv
firme. Povraćaj: „Povraćaj — skeniranje bez rezultata".

---

## 5. Ivični slučajevi

| Slučaj | Ponašanje |
|---|---|
| Posao završi, ali korisnikovi filteri sakriju sve | **Nema povraćaja.** Keš je popunjen, kombinacija je besplatna svima. Povraćaj gleda broj nađenih firmi, ne filtriran broj. |
| Korisnik zatvori tab dok scan traje | Kredit ostaje skinut, posao ide do kraja, keš se puni. Sledeći ulazak je besplatan. |
| Scan nađe firme, ali `enrich_basic` padne | Nema povraćaja — Google podaci su tu, Ugly Score stiže kasnije. |
| Budžet pukne usred scana (`partial`) | Ako je nađena bar jedna firma — nema povraćaja, keš je delimično pun. Ako nijedna — povraćaj. |
| Kombinacija istekne dok korisnik gleda listu | Prikazano ostaje; sledeća pretraga traži plaćanje. Ne izbacuje se ekran ispod prstiju. |
| Otključan prospekt iz kombinacije koja je istekla | `/lista` se **ne dira** u ovoj fazi. Otključano je plaćeno i ostaje vidljivo. |
| CLI (`pnpm --filter cli scan`) | Ne poznaje kredite i ne treba da ih poznaje — to je moj alat. Upisuje u `search_cache` kao i worker. |

---

## 6. Bezbednost — provera pre kraja faze

- [ ] `user_id` za naplatu isključivo iz `requireUserId()` (pravilo 8) — nikad iz tela
- [ ] Nijedan lead ne izlazi uz `needs_scan` (pravilo 9 i pravilo 1)
- [ ] `search_cache` ima RLS `using (false)`; pogled `search_cache_stats` ima `security_invoker = on`
- [ ] `spend_credit_and_scan` i `refund_scan` su `revoke ... from public, anon, authenticated`
- [ ] Balans ne može ispod nule — `profiles_credits_nonneg` je i dalje poslednja brana
- [ ] `pay: true` ne može da se provuče kroz GET niti kroz keširan odgovor (`private, no-store`)

## 7. Gotovo kad

- [ ] Prva pretraga nove kombinacije skida tačno 1 kredit i to piše u `/krediti`
- [ ] Ista kombinacija je odmah zatim besplatna, i meni i drugom nalogu
- [ ] Dva klika na isto dugme skidaju jedan kredit
- [ ] Kombinacija bez rezultata vrati kredit i ostane zapamćena kao prazna
- [ ] Kombinacija starija od 30 dana ne prikazuje nijedan red dok se ne plati
- [ ] Nijedan Places poziv se više ne pokreće bez platioca (`enqueueRefresh` obrisan)
- [ ] `pnpm typecheck` prolazi, obe teme provereno

## 8. Ne radi u ovoj fazi

- Nema promene cene po veličini grada (Beograd i Šabac koštaju isto, iako Beograd troši više poziva)
- Nema pretplate, paketa kredita ni naplate — to je i dalje `BillingProvider` bez implementacije
- Nema automatskog osvežavanja popularnih kombinacija o mom trošku
- `/lista` i pipeline ostaju netaknuti
