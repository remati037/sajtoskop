# F11 — Utisci v2: sistem koji sam traži odgovor

**Cilj:** F10 je napravio **kutiju za utiske**. F11 pravi **instrument koji meri**.
Razlika nije u dugmetu nego u tome ko postavlja pitanje: u F10 čekam da se korisnik seti,
u F11 aplikacija pita u trenutku kad odgovor postoji, tačno jednom, i pokaže korisniku
šta se sa odgovorom desilo.

Faza ima jednu tvrdu obavezu prema `00-kontekst.md` §2: do kraja bete moram da imam
**medijanu odgovora na pitanje „koliko bi ovo mesečno vredelo"** i **stopu povratka**.
Bez F11 tu brojku nemam, pa odluku o naplati donosim po osećaju.

**Procena:** 4 dana, u četiri isporuke koje se puštaju odvojeno. Između druge i treće ulazi
**F12 — admin konzola** (`docs/F12-admin.md`), jer status prijave nema gde da se postavi bez
nje. Ceo redosled i gotovi promptovi po sesiji su u `docs/SESIJE.md`.
**Preduslov:** F4, F7, F9, F10 gotovi; za F11.3 i F11.4 još i F12
**Ne dodaje nijedan Places poziv.** Ceo sistem je Postgres + Resend.

---

## 0. Zašto F10 nije dovoljno

F10 radi tačno ono što piše u F10 i nijedna odluka odatle se ne poništava iz mode.
Ali kutija za utiske ima tri strukturna ograničenja koja se ne rešavaju doterivanjem:

| Šta F10 daje | Šta ne daje | Posledica |
|---|---|---|
| Kanal koji je uvek tu | Nijedan povod da se upotrebi | Pasivan kanal u beti od 20 ljudi realno donese 1–3 utiska nedeljno, i to od dva najglasnija korisnika |
| Ocena 1–3 za ceo proizvod | Signal o **kom delu** proizvoda | „Ok" ne kaže da li je pretraga dobra a poruke loše |
| Tekst kad ga korisnik napiše | Odgovor na pitanje koje ja postavljam | Cena, preporuka i razlog odlaska se nikad ne pojave sami |
| Mejl meni | Bilo šta korisniku | Korisnik pošalje utisak, ne desi se ništa vidljivo, i drugi put ne šalje |
| Zapis u tabeli | Status, agregat, medijana | Odluka o naplati se donosi čitanjem inboksa unazad |

Poslednji red je najskuplji. **Zatvaranje petlje je jedina mehanika koja pretvara jednog
pošiljaoca utiska u stalnog izvora podataka.** Čovek koji vidi „ono što si prijavio je
popravljeno" prijavljuje ponovo. Čovek koji ne vidi ništa misli da je pisao u prazno — i
u pravu je.

### Zašto ne gotov alat (Canny, Featurebase, Hotjar, Usersnap)

- **Kontekst.** Moje pitanje ne glasi „šta misliš", nego „ti koji si otključao 14 prospekata
  i potpisao jednog — koliko bi platio". Taj uslov se čita iz `profiles`, `unlocks` i
  `lead_status`. Treći alat ne vidi moju bazu i nikad neće.
- **Trenutak.** Vrednost pitanja je u tome što se javi 3 sekunde posle prve popunjene liste.
  Ugrađeni widget ne zna kad je Playwright završio posao.
- **Jezik i ton.** Sve na srpskom, sa dijakritikom, mojim glasom. Prevedeni widget zvuči kao
  anketa banke.
- **Podaci.** Utisak nosi mejl, plan i stanje kredita. To ne izlazi iz Supabase-a kod trećeg
  bez razloga koji ne postoji.
- **Cena.** Canny/Featurebase je 20–50 $ mesečno za proizvod koji trenutno zarađuje 0 dinara.

---

## 0.1 Odluke donete uz ovaj dokument

Ne preispituju se u implementaciji.

1. **Četiri sloja, jedan motor.** Pasivni (dugme), kontekstualni (mikro-pitanja u toku rada),
   kampanjski (targetirana pitanja), povratni (šta se desilo sa prijavom). Sva četiri pišu u
   **istu tabelu `feedback`** i idu kroz **isti mejl**. Jedan inboks, jedan admin, jedan
   izveštaj.
2. **Katalog pitanja je kod, ne CMS.** `packages/shared/src/feedback-katalog.ts`. Nema
   administracije pitanja, nema tabele `campaigns`, nema editora. Novo pitanje = commit.
   Za 20 korisnika CRUD nad pitanjima je alat koji se pravi umesto proizvoda.
3. **Nijedno pitanje ne blokira ekran.** Kontekstualna pitanja su **mikro-trake u toku
   sadržaja**, kampanjska su **kartice**. Jedini modal u životu naloga ostaje podsetnik na
   dan 3, koji je F10 već isporučio.
4. **Motor pravila je jedan i tvrd:** najviše jedno pitanje po sesiji, najviše jedno na 72 h,
   svako pitanje najviše jednom po nalogu, dva odbacivanja zaredom → ćutanje 14 dana.
   Pravila žive u `packages/shared`, ne u komponenti.
5. **Prvi klik je i dalje poslat utisak** (F10, odluka 2). Sve u F11 to poštuje: mikro-traka
   šalje na prvi klik, tekst je uvek dopuna.
6. **Stanje motora je u bazi, ne u `localStorage`-u** — isti razlog kao F10 odluka 7. Globalni
   cooldown ide na `profiles` (već se čita u layout-u, dakle besplatno), stanje po pitanju u
   `feedback_prompts` (jedan upit po punom učitavanju, ne po klijentskoj navigaciji).
7. **Korisnik od sada vidi svoje prijave i njihov status.** Ovo je **svesno odstupanje od
   F10 odluke 10** („korisnik nema razloga da čita ni svoje utiske"). Razlog je merljiv: bez
   vidljivog ishoda nema drugog utiska. Čita se kroz API rutu sa `service_role`; RLS na
   `feedback` ostaje `using (false)` (pravilo 10).
8. **Krediti kao nagrada — da, ali ne za sve.** **+1 kredit za utisak koji nosi poruku**
   (automatski), **+10 za potvrđen bug** (ručno, iz admina). Nagrađuje se trud, nikad broj
   poslatih utisaka — zato +1 ima kapiju: poruka od bar 20 znakova, najviše jednom dnevno i
   deset puta mesečno. **Odgovor na pitanje o ceni se ne nagrađuje** — plaćena brojka o ceni
   je pokvarena brojka. Sve ide kroz `grant_credits` (pravilo 3), plafon 20 kredita mesečno
   iz utisaka.
9. **Slika uz bug — da, ali korisnik je nosi.** Nalepi (`Ctrl+V`) ili prevuci u panel. Bez
   `html2canvas`, bez snimanja ekrana, bez ijednog kilobajta biblioteke u bundle-u. Ovo
   **menja F10 §8** („nema screenshota"): razlog odbijanja tamo je bio bundle, a nalepljena
   slika ga nema.
10. **Automatski dnevnik grešaka uz bug.** ~40 linija: poslednjih 5 klijentskih grešaka
    (poruka, tip, ruta, vreme). **Nikad telo zahteva, nikad query string, nikad sadržaj
    polja.** Šalje se samo uz `kind = 'bug'` i uz incident.
11. **Instant mejl samo za ono što gori.** Ocena 1, `bug` i incident stižu odmah. Sve ostalo
    ide u **dnevni digest u 21:00**. Inboks u koji stiže 40 mejlova mesečno se čita; inboks u
    koji stiže 200 se filtrira u fasciklu.
12. **Admin ekran za utiske ne pravi svoj okvir.** `/admin/utisci` je jedan ekran unutar
    admin konzole iz **`docs/F12-admin.md`** — odatle uzima autentikaciju (`requireAdminRoute()`),
    bočnu traku, dnevnik radnji (`admin_audit`) i put do kredita (`admin_adjust_credits`).
    Zato F11.3 dolazi **posle** F12, a F11.1 i F11.2 ne zavise od njega i puštaju se ranije.
13. **Bez NPS skale 0–10.** F10 §8 je to odbio i razlog i dalje stoji. Umesto toga jedno
    pitanje o preporuci sa tri odgovora, i to samo u trenutku prvog potpisanog posla.
14. **Terminologija:** u UI-ju je i dalje **„utisak"**. Prijava sa statusom je **„prijava"**.
    Lista promena je **„Beta dnevnik"**. Reč „feedback" ne postoji u UI-ju.

---

## 1. Arhitektura — četiri sloja i jedan motor

```
                     ┌─────────────────────────────────────────────┐
                     │  KATALOG PITANJA  (kod, packages/shared)    │
                     │  ključ · uslov · oblik · kopi · nagrada     │
                     └───────────────────┬─────────────────────────┘
                                         │ čita
                     ┌───────────────────▼─────────────────────────┐
   događaj iz app-a  │  MOTOR PRAVILA                              │
   (lista gotova,    │  1 po sesiji · 1 / 72h · 1 po nalogu        │──► ništa
   unlock, poruka,   │  2 odbijanja → ćutanje 14 dana              │    (najčešći ishod)
   posao pao…)   ───►│  incident > kontekstualno > kampanjsko      │
                     └───────────────────┬─────────────────────────┘
                                         │ jedno pitanje
        ┌────────────────┬───────────────┼────────────────┬─────────────────┐
        ▼                ▼               ▼                ▼                 ▼
   ① PASIVNI        ② KONTEKSTUALNI  ③ KAMPANJSKI    ④ POVRATNI        (podsetnik F10)
   dugme + panel    mikro-traka      kartica         status prijave     modal, 1× u životu
   uvek dostupno    u toku rada      na vrhu         + Beta dnevnik
        │                │               │                ▲
        └────────────────┴───────────────┴────────────────┘
                         │ svi pišu isto           │ zatvara petlju
                         ▼                         │
              ┌──────────────────────┐             │
              │  feedback (Postgres) │─────────────┘
              │  + feedback_prompts  │
              └──────────┬───────────┘
                         │
          ┌──────────────┼───────────────┬──────────────────┐
          ▼              ▼               ▼                  ▼
     instant mejl   dnevni digest   /admin/utisci      nedeljni izveštaj
     (bug, ocena 1)    21:00        status + krediti   funnel + medijane
```

**Zašto motor, a ne `if` u komponenti.** Pitanja su raspoređena po pet ekrana i tri stanja
posla. Bez jednog mesta koje odlučuje, dva pitanja se pojave u istoj minuti, a korisnik ne
vidi dva pitanja — vidi anketu, i zatvara sve što liči na nju do kraja bete.

---

## 2. Katalog pitanja

`packages/shared/src/feedback-katalog.ts` — jedan izvor istine za web (prikaz), API
(validacija) i admin (naziv u listi).

```ts
export type Oblik = "mikro" | "kartica" | "panel";
export type Sloj  = "kontekst" | "kampanja" | "incident";

export type Pitanje = {
  kljuc: string;                    // 'prva-lista' — ide u feedback.prompt_key
  sloj: Sloj;
  oblik: Oblik;
  prioritet: number;                // veći pobeđuje kad se dva pitanja poklope
  naslov: string;                   // srpski, latinica
  opcije: { vrednost: string; label: string }[];
  /** Traži li se tekst posle klika i sa kojim placeholderom. */
  dopuna?: { placeholder: string; obavezna: false };
  /** Zod šema za `answers` — bez nje jsonb postaje kanta. */
  sema: z.ZodType;
};
```

### 2.1 Kontekstualna pitanja — tačke istine u toku rada

| Ključ | Okidač | Gde se pojavi | Pitanje | Odgovori |
|---|---|---|---|---|
| `prva-lista` | prva pretraga koja vrati ≥ 1 prospekt, 3 s pošto tabela sedne | traka iznad tabele | **Je l' ti ova lista upotrebljiva?** | Jeste · Delimično · Nije |
| `tacnost-podataka` | 3. otključavanje | traka u panelu prospekta | **Drže li podaci vodu?** | Sve tačno · Ponešto · Netačno → čipovi: telefon, mejl, sajt, Ugly Score, snimak |
| `poruka-kvalitet` | kopirana prva AI poruka (F7) | traka ispod poruke | **Bi li je poslao ovakvu?** | Poslao bih · Uz sitne izmene · Ne bih |
| `prazan-rezultat` | skeniranje vratilo 0 prospekata | na mestu prazne liste | **Šta si tražio?** | jedan red teksta + Pošalji |
| `prvi-potpisan` | lead prvi put pređe u kolonu **Potpisan** | kartica preko kanban kolone | **Prvi potpisan preko Sajtoskopa.** Koliko je alat pomogao? | Presudno · Pomoglo · Malo → pa: bi li ga preporučio kolegi? Da · Možda · Ne |

`prazan-rezultat` je jedino pitanje koje traži tekst kao prvi korak, jer klik bez teksta tu
ne nosi nijednu informaciju — a odgovor je **spisak niša i gradova koje ljudi traže a ja ih
nemam**, što je direktno ulaz u taksonomiju.

### 2.2 Incident — jedino pitanje koje sme da preseče cooldown

| Ključ | Okidač | Pitanje | Odgovori |
|---|---|---|---|
| `posao-pao` | `job_queue` status `failed`, ili polling istekao | **Skeniranje nije prošlo.** Da vidim šta se desilo? | Pošalji mi dnevnik · Ne treba |

„Pošalji mi dnevnik" u jednom kliku šalje `kind: 'bug'`, `severity: 2`, ctx sa poslednjih 5
klijentskih grešaka i `job_id`. Ovo je jedino mesto gde je pitanje **usluga korisniku**, a ne
molba — zato sme preko cooldowna, ali i dalje najviše jednom u 24 h.

### 2.3 Kampanjska pitanja — brojka zbog koje faza postoji

| Ključ | Uslov | Kada | Pitanje |
|---|---|---|---|
| `cena` | ≥ 7 dana od registracije **i** ≥ 5 otključanih | kartica na vrhu `/pretraga`, jednom | **Beta se jednom završava.** Koliko bi ti ovo mesečno vredelo? |
| `zasto-ne-vracas` | povratak posle ≥ 10 dana pauze | traka na prvom ekranu | **Nisi bio 10 dana.** Šta te je zaustavilo? |
| `kraj-bete` | dan 30 od registracije | kartica + mejl | četiri pitanja, jedan ekran |

**Pitanje o ceni** — odgovori su opsezi, ne slobodno polje. Slobodno polje daje „pa ne znam,
zavisi", a opseg daje broj koji ulazi u medijanu:

```
[ Ne bih plaćao ]  [ do 990 ]  [ 990–1.990 ]  [ 1.990–3.900 ]  [ 3.900–6.900 ]  [ 6.900+ ]
                                                                          RSD mesečno
```

Medijana se računa iz sredina opsega (`0 · 700 · 1.490 · 2.945 · 5.400 · 8.500`). Prag iz
`00-kontekst.md` §2 je **1.500 RSD** — ispod toga je alat interni alat za Remati.
Ispod polja stoji jedna rečenica koja mora tu da bude: *„Iskren odgovor mi je vredniji od
lepog. Ovo ne menja tvoj pristup u beti."*

`zasto-ne-vracas` čipovi: *Nemam trenutno vremena · Nisam našao dovoljno prospekata ·
Podaci mi nisu bili tačni · Rešio sam to drugačije · Nešto drugo*.

`kraj-bete`: (1) šta bi prvo popravio, (2) šta ti je najviše vredelo, (3) cena — ponovljena,
kao provera, (4) sme li tvoj rezultat u referencu na sajtu.

### 2.4 Pasivni sloj — dugme, prerađeno

Dugme ostaje na istom mestu (`fixed bottom-4/5 right-4/5`, `z-30`), ali:

- otvara **panel usidren uz dugme**, ne modal preko ekrana. Bug se prijavljuje **dok se
  gleda ono što ne radi** — modal preko ekrana sakriva baš to.
- ima **tačku na dugmetu** kad postoji rešena prijava koju korisnik nije video (`--accent`,
  8 px, bez animacije)
- nosi **čip „+1 kredit"** samo kad je nagrada zaista dostupna (danas još nije dodeljena i
  mesečna kvota nije potrošena) — nikad kao stalni ukras. Čip stoji uz polje za tekst, jer
  se nagrada dobija za **poruku**, ne za ocenu; obećanje uz ocenu bi bilo laž.
- prečica **`Ctrl/⌘ + Shift + U`** otvara panel sa bilo kog ekrana

---

## 3. Motor pravila

### 3.1 Tvrde granice

| Pravilo | Vrednost | Zašto |
|---|---|---|
| Najviše pitanja po sesiji | **1** | Drugo pitanje pretvara proizvod u anketu |
| Globalni cooldown | **72 h** | Posle odgovora se produžava na 7 dana |
| Isto pitanje | **1× po nalogu**, zauvek | Osim `spontani` (dugme) i `posao-pao` (1× / 24 h) |
| Najranije od učitavanja | **60 s** | Pitanje na prvom ekranu je pitanje pre iskustva |
| Dok posao radi | **nikad** | Ne prekidam skeniranje |
| Dok je otvoren modal/panel/dropdown | **nikad** | Dva sloja preko ekrana |
| 2 odbacivanja zaredom | **ćutanje 14 dana** | Čovek je rekao ne, dvaput |
| 3. odbacivanje | **ćutanje do kraja bete** | Ostaje samo dugme |
| Odgovor | cooldown **7 dana**, streak = 0 | Ko odgovara, dobija mir |

### 3.2 Redosled odlučivanja

```
događaj (npr. „prva lista je popunjena")
   │
   ├─ muted_until > now()                        → ništa
   ├─ već postavljeno pitanje u ovoj sesiji      → ništa
   ├─ cooldown_until > now()  ── i nije incident → ništa
   ├─ ekran nije miran (posao / modal / < 60 s)  → odloži do sledećeg događaja
   │
   ├─ kandidati = katalog.filter(uslov ispunjen && nije već viđeno)
   ├─ kandidati prazni                           → ništa
   │
   └─ uzmi najveći prioritet
        → prikaži
        → POST /api/feedback/pitanje/<kljuc>/prikazano   (upiši, pa računaj kao viđeno)
```

**Prikazano se upisuje pri prikazu, ne pri odgovoru** — isto pravilo koje F10 već koristi za
podsetnik. Korisnik koji je pitanje video i ignorisao ga ne sme da vidi ponovo.

### 3.3 Cena čitanja — nula dodatnih upita po navigaciji

- `profiles` se već čita u `(app)/layout.tsx`: odatle `feedback_cooldown_until`,
  `feedback_muted_until`, `feedback_dismiss_streak`, `feedback_unseen_count`.
- `feedback_prompts` se čita **jednom po punom učitavanju** (≤ 12 redova po korisniku) i
  prosleđuje kroz `UtisciProvider` u klijent. Layout se ne izvršava ponovo na klijentskoj
  navigaciji, pa prelazak `/pretraga → /lista` ne košta ništa.
- Sesija je `sessionStorage` ključ `sajtoskop-utisak-sesija` — jedino stanje koje sme da
  bude u pregledaču, jer „sesija" i jeste pojam pregledača.

---

## 4. Model podataka — migracija `0011_f11_utisci_v2.sql`

Ne pravi se nova tabela za odgovore. Kampanjski odgovor je i dalje utisak — isti inboks,
isti mejl, isti admin.

```sql
-- ── 1. feedback: od ocene ka odgovoru ─────────────────────────
-- `rating` prestaje da bude obavezan: kampanjski odgovor („1.990–3.900 RSD")
-- nema ocenu. Ali zapis bez ijednog sadržaja ne sme da postoji.
alter table feedback alter column rating drop not null;

alter table feedback
  add column if not exists prompt_key      text,
  add column if not exists answers         jsonb   not null default '{}'::jsonb,
  add column if not exists status          text    not null default 'novo',
  add column if not exists severity        smallint,
  add column if not exists tags            text[]  not null default '{}',
  add column if not exists admin_note      text,
  add column if not exists resolved_at     timestamptz,
  add column if not exists notified_at     timestamptz,   -- korisnik obavešten
  add column if not exists seen_at         timestamptz,   -- korisnik video ishod
  add column if not exists screenshot_path text,
  add column if not exists reward_credits  smallint not null default 0;

alter table feedback add constraint feedback_ima_sadrzaj
  check (rating is not null or answers <> '{}'::jsonb or message is not null);

alter table feedback add constraint feedback_status_valid
  check (status in ('novo','priznato','u_radu','reseno','odbijeno','duplikat'));

alter table feedback add constraint feedback_severity_valid
  check (severity is null or severity between 1 and 3);

-- Izvor dobija tri nove vrednosti; stara dva ostaju netaknuta.
alter table feedback drop constraint feedback_source_valid;
alter table feedback add  constraint feedback_source_valid
  check (source in ('dugme','podsetnik','pitanje','kampanja','incident'));

-- Admin lista: „šta je novo i nerešeno", pa „šta je od ovog korisnika".
create index if not exists feedback_status_idx on feedback (status, created_at desc);
create index if not exists feedback_prompt_idx on feedback (prompt_key, created_at desc);

-- ── 2. stanje pitanja po korisniku ────────────────────────────
create table if not exists feedback_prompts (
  user_id         text not null references profiles(id) on delete cascade,
  prompt_key      text not null,
  status          text not null default 'prikazano',
  shown_at        timestamptz not null default now(),
  answered_at     timestamptz,
  dismissed_count smallint not null default 0,
  feedback_id     bigint references feedback(id) on delete set null,

  primary key (user_id, prompt_key),
  constraint feedback_prompts_status_valid
    check (status in ('prikazano','odgovoreno','odbaceno'))
);

alter table feedback_prompts enable row level security;
alter table feedback_prompts force row level security;   -- using (false), pravilo 10

-- ── 3. stanje motora na profilu (čita se besplatno u layout-u) ─
alter table profiles
  add column if not exists feedback_cooldown_until timestamptz,
  add column if not exists feedback_muted_until    timestamptz,
  add column if not exists feedback_dismiss_streak smallint not null default 0,
  add column if not exists feedback_unseen_count   smallint not null default 0;

-- ── 4. beta dnevnik ───────────────────────────────────────────
create table if not exists changelog (
  id            bigserial primary key,
  title         text not null,
  body          text,
  kind          text not null default 'promena',
  from_feedback bigint[] not null default '{}',
  shipped_at    timestamptz not null default now(),
  published     boolean not null default true,

  constraint changelog_kind_valid check (kind in ('novo','promena','popravka'))
);

alter table changelog enable row level security;
alter table changelog force row level security;

-- [ODSTUPANJE od pravila 10, svesno] `changelog` nije korisnički podatak nego
-- sadržaj proizvoda — isto što i tekst na stranici. Zato jedina politika u ovoj
-- migraciji: prijavljen korisnik čita objavljene stavke.
create policy changelog_read_published on changelog
  for select to authenticated using (published);

-- ── 5. krediti za utisak ──────────────────────────────────────
alter table credit_ledger drop constraint credit_ledger_reason_valid;
alter table credit_ledger add  constraint credit_ledger_reason_valid
  check (reason in ('unlock','monthly_grant','admin','refund','feedback'));

-- Idempotencija: `feedback` ulazi u isti parcijalni unique indeks kao dodele.
-- ref_id je 'fb:<id>' — dvostruka dodela za isti utisak je nemoguća.
drop index if exists credit_ledger_grant_idem_idx;
create unique index credit_ledger_grant_idem_idx
  on credit_ledger (user_id, reason, ref_id)
  where ref_id is not null and reason in ('monthly_grant','admin','feedback');
```

### `grant_feedback_credits` — jedini put do kredita iz utiska

Pravilo 3: nikad direktan `UPDATE profiles.credits_balance`. Ova funkcija je tanak omotač
oko `grant_credits`, sa tri provere koje `grant_credits` ne zna: mesečni plafon, dnevna
kapija i veza sa zapisom.

> **Zamka koju ne smem da promašim:** `grant_credits` **interno validira razlog** —
> `if p_reason not in ('monthly_grant','admin','refund')`. Proširenje `check` ograničenja nad
> `credit_ledger` nije dovoljno; migracija mora da izmeni i telo funkcije, inače svaki poziv
> tiho vrati `invalid_reason` i nijedan kredit se ne dodeli.

```sql
-- Prvo funkcija, pa tek onda omotač.
create or replace function grant_credits(
  p_user text, p_amount integer, p_reason text, p_ref_id text default null
) returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- … telo nepromenjeno, osim jednog reda:
  if p_reason not in ('monthly_grant', 'admin', 'refund', 'feedback') then
    return query select false, 'invalid_reason'; return;
  end if;
  -- …
end $$;
```

```sql
create or replace function grant_feedback_credits(
  p_user     text,
  p_amount   integer,
  p_feedback bigint
) returns table (ok boolean, reason text, delta integer)
language plpgsql security definer set search_path = public as $$
declare
  v_mesec integer;
begin
  if p_amount <= 0 or p_amount > 10 then
    return query select false, 'iznos van granica', 0; return;
  end if;

  select coalesce(sum(cl.delta), 0) into v_mesec
    from credit_ledger cl
   where cl.user_id = p_user
     and cl.reason  = 'feedback'
     and cl.created_at >= date_trunc('month', now());

  if v_mesec + p_amount > 20 then
    return query select false, 'mesecni plafon za utiske', 0; return;
  end if;

  perform grant_credits(p_user, p_amount, 'feedback', 'fb:' || p_feedback::text);

  update feedback set reward_credits = p_amount where id = p_feedback;
  return query select true, 'ok'::text, p_amount;
exception
  when unique_violation then                       -- već dodeljeno za ovaj utisak
    return query select false, 'vec dodeljeno', 0;
end $$;

revoke all on function grant_feedback_credits(text, integer, bigint) from public, anon, authenticated;
grant execute on function grant_feedback_credits(text, integer, bigint) to service_role;
```

**Podela odgovornosti:** mesečni plafon i idempotencija su u RPC-u, jer to mora da izdrži i
poziv koji zaobiđe aplikaciju. **Dnevna kapija (+1 najviše jednom dnevno) i dužina poruke su
u `lib/feedback.ts`**, jer su pravilo proizvoda a ne integritet podataka — menjaće se češće
od šeme. Ako ikad počnu da se razilaze, izvor istine je RPC.

### Storage: slika uz bug

Privatni bucket `feedback`, putanja `<user_id>/<uuid>.<ext>`. Bez ijedne javne politike.
Admin ga vidi kroz potpisan URL sa TTL 10 minuta, generisan u trenutku otvaranja.
**Mejl ne nosi potpisan URL** nego link na `/admin/utisci/<id>` — potpisan URL u pošti je
tajna koja živi koliko i mejl.

---

## 5. API ugovor

| Ruta | Metod | Telo | Odgovor | Napomena |
|---|---|---|---|---|
| `/api/feedback` | POST | `rating?`, `prompt_key?`, `answers?`, `kind?`, `source`, `route`, `viewport`, `errors?`, `screenshot_path?` | `{ id, dopuna }` | F10 ruta, proširena |
| `/api/feedback/[id]` | PATCH | `kind?`, `message?`, `screenshot_path?` | `{ ok }` | F10, + slika |
| `/api/feedback/pitanje/[kljuc]/prikazano` | POST | — | `204` | Upisuje `feedback_prompts` |
| `/api/feedback/pitanje/[kljuc]/odbaceno` | POST | — | `204` | Diže `dismiss_streak`, možda `muted_until` |
| `/api/feedback/moje` | GET | — | `{ prijave: [...] }` | Zatvaranje petlje; briše tačku |
| `/api/feedback/slika` | POST | `multipart` | `{ path }` | ≤ 2 MB, png/jpeg/webp, provera magičnih bajtova |
| `/api/dnevnik` | GET | — | `{ stavke: [...] }` | Beta dnevnik, 10 poslednjih |
| `/api/admin/utisci` | GET | filteri | `{ redovi, ukupno }` | `requireAdminRoute()`, v. F12 |
| `/api/admin/utisci/[id]` | PATCH | `status`, `tags?`, `admin_note?`, `nagrada?` | `{ ok }` | Status → obaveštenje korisniku |
| `/api/cron/utisci-digest` | POST | — | `{ poslato }` | Vercel cron 21:00, `CRON_SECRET` |
| `/api/cron/utisci-izvestaj` | POST | — | `{ ok }` | Ponedeljak 09:00, meni |

**Šta se ne prima iz tela, nikad:** `user_id`, `plan`, `credits`, `status`, `severity`,
`reward_credits`, `route_label`. Sve to izvodi server (pravilo 8, F10 odluka 5).

**`prompt_key` se validira prema katalogu.** Ključ koji ne postoji u
`feedback-katalog.ts` → `400`. Bez toga je `answers` jsonb u koji svako upisuje šta hoće.
`answers` se validira **po pitanju**, Zod šemom iz kataloga — ne generičkim `z.record`.

---

## 6. UI — svaki oblik posebno

Sve boje kroz tokene iz `globals.css`. Nijedan hex u JSX-u. Obe teme se testiraju.

### 6.1 Mikro-traka (kontekstualno pitanje)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Je l' ti ova lista upotrebljiva?     [ Jeste ] [ Delimično ] [ Nije ] ✕ │
└──────────────────────────────────────────────────────────────────────┘
```

- Visina **44 px**, puna širina sadržaja, `rounded-[--r]`, `border border-border`,
  `bg-bg-subtle`. **Bez senke** — nije kartica, nego traka u toku sadržaja.
- Ulazi kao `opacity + y(8px)`, 0,34 s, `EASE` iz dizajn sistema §8. Ne skače: rezerviše
  visinu pre nego što se pojavi, da tabela ispod ne poskoči.
- Odgovori su `ghost` dugmad visine 32 px. Klik → traka se u mestu menja u:
  `✓ Hvala. Hoćeš da dodaš rečenicu? [ jedan red ] [ Pošalji ]` — i nestaje posle 6 s ako se
  ne dopuni.
- `✕` je `--fg-faint`, meta 32×32, `aria-label="Zatvori pitanje"`.
- `role="status"` na potvrdi, `aria-live="polite"`.
- Na telefonu: pitanje u prvom redu, dugmad u drugom, ista traka.

### 6.2 Panel iza dugmeta (pasivni sloj)

```
                                   ┌────────────────────────────────┐
                                   │  Utisak                     ✕  │
                                   │  Pretraga · beta               │
                                   ├────────────────────────────────┤
                                   │   ☹        ⊙        ☺          │
                                   │  Loše      Ok    Odlično       │
                                   │                                │
                                   │  ┌──────────────────────────┐  │
                                   │  │ Šta te muči, šta fali…   │  │
                                   │  └──────────────────────────┘  │
                                   │  [Bug] [Ideja] [Pohvala]       │
                                   │                                │
                                   │  🗎 Nalepi sliku (Ctrl+V)      │
                                   ├────────────────────────────────┤
                                   │  +1 kredit      [ Pošalji ]    │
                                   └────────────────────────────────┘
                                                     [ 💬 Utisak ]  ●
```

- Širina 360 px, usidren `bottom-16 right-4`, `shadow-card`, `bg-bg-elev`.
- **Klik na ocenu i dalje odmah šalje** (F10 odluka 2). „Pošalji" je samo dopuna.
- Zona za sliku prima `paste` i `drop`; kad slika stigne, prikazuje se sličica 64 px sa
  `✕`. Bez slike zauzima jedan red teksta.
- Fokus se hvata u panel (`focus trap`), `Esc` zatvara, fokus se vraća na dugme.

### 6.3 Kampanjska kartica — pitanje o ceni

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⓘ  Beta se jednom završava                                     ✕   │
│                                                                     │
│  Koliko bi ti Sajtoskop mesečno vredeo?                             │
│                                                                     │
│  [ Ne bih plaćao ] [ do 990 ] [ 990–1.990 ] [ 1.990–3.900 ]         │
│  [ 3.900–6.900 ]   [ 6.900+ ]                              RSD/mes  │
│                                                                     │
│  Iskren odgovor mi je vredniji od lepog. Ovo ne menja tvoj          │
│  pristup u beti.                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

- `card` sa `border-border-accent` i `bg-accent-wash` — jedina kartica koja sme da nosi
  akcenat, i to jednom u životu naloga.
- Klik → kartica se u mestu menja u „Zabeleženo. Hvala." + opciono jedno polje *„Šta bi
  morao da uradi za tu cenu?"*, pa nestaje.
- Iznosi su `.num` (Geist Mono, tabular).

### 6.4 „Moje prijave" — zatvaranje petlje

Novi ekran `/utisci`, i stavka u meniju naloga (ne u „Rad").

```
Moje prijave                                        4 poslate · 2 rešene

┌─────────────────────────────────────────────────────────────────────┐
│  ● REŠENO     Skeniranje puca kad grad ima dve reči        12.08.   │
│               „Popravljeno u verziji od 12.08. Hvala."      +10 kr  │
├─────────────────────────────────────────────────────────────────────┤
│  ○ U RADU     Voleo bih izvoz u XLSX                       09.08.   │
├─────────────────────────────────────────────────────────────────────┤
│  ○ NOVO       Ugly Score mi deluje strogo za jednostranice 08.08.   │
└─────────────────────────────────────────────────────────────────────┘
```

- Statusi kao bedževi: `novo` → `--fg-muted`, `u_radu` → `--info`, `reseno` → `--accent-text`,
  `odbijeno` → `--fg-faint`, sa jednom rečenicom obrazloženja. **Odbijeno bez obrazloženja
  se ne prikazuje kao odbijeno nego kao „pročitano"** — čovek koji vidi „odbijeno" bez reči
  više ne piše.
- Otvaranje ekrana upisuje `seen_at` i nulira `feedback_unseen_count` → tačka sa dugmeta
  nestaje.

### 6.5 Beta dnevnik

Na `/dashboard`, ispod statistike, 5 poslednjih stavki:

```
Beta dnevnik                                    17 od 23 promene iz utisaka

  12.08.  popravka   Skeniranje sa dvorečnim gradom      ← iz tvog utiska
  11.08.  novo       Izvoz u CSV sa kolonom Ugly Score
  09.08.  promena    Pipeline pamti poziciju skrola
```

Oznaka **„iz tvog utiska"** stoji samo kad je `from_feedback` presek sa korisnikovim
prijavama neprazan. To je jedna rečenica koja radi više za sledeći utisak nego bilo koja
molba.

### 6.6 Admin — `/admin/utisci`

Jedan ekran **unutar konzole iz `docs/F12-admin.md`**, ne svoj okvir: odatle uzima
`requireAdminRoute()`, bočnu traku, `admin_audit` i `admin_adjust_credits`.

Filteri (status, sloj, ocena, korisnik), lista, detalj u panelu desno. Radnje u detalju:
status, oznake, beleška, „dodeli 10 kredita", „poveži sa stavkom dnevnika". Iznad liste
jedan red brojki: **odgovorenost po pitanju**, **medijana cene**, **broj otvorenih bugova**,
**prosek do odgovora**. Isti red se pojavljuje i kao kartica na `/admin` pregledu.

### 6.7 Nagrada — gde se vidi i kad se dodeljuje

| Za šta | Koliko | Kada se dodeljuje | Kapija |
|---|---|---|---|
| Utisak sa porukom | **+1** | u `after()` posle uspešnog `PATCH`-a sa `message` | poruka ≥ 20 znakova · 1 dnevno · 10 mesečno |
| Potvrđen bug | **+10** | ručno, klikom u `/admin/utisci` | `status = 'priznato'` i `kind = 'bug'` |
| Odgovor o ceni | **0** | — | namerno |

Korisnik vidi ishod odmah u potvrdi: *„Poslato. Hvala — dodao sam ti 1 kredit."* Kad je
kvota potrošena, rečenica je samo *„Poslato. Javljam se ako bude potrebe."* — **nikad
objašnjenje da je kvota potrošena**, iz istog razloga iz kog F10 ne kaže „dosta si mi rekao".

---

## 7. Mejl i izveštaji

| Šta | Kada | Sadržaj |
|---|---|---|
| Instant | `kind='bug'`, `rating=1`, incident | Kao F10 §3, + oznaka pitanja, + link na `/admin/utisci/<id>` |
| Digest | svaki dan 21:00, ako ima šta | Grupisan po sloju, jedan red po utisku, bez HTML ukrasa |
| Nedeljni izveštaj | ponedeljak 09:00 | Funnel po pitanju, medijana cene, novi bugovi, korisnici koji ćute |
| Korisniku: „rešeno" | kad status pređe u `reseno`, najviše 1× dnevno po korisniku | Kratko, sa rečenicom obrazloženja i linkom na `/utisci` |

Mejl korisniku je jedini novi odlazni mejl prema spolja. Ne postoji odjava iz njega jer
nije marketinški — vezan je za radnju koju je korisnik sam pokrenuo. Ako se ikad pojavi
druga vrsta mejla, odjava ide u istom trenutku.

---

## 8. Bezbednost — provera pre kraja faze

- [ ] `user_id` isključivo iz `requireUserId()`; svaka admin ruta zove `requireAdminRoute()`
      **u ruti**, ne samo u layout-u (uloga i rezerva su definisane u `docs/F12-admin.md`)
- [ ] `prompt_key` postoji u katalogu, inače `400` — bez toga je `answers` otvorena kanta
- [ ] `answers` se validira Zod šemom **iz kataloga, po ključu**, nikad generičkim recordom
- [ ] `feedback_prompts` ima RLS `enable` + `force`, bez politike (pravilo 10)
- [ ] `changelog` ima jedinu politiku u migraciji, i ona je `select ... using (published)`
- [ ] Slika: ≤ 2 MB, `png/jpeg/webp` po **magičnim bajtovima** a ne po `Content-Type`,
      ime fajla se ne koristi (`uuid`), bucket privatan, bez javne politike
- [ ] Potpisan URL za sliku živi 10 min i generiše se samo u adminu; **ne ide u mejl**
- [ ] Dnevnik grešaka: samo `poruka` (≤ 200), `tip`, `ruta` **bez query stringa**, `vreme`.
      Nikad telo zahteva, nikad sadržaj polja, nikad `localStorage`
- [ ] `message`, `admin_note` i `answers` se escapuju pre ulaska u HTML mejl (F10 §5)
- [ ] Krediti isključivo kroz `grant_feedback_credits` → `grant_credits` (pravilo 3);
      idempotencija kroz `ref_id = 'fb:<id>'`
- [ ] Rate limit: `POST /api/feedback` 50/24 h (F10 plafon ostaje), `/slika` 10/24 h,
      `/pitanje/*` 30/24 h
- [ ] `Cache-Control: private, no-store` na svakoj ruti; `/api/dnevnik` sme `private, max-age=60`
- [ ] `RESEND_API_KEY`, `CRON_SECRET` i `SUPABASE_SERVICE_ROLE_KEY` ne izlaze ni u jedan
      odgovor ni u `email_error`
- [ ] Cron rute odbijaju zahtev bez `CRON_SECRET`, i to poređenjem otpornim na vreme

---

## 9. Ivični slučajevi

| Slučaj | Ponašanje |
|---|---|
| Dva pitanja ispunila uslov u istoj sekundi | Pobeđuje veći prioritet; drugo ostaje kandidat za sledeći put, ne prikazuje se |
| Korisnik otvori dva taba | Sesijski ključ je po tabu, ali cooldown je u bazi — drugi tab dobije `409` na „prikazano" i ne prikazuje ništa |
| Korisnik odgovori pa se predomisli | Nema izmene odgovora. Predomišljanje ide kroz dugme, kao novi utisak |
| Odbaci pitanje pa istog dana pošalje utisak dugmetom | Streak se **ne** nulira — dugme nije odgovor na pitanje |
| Admin postavi `reseno` na 5 utisaka istog korisnika odjednom | Jedan mejl, sa 5 stavki. Brojač tačke ide na 5 |
| Slika se otpremi, utisak se ne pošalje | Sirotan u Storage-u; nedeljni cron briše slike bez `feedback_id` starije od 24 h |
| Korisnik nalepi sliku od 8 MB | `413` sa porukom „Slika je prevelika — do 2 MB." Utisak i dalje može bez slike |
| `cena` uslov ispunjen, a korisnik je mute-ovan | Kampanjsko pitanje **poštuje mute**. Pitam mejlom na dan 30, ne u aplikaciji |
| Korisnik obrisao nalog | `on delete cascade` briše sve; `changelog.from_feedback` ostaje sa ID-em koji više ne postoji, i to je u redu — dnevnik je istorija proizvoda |
| Beta se završila, a pitanja ostala | Katalog ima `do:` datum po pitanju; posle njega pitanje ne postoji za motor |
| Resend padne na mejlu „rešeno" | `notified_at` ostaje `null`, sledeći digest pokušava ponovo, najviše 3 puta |

---

## 10. Kako merim sam sistem

Bez ovoga F11 je pretpostavka. Brojke iz nedeljnog izveštaja:

| Metrika | Cilj | Kako se računa |
|---|---|---|
| Odgovorenost po pitanju | **≥ 40 %** za mikro-trake | `odgovoreno / prikazano` iz `feedback_prompts` |
| Udeo sa tekstom | ≥ 15 % | `message is not null / ukupno` |
| Pokrivenost | **≥ 70 % aktivnih u 30 dana** dalo bar jedan utisak | distinct `user_id` / aktivni |
| Odbacivanje | **< 25 %** | `odbaceno / prikazano` |
| Odgovora na `cena` | **≥ 12** do kraja bete | broj zapisa sa `prompt_key='cena'` |
| Do prvog utiska | < 5 dana od registracije | medijana |
| Drugi utisak istog korisnika | ≥ 50 % onih koji su videli „rešeno" | poređenje kohorti |

Poslednji red je test cele teze o zatvaranju petlje. Ako ljudi koji su videli „rešeno" ne
šalju drugi utisak češće od onih koji nisu — mehanika ne radi i F11.4 se gasi, a ostatak
ostaje.

### Očekivan obim, iskreno

20 beta korisnika, ~12 aktivnih. Katalog ima 5 kontekstualnih pitanja koja realno stignu do
~3 po korisniku, uz 40 % odgovorenosti → **~14 odgovora**. Kampanjska: `cena` do ~10 ljudi,
oko 6 odgovora. Dugme: 1–3 nedeljno. Ukupno **35–50 signala mesečno** umesto današnjih
4–10.

Medijana cene iz 6–12 odgovora **nije dokaz nego signal**. To se piše u izveštaj svaki put,
da za tri meseca ne ispadne da je 1.900 RSD bila „istraženo utvrđena cena".

---

## 11. Isporuke

Puštaju se odvojeno. Svaka je upotrebljiva sama za sebe.

| Isporuka | Sadržaj | Procena |
|---|---|---|
| **F11.1 — motor** | migracija 0011, katalog, `UtisciProvider`, mikro-traka, **tri pitanja sa `/pretraga`** (`prva-lista`, `prazan-rezultat`, `posao-pao`), rute za `prikazano/odbaceno` | 1,5 dan |
| **F11.2 — kampanje** | kartica, pitanje o ceni, `zasto-ne-vracas`, `prvi-potpisan`, `tacnost-podataka`, `poruka-kvalitet`, panel umesto modala, slika i dnevnik grešaka | 1 dan |
| *(ovde ulazi cela F12 — admin konzola)* | v. `docs/F12-admin.md` | 2,5–3 dana |
| **F11.3 — admin utisaka** | `/admin/utisci` u postojećoj konzoli, statusi, oznake, digest u 21:00, nedeljni izveštaj | 0,75 dan |
| **F11.4 — petlja** | `/utisci`, tačka na dugmetu, mejl „rešeno", beta dnevnik, `grant_feedback_credits` | 0,75 dan |

**Zašto je rez baš tu.** F11.1 uzima sva tri pitanja koja žive na **istom ekranu**
(`/pretraga`): jedna tačka integracije, jedan test, a mehanika se odmah proverava na
najprometnijem mestu u aplikaciji. `tacnost-podataka` i `poruka-kvalitet` sede u panelu
prospekta i u generatoru poruka, pa idu u F11.2, gde se ti ekrani ionako otvaraju. Podela po
ekranu je jeftinija od podele po tipu pitanja.

**Zašto admin ide u sredinu.** F11.1 i F11.2 počinju da skupljaju podatke odmah i ne
zavise ni od jednog admin ekrana. F11.3 i F11.4 zavise — status prijave nema gde da se
postavi bez konzole. Redosled je zato: skupljaj → pa napravi mesto za obradu → pa zatvori
petlju.

---

## 12. Gotovo kad

- [ ] Nijedan korisnik ne vidi dva pitanja u istoj sesiji, ni na jednom putu kroz aplikaciju
- [ ] Mikro-traka se pojavi 3 s posle prve popunjene liste, ne pomeri tabelu i nestane na `✕`
- [ ] Dva odbacivanja zaredom ućute sistem na 14 dana, i to preživi odjavu i drugi računar
- [ ] Klik na odgovor upiše `feedback` red i `feedback_prompts` red u istom zahtevu
- [ ] `prompt_key` van kataloga vrati `400`; `answers` koji ne prolazi šemu vrati `400`
- [ ] Pitanje o ceni se pojavi tačno jednom, posle 7 dana i 5 otključanih, i medijana se vidi
      u adminu
- [ ] Nalepljena slika stigne u privatan bucket i vidi se u adminu kroz potpisan URL
- [ ] Bug prijava nosi poslednjih 5 klijentskih grešaka, bez ijednog query stringa
- [ ] Status `reseno` pošalje jedan mejl, upali tačku na dugmetu i pojavi se u „Moje prijave"
- [ ] „Dodeli 10 kredita" prođe kroz `grant_feedback_credits`, dvaput kliknuto ne dodeli 20
- [ ] Digest u 21:00 stigne sa svime što nije išlo instant; prazan dan ne šalje mejl
- [ ] Aplikacija radi bez `RESEND_API_KEY` i bez `ADMIN_BOOTSTRAP_IDS` (admin vraća 404)
- [ ] `pnpm typecheck` i `pnpm check:sql` prolaze; obe teme i telefon provereni

---

## 13. Ne radi se u ovoj fazi

- **Nema session replay-a** (Hotjar, PostHog, OpenReplay) — snimanje tuđeg ekrana u alatu
  koji prikazuje tuđe kontakt podatke otvara pitanje na koje nemam odgovor
- **Nema automatskog snimanja ekrana** iz pregledača — korisnik nosi sliku, `html2canvas`
  ostaje van bundle-a (F10 §8 i dalje važi u tom delu)
- **Nema NPS skale 0–10** — v. odluka 13
- **Nema javne roadmap liste sa glasanjem** — 20 ljudi ne pravi rang listu, prave je dvojica
  najglasnijih
- **Nema četa u aplikaciji** — odgovaram mejlom, u roku od 24 h, i to je obećanje koje stoji
  u panelu
- **Nema A/B testa kopija pitanja** — na 12 aktivnih korisnika svaka razlika je šum
- **Nema Slack/Telegram kanala** — jedan kanal dok jedan kanal radi (F10 §8)
- **Nema administracije pitanja kroz UI** — katalog je kod (odluka 2)
