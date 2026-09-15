/**
 * scripts/stripe-sat.ts — test clock ("sat") za probu, obnovu i past_due.
 *
 *   pnpm stripe:sat nov <profiles.id> [mejl]   sat + kupac pod satom (+ SQL za profil)
 *   pnpm stripe:sat status <clock_id>          frozen_time, status, kupci
 *   pnpm stripe:sat pomeri <clock_id> +8d      pomeri i čekaj da bude ready
 *   pnpm stripe:sat lista
 *   pnpm stripe:sat obrisi <clock_id>
 *
 * Zašto kupac ide OVDE a ne kroz aplikaciju: `test_clock` se postavlja samo pri
 * kreiranju kupca, a naša checkout ruta pravi kupca bez sata. Zato se kupac
 * napravi ovde, upiše u profiles.stripe_customer_id, pa se checkout radi
 * normalno iz aplikacije — ruta zatekne postojećeg kupca i pretplata nastane
 * pod satom.
 *
 * Ograničenja (Stripe): 3 kupca po satu · jedno pomeranje najviše dva intervala
 * najkraće pretplate (bez pretplata: 2 godine) · sat se sam briše ~30 dana
 * posle kreiranja · više izmena iste pretplate pod istim satom vraća rate limit,
 * pa pomeri par minuta između izmena.
 */

import Stripe from "stripe";

const kljuc = process.env.STRIPE_SECRET_KEY;
if (!kljuc) padni("STRIPE_SECRET_KEY nije postavljen.");
if (!kljuc.startsWith("sk_test_")) padni("Test clock radi samo sa sk_test_ ključem.");

const stripe = new Stripe(kljuc, {
  ...(process.env.STRIPE_API_VERSION
    ? { apiVersion: process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion }
    : {}),
});

const [komanda, a1, a2] = process.argv.slice(2);

function padni(poruka: string): never {
  console.error(`✖ ${poruka}`);
  process.exit(1);
}

function datum(sekunde: number): string {
  return new Date(sekunde * 1000).toISOString().replace("T", " ").slice(0, 16);
}

/** "+8d", "+36h", "+2m", "+1y" ili ISO datum → unix sekunde. */
function ciljnoVreme(od: number, izraz: string): number {
  const m = /^\+(\d+)([hdmy])$/.exec(izraz.trim());
  if (!m) {
    const t = Date.parse(izraz);
    if (Number.isNaN(t)) padni(`Ne razumem "${izraz}". Primeri: +8d, +36h, +1m, 2026-10-01`);
    return Math.floor(t / 1000);
  }
  const n = Number(m[1]);
  const sek = { h: 3600, d: 86400, m: 2592000, y: 31536000 }[m[2] as "h" | "d" | "m" | "y"];
  return od + n * sek;
}

async function cekajReady(id: string): Promise<Stripe.TestHelpers.TestClock> {
  const kraj = Date.now() + 120_000;
  for (;;) {
    const sat = await stripe.testHelpers.testClocks.retrieve(id);
    if (sat.status === "ready") return sat;
    if (sat.status === "internal_failure") padni("Stripe: internal_failure pri pomeranju sata.");
    if (Date.now() > kraj) padni("Sat se ne pomera 2 minuta. Proveri u panelu.");
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function kupciNaSatu(id: string): Promise<Stripe.Customer[]> {
  const svi = await stripe.customers.list({ test_clock: id, limit: 10 });
  return svi.data;
}

async function nov(profileId: string, mejl?: string): Promise<void> {
  if (!profileId) padni("Treba profiles.id (Clerk user id). Primer: pnpm stripe:sat nov user_T2 ti+t2@primer.com");

  const sat = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: `sajtoskop ${profileId}`,
  });

  const kupac = await stripe.customers.create({
    test_clock: sat.id,
    ...(mejl ? { email: mejl } : {}),
    metadata: { user_id: profileId },
  });

  console.log(`sat:   ${sat.id}   frozen ${datum(sat.frozen_time)}`);
  console.log(`kupac: ${kupac.id}`);
  console.log(`\nPusti ovo u Supabase, pa radi checkout iz aplikacije:\n`);
  console.log(`update profiles set stripe_customer_id = '${kupac.id}' where id = '${profileId}';\n`);
  console.log(`Posle checkout-a:  pnpm stripe:sat pomeri ${sat.id} +8d`);
}

async function status(id: string): Promise<void> {
  if (!id) padni("Treba clock_id.");
  const sat = await stripe.testHelpers.testClocks.retrieve(id);
  console.log(`${sat.id}  ${sat.status}  frozen ${datum(sat.frozen_time)}  briše se ${datum(sat.deletes_after)}`);
  for (const k of await kupciNaSatu(id)) {
    const pretplate = await stripe.subscriptions.list({ customer: k.id, limit: 5, status: "all" });
    const opis = pretplate.data
      .map((p) => `${p.items.data[0]?.price.lookup_key ?? "?"}:${p.status}`)
      .join(", ");
    console.log(`  ${k.id}  ${k.email ?? "—"}  ${opis || "bez pretplate"}`);
  }
}

async function pomeri(id: string, izraz: string): Promise<void> {
  if (!id || !izraz) padni("Primer: pnpm stripe:sat pomeri clock_abc +8d");
  const sat = await stripe.testHelpers.testClocks.retrieve(id);
  const cilj = ciljnoVreme(sat.frozen_time, izraz);
  if (cilj <= sat.frozen_time) padni("Sat ide samo unapred.");

  console.log(`${datum(sat.frozen_time)} → ${datum(cilj)}`);
  await stripe.testHelpers.testClocks.advance(id, { frozen_time: cilj });
  const gotov = await cekajReady(id);
  console.log(`\n✓ ready · ${datum(gotov.frozen_time)}`);
  console.log("Pogledaj terminal sa `stripe listen` i proveri bazu.");
}

async function lista(): Promise<void> {
  const svi = await stripe.testHelpers.testClocks.list({ limit: 20 });
  if (svi.data.length === 0) return console.log("Nema satova.");
  for (const s of svi.data) {
    console.log(`${s.id}  ${s.status.padEnd(9)}  frozen ${datum(s.frozen_time)}  ${s.name ?? ""}`);
  }
}

async function obrisi(id: string): Promise<void> {
  if (!id) padni("Treba clock_id.");
  await stripe.testHelpers.testClocks.del(id);
  console.log(`✓ ${id} obrisan (sa svim kupcima i pretplatama pod njim).`);
  console.log("Ne zaboravi: update profiles set stripe_customer_id = null where …");
}

const komande: Record<string, () => Promise<void>> = {
  nov: () => nov(a1!, a2),
  status: () => status(a1!),
  pomeri: () => pomeri(a1!, a2!),
  lista: () => lista(),
  obrisi: () => obrisi(a1!),
};

const izabrana = komande[komanda ?? ""];
if (!izabrana) {
  console.log("Komande: nov <profiles.id> [mejl] · status <clock_id> · pomeri <clock_id> +8d · lista · obrisi <clock_id>");
  process.exit(1);
}
izabrana().catch((err) => {
  console.error(err);
  process.exit(1);
});
