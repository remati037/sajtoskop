# 11 — Tekstovi stanja skeniranja

> **Sprovedeno 16. septembra 2026.** Ponašanje: migracija `0034_scan_refund.sql`
> (razlog `scan_refund`, `fail_scan_and_refund`, brisanje `search_access`, red u
> `admin_audit`). Tekstovi: `apps/web/src/lib/stanja-skeniranja.ts` (A–F, brojevi
> i imena kao parametri). Poruka sa brojem posla i zabranom ponavljanja je
> obrisana zajedno sa `scanBezRegistra` i granom `503` u `/api/search`.
>
> **Ispravka uz stanje D:** „Moje pretrage" kao ekran ne postoji. Mesto na koje
> se misli je blok **„Tvoji pristupi"** na dnu `/pretraga` (`kes-lista.tsx`) —
> plaćene kombinacije koje se otvaraju bez novih kredita. Tekst u kodu glasi
> „listu ćeš naći u „Tvoji pristupi", na dnu ove strane"; reč „keš" se ne
> pominje, jer je interni pojam (pravilo 2).

## Pravila

1. **Prvo šta je korisnik dobio, pa novac.** Ne obrnuto, i nikad samo novac.
2. **Nula internih pojmova.** „Keš", „broj posla", „kombinacija nije upisana", `ref_id` — korisnik ne zna šta su i ne treba da zna.
3. **Nikad zadatak korisniku.** „Javi mi broj posla i vraćam ti ga" znači da sistem nije uradio svoj posao. Vraćanje je automatsko; poruka samo obaveštava.
4. **Nikad upozorenje na sopstveni bug.** „Ne pokreći ponovo, opet bi se naplatilo" se ne piše — kredit se vrati, pa se ponavljanje dozvoli.
5. **Kredite imenuj u brojevima**, ne „deo kredita" ili „razlika".

---

## Stanja i tekstovi

### A · Manje firmi nego što je naplaćeno (scenario 14)

> **Pronađeno 28 firmi u Brusu**
> Manji grad od očekivanog — naplaćena su 2 kredita, a 3 smo ti vratila.
> `[Vidi listu]`

Ako je vraćeno 0 kredita, drugi red se ne prikazuje uopšte. Ne piši „nije bilo povraćaja".

### B · Skeniranje prošlo, rezultati se nisu sačuvali

Ono što je sada poruka o kojoj pitaš. Treba:

> **Nešto je zastalo kod nas**
> Skeniranje je završeno, ali lista nije stigla do tebe. Vratili smo ti 1 kredit.
> `[Pokušaj ponovo]`

Bez broja posla, bez „keša", bez zabrane ponavljanja. Broj posla ide u log i u `admin_audit`, ne na ekran.

### C · Nijedna firma ne odgovara kriterijumima

> **Nema rezultata za advokate u Brusu**
> Nismo našli ni jednu firmu koja odgovara. Nije naplaćeno.
> `[Promeni pretragu]`

### D · Skeniranje u toku

> **Skeniram advokate u Brusu**
> Obično traje 20–40 sekundi. Možeš da zatvoriš stranicu — listu ćeš naći u „Tvoji pristupi", na dnu ove strane.

*(Ispravljeno 16. 9. 2026: ranije je pisalo „Moje pretrage" — takav ekran ne postoji.)*

### E · Skeniranje palo (Places API, timeout, bilo šta)

> **Skeniranje nije uspelo**
> Vratili smo ti 1 kredit. Ako se ponovi, piši nam na podrska@sajtoskop.com.
> `[Pokušaj ponovo]`

### F · Pristup pretrazi koju već imaš

> **Ovu listu već imaš**
> Otvaranje ne troši kredite.
> `[Vidi listu]`

---

## Prompt za Claude Code

```
Dva stanja skeniranja trenutno traže od korisnika da reši našu grešku. Tekst je
simptom; popravi ponašanje, pa onda tekst.

Trenutna poruka (naći je u kodu i ukloniti u celosti):
  "Skeniranje je završeno, ali lista nije dostupna — kombinacija nije upisana u
   keš. Kredit je potrošen. Javi mi broj posla 354 i vraćam ti ga; ne pokreći
   isto skeniranje ponovo, opet bi se naplatilo."

PONAŠANJE

1. Kad skeniranje završi a rezultat ne bude dostupan korisniku (upis u keš pao,
   prazan rezultat gde se očekivao neprazan, timeout posle naplate), kredit se
   vraća AUTOMATSKI, u istoj transakciji u kojoj se stanje posla obeleži kao
   neuspelo. Korisnik ne prijavljuje ništa.
   - ledger red: reason 'scan_refund', delta = +naplaćeno za taj posao,
     ref_id = 'scan_refund:<job_id>' (deterministički, da retry padne na
     unique indeks)
   - `search_access` red za tu kombinaciju se briše ili obeleži nevalidnim, da
     korisnik ne ostane sa „pristupom" bez liste
   - red u admin_audit sa job_id, kombinacijom i vraćenim iznosom

2. Ponavljanje iste pretrage posle takvog neuspeha je dozvoljeno i naplaćuje se
   normalno — kredit je već vraćen, pa nema duple naplate. Ukloni svaku logiku
   i tekst koji ponavljanje sprečava.

3. `job_id` nikad ne ide u tekst koji korisnik vidi. Ide u log, u admin_audit i
   u `details` jsonb ledger reda.

TEKSTOVI

Zameni sve tekstove stanja skeniranja verzijama iz docs/11-tekstovi-stanja-skeniranja.md
(stanja A–F). Drži ih u jednom modulu, ne razbacane po komponentama — očekujem
da ih menjam. Brojevi kredita i imena grada/delatnosti se ubacuju kao parametri,
ne sklapaju stringovima u JSX-u.

TESTOVI

- upis u keš padne posle naplate → ledger ima scan_refund sa +N, search_access
  nema valjan red, korisnik vidi stanje B
- isti job obrađen dvaput (retry) → jedan scan_refund red, ne dva
- ista pretraga pokrenuta ponovo posle povraćaja → naplaćuje se, prolazi, jedan
  scan red
- „Duboko" nad malim gradom (manje stranica od naplaćenog) → scan red −N i
  scan_refund +M, stanje A sa tačnim brojevima
- nula rezultata → nula naplate, stanje C

pnpm test, pnpm typecheck, pnpm check:sql.
```

---

## Za §3.6 plana testiranja

Scenario 14 se posle ovoga proverava tako:

```sql
select delta, reason, ref_id from credit_ledger
where user_id = '<clerk_id>' and reason like 'scan%'
order by ref_id desc limit 5;
```

Očekuješ dva reda: `scan · −N` i `scan_refund · +M`, sa `M < N`. Na ekranu stanje A sa istim brojevima. Ako se brojevi na ekranu i u ledgeru razlikuju, ekran računa iz nečeg drugog — to je bug, ne kozmetika.
