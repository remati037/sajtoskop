Radimo veze sa landinga ka aplikaciji. Landing je ovaj repo (sajtoskop.com,
kanonski www.sajtoskop.com). Aplikacija je ODVOJEN repo i živi na
app.sajtoskop.com — nju ne diraš i ne pokušavaj da je pronađeš u ovom repou.

Ceo UI je srpski, latinica, sa dijakritikom. Kod i commit poruke na engleskom.

Domen aplikacije stavi u jednu konstantu (npr. NEXT_PUBLIC_APP_URL, sa
"https://app.sajtoskop.com" kao podrazumevanom vrednošću) i koristi je svuda.
Nijedan `app.sajtoskop.com` zakucan po komponentama.

1. CTA KA CENOVNIKU — ovo je glavni deo

   Svako dugme koje vodi ka kupovini ide na cenovnik u aplikaciji, sa izborom
   plana u query stringu:

     https://app.sajtoskop.com/cenovnik?plan=<plan>&ciklus=<ciklus>

   Dozvoljene vrednosti, i nikakve druge:
     plan    = starter | pro | advanced
     ciklus  = mesecno | godisnje

   Za pakete kredita (jednokratna dopuna, ne pretplata):
     https://app.sajtoskop.com/cenovnik?paket=50    (Dopuna 50)
     https://app.sajtoskop.com/cenovnik?paket=150   (Dopuna 150)
     https://app.sajtoskop.com/cenovnik#paketi      (samo skrol do sekcije)

   ‼️ NIKAD ne stavljaj Paddle price ID (`pri_...`) u link, ni u data atribut, ni
      bilo gde na landing. Preslikavanje plana u price ID radi aplikacija. Da
      landing nosi te ID-jeve, prelazak sa sandboxa na produkciju tražio bi
      izmenu i ovde — na mestu gde se greška ne vidi dok neko ne plati.

   ‼️ NE zovi /api/billing/checkout sa landinga. Ta ruta traži prijavljenu
      sesiju i gostu vraća odbijenicu. Aplikacija sama vodi gosta kroz
      registraciju i vraća ga na isti izbor.

   Neutralan CTA (bez izabranog plana) ide na https://app.sajtoskop.com/cenovnik.
   Za „otvori nalog" bez cenovnika: https://app.sajtoskop.com/?nalog=nov

   Svi ovi linkovi su obični <a href>, bez target="_blank" — ovo je isti
   proizvod, ne spoljni sajt.

2. PRAVNE STRANE — ovde imamo duplikat koji treba rešiti

   Zatečeno stanje: ovaj landing ima SVOJE /uslovi i /privatnost, a aplikacija
   ima svoja tri teksta na app.sajtoskop.com/uslovi, /privatnost i /povracaj.
   To su dva izvora istine za isti dokument.

   Odluka: izvor istine su tekstovi u APLIKACIJI. Oni se menjaju zajedno sa
   kodom (dužina grace perioda, dve kase kredita, put brisanja naloga), pa
   kopija ovde zastari tiho.

   Uradi ovo:
   - svi linkovi u futeru i gde god se pominju vode na app.sajtoskop.com/uslovi,
     /privatnost i /povracaj
   - dodaj i /povracaj — na landingu ga danas UOPŠTE NEMA (vraća 404), a Paddle
     traži vidljivu politiku povraćaja za odobrenje naloga
   - postojeće strane /uslovi i /privatnost na landingu pretvori u trajnu
     redirekciju (308) ka istim putanjama na app poddomenu, da stari linkovi i
     eventualni indeksirani rezultati ne vode na zastareo tekst
   - reci mi da li si našao još neko mesto koje pominje uslove ili privatnost

   Pre nego što ovo uradiš, pročitaj sva tri teksta na app poddomenu i javi mi
   ako neki tvrdi nešto suprotno od onoga što piše na landingu.

3. KOPIJA KOJA VIŠE NIJE TAČNA — proveri i javi, ne prepravljaj sam

   Landing na dva mesta prodaje „Besplatnu betu". To više ne stoji:
   - naplata ide od prvog dana, kroz tri plana i dva paketa kredita
   - beta je RUČAN izuzetak koji ja otvaram iz admin konzole; ne nastaje
     registracijom i nije javna ponuda
   - nov nalog dobija jedno besplatno otključavanje, ne mesečne kredite

   Nađi svako mesto gde landing obećava besplatnu betu, besplatne kredite ili
   „bez kartice", pa mi napravi spisak: fajl, linija, tačan tekst i predlog
   zamene. NE menjaj kopiju dok ne potvrdim — to je prodajni tekst.

4. PROVERE NA KRAJU

   - nijedan link ka aplikaciji nije relativan (/uslovi bi ostao na landingu)
   - nigde ne postoji string "pri_"
   - svaki CTA nosi tačno jedan par plan+ciklus, ili nijedan
   - lint i build prolaze
   - daj mi spisak svih linkova ka app.sajtoskop.com koje si napravio, sa
     tekstom dugmeta uz svaki

Napomena o redosledu: preselekcija plana iz `?plan=` još NE radi u aplikaciji —
radi se u sesiji S24 tamo. Dotle svi ovi linkovi uredno otvaraju cenovnik, samo
bez unapred izabranog plana. Zato ih pravi sada u konačnom obliku; ništa se
posle ne menja.
