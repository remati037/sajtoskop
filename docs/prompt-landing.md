# Prompt za landing repo — veze ka aplikaciji i usklađena ponuda

> Koristi se u **landing repou** (`sajtoskop.com`), ne ovde. Kopira se ceo blok ispod u prazan
> prozor Claude Code-a. Stavka 5.1 u `docs/lansiranje-checklista.md`.
>
> Zatečeno na živom landingu 16. 9. 2026: krediti **100 / 300 / 800** (aplikacija daje
> 150 / 450 / 1.200), „Pretraga po kešu, neograničeno" (od S25 se pristup keširanoj listi
> plaća), sopstvene kopije `/uslovi` i `/privatnost`, a `/povracaj` i `/bot` vraćaju 404.
> Izvor istine za brojeve je `packages/shared/src/plans.ts` u repou aplikacije; spec veza je
> `docs/tok-i-onboarding.md` §3.

```
Radimo veze sa landinga ka aplikaciji i usklađujemo ponudu sa aplikacijom. Landing je
ovaj repo (sajtoskop.com, kanonski https://www.sajtoskop.com). Aplikacija je ODVOJEN
repo na https://app.sajtoskop.com — nju ne diraš i ne tražiš u ovom repou.

UI je srpski, latinica, sa dijakritikom. Kod i commit poruke na engleskom.
Terminologija: prospekt (ne lead), otključaj, skeniranje, krediti, proba (ne trial),
pozivnica. Reč „beta" ne sme da postoji u javnoj kopiji.

0. JEDNA KONSTANTA ZA DOMEN APLIKACIJE
   Sve adrese aplikacije idu iz jedne konstante (npr. u lib/site.ts):
     appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.sajtoskop.com"
   Nijedan zakucan "app.sajtoskop.com" po komponentama.

1. CTA KA KUPOVINI — glavni deo
   Svako dugme za kupovinu vodi na cenovnik u aplikaciji, sa izborom u query stringu:
     ${appUrl}/cenovnik?plan=<plan>&ciklus=<ciklus>
   Dozvoljene vrednosti, i nikakve druge:
     plan   = starter | pro | advanced
     ciklus = mesecno | godisnje      (kartice cena prate prekidač mesečno/godišnje)
   Paketi kredita (jednokratno, samo uz aktivan plan):
     ${appUrl}/cenovnik?paket=75
     ${appUrl}/cenovnik?paket=200
     ${appUrl}/cenovnik#paketi        (samo skrol do sekcije)
   Generički CTA („Počni") bez izabranog plana: ${appUrl}/cenovnik?plan=pro&ciklus=mesecno
   Prijava postojećeg korisnika: ${appUrl}/

   ‼️ NIKAD Stripe ID (price_…, prod_…, kupon) u linku, data atributu ili bilo gde na
      landingu. Preslikavanje plana u cenu radi aplikacija.
   ‼️ NE zovi nijedan /api/* aplikacije sa landinga. Gosta aplikacija sama vodi kroz
      registraciju i vraća ga na isti izbor.
   Svi linkovi su obični <a href>, bez target="_blank".
   `signUpUrl` i sve što vodi na /sign-up se BRIŠE (ta strana ne postoji).

   Spisak mesta (proveri i dopuni ako nađeš još):
   - zaglavlje desktop: glavni CTA → generički CTA; NOVO: ghost link „Prijava" → ${appUrl}/
   - mobilni meni: glavni CTA; NOVO: „Već imaš nalog? Prijavi se" → ${appUrl}/
   - hero i završni CTA → generički CTA
   - kartice cena: „Uzmi Starter / Pro / Advanced" → plan + ciklus po prekidaču
   - ispod kartica cena, NOVO: red o paketima „Dopuna 75 kredita €19 · 200 kredita €49
     (samo uz plan)" → ${appUrl}/cenovnik#paketi
   - futer: NOVO link „Prijava u aplikaciju" → ${appUrl}/

2. BROJEVI I TVRDNJE — moraju da se poklope sa aplikacijom
   Starter   €29 mesečno · €290 godišnje · 150 kredita mesečno
   Pro       €59 mesečno · €590 godišnje · 450 kredita mesečno
   Advanced  €119 mesečno · €1.190 godišnje · 1.200 kredita mesečno
   Godišnje = 2 meseca gratis.
   Dopuna 75 = €19, Dopuna 200 = €49; jednokratno, krediti ne ističu, kupuje se samo uz
   aktivan plan ili probu.
   Proba: 7 dana, 10 kredita, kartica se unosi unapred, prva naplata osmog dana; otkaz pre
   toga ne košta ništa.
   Krediti: skeniranje 1 / 2 / 3 kredita za do 20 / 40 / 60 firmi; otvaranje liste koja
   je već u bazi košta isto i važi 30 dana; otključavanje prospekta 1 kredit.
   „Ako nađemo manje firmi nego što si tražio, razliku vraćamo."

   Uradi: nađi SVAKO mesto sa brojem kredita, cenom, „besplatno", „neograničeno",
   „pretraga po kešu", „beta", „bez kartice" (hero, kartice cena, FAQ, meta opis, OG
   slika, JSON-LD). Brojeve kredita i cene ispravi sam. Rečenice koje tvrde nešto
   netačno — npr. „Pretraga po kešu, neograničeno" — NE prepravljaj sam: daj mi spisak
   (fajl, linija, tačan tekst, predlog zamene) i čekaj potvrdu. To je prodajni tekst.

3. PRAVNE STRANE — izvor istine je aplikacija
   - Svi linkovi na Uslove, Privatnost i Povraćaj vode na ${appUrl}/uslovi,
     ${appUrl}/privatnost i ${appUrl}/povracaj.
   - Postojeće strane /uslovi i /privatnost na landingu → trajna redirekcija 308 na iste
     putanje u aplikaciji (next.config redirects()). Dodaj i /povracaj → 308.
     Obriši stare komponente pravnih strana i izbaci ih iz sitemap-a.
   - U futer dodaj „Politika povraćaja".
   - Pre izmene pročitaj sva tri teksta na app poddomenu i javi mi ako landing negde
     tvrdi nešto suprotno.

4. STRANA /bot — NOVA, statična, na landingu
   Worker aplikacije šalje User-Agent „Sajtoskop/1.0 (+https://sajtoskop.com/bot)", a goli
   domen preusmerava na www — zato strana mora da postoji OVDE. robots.ts je pušta,
   sitemap.ts je dodaje, futer je linkuje („Sajtoskop bot"). Tekst doslovno:

   Sajtoskop bot
   Ako si ovde iz logova svog servera: zahtev sa User-Agentom
   „Sajtoskop/1.0 (+https://sajtoskop.com/bot)" je došao od Sajtoskopa, alata koji ocenjuje
   kako sajtovi malih firmi u Srbiji rade na telefonu.
   Šta radi. Otvori početnu stranu, pročita HTML i napravi snimak ekrana kao što bi ga video
   posetilac. Ne prijavljuje se, ne šalje forme, ne prati linkove dublje od početne strane.
   Koliko često. Najviše jedan zahtev u sekundi po domenu, najviše nekoliko puta u 30 dana
   po sajtu.
   Šta poštuje. robots.txt — Disallow za „Sajtoskop" ili za „*" znači da sajt ne otvaramo.
   Ako nas već blokiraš, ne moraš ništa više da radiš.
   Kako da nas blokiraš. U robots.txt:
     User-agent: Sajtoskop
     Disallow: /
   Promena se primenjuje pri sledećem obilasku, najkasnije za 30 dana. Za hitno uklanjanje
   piši na podrska@sajtoskop.com sa domenom — brišemo snimak i skor istog dana.
   Šta čuvamo. Javne podatke sa Google Mapsa (naziv, adresa, telefon, sajt) do 30 dana, i
   ocenu sajta koju je bot sam napravio. Detalji su u Politici privatnosti (link na
   ${appUrl}/privatnost).

5. KONTAKT I OSTALO
   - Kontakt mejl svuda: podrska@sajtoskop.com (ne gmail).
   - sitemap.xml i canonical na www oblik.
   - Ako postoji NEXT_PUBLIC_CTA_MODE=waitlist, prebaci podrazumevano na signup; waitlist
     forma ostaje samo u sekciji regiona (HR/BA/ME/MK), ako postoji.
   - Rečenica „Nova beta prijava" u mejlu waitlist forme → bez reči „beta".

6. PROVERE NA KRAJU
   - grep "price_\|prod_\|sign-up\|beta" vraća 0 pogodaka u izvornom kodu i kopiji
   - nijedan link ka aplikaciji nije relativan
   - svaki CTA nosi tačno jedan par plan+ciklus, ili paket, ili ništa
   - lint i build prolaze
   - daj mi tabelu svih linkova ka aplikaciji: tekst dugmeta · fajl · URL
   - daj mi spisak iz tačke 2 (tvrdnje koje čekaju moju potvrdu)
```

## Posle sesije

1. Odobri ili prepravi spisak tvrdnji iz tačke 2, pa neka sesija primeni.
2. Deploy landinga.
3. Provere iz stavke 5.1 checkliste (`curl` na `/uslovi`, `/povracaj`, `/bot` i CTA-ove).
4. Stavka 5.2 — brojevi naspram `plans.ts`.
