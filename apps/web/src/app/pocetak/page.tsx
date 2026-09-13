// apps/web/src/app/pocetak/page.tsx
// Čarobnjak prvog prolaza (S30, tok-i-onboarding §1.8, §4.2, O4).
//
// Stoji IZVAN grupe `(app)` — svoj okvir, bez bočne trake i gornjeg menija
// (§4.2, isto kao `/welcome`). Zato ovde nema ni `ensureProfile` iz layout-a
// aplikacije: rezervni put za profil je ponovljen, jer se na `/pocetak` stiže i
// pravo sa `/welcome` i sa `/pozivnica/...`, pre ijedne strane iz `(app)`.
//
// ── ko sme ovde ─────────────────────────────────────────────
//   · nepoznato stanje (profil se ne čita) → `/pretraga`, gde čeka `VezaGreska`
//   · zaključan → `/zakljucano`
//   · bez punog pristupa (grace) → `/pretraga`: čarobnjak se završava plaćanjem
//   · već završen / preskočen / prva lista plaćena → `/pretraga` (§1.8)
//   · `?ponovo=1` (vodič, §4.8) → ulazi i kad je sve to već urađeno
//
// ── nula Places poziva (pravilo 5a, §1.8) ───────────────────
// Kombinacije su ISKLJUČIVO iz `listaKesa()` sa `fresh = true`. Ova strana ne
// upisuje nijedan posao; ekran 4 plaća pristup keširanoj listi kroz
// `/api/search`, a ta ruta Places poziv pravi samo kad keš NE pokriva zahtev —
// što ekran 4 prvo proveri bez naplate (v. `pocetak-ekran.tsx`).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import {
  CITIES,
  jeOnboardingKanal,
  NICHES,
  ONBOARDING_CREDITS,
  trebaCarobnjak,
} from "@sajtoskop/shared";
import { requireSession } from "@/lib/auth";
import { imaKupljenPaket } from "@/lib/onboarding";
import { porukaKompa } from "@/lib/pozivnice-schema";
import { citajPretplatu, pristupZaProfil, PUTANJA_ZAKLJUCANO } from "@/lib/pristup";
import { citajProfil, ensureProfile } from "@/lib/profile";
import { COUNTRY, listaKesa } from "@/lib/search-cache";
import type { KesStavka } from "@/lib/search-types";
import { adminSupabase } from "@/lib/supabase";
import { PocetakEkran, type GradCarobnjaka } from "@/components/pocetak-ekran";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prvi koraci",
  robots: { index: false, follow: false },
};

/**
 * Broj firmi sa mrtvim domenom po kombinaciji — treći broj na ekranu 4 (§4.2).
 *
 * ‼️ §4.2 kaže „iz `search_cache`", ali `search_cache` taj broj NEMA — ima samo
 *    `total` i `no_site` (0020). Ovde je jedan `count` upit po svežoj kombinaciji,
 *    nad istim redovima koje lista servira. Pad upita ne ruši čarobnjak: broj se
 *    tada ne prikazuje (v. SESIJE.md, S30).
 */
async function mrtviPoKombinaciji(stavke: KesStavka[]): Promise<Map<string, number>> {
  const db = adminSupabase();
  const out = new Map<string, number>();

  await Promise.all(
    stavke.map(async (s) => {
      const { count, error } = await db
        .from("businesses")
        .select("place_id, website_audits!inner(site_status)", { count: "exact", head: true })
        .eq("country_code", COUNTRY)
        .eq("city_slug", s.city)
        .eq("niche_slug", s.niche)
        .eq("website_audits.site_status", "mrtav");

      if (error) {
        console.error(`[pocetak] mrtvi domeni ${s.city}:${s.niche}: ${error.message}`);
        return;
      }
      if (count !== null) out.set(`${s.city}:${s.niche}`, count);
    }),
  );

  return out;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ponovo?: string; pozivnica?: string }>;
}) {
  const userId = await requireSession();
  const { ponovo: ponovoParam, pozivnica } = await searchParams;
  const ponovo = ponovoParam === "1";

  let { profile } = await citajProfil();
  if (!profile) {
    try {
      const user = await currentUser();
      await ensureProfile(userId, user?.primaryEmailAddress?.emailAddress ?? null);
      ({ profile } = await citajProfil());
    } catch (err) {
      console.error("[pocetak] kreiranje profila nije uspelo:", err);
    }
  }
  if (!profile) redirect("/pretraga");

  const pretplata = await citajPretplatu(userId);
  const pristup = pristupZaProfil(profile, pretplata);

  if (!pristup) redirect("/pretraga");
  if (!pristup.cita) redirect(PUTANJA_ZAKLJUCANO);
  if (!pristup.pun) redirect("/pretraga");

  if (
    !ponovo &&
    !trebaCarobnjak({
      pun: pristup.pun,
      doneAt: profile.onboarding_done_at,
      skippedAt: profile.onboarding_skipped_at,
      steps: profile.onboarding_steps,
    })
  ) {
    redirect("/pretraga");
  }

  const [kes, paket] = await Promise.all([
    listaKesa(userId).catch((err: unknown) => {
      console.error("[pocetak] registar keša:", err);
      return [] as KesStavka[];
    }),
    imaKupljenPaket(userId),
  ]);

  // Samo sveže i neprazne: lista koja stiže odmah i ima šta da pokaže (§4.2).
  const sveze = kes.filter((s) => s.fresh && !s.empty && s.total > 0);
  const mrtvi = await mrtviPoKombinaciji(sveze);

  const imeGrada = new Map(CITIES.map((c) => [c.slug, c]));
  const imeNise = new Map(NICHES.map((n) => [n.slug, n.label]));

  const poGradu = new Map<string, GradCarobnjaka & { tier: number }>();
  for (const s of sveze) {
    const grad = imeGrada.get(s.city);
    const labelaNise = imeNise.get(s.niche);
    if (!grad || !labelaNise) continue;

    const red = poGradu.get(s.city) ?? {
      slug: s.city,
      label: grad.label,
      tier: grad.tier,
      liste: 0,
      bezSajta: 0,
      nise: [],
    };
    red.liste += 1;
    red.bezSajta += s.noSite;
    red.nise.push({
      slug: s.niche,
      label: labelaNise,
      total: s.total,
      noSite: s.noSite,
      dead: mrtvi.get(`${s.city}:${s.niche}`) ?? null,
    });
    poGradu.set(s.city, red);
  }

  // Redosled gradova: tier, pa broj svežih kombinacija opadajuće (§4.2).
  // Niše: udeo firmi bez sajta opadajuće (§4.2, ekran 2).
  const gradovi: GradCarobnjaka[] = [...poGradu.values()]
    .sort((a, b) => a.tier - b.tier || b.liste - a.liste || a.label.localeCompare(b.label, "sr-Latn-RS"))
    .map((g) => ({
      slug: g.slug,
      label: g.label,
      liste: g.liste,
      bezSajta: g.bezSajta,
      nise: [...g.nise].sort((x, y) => y.noSite / y.total - x.noSite / x.total),
    }));

  const krediti = profile.credits_balance + profile.credits_topup;

  return (
    <PocetakEkran
      gradovi={gradovi}
      pocetno={{
        grad: profile.onboarding_city,
        nisa: profile.onboarding_niche,
        kanal: jeOnboardingKanal(profile.onboarding_channel) ? profile.onboarding_channel : null,
      }}
      krediti={krediti}
      // §4.2, ekran 4: „nalog bez plana, `dopuna` bez paketa" — i dok su mu
      // krediti dobrodošlice netaknuti, jer rečenica govori o oba.
      besplatni={pristup.stanje === "dopuna" && !paket && krediti === ONBOARDING_CREDITS}
      // §1.13: red iznad naslova prvog ekrana — samo ako nalog stvarno JESTE komp.
      kompRed={
        pozivnica === "komp" && profile.plan === "komp"
          ? porukaKompa(profile.komp_expires_at, krediti)
          : null
      }
      ponovo={ponovo}
    />
  );
}
