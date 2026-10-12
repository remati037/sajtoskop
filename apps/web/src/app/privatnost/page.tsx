// apps/web/src/app/privatnost/page.tsx
// Politika privatnosti, po Zakonu o zaštiti podataka o ličnosti (ZZPL).
// Zahtevi iz F8 PRD §3 (git istorija) i `docs/bezbednost.md` (P1,
// „Zaštita ličnih podataka po ZZPL-u").
//
// ‼️ ODELJAK 6 OPISUJE POSTOJEĆI PUT BRISANJA, NE ŽELJENI. Brisanje ide kroz
//    Clerk (`users.deleteUser`), pa webhook `user.deleted`, pa kaskada nad
//    `profiles` — pravilo 15 iz CLAUDE.md. Ako se taj put ikad promeni, menja se
//    i ovaj tekst; politika koja opisuje proceduru koje nema je gora od politike
//    koje nema.
//
// ‼️ Tekst je iz šablona i NIJE pravno proveren. Markeri `Popuniti` se
//    popunjavaju po stavci 4.3 u docs/lansiranje-checklista.md.

import type { Metadata } from "next";
import { KONTAKT_MEJL } from "@/components/futer";
import { sellerName } from "@/lib/env";
import { Lista, Odeljak, Popuniti, PravniOkvir, TekstLink } from "@/components/pravni-okvir";

export const metadata: Metadata = {
  title: "Politika privatnosti",
  description:
    "Koje podatke Sajtoskop obrađuje, po kom osnovu, koliko dugo ih čuva, kome ih poverava " +
    "i kako se traži brisanje.",
};

export default function Page() {
  const prodavac = sellerName();
  return (
    <PravniOkvir
      putanja="/privatnost"
      naslov="Politika privatnosti"
      uvod={
        <>
          Ovde piše koje podatke Sajtoskop obrađuje, zašto, koliko dugo i kome ih poverava —
          i tvoje podatke kao korisnika i podatke o firmama koje se pojavljuju u alatu.
        </>
      }
      azurirano={<span className="num">12. oktobar 2026.</span>}
    >
      <Odeljak broj={1} naslov="Ko je rukovalac">
        <p>
          Rukovalac podacima je <strong>{prodavac}</strong>, društvo sa ograničenom
          odgovornošću iz države Wyoming, SAD, <Popuniti>registrovana adresa LLC-a</Popuniti>,
          registarski broj (Wyoming Filing ID) <Popuniti>Filing ID</Popuniti>, poreski broj
          (EIN) <Popuniti>EIN</Popuniti>.
        </p>
        <p>
          Kontakt za sva pitanja o obradi podataka i za ostvarivanje prava:{" "}
          <TekstLink href={`mailto:${KONTAKT_MEJL}`}>{KONTAKT_MEJL}</TekstLink>.
        </p>
        <p>
          Lice za zaštitu podataka o ličnosti nije određeno, jer obrada ne ispunjava uslove pod
          kojima je to obavezno. Pošto rukovalac nema sedište u Srbiji, njegov predstavnik u
          Republici Srbiji je Marko Milenković, <Popuniti>adresa predstavnika u Srbiji</Popuniti>
          ; njemu se možeš obratiti i preko iste adrese e-pošte.
        </p>
      </Odeljak>

      <Odeljak broj={2} naslov="Koje podatke obrađujemo">
        <p>
          <strong>Podaci o tvom nalogu.</strong> Adresa e-pošte i identifikator naloga koji
          dodeljuje Clerk, naš pružalac usluge prijave, kao i datum otvaranja naloga. Lozinku ne
          vidimo i ne čuvamo — nju drži Clerk. Ako se prijavljuješ preko drugog naloga (npr.
          Google), do nas stiže samo adresa e-pošte i identifikator.
        </p>
        <p>
          <strong>Podaci o korišćenju.</strong> Šta si pretraživao i skenirao, koje si prospekte
          otključao, promene statusa u pipeline-u, beleške i poruke koje si sačuvao, izvodi iz
          knjige kredita (svaka promena stanja sa razlogom), dnevni brojači skeniranja, izvoza i
          AI varijanti poruke.
        </p>
        <p>
          <strong>Podaci o naplati.</strong> Identifikator kupca i pretplate kod Stripe-a,
          naziv plana, status i datumi trajanja, i otisak kartice (anoniman identifikator koji
          Stripe daje istoj kartici) — samo da se probni period ne bi otvarao više puta istom
          karticom. <strong>Podaci o kartici ne stižu do nas</strong> — njih obrađuje Stripe
          (v. odeljak 8).
        </p>
        <p>
          <strong>Utisci.</strong> Odgovori koje sam pošalješ kroz ekran „Utisci", uključujući
          tekst i sliku koju priložiš, uz identifikator tvog naloga.
        </p>
        <p>
          <strong>Analitika korišćenja.</strong> Koje strane aplikacije otvaraš i koje radnje
          izvršiš (plaćena pretraga sa gradom i nišom, otključavanje, izvoz, promena statusa,
          početak i završetak kupovine, poslat utisak), uz identifikator tvog naloga, plan i
          stanje pristupa, vrstu pregledača i uređaja. Adresa e-pošte, ime i sadržaj tvojih
          beleški, poruka i utisaka se u analitiku ne šalju, kao ni bilo koji podatak o firmi
          koju gledaš. Analitika radi bez kolačića (v. odeljak 9), a IP adresa se ne čuva.
        </p>
        <p>
          <strong>Tehnički podaci.</strong> Zapisi o greškama i radu sistema, IP adresa uz
          administratorske radnje, i kolačić sesije (v. odeljak 9). Tehnički zapisi ne beleže
          pun kontakt firme iz baze.
        </p>
        <p>
          <strong>Podaci o firmama — i to su podaci o ličnosti.</strong> Alat čuva naziv firme,
          adresu, broj telefona, adresu e-pošte, adresu sajta, ocenu i broj ocena sa Google
          Maps-a, kao i rezultat automatske provere sajta i snimak ekrana sajta.{" "}
          <strong>
            Kod preduzetnika i malih firmi ti podaci se odnose na fizičko lice
          </strong>{" "}
          — poslovno ime često sadrži lično ime i prezime, a broj telefona i adresa e-pošte su
          po pravilu lični. Zato ih tretiramo kao podatke o ličnosti i ova politika se na njih
          primenjuje u celini. Izvor su Google Places API i javno dostupne stranice samih firmi.
        </p>
      </Odeljak>

      <Odeljak broj={3} naslov="Zašto ih obrađujemo i po kom osnovu">
        <Lista>
          <li>
            <strong>Da bismo pružili uslugu</strong> — otvaranje i vođenje naloga, pretraga,
            skeniranje, otključavanje, pipeline, izvoz, naplata i podrška.{" "}
            <em>Osnov: izvršenje ugovora</em> (ovi uslovi korišćenja).
          </li>
          <li>
            <strong>Podaci o firmama</strong> — da bi alat uopšte imao šta da pokaže: pronalaženje
            biznisa sa lošim ili nepostojećim sajtom i priprema kontakta.{" "}
            <em>Osnov: legitiman interes</em> — naš i interes korisnika da dođe do poslovnog
            kontakta, uz to što su podaci već javno dostupni i objavljeni radi kontakta.
          </li>
          <li>
            <strong>Bezbednost i sprečavanje zloupotrebe</strong> — brojači, limiti, revizija
            administratorskih radnji, kontrolni zapisi u bazi.{" "}
            <em>Osnov: legitiman interes.</em>
          </li>
          <li>
            <strong>Analitika korišćenja</strong>: da bismo videli koji delovi alata rade, gde
            ljudi zastaju i šta treba popraviti. <em>Osnov: legitiman interes.</em> Ovoj obradi
            možeš da prigovoriš u svakom trenutku, na adresu iz odeljka 1; tada tvoj nalog
            isključujemo iz analitike.
          </li>
          <li>
            <strong>Zakonske obaveze</strong> — knjigovodstvena i poreska dokumentacija.{" "}
            <em>Osnov: zakonska obaveza.</em>
          </li>
          <li>
            <strong>Utisci i poruke o razvoju alata</strong> — kad ih sam pošalješ ili se na njih
            prijaviš. <em>Osnov: pristanak</em>, koji možeš da povučeš u svakom trenutku.
          </li>
        </Lista>
        <p>
          Podatke ne prodajemo i ne ustupamo trećim licima radi njihovog marketinga.
        </p>
      </Odeljak>

      <Odeljak broj={4} naslov="Koliko dugo ih čuvamo">
        <Lista>
          <li>
            <strong>Podaci o nalogu i o korišćenju</strong> — dok nalog postoji. Brisanjem naloga
            se brišu (v. odeljak 6).
          </li>
          <li>
            <strong>Podaci o firmama</strong> — dok su deo baze prospekata. Podaci preuzeti od
            Google-a se osvežavaju u ciklusu od <span className="num">30</span> dana; stariji od
            toga se ne prikazuju dok se ne osveže.
          </li>
          <li>
            <strong>Knjigovodstvena i poreska dokumentacija</strong> —{" "}
            <span className="num">10</span> godina. Ovi
            zapisi ostaju i posle brisanja naloga jer se čuvaju po zakonu; originali računa su
            kod Stripe-a.
          </li>
          <li>
            <strong>Revizija administratorskih radnji</strong> — zapis o tome ko je i kada uradio
            radnju nad nalogom (uključujući brisanje) sadrži identifikator naloga i ostaje i
            posle brisanja, da bi trag o novcu i pristupu bio potpun. Rok čuvanja:{" "}
            <span className="num">10</span> godina, isto kao knjigovodstvena dokumentacija.
          </li>
          <li>
            <strong>Analitika korišćenja</strong>: najduže godinu dana, posle čega se zapisi
            automatski brišu. Zapisi su vezani za identifikator naloga, ne za adresu e-pošte;
            posle brisanja naloga taj identifikator više ne pokazuje ni na koga.
          </li>
          <li>
            <strong>Tehnički zapisi o greškama</strong> — najduže{" "}
            <span className="num">30</span> dana kod pružalaca hostinga i praćenja grešaka,
            posle čega se automatski brišu.
          </li>
        </Lista>
      </Odeljak>

      <Odeljak broj={5} naslov="Tvoja prava">
        <p>Kao lice na koje se podaci odnose, imaš pravo na:</p>
        <Lista>
          <li>pristup podacima i kopiju podataka koje o tebi obrađujemo;</li>
          <li>ispravku netačnih i dopunu nepotpunih podataka;</li>
          <li>brisanje podataka, pod uslovima iz zakona;</li>
          <li>ograničenje obrade;</li>
          <li>
            prenosivost podataka — u alatu izvoz svojih prospekata i pipeline-a u CSV radi i sam,
            bez zahteva;
          </li>
          <li>
            prigovor na obradu zasnovanu na legitimnom interesu, uključujući obradu podataka o
            firmama;
          </li>
          <li>opoziv pristanka, kad je obrada zasnovana na pristanku;</li>
          <li>pritužbu Povereniku (v. odeljak 13).</li>
        </Lista>
        <p>
          Zahtev šalji na{" "}
          <TekstLink href={`mailto:${KONTAKT_MEJL}`}>{KONTAKT_MEJL}</TekstLink>. Odgovaramo
          najkasnije u roku od <span className="num">30</span> dana od prijema zahteva. Ako
          zahtev traži više vremena, javljamo ti to u istom roku, sa razlogom.
        </p>
      </Odeljak>

      <Odeljak broj={6} naslov="Kako se briše nalog">
        <p>
          Zahtev za brisanje pošalji sa adrese e-pošte kojom si otvorio nalog, na{" "}
          <TekstLink href={`mailto:${KONTAKT_MEJL}`}>{KONTAKT_MEJL}</TekstLink>. Postupak je
          sledeći:
        </p>
        <Lista>
          <li>
            nalog se briše kod Clerk-a, našeg pružaoca usluge prijave — time prestaje svaka
            mogućnost prijave;
          </li>
          <li>
            Clerk nam šalje obaveštenje o brisanju, po kome se briše i tvoj profil u našoj bazi;
          </li>
          <li>
            brisanjem profila se <strong>istovremeno brišu</strong> i svi podaci vezani za njega:
            otključani prospekti, pipeline i beleške, sačuvane poruke, knjiga kredita, utisci i
            zapis o pretplati.
          </li>
        </Lista>
        <p>
          <strong>Šta ostaje i zašto:</strong> podaci o firmama ostaju u bazi, jer nisu tvoji
          podaci nego podaci o trećim licima koje alat i dalje obrađuje po odeljku 3. Ostaje i
          zapis u reviziji (odeljak 4) i knjigovodstvena dokumentacija koju smo dužni da čuvamo
          po zakonu. Ako si pre brisanja izvezao podatke, za njih od tog trenutka odgovaraš ti.
        </p>
        <p>
          Brisanje naloga <strong>ne otkazuje pretplatu samo po sebi</strong> — pretplatu otkaži
          pre toga, kroz portal na strani „Krediti".
        </p>
      </Odeljak>

      <Odeljak broj={7} naslov="Ako je tvoja firma u našoj bazi">
        <p>
          Ako si vlasnik ili preduzetnik čiji su podaci u alatu, imaš ista prava iz odeljka 5.
          Piši na <TekstLink href={`mailto:${KONTAKT_MEJL}`}>{KONTAKT_MEJL}</TekstLink> i navedi
          naziv firme i adresu sajta ili broj telefona iz Google Maps zapisa, da bismo zapis
          pouzdano našli.
        </p>
        <Lista>
          <li>
            Na zahtev brišemo zapis o firmi iz baze i sprečavamo njegovo ponovno preuzimanje.
          </li>
          <li>
            <strong>Ne možemo da utičemo na to šta o firmi piše na Google Maps-u</strong> — taj
            zapis se briše ili menja kod Google-a, jer je on izvor.
          </li>
          <li>
            Ako je neki korisnik podatke već izvezao pre brisanja, od tog trenutka je on
            samostalan rukovalac nad njima i zahtev se upućuje njemu. Na traženje ti javljamo šta
            možemo o tome da utvrdimo.
          </li>
        </Lista>
      </Odeljak>

      <Odeljak broj={8} naslov="Kome poveravamo podatke i prenos van Srbije">
        <p>
          Za rad alata koristimo pružaoce usluga koji podatke obrađuju po našem nalogu
          (obrađivači). <strong>Svi su strani</strong>, pa se podaci prenose van Republike
          Srbije:
        </p>
        <Lista>
          <li>
            <strong>Clerk</strong> (SAD) — prijava, identitet korisnika i adresa e-pošte.
          </li>
          <li>
            <strong>Supabase</strong> (EU, Frankfurt) — baza podataka i skladište snimaka ekrana, u kojima su
            svi podaci iz odeljka 2.
          </li>
          <li>
            <strong>Vercel</strong> (SAD; funkcije rade u Dablinu, Irska) — hosting veb
            aplikacije i tehnički zapisi.
          </li>
          <li>
            <strong>Hetzner</strong> (Nemačka, Nirnberg) — server koji radi skeniranje sajtova i pravi
            snimke ekrana.
          </li>
          <li>
            <strong>Google</strong> (Places API, PageSpeed Insights) — izvor podataka o firmama i
            merenje brzine njihovih sajtova.
          </li>
          <li>
            <strong>Anthropic</strong> (SAD) — analiza snimka ekrana sajta firme i pisanje
            predloga poruke. Tom servisu se šalju naziv firme, adresa sajta i snimak ekrana
            sajta; tvoji podaci o nalogu se ne šalju.
          </li>
          <li>
            <strong>Resend</strong> (SAD) — slanje mejlova (obaveštenja, pozivnice, odgovori na
            utiske).
          </li>
          <li>
            <strong>Sentry</strong> (EU, Nemačka) — zapisi o greškama na serveru, radi njihovog
            otklanjanja. Tvoji podaci o nalogu se ne šalju namerno; zapis može da sadrži
            identifikator naloga uz kog je greška nastala.
          </li>
          <li>
            <strong>PostHog</strong> (EU, Frankfurt): analitika korišćenja iz odeljka 2. Šalju
            se identifikator naloga, plan, stanje pristupa i zapisi o otvorenim stranama i
            radnjama; adresa e-pošte i podaci o firmama se ne šalju.
          </li>
        </Lista>
        <p>
          <strong>Stripe je poseban slučaj.</strong> On obrađuje plaćanje i podatke o kartici
          kao <strong>samostalan rukovalac</strong>, po svojoj politici privatnosti — ne po našem
          nalogu. Do nas iz te obrade stižu samo identifikator kupca, plan, status pretplate i
          otisak kartice.
        </p>
        <p>
          Baza, skladište, server za skeniranje, veb funkcije i analitika rade u Evropskoj uniji
          (Supabase i PostHog u Frankfurtu, Hetzner u Nirnbergu, Vercel funkcije u Dablinu). Clerk, Anthropic,
          Resend i Google obrađuju podatke i u SAD.
        </p>
        <p>
          Sa svakim obrađivačem je zaključen ugovor o obradi podataka. Prenos u države
          Evropske unije zasniva se na tome što su one na listi zemalja sa primerenim nivoom
          zaštite; prenos u SAD zasniva se na standardnim ugovornim klauzulama sadržanim u tim
          ugovorima.
        </p>
      </Odeljak>

      <Odeljak broj={9} naslov="Kolačići i lokalno skladište">
        <p>
          <strong>Ne koristimo reklamne kolačiće ni kolačiće za praćenje.</strong> Analitika
          korišćenja iz odeljka 2 radi bez kolačića i ne upisuje ništa u tvoj pregledač. U
          pregledaču postoje samo:
        </p>
        <Lista>
          <li>
            <strong>kolačić sesije</strong> koji postavlja Clerk — bez njega prijava ne radi;
          </li>
          <li>
            <strong>izbor teme</strong> (svetla ili tamna), zapisan lokalno u pregledaču pod
            ključem <span className="num">sajtoskop-tema</span>; ne šalje se nigde;
          </li>
          <li>
            <strong>kolačići koje postavlja Stripe</strong> na svojoj strani za plaćanje, po
            svojoj politici.
          </li>
        </Lista>
      </Odeljak>

      <Odeljak broj={10} naslov="Bezbednost">
        <p>
          Pristup bazi je zaključan na nivou same baze i ide isključivo kroz proverene serverske
          rute; zaključani podaci se u odgovoru servera <strong>uopšte ne šalju</strong>, umesto
          da budu sakriveni u pregledaču. Administratorske radnje se beleže. Ključevi i tajne se
          čuvaju van koda.
        </p>
        <p>
          Nijedna mera ne daje apsolutnu sigurnost. Ako dođe do povrede podataka koja može da
          izazove rizik za prava lica, postupamo po zakonu i obaveštavamo nadležni organ i
          pogođena lica.
        </p>
      </Odeljak>

      <Odeljak broj={11} naslov="Automatizovano odlučivanje">
        <p>
          Alat automatski ocenjuje sajtove (Ugly Score) i razvrstava ih po kvalitetu. To je
          procena kvaliteta veb sajta, a{" "}
          <strong>
            ne odluka koja proizvodi pravne posledice po firmu ili po tebe
          </strong>
          . Automatizovanog donošenja odluka o licima, uključujući profilisanje sa pravnim
          dejstvom, nema.
        </p>
      </Odeljak>

      <Odeljak broj={12} naslov="Izmene ove politike">
        <p>
          Politiku možemo menjati. Nova verzija se objavljuje na ovoj strani, sa datumom
          poslednje izmene na vrhu. O bitnim izmenama obaveštavamo mejlom ili u aplikaciji.
        </p>
      </Odeljak>

      <Odeljak broj={13} naslov="Kontakt i pritužba">
        <p>
          Za sva pitanja i zahteve:{" "}
          <TekstLink href={`mailto:${KONTAKT_MEJL}`}>{KONTAKT_MEJL}</TekstLink>.
        </p>
        <p>
          Ako smatraš da obrađujemo tvoje podatke suprotno propisima, imaš pravo na pritužbu{" "}
          <strong>
            Povereniku za informacije od javnog značaja i zaštitu podataka o ličnosti
          </strong>{" "}
          (<TekstLink href="https://www.poverenik.rs">poverenik.rs</TekstLink>).
        </p>
      </Odeljak>
    </PravniOkvir>
  );
}
