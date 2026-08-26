// apps/web/src/app/uslovi/page.tsx
// Uslovi korišćenja. Obavezne klauzule su iz `docs/F8-landing.md` §3 i
// `docs/bezbednost-i-zastita.md` (Sloj 1 — „ono što ti omogućava da nekoga
// isključiš"); pravila naplate i životnog ciklusa iz `docs/LANSIRANJE.md`
// §1.3–§1.5.
//
// Strana stoji IZVAN grupe `(app)`: mora da je pročita i gost, a Paddle je
// traži za odobrenje naloga u produkciji (korak R21).
//
// ‼️ Tekst je iz šablona i NIJE pravno proveren. Sve što traži stvaran podatak
//    stoji kao `Popuniti` marker; korak R19 ih popunjava.

import type { Metadata } from "next";
import { KONTAKT_MEJL } from "@/components/futer";
import { Lista, Odeljak, Popuniti, PravniOkvir, TekstLink } from "@/components/pravni-okvir";

export const metadata: Metadata = {
  title: "Uslovi korišćenja",
  description:
    "Pod kojim uslovima se Sajtoskop koristi: nalog, krediti, naplata preko Paddle-a, " +
    "prestanak pristupa i šta nije dozvoljeno.",
};

export default function Page() {
  return (
    <PravniOkvir
      putanja="/uslovi"
      naslov="Uslovi korišćenja"
      uvod={
        <>
          Ovim uslovima se uređuje korišćenje Sajtoskopa — alata koji pronalazi biznise u
          Srbiji sa lošim ili nepostojećim sajtovima i priprema materijal za kontakt.
          Otvaranjem naloga prihvataš ove uslove.
        </>
      }
      azurirano={<Popuniti>datum objave ove verzije</Popuniti>}
    >
      <Odeljak broj={1} naslov="Ko pruža uslugu">
        <p>
          Sajtoskop pruža <Popuniti>pun pravni naziv i pravna forma, npr. „Remati, preduzetnik Marko Milenković"</Popuniti>
          , sa sedištem na adresi <Popuniti>adresa sedišta</Popuniti>, matični broj{" "}
          <Popuniti>matični broj</Popuniti>, PIB <Popuniti>PIB</Popuniti> (u daljem tekstu
          „mi" ili „Sajtoskop").
        </p>
        <p>
          Kontakt za sva pitanja u vezi sa uslugom i ovim uslovima:{" "}
          <TekstLink href={`mailto:${KONTAKT_MEJL}`}>{KONTAKT_MEJL}</TekstLink>.
        </p>
      </Odeljak>

      <Odeljak broj={2} naslov="Šta Sajtoskop radi">
        <p>
          Sajtoskop pretražuje javno dostupne podatke o biznisima u Srbiji, ocenjuje njihove
          sajtove i pravi listu prospekata sa kontaktom, opisom problema i pripremljenom
          porukom. Podaci o firmama dolaze sa Google Maps-a, preko zvaničnog Google Places
          API-ja, i sa javno dostupnih stranica samih firmi.
        </p>
        <p>
          Sajtoskop je alat za pripremu kontakta. <strong>Ne šalje poruke umesto tebe</strong> i
          ne ostvaruje kontakt sa firmama iz liste — to radiš ti, svojim kanalima i na svoju
          odgovornost (v. odeljak 7).
        </p>
      </Odeljak>

      <Odeljak broj={3} naslov="Nalog — jedan nalog, jedno lice">
        <Lista>
          <li>
            <strong>Jedan nalog pripada jednom licu.</strong> Pristupni podaci se ne dele, ne
            ustupaju i ne prodaju. Ako alat koristi više ljudi, svako od njih ima svoj nalog.
          </li>
          <li>
            Nalog nije prenosiv na drugo lice bez naše saglasnosti.
          </li>
          <li>
            Odgovoran si za čuvanje pristupnih podataka i za sve što se sa tvog naloga uradi.
            Ako posumnjaš da ti je nalog dostupan nekom drugom, javi nam odmah.
          </li>
          <li>
            Nalog otvara punoletno lice. Usluga nije namenjena maloletnicima.
          </li>
          <li>
            Podaci koje unosiš pri otvaranju naloga moraju biti tačni i ažurni.
          </li>
        </Lista>
      </Odeljak>

      <Odeljak broj={4} naslov="Krediti, planovi i naplata">
        <p>
          Korišćenje se plaća u kreditima. <strong>Jedan kredit</strong> je jedan otključan
          prospekt ili jedna stranica skeniranja (do <span className="num">20</span> rezultata).
          Pretraga po onome što je već skenirano ne troši kredite. Aktuelne cene planova i
          paketa stoje na <TekstLink href="/cenovnik">cenovniku</TekstLink>.
        </p>
        <p>
          <strong>Naplatu vodi Paddle.com Market Ltd. kao merchant of record.</strong> To znači
          da pravno kupuješ od Paddle-a, a ne od nas: Paddle je prodavac prema tebi, izdaje
          račun, obračunava i plaća porez i vodi sredstvo plaćanja. Podaci o tvojoj kartici ne
          stižu do nas ni u jednom trenutku. Na kupovinu se, pored ovih uslova, primenjuju i{" "}
          <TekstLink href="https://www.paddle.com/legal/checkout-buyer-terms">
            Paddle-ovi uslovi za kupce
          </TekstLink>
          .
        </p>
        <p>Kako se krediti ponašaju:</p>
        <Lista>
          <li>
            <strong>Krediti iz pretplate se ne prenose u sledeći mesec.</strong> Na dan obnove
            stanje se postavlja na mesečni iznos plana — neiskorišćeni krediti iz prethodnog
            meseca ne ostaju.
          </li>
          <li>
            <strong>Krediti iz paketa ne ističu.</strong> Stoje na nalogu dok ih ne potrošiš i
            preživljavaju mesečnu obnovu.
          </li>
          <li>
            Prvo se troše krediti iz pretplate, pa tek onda krediti iz paketa — dakle uvek prvo
            oni koji ističu.
          </li>
          <li>
            <strong>Paket kredita se kupuje samo uz aktivan plan ili betu.</strong> Paket je
            dopuna pristupu, ne zamena za plan.
          </li>
          <li>
            Krediti nemaju novčanu vrednost, ne isplaćuju se u novcu i ne prenose se na drugi
            nalog.
          </li>
          <li>
            Planovi imaju dnevne osigurače (broj skeniranja, broj redova u izvozu, broj AI
            varijanti poruke). Aktuelne vrednosti stoje na{" "}
            <TekstLink href="/cenovnik">cenovniku</TekstLink>.
          </li>
        </Lista>
        <p>
          Pretplata se obnavlja sama do otkazivanja. Otkazuješ je sam, kroz Paddle portal koji
          se otvara sa strane „Krediti" — bez mejla nama i bez objašnjenja. Otkazivanje važi od
          kraja plaćenog perioda; do tada pristup ostaje pun. Uslovi povraćaja su u{" "}
          <TekstLink href="/povracaj">Politici povraćaja</TekstLink>.
        </p>
      </Odeljak>

      <Odeljak broj={5} naslov="Šta biva kad pristup prestane">
        <p>
          Kad istekne plaćen period (ili beta), nalog{" "}
          <strong>
            još <span className="num">30</span> dana ostaje u režimu samo za čitanje
          </strong>
          : možeš da otvaraš prospekte koje si već otključao, da vidiš svoj pipeline i beleške i
          da <strong>izvezeš oba</strong> u CSV. Pretraga, skeniranje i otključavanje novih
          prospekata u tom periodu ne rade.
        </p>
        <p>
          Posle tih <span className="num">30</span> dana pristup nalogu prestaje i ulaz vodi na
          cenovnik. <strong>Ništa se ne briše.</strong> Otključani prospekti, pipeline, beleške
          i poruke stoje i vraćaju se u istom trenutku u kom nalog ponovo dobije pristup —
          planom ili betom. Podaci se brišu samo brisanjem naloga, na tvoj zahtev (v.{" "}
          <TekstLink href="/privatnost">Politiku privatnosti</TekstLink>).
        </p>
        <p>
          Rok od <span className="num">30</span> dana postoji da imaš vremena da izvučeš svoj
          rad. Ne produžava se sam i ne obnavlja se novim istekom.
        </p>
      </Odeljak>

      <Odeljak broj={6} naslov="Šta nije dozvoljeno">
        <p>Korišćenjem Sajtoskopa se obavezuješ da nećeš:</p>
        <Lista>
          <li>
            <strong>pristupati alatu automatizovano</strong> — skriptama, botovima, headless
            pregledačima, niti scrape-ovati sadržaj aplikacije ili njenih API ruta van
            predviđenog korisničkog interfejsa i izvoza;
          </li>
          <li>
            <strong>vršiti reverse engineering</strong>, dekompilaciju ili pokušavati da
            rekonstruišeš način na koji se računa Ugly Score, formira lista ili prave poruke;
          </li>
          <li>
            <strong>preprodavati, dalje distribuirati ili deliti pristup</strong> — ni nalog, ni
            podatke dobijene kroz njega, ni izvoze, u celini ili u delovima, uz naknadu ili bez
            nje;
          </li>
          <li>
            <strong>koristiti podatke ili uvide iz alata za izgradnju konkurentskog proizvoda</strong>
            , usluge ili baze;
          </li>
          <li>
            zaobilaziti ili pokušavati da zaobiđeš limite, brojače kredita, kapije pristupa ili
            bilo koju drugu tehničku meru;
          </li>
          <li>
            otvarati više naloga radi zaobilaženja limita ili cene, niti koristiti tuđi nalog;
          </li>
          <li>
            koristiti alat protivno propisima, uključujući propise o zaštiti podataka o
            ličnosti, oglašavanju i elektronskoj trgovini.
          </li>
        </Lista>
        <p>
          <strong>Baza sadrži kontrolne zapise.</strong> Deo zapisa u bazi postoji radi
          utvrđivanja porekla podataka i nije javno prepoznatljiv. Ako se ti zapisi pojave u
          drugom proizvodu, izvozu ili bazi, to je za nas dokaz kopiranja sa tragom do naloga sa
          kog je preuzeto.
        </p>
      </Odeljak>

      <Odeljak broj={7} naslov="Kako kontaktiraš prospekte — tvoja odgovornost">
        <p>
          <strong>
            Za način na koji kontaktiraš firme iz liste odgovaraš isključivo ti.
          </strong>{" "}
          Sajtoskop ti daje kontakt i predlog poruke; odluku o tome kome, kada i šta šalješ
          donosiš sam.
        </p>
        <Lista>
          <li>
            Pre slanja proveri da li imaš osnov za kontakt po propisima o zaštiti podataka o
            ličnosti, oglašavanju i elektronskoj trgovini.
          </li>
          <li>
            U svakoj poruci navedi ko si i omogući primaocu da traži da mu se više ne javljaš.
            Poštuj taj zahtev od prvog puta.
          </li>
          <li>
            Ne šalji masovne, ponovljene ili obmanjujuće poruke i ne predstavljaj se kao neko
            drugi.
          </li>
          <li>
            <strong>
              Kad podatke iz alata izvezeš i koristiš u svom radu, ti si za njih samostalan
              rukovalac
            </strong>{" "}
            u smislu propisa o zaštiti podataka o ličnosti — sa svim obavezama koje iz toga
            slede.
          </li>
        </Lista>
        <p>
          Za štetu i troškove koji nastanu iz tvog načina kontaktiranja, uključujući zahteve
          trećih lica i postupke nadležnih organa, odgovaraš ti.
        </p>
      </Odeljak>

      <Odeljak broj={8} naslov="Tačnost podataka i Ugly Score">
        <p>
          Podaci o firmama dolaze iz spoljnih izvora i mogu biti nepotpuni ili zastareli. Podaci
          preuzeti od Google-a osvežavaju se u ciklusu od <span className="num">30</span> dana;
          ocena sajta se radi u trenutku otključavanja prospekta.
        </p>
        <p>
          <strong>Ugly Score je automatska procena</strong>, ne stručno mišljenje o sajtu i ne
          ocena poslovanja firme. Isto važi i za listu problema koju alat generiše i za tekst
          poruka — to su predlozi koje pre upotrebe treba da pročitaš. Ne garantujemo tačnost,
          potpunost niti poslovni rezultat.
        </p>
      </Odeljak>

      <Odeljak broj={9} naslov="Dostupnost i izmene usluge">
        <p>
          Usluga se pruža „takva kakva jeste". Ne garantujemo neprekidan rad: moguća su
          održavanja, prekidi, greške i zavisnost od spoljnih servisa (Google, Paddle, provajder
          baze i hostinga).
        </p>
        <p>
          Alat se aktivno razvija, pa se funkcije mogu menjati, dodavati i uklanjati. O bitnim
          izmenama koje utiču na ono što plaćaš obaveštavamo unapred, mejlom ili u samoj
          aplikaciji. Ako uslugu ukinemo u celini, obavestićemo te unapred i pretplata se dalje
          ne naplaćuje.
        </p>
      </Odeljak>

      <Odeljak broj={10} naslov="Suspenzija i raskid">
        <p>
          Nalog možemo <strong>suspendovati ili ugasiti</strong> ako prekršiš ove uslove, a
          naročito odeljke 3 i 6 — deljenje pristupa, automatizovan pristup, preprodaja podataka
          i izgradnja konkurentskog proizvoda. Kad je moguće, prvo šaljemo upozorenje i rok da
          se kršenje otkloni; kod težih ili ponovljenih kršenja suspenzija je trenutna.
        </p>
        <p>
          <strong>Suspenzija zbog kršenja ne daje pravo na povraćaj</strong> plaćenog iznosa ni
          na naknadu za neiskorišćene kredite.
        </p>
        <p>
          Ti svoj nalog možeš da ugasiš u svakom trenutku — otkazivanjem pretplate i zahtevom za
          brisanje naloga (postupak je opisan u{" "}
          <TekstLink href="/privatnost">Politici privatnosti</TekstLink>).
        </p>
      </Odeljak>

      <Odeljak broj={11} naslov="Intelektualna svojina">
        <p>
          Softver, dizajn, tekstovi, način ocenjivanja sajtova, šabloni poruka i struktura baze
          su naša intelektualna svojina i zaštićeni su autorskim pravom. Pretplata ti daje{" "}
          <strong>pravo korišćenja alata</strong> za sopstvene poslovne potrebe — ne i prava na
          samom proizvodu.
        </p>
        <p>
          Podatke o firmama koje si otključao smeš da koristiš u svom radu, uključujući kontakt
          i izvoz. Ne smeš da ih preprodaješ, objavljuješ kao bazu niti ustupaš trećim licima
          kao proizvod.
        </p>
        <p>
          Naziv i znak „sajtoskop" su naša oznaka. <Popuniti>ako je žig registrovan kod ZIS-a, dopiši broj i klase; ako nije, ova rečenica ostaje bez broja</Popuniti>
        </p>
      </Odeljak>

      <Odeljak broj={12} naslov="Ograničenje odgovornosti">
        <p>
          Ne odgovaramo za izmaklu dobit, izgubljene poslove, izgubljene podatke niti za
          posrednu štetu koja nastane iz korišćenja ili nemogućnosti korišćenja alata.
        </p>
        <p>
          Naša ukupna odgovornost ograničena je na iznos koji si nam platio u{" "}
          <span className="num">12</span> meseci pre nastanka štete. Ovo ograničenje ne dira u
          odgovornost koja se po prinudnim propisima ne može isključiti.
        </p>
      </Odeljak>

      <Odeljak broj={13} naslov="Izmene ovih uslova">
        <p>
          Uslove možemo menjati. Nova verzija se objavljuje na ovoj strani, sa datumom poslednje
          izmene na vrhu. O bitnim izmenama obaveštavamo mejlom najmanje{" "}
          <span className="num">15</span> dana unapred. Ako nastaviš da koristiš alat posle
          stupanja izmena na snagu, smatra se da si ih prihvatio; ako ne pristaješ, možeš da
          otkažeš pretplatu pre nego što izmene počnu da važe.
        </p>
      </Odeljak>

      <Odeljak broj={14} naslov="Merodavno pravo i sporovi">
        <p>
          Na ove uslove primenjuje se pravo Republike Srbije. Sporove prvo pokušavamo da rešimo
          dogovorom — piši na{" "}
          <TekstLink href={`mailto:${KONTAKT_MEJL}`}>{KONTAKT_MEJL}</TekstLink>. Ako to ne
          uspe, nadležan je <Popuniti>nadležan sud — mesto, po sedištu ili po prebivalištu potrošača</Popuniti>
          .
        </p>
        <p>
          Ako se neka odredba ovih uslova pokaže kao ništava, ostale ostaju na snazi.
        </p>
        <p>
          <Popuniti>proveri sa knjigovođom ili pravnikom da li i kako se na ovu uslugu primenjuju propisi o zaštiti potrošača i o ugovoru na daljinu (pravo na odustanak od 14 dana za digitalne usluge) — v. i Politiku povraćaja</Popuniti>
        </p>
      </Odeljak>
    </PravniOkvir>
  );
}
