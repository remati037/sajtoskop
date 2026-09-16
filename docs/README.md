# Dokumentacija — šta je gde

| Fajl | Šta je | Kad se otvara |
|---|---|---|
| `proizvod-i-arhitektura.md` | proizvod, dva domena, arhitektura, planovi i krediti, stanja pristupa, model podataka | pre svakog rada |
| `lansiranje-checklista.md` (+ `.pdf`) | šta je ostalo do lansiranja, korak po korak | pitanje „šta je još ostalo" |
| `plan-testiranja.md` (+ `.pdf`) | svi ručni prolazi pred lansiranje, sa SQL-om i zapisnikom | sekcija 3 checkliste |
| `roadmap.md` (+ `.pdf`) | sav preostali razvoj po horizontima, plan mejlova, sistem utisaka i javna tabla | pitanje „šta dalje posle lansiranja" |
| `dnevnik-isporuka.md` | šta je isporučeno po sesijama i odluke koje i danas važe | posle svake isporuke se dopisuje |
| `dizajn-sistem.md` | boje, tipografija, komponente, motion | pre bilo kakvog UI rada |
| `bezbednost.md` | P0/P1 mere i stanje svake | kad rad dodiruje kredite, storage ili renderovanje sajtova |
| `naplata-stripe.md` | Stripe: katalog, checkout, webhook, proba, portal, pozivnice, ekonomija kredita | kad rad dodiruje naplatu |
| `tok-i-onboarding.md` | tok od landinga do prve poruke, onboarding, utisci, kartica prospekta — doslovni tekstovi | kad rad dodiruje te ekrane |
| `worker-hetzner.md` | server za worker: postavljanje, deploy, svakodnevni rad | deploy workera |
| `postavljanje-servisa.md` | Supabase, Clerk i Vercel od nule | novo okruženje |
| `prompt-landing.md` | gotov prompt za landing repo (veze, brojevi, `/bot`) | stavka 5.1 checkliste |

**PDF-ovi** se prave iz markdown-a: `pnpm docs:pdf` (posle svake izmene checkliste, plana
testiranja ili roadmap-a).

**Pravila održavanja**
- Jedan izvor po temi. Kad se činjenica promeni, menja se u fajlu kome pripada, u istom commitu
  kao i kod — ne dopisuje se „ispravka" na vrh starog teksta.
- Isporučeni planovi i izvršeni promptovi se ne čuvaju ovde; trag je u `dnevnik-isporuka.md`,
  a pun tekst u git istoriji.
- Ručni koraci koje sesija ostavi idu u `lansiranje-checklista.md`, ne u dnevnik.
