// packages/shared/test/feedback-motor.ts
// Motor pravila za utiske (F11 §3). Pokretanje: pnpm --filter @sajtoskop/shared test
//
// Do S29 je ovo stajalo na dnu `smoke.ts`. Izdvojeno je zato što su pravila
// motora jedina stvar u `shared`-u koja se menja iz sesije u sesiju, a smoke je
// fajl u koji se gleda samo kad nešto pukne.
//
// Pravila iz §3.1 su tvrda i lako se „popravi" jedno od njih usput. Ovo su ona
// koja su u „Gotovo kad" listi napisana kao uslov puštanja faze.

import {
  MOTOR,
  pitanjeZaKljuc,
  posleOdbacivanja,
  posleOdgovora,
  sledecePitanje,
  smeDaSePita,
} from "../src/index";

let fail = 0;

function check(ok: boolean, line: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${line}`);
}

console.log("motor utisaka");

const DAN_MS = 24 * 60 * 60 * 1000;
const SADA = Date.parse("2026-08-12T10:00:00Z");
const mirno = { pitanoUSesiji: false, ekranMiran: true, odUcitavanjaMs: 120_000 };
const prazno = { cooldownUntil: null, mutedUntil: null, dismissStreak: 0, poPitanju: {} };

const prvaLista = pitanjeZaKljuc("prva-lista");
const posaoPao = pitanjeZaKljuc("posao-pao");

check(prvaLista !== null && posaoPao !== null, "katalog ima oba pitanja sa /pretrage");
check(pitanjeZaKljuc("izmisljeno") === null, "ključ van kataloga ne postoji");

if (prvaLista && posaoPao) {
  check(
    sledecePitanje(prazno, mirno, [prvaLista], SADA)?.kljuc === "prva-lista",
    "miran ekran, nema istorije → pitanje prolazi",
  );
  check(
    sledecePitanje(prazno, { ...mirno, odUcitavanjaMs: 5_000 }, [prvaLista], SADA) === null,
    "pre 60 s od učitavanja → ništa",
  );
  check(
    sledecePitanje(prazno, { ...mirno, pitanoUSesiji: true }, [prvaLista], SADA) === null,
    "jedno pitanje po sesiji",
  );
  check(
    sledecePitanje(prazno, { ...mirno, ekranMiran: false }, [prvaLista], SADA) === null,
    "dok posao radi ili je modal otvoren → ništa",
  );

  // Cooldown zaustavlja molbu, ali ne i incident — i to je jedini izuzetak.
  const uCooldownu = {
    ...prazno,
    cooldownUntil: new Date(SADA + 60 * 60 * 1000).toISOString(),
  };
  check(sledecePitanje(uCooldownu, mirno, [prvaLista], SADA) === null, "cooldown ćuti molbu");
  check(
    sledecePitanje(uCooldownu, mirno, [posaoPao], SADA)?.kljuc === "posao-pao",
    "incident seče cooldown",
  );

  // Ćutanje je jače od incidenta: čovek koji je rekao ne dvaput nije rekao ne
  // samo molbama.
  const ucutkan = { ...prazno, mutedUntil: new Date(SADA + 60 * 60 * 1000).toISOString() };
  check(sledecePitanje(ucutkan, mirno, [posaoPao], SADA) === null, "ćutanje je jače od incidenta");

  // Isto pitanje jednom po nalogu — osim onog sa `ponovi`.
  const vidjeno = {
    ...prazno,
    poPitanju: {
      "prva-lista": { status: "odbaceno" as const, shownAt: new Date(SADA - 1000).toISOString() },
      "posao-pao": {
        status: "odgovoreno" as const,
        shownAt: new Date(SADA - 25 * 60 * 60 * 1000).toISOString(),
      },
    },
  };
  check(
    sledecePitanje(vidjeno, mirno, [prvaLista], SADA) === null,
    "viđeno pitanje se ne vraća nikad",
  );
  check(
    sledecePitanje(vidjeno, mirno, [posaoPao], SADA)?.kljuc === "posao-pao",
    "posao-pao sme ponovo posle 24 h",
  );
  check(
    smeDaSePita(
      posaoPao,
      {
        ...prazno,
        poPitanju: {
          "posao-pao": {
            status: "odbaceno",
            shownAt: new Date(SADA - 60 * 60 * 1000).toISOString(),
          },
        },
      },
      SADA,
    ) === false,
    "posao-pao ne sme dvaput u istom danu",
  );

  // ── S29: treće odbacivanje je 90 dana, ne „do kraja bete" ──
  // Bilo je 3650 dana. Razlika nije kozmetička: 90 dana znači da se pitanje
  // jednog dana VRAĆA, pa test proverava i gornju i donju ivicu.
  const prvo = posleOdbacivanja(0, SADA);
  check(prvo.dismissStreak === 1 && prvo.mutedUntil === null, "prvo odbacivanje ne ćuti sistem");

  const drugo = posleOdbacivanja(1, SADA);
  const dana = drugo.mutedUntil ? Math.round((Date.parse(drugo.mutedUntil) - SADA) / DAN_MS) : 0;
  check(dana === MOTOR.CUTANJE_DANA, `dva odbacivanja → ćutanje ${dana} dana`);

  const trece = posleOdbacivanja(2, SADA);
  const danaTrece = trece.mutedUntil
    ? Math.round((Date.parse(trece.mutedUntil) - SADA) / DAN_MS)
    : 0;
  check(MOTOR.CUTANJE_DO_KRAJA_DANA === 90, "treće odbacivanje ćuti 90 dana, ne do kraja bete");
  check(danaTrece === 90, `treće odbacivanje → ${danaTrece} dana ćutanja`);
  check(
    trece.dismissStreak === 3 && danaTrece > MOTOR.CUTANJE_DANA,
    "treće ćuti duže od drugog, ali ne zauvek",
  );

  // Posle 90 dana pitanje ponovo prolazi — to je cela poenta izmene.
  if (trece.mutedUntil) {
    const posleRoka = Date.parse(trece.mutedUntil) + 1000;
    check(
      sledecePitanje({ ...prazno, mutedUntil: trece.mutedUntil }, mirno, [prvaLista], posleRoka)
        ?.kljuc === "prva-lista",
      "posle 90 dana ćutanje ističe i pitanje se vraća",
    );
  }

  // Ko odgovori, dobija mir — i streak mu se briše.
  const odgovor = posleOdgovora(SADA);
  check(
    odgovor.dismissStreak === 0 &&
      Math.round((Date.parse(odgovor.cooldownUntil) - SADA) / DAN_MS) ===
        MOTOR.COOLDOWN_POSLE_ODGOVORA_DANA,
    "odgovor → 7 dana mira i streak na nuli",
  );
}

console.log(fail === 0 ? "\nSve prošlo." : `\n${fail} palo.`);
process.exit(fail === 0 ? 0 : 1);
