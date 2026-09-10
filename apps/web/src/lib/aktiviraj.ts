// apps/web/src/lib/aktiviraj.ts
// „Aktiviraj odmah" — proba prelazi u plaćen plan danas, ne osmog dana
// (naplata-stripe.md §7.4, S26).
//
// ── zašto je odluka ovde, a ne u ruti ───────────────────────
// Ruta zna za Supabase i Stripe; ovaj fajl ne zna ni za jedno. Tako
// `test/aktiviraj.ts` proverava pravila (409 van probe, pretplata iz baze a ne
// iz tela, otkazana proba se ne aktivira) bez mreže i bez lažiranja SDK-a —
// zavisnosti su dve funkcije koje ruta prosleđuje.
//
// Bez `server-only` iz istog razloga: test ga uvozi van Next runtime-a. Tajni
// ključ ovde ne postoji, pa ga ni slučajan klijentski import ne bi odneo.
//
// ── granica koja se ne prelazi ──────────────────────────────
// ‼️ `subscriptionId` NIKAD ne dolazi spolja. Jedini ulaz je `userId` iz Clerk
//    sesije (pravilo 8); pretplata se nalazi u NAŠOJ tabeli po tom ID-ju. Ruta
//    koja bi primila ID pretplate iz tela bila bi ruta kojom neko skraćuje tuđu
//    probu i naplaćuje tuđu karticu.

export type PretplataZaAktivaciju = {
  subscriptionId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
};

/** Ishod Stripe poziva, preveden na ono što korisnik treba da zna. */
export type IshodStripea = "ok" | "nije_u_probi" | "kartica_odbijena";

export type ZavisnostiAktivacije = {
  /** Proba ovog korisnika iz `subscriptions`, po `user_id`. `null` = nema je. */
  citajProbu(userId: string): Promise<PretplataZaAktivaciju | null>;
  /** `subscriptions.update(id, { trial_end: "now", … })` nad Stripe-om. */
  zavrsiProbu(subscriptionId: string): Promise<IshodStripea>;
};

export type IshodAktivacije =
  | { ok: true; status: 200 }
  | { ok: false; status: 402 | 409; kod: "nije_u_probi" | "proba_otkazana" | "kartica_odbijena"; poruka: string };

const NIJE_U_PROBI: IshodAktivacije = {
  ok: false,
  status: 409,
  kod: "nije_u_probi",
  poruka: `Nisi u probi, pa nema šta da se aktivira. Stanje plana vidiš na strani „Krediti".`,
};

export async function aktivirajProbu(
  userId: string,
  z: ZavisnostiAktivacije,
): Promise<IshodAktivacije> {
  const proba = await z.citajProbu(userId);

  // Status se proverava i ovde, iako upit u ruti već filtrira `trialing`: ovo
  // je pravilo, a filter u upitu je optimizacija. Da neko sutra skine filter,
  // aktivna pretplata ne sme da dobije drugu fakturu u istom periodu.
  if (!proba || proba.status !== "trialing") return NIJE_U_PROBI;

  // Otkazana proba traje do kraja i ne naplaćuje se. „Aktiviraj odmah" nad
  // njom bi naplatio pun mesec pretplati koja se na kraju tog meseca gasi —
  // čovek bi platio period za koji je već rekao da ga ne želi.
  if (proba.cancelAtPeriodEnd) {
    return {
      ok: false,
      status: 409,
      kod: "proba_otkazana",
      poruka: `Proba je otkazana i traje do kraja bez naplate. Ako ipak želiš plan, obnovi pretplatu kroz „Upravljaj pretplatom".`,
    };
  }

  const ishod = await z.zavrsiProbu(proba.subscriptionId);

  if (ishod === "nije_u_probi") return NIJE_U_PROBI;
  if (ishod === "kartica_odbijena") {
    return {
      ok: false,
      status: 402,
      kod: "kartica_odbijena",
      poruka: `Kartica je odbijena, pa plan nije aktiviran. Proba traje dalje — karticu menjaš kroz „Upravljaj pretplatom".`,
    };
  }
  return { ok: true, status: 200 };
}
