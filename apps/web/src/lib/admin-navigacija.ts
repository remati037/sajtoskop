// apps/web/src/lib/admin-navigacija.ts
// Spisak ekrana admin konzole — isti obrazac kao `navigacija.ts` za aplikaciju.
//
// Ovde stoji SAMO ono što stvarno postoji. Ekran iz naredne isporuke
// (`/admin/dnevnik` — F11.4) dopisuje se kad se napravi; stavka u meniju koja
// vodi na 404 je gora od stavke koje nema.

import {
  LayoutDashboard,
  MailPlus,
  MessageSquareHeart,
  Newspaper,
  ScrollText,
  Users,
} from "lucide-react";

export type AdminStavka = {
  href: string;
  label: string;
  Ikona: typeof Users;
  opis: string;
  /**
   * Stavka je aktivna samo na tačno toj adresi.
   *
   * Postoji zbog `/admin`: on je prefiks svake druge adrese u konzoli, pa bi bez
   * ovoga pregled bio osvetljen i dok gledam korisnike. Ostale stavke se i dalje
   * pale i na svojim podstranama — detalj korisnika mora da drži „Korisnike"
   * upaljene.
   */
  tacno?: boolean;
};

export const ADMIN_NAVIGACIJA: AdminStavka[] = [
  {
    href: "/admin",
    label: "Pregled",
    Ikona: LayoutDashboard,
    opis: "Budžet, red poslova, korisnici, krediti",
    tacno: true,
  },
  {
    href: "/admin/korisnici",
    label: "Korisnici",
    Ikona: Users,
    opis: "Ko je u beti, šta radi i koliko troši",
  },
  {
    href: "/admin/pozivnice",
    label: "Pozivnice",
    Ikona: MailPlus,
    opis: "Pozovi u betu ili otvori nalog odmah",
  },
  {
    href: "/admin/utisci",
    label: "Utisci",
    Ikona: MessageSquareHeart,
    opis: "Prijave iz bete, statusi i nagrade",
  },
  {
    href: "/admin/dnevnik",
    label: "Dnevnik",
    Ikona: Newspaper,
    opis: "Beta dnevnik — šta se promenilo i zašto",
  },
  {
    href: "/admin/revizija",
    label: "Revizija",
    Ikona: ScrollText,
    opis: "Dnevnik admin radnji",
  },
];

/** Jedno pravilo za bočnu traku, gornju traku i naslov — nikad tri. */
export function jeAktivna(stavka: AdminStavka, putanja: string): boolean {
  if (stavka.tacno) return putanja === stavka.href;
  return putanja === stavka.href || putanja.startsWith(`${stavka.href}/`);
}

/** Naslov za gornju traku. Najduži poklopljeni prefiks, da i detalj radi. */
export function adminNaslov(putanja: string): string {
  const pogodak = ADMIN_NAVIGACIJA.filter((s) => jeAktivna(s, putanja)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];

  return pogodak?.label ?? "Konzola";
}
