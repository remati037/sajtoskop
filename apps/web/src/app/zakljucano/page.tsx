// apps/web/src/app/zakljucano/page.tsx
// Gde stiže nalog kome je i grace period istekao (LANSIRANJE §1.5, tok-i-onboarding §2.4).
//
// Namerno stoji IZVAN grupe `(app)`: ta grupa je ono što je zaključano, pa bi
// strana o zaključavanju unutar nje bila petlja preusmeravanja. Okvir je isti
// kao na `/cenovnik` — logo, prekidač teme, ništa iz aplikacije.
//
// ‼️ Ovo NIJE `404` i nije prazan ekran, i to je odluka iz §1.5. Čovek koji je
//    do prošlog meseca plaćao mora da pročita ŠTA se desilo, ŠTA je ostalo i
//    ŠTA može da uradi. Prazan ekran na tom mestu je najbrži put do „ukrali ste
//    mi podatke" — a nije obrisano ništa.
//
// ── [S30] dve grane ─────────────────────────────────────────
//   · plaćen rok postoji (`punDo`) → pretplata ili komp je istekao, pa i grace;
//   · plaćenog roka nikad nije bilo → nalog je potrošio kredite dobrodošlice i
//     prošlo je 30 dana čitanja od registracije (O3): „Nalog čeka plan" (§1.12).

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";
import { citanjeDoZa } from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { citajPristup } from "@/lib/pristup";
import { adminSupabase } from "@/lib/supabase";
import { formatDatum } from "@/lib/ui-tekst";
import { LANDING_URL } from "@/lib/veze";
import { Button } from "@/components/ui/button";
import { PrekidacTemeDugme } from "@/components/prekidac-teme";
import { ZnakSaImenom } from "@/components/znak";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pristup je istekao",
  // Strana postoji za jednog ulogovanog čoveka; u pretraživaču nema šta da traži.
  robots: { index: false, follow: false },
};

/**
 * Kad je nalog potrošio poslednji kredit — poslednja stavka sa minusom u knjizi.
 * `null` kad se ne pročita; rečenica tada ide bez tog datuma.
 */
async function poslednjaPotrosnja(userId: string): Promise<string | null> {
  const { data, error } = await adminSupabase()
    .from("credit_ledger")
    .select("created_at")
    .eq("user_id", userId)
    .lt("delta", 0)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();

  if (error) {
    console.error("[zakljucano] poslednja potrošnja:", error.message);
    return null;
  }
  return data?.created_at ?? null;
}

export default async function Page() {
  const userId = await requireSession();

  const { pristup, profile } = await citajPristup();

  // Ko sme unutra, taj ovde nema šta da radi — uključujući i onoga ko je maločas
  // kupio plan. Bez ovoga bi strana ostala slepa ulica posle kupovine.
  //
  // `pristup === null` je nepoznato stanje (pokvarena veza sa bazom), i ono se
  // takođe pušta nazad: kvar veze ne sme da izgleda kao istekla pretplata.
  if (!pristup || pristup.cita) redirect("/pretraga");

  const cekaPlan = pristup.punDo === null;
  const potrosio = cekaPlan ? await poslednjaPotrosnja(userId) : null;
  // O3: bez plaćenog roka čitanje traje 30 dana od registracije.
  const rokCitanja = cekaPlan ? citanjeDoZa(profile?.created_at ?? null) : pristup.citanjeDo;

  return (
    <div className="relative min-h-screen">
      <div aria-hidden className="pozadina-aure pointer-events-none absolute inset-0 h-[32rem]" />

      <header className="relative mx-auto flex h-[68px] w-full max-w-[1160px] items-center justify-between px-5 sm:px-7 lg:px-8">
        {/* Do S24 je logo vodio na `/cenovnik` — jedini izlaz sa ove strane.
            Sada vodi na landing (§1.7); izlaz ka planovima je dugme ispod, a
            ono je i dalje jedino primarno dugme na ekranu. */}
        <a href={LANDING_URL} className="rounded-lg">
          <ZnakSaImenom imeKlase="text-base" />
        </a>
        <PrekidacTemeDugme />
      </header>

      <main className="relative mx-auto w-full max-w-xl px-5 pb-24 pt-[clamp(3rem,8vw,6rem)] sm:px-7">
        <div className="rounded-2xl border border-border bg-bg-elev p-6 shadow-card sm:p-8">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-bg-inset text-fg-muted">
            <Lock className="h-5 w-5" aria-hidden />
          </span>

          {cekaPlan ? (
            // §1.12, „Posle 30 dana" — doslovno.
            <>
              <h1 className="h2 mt-4">Nalog čeka plan</h1>
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                Besplatne kredite si potrošio
                {potrosio && (
                  <>
                    {" "}
                    <span className="num">{formatDatum(potrosio)}</span>
                  </>
                )}
                , a rok za čitanje je prošao
                {rokCitanja && (
                  <>
                    {" "}
                    <span className="num">{formatDatum(rokCitanja)}</span>
                  </>
                )}
                . Ništa nije obrisano — sa planom se sve vraća.
              </p>
            </>
          ) : (
            <>
              <h1 className="h2 mt-4">Pristup je istekao</h1>
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                Pun pristup ti je prestao{" "}
                <span className="num">{formatDatum(pristup.punDo as string)}</span>. Posle toga si
                imao još mesec dana da otvaraš svoje prospekte i izvezeš ih —
                {rokCitanja ? (
                  <>
                    {" "}
                    taj rok je istekao <span className="num">{formatDatum(rokCitanja)}</span>.
                  </>
                ) : (
                  " i taj rok je istekao."
                )}
              </p>

              <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                <strong className="font-semibold text-fg">Ništa nije obrisano.</strong> Otključani
                prospekti, pipeline, beleške i poruke stoje tačno kako si ih ostavio i vraćaju se u
                istom trenutku u kom nalog ponovo dobije pristup.
              </p>
            </>
          )}

          {/* Jedan izlaz, ne dva. Paket kredita se kupuje samo uz aktivan plan,
              probu ili komp pristup (`smeDaKupiPaket`), pa zaključan nalog tim
              putem ne može da prođe. Dugme koje vodi u odbijenicu je gore nego
              dugme kog nema. */}
          <div className="mt-6">
            <Button asChild variant="primary">
              <Link href="/cenovnik">
                Pogledaj planove
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>

          {!cekaPlan && (
            <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-fg-muted">
              Krediti koje si ranije dokupio nisu nestali — oni ne ističu i čekaju te. Paket kredita
              se, međutim, kupuje samo uz aktivan plan, probu ili komp pristup, pa se pristup vraća
              planom.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
