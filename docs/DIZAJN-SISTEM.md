# Sajtoskop — dizajn sistem

Izvor istine za vizuelni identitet: boje, tipografija, logo, komponente, motion.
Izvučeno iz landing sajta (`sajtoskop.com`) da bi aplikacija (`app.sajtoskop.com`)
izgledala kao isti proizvod, a ne kao dva različita.

**Kako se koristi:** ovaj fajl ide u app repo kao `docs/dizajn-sistem.md`, a u
`CLAUDE.md` app projekta dodaješ red:

```md
Pre bilo kakvog UI rada pročitaj `docs/dizajn-sistem.md` — boje, fontovi, logo i
komponente su fiksni. Ne izmišljaj nove tokene ni nove nijanse zelene.
```

Fajl je samostalan: sve što treba za rekonstrukciju identiteta je ovde, ne moraš
da otvaraš landing repo.

---

## 1. Ton i osećaj

Sajtoskop je **alat**, ne marketing brošura. Vizuelni jezik:

- **Instrument, ne igračka.** Tabele, brojevi, monospace za sve što je podatak.
  Estetika liči na dobar dev alat (Linear, Vercel, Raycast), ne na SaaS template.
- **Tamna tema je primarna** — tu identitet najbolje radi. Svetla mora da bude
  jednako dobra, ne naknadna misao.
- **Jedan akcenat, limeta zelena.** Nema drugih brend boja. Crvena/narandžasta
  postoje isključivo kao semantika Ugly Score-a, nikad kao dekoracija.
- **Suzdržano.** Bez gradijenata preko celog ekrana, bez staklenih kartica u
  kartici, bez emodžija u UI-u. Dubina se dobija hairline borderima, jednom
  suptilnom senkom i blagim glow-om iza ključnog elementa.
- **Gustina informacija.** Tekst u UI-u je 13–15px, ne 16–18px. Ovo je alat u
  kojem se skenira lista od 60 prospekata, ne blog.

---

## 2. Logo

Znak: lupa/nišan — prsten sa metom u centru i drškom. Meta je jedini deo u
akcentnoj boji, ostalo je `currentColor` da radi na obe teme.

```tsx
// components/logo.tsx
import Link from "next/link";

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      strokeLinecap="round"
    >
      {/* prsten „skopa" */}
      <circle cx="10.5" cy="10.5" r="7.25" stroke="currentColor" strokeWidth="1.6" opacity="0.9" />
      <circle cx="10.5" cy="10.5" r="3.6" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      {/* nišan */}
      <path d="M10.5 1.6v3.1M10.5 16.3v3.1M1.6 10.5h3.1M16.3 10.5h3.1" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      {/* drška */}
      <path d="M15.9 15.9 21.4 21.4" stroke="currentColor" strokeWidth="1.9" />
      {/* meta */}
      <circle cx="10.5" cy="10.5" r="1.9" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ className = "", href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2.5 ${className}`}
      aria-label="Sajtoskop — početna"
    >
      <LogoMark className="h-[22px] w-[22px] text-fg transition-transform duration-300 group-hover:rotate-[-12deg]" />
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-fg">
        sajtoskop
      </span>
    </Link>
  );
}
```

**Pravila:**

- Wordmark je **uvek mala slova**: `sajtoskop`. U rečenici i u tekstu piše se
  `Sajtoskop` — ali logo nikad ne dobija veliko S.
- Znak uz wordmark: 22px, razmak `gap-2.5` (10px).
- Znak sam (favicon, avatar, prazna stanja): minimalno 16px. Ispod toga se
  nišan gubi — koristi samo prsten + metu.
- Nikad ne prebojavaj znak u akcentnu boju u celosti. Meta je zelena, ostalo
  prati tekst.
- Hover rotacija `-12deg` je namerna sitnica; u app-u je opciona.

---

## 3. Boje

Sve boje idu kroz CSS varijable. **Nijedan hex u JSX-u.** Ako ti treba boja koje
nema u tokenima, ne postoji — pitaj pre nego što je dodaš.

### 3.1 Pun token blok (kopiraj u `globals.css`)

```css
@import "tailwindcss";

/* Tema: data-theme="dark" | "light" na <html>, bez atributa prati sistem. */
@custom-variant dark {
  &:where([data-theme="dark"], [data-theme="dark"] *) {
    @slot;
  }
  @media (prefers-color-scheme: dark) {
    &:where(:root:not([data-theme="light"]), :root:not([data-theme="light"]) *) {
      @slot;
    }
  }
}

:root {
  --bg: #ffffff;
  --bg-subtle: #f7f8f7;
  --bg-elev: #ffffff;
  --bg-inset: #f1f3f1;

  --fg: #0a0b0c;
  --fg-muted: #575e66;
  --fg-faint: #868d95;

  --border: #e5e7e6;
  --border-strong: #d3d7d4;
  --border-accent: rgba(112, 168, 10, 0.35);

  --accent: #8fd413;
  --accent-hover: #7cbc0c;
  --accent-ink: #0a0b0c;
  --accent-text: #4e7c0a;
  --accent-glow: rgba(143, 212, 19, 0.22);
  --accent-wash: rgba(143, 212, 19, 0.09);

  --danger: #d92020;
  --danger-wash: rgba(217, 32, 32, 0.07);
  --warn: #d97706;
  --orange: #ea580c;

  --score-none: var(--accent-text);
  --score-none-bg: rgba(143, 212, 19, 0.14);
  --score-cat: #d92020;
  --score-cat-bg: rgba(217, 32, 32, 0.09);
  --score-ugly: #ea580c;
  --score-ugly-bg: rgba(234, 88, 12, 0.09);
  --score-mid: #b45309;
  --score-mid-bg: rgba(217, 119, 6, 0.09);
  --score-ok: #6b7280;
  --score-ok-bg: rgba(107, 114, 128, 0.09);

  --shadow-sm: 0 1px 2px rgba(10, 11, 12, 0.05);
  --shadow-card: 0 1px 3px rgba(10, 11, 12, 0.06), 0 12px 32px -12px rgba(10, 11, 12, 0.14);
  --shadow-hero: 0 40px 90px -30px rgba(10, 11, 12, 0.28), 0 2px 6px rgba(10, 11, 12, 0.06);
  --shadow-accent: 0 8px 30px -8px rgba(143, 212, 19, 0.5);

  --grid-line: rgba(10, 11, 12, 0.055);
  --noise-opacity: 0.032;
  --glow-1: rgba(143, 212, 19, 0.14);
  --glow-2: rgba(10, 11, 12, 0.05);

  --radius: 14px;
  --radius-lg: 20px;
  --radius-sm: 10px;
}

/* Tamna tema — identičan blok ide u @media (prefers-color-scheme: dark)
   pod :root:not([data-theme="light"]) I u [data-theme="dark"]. */
[data-theme="dark"] {
  --bg: #07080a;
  --bg-subtle: #0b0d10;
  --bg-elev: #101317;
  --bg-inset: #0e1114;

  --fg: #f2f4f3;
  --fg-muted: #9aa2ab;
  --fg-faint: #6c757f;

  --border: rgba(255, 255, 255, 0.085);
  --border-strong: rgba(255, 255, 255, 0.16);
  --border-accent: rgba(173, 238, 46, 0.32);

  --accent: #adee2e;
  --accent-hover: #c1fa4d;
  --accent-ink: #08090a;
  --accent-text: #c4f55c;
  --accent-glow: rgba(173, 238, 46, 0.3);
  --accent-wash: rgba(173, 238, 46, 0.08);

  --danger: #ff5a5a;
  --danger-wash: rgba(255, 90, 90, 0.09);
  --warn: #fbbf24;
  --orange: #fb923c;

  --score-none: #c4f55c;
  --score-none-bg: rgba(173, 238, 46, 0.13);
  --score-cat: #ff6b6b;
  --score-cat-bg: rgba(255, 90, 90, 0.12);
  --score-ugly: #fb923c;
  --score-ugly-bg: rgba(251, 146, 60, 0.12);
  --score-mid: #fbbf24;
  --score-mid-bg: rgba(251, 191, 36, 0.11);
  --score-ok: #8b949e;
  --score-ok-bg: rgba(139, 148, 158, 0.11);

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.5), 0 16px 40px -18px rgba(0, 0, 0, 0.7);
  --shadow-hero: 0 50px 110px -35px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05);
  --shadow-accent: 0 8px 34px -8px rgba(173, 238, 46, 0.42);

  --grid-line: rgba(255, 255, 255, 0.05);
  --noise-opacity: 0.05;
  --glow-1: rgba(173, 238, 46, 0.13);
  --glow-2: rgba(60, 120, 255, 0.06);
}

/* Tailwind 4 most — daje ti bg-bg-elev, text-fg-muted, border-border… */
@theme inline {
  --color-bg: var(--bg);
  --color-bg-subtle: var(--bg-subtle);
  --color-bg-elev: var(--bg-elev);
  --color-bg-inset: var(--bg-inset);
  --color-fg: var(--fg);
  --color-fg-muted: var(--fg-muted);
  --color-fg-faint: var(--fg-faint);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-accent-text: var(--accent-text);
  --color-danger: var(--danger);
  --color-warn: var(--warn);

  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", monospace;

  --radius-card: var(--radius);
  --radius-card-lg: var(--radius-lg);
}
```

> Blok za tamnu temu se piše **dvaput** — jednom pod
> `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }`
> i jednom pod `[data-theme="dark"] {…}`. Prvi hvata „prati sistem", drugi hvata
> eksplicitan izbor. Bez oba, toggle ne radi u oba smera.

### 3.2 Semantika tokena

| Token | Kad se koristi |
|---|---|
| `--bg` | pozadina stranice |
| `--bg-subtle` | naizmenične sekcije, header/footer trake, sidebar |
| `--bg-elev` | kartice, modali, dropdown-i — sve što „stoji iznad" |
| `--bg-inset` | polja koja izgledaju udubljeno (code blok, disabled input) |
| `--fg` | glavni tekst, naslovi |
| `--fg-muted` | opisi, sekundarni tekst, vrednosti u tabeli |
| `--fg-faint` | labele, placeholder, metapodaci, ikonice u mirovanju |
| `--border` | sve hairline linije, default |
| `--border-strong` | ghost dugme, hover na bordere |
| `--border-accent` | okvir istaknutog elementa (naša kolona u tabeli, beta panel) |
| `--accent` | pozadina primarnog dugmeta, tačke, meta u logu, badge |
| `--accent-ink` | tekst **na** akcentnoj pozadini (nikad obrnuto) |
| `--accent-text` | akcentni tekst na normalnoj pozadini — linkovi, istaknuta reč u naslovu |
| `--accent-wash` | vrlo blaga zelena podloga (istaknuta ćelija, ikonica u krugu) |
| `--accent-glow` | zamućeni odsjaj iza ključnog elementa |

**Nikad ne koristi `--accent` kao boju teksta na `--bg`.** Kontrast u svetloj
temi pada. Za tekst postoji `--accent-text`.

### 3.3 Ugly Score bendovi

Jedina mesta gde crvena i narandžasta smeju da postoje. Par `fg`/`bg` uvek ide
zajedno.

| Bend (kod) | UI labela | Token teksta | Token podloge |
|---|---|---|---|
| `nema` | Nema sajt | `--score-none` | `--score-none-bg` |
| `katastrofa` | Katastrofa | `--score-cat` | `--score-cat-bg` |
| `ruzan` | Ružan | `--score-ugly` | `--score-ugly-bg` |
| `osrednji` | Osrednji | `--score-mid` | `--score-mid-bg` |
| `solidan` | Solidan | `--score-ok` | `--score-ok-bg` |

```ts
export const BAND_STYLE: Record<Band, { fg: string; bg: string }> = {
  nema:       { fg: "var(--score-none)", bg: "var(--score-none-bg)" },
  katastrofa: { fg: "var(--score-cat)",  bg: "var(--score-cat-bg)" },
  ruzan:      { fg: "var(--score-ugly)", bg: "var(--score-ugly-bg)" },
  osrednji:   { fg: "var(--score-mid)",  bg: "var(--score-mid-bg)" },
  solidan:    { fg: "var(--score-ok)",   bg: "var(--score-ok-bg)" },
};
```

Pažnja na inverziju: „nema sajt" je **zeleno** jer je to najbolji lead, a
„solidan" je **sivo** jer je bezvredan. To nije greška — to je poenta proizvoda.
Zelena znači „ovde ima para", ne „sve je u redu".

---

## 4. Tipografija

**Geist Sans** za sve, **Geist Mono** za brojeve, ID-eve, URL-ove, labele.

```bash
npm i geist
```

```tsx
// app/layout.tsx
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

<html lang="sr-Latn-RS" className={`${GeistSans.variable} ${GeistMono.variable}`}>
```

```css
body {
  background-color: var(--bg);
  color: var(--fg);
  font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  font-feature-settings: "cv11", "ss01";   /* jednostruko a i g — bitno za srpski */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: clip;
}
```

`lang="sr-Latn-RS"` je obavezno. Bez toga hyphenation i spell-check pucaju na
dijakritici.

### Klase (kopiraj u `globals.css`)

```css
.h-display {                                   /* samo hero, jednom po stranici */
  font-size: clamp(2.6rem, 7.4vw, 5.4rem);
  line-height: 0.95;
  letter-spacing: -0.045em;
  font-weight: 600;
  text-wrap: balance;
}

.h1 {                                          /* naslov sekcije / stranice */
  font-size: clamp(2.1rem, 4.8vw, 3.4rem);
  line-height: 1.03;
  letter-spacing: -0.038em;
  font-weight: 600;
  text-wrap: balance;
}

.h2 {                                          /* podnaslov, naslov panela */
  font-size: clamp(1.35rem, 2.4vw, 1.75rem);
  line-height: 1.18;
  letter-spacing: -0.025em;
  font-weight: 600;
  text-wrap: balance;
}

.eyebrow {                                     /* mono labela iznad naslova */
  font-family: var(--font-geist-mono), ui-monospace, monospace;
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fg-faint);
  font-weight: 500;
}

.lede {                                        /* uvodni pasus ispod naslova */
  font-size: clamp(1.02rem, 1.35vw, 1.18rem);
  line-height: 1.62;
  color: var(--fg-muted);
  text-wrap: pretty;
}

.num {                                         /* svaki broj, ID, URL, telefon */
  font-family: var(--font-geist-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}
```

**Pravila:**

- Negativan letter-spacing je potpis brenda. Što je tekst veći, to je uži.
  Nikad pozitivan tracking osim na `.eyebrow`.
- Font-weight ide do **600**. Nema 700/800/900 — deluje jeftino uz Geist.
  Za polu-bold u sitnom tekstu koristi `550`.
- `.num` na sve što se poredi po vrednosti: Ugly Score, broj kredita, telefon,
  datum, `place_id`, URL. Tabular figure sprečava skakanje kolona.
- U app UI-u: 13–15px za sadržaj, 11–12px za labele. Naslovi kartica 14.5–17px.
- Dužina reda za tekst maks `62ch`.

---

## 5. Prostor, radijusi, senke

```
Radijusi
  --radius-sm  10px   dugmad, sitni pill-ovi, ikonice u kvadratu
  --radius     14px   kartice, inputi, paneli
  --radius-lg  20px   veliki paneli, mock prozor aplikacije
  999px               tačke, avatari, theme toggle, badge

Senke — najviše jedna po elementu
  --shadow-sm      aktivan segment u toggle-u, sitno uzdizanje
  --shadow-card    kartice, dropdown, forme
  --shadow-hero    glavni prikaz na stranici (jedan, ne pet)
  --shadow-accent  isključivo primarno dugme

Bordери
  1px solid var(--border)  — default za sve
  Globalno: *, *::before, *::after { border-color: var(--border) }
```

Ritam sekcija na marketing stranama: `py-[clamp(4.5rem,9vw,8rem)]`.
U app-u: padding panela `p-5 sm:p-6`, razmak između blokova `gap-6`/`gap-8`.

Container: `mx-auto w-full max-w-[1160px] px-5 sm:px-7 lg:px-8`.
Header visina: `68px`, `scroll-padding-top: 90px` na `html`.

---

## 6. Pozadinski slojevi

Tri sloja koji nose „instrument" osećaj. Koriste se **štedljivo** — jedan hero
po stranici, ne na svakoj kartici.

```css
.grid-bg {                                     /* tehnička mreža koja bledi */
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(ellipse 100% 70% at 50% 0%, #000 30%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 100% 70% at 50% 0%, #000 30%, transparent 78%);
}

.glow {                                        /* zamućeni odsjaj iza elementa */
  position: absolute;
  pointer-events: none;
  filter: blur(90px);
  border-radius: 999px;
}

.noise::after {                                /* film zrno preko površine */
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--noise-opacity);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
}
```

Upotreba: roditelj mora biti `relative` (i `overflow-hidden` za `.noise`).

```tsx
<section className="noise relative overflow-hidden">
  <div className="grid-bg" aria-hidden />
  <div aria-hidden className="glow left-[8%] top-[-6%] h-[420px] w-[520px]"
       style={{ background: "var(--glow-1)" }} />
  …
</section>
```

---

## 7. Komponente

### 7.1 Dugmad

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: var(--radius-sm);
  font-weight: 550;
  letter-spacing: -0.011em;
  white-space: nowrap;
  transition: background-color .16s ease, color .16s ease, border-color .16s ease,
              box-shadow .22s ease, transform .12s ease;
  cursor: pointer;
}
.btn:active        { transform: translateY(1px); }

.btn-primary       { background-color: var(--accent); color: var(--accent-ink);
                     box-shadow: var(--shadow-accent); }
.btn-primary:hover { background-color: var(--accent-hover); }

.btn-ghost         { background-color: transparent; color: var(--fg);
                     border: 1px solid var(--border-strong); }
.btn-ghost:hover   { background-color: var(--bg-subtle); border-color: var(--fg-faint); }

.btn-lg { height: 3.25rem; padding-inline: 1.6rem; font-size: 1.02rem; }
.btn-md { height: 2.5rem;  padding-inline: 1rem;   font-size: 0.9rem; }
```

- **Jedno primarno dugme po ekranu.** Ostalo je ghost ili običan link.
- Primarno skoro uvek nosi `<ArrowRight size={16} strokeWidth={2.2} />` desno.
- Loading: `<Loader2 className="animate-spin" />` umesto teksta, `disabled`,
  `disabled:opacity-70`. Širina dugmeta ne sme da se menja.
- Destruktivna radnja: ghost dugme sa `color: var(--danger)`, nikad crveni fill.

### 7.2 Kartice i površine

```css
.card {
  background-color: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.card-glass {
  background: linear-gradient(180deg,
    color-mix(in oklab, var(--bg-elev) 92%, transparent), var(--bg-elev));
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
}
```

Unutrašnja podela kartice: **ne ugnježđuj kartice.** Sekcije unutar kartice
razdvajaj sa `border-t border-border`, a naglašenu zonu radi sa
`background: var(--bg-subtle)`.

Trik za mrežu polja bez dvostrukih linija — `gap-px` na `bg-border`:

```tsx
<div className="grid gap-px bg-border sm:grid-cols-3">
  <div className="p-5 sm:p-6" style={{ background: "var(--bg-elev)" }}>…</div>
  …
</div>
```

### 7.3 Input i forme

Okvir nosi kontejner, ne sam input — input je transparentan unutar njega.

```tsx
<div className="flex w-full flex-col gap-2 rounded-[14px] border border-border
                bg-bg-elev p-1.5 transition-colors duration-200
                focus-within:border-[var(--border-accent)] sm:flex-row sm:items-center"
     style={{ boxShadow: "var(--shadow-card)" }}>
  <input
    className="min-w-0 flex-1 h-12 bg-transparent px-3.5 text-[15px] text-fg
               outline-none placeholder:text-fg-faint"
  />
  <button className="btn btn-primary h-12 shrink-0 px-5 text-[15px]">…</button>
</div>
```

- Greška: `<p style={{ color: "var(--danger)" }}>` ispod polja + `aria-invalid`
  + `role="alert"`. Nema crvenog okvira preko celog inputa.
- Uspeh: zameni formu `card-glass` panelom sa zelenim kružićem i `role="status"`.
- Fokus svuda drugde: globalni `:focus-visible { outline: 2px solid var(--accent);
  outline-offset: 3px; border-radius: 4px; }` — ne gasi ga.

### 7.4 Badge / pill / status

```tsx
{/* score bedž — mono, tabular, boja iz benda */}
<span className="num inline-flex h-[22px] items-center rounded-md px-1.5 text-[11px] font-medium"
      style={{ color: style.fg, background: style.bg }}>
  {score ?? "Nema sajt"}
</span>

{/* BETA bedž */}
<span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.02em]"
      style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
  BETA
</span>

{/* pill sa ikonicom — filter, izabrani grad/niša */}
<span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border
                 bg-bg px-2.5 text-[12.5px] font-medium text-fg">
  <MapPin size={12.5} strokeWidth={2} className="text-fg-faint" />
  Šabac
  <ChevronDown size={12} strokeWidth={2.2} className="text-fg-faint" />
</span>
```

Status tačka koja pulsira dok posao radi (`--warn` u toku, `--accent` gotovo) —
`pulse-ring` keyframe je u sekciji 8.

### 7.5 Tabela

```tsx
<div className="card-glass overflow-hidden">
  <div className="scroll-x">
    <table className="w-full min-w-[720px] border-collapse text-left">
      <thead>
        <tr><th className="px-5 py-4 sm:px-6"><span className="eyebrow">…</span></th></tr>
      </thead>
      <tbody>
        <tr className="border-t border-border">
          <th scope="row" className="px-5 py-4 text-[13.5px] font-medium
                                     tracking-[-0.015em] text-fg sm:px-6">…</th>
          <td className="px-5 py-4 text-[13px] text-fg-muted sm:px-6">…</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

```css
.scroll-x { overflow-x: auto; scrollbar-width: thin; -webkit-overflow-scrolling: touch; }
.scroll-x::-webkit-scrollbar { height: 6px; }
.scroll-x::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }
```

Isticanje kolone/reda: `background: var(--accent-wash)` +
`borderInline: 1px solid var(--border-accent)`.
Header ćelije su `.eyebrow`. Redovi bez zebra pruga — samo `border-t`.

### 7.6 Accordion (FAQ, detalji prospekta)

Lista sa `border-t` na `<ul>` i `border-b` na svakom `<li>`. Dugme je ceo red.
Ikonica je `Plus` koji rotira 45° u „×", i puni se akcentom kad je otvoreno:

```tsx
<span className="grid h-6 w-6 place-items-center rounded-md border transition-all duration-300"
      style={{
        background:  isOpen ? "var(--accent)"     : "transparent",
        color:       isOpen ? "var(--accent-ink)" : "var(--fg-faint)",
        borderColor: isOpen ? "var(--accent)"     : "var(--border)",
      }}>
  <Plus size={13} strokeWidth={2.4}
        style={{ transform: isOpen ? "rotate(45deg)" : "none" }}
        className="transition-transform duration-300" />
</span>
```

Panel se otvara `height: 0 → auto` uz `opacity`, `duration: .34`, brend ease.

### 7.7 Ikonice

**lucide-react**, ništa drugo. Bez emodžija u UI-u.

| Kontekst | size | strokeWidth |
|---|---|---|
| inline uz sitan tekst | 11–13 | 2.2 |
| dugmad, kontrole | 14–17 | 2.2–2.4 |
| naglašeno (check u krugu) | 10.5–15 | 3 |

Ikonica u mirovanju je `--fg-faint`; boju dobija samo kad nosi značenje
(`--accent` = potvrda, `--warn` = upozorenje, `--danger` = greška,
`--orange` = problem na sajtu).

Kvadratna dugmad-ikonice: `grid h-8 w-8 place-items-center rounded-lg border
border-border text-fg-faint hover:text-fg`.

### 7.8 Header

Fiksiran, providan na vrhu, na skrol dobija blur i border:

```tsx
style={{
  backgroundColor: scrolled ? "color-mix(in oklab, var(--bg) 82%, transparent)" : "transparent",
  backdropFilter:  scrolled ? "blur(14px) saturate(140%)" : "none",
  borderBottom: `1px solid ${scrolled ? "var(--border)" : "transparent"}`,
}}
```

Visina `68px`, sadržaj u istom `max-w-[1160px]` kontejneru. U app-u header može
biti uži (`56px`) ali blur/border logika ostaje ista.

### 7.9 Theme toggle

Tri stanja — svetla / sistem / tamna — kao radiogroup u pill kontejneru
(`Sun`, `Monitor`, `Moon`, `size={13.5}`). Ključ u `localStorage`:
**`sajtoskop-theme`** — isti u app-u i na sajtu, da izbor prati korisnika.

```ts
// lib/theme-script.ts — ubacuje se kao <script> u <head>, pre prvog paint-a
export const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('sajtoskop-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();
`;
```

Na `<html>` ide `suppressHydrationWarning`. Bez ovog skripta na tamnoj temi
blesne beli ekran.

---

## 8. Motion

Biblioteka: **`motion`** (`motion/react`). Jedna ease kriva za sve:

```ts
const EASE = [0.22, 1, 0.36, 1];   // cubic-bezier, "brzo pa meko"
```

Trajanja: mikro-interakcija `.12–.22s`, ulazak elementa `.34–.62s`.
Potpis ulaska je **opacity + y + blur** — ne scale, ne rotacija.

```tsx
// Reveal — osnovni scroll-in
initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
viewport={{ once: true, margin: "-80px" }}
transition={{ duration: 0.62, ease: EASE }}

// Stagger — lista
staggerChildren: 0.085, delayChildren: 0.05
child: { opacity: 0, y: 20, filter: "blur(5px)" } → { …, duration: 0.58 }
```

Postoje i `CountUp` (spring, `bounce: 0`, ~1.4s, `useInView once`) i `Magnetic`
(dugme se lepi za kursor, `strength: 0.22`, spring `{stiffness: 260, damping: 18,
mass: 0.4}`, samo `pointerType === "mouse"`).

Keyframes u `globals.css`:

```css
@keyframes scanline {                          /* linija koja prelazi preko tabele */
  0%   { transform: translateY(-100%); opacity: 0; }
  8%   { opacity: 1; }
  92%  { opacity: 1; }
  100% { transform: translateY(1400%); opacity: 0; }
}
@keyframes pulse-ring {                        /* prsten oko status tačke */
  0%   { transform: scale(0.85); opacity: 0.6; }
  70%  { transform: scale(1.9);  opacity: 0; }
  100% { opacity: 0; }
}
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes blink   { 0%,49% { opacity: 1; } 50%,100% { opacity: 0.15; } }

.animate-scanline { animation: scanline 2.6s cubic-bezier(0.4,0,0.2,1) infinite; }
.animate-blink    { animation: blink 1.15s steps(1) infinite; }
.marquee-track    { animation: marquee 38s linear infinite; }
```

### Reduced motion — obavezno

```css
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}
```

U komponentama `useReducedMotion()` → renderuj **finalno stanje odmah**, ne
preskoči sadržaj. Nijedan podatak ne sme da zavisi od animacije da bi bio vidljiv.

---

## 9. Kako izgleda „demo" aplikacije

Landing prikazuje mock app prozora — to je vizuelni ugovor kako pravi UI treba
da izgleda. Rekonstrukcija u app-u:

**Okvir prozora** — `rounded-[18px] border border-border bg-bg-elev`,
`boxShadow: var(--shadow-hero)`, klasa `noise`, `overflow-hidden`,
plus `.glow` sa `var(--accent-glow)` ispod.

**Traka prozora** (`bg-bg-subtle`, `border-b`): tri macOS tačke
(`#ff5f57`, `#febc2e`, `#28c840`, 9px, `opacity-70`), u sredini adresa u `.num`
10.5px `text-fg-faint`, desno `.eyebrow` sa `beta`.

**Traka upita** (`border-b`): pill-ovi grada i niše sa leve strane, desno status
tačka + `.num` tekst („Skeniram Google Maps…" → „Gotovo").

**Tabela prospekata** — grid, ne `<table>`, da bi mobilni preslagao kolone:

```
sm:grid-cols-[minmax(0,1.5fr)_92px_minmax(0,1.4fr)_36px]
mobil: grid-cols-[1fr_auto], problem ide ispod imena, score u treći red
```

- Header red: `.eyebrow` 9.5px.
- Red: `px-3.5 py-2.5 sm:px-4`, `border-b border-border`, `last:border-b-0`.
- Ime: `text-[13.5px] font-medium tracking-[-0.015em] text-fg truncate`.
- Score: bedž iz 7.4 + labela benda 10px pored njega.
- Problem: `.num text-[11.5px] text-fg-muted truncate`.
- Red sa bendom `nema` ima podlogu `var(--score-none-bg)` — najbolji lead se vidi
  bez čitanja.
- **Zaključano polje:** ikonica `Lock` (11px) u kvadratiću `h-6 w-6 rounded-md
  border border-border text-fg-faint`, title „Otključaj za 1 kredit".
  Podsetnik na pravilo #9 iz `CLAUDE.md` — zaključano polje **ne postoji u API
  odgovoru**. Renderuj katanac zato što polja nema, ne blur preko vrednosti.
- Podnožje: legenda levo, `.num` brojač `{n} / {m} leadova` desno.

**Kartica prospekta** (detalj) — `rounded-[var(--radius-lg)] border bg-bg-elev`,
`shadow-hero`:

1. Zaglavlje: ime `text-[17px] font-semibold tracking-[-0.025em]`, kategorija
   `text-[13px] text-fg-muted`, ocena sa `Star` u `--warn`; desno bedž statusa
   otključavanja (`Unlock` + labela, boje iz benda).
2. Kontakt: `grid gap-px bg-border sm:grid-cols-3` — Telefon / Mejl / Sajt.
   Labela `text-[11px] uppercase tracking-[0.14em] text-fg-faint` sa ikonicom,
   vrednost `.num text-[13.5px]`, dopuna (npr. „mobilni") u `--accent-text`.
3. Problemi: `.eyebrow` naslov + lista sa `AlertTriangle` u `--orange`,
   `text-[13.5px] leading-snug text-fg-muted`.
4. Predlog poruke: blok sa `background: var(--bg-subtle)`, `.eyebrow` labela,
   dugme „Kopiraj" sa `Copy` ikonicom gore desno.

**Numerisana lista koraka** — broj u `.num` `text-[11px]` boje `--accent-text`,
formatiran `String(i + 1).padStart(2, "0")` → `01`, `02`, `03`.

---

## 10. Terminologija u UI-u

Kod je engleski, sve što korisnik vidi je **srpski, latinica, sa dijakritikom**.

| Kod | UI |
|---|---|
| lead / business | prospekt |
| unlock | otključaj |
| ugly score | Ugly Score (ne prevodi) |
| band | Solidan / Osrednji / Ružan / Katastrofa |
| kanban kolone | Nekontaktiran / Kontaktiran / Odgovorio / Potpisan / Nezainteresovan |
| credits | krediti |

Ton kopija: kratko, konkretno, bez marketinškog naduvavanja. Brojevi umesto
prideva („58% PVC stolarija u Šapcu nema sajt koji radi", ne „ogroman broj firmi").
Obraćanje na **ti**. Greške objašnjavaju šta da uradiš, ne šta je puklo.

---

## 11. Pravila — kratka verzija

1. **Nijedan hex u JSX-u.** Sve kroz tokene. Treba nova boja → prvo token.
2. **Jedan akcenat.** Zelena je jedina brend boja; crvena/narandžasta samo za
   Ugly Score i greške.
3. **Zelena je tekst samo kroz `--accent-text`.** `--accent` je za podloge.
4. **Obe teme se testiraju.** Tamna je primarna, ali svetla nije alternativa u
   drugom planu. Tamni blok se piše dvaput (media query + `[data-theme]`).
5. **Font-weight staje na 600.** Negativan letter-spacing na naslovima.
6. **`.num` na svaki broj.** Tabela sa brojevima koji skaču je pokvarena tabela.
7. **Jedna senka po elementu, jedno primarno dugme po ekranu.**
8. **Bez ugnježđenih kartica.** Podela ide hairline linijom ili `--bg-subtle`.
9. **Ikonice iz lucide-react, bez emodžija.**
10. **Jedna ease kriva** `[0.22, 1, 0.36, 1]`; ulazak je opacity + y + blur.
11. **`prefers-reduced-motion` se poštuje**, i sadržaj je čitljiv bez animacije.
12. **Fokus prsten se ne gasi.** Kontrast teksta minimum AA na obe teme.
13. **Zaključan podatak se ne blurira** — server ga uopšte ne šalje, UI prikazuje
    katanac. CSS blur nije bezbednost.

---

## 12. Zavisnosti koje identitet podrazumeva

```json
{
  "geist": "^1.7.2",         // Geist Sans + Mono
  "lucide-react": "^1.31.0", // ikonice
  "motion": "^13.1.0",       // animacije
  "tailwindcss": "4.1.13"    // @theme inline most ka tokenima
}
```

Za OG slike u app-u: TTF fajlovi `Geist-Regular`, `Geist-SemiBold`,
`GeistMono-Medium` idu u `assets/` i učitavaju se u `ImageResponse`.
OG paleta je fiksno tamna: `#07080a` / `#f2f4f3` / `#9aa2ab` / `#adee2e`.
