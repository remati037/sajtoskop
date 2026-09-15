"use client";

// apps/web/src/components/pristup-provider.tsx
// Modal koji objašnjava zašto je rad stao (LANSIRANJE §1.5).
//
// ── zašto provider, a ne `if` u komponenti ───────────────────
// Dva različita događaja traže isti prozor sa istim izlazom: pristup koji je
// istekao (zna se pri učitavanju strane) i krediti koji su nestali usred rada
// (zna se tek iz `402` odgovora, na dva mesta u `pretraga-ekran.tsx`). Bez
// jednog mesta koje odlučuje, korisnik bi za istu stvar dobio dva prozora — i
// dobijao bi ih iznova na svaki sledeći klik.
//
// ── pamćenje da je viđen, po uzoru na motor utisaka ──────────
// Isti princip kao u `utisci-provider.tsx`: prekid koji se ponavlja je gori od
// prekida. Razlika je u trajanju, i namerna:
//
//   istek pristupa  → `localStorage`, ključ nosi POTPIS stanja
//                     (`grace:2026-08-20T…`). Prozor se javi jednom po isteku;
//                     ako korisnik obnovi pa mu pristup ponovo istekne, potpis
//                     je drugi i prozor se javi opet.
//   nema kredita    → `sessionStorage`, dakle jednom po tabu. To je stanje
//                     novčanika koje se menja kupovinom — zapamtiti ga zauvek
//                     značilo bi da čovek koji sutra opet ostane bez kredita
//                     više nikad ne dobije objašnjenje.
//
// Zašto ne u bazi kao kod utisaka: tamo se pamti da isti čovek na drugom
// računaru ne bi dobio isto PITANJE dvaput, jer je cilj da se ne dosađuje.
// Ovde je poruka obaveštenje o stanju naloga, isto stanje stoji i u trajnom
// baneru iznad sadržaja, pa da se javi jednom i na drugom računaru nije šteta —
// a nova kolona u `profiles` bi bila migracija zbog jednog `boolean`-a.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Coins, Timer } from "lucide-react";
import { smeDaKupiPaket, type Pristup, type UzrokGrace } from "@sajtoskop/shared";
import { formatDatum } from "@/lib/ui-tekst";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const KLJUC_ISTEK = "sajtoskop-pristup-videno";
const KLJUC_KREDITI = "sajtoskop-krediti-videno";

export type PristupApi = {
  /** Stanje naloga sa poslednjeg punog učitavanja. `null` = nepoznato. */
  pristup: Pristup | null;
  /**
   * „Ponestalo je kredita usred rada" — zove se iz `402` grane, tamo gde se
   * odgovor servera ionako već čita. Modal se javi najviše jednom po tabu.
   */
  prijaviBezKredita: () => void;
};

const Ctx = createContext<PristupApi | null>(null);

/**
 * Van okvira aplikacije stanja pristupa prosto nema.
 *
 * Ne baca: ekran pretrage sme da se prikaže i van `(app)` okvira, i tamo je
 * ispravno da modala nema — a ne da strana pukne.
 */
export function usePristup(): PristupApi | null {
  return useContext(Ctx);
}

/** Potpis stanja — menja se kad se promeni datum isteka, ne pre toga. */
function potpis(pristup: Pristup): string {
  return `${pristup.stanje}:${pristup.punDo ?? "-"}`;
}

function procitaj(skladiste: Storage, kljuc: string): string | null {
  try {
    return skladiste.getItem(kljuc);
  } catch {
    return null;
  }
}

function upisi(skladiste: Storage, kljuc: string, vrednost: string): void {
  try {
    skladiste.setItem(kljuc, vrednost);
  } catch {
    /* privatni prozor — prozor se prosto javi ponovo */
  }
}

type Razlog = "istek" | "krediti";

export function PristupProvider({
  pristup,
  uzrokGrace = null,
  children,
}: {
  pristup: Pristup | null;
  /** [posle S30] Zašto je nalog u grace-u — naslov modala po uzroku. */
  uzrokGrace?: UzrokGrace | null;
  children: React.ReactNode;
}) {
  const [razlog, setRazlog] = useState<Razlog | null>(null);

  // Istek se javlja iz efekta, ne iz prvog rendera: `localStorage` na serveru ne
  // postoji, pa bi provera u renderu ili pukla ili bljesnula pogrešnim stanjem.
  useEffect(() => {
    if (!pristup || pristup.stanje !== "grace") return;
    if (procitaj(window.localStorage, KLJUC_ISTEK) === potpis(pristup)) return;

    upisi(window.localStorage, KLJUC_ISTEK, potpis(pristup));
    setRazlog("istek");
  }, [pristup]);

  const prijaviBezKredita = useCallback(() => {
    if (procitaj(window.sessionStorage, KLJUC_KREDITI) === "da") return;
    upisi(window.sessionStorage, KLJUC_KREDITI, "da");
    setRazlog("krediti");
  }, []);

  const api = useMemo<PristupApi>(
    () => ({ pristup, prijaviBezKredita }),
    [pristup, prijaviBezKredita],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ModalPristupa
        razlog={razlog}
        pristup={pristup}
        uzrok={uzrokGrace}
        zatvori={() => setRazlog(null)}
      />
    </Ctx.Provider>
  );
}

/**
 * Objašnjenje i put dalje, uvek na `/cenovnik`.
 *
 * ── zašto ponekad dva dugmeta, a ponekad jedno ──────────────
 * Do 26.8. su ovde uvek stajala dva („uzmi plan" i „dokupi kredite"), jer je
 * paket bio ravnopravan izlaz. Od odluke tog dana paket traži aktivan plan ili
 * betu, pa drugo dugme sme da se pojavi SAMO onome ko sme i da ga iskoristi:
 *
 *   · nema kredita, a plan traje  → oba (dopuna je tačno ono što mu treba)
 *   · pristup istekao (`grace`)   → samo plan; paket bi vodio u odbijenicu
 *
 * Odluku donosi `smeDaKupiPaket()`, ista funkcija koju zove i checkout ruta.
 * Dugme koje vodi u `403` gore je od dugmeta kog nema.
 */
function ModalPristupa({
  razlog,
  pristup,
  uzrok,
  zatvori,
}: {
  razlog: Razlog | null;
  pristup: Pristup | null;
  uzrok: UzrokGrace | null;
  zatvori: () => void;
}) {
  if (razlog === null) return null;

  const jeIstek = razlog === "istek";
  // [posle S30] Nalog bez plana koji je potrošio kredite dobrodošlice nije
  // „izgubio pristup" — nikad ga nije ni kupio. Ono što se desilo je da kredita
  // nema, i to je rečenica koju čita.
  const bezKredita = !jeIstek || uzrok === "besplatni";
  const Ikona = bezKredita ? Coins : Timer;
  const smePaket = smeDaKupiPaket(pristup);

  return (
    <Dialog open onOpenChange={(otvoren) => !otvoren && zatvori()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ikona className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            {!jeIstek
              ? "Ostao si bez kredita"
              : uzrok === "besplatni"
                ? "Nemaš više kredita"
                : "Pristup ti je istekao"}
          </DialogTitle>
          <DialogDescription>
            {jeIstek
              ? "Nove pretrage, skeniranja i otključavanja ne rade."
              : "Skeniranje i otključavanje troše kredite."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-fg-muted">
          {jeIstek && pristup && pristup.stanje === "grace" ? (
            <p>
              Liste i prospekti koje si već otvorio ostaju ti do{" "}
              <span className="num">{formatDatum(pristup.citanjeDo)}</span> — zajedno sa porukama,
              pipeline-om i izvozom. Posle tog datuma ni to, ali se ništa ne briše.
            </p>
          ) : (
            <p>Sve što si već otključao ostaje ti i dalje, zajedno sa pipeline-om.</p>
          )}

          {jeIstek && uzrok === "besplatni" ? (
            <p>
              Za nove liste i otključavanja treba{" "}
              <strong className="font-semibold text-fg">plan</strong>.
            </p>
          ) : smePaket ? (
            <p>
              Dva puta dalje: <strong className="font-semibold text-fg">veći plan</strong>, ako ti
              se ovo ponavlja svakog meseca, ili{" "}
              <strong className="font-semibold text-fg">paket kredita</strong>, ako je ovaj mesec
              bio izuzetak. Krediti iz paketa ne ističu.
            </p>
          ) : (
            <p>
              Put dalje je <strong className="font-semibold text-fg">plan</strong>. Paketi kredita
              se kupuju samo uz aktivan plan, probu ili komp pristup — oni dopunjuju pristup, ne
              zamenjuju ga.
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
          {smePaket ? (
            <Button variant="ghost" asChild>
              <Link href="/cenovnik#paketi" onClick={zatvori}>
                Dokupi kredite
              </Link>
            </Button>
          ) : (
            // Obaveštenje, ne zid: čovek je možda upravo otvorio listu koju je
            // platio poslednjim kreditom i hoće da je gleda.
            <Button variant="ghost" onClick={zatvori}>
              U redu
            </Button>
          )}
          <Button variant="primary" asChild>
            <Link href="/cenovnik" onClick={zatvori}>
              {smePaket || uzrok === "besplatni" ? "Pogledaj planove" : "Uzmi plan"}
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
