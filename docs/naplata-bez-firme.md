# Naplata bez strane firme — plan za paušalca

**Kontekst:** Marko, paušalac u Srbiji, šifra 63.12. Cilj: naplaćivati pretplatu i lifetime pakete bez registrovanja US LLC-a ili estonske OÜ.

---

## 1. Šta ti je zapravo status

| Zabluda | Stvarnost |
|---|---|
| "Nemam firmu, moram kao fizičko lice" | Imaš registrovanog preduzetnika. To je pravni subjekt koji izdaje račune. |
| "Kao fizičko lice ne mogu da naplatim" | Kao **neregistrovano** fizičko lice ne bi smeo da naplaćuješ redovan poslovni prihod — to je neprijavljena delatnost. Ali ti to i ne moraš. |
| "Treba mi strana firma za Stripe" | Za Stripe da. Za sve ostalo ne. |

**Zaključak:** naplaćuješ preko paušala. Sve niže je izgrađeno na tome.

**Test samostalnosti — dobra vest.** Devet kriterijuma koji preduzetnika mogu da prekvalifikuju u zaposlenog aktiviraju se kad jedan klijent dominira prihodom. Sa 30-200 malih pretplatnika si na suprotnom kraju spektra. SaaS model je za paušalca bezbedniji od jednog velikog klijenta.

**Pragovi koje moraš proveriti sa knjigovođom pre nego što planiraš rast:**
- limit prometa do kog imaš pravo na paušalno oporezivanje
- odvojen, viši prag za obaveznu PDV registraciju
- kako se knjiži prihod iz inostranstva na deviznom računu

Ovo su dva različita broja i menjali su se kroz godine. Ne planiraj po mojim ciframa.

---

## 2. Pravi filter: ko može da te ISPLATI

Ovo je greška koju prave svi vodiči. Ne pitaš "prihvata li me platforma", pitaš "kako mi šalju novac".

| Platforma | Mehanizam isplate | Srbija? |
|---|---|---|
| **Lemon Squeezy** | Bankovna isplata za ograničenu listu zemalja, PayPal za 200+ | ✅ preko PayPala |
| **Paddle** ✅ **IZABRANO** | Bankovni transfer; nalog otvoren i sandbox katalog radi | ✅ **potvrđeno u praksi** — v. `naplata-paddle.md` |
| **Dodo Payments** | Sopstvena mreža, 220+ zemalja, eksplicitno cilja non-Stripe zemlje | ✅ najverovatnije |
| **Creem** | 130+ zemalja, objavljuju listu podržanih i nepodržanih | ⚠️ proveri listu, imali su i waitlist periode |
| **Gumroad** | Stripe Connect | ❌ Srbija nije na Stripe Connect listi |
| ~~**Polar**~~ | Stripe Connect **Express**, ne obični Stripe Payments — Srbija JESTE na njihovoj listi, pa je raniji „❌ isto” u ovom redu bio netačan | ⊘ **napušteno**, ali zbog odluke za Paddle, a ne zbog Srbije |
| **Domaći virman / IPS QR** | Direktno na tvoj poslovni račun | ✅ nula posrednika |

Koristiti tuđi račun u podržanoj zemlji je kršenje uslova i platforme i Stripe-a, i vodi u zamrznuta sredstva. Ne razmatramo.

---

## 3. Realna matematika, ne headline cene

Na mesečnoj pretplati od **3.990 RSD** (~€34):

| Put | Provizija platforme | FX i povlačenje | **Ukupno** | Ostaje ti |
|---|---|---|---|---|
| Lemon Squeezy → PayPal → kartica | 5% + $0.50 ≈ €2.15 | PayPal FX ~3% + naplata povlačenja ≈ €1.10 | **~9.5%** | ~€30.75 |
| Dodo (4% + 40¢ + 0.5% subscription + 1.5% international) | ≈ €2.45 | bankovni transfer, manji FX | **~8%** | ~€31.30 |
| Paddle 5% + 50¢ | ≈ €2.15 | bankovni transfer | **~7%** | ~€31.60 |
| **Domaći IPS QR / virman** | **0** | **0** | **0%** | **€34** |

Na lifetime paketu od **19.900 RSD** (~€170) razlika je još drastičnija — MoR ti uzme €9-11 po prodaji, IPS ti uzme nula.

**Na 30 lifetime prodaja to je razlika od ~€300.** To je registracija strane firme koju si hteo da izbegneš, plaćena iz onoga što bi dao posredniku.

---

## 4. Preporučena arhitektura

```
                    ┌─────────────────────────┐
   Srpski kupac ───► │  IPS QR / virman, RSD   │ ──► poslovni račun
                    │  0% provizije           │      domaći račun kupcu
                    │  godišnje ili paketi    │
                    └─────────────────────────┘

                    ┌─────────────────────────┐
  Strani kupac ────► │  Lemon Squeezy, EUR/USD │ ──► PayPal ──► kartica
   (region, EU)     │  ~9.5% all-in           │      LS izdaje fakturu
                    │  mesečna pretplata      │
                    └─────────────────────────┘
```

### Ključna odluka: domaćima ne prodaješ mesečno

Recurring u dinarima bez gateway-a nije automatski. Umesto da to rešavaš tehnologijom, reši ga **ponudom**:

| Model za domaće | Kako se plaća | Zašto radi |
|---|---|---|
| **Godišnja pretplata** | jedan virman/IPS godišnje | Jedna transakcija umesto dvanaest. Bolji cash flow, manji churn, nula administracije. Daj 25-30% popusta na godišnje — jeftinije ti je od 9.5% provizije × 12. |
| **Paketi kredita** | jednokratno, po potrebi | 400 kredita za 3.990. Nema pretplate, nema otkazivanja, kupac se vraća sam. Idealno za freelancere koji rade u ciklusima. |
| **Kvartalno** | 4× godišnje | Kompromis ako godišnje bude preveliki zalogaj |
| Lifetime | jednokratno | Founding member faza |

Ovo nije zaobilaženje problema, to je **bolji proizvod za ovo tržište**. Srpski freelancer koji ne zna hoće li imati posao za tri meseca lakše kupi paket kredita nego pretplatu koju mora da pamti da otkaže.

Mesečnu pretplatu uvedi kad budeš imao Stripe. Tada je i tehnički trivijalna.

---

## 5. Implementacija A — domaći tok u dinarima

### IPS QR kod

NBS format je tekstualni string koji generišeš sam, bez ičije integracije i bez naknade:

```
K:PR|V:01|C:1|R:<račun 18 cifara bez crtica>|N:<naziv>\n<adresa>|I:RSD<iznos>|SF:221|S:<svrha>|RO:<model><poziv na broj>
```

```ts
// lib/ips-qr.ts
type IpsParams = {
  account: string;      // 18 cifara, bez crtica
  name: string;         // naziv preduzetnika
  address: string;      // adresa
  amountRsd: number;    // 3990
  purpose: string;      // "Pretplata Sajtoskop godisnja"
  reference?: string;   // poziv na broj
};

export function ipsQrPayload(p: IpsParams): string {
  const amount = `RSD${p.amountRsd.toFixed(2).replace(".", ",")}`;
  const parts = [
    "K:PR",
    "V:01",
    "C:1",
    `R:${p.account.replace(/\D/g, "")}`,
    `N:${p.name}\n${p.address}`,
    `I:${amount}`,
    "SF:221",                              // šifra plaćanja: usluge
    `S:${p.purpose.slice(0, 35)}`,
  ];
  if (p.reference) parts.push(`RO:97${p.reference}`);
  return parts.join("|");
}
```

Payload provuci kroz bilo koju QR biblioteku (`qrcode` na npm-u) i dobiješ sliku. Kupac skenira iz m-bankinga, iznos i primalac su već popunjeni, potvrdi u dva klika.

> **Proveri format u aktuelnoj NBS specifikaciji za IPS QR** pre nego što pošalješ prvi kod. Tagovi i šifre plaćanja su precizni i menjali su se. Testiraj sa svojom bankom na malom iznosu.

### Tok naplate

```
1. Kupac izabere plan na sajtu, unese podatke (naziv firme, PIB, mejl)
2. Backend kreira "invoice" red u Supabase, generiše poziv na broj
3. Mejl kupcu: PDF račun (ReportLab, već imaš pipeline) + IPS QR slika
4. Kupac plati
5. Ti proveriš izvod ujutru, označiš plaćeno u admin panelu
6. Trigger: krediti se dodaju, plan se aktivira, kupcu ide mejl "aktivirano"
```

Korak 5 je jedini ručni. Na 30-100 kupaca to je 5 minuta dnevno.

### Poluautomatizacija koraka 5

Kada te ručno bude nerviralo, dve opcije:

- **Bankovni izvod → Google Sheet → Apps Script** — izvoz izvoda iz e-bankinga u CSV, Apps Script parsira poziv na broj i pinguje tvoj Supabase webhook. Ti to već radiš za Sportem izveštaje, isti pattern.
- **Halcom / bankovni API** — neke srpske banke daju API za izvode preduzetnicima. Pitaj svoju banku. Ako da, ceo tok postaje automatski.

### Minimalna admin tabela

```sql
create table invoices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references profiles(id),
  invoice_number  text unique not null,        -- 2026-001
  reference       text unique not null,        -- poziv na broj
  plan            text not null,
  amount_rsd      integer not null,
  currency        text default 'RSD',
  status          text default 'poslato',      -- poslato | placeno | otkazano
  issued_at       timestamptz default now(),
  paid_at         timestamptz,
  credits_granted integer,
  buyer_name      text,
  buyer_pib       text,
  buyer_email     text
);
```

Kada `status` pređe u `placeno`, trigger ubacuje red u `credit_ledger` i postavlja `profiles.plan`. Nikad ne diraj `credits_balance` direktno — pravilo iz PRD-a važi i ovde.

---

## 6. Implementacija B — Lemon Squeezy za strane kupce

### Setup

1. Registracija kao **individual / sole proprietorship**. Nije potrebna firma.
2. Poreski formular: kao ne-američki prodavac ideš na **W-8BEN** (za fizičko lice) — LS ga traži pre nego što omogući isplate.
3. Payout metod: **PayPal**. Proveri da ti je PayPal račun na isto ime i da može da prima sredstva u Srbiji.
4. Store setup: naziv, logo, statement descriptor (pojavljuje se kao `LEMSQZY* <ime>` na izvodu kupca).

### Struktura proizvoda

| LS Product | Varijante | Mapiranje |
|---|---|---|
| Sajtoskop pretplata | Starter mesečno / godišnje, Pro mesečno / godišnje, Agencija mesečno / godišnje | `variant_id` → plan + mesečna kvota kredita |
| Paket kredita | 200 / 500 / 1000 | jednokratni credit grant |
| Lifetime founding | jedna varijanta | plan = `lifetime` |

Drži `variant_id → plan` mapiranje u konfiguraciji, ne u kodu razbacano.

### Webhook handler

```ts
// app/api/lemonsqueezy/webhook/route.ts
import crypto from "crypto";

const PLAN_BY_VARIANT: Record<string, { plan: string; monthlyCredits: number }> = {
  "123456": { plan: "starter",  monthlyCredits: 150 },
  "123457": { plan: "pro",      monthlyCredits: 400 },
  "123458": { plan: "agency",   monthlyCredits: 1000 },
  "123459": { plan: "lifetime", monthlyCredits: 400 },
};

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-signature") ?? "";

  const digest = crypto
    .createHmac("sha256", process.env.LS_WEBHOOK_SECRET!)
    .update(raw)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig))) {
    return new Response("bad signature", { status: 401 });
  }

  const event = JSON.parse(raw);
  const name = event.meta.event_name;
  const attrs = event.data.attributes;
  const variantId = String(attrs.variant_id ?? attrs.first_order_item?.variant_id);
  const email = attrs.user_email;

  switch (name) {
    case "subscription_created":
    case "subscription_resumed":
    case "subscription_unpaused":
      await activatePlan(email, PLAN_BY_VARIANT[variantId], event.data.id);
      break;

    case "subscription_payment_success":
      // mesečni grant kredita + rollover logika
      await grantMonthlyCredits(email, PLAN_BY_VARIANT[variantId]);
      break;

    case "subscription_updated":
      await syncPlan(email, PLAN_BY_VARIANT[variantId], attrs.status);
      break;

    case "subscription_cancelled":
      // ne gasi odmah — LS drži pristup do ends_at
      await scheduleDowngrade(email, attrs.ends_at);
      break;

    case "subscription_expired":
    case "subscription_payment_failed":
      await downgradeToFree(email);
      break;

    case "order_created":
      // jednokratni paket kredita ili lifetime
      await handleOneTimePurchase(email, variantId, event.data.id);
      break;

    case "order_refunded":
      await revokeCredits(email, event.data.id);
      break;
  }

  return new Response("ok");
}
```

### Zamke koje će te ugristi

1. **Idempotencija.** LS retry-uje webhookove. Čuvaj `event_id` u tabeli `webhook_events` i preskoči duplikate, inače ćeš dvaput dodeliti kredite.
2. **`subscription_cancelled` ≠ odmah gubi pristup.** Kupac plaća do kraja perioda. Koristi `ends_at`, ne trenutak otkazivanja.
3. **Mapiranje po mejlu je krhko.** Kupac može platiti sa drugim mejlom od onog sa kojim se registrovao u Clerku. Reši `custom` poljem u checkout URL-u: `?checkout[custom][user_id]=<clerk_id>` — vraća ti se u webhook payloadu i vezuje pouzdano.
4. **Refund ne vraća kredite automatski.** Napiši `revokeCredits` ili ćeš imati ljude koji plate, iskoriste 400 kredita i traže refund.
5. **Testiranje.** LS ima test mode — prođi kroz sve događaje pre lansiranja, posebno failed payment.

### Roadmap rizik

<cite index="21-1">Stripe je kupio Lemon Squeezy u julu 2024, a u januaru 2026 osnivač je potvrdio da tim gradi migracione putanje ka Stripe Managed Payments. LS se ne zatvara i nema objavljen datum, ali ozbiljni korisnici treba da planiraju migraciju.</cite>

Praktično: **abstrahuj billing od dana 1.** Jedan interfejs, dve implementacije.

```ts
// lib/billing/provider.ts
export interface BillingProvider {
  checkoutUrl(plan: string, userId: string): Promise<string>;
  cancelSubscription(subId: string): Promise<void>;
  portalUrl(subId: string): Promise<string>;
}
```

`LemonSqueezyProvider`, `ManualInvoiceProvider`, kasnije `StripeProvider`. Kad migriraš, menjaš jedan fajl, ne pola aplikacije.

---

## 7. Kada preći na alternativu

| Situacija | Idi na |
|---|---|
| LS te odbije ili PayPal zakomplikuje | **Dodo Payments** — 220+ zemalja, eksplicitno grade za non-Stripe tržišta |
| Provizija počne da boli (>€500/mo u fee-jevima) | **Creem** 3.9% + $0.40, najjeftiniji flat MoR, ali proveri listu zemalja i eventualni waitlist |
| Treba ti ozbiljan subscription engine (proration, dunning, seats) | **Paddle** — najzreliji, stroža provera |
| Prihod opravdava €500-700/god na održavanje firme | **Strana firma + Stripe** — ~1.5% + €0.25, pola cene MoR-a |

Prelomna točka za stranu firmu: kada godišnja razlika u proviziji pređe ~€700. Na 9.5% vs 2.7% razlika je ~6.8%, što znači promet od **~€10.000 godišnje** (~35 pretplatnika po €25/mo). Do tada MoR ili domaći tok, posle toga firma.

---

## 8. Poreske i računovodstvene napomene

Sve proveri sa knjigovođom. Nisam ni pravnik ni knjigovođa.

| Tema | Napomena |
|---|---|
| Prihod iz inostranstva | LS/PayPal uplata dolazi kao devizni prihod od jednog stranog pravnog lica. Za paušalca administrativno jednostavno. |
| Domaći prihod | Redovan račun u dinarima, standardno. |
| PDV | Kao paušalac verovatno nisi u PDV-u — to ti je konkurentska prednost, cena je "čista". Prati prag. |
| Kupci u PDV-u | Ako plate preko LS-a, dobijaju fakturu strane firme → reverse charge obaveza. Domaći račun im je čistiji. **Još jedan argument za domaći tok.** |
| Dokumentacija | Čuvaj LS payout izveštaje i PayPal izvode. Knjigovođi treba trag od kupca do uplate na račun. |
| Šifra delatnosti | 63.12 pokriva web portale. Proveri da li ti za SaaS bolje leži 62.01. |

---

## 9. Checklist za pokretanje

**Domaći tok (2-3 dana rada)**
- [ ] `invoices` tabela + admin panel za označavanje plaćenog
- [ ] IPS QR generator, testiran sa svojom bankom na 100 RSD
- [ ] PDF račun (ReportLab, DejaVu Sans za dijakritiku — postojeći setup)
- [ ] Mejl šablon: račun + QR + uputstvo za virman
- [ ] Trigger: `invoices.status = placeno` → `credit_ledger` + `profiles.plan`
- [ ] Poziv na broj sa kontrolnim brojem po modelu 97

**Lemon Squeezy (1-2 dana rada)**
- [ ] Registracija kao individual, W-8BEN popunjen
- [ ] PayPal payout potvrđen
- [ ] Proizvodi i varijante kreirane, `variant_id` mapiranje u konfiguraciji
- [ ] Webhook endpoint + verifikacija potpisa + idempotencija
- [ ] `checkout[custom][user_id]` prosleđivanje Clerk ID-a
- [ ] Test mode: prođi svih 8 događaja
- [ ] `BillingProvider` interfejs, da migracija kasnije ne boli

**Ne radi sada**
- [ ] ~~AllSecure / banka~~ — fiksna mesečna naknada bez smisla pod 100 kupaca
- [ ] ~~Strana firma~~ — čekaj ~€10k godišnjeg prometa
- [ ] ~~Mesečna pretplata za domaće~~ — godišnje i paketi kredita, dok nema Stripe-a
