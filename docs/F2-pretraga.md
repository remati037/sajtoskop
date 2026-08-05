# F2 — Pretraga i lista

**Cilj:** iz browsera dobiješ isto što CLI daje u terminalu, za nišu koja je već u bazi.

**Procena:** 4–5 dana · **Preduslov:** F1 gotov, baza seedovana

U ovoj fazi **nema pozivanja Google API-ja**. Radi se isključivo nad keširanim podacima.
Pretraga koja nema pogodak vraća poruku „ova kombinacija još nije skenirana" — job u red dolazi u F3.

---

## 1. Next.js postavka

- [ ] Next.js 15 App Router u `apps/web`, TypeScript, Tailwind, shadcn/ui
- [ ] `transpilePackages: ["@sajtoskop/shared"]` u `next.config.ts`
- [ ] Clerk provider + middleware
- [ ] Rute:
  ```
  app/(marketing)/page.tsx        placeholder do F8
  app/(app)/pretraga/page.tsx     glavni ekran
  app/(app)/lista/page.tsx        otključani leadovi (puni se u F4)
  app/api/search/route.ts
  ```
- [ ] Font i osnovni vizuelni jezik: jedan sans font, tamna i svetla tema, bez šablonskog izgleda

---

## 2. Ugovor API rute

`POST /api/search`

```ts
const bodySchema = z.object({
  city:  z.enum(CITY_SLUGS),    // allowlist iz taksonomije, nikad slobodan tekst
  niche: z.enum(NICHE_SLUGS),
  filters: z.object({
    onlyNoSite:   z.boolean().default(false),
    onlySocial:   z.boolean().default(false),
    onlyDead:     z.boolean().default(false),
    minScore:     z.number().int().min(0).max(100).optional(),
  }).default({}),
  page: z.number().int().min(1).max(20).default(1),
});
```

Odgovor:

```ts
{
  status: "cache" | "not_scanned",
  freshness: { refreshedAt: string; stale: boolean } | null,
  total: number,
  page: number,
  pageSize: 30,          // hard cap, bez limit parametra iz klijenta
  results: PublicLead[],
  summary: { noSite: number; social: number; dead: number; ugly: number; ok: number },
}
```

**Nema bulk endpointa.** Nikad „vrati sve leadove za grad X". Paginacija sa fiksnim `pageSize`,
bez mogućnosti da klijent traži više.

---

## 3. Serijalizacija — jedina funkcija koja sme da vraća lead

Ovo je P0-3 iz `docs/bezbednost.md` i najvažnijih 20 linija u fazi.

```ts
// apps/web/src/lib/public-lead.ts
export function toPublicLead(
  b: BusinessRow,
  a: AuditRow | null,
  isUnlocked: boolean,
): PublicLead {
  return {
    placeId:    b.place_id,
    name:       b.name,
    citySlug:   b.city_slug,
    address:    b.address,
    hasWebsite: !!b.website_url,
    phoneType:  b.phone_type,
    rating:     b.rating,
    siteStatus: a?.site_status ?? null,
    uglyBand:   a?.ugly_band ?? null,
    platform:   a?.platform ?? null,
    isUnlocked,

    // isključivo za otključane:
    phone:      isUnlocked ? b.phone : null,
    websiteUrl: isUnlocked ? b.website_url : null,
    email:      isUnlocked ? a?.emails?.[0] ?? null : null,
    uglyScore:  isUnlocked ? a?.ugly_score ?? null : null,
    signals:    isUnlocked ? a?.signals ?? null : null,
    aiIssues:   isUnlocked ? a?.ai_issues ?? null : null,
    screenshot: isUnlocked ? await signedUrl(a?.screenshot_desktop) : null,
  };
}
```

Pravila:

- **Nijedna druga funkcija ne sme da vrati red iz `businesses` ili `website_audits` klijentu.**
- Zabranjen je `select *` u bilo kojoj ruti koja servira klijenta
- `ugly_band` je vidljiv i zaključanom leadu (to je mamac), `ugly_score` nije
- Ako se u F3+ doda novo polje u `website_audits`, ono je **podrazumevano zaključano** dok se svesno ne otvori

---

## 4. Logika keša

```
ključ = (country_code, city_slug, niche_slug)

pogodak  = postoji ≥1 business sa tim ključem
           I max(google_refreshed_at) mlađe od 30 dana
zastarelo = postoji, ali starije od 30 dana → prikaži rezultat sa oznakom
            „podaci stariji od 30 dana, osvežavanje u pripremi" (u F2 samo oznaka)
promašaj  = ne postoji → status "not_scanned"
```

Sortiranje podrazumevano: `site_status` prioritet (`nema_sajt` → `mrtav` → `samo_drustvene` → `ok`),
pa `ugly_score desc`. To je redosled po kvalitetu leada, ne po abecedi.

Svaka pretraga upisuje red u `searches` sa `source: 'cache'` i `api_calls: 0`.

---

## 5. UI

**Ekran pretrage:**
- Dva selecta: grad i niša, popunjena iz taksonomije, sa pretragom u dropdownu
- Niše prikaži grupisane po `NicheGroup`, sortirane po `nichePriority` unutar grupe
- Dugme „Pretraži"

**Rezultat:**
- Sumarna traka na vrhu: *„30 firmi · 7 bez sajta · 4 samo društvene · 11 ružnih"* — ista rečenica koju CLI ispisuje
- Tabela: naziv, bedž statusa/benda, grad, tip telefona, dugme „Otključaj" (u F2 neaktivno)
- Bedževi: `NEMA SAJT` i `MRTAV DOMEN` vizuelno najjači — to su najbolji leadovi, ne greške
- Filteri kao toggle dugmad iznad tabele
- Prazan rezultat i `not_scanned` moraju imati različite, jasne poruke na srpskom

**Ne gradi u F2:** kanban, detalje leada u modalu, export, izbor kolona.

---

## 6. Gotovo kad

- Pretraga `Šabac + PVC stolarija` vraća iste biznise i isti sumarni red kao `pnpm scan --grad=sabac --nisa=pvc-stolarija --offline`
- U Network tabu browsera, odgovor za zaključan lead **ne sadrži** polja `phone`, `email`, `websiteUrl`, `uglyScore`
- Kombinacija koja nije skenirana vraća `not_scanned` bez ijednog Google poziva
- `searches` tabela ima red za svaku izvršenu pretragu

Drugu stavku proveri ručno u browseru, ne kroz kod.

---

## 7. Ne radi u ovoj fazi

- Nijedan Google API poziv
- Bez unlock funkcionalnosti (dugme postoji, ne radi)
- Bez workera i reda poslova
- Bez screenshotova i AI analize
- Bez landing stranice

---

## 8. Prompt za sesiju

```
Radimo docs/F2-pretraga.md. Pročitaj CLAUDE.md i docs/00-kontekst.md prvo.

Redosled koji hoću:
1. Next.js skelet + Clerk + transpilePackages, potvrdi da se @sajtoskop/shared
   uspešno importuje u server komponenti
2. lib/public-lead.ts i API ruta — ovo pišemo pre UI-ja
3. tek onda UI

Posle koraka 2 hoću da mi pokažeš primer JSON odgovora za jedan zaključan
lead, da vizuelno potvrdim da polja stvarno nedostaju.
```
