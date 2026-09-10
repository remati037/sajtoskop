// apps/web/src/app/(app)/layout.tsx
// Okvir zaštićenog dela aplikacije: pretraga, lista, pipeline, krediti,
// kontrolna tabla.
//
// Grupa `(app)` ne menja nijedan URL — `/dashboard` je i dalje `/dashboard`.
// Postoji zbog zajedničkog okvira i zbog toga što rezervni put za kreiranje
// profila sada stoji na jednom mestu, a ne u svakoj stranici posebno.
//
// VAŽNO: ovaj layout NIJE zaštita. Layout se ne izvršava ponovo pri klijentskoj
// navigaciji između sestrinskih ruta, pa svaka stranica ispod i dalje zove
// `requireSession()` kao prvu liniju (vidi `src/lib/auth.ts`).
//
// Od redizajna je navigacija bočna traka, a ne header. Razlog nije moda: pet
// ekrana, balans kredita, prekidač teme i meni naloga u jednoj traci od 56 px
// nisu stali bez skupljanja svega na ikonice. Sidebar usput drži i kontekst —
// uvek se vidi gde si u toku rada, a `pipeline` dobija punu širinu ekrana.

import { after } from "next/server";
import { redirect } from "next/navigation";
import { planFor } from "@sajtoskop/shared";
import { currentUser } from "@clerk/nextjs/server";
import { jeAdminIzProfila } from "@/lib/admin";
import { requireSession } from "@/lib/auth";
import { trebaPodsetnik } from "@/lib/feedback";
import { citajProfil, ensureProfile, zabeleziDolazak } from "@/lib/profile";
import { aktivacijaZa, citajPretplatuZaEkran } from "@/lib/pretplata";
import { citajPretplatu, pristupZaProfil, PUTANJA_ZAKLJUCANO } from "@/lib/pristup";
import { OkvirAplikacije } from "@/components/okvir-aplikacije";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireSession();

  /**
   * Ovaj layout ne sme da padne ni na jednoj grešci.
   *
   * Stoji iznad svake strane u `(app)`, pa jedan izuzetak ovde znači da korisnik
   * ne vidi ni navigaciju, ni temu, ni objašnjenje — samo Next-ov crveni ekran.
   * A kvar koji ga izaziva (pokvarena Clerk↔Supabase veza) ima jasno ime i jasno
   * rešenje, pa je jedino ispravno da aplikacija ostane na nogama i da ga ispiše.
   */
  let { profile, greska } = await citajProfil();

  // Webhook ne stiže do localhost-a bez tunela; RPC je idempotentan.
  // Ide kroz admin klijent, dakle radi i kad je korisnikov token pokvaren —
  // zato se pokušava i posle greške u čitanju.
  if (!profile) {
    try {
      const user = await currentUser();
      await ensureProfile(userId, user?.primaryEmailAddress?.emailAddress ?? null);
      ({ profile, greska } = await citajProfil());
    } catch (err) {
      console.error("[layout] kreiranje profila nije uspelo:", err);
      greska ??= err instanceof Error ? err.message : String(err);
    }
  }

  // S19: stanje pristupa se računa OVDE, iz profila koji je gore ionako
  // pročitan, i odatle ide baneru i modalu. Kroz `citajPristup()` bi profil bio
  // pročitan drugi put — i u rezervnom putu iznad bi vratio memoizovan `null`,
  // dakle stanje od pre kreiranja profila.
  //
  // `citajPretplatu()` je `cache()`-ovan, pa ga stranica ispod deli sa layoutom:
  // ceo `(app)` zahtev ima jedan upit nad `subscriptions`, ne dva.
  const pretplata = await citajPretplatu(userId);
  const pristup = pristupZaProfil(profile, pretplata);

  // Kapija na ulazu. NIJE jedina — layout se ne izvršava ponovo pri klijentskoj
  // navigaciji, pa svaka strana ispod zove `zahtevajCitanje()` sama (pravilo
  // „kapija ide uz podatak"). Ovde stoji da zaključan nalog ne bi ni video
  // okvir aplikacije pre nego što ga strana preusmeri.
  if (pristup && !pristup.cita) redirect(PUTANJA_ZAKLJUCANO);

  const plan = planFor(profile?.plan);

  // S21: ZBIR obe kase, isto kao na `/pretraga` i u `/api/search`.
  const ukupnoKredita = profile ? profile.credits_balance + profile.credits_topup : null;

  // S26 (§7.4): proba bez ijednog kredita dobija traku sa „Aktiviraj odmah".
  // Iznos i plan traže `lookup_key`, koji kapija (`citajPretplatu`) namerno ne
  // nosi — pa drugi čitač, ali SAMO u ovom retkom slučaju. Svaki drugi zahtev
  // kroz `(app)` ostaje na jednom upitu nad `subscriptions`. `/krediti` deli
  // isti `cache()`-ovan poziv, pa ni tamo nije drugi upit.
  const aktivacijaProbe =
    pristup?.stanje === "proba" && ukupnoKredita === 0
      ? aktivacijaZa(await citajPretplatuZaEkran(userId))
      : null;
  // Otkazana PROBA je `otkazan` (§7.1), ali traka je zove njenim imenom.
  const probaOtkazana = pristup?.stanje === "otkazan" && pretplata?.status === "trialing";

  // [Faza 3, 3.6] Stanje motora utisaka se odavde više NE čita — layout je
  // čekao na feedback upite pre prvog bajta (P4). `UtisciProvider` ga povlači
  // klijentski, sa `/api/utisci/stanje`, posle prvog prikaza. Isti broj upita,
  // samo posle prvog bajta; odluke motora su svejedno izvor istine (pravila iz
  // kataloga važe i u pregledaču i na serveru).

  // F12 §3.1: „Poslednji put" u admin listi, i dužina pauze za `zasto-ne-vracas`.
  //
  // Kroz `after()`, dakle posle odgovora, i najviše jednom na sat — bez toga bi
  // svako učitavanje strane bilo jedan upis. Redosled je i uslov ispravnosti:
  // `citajUslove()` iznad čita PRETHODNI dolazak, a ovaj upis postavlja tekući.
  // Obrnuto bi značilo da je pauza uvek nula i da se to pitanje nikad ne javi.
  after(async () => {
    await zabeleziDolazak(userId, profile?.last_seen_at ?? null);
  });

  return (
    // Balans je uvek vidljiv (F4 §4) i vodi na izvod iz knjige. Broj se osvežava
    // kroz `router.refresh()` posle svakog otključavanja — ovaj layout je server
    // komponenta i sam od sebe ne zna za klik.
    <OkvirAplikacije
      // S21: ZBIR obe kase (izračunat gore). Do S21 je ovde stajao samo
      // `credits_balance`, pa je nalog sa kupljenim paketom u bočnoj traci
      // video manji broj nego što mu se stvarno naplaćuje.
      krediti={ukupnoKredita}
      mesecniKrediti={plan.monthlyCredits}
      greska={greska}
      // F10 §4.4: podsetnik posle tri dana. Izvedeno iz profila koji je već
      // pročitan — nijedan dodatan upit po učitavanju strane.
      traziUtisak={trebaPodsetnik(profile, plan.monthlyCredits)}
      // F11 §3: stanje motora pitanja. Od Faze 3 (3.6) `null` — provider ga
      // povlači klijentski posle prvog prikaza.
      stanjeUtisaka={null}
      usloviUtisaka={null}
      // F12: ulaz u konzolu iz aplikacije. Bez ovoga se `/admin` otvara samo
      // ručnim kucanjem adrese — što je bila zaštita ni od koga, jer strana
      // ionako svakog neadmina dočeka sa `404`.
      //
      // Izvedeno iz profila koji je gore već pročitan, pa je cena nula upita.
      // Ovo NIJE zaštita: link koji se ne prikaže ne štiti ništa. Zaštita je
      // `requireAdminPage()` na svakoj strani konzole (pravilo 13).
      admin={jeAdminIzProfila(userId, profile?.role)}
      // F11.4: tačka na plutajućem dugmetu kad postoji rešena prijava koju
      // korisnik nije pogledao. Isti profil koji je već pročitan — nijedan
      // dodatan upit (F11 §3.3).
      neprocitano={profile?.feedback_unseen_count ?? 0}
      // S19 §1.5: trajan baner (grace, otkazana pretplata) i modal koji vodi na
      // cenovnik. Isto `stanjePristupa()` koje kapije koriste — ni ovde nema
      // druge računice.
      pristup={pristup}
      aktivacijaProbe={aktivacijaProbe}
      probaOtkazana={probaOtkazana}
    >
      {children}
    </OkvirAplikacije>
  );
}
