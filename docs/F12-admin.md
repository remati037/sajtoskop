# F12 — Admin konzola

**Cilj:** jedno mesto sa kog vodim betu. Ko je unutra, šta radi, koliko troši, kome treba
kredit, ko je prijavio bug i šta je sa tom prijavom. Bez otvaranja Supabase konzole i bez
ijednog ručnog `UPDATE`-a nad produkcijom.

Sve što F12 dodaje je **za mene, ne za korisnika**. Zato ima jedno pravilo iznad svih:
svaka radnja ostavlja trag, i nijedna se ne izvršava zato što je ruta „ionako ispod
`/admin`".

**Procena:** 2,5–3 dana, u tri isporuke
**Preduslov:** F1 (profili, Clerk), F4 (krediti), F9 (budžet)
**Ne dodaje nijedan Places poziv.**

---

## 0. Odluke donete uz ovaj dokument

1. **Uloga je u bazi, rezerva je u env-u.** `profiles.role` je izvor istine; `ADMIN_BOOTSTRAP_IDS`
   je spisak Clerk ID-jeva koji su admini bez obzira na bazu. Time je rešen problem prvog
   admina (nema ga ko postavi) i problem zaključavanja (degradirao sam sam sebe u 2 ujutru).
2. **ID prvog admina ne ide u SQL migraciju.** Migracija je u gitu; Clerk ID nije tajna, ali
   nije ni podatak koji treba da živi u istoriji repoa i u svakom klonu. Ide u env.
3. **`/admin/*` van admina vraća `404`, ne `403`.** Ne otkrivam da ekran postoji.
4. **Provera je u svakoj ruti i na svakoj strani.** `(admin)/layout.tsx` **nije zaštita**, iz
   istog razloga iz kog to nije ni `(app)/layout.tsx` — layout se ne izvršava ponovo pri
   klijentskoj navigaciji.
5. **Svaka mutacija upisuje red u `admin_audit`.** I uspeh i neuspeh. Alat koji ume da obriše
   nalog i da odštampa kredite bez dnevnika nije alat nego rizik.
6. **Brisanje naloga ide kroz Clerk, pa kaskada.** Clerk je izvor istine za identitet; baza
   ga prati. Zato F12 dodaje i webhook `user.deleted`, koji danas ne postoji — bez njega
   brisanje iz Clerk konzole ostavlja profil zauvek.
7. **Nema impersonacije.** „Uđi kao korisnik" u alatu koji prikazuje tuđe kontakt podatke je
   funkcija koja se pravi kad postoji podrška, ugovor i dnevnik pristupa. Ne u beti.
8. **Oduzimanje kredita ide kroz novi RPC, ne kroz `grant_credits`.** `grant_credits` po
   definiciji odbija negativan iznos i to ostaje tako. `admin_adjust_credits` je četvrta
   funkcija koja sme da dodirne balans i **njeno postojanje se dopisuje u pravilo 3**.
9. **Admin konzola izgleda isto kao aplikacija.** Isti tokeni, isti dizajn sistem, jedan
   akcenat. Razlika je jedan `ADMIN` bedž u bočnoj traci. Poseban „admin skin" je posao bez
   koristi.
10. **Bez brisanja podataka iz konzole osim celog naloga.** Nema „obriši ovaj utisak", nema
    „obriši ovu pretragu". Sadržaj se označava (`odbijeno`, `duplikat`), ne briše.

---

## 1. Ko je admin

### Model

```sql
alter table profiles
  add column if not exists role text not null default 'user',
  add column if not exists last_seen_at timestamptz;

alter table profiles add constraint profiles_role_valid
  check (role in ('user', 'admin'));

create index if not exists profiles_role_idx on profiles (role) where role = 'admin';
```

### Provera

```ts
// apps/web/src/lib/admin.ts
export async function jeAdmin(userId: string): Promise<boolean> {
  if (bootstrapAdmini().includes(userId)) return true;         // rezerva iz env-a
  const { data } = await adminSupabase()
    .from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}

/** Za strane: 404 umesto redirekcije — ne otkrivam da ekran postoji. */
export async function requireAdminPage(): Promise<string> {
  const userId = await requireSession();
  if (!(await jeAdmin(userId))) notFound();
  return userId;
}

/** Za rute: 404 sa praznim telom. Isti razlog. */
export async function requireAdminRoute(): Promise<string> { … }
```

`ADMIN_BOOTSTRAP_IDS` ide u **odvojenu Zod šemu** u `lib/env.ts`, po obrascu `webhookSecret()`
i `feedbackMailEnv()`. Prazna vrednost nije greška — tada admini postoje samo u bazi, a ako
ih nema nijednog, `/admin` je `404` za sve. Aplikacija se i dalje podiže.

### Zaštite od zaključavanja i od otimanja

| Pravilo | Zašto |
|---|---|
| Admin ne može sebi da skine ulogu | Jedan pogrešan klik = konzola bez ijednog admina |
| Admin ne može sebe da obriše ni blokira | Isto |
| Poslednji admin u bazi ne može da bude degradiran | Provera brojanjem u istoj transakciji |
| Promena uloge se uvek upisuje u `admin_audit` | Jedina radnja koja menja ko sme šta |
| `ADMIN_BOOTSTRAP_IDS` se ne prikazuje u UI-ju | Spisak ne izlazi iz procesa |

---

## 2. Model podataka — migracija `0012_f12_admin.sql`

```sql
-- ── 1. uloga i poslednja aktivnost ────────────────────────────
alter table profiles
  add column if not exists role         text not null default 'user',
  add column if not exists last_seen_at timestamptz;

alter table profiles add constraint profiles_role_valid check (role in ('user','admin'));
create index if not exists profiles_role_idx on profiles (role) where role = 'admin';

-- ── 2. dnevnik radnji ─────────────────────────────────────────
-- Piše se i na uspeh i na neuspeh. `payload` nikad ne sadrži tajne ni lozinke.
create table if not exists admin_audit (
  id          bigserial primary key,
  actor_id    text not null references profiles(id) on delete set null,
  action      text not null,               -- 'credits.grant', 'user.delete', …
  target_user text,                        -- nad kim
  target_ref  text,                        -- drugi objekat (utisak, stavka dnevnika)
  payload     jsonb not null default '{}'::jsonb,
  ok          boolean not null default true,
  error       text,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_time_idx   on admin_audit (created_at desc);
create index if not exists admin_audit_target_idx on admin_audit (target_user, created_at desc);

alter table admin_audit enable row level security;
alter table admin_audit force row level security;   -- using (false), pravilo 10

-- ── 3. ručna korekcija kredita ────────────────────────────────
-- ČETVRTA funkcija koja sme da dodirne balans (pravilo 3). Postoji jer
-- `grant_credits` po definiciji odbija negativan iznos, i to ostaje tako:
-- dodela i korekcija nisu ista radnja i ne smeju da dele istu ulaznu tačku.
--
-- Balans ne može ispod nule — `profiles_credits_nonneg` bi svejedno pukao, ali
-- ovde se to vraća kao uredan ishod, a ne kao izuzetak u ruti.
create or replace function admin_adjust_credits(
  p_actor  text,
  p_user   text,
  p_delta  integer,
  p_note   text,
  p_ref_id text
) returns table (ok boolean, reason text, balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_balance integer;
begin
  if p_delta = 0 then
    return query select false, 'invalid_amount', null::integer; return;
  end if;
  if abs(p_delta) > 500 then
    return query select false, 'iznos van granica', null::integer; return;
  end if;

  select credits_balance into v_balance from profiles where id = p_user for update;
  if not found then
    return query select false, 'no_user', null::integer; return;
  end if;

  if v_balance + p_delta < 0 then
    return query select false, 'balans bi bio negativan', v_balance; return;
  end if;

  if p_ref_id is not null and exists (
    select 1 from credit_ledger cl
    where cl.user_id = p_user and cl.reason = 'admin' and cl.ref_id = p_ref_id
  ) then
    return query select true, 'already_applied', v_balance; return;
  end if;

  insert into credit_ledger (user_id, delta, reason, ref_id)
    values (p_user, p_delta, 'admin', p_ref_id);
  update profiles set credits_balance = credits_balance + p_delta where id = p_user
    returning credits_balance into v_balance;

  insert into admin_audit (actor_id, action, target_user, target_ref, payload)
    values (p_actor, 'credits.adjust', p_user, p_ref_id,
            jsonb_build_object('delta', p_delta, 'note', p_note));

  return query select true, 'ok'::text, v_balance;
end $$;

revoke all on function admin_adjust_credits(text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function admin_adjust_credits(text, text, integer, text, text) to service_role;
```

**`ref_id` je obavezan i generiše ga server** kao `adm:<uuid>` pri otvaranju forme, ne pri
slanju. Dvostruki klik na „Dodaj 30 kredita" tada ne dodeli 60.

---

## 3. Ekrani

```
/admin                     pregled sistema
/admin/korisnici           lista
/admin/korisnici/[id]      detalj i radnje
/admin/utisci              utisci        (F11.3 ulazi ovde)
/admin/dnevnik             beta dnevnik  (F11.4 ulazi ovde)
/admin/revizija            dnevnik radnji
```

Grupa `(admin)` ima svoj layout i svoju bočnu traku. `ADMIN` bedž stoji uz logo — jedina
vizuelna razlika u odnosu na aplikaciju.

### 3.1 Lista korisnika

```
Korisnici                                          38 ukupno · 12 aktivnih 7d

[ pretraga po mejlu…        ]  [ Svi ▾ ] [ Aktivni 7d ] [ Admini ]   [ + Pozovi ]

┌────────────────────────────────────────────────────────────────────────────────┐
│ MEJL                    PLAN   KREDITI  OTKLJ.  PRETRAGE  UTISCI  POSLEDNJI PUT │
├────────────────────────────────────────────────────────────────────────────────┤
│ marko@primer.rs  ADMIN  beta      27      14        31        4   pre 2 sata    │
│ ana@studio.rs           beta       3      27        44        1   juče          │
│ pera@web.rs             beta      30       0         2        0   pre 9 dana    │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Stranica po **25**, sortiranje po registraciji, kreditima, otključanima i poslednjoj
  aktivnosti.
- Filteri: mejl (ILIKE), plan, aktivni 7 dana, admini, **bez ijedne aktivnosti** (kandidati
  za `zasto-ne-vracas` mejl).
- Brojevi po korisniku dolaze iz **jednog agregatnog upita** (`count(*) filter (where …)` nad
  `unlocks`, `searches`, `feedback`), ne iz N+1 petlje po redu.
- Ime, avatar, `lastSignInAt` i status blokade dolaze iz Clerka **jednim pozivom za celu
  stranicu** (`users.getUserList({ userId: [...25] })`), nikad po korisniku.
- „Poslednji put" je `profiles.last_seen_at` — upisuje se iz `(app)/layout.tsx` kroz
  `after()`, i to **najviše jednom na sat** po korisniku. Bez toga bi svako učitavanje strane
  bilo jedan upis.

### 3.2 Detalj korisnika

Četiri bloka, jedan ekran:

| Blok | Sadržaj |
|---|---|
| **Nalog** | mejl, ime, Clerk ID, plan, uloga, registrovan, poslednji put, status (aktivan / blokiran) |
| **Krediti** | balans, izvod iz knjige (poslednjih 50 stavki), dnevni cache-miss brojač |
| **Aktivnost** | otključani (poslednjih 20), pretrage (20), poslovi u redu, pipeline po kolonama |
| **Utisci** | sve što je poslao, sa statusom — link na `/admin/utisci` |

Radnje stoje u desnoj koloni, razdvojene u dve grupe: **obične** i **opasne** (druge su
odvojene linijom i imaju tipkanu potvrdu).

| Radnja | Kako se izvršava | Zaštita |
|---|---|---|
| Dodaj kredite | `admin_adjust_credits(+n)` | 1–500, beleška obavezna, `ref_id` iz forme |
| Oduzmi kredite | `admin_adjust_credits(−n)` | ne ispod nule |
| Promeni plan | `update profiles.plan`, vrednost iz `PLANS` | audit |
| Resetuj dnevni limit | `cache_miss_count = 0` | audit |
| Dodeli / skini ulogu admina | `update profiles.role` | ne sebi; poslednji admin ostaje |
| Blokiraj / odblokiraj | Clerk `users.banUser` / `unbanUser` | ne sebi |
| Pošalji poruku | Resend, `Reply-To` na mene | rate limit 20/dan |
| **Obriši nalog** | Clerk `users.deleteUser` → webhook `user.deleted` → kaskada | tipkani mejl u potvrdi, ne sebi |

### 3.3 Pozivanje i otvaranje naloga

```
┌──────────────────────────────────────────────┐
│  Pozovi u betu                            ✕  │
│                                              │
│  Mejl        [ ana@studio.rs            ]    │
│  Poruka      [ opciono, ide u mejl      ]    │
│                                              │
│  ○ Pošalji pozivnicu (Clerk šalje mejl)      │
│  ○ Otvori nalog odmah i pošalji lozinku      │
│                                              │
│                        [ Odustani ] [ Pozovi ]│
└──────────────────────────────────────────────┘
```

- **Pozivnica:** `clerkClient.invitations.createInvitation({ emailAddress, redirectUrl })`.
  Korisnik sam postavlja lozinku; profil nastaje kroz postojeći `user.created` webhook.
  Ovo je podrazumevana opcija.
- **Otvaranje naloga:** `clerkClient.users.createUser(...)` sa generisanom lozinkom koju
  prikazujem **jednom, u odgovoru**, i nigde ne upisujem. Za slučaj kad nekoga uvodim uživo.
- Lista poslatih pozivnica (`invitations.getInvitationList`) sa statusom i dugmetom
  „Opozovi".
- Obe radnje idu u audit; **lozinka nikad ne ulazi u `payload`**.

### 3.4 Pregled sistema — `/admin`

Šest kartica, sve iz baze, bez ijednog spoljnog poziva:

| Kartica | Sadržaj | Zašto je tu |
|---|---|---|
| **Places budžet** | danas / mesečno, prema limitima iz `api_budget` | Jedina brojka koja me košta pravi novac |
| **Red poslova** | na čekanju, u radu, palo u 24 h, najstariji na čekanju | Worker koji je stao se vidi ovde, ne u Hetzneru |
| **Korisnici** | ukupno, novi 7d, aktivni 7d / 30d | Stopa povratka iz `00-kontekst` §2 |
| **Krediti** | dodeljeno i potrošeno u 30 dana, po razlogu | Da li beta plan uopšte drži |
| **Utisci** | nerešeni bugovi, medijana cene, odgovorenost | F11 ulazi ovde |
| **Baza** | broj biznisa, audita, udeo keša u pretragama | Vrednost imovine proizvoda |

Crveno stanje (`--danger`) samo za dve stvari: budžet preko 80 % i posao koji čeka duže od
30 minuta. Sve ostalo je neutralno — konzola koja stalno svetli crveno se ne gleda.

### 3.5 Revizija

Tabela `admin_audit`, obrnuti hronološki red, filter po radnji i po korisniku.
Ovo je i moja jedina odbrana ako se ikad zapitam „ko je ovom čoveku dao 200 kredita".

---

## 4. API ugovor

Sve rute su `POST`/`PATCH` osim liste. Svaka počinje sa `requireAdminRoute()`, svaka
mutacija završava upisom u `admin_audit`.

| Ruta | Metod | Telo | Napomena |
|---|---|---|---|
| `/api/admin/korisnici` | GET | `q`, `filter`, `sort`, `strana` | agregat + jedan Clerk poziv |
| `/api/admin/korisnici/[id]` | GET | — | detalj |
| `/api/admin/korisnici/[id]/krediti` | POST | `delta`, `napomena`, `refId` | `admin_adjust_credits` |
| `/api/admin/korisnici/[id]/plan` | PATCH | `plan` | vrednost iz `PLANS` |
| `/api/admin/korisnici/[id]/uloga` | PATCH | `role` | ne sebi; poslednji admin ostaje |
| `/api/admin/korisnici/[id]/limit` | POST | — | reset `cache_miss_count` |
| `/api/admin/korisnici/[id]/blokada` | POST | `blokiran: boolean` | Clerk |
| `/api/admin/korisnici/[id]` | DELETE | `potvrda: "<mejl>"` | Clerk → webhook → kaskada |
| `/api/admin/pozivnice` | GET/POST/DELETE | `email`, `poruka?`, `nacin` | Clerk invitations |
| `/api/admin/pregled` | GET | — | kartice sa `/admin` |
| `/api/admin/revizija` | GET | `action?`, `user?`, `strana` | dnevnik |
| `/api/admin/izvoz` | GET | `sta=korisnici` | CSV, upisuje se u audit |

**Nijedna admin ruta ne uzima identitet aktera iz tela.** Akter je uvek
`requireAdminRoute()`; `target_user` iz putanje i mora da postoji u `profiles`.

### Webhook `user.deleted` — dopuna postojeće rute

```ts
if (event.type === "user.deleted") {
  // Clerk je izvor istine za identitet. Kaskada iz `profiles` briše unlocks,
  // ledger, searches, feedback, lead_status i outreach_messages.
  await obrisiProfil(event.data.id);
  return Response.json({ ok: true });
}
```

Idempotentno: brisanje nepostojećeg reda je uspeh, jer Svix ume da ponovi isporuku.
`businesses` i `website_audits` **ostaju** — to nisu korisnikovi podaci nego moja imovina
(`00-kontekst` §4).

---

## 5. Bezbednost — provera pre kraja faze

- [ ] `requireAdminPage()` / `requireAdminRoute()` je **prva linija** svake strane i rute pod
      `/admin` i `/api/admin`; layout se ne računa
- [ ] Nije admin → `404`, sa praznim telom; nikad `403` ni redirekcija
- [ ] `ADMIN_BOOTSTRAP_IDS` je u odvojenoj Zod šemi; prazna vrednost nije greška
- [ ] Admin ne može sebi da skine ulogu, da se blokira ni da se obriše
- [ ] Poslednji admin u bazi ne može da bude degradiran (provera brojanjem, u transakciji)
- [ ] Brisanje traži **tipkani mejl** u telu zahteva, poređen sa stvarnim mejlom iz Clerka
- [ ] Svaka mutacija upisuje `admin_audit` — i kad padne (`ok = false`, `error`)
- [ ] `payload` u auditu nikad ne sadrži lozinku, token ni ključ
- [ ] Krediti isključivo kroz `admin_adjust_credits`; direktan `UPDATE` nad
      `credits_balance` ne postoji nigde u `apps/web`
- [ ] `ref_id` za korekciju kredita se generiše pri **otvaranju forme** — dupli klik ne
      dodeljuje dvaput
- [ ] Rate limit na admin mutacije: 120/h po adminu
- [ ] `admin_audit` ima RLS `enable` + `force`, bez politike
- [ ] Clerk pozivi idu isključivo sa servera; `CLERK_SECRET_KEY` ne izlazi ni u jedan odgovor
- [ ] Izvoz korisnika (PII) upisuje red u audit sa brojem redova
- [ ] `Cache-Control: private, no-store` na svakoj admin ruti

---

## 6. Ivični slučajevi

| Slučaj | Ponašanje |
|---|---|
| Admin obriše sebe iz Clerk konzole | Webhook briše profil; `ADMIN_BOOTSTRAP_IDS` i dalje pušta taj ID unutra, ali profila nema → konzola prikazuje „nalog ne postoji" i nudi ponovnu prijavu |
| Clerk API ne odgovara na listi | Lista se prikazuje sa podacima iz baze; kolone iz Clerka nose crticu i jednu rečenicu zašto |
| Brisanje prošlo u Clerku, webhook nije stigao | Profil ostaje do sledeće isporuke; `/admin/korisnici` prikazuje „obrisan u Clerku" upoređivanjem sa listom |
| Dva admina menjaju istog korisnika istovremeno | Poslednji upis pobeđuje; oba stoje u reviziji, sa vremenima |
| Dodela kredita padne posle upisa u ledger | Nemoguće — jedna transakcija u RPC-u |
| Korisnik obrisan, a ima utiske | Kaskada ih briše. Mejlovi koji su stigli ostaju kod mene — to je pošta, ne baza |
| Pozivnica poslata dvaput na isti mejl | Clerk vraća grešku „već postoji"; UI je prikazuje kao stanje, ne kao pad |
| `ADMIN_BOOTSTRAP_IDS` prazan i nijedan admin u bazi | `/admin` je `404` za sve. Rešenje je env, i to piše u `.env.example` |
| Blokiran korisnik pokuša da uđe | Clerk ga zaustavlja na prijavi; aplikacija ga ne vidi |

---

## 7. Isporuke

| Isporuka | Sadržaj | Procena |
|---|---|---|
| **F12.1 — temelj** | migracija 0012, `lib/admin.ts`, `(admin)` okvir, lista korisnika, detalj (samo čitanje), `admin_audit`, `last_seen_at` | 1 dan |
| **F12.2 — radnje** | krediti, plan, uloga, reset limita, blokada, brisanje, webhook `user.deleted`, revizija | 1 dan |
| **F12.3 — ulazak i pregled** | pozivnice, otvaranje naloga, izvoz, `/admin` pregled sistema | 0,5–1 dan |

---

## 8. Gotovo kad

- [ ] `/admin` je `404` za svakog ko nije admin, i to iz rute a ne iz layout-a
- [ ] Prvi admin se postavlja isključivo kroz `ADMIN_BOOTSTRAP_IDS`, bez dodirivanja baze
- [ ] Admin iz konzole može da postavi drugog admina, i ne može da skine sebe
- [ ] Lista od 25 korisnika se učitava sa **jednim** upitom u bazu i **jednim** pozivom Clerku
- [ ] Dodela i oduzimanje kredita menjaju balans i izvod iz knjige; dupli klik ne dodeljuje dvaput
- [ ] Balans nikad ne može ispod nule, ni kroz konzolu
- [ ] Brisanje naloga briše i Clerk korisnika i sve njegove redove; `businesses` ostaje
- [ ] Pozivnica stigne na mejl i registracija kroz nju napravi profil sa 30 kredita
- [ ] Svaka mutacija ima red u `/admin/revizija`, sa akterom, ciljem i vremenom
- [ ] `/admin` pregled prikazuje stanje Places budžeta i reda poslova
- [ ] Aplikacija se podiže bez `ADMIN_BOOTSTRAP_IDS`
- [ ] `pnpm typecheck` i `pnpm check:sql` prolaze; obe teme provereno

---

## 9. Ne radi se u ovoj fazi

- **Nema impersonacije** — v. odluka 7
- **Nema uređivanja tuđeg pipeline-a ni liste** — konzola gleda, ne radi umesto korisnika
- **Nema brisanja pojedinačnih zapisa** — v. odluka 10
- **Nema više nivoa uloga** (support, read-only) — dve uloge dok postoji jedan čovek
- **Nema grafikona kroz vreme** — brojke da, istorija tek kad postoji šta da se poredi
- **Nema slanja masovnih mejlova** — pojedinačna poruka da, kampanja ne
