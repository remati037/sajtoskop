# F7 — Generator poruka i kanban

**Cilj:** korisnik otključa lead, dobije poruku spremnu za slanje, i može da prati šta se sa
tim leadom desilo.

**Procena:** 3–4 dana · **Preduslov:** F6 gotov

> **Kanban nije nice-to-have.** Status „Potpisan" je jedini podatak u celom proizvodu koji
> konkurent ne može ni da kupi ni da kopira, i jedina prednost koja raste s vremenom. Ako iz
> ove faze nešto preskačeš, preskoči generator poruka — ne kanban.

---

## 1. Šema

```sql
create table lead_status (
  user_id    text not null references profiles(id) on delete cascade,
  place_id   text not null references businesses(place_id) on delete cascade,
  status     text not null default 'nekontaktiran',
  note       text,
  channel    text,                    -- mejl | viber | instagram | poziv
  contacted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table outreach_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null references profiles(id) on delete cascade,
  place_id   text not null references businesses(place_id) on delete cascade,
  channel    text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

alter table lead_status       enable row level security;
alter table outreach_messages enable row level security;

create policy "own rows" on lead_status
  for select using (user_id = auth.jwt() ->> 'sub');
create policy "own rows" on outreach_messages
  for select using (user_id = auth.jwt() ->> 'sub');
```

Statusi, tačno ovi: `nekontaktiran` · `kontaktiran` · `odgovorio` · `potpisan` · `nezainteresovan`

---

## 2. Generator poruka

Tri kanala, tri različita oblika. Ovo nisu varijante istog teksta.

| Kanal | Ograničenja | Napomena |
|---|---|---|
| **Mejl** | 60–90 reči, ima subject | Jedini kanal u kome link nije problem |
| **Viber** | do 50 reči, **bez linka** | Linkovi u Viberu od nepoznatog broja se ne otvaraju i podižu sumnju |
| **Instagram DM** | dvostepeno: prva poruka 20 reči bez ponude, druga tek na odgovor | Duga prva poruka na IG-u ide u zahteve i tamo umire |

Ulaz u generator: naziv firme, niša, grad, `site_status`, `ai_verdict`, jedan najozbiljniji
`ai_issue`, `phone_type`.

Pravila kopija — proverena u praksi, ne pretpostavke:

- Prva rečenica sadrži **konkretan problem tog sajta**, ne opšte obećanje
- Bez pominjanja alata, skora i „analizirao sam vaš sajt automatski"
- **Poslednja rečenica uvek skida pritisak:** *„Ako vas ne zanima, slobodno ignorišite ovu poruku."* Ova rečenica dramatično podiže stopu odgovora.
- Obavezna opt-out formulacija u mejlu — ZZPL
- Bez emodžija, bez velikih slova, bez uzvičnika

Predlog kanala izvedi iz `phone_type`: mobilni → Viber, fiksni → poziv, nema telefona → mejl.

Implementacija: šabloni sa popunjavanjem su **podrazumevani**; Claude poziv je opcioni
„Napiši drugačije" dugme. Šablon je besplatan i predvidiv, AI poziv košta — ne troši ga na
svaki prikaz.

- [ ] Dugme „Kopiraj" po kanalu
- [ ] Klik na „Kopiraj" automatski prebacuje lead u `kontaktiran` i upisuje `channel`

---

## 3. Kanban

- [ ] `/pipeline` — pet kolona, drag and drop
- [ ] Kartica: naziv, grad, bedž statusa sajta, Ugly Score, datum kontakta
- [ ] Beleška po leadu, jedno tekstualno polje
- [ ] Filter po niši i gradu
- [ ] Samo otključani leadovi ulaze u pipeline

**Feedback loop:** kada lead pređe u `potpisan`, upiši događaj sa svim atributima tog leada
(niša, grad, `site_status`, `ugly_band`, `platform`, kanal kontakta). Ne koristi to još ni za
šta — samo skupljaj. Za šest meseci to je jedini podatak u proizvodu koji niko drugi nema.

---

## 4. Zamena za Google Sheet

Do sada je `pipeline-biznisi` Sheet bio izvor istine. Od ove faze to je aplikacija.

- [ ] Import postojećeg Sheeta: CSV upload koji spaja po telefonu ili nazivu+gradu i postavlja `lead_status`
- [ ] Radi to za svoj nalog prvog dana. Ako sopstveni podaci ne uđu čisto, neće ni tuđi.

---

## 5. Gotovo kad

- Otključan lead ima tri gotove poruke, sve tri prolaze test „da li bih ovo poslao ovako kako jeste"
- Kopiranje poruke prebacuje lead u `kontaktiran` bez dodatnog klika
- Kanban trpi 200 kartica bez primetnog usporenja
- Tvoj postojeći pipeline iz Sheeta je uvezen i tačan
- Prelazak u `potpisan` upisuje događaj sa svim atributima

---

## 6. Ne radi u ovoj fazi

- Bez slanja mejlova iz aplikacije — korisnik kopira i šalje sam. Slanje znači deliverability, SPF, blacklistu i podršku, a to je zaseban proizvod.
- Bez sekvenci i automatskih follow-upova
- Bez korišćenja `potpisan` podataka u skoringu — samo skupljanje
- Bez integracije sa CRM-ovima

---

## 7. Prompt za sesiju

```
Radimo docs/F7-poruke.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Kreni od šema i generatora poruka na šablonima — bez AI poziva. Napiši mi
tri primera izlaza (mejl, Viber, IG) za jedan stvaran lead iz baze pre nego
što napišeš UI, da procenim kopi.

Kanban posle toga. AI varijanta poruke na kraju, i to samo ako ostane vremena.
```
