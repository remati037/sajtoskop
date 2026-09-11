// apps/web/src/lib/otkazivanje.ts
// Otkazivanje ŽIVIH pretplata pri brisanju naloga (S28, C6).
//
// ── zašto ovo postoji ───────────────────────────────────────
// Do S28 je `user.deleted` iz Clerk-a brisao profil i sve što za njim ide
// (pravilo 15), a Stripe o tome nije znao ništa. Posledica nije kozmetička:
// pretplata ostaje `active` i nastavlja da NAPLAĆUJE karticu naloga koji u
// aplikaciji više ne postoji. Sledeća `invoice.paid` onda stigne za korisnika
// koga `nadjiKorisnika()` ne nalazi — dakle novac je uzet, kredita nema, i
// jedini trag je red u `billing_events`.
//
// ── zašto PRE brisanja, i zašto padom ka 500 ─────────────────
// Redosled je deo odluke: prvo Stripe, pa baza. Ako otkazivanje padne, profil
// se NE briše i ruta vraća 500 — Svix ponavlja isporuku, pa se brisanje desi
// tek kad je naplata stvarno zaustavljena. Obrnut redosled (obriši pa otkaži)
// ostavlja nalog bez profila i sa živom pretplatom čim mreža kihne, a to stanje
// se posle ne vidi nigde u aplikaciji jer korisnika više nema.
//
// ── zašto je Stripe klijent ULAZ, a ne import ───────────────
// Isti razlog kao `NaplataSkladiste` u `lib/billing.ts`: ovo je putanja koja
// zaustavlja naplatu i mora da se proverava testom, a test ne sme da zove
// Stripe. Klijent se zato prosleđuje; kad se izostavi, uzima se pravi
// (`stripe()` je lenj, pa uvoz ovog modula ne traži ključ).

import "server-only";
import { stripe } from "./stripe-server";

/**
 * Statusi koji se STVARNO otkazuju.
 *
 * Samo ova tri mogu da naplate karticu: `trialing` (naplatiće osmog dana),
 * `active` i `past_due` (Stripe još pokušava — Smart Retries). Sve ostalo
 * (`canceled`, `unpaid`, `incomplete*`, `paused`) je ili već mrtvo ili nikad
 * nije ni počelo, pa se ne dira: `subscriptions.cancel` nad već otkazanom
 * pretplatom vraća grešku, a ta greška bi kroz 500 zaustavila brisanje naloga
 * zauvek (Svix bi ponavljao, i svaki put isto).
 */
export const STATUSI_ZA_OTKAZIVANJE = ["trialing", "active", "past_due"] as const;

export type StatusZaOtkazivanje = (typeof STATUSI_ZA_OTKAZIVANJE)[number];

/**
 * Onaj deo Stripe klijenta koji ova putanja koristi. Namerno minimalan: test
 * daje tri funkcije, ne ceo SDK.
 */
export type StripeZaOtkazivanje = {
  subscriptions: {
    list(args: { customer: string; status: "all"; limit: number }): Promise<{
      data: { id: string; status: string }[];
    }>;
    cancel(id: string, args: { prorate: boolean }): Promise<{ id: string; status?: string }>;
  };
  customers: {
    update(id: string, args: { metadata: Record<string, string> }): Promise<{ id: string }>;
  };
};

export type IshodOtkazivanja = {
  /** ID-jevi pretplata koje su otkazane u ovom pozivu. */
  otkazane: string[];
  /** ID-jevi pretplata koje su preskočene jer već nisu mogle da naplate. */
  preskocene: string[];
};

/**
 * Otkaži sve žive pretplate kupca i obeleži kupca kao obrisanog.
 *
 * `prorate: false` je namerno: proporcionalni obračun bi pri otkazivanju
 * napravio kreditnu notu (ili poslednju fakturu) za nalog koji upravo prestaje
 * da postoji. Čovek koji briše nalog ne traži povraćaj za tri dana, nego da
 * naplata stane — a delimična faktura bi mu u istoj nedelji stigla na mejl koji
 * je obrisan iz naše baze.
 *
 * `status: "all"` + filter u kodu, a ne tri poziva po statusu: jedan zahtev
 * umesto tri, i spisak statusa ostaje na JEDNOM mestu
 * (`STATUSI_ZA_OTKAZIVANJE`), u kodu koji test čita.
 *
 * BACA na svaku grešku iz Stripe-a. Pozivalac (Clerk webhook) to pretvara u
 * 500, pa se brisanje profila ne dešava dok naplata nije zaustavljena.
 */
export async function otkaziPretplateNaloga(
  userId: string,
  customerId: string,
  klijent?: StripeZaOtkazivanje,
): Promise<IshodOtkazivanja> {
  const s = klijent ?? (stripe() as unknown as StripeZaOtkazivanje);

  const lista = await s.subscriptions.list({ customer: customerId, status: "all", limit: 100 });

  const zive = lista.data.filter((sub) =>
    (STATUSI_ZA_OTKAZIVANJE as readonly string[]).includes(sub.status),
  );
  const preskocene = lista.data.filter((sub) => !zive.includes(sub)).map((sub) => sub.id);

  const otkazane: string[] = [];
  for (const sub of zive) {
    await s.subscriptions.cancel(sub.id, { prorate: false });
    otkazane.push(sub.id);
  }

  // Marker na kupcu, POSLE otkazivanja: dok pretplata radi, „obrisan korisnik"
  // na kupcu je netačan podatak. Metadata se u Stripe-u spaja po ključevima, pa
  // `user_id` koji je checkout upisao ostaje — a on je jedini trag zbog koga se
  // ova naplata posle uopšte može rekonstruisati u podršci.
  await s.customers.update(customerId, {
    metadata: { deleted_user: "1", deleted_at: new Date().toISOString() },
  });

  return { otkazane, preskocene };
}
