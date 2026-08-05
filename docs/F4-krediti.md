# F4 — Otključavanje, krediti i export

**Cilj:** korisnik otključa lead, kredit se skine, kontakt postane vidljiv, i može da izveze
otključano u CSV.

**Procena:** 3 dana · **Preduslov:** F3 gotov

Posle ove faze proizvod je upotrebljiv od početka do kraja. Beta može da krene i bez F5–F7.

---

## 1. Unlock endpoint

`POST /api/unlock`

```ts
const userId = await requireUserId();          // isključivo iz Clerk sesije
const { placeId } = z.object({ placeId: z.string().min(1) }).parse(await req.json());

const { ok, reason } = await rpc("spend_credit_and_unlock", {
  p_user: userId, p_place: placeId,
});
```

Pravila:

- `user_id` **nikad** iz body-ja, query parametra ni headera — P0-1 i pravilo 8
- Bez batch endpointa. Otključavanje ide jedan po jedan, uvek.
- `already_unlocked` vraća uspeh i **ne skida kredit** (logika je već u SQL funkciji)
- Posle uspešnog unlocka: upiši `enrich_full` job (u F4 on još ne radi ništa — to je u redu)
- Odgovor vraća pun `PublicLead` sa `isUnlocked: true`, kroz istu `toPublicLead` funkciju iz F2

Poruke o grešci na srpskom, konkretne: *„Nemaš dovoljno kredita. Beta plan dobija 30 kredita
prvog u mesecu."*

---

## 2. Mesečni grant kredita

- [ ] Job tip `monthly_grant`, pokreće ga worker prvog u mesecu
- [ ] Za svaki profil sa `plan = 'beta'`: `grant_credits(id, 30, 'monthly_grant')`
- [ ] **Bez rollovera** — postavi balans na 30, ne dodaj 30. Rollover u besplatnoj beti znači da
      neko ko se registrovao u avgustu ima 90 kredita u oktobru bez ijedne pretrage.
- [ ] Idempotencija: `credit_ledger` provera da za taj mesec i tog korisnika grant već ne postoji

Implementaciono: `grant_credits` sa `reason = 'monthly_grant'` i `ref_id = '2026-09'`, plus
unique indeks na `(user_id, reason, ref_id)` gde je `reason = 'monthly_grant'`.

---

## 3. Ekran „Moja lista"

- [ ] `/lista` — svi otključani leadovi korisnika, sa punim podacima
- [ ] Kolone: naziv, telefon (sa tipom), mejl, sajt, Ugly Score, status, grad, datum otključavanja
- [ ] Pretraga i filtriranje unutar sopstvene liste
- [ ] Klik na telefon: `tel:` na fiksni, `viber://chat?number=` na mobilni — sitnica koju domaći korisnik odmah primeti
- [ ] Prazno stanje sa jasnim uputstvom, ne praznom tabelom

---

## 4. Stanje kredita

- [ ] Prikaz balansa u headeru, uvek vidljiv
- [ ] `/krediti` — istorija iz `credit_ledger`: datum, promena, razlog, koji lead
- [ ] Prikaz dnevnog cache-miss brojača: *„danas: 3 od 10 novih skeniranja"*
- [ ] Poruka o beta statusu: *„Beta je besplatna dok traje. Kad uvedem planove, javljam ti unapred."*

---

## 5. CSV export

- [ ] Isključivo otključani leadovi. Nikad zaključani, ni u redukovanom obliku.
- [ ] Koristi postojeći `csv.ts` iz shared paketa — BOM + CRLF, da se otvori u Excelu bez kvarenja dijakritike
- [ ] Dnevni cap: `PLANS[plan].exportPerDay` redova
- [ ] Kolone identične onima u `pipeline-biznisi` Sheetu koji već koristim, da se lepi bez prepravljanja
- [ ] Ime fajla: `sajtoskop-{grad}-{nisa}-{datum}.csv`

---

## 6. BillingProvider — interfejs bez implementacije

```ts
// packages/shared/src/billing.ts
export interface BillingProvider {
  checkoutUrl(plan: string, userId: string): Promise<string>;
  cancelSubscription(subId: string): Promise<void>;
  portalUrl(subId: string): Promise<string>;
}
```

Jedina implementacija u beti: `FreeBetaProvider` koja baca `NotImplemented` na svemu.
Cela aplikacija zove interfejs, nikad konkretnog provajdera.

**Ne piši Lemon Squeezy ni IPS QR sada.** Poenta interfejsa je da kasnija integracija bude
jedan fajl, a ne da se sada nešto integriše.

---

## 7. Bezbednost — provera pre kraja faze

- [ ] Skripta koja pošalje 20 paralelnih `POST /api/unlock` za 20 različitih leadova sa 1 kreditom → tačno jedan uspeh
- [ ] Pokušaj unlocka sa `userId` u body-ju → ignoriše se, koristi se sesija
- [ ] Pokušaj čitanja tuđeg `credit_ledger` reda sa anon ključem → prazno
- [ ] Export sa `?limit=99999` → i dalje vraća najviše dnevni cap

---

## 8. Gotovo kad

- Ceo tok radi bez tebe: registracija → pretraga → rezultat → otključavanje → CSV
- Balans se nikad ne menja mimo `credit_ledger`; provera: `sum(delta) = credits_balance` za svakog korisnika
- Test paralelnih zahteva prolazi
- Možeš da koristiš app umesto CLI-a za sopstveni Remati outreach

**Provera koja nije tehnička:** nedelju dana koristi app umesto CLI-a. Ako se vraćaš na terminal,
UI ne valja i to se popravlja pre F5.

---

## 9. Ne radi u ovoj fazi

- Bez screenshotova, PageSpeed-a i AI analize
- Bez naplate, bez planova osim `beta`
- Bez kanbana i generatora poruka
- Bez timova i deljenja liste

---

## 10. Prompt za sesiju

```
Radimo docs/F4-krediti.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Prvo napiši /api/unlock rutu i test skriptu za paralelne zahteve iz sekcije 7,
pa mi pokaži rezultat testa. Tek kad vidim da 20 paralelnih zahteva sa jednim
kreditom da tačno jedan unlock, idemo na UI.
```
