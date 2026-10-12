// apps/web/src/app/povracaj/page.tsx
// Politika povraćaja. Stripe je traži na javnoj strani (Settings → Business →
// Public details), a `docs/naplata-stripe.md` je zove nepregovarljivom pre
// prve prodaje.
//
// Odluka R17 (checklista 4.2 i 4.3, 29.9.2026): pretplata 14 dana i prag od
// 10 potrošenih kredita, iznad praga i posle roka nema povraćaja (ni
// srazmernog, ni za godišnju); paket 14 dana, samo netaknut.
//
// ‼️ Prag stoji pred potrošačem samo zato što kupac na checkout-u izričito
//    traži da isporuka počne odmah i potvrđuje gubitak prava na odustanak
//    (odeljak 9). Bez te saglasnosti u Stripe Checkout-u (checklista 4.3)
//    zakon je jači od ove politike.
//
// ‼️ Odeljak 5 mora da ostane: spor kod izdavaoca kartice (chargeback) rešava
//    Stripe i banka, ne mi — politika koja tvrdi suprotno laže kupca.
//
// [S25] Prodavac je LLC (odluka A4), ne merchant of record. Ime iz env-a.

import type { Metadata } from "next";
import { KONTAKT_MEJL } from "@/components/futer";
import { sellerName } from "@/lib/env";
import { Lista, Odeljak, PravniOkvir, TekstLink } from "@/components/pravni-okvir";

export const metadata: Metadata = {
  title: "Politika povraćaja",
  description:
    "Kada i pod kojim uslovima se novac vraća, šta biva sa već potrošenim kreditima i kako " +
    "se povraćaj traži.",
};

export default function Page() {
  const prodavac = sellerName();
  return (
    <PravniOkvir
      putanja="/povracaj"
      naslov="Politika povraćaja"
      uvod={
        <>
          Ovde piše kada se novac vraća, šta se dešava sa kreditima koji su u međuvremenu
          potrošeni i kako se povraćaj traži. Odnosi se i na pretplate i na pakete kredita.
        </>
      }
      azurirano={<span className="num">1. oktobar 2026.</span>}
    >
      <Odeljak broj={1} naslov="Ko vraća novac">
        <p>
          Prodavac je <strong>{prodavac}</strong>, a naplatu obrađuje Stripe. Novac se vraća na
          isti način na koji je i naplaćen — na sredstvo plaćanja sa kog je kupovina izvršena.
          Mi odobravamo zahtev, Stripe ga izvršava.
        </p>
        <p>
          Koliko će novac stvarno stići do tvog računa zavisi od banke i izdavaoca kartice —
          obično nekoliko radnih dana od odobrenja.
        </p>
      </Odeljak>

      <Odeljak broj={2} naslov="Pretplata">
        <Lista>
          <li>
            <strong>Pun povraćaj</strong> — ako zahtev pošalješ u roku od{" "}
            <span className="num">14</span> dana od naplate i ako je od te naplate potrošeno
            manje od <span className="num">10</span> kredita.
          </li>
          <li>
            <strong>Iznad tog praga</strong> nema povraćaja, ni u roku ni srazmerno — krediti su
            iskorišćeni na skeniranja i otključavanja koja su isporučena.
          </li>
          <li>
            <strong>Posle isteka roka</strong> nema povraćaja za tekući period. Otkazivanje i
            dalje radi u svakom trenutku i važi od kraja plaćenog perioda — do tada pristup
            ostaje pun.
          </li>
          <li>
            <strong>Godišnja pretplata</strong> — ista pravila: pun povraćaj u roku od{" "}
            <span className="num">14</span> dana od naplate, pod istim pragom. Posle toga nema
            srazmernog povraćaja za neiskorišćene mesece; otkazivanje važi od kraja plaćene
            godine.
          </li>
        </Lista>
        <p>
          Obnova pretplate se vidi na strani „Krediti" i na računu koji stiže mejlom. Ako ti se obnova desila a
          nisi je hteo, javi se — u tom slučaju gledamo koliko je kredita potrošeno posle obnove,
          a ne kada je zahtev stigao.
        </p>
      </Odeljak>

      <Odeljak broj={3} naslov="Paketi kredita">
        <p>
          Paket je jednokratna kupovina i njegovi krediti ne ističu, pa se vraća samo paket iz
          koga nije potrošen nijedan kredit:
        </p>
        <Lista>
          <li>
            <strong>Neiskorišćen paket</strong> — pun povraćaj, ako zahtev stigne u roku od{" "}
            <span className="num">14</span> dana od kupovine.
          </li>
          <li>
            <strong>Načet ili potrošen paket</strong> — bez povraćaja, ni za neiskorišćeni deo.
          </li>
        </Lista>
      </Odeljak>

      <Odeljak broj={4} naslov="Šta biva sa već potrošenim kreditima">
        <p>
          Povraćaj novca znači i <strong>povraćaj kredita</strong>: krediti dobijeni plaćanjem
          koje se vraća skidaju se sa naloga u istom trenutku.
        </p>
        <Lista>
          <li>
            Ako su ti krediti još na nalogu, prosto nestaju.
          </li>
          <li>
            Ako su već potrošeni, <strong>stanje kredita ide u minus</strong> za onoliko koliko
            nedostaje. Alat radi, ali skeniranje i otključavanje su zaključani dok stanje ne
            pređe nulu — dopunom ili prvom sledećom mesečnom dodelom, koja minus poništava.
          </li>
          <li>
            <strong>Prospekti koje si već otključao ostaju otključani.</strong> Vrednost tog
            otključavanja je isporučena i ne može da se vrati; zato se ono i računa u potrošene
            kredite.
          </li>
        </Lista>
      </Odeljak>

      <Odeljak broj={5} naslov="Spor kod banke (chargeback)">
        <p>
          <strong>
            Ako spor otvoriš kod svoje banke ili izdavaoca kartice, o njemu odlučuju banka i
            Stripe, po svojim pravilima i rokovima
          </strong>{" "}
          — i onda kada ova politika kaže drugačije. Na tu odluku ne možemo da utičemo.
        </p>
        <p>
          U tom slučaju važi isto pravilo o kreditima iz odeljka 4: krediti se skidaju sa naloga
          i kad su potrošeni.
        </p>
      </Odeljak>

      <Odeljak broj={6} naslov="Povraćaj ne otkazuje pretplatu">
        <p>
          Povraćaj i otkazivanje su dve različite stvari. Vraćen novac za jedan period{" "}
          <strong>ne zaustavlja narednu naplatu</strong> sam po sebi. Ako ne želiš dalje
          plaćanje, otkaži pretplatu kroz portal na strani „Krediti" — ili nam javi, pa
          ćemo to uraditi zajedno sa povraćajem.
        </p>
      </Odeljak>

      <Odeljak broj={7} naslov="Kada nema povraćaja">
        <Lista>
          <li>
            kad je nalog suspendovan ili ugašen zbog kršenja{" "}
            <TekstLink href="/uslovi">Uslova korišćenja</TekstLink> (odeljak 10 tih uslova);
          </li>
          <li>
            za kredite potrošene na skeniranje koje je vratilo malo rezultata — broj rezultata
            zavisi od toga šta Google ima za tu kombinaciju grada i niše, a cena skeniranja se
            zna unapred i pre potvrde;
          </li>
          <li>
            za nezadovoljstvo kvalitetom prospekata koji su uredno isporučeni; ako ti se lista
            ne čini korisnom, javi se pre nego što potrošiš kredite;
          </li>
          <li>za komp naloge i kredite dobijene bez plaćanja — tu ničega nema da se vrati.</li>
        </Lista>
        <p>
          Ako alat nije radio ili je isporučio pogrešan podatak zbog naše greške, kredit vraćamo
          bez pitanja i bez roka. To nije povraćaj po ovoj politici nego ispravka greške.
        </p>
      </Odeljak>

      <Odeljak broj={8} naslov="Kako se traži povraćaj">
        <p>
          Pošalji mejl na{" "}
          <TekstLink href={`mailto:${KONTAKT_MEJL}`}>{KONTAKT_MEJL}</TekstLink> sa adrese kojom
          si otvorio nalog i navedi broj računa iz mejla i razlog. Odgovaramo najkasnije u
          roku od <span className="num">5</span> radnih dana.
        </p>
        <p>
          Spor kod banke je drugi put, opisan u odeljku 5 — ali je sporiji i skuplji za obe
          strane; mejl nama je brži.
        </p>
      </Odeljak>

      <Odeljak broj={9} naslov="Zakonska prava">
        <p>
          Ova politika ne isključuje prava koja imaš po prinudnim propisima Republike Srbije.
        </p>
        <p>
          Ako si potrošač, ugovor zaključen na daljinu ti inače daje pravo da od njega odustaneš
          u roku od <span className="num">14</span> dana, bez navođenja razloga. Pri kupovini
          izričito tražiš da isporuka počne odmah i potvrđuješ da time gubiš to pravo — krediti
          stižu na nalog u istom trenutku. Umesto njega važi ova politika, sa istim rokom od{" "}
          <span className="num">14</span> dana.
        </p>
      </Odeljak>
    </PravniOkvir>
  );
}
