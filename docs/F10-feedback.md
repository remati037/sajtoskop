# F10 — Utisci: jedan klik, jedan mejl

**Cilj:** u beti mi je najvredniji podatak ono što korisnik misli, a ne ono što loguje baza.
Zato u aplikaciji postoji dugme koje je vidljivo sa svakog ekrana, otvara se u jednom kliku,
a **prvi klik već znači poslat utisak**. Sve što stigne pada u tabelu `feedback` i istog
trenutka i u moj inboks, sa kontekstom dovoljnim da ne moram da pitam „gde ti je to puklo".

**Procena:** 1 dan · **Preduslov:** F4 i F9 gotovi (profil, krediti, okvir aplikacije)

---

## 0. Odluke donete uz ovaj dokument

Ne preispituju se u implementaciji.

1. **Plutajuće dugme dole desno**, prisutno na svakom ekranu unutar `(app)` okvira. Ne stavka
   u sidebaru — utisak se javlja u trenutku frustracije, a tada korisnik ne traži meni.
2. **Prvi klik je već poslat utisak.** Klik na jednu od tri ocene odmah upisuje red u bazu.
   Tekst, tip i sve ostalo je dopuna, ne uslov. Forma koja traži tri polja pre slanja u beti
   ne skuplja ništa.
3. **Baza je izvor istine, mejl je obaveštenje.** Upis mora da uspe; slanje mejla sme da padne
   i to ne ruši odgovor korisniku. Obrnut redosled znači da jedan pad Resend-a briše utisak.
4. **Resend**, pošiljalac `feedback@sajtoskop.com` (domen je verifikovan), `Reply-To` je mejl
   korisnika — odgovaram direktno iz inboksa, korisnik dobija odgovor od Sajtoskopa.
5. **Kontekst skuplja server, ne klijent.** Klijent šalje samo ono što zna i što nije osetljivo:
   ocenu, tip, tekst, rutu i dimenzije prozora. Mejl, plan, krediti i broj otključanih se čitaju
   na serveru (pravilo 8). Body koji tvrdi `plan: "pro"` se ignoriše.
6. **10 utisaka dnevno po korisniku šalje mejl**, preko toga se i dalje upisuje u bazu ali mejl
   izostaje. Korisnik uvek vidi „Hvala" — poruka „dosta si mi rekao" je u beti najgori mogući
   odgovor.
7. **Jedan automatski podsetnik, posle tri dana.** Jednom po nalogu, i to se pamti u bazi a ne
   u `localStorage`-u — inače isti čovek na drugom računaru dobija isti prozor iznova.
8. **Bez emodžija u aplikaciji.** Ocene su `Frown` / `Meh` / `Smile` iz `lucide-react`, po
   `docs/DIZAJN-SISTEM.md`. Emodži postoji **samo** u subjectu mejla, koji je moj inboks i nije
   pod dizajn sistemom — tamo služi da se utisak prepozna iz liste bez otvaranja.
9. **U UI-ju se zove „utisak"**, ne „feedback" ni „povratna informacija". Kratko, srpski, staje
   u dugme.

---

## 1. Model podataka

Migracija `0010_f10_feedback.sql`.

```sql
create table feedback (
  id            bigserial primary key,
  user_id       text not null references profiles(id) on delete cascade,
  country_code  text not null default 'RS',        -- pravilo 11

  rating        smallint not null,                 -- 1 loše · 2 ok · 3 odlično
  kind          text,                              -- bug | ideja | pohvala | drugo
  message       text,

  source        text not null default 'dugme',     -- dugme | podsetnik
  route         text,                              -- '/pretraga'
  route_label   text,                              -- 'Pretraga'
  ctx           jsonb not null default '{}'::jsonb,

  emailed_at    timestamptz,
  email_error   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint feedback_rating_valid  check (rating between 1 and 3),
  constraint feedback_kind_valid    check (kind is null or kind in ('bug','ideja','pohvala','drugo')),
  constraint feedback_source_valid  check (source in ('dugme','podsetnik')),
  constraint feedback_message_len   check (message is null or char_length(message) <= 2000),
  constraint feedback_country_valid check (country_code ~ '^[A-Z]{2}$')
);

create index feedback_user_idx    on feedback (user_id, created_at desc);  -- dnevni limit
create index feedback_recent_idx  on feedback (created_at desc);           -- pregled

alter table feedback enable row level security;
alter table feedback force row level security;
-- Bez politike → `using (false)`, kao `businesses` (pravilo 10). Čita se isključivo
-- kroz `service_role` iz API rute. Korisnik nema razloga da čita ni svoje utiske.
```

**Zašto je `ctx` jsonb, a ne kolone.** To je dijagnostika koja se čita očima u mejlu, ne
filtrira SQL-om. Kao kolone bi svako novo polje značilo migraciju, a sadržaj se u beti menja
brže od šeme. Oblik koji ruta upisuje:

```ts
type FeedbackCtx = {
  plan: string;          // 'beta'
  credits: number;       // stanje u trenutku slanja
  unlocks: number;       // broj otključanih prospekata
  ua: string;            // User-Agent, iz headera — ne iz body-ja
  viewport: string;      // '1440×900', iz body-ja (server ga ne zna)
};
```

`rating` je `not null` jer je klik na ocenu jedini obavezan korak — bez njega zapis ne bi ni
nastao. `kind` i `message` su `null` dok korisnik ne dopuni.

### Podsetnik posle tri dana

```sql
alter table profiles add column if not exists feedback_prompted_at timestamptz;
```

Jedna kolona, jedan upis, bez nove tabele. Podsetnik se pokazuje kad su ispunjena sva tri:

| Uslov | Odakle |
|---|---|
| nalog stariji od 3 dana | `profiles.created_at <= now() - interval '3 days'` |
| korisnik je stvarno nešto radio | `credits_balance < MESECNI_KREDITI` — bar jedan skinut kredit |
| podsetnik još nije viđen | `feedback_prompted_at is null` |

Drugi uslov je namerno izveden iz balansa umesto iz `count(*)` nad `unlocks` i `credit_ledger`:
profil se ionako čita u `(app)/layout.tsx`, pa podsetnik ne košta nijedan dodatni upit na
svakom učitavanju strane. Ivica koju to prima: korisnik koji je platio pa dobio povraćaj vraća
se na pun balans i podsetnik mu se odloži do sledećeg trošenja. Prihvatljivo — podsetnik nije
naplata, sme da promaši dan.

---

## 2. API ugovor

### `POST /api/feedback` — nastanak utiska

Zove se na klik na ocenu. Nema potvrde, nema koraka pre njega.

```ts
// lib/feedback-schema.ts
const telo = z.object({
  rating:   z.union([z.literal(1), z.literal(2), z.literal(3)]),
  source:   z.enum(["dugme", "podsetnik"]).default("dugme"),
  route:    z.string().max(200).optional(),
  viewport: z.string().regex(/^\d{2,5}×\d{2,5}$/).optional(),
});
```

Redosled u ruti:

1. `requireUserId()` — pravilo 8. `user_id` iz Clerk sesije, nikad iz tela.
2. Pročitaj profil (`plan`, `credits_balance`) i `count(*)` iz `unlocks` → `ctx`.
3. `route_label` se **ne** uzima iz tela nego se izvodi serverski, kroz `naslovZaPutanju(route)`
   iz `lib/navigacija.ts` — jedan izvor istine za naziv ekrana.
4. `insert into feedback (...) returning id`.
5. Mejl kroz `after()` iz `next/server` — odgovor korisniku ne čeka Resend.
6. `200 { id }`.

Odgovor je `200` čak i kad je mejl pao. Korisnik nema šta da uradi sa tom greškom, a utisak je
upisan.

### `PATCH /api/feedback/[id]` — dopuna

Zove se kad korisnik u drugom koraku doda tekst ili tip.

```ts
const telo = z.object({
  kind:    z.enum(["bug", "ideja", "pohvala", "drugo"]).optional(),
  message: z.string().trim().min(1).max(2000).optional(),
});
```

- `where id = ? and user_id = ?` — bez `user_id` u uslovu ovo je IDOR na tuđi utisak (P0-1).
- Dopuna je dozvoljena samo dok je `created_at > now() - interval '1 hour'`. Posle toga se
  odbija sa `409`. Zapis koji sam pročitao u mejlu ne sme da se prepiše sat kasnije.
- Prazna dopuna (korisnik zatvorio modal bez teksta) se ne šalje uopšte — nema šta da se piše.

**Dopuna šalje drugi mejl**, sa subjectom `↳ dopuna uz utisak #123`. Alternativa — čekati tekst
pa poslati jedan mejl — znači da utisak korisnika koji zatvori tab nikad ne stigne, a to obara
ceo cilj faze. Dupli mejl se dešava samo kad korisnik i oceni i napiše, dakle baš u
najvrednijem slučaju, i drugi mejl nosi pun sadržaj (ocenu **i** tekst), pa je prvi samo raniji
signal.

### `POST /api/feedback/podsetnik-vidjen`

Upisuje `profiles.feedback_prompted_at = now()`. Zove se kad se podsetnik prikaže, **ne** kad
se odgovori — korisnik koji ga je zatvorio ne sme da ga vidi ponovo. Prazno telo, samo sesija.

Ovo je direktan `update` nad `profiles`, ali **ne dira `credits_balance`**, pa pravilo 3 nije
u igri.

---

## 3. Mejl

Jedan `fetch` na `https://api.resend.com/emails`, iz Vercel rute. Pravilo 7 zabranjuje
Playwright i **lančani** HTTP fetch u Vercel funkciji; jedan poziv ka jednom API-ju sa
tajmautom nije to i ne ide u worker. Preko `job_queue` bi značilo da mi mejl stiže tek kad
worker povuče red — a poenta je da bug vidim odmah.

```ts
// lib/feedback-mail.ts
{
  from:     env.FEEDBACK_EMAIL_FROM,   // 'Sajtoskop <feedback@sajtoskop.com>'
  to:       [env.FEEDBACK_EMAIL_TO],
  reply_to: korisnikMejl,              // samo ako prođe validaciju, v. §5
  subject:  "😕 bug · Pretraga · marko@primer.rs",
  text:     "...",
  html:     "...",
}
```

Subject je namerno u formatu `ocena · tip · ekran · ko`, jer se tako iz liste u inboksu vidi
šta je hitno bez otvaranja. `😕 / 😐 / 🤩` po oceni; kad tipa nema, srednji deo se izostavlja.

Telo (i `text` i `html`, isti sadržaj):

```
Ocena        Loše (1/3)
Tip          Bug
Ekran        Pretraga (/pretraga)
Poruka       ————————————————————————————
             Kad kliknem Skeniraj ništa se ne desi, a kredit je skinut.
             ————————————————————————————

Korisnik     Marko Milenković · marko@primer.rs
Nalog        plan beta · 27 kredita · 14 otključanih
Uređaj       1440×900 · Chrome 141 / macOS
Zapis        #123 · 12.08.2026. u 14:22
```

- Env promenljive: `RESEND_API_KEY`, `FEEDBACK_EMAIL_TO`, `FEEDBACK_EMAIL_FROM`.
- Idu u **odvojenu Zod šemu** u `lib/env.ts`, po obrascu `webhookSecret()` — ne u `serverEnv()`.
  Razlog je isti kao tamo: cela aplikacija ne sme da traži Resend ključ da bi se podigla
  lokalno.
- Ključ nije podešen → upis prolazi, mejl se preskače, `email_error = 'RESEND_API_KEY nije
  podešen'`. Lokalni razvoj radi bez Resend naloga, a razlog stoji u bazi umesto u logu koji
  niko ne čita.
- Tajmaut 8 sekundi (`AbortSignal.timeout`). Bez retry-a u ovoj fazi — pad se vidi u
  `email_error`, a red je u bazi.

---

## 4. UI

### 4.1 Plutajuće dugme

`apps/web/src/components/utisak-dugme.tsx`, montira se u `okvir-aplikacije.tsx` uz sadržaj.

```
fixed bottom-5 right-5 z-30      (sm i naviše: ikonica + „Utisak")
fixed bottom-4 right-4           (telefon: samo ikonica, 44×44)
```

- **Nije primarno dugme.** Dizajn sistem dozvoljava jedno primarno po ekranu, a ono je već
  zauzeto („Skeniraj", „Otključaj"). Izgled je isti kao kartica kredita u sidebaru:
  `border-border-strong bg-bg-elev shadow-sm`, ikonica `MessageSquare` u `text-accent-text`,
  hover `border-fg-muted`.
- `z-30` je ispod mobilne fioke (`z-50`) i ispod modala — dugme ne sme da stoji preko
  otvorenog menija.
- Ne prikazuje se na `/` (prijava), jer je van `(app)` okvira.

### 4.2 Modal, korak 1 — ocena

```
┌──────────────────────────────────────┐
│  Kako ti ide?                     ✕  │
│  Pretraga                            │
│                                      │
│   ☹        ⊙        ☺                │
│  Loše      Ok     Odlično            │
│                                      │
│  Utisak stiže direktno meni.         │
└──────────────────────────────────────┘
```

Ikonice su `Frown` / `Meh` / `Smile`, veličine `h-7 w-7`. Neizabrane su `--fg-muted` sa
`--border` okvirom; klik na bilo koju daje `--accent-wash` podlogu i `--accent-text`. Boja
označava **izbor, ne vrednost** — crvena za „loše" bi bila dekoracija, a crvena je po dizajn
sistemu rezervisana za Ugly Score i greške.

Klik = `POST`, bez potvrde. Modal odmah prelazi na korak 2, optimistično: ako `POST` padne,
korak 2 se pretvara u poruku greške sa dugmetom „Pokušaj ponovo".

### 4.3 Modal, korak 2 — dopuna

```
┌──────────────────────────────────────┐
│  Zabeleženo, hvala.               ✕  │
│                                      │
│  Hoćeš da dodaš rečenicu?            │
│  ┌────────────────────────────────┐  │
│  │                                │  │
│  └────────────────────────────────┘  │
│                                      │
│  [ Bug ] [ Ideja ] [ Pohvala ]       │
│                                      │
│              [ Ne treba ] [ Pošalji ]│
└──────────────────────────────────────┘
```

- Polje je `textarea`, 3 reda, autofokus, brojač preostalih karaktera se pojavljuje tek ispod
  200 preostalih.
- Tipovi su `toggle` dugmad, opcioni, jedan izbor. Vizuelno isti obrazac kao ocene.
- „Pošalji" → `PATCH`, pa poruka „Poslato. Javljam se ako bude potrebe." i modal se zatvara
  posle 1,2 s.
- „Ne treba", `✕`, `Esc` i klik van modala rade istu stvar: zatvaraju bez `PATCH`-a. Utisak je
  već upisan i mejl je već otišao u koraku 1 — ništa se ne gubi.

### 4.4 Podsetnik posle tri dana

Isti modal, otvara se sam, jednom, 4 sekunde posle učitavanja strane (ne odmah — prekidati
korisnika u trenutku kad ekran tek sedne je najbrži način da se prozor zatvori bez čitanja).
Razlike u odnosu na ručno otvaranje:

- naslov: **„Tri dana si u Sajtoskopu"**, podnaslov: „Kako ti ide? Jedan klik je dovoljan."
- `source: "podsetnik"` u zapisu, da u mejlu i kasnijoj analizi razlikujem traženo od
  spontanog
- `POST /api/feedback/podsetnik-vidjen` se šalje **čim se modal prikaže**

`(app)/layout.tsx` prosleđuje `traziUtisak: boolean` u `OkvirAplikacije` — izračunato je
serverski, iz profila koji se ionako čita.

### 4.5 Kopi

| Mesto | Tekst |
|---|---|
| Dugme | Utisak |
| Naslov, ručno | Kako ti ide? |
| Naslov, podsetnik | Tri dana si u Sajtoskopu |
| Ocene | Loše · Ok · Odlično |
| Ispod ocena | Utisak stiže direktno meni. |
| Korak 2, naslov | Zabeleženo, hvala. |
| Korak 2, pitanje | Hoćeš da dodaš rečenicu? |
| Placeholder | Šta te muči, šta fali, šta bi izbacio… |
| Potvrda | Poslato. Javljam se ako bude potrebe. |
| Greška | Nije uspelo. Pokušaj ponovo za koji trenutak. |
| Preko limita | Hvala. Zabeleženo. |

---

## 5. Bezbednost — provera pre kraja faze

- [ ] `user_id` isključivo iz `requireUserId()` (pravilo 8); `PATCH` filtrira i po `user_id`
- [ ] `feedback` ima RLS `enable` + `force`, bez ijedne politike → `using (false)` (pravilo 10)
- [ ] **Header injection:** `reply_to` se postavlja samo ako mejl prođe `z.email()` i **ne
      sadrži `\r` ni `\n``**; inače se izostavlja i mejl svejedno ode
- [ ] **XSS u mejlu:** `message` se escapuje pre ulaska u `html` telo. Moj klijent za mejl
      renderuje HTML, pa je korisnički tekst tamo izvršni sadržaj kao i svuda
- [ ] `message` je ograničen i šemom (2000) i `check` ograničenjem u bazi — klijent koji
      zaobiđe formu udara u bazu
- [ ] Ruta odgovara `Cache-Control: private, no-store`
- [ ] Tvrd plafon: preko **50 zapisa u 24h** po korisniku `POST` vraća `200` i **ne upisuje
      ništa**. Odluka 6 čuva inboks; ovo čuva tabelu
- [ ] `RESEND_API_KEY` ne izlazi ni u jedan odgovor ni u `email_error`
- [ ] `ctx.ua` se čita iz headera, ne iz tela — telo koje šalje lažan UA ne menja zapis

---

## 6. Ivični slučajevi

| Slučaj | Ponašanje |
|---|---|
| Resend padne | Upis prošao, `email_error` popunjen, korisnik vidi „Poslato". Ne lažem korisnika da nije uspelo — iz njegovog ugla jeste. |
| Korisnik zatvori tab između koraka 1 i 2 | Ocena je upisana, mejl je otišao. Ništa se ne gubi. |
| Dupli klik na istu ocenu | Drugi klik se ignoriše dok prvi `POST` traje; nastaje jedan zapis. |
| Korisnik promeni ocenu u koraku 1 | Ne može — korak 1 se napušta na prvi klik. Predomišljanje ide kroz novi utisak. |
| 11. utisak u danu | Upisan, bez mejla. Korisnik vidi „Hvala. Zabeleženo." |
| Profil ne postoji (webhook zakasnio) | `POST` vraća `409`; utisak bez profila ne može da postoji zbog stranog ključa. Redak i prolazan. |
| Nalog obrisan | `on delete cascade` briše i utiske. Mejlovi koji su već stigli ostaju kod mene — to je pošta, ne baza. |
| Podsetnik i ručno otvaranje u isto vreme | Ručno otvaranje pobeđuje; podsetnik se ne prikazuje, `feedback_prompted_at` se ne upisuje, pa dolazi sledeći put. |
| Korisnik bez mejla u Clerku | `reply_to` se izostavlja, u telu mejla piše „bez mejla". |

---

## 7. Gotovo kad

- [ ] Dugme „Utisak" stoji na svakom ekranu aplikacije i ne pokriva nijedan sadržaj ni meni
- [ ] Klik na ocenu upiše red u `feedback` i mejl stigne u inboks za manje od minuta
- [ ] Mejl ima ocenu, ekran, ko je poslao, plan, kredite i uređaj, i `Reply-To` na koji mogu
      da odgovorim direktno
- [ ] Dopuna tekstom stigne kao `↳ dopuna` i zapis u bazi ima `message`
- [ ] Zatvaranje modala u koraku 2 ne gubi već poslat utisak
- [ ] 11. utisak u danu je u bazi, ali ne i u inboksu
- [ ] Podsetnik se pojavi tačno jednom, i posle odjave/prijave na drugom uređaju se ne vraća
- [ ] Aplikacija se podiže lokalno bez `RESEND_API_KEY` (mejl se preskoči, `email_error`)
- [ ] `pnpm typecheck` i `pnpm check:sql` prolaze, obe teme provereno

---

## 8. Ne radi u ovoj fazi

- **Nema admin stranice** `/admin/feedback` — inboks i Supabase tabela su dovoljni za beta obim
- **Nema NPS-a** („koliko bi preporučio, 0–10") — meri lojalnost proizvoda koji još nema cenu
- **Nema kontekstualnih `👍👎` trakica** po ekranima — plutajuće dugme prvo mora da pokaže
  daje li dovoljno; dve mehanike odjednom se međusobno kanibalizuju
- **Nema screenshota ekrana uz bug** — `html2canvas` u bundle-u zbog bete se ne isplati, a
  Storage upload iz pregledača otvara pitanja koja F5 već ima rešena za drugu namenu
- **Nema odgovora iz aplikacije** — odgovaram mejlom, korisnik nema inboks u Sajtoskopu
- **Nema glasanja o funkcijama** ni javne roadmap liste
- **Nema slanja u Slack/Telegram** — jedan kanal dok jedan kanal radi
